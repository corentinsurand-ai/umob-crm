import React, { useMemo, useState } from "react";

/* ══════════════════════════════════════════════════════════════════════════
   CONSOLE MANAGER — vue réservée à Corentin (onglet visible uniquement pour
   corentin.surand@umob.fr). 100 % ALIMENTÉE PAR LE CRM : entreprises, deals,
   contacts et activités d'appel (webhook RingOver → analyse Mistral). Aucune
   donnée fictive : ce qui n'existe pas encore s'affiche vide avec une note
   « se remplira avec les appels ». Règle anti-invention : un champ que la
   source ne connaît pas reste vide, jamais déduit.
   ══════════════════════════════════════════════════════════════════════════ */

// Types minimaux (l'état réel vient d'App.tsx — on ne lit que ces champs).
interface ActiviteC {
  date: string; texte: string; type?: string; echeance?: string; dateISO?: string; heure?: string;
  resumeIA?: string; sentiment?: string; sujets?: string; scoreIA?: number;
  transcription?: string; urlEnregistrement?: string; directionAppel?: string; dureeAppel?: string;
}
interface EntrepriseC {
  id: string; nom: string; nomCommercial?: string; secteur: string; ville: string; statut: string;
  tel: string; franchiseur: string; modeLivraison: string; nbVehicules: string; modeles?: string[];
  activites: ActiviteC[];
}
interface DealC { id: string; titre: string; entrepriseId: string; montant: number; etape: string }
interface ContactC { id: string; prenom: string; nom: string; entrepriseIds: string[]; tel: string; email: string }
interface EtatConsole { entreprises: EntrepriseC[]; deals: DealC[]; contacts: ContactC[] }

/* ————— UI de base (l'app n'a pas shadcn) ————— */
const Card = ({ children, className = "", style }: any) => (
  <div className={"rounded-2xl border border-slate-200 bg-white p-4 shadow-sm " + className} style={style}>{children}</div>
);
const Etoiles = ({ score }: { score: number }) => (
  <span className="text-amber-500 tracking-tight text-sm">{"★".repeat(Math.max(0, Math.min(5, Math.round(score))))}<span className="text-slate-200">{"★".repeat(5 - Math.max(0, Math.min(5, Math.round(score))))}</span></span>
);
const badgeSentiment = (s?: string) => {
  if (!s) return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">non analysé</span>;
  const n = s.toLowerCase();
  const ok = n.includes("posi");
  const ko = n.includes("nega") || n.includes("nég");
  return (
    <span className={"rounded-full px-2 py-0.5 text-[10px] font-semibold " + (ok ? "bg-emerald-50 text-emerald-700" : ko ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600")}>{s}</span>
  );
};

/* ————— Outils dates (dateISO = jj/mm/aaaa) ————— */
const cleDate = (d?: string): number => {
  if (!d) return 0;
  const p = d.trim().split(/[/\-]/).map(Number);
  if (p.length !== 3 || p.some(Number.isNaN)) return 0;
  return p[0] > 1000 ? p[0] * 10000 + p[1] * 100 + p[2] : p[2] * 10000 + p[1] * 100 + p[0];
};
const aujourdhui = () => { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
const ilYA = (jours: number) => aujourdhui() - jours; // approximatif en jours calendaires compacts (ok pour des tris 7/30 j)

/* ————— Détection du mode de livraison ————— RÈGLE ANTI-INVENTION : la valeur
   vient UNIQUEMENT du champ modeLivraison de la fiche ; vide = « à qualifier »,
   jamais deviné depuis le secteur. */
const detecterMix = (modeLivraison: string): "thermique" | "elec" | "plateforme" | "aucun" | null => {
  const m = (modeLivraison || "").toLowerCase();
  if (!m) return null;
  if (/uber|deliveroo|justeat|just eat|plateforme|glovo/.test(m)) return "plateforme";
  if (/[ée]lectri/.test(m) || /\belec\b/.test(m)) return "elec";
  if (/thermi|essence|essence|carburant/.test(m)) return "thermique";
  if (/aucune|aucun|sans|rien/.test(m)) return "aucun";
  return null; // valeur non reconnue → à qualifier (jamais rangée de force)
};

/* ————— Construction des données console depuis l'état du CRM ————— */
const construire = (etat: EtatConsole) => {
  const entrepriseDe = (id: string) => etat.entreprises.find((e) => e.id === id);
  const contactDe = (id: string) => {
    const e = entrepriseDe(id);
    const ct = e && etat.contacts.find((c) => c.entrepriseIds.includes(e.id));
    return ct ? `${ct.prenom} ${ct.nom}`.trim() : "";
  };

  // Tous les appels consignés (manuels ou webhook RingOver), du plus récent au plus ancien.
  const appels = etat.entreprises.flatMap((e) =>
    (e.activites || []).filter((a) => a.type === "appel").map((a) => ({ entreprise: e, a }))
  ).sort((x, y) => cleDate(y.a.dateISO) - cleDate(x.a.dateISO) || (y.a.heure || "").localeCompare(x.a.heure || ""));

  // Les appels « analysés » (webhook) vs consignés à la main.
  const analyses = appels.filter((x) => x.a.resumeIA || x.a.sentiment || x.a.scoreIA != null);
  const taches = etat.entreprises.flatMap((e) =>
    (e.activites || []).filter((a) => a.type === "tache" && a.echeance).map((a) => ({ entreprise: e, a }))
  );

  // Mix de livraison & zones, depuis les fiches entreprises réelles.
  const mix = { thermique: 0, elec: 0, plateforme: 0, aucun: 0, aQualifier: 0 };
  const zones = new Map<string, { nb: number; appels: number; mix: typeof mix }>();
  const secteurs = new Map<string, { nb: number; appels: number; mix: typeof mix }>();
  etat.entreprises.forEach((e) => {
    const d = detecterMix(e.modeLivraison);
    const cleMix = (m: typeof mix) => { if (d === "thermique") m.thermique++; else if (d === "elec") m.elec++; else if (d === "plateforme") m.plateforme++; else if (d === "aucun") m.aucun++; else m.aQualifier++; };
    cleMix(mix);
    const zone = (e.ville || "").trim() || "Ville à qualifier";
    if (!zones.has(zone)) zones.set(zone, { nb: 0, appels: 0, mix: { thermique: 0, elec: 0, plateforme: 0, aucun: 0, aQualifier: 0 } });
    const z = zones.get(zone)!; z.nb++; cleMix(z.mix);
    const sec = (e.secteur || "").trim() || "Secteur à qualifier";
    if (!secteurs.has(sec)) secteurs.set(sec, { nb: 0, appels: 0, mix: { thermique: 0, elec: 0, plateforme: 0, aucun: 0, aQualifier: 0 } });
    const s = secteurs.get(sec)!; s.nb++; cleMix(s.mix);
    const nbAppels = (e.activites || []).filter((a) => a.type === "appel").length;
    z.appels += nbAppels; s.appels += nbAppels;
  });

  // Objections réellement entendues, détectées dans les transcriptions / sujets analysés.
  const OB = [["cher", "Prix / budget"], ["réfléchir|reflechir", "Besoin d'y réfléchir"], ["concurrent|autre loueur|ailleurs", "Concurrence"], ["autonomie|batterie", "Autonomie / batterie"], ["48 mois|engagement|durée|duree", "Engagement / durée"], ["associé|associe|associé", "Décideur non présent"]];
  const objections = new Map<string, number>();
  analyses.forEach(({ a }) => {
    const t = ((a.sujets || "") + " " + (a.transcription || "")).toLowerCase();
    OB.forEach(([re, label]) => { if (new RegExp(re).test(t)) objections.set(label, (objections.get(label) || 0) + 1); });
  });

  return { appels, analyses, taches, mix, zones: [...zones.entries()], secteurs: [...secteurs.entries()], objections: [...objections.entries()].sort((a, b) => b[1] - a[1]), entrepriseDe, contactDe };
};

/* ————— Barre empilée CSS (pas de lib de charts en prod) ————— */
const BarreMix = ({ m, total }: { m: any; total: number }) => {
  const parts = [["Thermique", m.thermique, "#0d9488"], ["Électrique", m.elec, "#3b82f6"], ["Plateforme", m.plateforme, "#e11d48"], ["Sans flotte", m.aucun, "#94a3b8"], ["À qualifier", m.aQualifier, "#e2e8f0"]];
  if (total === 0) return <div className="h-4 rounded-lg bg-slate-100" />;
  return (
    <div className="flex h-4 overflow-hidden rounded-lg">
      {parts.map(([l, n, c]: any) => n > 0 && (
        <div key={l} style={{ width: (n / total) * 100 + "%", background: c }} title={l + " : " + n} />
      ))}
    </div>
  );
};

/* ═══════════════════ BRIEF DU MATIN ═══════════════════ */
function Brief({ d }: { d: ReturnType<typeof construire> }) {
  const _7j = d.appels.filter((x) => cleDate(x.a.dateISO) >= ilYA(7));
  const aEcouter = d.analyses.filter((x) => (x.a.scoreIA ?? 3) <= 2).slice(0, 3);
  const duJour = d.taches.filter((x) => cleDate(x.a.echeance) <= aujourdhui());
  const negatifs = d.analyses.filter((x) => (x.a.sentiment || "").toLowerCase().includes("nega") || (x.a.sentiment || "").includes("nég")).slice(0, 3);
  return (
    <div className="space-y-4">
      <Card>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">☀️ Brief du matin</div>
        <div className="text-sm text-slate-700 mt-1 leading-relaxed">
          {d.appels.length === 0 ? (
            <>Aucun appel consigné pour l'instant. Dès que des appels passent par RingOver (ou via le bouton « Consigner »), ils apparaissent ici avec leur analyse IA.</>
          ) : (
            <>
              <b>{d.appels.length}</b> appel{d.appels.length > 1 ? "s" : ""} consigné{d.appels.length > 1 ? "s" : ""} au total,
              dont <b>{_7j.length}</b> sur les 7 derniers jours et <b>{d.analyses.length}</b> analysé{d.analyses.length > 1 ? "s" : ""} par l'IA
              {negatifs.length > 0 ? `, ${negatifs.length} avec un sentiment négatif à revoir` : ""}.
              {duJour.length > 0 ? ` ${duJour.length} tâche${duJour.length > 1 ? "s" : ""} arrivée${duJour.length > 1 ? "s" : ""} à échéance aujourd'hui ou en retard.` : ""}
            </>
          )}
        </div>
      </Card>
      {negatifs.length > 0 && (
        <Card>
          <div className="font-semibold text-rose-700 mb-2 text-sm">⚠️ Appels à sentiment négatif</div>
          {negatifs.map(({ entreprise, a }, i) => (
            <div key={i} className="rounded-lg bg-rose-50/60 px-3 py-2 mb-1 text-xs">
              <b>{entreprise.nomCommercial || entreprise.nom}</b> · {a.date} — {a.resumeIA || a.texte}
            </div>
          ))}
        </Card>
      )}
      {duJour.length > 0 && (
        <Card>
          <div className="font-semibold text-slate-800 mb-2 text-sm">✅ À faire aujourd'hui</div>
          {duJour.map(({ entreprise, a }, i) => (
            <div key={i} className="text-xs text-slate-600 py-1 border-t border-slate-100 first:border-0">
              <b>{entreprise.nomCommercial || entreprise.nom}</b> — {a.texte} <span className="text-slate-400">(échéance {a.echeance})</span>
            </div>
          ))}
        </Card>
      )}
      {aEcouter.length > 0 && (
        <Card>
          <div className="font-semibold text-slate-800 mb-2 text-sm">🎧 À réécouter (score IA ≤ 2)</div>
          {aEcouter.map(({ entreprise, a }, i) => (
            <div key={i} className="text-xs text-slate-600 py-1 border-t border-slate-100 first:border-0">
              <b>{entreprise.nomCommercial || entreprise.nom}</b> · {a.date} — {a.resumeIA || a.texte} {a.urlEnregistrement && <a className="text-cyan-700 font-semibold" href={a.urlEnregistrement} target="_blank" rel="noreferrer">▶️ écouter</a>}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

/* ═══════════════════ CONVERSATIONS ═══════════════════ */
function Conversations({ d }: { d: ReturnType<typeof construire> }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const filtres = d.appels.filter(({ entreprise, a }) => {
    const s = (q || "").toLowerCase();
    return !s || (entreprise.nom + " " + (a.resumeIA || "") + " " + (a.sujets || "") + " " + (a.transcription || "") + " " + a.texte).toLowerCase().includes(s);
  });
  const actif = filtres.find((x) => x.a.appelId === sel || (!x.a.appelId && x.a.texte === sel)) || null;
  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      <Card className="p-0 overflow-hidden">
        <div className="p-3 border-b border-slate-100">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher dans les conversations…"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-cyan-400" />
        </div>
        <div className="max-h-[540px] overflow-y-auto">
          {filtres.length === 0 && <div className="p-4 text-xs text-slate-400">Aucun appel{q ? " pour cette recherche" : " consigné pour l'instant"}.</div>}
          {filtres.map(({ entreprise, a }, i) => (
            <button key={i} onClick={() => setSel(a.appelId || a.texte)}
              className={"w-full text-left px-3 py-2.5 border-t border-slate-100 hover:bg-slate-50 " + ((a.appelId || a.texte) === sel ? "bg-cyan-50" : "")}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-800 truncate">{entreprise.nomCommercial || entreprise.nom}</span>
                {a.scoreIA != null && <Etoiles score={a.scoreIA} />}
              </div>
              <div className="text-[10px] text-slate-400">{a.date} {a.heure || ""} · {a.directionAppel || "appel"} {a.dureeAppel ? "· " + a.dureeAppel : ""}</div>
              <div className="text-[11px] text-slate-500 line-clamp-2">{a.resumeIA || a.texte}</div>
            </button>
          ))}
        </div>
      </Card>
      {actif ? (
        <Card>
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <div className="text-sm font-bold text-slate-800">{actif.entreprise.nomCommercial || actif.entreprise.nom}</div>
              <div className="text-[11px] text-slate-400">{actif.a.date} {actif.a.heure || ""} · {actif.contactDe(actif.entreprise.id) || "contact à qualifier"} · {(actif.entreprise.ville || "ville à qualifier")}</div>
            </div>
            <div className="flex items-center gap-2">
              {badgeSentiment(actif.a.sentiment)}
              {actif.a.scoreIA != null && <Etoiles score={actif.a.scoreIA} />}
              {actif.a.urlEnregistrement && <a href={actif.a.urlEnregistrement} target="_blank" rel="noreferrer" className="rounded-full bg-cyan-600 px-3 py-1 text-[11px] font-bold text-white">▶️ Enregistrement</a>}
            </div>
          </div>
          {(actif.a.resumeIA || actif.a.sujets) && (
            <div className="mt-3 rounded-xl bg-cyan-50/70 p-3">
              {actif.a.resumeIA && <><div className="text-[10px] font-bold uppercase tracking-wider text-cyan-800">✨ Résumé IA</div><p className="text-xs text-slate-700 mt-0.5">{actif.a.resumeIA}</p></>}
              {actif.a.sujets && <div className="text-[11px] text-cyan-800 mt-1.5">🧩 Sujets / signaux détectés : {actif.a.sujets}</div>}
            </div>
          )}
          {actif.a.transcription ? (
            <details className="mt-3" open>
              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-slate-400">✍️ Transcription</summary>
              <div className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-slate-100 p-3 text-xs leading-relaxed text-slate-600 whitespace-pre-wrap">{actif.a.transcription}</div>
            </details>
          ) : (
            <div className="mt-3 text-[11px] text-slate-400 italic">Pas de transcription (appel consigné manuellement, ou plan RingOver sans transcription).</div>
          )}
          <div className="mt-3 text-[10px] text-slate-400">Note CRM : {actif.a.texte}</div>
        </Card>
      ) : (
        <Card><div className="text-xs text-slate-400">Sélectionne une conversation à gauche. Recherche plein texte sur les transcriptions et résumés IA incluses.</div></Card>
      )}
    </div>
  );
}

/* ═══════════════════ DEALS ═══════════════════ */
function Deals({ d, etat }: { d: ReturnType<typeof construire>; etat: EtatConsole }) {
  const actifs = etat.deals.filter((x) => x.etape !== "Gagné" && x.etape !== "Perdu");
  const sante = (de: DealC) => {
    const e = d.entrepriseDe(de.entrepriseId);
    const appelsE = (e?.activites || []).filter((a) => a.type === "appel");
    const dernier = appelsE.length ? cleDate(appelsE.map((a) => a.dateISO).sort().reverse()[0]) : 0;
    const neg = appelsE.some((a) => (a.sentiment || "").toLowerCase().includes("nega") || (a.sentiment || "").includes("nég"));
    if (neg) return ["risque", "Sentiment négatif sur un appel récent", "text-rose-600"];
    if (dernier && aujourdhui() - dernier > 1400) return ["attention", "Aucun appel depuis plus de 2 semaines", "text-amber-600"];
    if (!dernier) return ["attention", "Aucun appel consigné sur ce compte", "text-amber-600"];
    return ["ok", "Activité récente", "text-emerald-600"];
  };
  return (
    <div className="space-y-3">
      {actifs.length === 0 && <Card><div className="text-xs text-slate-400">Aucun deal actif. Les deals créés dans le CRM apparaissent ici avec leur santé calculée depuis les appels (règle : jamais d'invention, un deal sans appel est « à surveiller », pas « à risque »).</div></Card>}
      {actifs.map((de) => {
        const e = d.entrepriseDe(de.entrepriseId);
        const [s, pourquoi, c] = sante(de) as any;
        const icone = s === "ok" ? "🟢" : s === "attention" ? "🟡" : "🔴";
        return (
          <Card key={de.id}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <div className="text-sm font-bold text-slate-800">{icone} {de.titre}</div>
                <div className="text-[11px] text-slate-400">{e ? e.nomCommercial || e.nom : "—"} · {de.etape} · {de.montant ? de.montant.toLocaleString("fr-FR") + " €" : "montant non chiffré"}</div>
              </div>
              <div className={"text-[11px] font-semibold " + c}>{pourquoi}</div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* ═══════════════════ PROSPECTION (pages entreprise auto-remplies) ═══════════════════ */
function Prospection({ d, etat }: { d: ReturnType<typeof construire>; etat: EtatConsole }) {
  const total = etat.entreprises.length || 1;
  const nbAppels = d.appels.length;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><div className="text-xs text-slate-500">Sociétés dans le CRM</div><div className="text-xl font-bold text-slate-800">{etat.entreprises.length}</div></Card>
        <Card><div className="text-xs text-slate-500">Appels consignés</div><div className="text-xl font-bold text-slate-800">{nbAppels}</div></Card>
        <Card><div className="text-xs text-slate-500">Thermique (déjà renseigné)</div><div className="text-xl font-bold" style={{ color: "#0d9488" }}>{d.mix.thermique}</div></Card>
        <Card><div className="text-xs text-slate-500">Mode de livraison à qualifier</div><div className="text-xl font-bold text-amber-600">{d.mix.aQualifier}</div></Card>
      </div>

      <Card>
        <div className="text-sm font-semibold mb-1">Comment livrent les sociétés du CRM</div>
        <div className="text-xs text-slate-400 mb-3">Source : champ « Mode de livraison » des fiches (rempli à la création ou par l'IA). Au moindre doute : « à qualifier » — jamais deviné.</div>
        <BarreMix m={d.mix} total={total} />
        <div className="mt-1.5 flex gap-3 flex-wrap">
          {[["Thermique", d.mix.thermique, "#0d9488"], ["Électrique", d.mix.elec, "#3b82f6"], ["Plateforme", d.mix.plateforme, "#e11d48"], ["Sans flotte", d.mix.aucun, "#94a3b8"], ["À qualifier", d.mix.aQualifier, "#e2e8f0"]].map(([l, n, c]: any) => (
            <span key={l} className="flex items-center gap-1 text-[10px] text-slate-500"><span className="h-2 w-2 rounded-sm" style={{ background: c }} />{l} : {n}</span>
          ))}
        </div>
      </Card>

      <Card>
        <div className="text-sm font-semibold mb-1">🗺 Zones géographiques</div>
        <div className="text-xs text-slate-400 mb-3">Agrégé depuis le champ « Ville » de chaque fiche — le jour où les commerciaux appellent, les compteurs d'appels par zone se remplissent seuls.</div>
        <div className="space-y-3">
          {d.zones.sort((a, b) => b[1].nb - a[1].nb).slice(0, 12).map(([zone, z]: any) => (
            <div key={zone} className="rounded-xl bg-slate-50 p-3">
              <div className="flex justify-between text-xs mb-1.5">
                <span className="font-semibold text-slate-800">{zone}</span>
                <span className="text-slate-400">{z.nb} société{s > 1 && ""}{z.nb > 1 ? "s" : ""} · {z.appels} appel{z.appels > 1 ? "s" : ""}</span>
              </div>
              <BarreMix m={z.mix} total={z.nb} />
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="text-sm font-semibold mb-1">🏢 Pages entreprise</div>
        <div className="text-xs text-slate-400 mb-3">Chaque fiche est sa « page entreprise » : l'IA écrit dedans après chaque appel (règle : au moindre doute, le champ reste vide). Ce qui est rouge = la consigne du prochain appel.</div>
        <div className="grid gap-3 md:grid-cols-2">
          {etat.entreprises.slice(0, 40).map((e) => {
            const nbAppelsE = (e.activites || []).filter((a) => a.type === "appel").length;
            const f = [
              ["Ville", e.ville], ["Secteur", e.secteur], ["Mode de livraison", e.modeLivraison],
              ["Responsable", d.contactDe(e.id)], ["Téléphone", e.tel], ["Nb véhicules", e.nbVehicules],
            ] as [string, string][];
            const remplis = f.filter(([, v]) => (v || "").trim()).length;
            return (
              <div key={e.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs font-bold text-slate-800">{e.nomCommercial || e.nom}</div>
                  <div className="text-right">
                    <div className={"text-sm font-bold " + (remplis >= 5 ? "text-emerald-600" : remplis >= 3 ? "text-amber-600" : "text-rose-600")}>{Math.round((remplis / f.length) * 100)}%</div>
                    <div className="text-[9px] text-slate-400">fiche</div>
                  </div>
                </div>
                <div className="mt-1.5 space-y-0.5">
                  {f.map(([l, v]) => (
                    <div key={l} className="text-[11px]">
                      {v && v.trim() ? <span className="text-emerald-500">✓</span> : <span className="text-rose-300">✗</span>} <span className={v && v.trim() ? "text-slate-600" : "text-slate-300"}>{l} {v && v.trim() ? "— " + v : "— à obtenir"}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 text-[10px] text-slate-400">{nbAppelsE} appel{nbAppelsE > 1 ? "s" : ""} consigné{nbAppelsE > 1 ? "s" : ""} · statut : {e.statut}</div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

/* ═══════════════════ COACHING & INSIGHTS ═══════════════════ */
function Coaching({ d }: { d: ReturnType<typeof construire> }) {
  const scores = d.analyses.map((x) => x.a.scoreIA).filter((x) => x != null) as number[];
  const moyenne = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  return (
    <div className="space-y-4">
      <Card>
        <div className="text-sm font-semibold mb-1">🎓 Score IA des appels</div>
        {scores.length === 0 ? <div className="text-xs text-slate-400">Aucun appel analysé pour l'instant — les scores (1-5 ⭐) arrivent avec les appels passés via RingOver.</div> : (
          <div className="flex items-center gap-3"><Etoiles score={moyenne} /><span className="text-sm font-bold text-slate-700">{Math.round(moyenne * 10) / 10}/5</span><span className="text-xs text-slate-400">sur {scores.length} appel{scores.length > 1 ? "s" : ""} analysé{scores.length > 1 ? "s" : ""}</span></div>
        )}
      </Card>
      <Card>
        <div className="text-sm font-semibold mb-2">Référentiel Plan de vente U'mob — version téléphone</div>
        <div className="space-y-1.5 text-[11px] text-slate-600">
          {["1. Accueil & cadre de l'appel", "2. Découverte flotte & coûts", "3. Décisionnaire & timing identifiés", "4. Comparatif systématique (thermique / concurrent / ancienne génération)", "5. Jamais le prix avant les 4 validations (offre / maintenance / produit / 48 mois)", "6. Objections sans confrontation — « c'est trop cher » → demander pourquoi", "7. Prochaine étape datée (l'objectif de l'appel : qualifier + booker le RDV terrain)"].map((t) => (
            <div key={t} className="rounded-lg bg-slate-50 px-3 py-1.5">{t}</div>
          ))}
        </div>
      </Card>
    </div>
  );
}
function Insights({ d }: { d: ReturnType<typeof construire> }) {
  return (
    <div className="space-y-4">
      <Card>
        <div className="text-sm font-semibold mb-1">📊 Objections entendues</div>
        {d.objections.length === 0 ? <div className="text-xs text-slate-400">Aucune objection détectée pour l'instant. Les objections sont repérées automatiquement dans les transcriptions des appels analysés.</div> : (
          <div className="space-y-2">
            {d.objections.map(([label, n]: any) => (
              <div key={label}>
                <div className="flex justify-between text-xs mb-0.5"><span className="font-medium text-slate-700">{label}</span><span className="text-slate-400">{n} appel{n > 1 ? "s" : ""}</span></div>
                <div className="h-2 rounded bg-slate-100"><div className="h-2 rounded bg-cyan-600" style={{ width: (n / d.objections[0][1]) * 100 + "%" }} /></div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card>
        <div className="text-sm font-semibold mb-1">Sujets détectés par l'IA</div>
        {d.analyses.filter((x) => x.a.sujets).length === 0 ? <div className="text-xs text-slate-400">Les sujets/signaux détectés par l'IA sur chaque appel apparaîtront ici.</div> : (
          <div className="space-y-1.5">
            {d.analyses.filter((x) => x.a.sujets).slice(0, 15).map(({ entreprise, a }, i) => (
              <div key={i} className="text-[11px] text-slate-600 rounded-lg bg-slate-50 px-3 py-1.5"><b>{entreprise.nomCommercial || entreprise.nom}</b> · {a.date} — {a.sujets}</div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ═══════════════════ CONSOLE (onglets) ═══════════════════ */
export function ConsoleManager({ etat }: { etat: EtatConsole }) {
  const [tab, setTab] = useState("brief");
  const d = useMemo(() => construire(etat), [etat]);
  const onglets = [
    ["brief", "☀️ Brief"], ["conversations", "💬 Conversations"], ["deals", "🎯 Deals"],
    ["prospection", "🧭 Prospection"], ["coaching", "🎓 Coaching"], ["insights", "📊 Insights"],
  ] as const;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-lg font-black text-slate-800">Console manager</div>
          <div className="text-[11px] text-slate-400">Pilotage des commerciaux · 100 % alimentée par le CRM (appels, fiches, deals) · l'IA écrit, au moindre doute elle laisse vide</div>
        </div>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {onglets.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={"rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors " + (tab === k ? "bg-cyan-700 text-white" : "bg-white border border-slate-200 text-slate-500 hover:bg-slate-50")}>{l}</button>
        ))}
      </div>
      {tab === "brief" && <Brief d={d} />}
      {tab === "conversations" && <Conversations d={d} />}
      {tab === "deals" && <Deals d={d} etat={etat} />}
      {tab === "prospection" && <Prospection d={d} etat={etat} />}
      {tab === "coaching" && <Coaching d={d} />}
      {tab === "insights" && <Insights d={d} />}
    </div>
  );
}
