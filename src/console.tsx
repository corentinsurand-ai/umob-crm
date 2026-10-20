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
  scorecard?: { [k: string]: { note: number; j: string } };
}
interface EntrepriseC {
  id: string; nom: string; nomCommercial?: string; secteur: string; ville: string; statut: string;
  tel: string; franchiseur: string; modeLivraison: string; nbVehicules: string; modeles?: string[];
  activites: ActiviteC[];
  devisHistorique?: DevisC[];
}
// Devis archivé sur une fiche entreprise (source : module Devis « 💾 Sauvegarder
// sur la fiche »). Mêmes champs que DevisArchive de devis.tsx — on ne lit que ceux-ci.
interface DevisC {
  id: string; dateFr: string; statut?: "enregistre" | "envoye" | "accepte";
  dateEnvoiFr?: string; dateRelanceFr?: string; dateAcceptationFr?: string;
  resume?: { numOffre?: string; commercial?: string; nbChassis?: number; loyerMensuelHT?: number; duree?: number };
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

/* ————— Scorecard Plan de vente U'mob, version téléphone (7 critères du
   référentiel fourni par Corentin : accueil, découverte flotte & coûts,
   décisionnaire, comparatif, jamais le prix avant les 4 validations,
   objections sans confrontation, prochaine étape datée). Notée 0/1/2 par
   l'IA sur chaque appel — jamais déduite localement. ————— */
const CRITERES: [string, string][] = [
  ["accueil", "1. Accueil & cadre de l'appel"],
  ["decouverte", "2. Découverte flotte & coûts"],
  ["decisionnaire", "3. Décisionnaire & timing identifiés"],
  ["comparatif", "4. Comparatif systématique (thermique / concurrent / ancienne génération)"],
  ["prix", "5. Jamais le prix avant les 4 validations (offre / maintenance / produit / 48 mois)"],
  ["objections", "6. Objections sans confrontation"],
  ["prochaineEtape", "7. Prochaine étape datée (qualifier + booker le RDV terrain)"],
];

/* ————— SCORING SOUPLE VERSION TÉLÉPHONE —————
   Chaque appel a un TYPE (prospection à froid / demande entrante / 1er contact /
   suivi / renouvellement) détecté automatiquement depuis le sens de l'appel et
   le résumé IA. Un critère NON APPLICABLE au type d'appel passe N/A (note -1) :
   il est EXCLU de la moyenne — jamais compté 0 (un suivi de 1 min n'est pas
   noté sur la découverte). Le manager peut ajuster chaque note d'un clic
   (0 → 1 → 2 → N/A) : son jugement prime sur l'IA. */
type TypeAppel = "prospection" | "entrant" | "premier" | "suivi" | "renouvellement";
type NoteFlexible = 0 | 1 | 2 | -1; // -1 = N/A

const TYPE_LABEL: Record<TypeAppel, string> = {
  prospection: "🧭 Prospection à froid",
  entrant: "📥 Demande entrante",
  premier: "📞 1er contact",
  suivi: "🔁 Suivi",
  renouvellement: "🔄 Renouvellement",
};

const typeAuto = (a: ActiviteC): TypeAppel => {
  const t = ((a.resumeIA || "") + " " + (a.sujets || "") + " " + (a.texte || "")).toLowerCase();
  const sens = (a.directionAppel || "").toLowerCase();
  if (/renouvel|fin de contrat/.test(t)) return "renouvellement";
  if (/suivi|rappel|confirmons|comme convenu|vérifie|verifie/.test(t)) return "suivi";
  if (sens.includes("entrant") || /demande de|nous appelle|il nous contacte|suite à|suite au|vu votre|recommandation/.test(t)) return "entrant";
  if (/premier contact|prise de contact|nous nous présentons|prospection/.test(t)) return "prospection";
  return "premier";
};

/* Applicabilité des critères selon le type d'appel. */
const APPLICABILITE: Record<TypeAppel, Record<string, boolean>> = {
  prospection: { accueil: true, decouverte: true, decisionnaire: true, comparatif: true, prix: true, objections: true, prochaineEtape: true },
  entrant: { accueil: true, decouverte: true, decisionnaire: true, comparatif: true, prix: true, objections: true, prochaineEtape: true },
  premier: { accueil: true, decouverte: true, decisionnaire: true, comparatif: true, prix: true, objections: true, prochaineEtape: true },
  suivi: { accueil: true, decouverte: false, decisionnaire: false, comparatif: false, prix: true, objections: true, prochaineEtape: true },
  renouvellement: { accueil: true, decouverte: true, decisionnaire: true, comparatif: false, prix: true, objections: true, prochaineEtape: true },
};

/* Le prix : N/A s'il n'est pas abordé dans l'appel (souplesse téléphone). */
const prixAborde = (a: ActiviteC) => /prix|€|euros|loyer|par mois|combien/i.test((a.sujets || "") + " " + (a.transcription || ""));

/* Ajustements du manager, persistés dans le navigateur (clé par appel). */
const CLE_ADJ = "umob-console-ajustements";
type Ajustements = Record<string, Record<string, NoteFlexible>>; // { cléAppel: { critère: note } }
const cleAppel = (a: ActiviteC) => a.appelId || a.texte || (a.dateISO || "") + (a.heure || "");
const lireAjustements = (): Ajustements => { try { return JSON.parse(localStorage.getItem(CLE_ADJ) || "{}"); } catch { return {}; } };

const noteEffective = (a: ActiviteC, cle: string, adj?: Ajustements): NoteFlexible => {
  const aj = adj?.[cleAppel(a)]?.[cle];
  if (aj !== undefined) return aj;
  return ((a.scorecard?.[cle]?.note ?? 0) as NoteFlexible);
};
const estApplicable = (a: ActiviteC, cle: string, adj?: Ajustements): boolean => {
  if (noteEffective(a, cle, adj) === -1) return false; // N/A posé par le manager
  if (!APPLICABILITE[typeAuto(a)][cle]) return false; // N/A par type d'appel
  if (cle === "prix" && !prixAborde(a)) return false; // prix non abordé → N/A
  return true;
};
/* Score d'un appel : moyenne /2 sur les seuls critères applicables. */
const scoreFlexible = (a: ActiviteC, adj?: Ajustements): number | null => {
  const notes = CRITERES.filter(([k]) => estApplicable(a, k, adj)).map(([k]) => noteEffective(a, k, adj));
  if (!notes.length) return null;
  return Math.round((notes.reduce((x, y) => x + y, 0) / notes.length) * 10) / 10;
};
const etoilesFlexibles = (a: ActiviteC, adj?: Ajustements) => {
  if (!a.scorecard) return a.scoreIA ?? null;
  const sc = scoreFlexible(a, adj);
  return sc === null ? (a.scoreIA ?? null) : Math.max(0, Math.min(5, Math.round((sc / 2) * 5)));
};
const EtoilesFlex = ({ a, adj }: { a: ActiviteC; adj?: Ajustements }) => {
  const n = etoilesFlexibles(a, adj);
  return n == null ? null : <Etoiles score={n} />;
};
const BadgeType = ({ a }: { a: ActiviteC }) => (
  <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[9.5px] font-bold text-slate-500">{TYPE_LABEL[typeAuto(a)]}</span>
);

/* ————— GRILLE DE SCORING (onglet, visible manager ET collaborateurs) ————— */
const GRILLE: { type: TypeAppel; titre: string; sous: string; lignes: [string, string][] }[] = [
  {
    type: "prospection", titre: "🧭 Prospection à froid", sous: "Sortant vers un suspect qui ne connaît pas U'mob — objectif : qualifier + booker le RDV terrain.",
    lignes: [
      ["1. Accueil & cadre", "Bris de glace, présentation U'mob et du motif clairement dès l'ouverture."],
      ["2. Découverte flotte & coûts", "Tentative de découverte même brève : nb scooters, essence €/mois, pannes. Si le client coupe, l'effort compte."],
      ["3. Décisionnaire & timing", "Avoir le bon interlocuteur OU identifier qui décide."],
      ["4. Comparatif systématique", "N/A possible : si la flotte n'a pas pu être identifiée au téléphone, ce critère ne peut pas être honoré — pas de punition."],
      ["5. Jamais le prix avant les 4 validations", "Règle d'or. N/A si le prix n'est pas abordé dans l'appel."],
      ["6. Objections sans confrontation", "« Pas intéressé / on a déjà » traités par questions, jamais frontalement."],
      ["7. Prochaine étape datée", "⭐ LA mesure de réussite : RDV ou rappel daté (« mardi 10 h ») = 2 · vague = 1 · rien = 0."],
    ],
  },
  {
    type: "entrant", titre: "📥 Demande entrante", sous: "Le client appelle (site, démo, recommandation) — il a déjà le besoin.",
    lignes: [
      ["1. Accueil & cadre", "On ne « présente » pas U'mob à froid : réponse rapide, on ne fait pas répéter, on remercie du contact."],
      ["2. Découverte flotte & coûts", "⭐ Reformuler le besoin AVANT de répondre : « vous livrez sur quel périmètre, combien par jour ? »"],
      ["3. Décisionnaire & timing", "Souvent acquis (c'est le décideur qui appelle) — noté 2 facilement, c'est normal."],
      ["4. Comparatif systématique", "Adapté à SA situation réelle : son thermique, son loueur actuel."],
      ["5. Prix — règle spéciale entrants", "Le client demande souvent le prix d'emblée. Fourchette APRÈS cadrage = 2 · fourchette immédiate sans découverte = 1 · prix précis + remise sans validation = 0."],
      ["6. Objections sans confrontation", "Reformulation sans confrontation."],
      ["7. Prochaine étape datée", "RDV terrain ou relevé de flotte daté."],
    ],
  },
  {
    type: "suivi", titre: "🔁 Suivi", sous: "Rappel convenu, vérification devis… souvent court.",
    lignes: [
      ["1. Accueil & cadre", "Rappel fait comme promis = bon accueil."],
      ["2. Découverte flotte & coûts", "N/A — un suivi de 1 min n'est pas noté sur la découverte."],
      ["3. Décisionnaire & timing", "N/A."],
      ["4. Comparatif systématique", "N/A."],
      ["5. Jamais le prix avant les 4 validations", "Noté seulement si le prix est abordé dans l'appel — N/A sinon."],
      ["6. Objections sans confrontation", "Traitement calme des blocages éventuels."],
      ["7. Prochaine étape datée", "⭐ Dater ferme le prochain pas."],
    ],
  },
  {
    type: "renouvellement", titre: "🔄 Renouvellement", sous: "Client équipé, fin de contrat.",
    lignes: [
      ["1. Accueil & cadre", "Ton de proximité adapté à un client existant."],
      ["2. Découverte flotte & coûts", "Orientée satisfaction : « ça tourne bien ? des pannes ? »"],
      ["3. Décisionnaire & timing", "Souvent déjà connu — facile 2."],
      ["4. Comparatif systématique", "N/A — pas besoin de convaincre un client équipé."],
      ["5. Jamais le prix avant les 4 validations", "Règle d'or. N/A si le prix n'est pas abordé."],
      ["6. Objections sans confrontation", "Sans confrontation."],
      ["7. Prochaine étape datée", "Devis de renouvellement daté."],
    ],
  },
  {
    type: "premier", titre: "📞 1er contact (hors prospection à froid)", sous: "Premier échange convenu ou chaleureux avec un prospect identifié.",
    lignes: [
      ["1. Accueil & cadre", "Cadre posé, motif annoncé."],
      ["2. Découverte flotte & coûts", "Flotte, usage, coûts actuels interrogés."],
      ["3. Décisionnaire & timing", "Qui décide, pour quand."],
      ["4. Comparatif systématique", "Thermique / concurrent / ancienne génération selon le cas."],
      ["5. Jamais le prix avant les 4 validations", "Règle d'or. N/A si le prix n'est pas abordé."],
      ["6. Objections sans confrontation", "Reformulation, anti-vente si besoin."],
      ["7. Prochaine étape datée", "⭐ Qualifier + booker le RDV terrain."],
    ],
  },
];

function Grille() {
  const [ouvert, setOuvert] = useState<TypeAppel | null>("entrant");
  return (
    <div className="space-y-4">
      <Card>
        <div className="text-sm font-bold text-slate-800 mb-1">📚 Grille de scoring — les critères selon le type d'appel</div>
        <div className="text-xs text-slate-600 leading-relaxed">
          Chaque appel est noté sur les critères <b>applicables à son type uniquement</b> (0 / 1 / 2, ou N/A). Les critères non applicables ne comptent JAMAIS dans la moyenne — au téléphone, un suivi de 1 min ne se juge pas comme une découverte de 20 min. Le manager peut ajuster toute note d'un clic : son jugement prime sur l'IA.
        </div>
      </Card>
      {GRILLE.map((g) => (
        <Card key={g.type}>
          <button onClick={() => setOuvert(ouvert === g.type ? null : g.type)} className="flex w-full items-center gap-2 text-left">
            <span className="text-sm font-bold text-slate-800">{g.titre}</span>
            <span className="ml-auto text-slate-400">{ouvert === g.type ? "▾" : "▸"}</span>
          </button>
          {ouvert === g.type && (
            <>
              <div className="mt-1 text-[11px] text-slate-500">{g.sous}</div>
              <div className="mt-2 space-y-1">
                {g.lignes.map(([c, dd], i) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-[11px]">
                    <span className={"shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-bold " + (dd.startsWith("N/A") ? "bg-slate-200 text-slate-500" : "bg-cyan-50 text-cyan-700")}>{dd.startsWith("N/A") ? "N/A" : "noté"}</span>
                    <span className="text-slate-700"><b>{c}</b>{dd.startsWith("N/A") ? "" : <span className="text-slate-500"> — {dd}</span>}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      ))}
      <Card>
        <div className="text-sm font-bold mb-1">⚖️ Règles transversales (tous types)</div>
        <div className="space-y-1 text-[11px] text-slate-600">
          <div className="rounded-lg bg-slate-50 px-3 py-1.5">Prix non abordé dans l'appel → critère 5 = N/A, jamais 0.</div>
          <div className="rounded-lg bg-slate-50 px-3 py-1.5">Score global = moyenne des seuls critères applicables.</div>
          <div className="rounded-lg bg-slate-50 px-3 py-1.5">Type d'appel détecté automatiquement (sens de l'appel + analyse IA), ajustable par le manager.</div>
          <div className="rounded-lg bg-slate-50 px-3 py-1.5">Chaque note est cliquable dans une conversation : 0 → 1 → 2 → N/A. Badge « ✎ ajusté » quand le manager contredit l'IA.</div>
        </div>
      </Card>
    </div>
  );
}


/* ————— Outils dates (dateISO = jj/mm/aaaa) ————— */
const cleDate = (d?: string): number => {
  if (!d) return 0;
  const p = d.trim().split(/[/\-]/).map(Number);
  if (p.length !== 3 || p.some(Number.isNaN)) return 0;
  return p[0] > 1000 ? p[0] * 10000 + p[1] * 100 + p[2] : p[2] * 10000 + p[1] * 100 + p[0];
};
const aujourdhui = () => { const p = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }).split("-").map(Number); return p[0] * 10000 + p[1] * 100 + p[2]; }; // heure de Paris
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
function Brief({ d, etat }: { d: ReturnType<typeof construire>; etat: EtatConsole }) {
  // Devis consolidés depuis les fiches entreprises (pour la synthèse + la carte relances).
  const AUJ = aujourdhui();
  const cleD = (t?: string) => { const m = (t || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) : 0; };
  const devis = etat.entreprises.flatMap((e) => (e.devisHistorique || []).map((dv) => ({ e, dv })));
  const stD = (x: { dv: DevisC }) => x.dv.statut || "enregistre";
  const devisEnvoyes = devis.filter((x) => stD(x) === "envoye");
  const devisAcceptes = devis.filter((x) => stD(x) === "accepte");
  const devisRetard = devisEnvoyes.filter((x) => x.dv.dateRelanceFr && cleD(x.dv.dateRelanceFr) <= AUJ);
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
              {devis.length > 0 ? <> {" "}<span className="bg-cyan-50 px-1 rounded">Côté devis : <b>{devisEnvoyes.length}</b> en cours chez le client, dont <b className="text-rose-600">{devisRetard.length}</b> à RELANCER{devisAcceptes.length > 0 ? ", " + devisAcceptes.length + " accepté" + (devisAcceptes.length > 1 ? "s" : "") + " 🎉" : ""}.</span></> : null}
            </>
          )}
        </div>
      </Card>
      {devisRetard.length > 0 && (
        <Card className="border-rose-200 bg-rose-50">
          <div className="font-semibold text-rose-700 mb-2 text-sm">🧾 Devis à relancer ({devisRetard.length})</div>
          {devisRetard.map(({ e, dv }) => (
            <div key={dv.id} className="rounded-lg bg-white/70 px-3 py-2 mb-1 text-xs">
              <b>{e.nomCommercial || e.nom}</b> — devis n° {dv.resume?.numOffre || "—"} · relance due le {dv.dateRelanceFr} · <span className="font-bold text-rose-700">{(dv.resume?.loyerMensuelHT || 0).toLocaleString("fr-FR")} € HT/mois en jeu</span>
            </div>
          ))}
        </Card>
      )}
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
function Conversations({ d, ajustements, onAjuste }: { d: ReturnType<typeof construire>; ajustements: Ajustements; onAjuste: (a: ActiviteC, cle: string, note: NoteFlexible) => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const filtres = d.appels.filter(({ entreprise, a }) => {
    const s = (q || "").toLowerCase();
    return !s || (entreprise.nom + " " + (a.resumeIA || "") + " " + (a.sujets || "") + " " + (a.transcription || "") + " " + a.texte).toLowerCase().includes(s);
  });
  const actif = filtres.find((x) => x.a.appelId === sel || (!x.a.appelId && x.a.texte === sel)) || null;
  const cycleNote = (n: NoteFlexible): NoteFlexible => (n === 0 ? 1 : n === 1 ? 2 : n === 2 ? -1 : 0);
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
                {<EtoilesFlex a={a} adj={ajustements} />}
              <BadgeType a={a} />
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
              <div className="text-[11px] text-slate-400">{actif.a.date} {actif.a.heure || ""} · {d.contactDe(actif.entreprise.id) || "contact à qualifier"} · {(actif.entreprise.ville || "ville à qualifier")}</div>
            </div>
            <div className="flex items-center gap-2">
              {badgeSentiment(actif.a.sentiment)}
              {<EtoilesFlex a={actif.a} adj={ajustements} />}
              {actif.a.scorecard && <BadgeType a={actif.a} />}
              {actif.a.urlEnregistrement && <a href={actif.a.urlEnregistrement} target="_blank" rel="noreferrer" className="rounded-full bg-cyan-600 px-3 py-1 text-[11px] font-bold text-white">▶️ Enregistrement</a>}
            </div>
          </div>
          {(actif.a.resumeIA || actif.a.sujets) && (
            <div className="mt-3 rounded-xl bg-cyan-50/70 p-3">
              {actif.a.resumeIA && <><div className="text-[10px] font-bold uppercase tracking-wider text-cyan-800">✨ Résumé IA</div><p className="text-xs text-slate-700 mt-0.5">{actif.a.resumeIA}</p></>}
              {actif.a.sujets && <div className="text-[11px] text-cyan-800 mt-1.5">🧩 Sujets / signaux détectés : {actif.a.sujets}</div>}
              {actif.a.scorecard && (
                <div className="mt-2 rounded-lg bg-white/80 p-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-800 mb-1.5">📋 Scorecard Plan de vente U'mob — version téléphone (notes cliquables, N/A exclus)</div>
const SCORECARD_NOUVEAU = `                  <div className="mb-2 flex items-start gap-2 rounded-lg bg-cyan-50 px-2.5 py-1.5 text-[10.5px]">
                    <span>🔎 <b>Type d'appel analysé :</b> {TYPE_LABEL[typeAuto(actif.a)]}</span>
                    <span className="ml-auto font-bold text-slate-500">{CRITERES.filter(([k]) => estApplicable(actif.a, k, ajustements)).length} critères notés · les autres N/A (exclus)</span>
                  </div>
                  <div className="space-y-1">
                    {CRITERES.filter(([k]) => estApplicable(actif.a, k, ajustements)).map(([k, l]) => {
                      const eff = noteEffective(actif.a, k, ajustements);
                      const ia = actif.a.scorecard?.[k]?.note;
                      const cAdj = ajustements[cleAppel(actif.a)]?.[k];
                      const ajuste = cAdj !== undefined && cAdj !== ia;
                      const jj = actif.a.scorecard?.[k]?.j;
                      return (
                        <div key={k} className="flex items-start gap-2 text-[10.5px]">
                          <button title="Cliquer pour ajuster : 0 → 1 → 2 → N/A (ton jugement prime sur l'IA)" onClick={() => onAjuste(actif.a, k, cycleNote(eff))} className="shrink-0 transition-transform hover:scale-110">
                            <span className={"rounded px-1.5 py-0.5 font-bold " + (eff === -1 ? "bg-slate-100 text-slate-400" : eff === 2 ? "bg-emerald-100 text-emerald-700" : eff === 1 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700")}>{eff === -1 ? "N/A" : eff + "/2"}</span>
                          </button>
                          <span className="text-slate-600"><b>{l}</b>{ajuste && <span className="ml-1 text-[9px] font-bold text-amber-600">✎ ajusté</span>}{jj ? <span className="text-slate-400"> — {jj}</span> : null}</span>
                        </div>
                      );
                    })}
                    {CRITERES.filter(([k]) => estApplicable(actif.a, k, ajustements)).length === 0 && (
                      <div className="text-[10.5px] text-slate-400">Aucun critère applicable à ce type d'appel — rien d'autre à noter.</div>
                    )}
                  </div>`;
                </div>
              )}
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
                <span className="text-slate-400">{z.nb} société{z.nb > 1 ? "s" : ""} · {z.appels} appel{z.appels > 1 ? "s" : ""}</span>
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
function Coaching({ d, ajustements }: { d: ReturnType<typeof construire>; ajustements: Ajustements }) {
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
        <div className="text-sm font-semibold mb-1">📋 Scorecard par critère — uniquement les appels où le critère s’applique (N/A exclus)</div>
        {(() => {
          const avecSc = d.analyses.filter((x) => x.a.scorecard);
          if (!avecSc.length) return <div className="text-xs text-slate-400">Aucun appel encore scoré sur les 7 critères. Chaque appel analysé par le webhook (ou via ✨↻ Régénérer) reçoit sa scorecard 0-2 automatiquement.</div>;
          return (
            <div className="space-y-1.5">
              {CRITERES.map(([k, l]) => {
                const notes = avecSc.filter((x) => estApplicable(x.a, k, ajustements)).map((x) => noteEffective(x.a, k, ajustements)).filter((n) => n !== -1);
                const moy = notes.length ? notes.reduce((a: number, b: number) => a + b, 0) / notes.length : 0;
                const pct = Math.round((moy / 2) * 100);
                return (
                  <div key={k}>
                    <div className="flex justify-between text-[11px] mb-0.5"><span className="font-medium text-slate-700">{l}</span><span className="text-slate-400">{Math.round(moy * 10) / 10}/2 · {notes.length} appel{notes.length > 1 ? "s" : ""}</span></div>
                    <div className="h-2 rounded bg-slate-100"><div className={"h-2 rounded " + (pct >= 75 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-400" : "bg-rose-400")} style={{ width: pct + "%" }} /></div>
                  </div>
                );
              })}
            </div>
          );
        })()}
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

/* ═══════════════════ DEVIS — consolidation de suivi des devis ═══════════════════ */
// Vue manager : une ligne par devis archivé dans le CRM, consolidée par statut
// et par commercial. Priorité absolue aux RELANCES DUES (tâche « Relancer le
// devis n° … » à échéance passée) — rouge = en retard, orange = sous 3 jours.
function DevisVue({ d, etat }: { d: ReturnType<typeof construire>; etat: EtatConsole }) {
  const [filtre, setFiltre] = useState<"tous" | "retard" | "semaine" | "envoye" | "accepte" | "enregistre">("tous");
  const AUJ = aujourdhui();
  // « jj/mm/aaaa » ou « jj/mm/aaaa à hh:mm » → clé comparable (robuste aux heures ajoutées en 58bis).
  const cle = (t?: string) => { const m = (t || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) : 0; };
  const eur = (n?: number) => (n || 0).toLocaleString("fr-FR") + " € HT/mois";
  // Tous les devis archivés du CRM, rattachés à leur entreprise porteuse.
  const tous = etat.entreprises.flatMap((e) => (e.devisHistorique || []).map((dv) => ({ e, dv })));
  const st = (x: { dv: DevisC }) => x.dv.statut || "enregistre";
  const envoyes = tous.filter((x) => st(x) === "envoye");
  const acceptes = tous.filter((x) => st(x) === "accepte");
  const brouillons = tous.filter((x) => st(x) === "enregistre");
  const enRetard = envoyes.filter((x) => x.dv.dateRelanceFr && cle(x.dv.dateRelanceFr) <= AUJ);
  const bientot = envoyes.filter((x) => x.dv.dateRelanceFr && cle(x.dv.dateRelanceFr) > AUJ && cle(x.dv.dateRelanceFr) <= AUJ + 3);
  const semaine = envoyes.filter((x) => x.dv.dateRelanceFr && cle(x.dv.dateRelanceFr) > AUJ && cle(x.dv.dateRelanceFr) <= AUJ + 7);
  const pipe = envoyes.reduce((t, x) => t + (x.dv.resume?.loyerMensuelHT || 0), 0);
  const gagne = acceptes.reduce((t, x) => t + (x.dv.resume?.loyerMensuelHT || 0), 0);

  const BADGE: Record<string, { txt: string; cls: string }> = {
    enregistre: { txt: "💾 Enregistré", cls: "bg-amber-100 text-amber-700" },
    envoye: { txt: "✅ Envoyé", cls: "bg-sky-100 text-sky-700" },
    accepte: { txt: "🎉 Accepté", cls: "bg-emerald-100 text-emerald-700" },
  };

  const liste = tous.filter((x) => {
    if (filtre === "tous") return true;
    if (filtre === "retard") return enRetard.includes(x);
    if (filtre === "semaine") return semaine.includes(x);
    return st(x) === filtre;
  }).sort((a, b) => {
    // Tri par urgence : relances échues d'abord (plus ancienne d'abord), puis à venir, puis le reste.
    const ur = (x: { dv: DevisC }) => { const c = cle(x.dv.dateRelanceFr); return st(x) === "envoye" && c ? c : 99999999; };
    return ur(a) - ur(b);
  });

  // Charge par commercial (source : champ « commercial » du devis).
  const comms = Array.from(new Set(tous.map((x) => x.dv.resume?.commercial || "—")));
  const parComm = comms.map((c) => {
    const l = tous.filter((x) => (x.dv.resume?.commercial || "—") === c);
    return { c, total: l.length, envoyes: l.filter((x) => st(x) === "envoye").length, acceptes: l.filter((x) => st(x) === "accepte").length,
      retard: l.filter((x) => st(x) === "envoye" && x.dv.dateRelanceFr && cle(x.dv.dateRelanceFr) <= AUJ).length,
      pipe: l.filter((x) => st(x) === "envoye").reduce((t, x) => t + (x.dv.resume?.loyerMensuelHT || 0), 0),
      gagne: l.filter((x) => st(x) === "accepte").reduce((t, x) => t + (x.dv.resume?.loyerMensuelHT || 0), 0) };
  });

  const FILTRES: [typeof filtre, string, number][] = [
    ["tous", "Tous", tous.length], ["retard", "🔴 À relancer", enRetard.length],
    ["semaine", "🗓️ Cette semaine", semaine.length], ["envoye", "✅ Envoyés", envoyes.length],
    ["accepte", "🎉 Acceptés", acceptes.length], ["enregistre", "💾 Brouillons", brouillons.length],
  ];

  if (tous.length === 0) return (
    <Card>
      <div className="text-sm font-semibold text-slate-700 mb-1">🧾 Devis</div>
      <div className="text-xs text-slate-400">Aucun devis archivé pour l'instant. Sauvegarde un devis depuis le module Devis (« 💾 Sauvegarder sur la fiche entreprise ») : il apparaîtra ici avec son statut, sa date d'envoi et sa date de relance.</div>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card><div className="text-xs text-slate-500">Envoyés en cours</div><div className="text-xl font-bold text-sky-700">{envoyes.length}</div><div className="text-[10px] text-slate-400">{eur(pipe)}</div></Card>
        <Card><div className="text-xs text-slate-500">À relancer (échéance due)</div><div className={"text-xl font-bold " + (enRetard.length > 0 ? "text-rose-600" : "text-slate-400")}>{enRetard.length}</div><div className="text-[10px] text-slate-400">dont {bientot.length} sous 3 jours</div></Card>
        <Card><div className="text-xs text-slate-500">Relances cette semaine</div><div className="text-xl font-bold text-amber-600">{semaine.length}</div><div className="text-[10px] text-slate-400">échéances à venir ≤ 7 j</div></Card>
        <Card><div className="text-xs text-slate-500">Acceptés 🎉</div><div className="text-xl font-bold text-emerald-700">{acceptes.length}</div><div className="text-[10px] text-slate-400">{eur(gagne)}</div></Card>
        <Card><div className="text-xs text-slate-500">Brouillons jamais envoyés</div><div className="text-xl font-bold text-slate-500">{brouillons.length}</div><div className="text-[10px] text-slate-400">à finaliser</div></Card>
      </div>

      {enRetard.length > 0 && (
        <Card className="border-rose-200 bg-rose-50">
          <div className="text-sm font-bold text-rose-700 mb-1.5">🔴 {enRetard.length} relance{enRetard.length > 1 ? "s" : ""} en retard — priorité du jour</div>
          <div className="flex flex-wrap gap-1.5">
            {enRetard.map(({ e, dv }) => (
              <span key={dv.id} className="rounded-lg border border-rose-200 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700">
                {e.nomCommercial || e.nom} · n° {dv.resume?.numOffre || "—"} · due le {dv.dateRelanceFr} · {eur(dv.resume?.loyerMensuelHT)}
              </span>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="flex gap-1.5 flex-wrap mb-3">
          {FILTRES.map(([k, l, n]) => (
            <button key={k} onClick={() => setFiltre(k)}
              className={"rounded-full px-3 py-1 text-[11px] font-bold transition-colors " + (filtre === k ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
              {l} <span className="opacity-60">{n}</span>
            </button>
          ))}
        </div>
        <div className="space-y-1.5">
          {liste.length === 0 && <div className="py-4 text-center text-xs text-slate-400">Aucun devis dans cette vue.</div>}
          {liste.map(({ e, dv }) => {
            const retard = st({ dv }) === "envoye" && dv.dateRelanceFr && cle(dv.dateRelanceFr) <= AUJ;
            const urgence = st({ dv }) === "envoye" && dv.dateRelanceFr && cle(dv.dateRelanceFr) <= AUJ + 3 && cle(dv.dateRelanceFr) > AUJ;
            const b = BADGE[st({ dv })] || BADGE.enregistre;
            return (
              <div key={dv.id} className={"flex flex-wrap items-center gap-2 rounded-xl border p-2.5 text-xs " + (retard ? "border-rose-200 bg-rose-50" : urgence ? "border-amber-200 bg-amber-50/60" : "border-slate-200")}>
                <div className="min-w-[150px] flex-1">
                  <div className="font-bold text-slate-800">{e.nomCommercial || e.nom}</div>
                  <div className="text-[10px] font-semibold text-slate-400">{e.ville || "ville à qualifier"} · {dv.resume?.commercial || "—"}</div>
                </div>
                <span className="font-bold text-slate-500">{dv.resume?.numOffre || "Devis"}</span>
                <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold " + b.cls}>{b.txt}</span>
                <span className="font-semibold text-slate-700">{dv.resume?.nbChassis ?? "?"} scoot. · <span className="text-emerald-600 font-bold">{eur(dv.resume?.loyerMensuelHT)}</span></span>
                <span className="text-[10.5px] text-slate-500">{dv.dateEnvoiFr ? "envoyé le " + dv.dateEnvoiFr : "pas encore envoyé"}</span>
                {st({ dv }) === "envoye" && dv.dateRelanceFr && (
                  <span className={"rounded-lg px-2 py-0.5 text-[10.5px] font-bold " + (retard ? "bg-rose-600 text-white" : urgence ? "bg-amber-500 text-white" : "bg-violet-100 text-violet-700")}>
                    {retard ? "🔴 Relancer !" : urgence ? "🟠 Bientôt" : "🗓️"} {dv.dateRelanceFr}
                  </span>
                )}
                {st({ dv }) === "accepte" && dv.dateAcceptationFr && <span className="text-[10.5px] font-bold text-emerald-600">accepté le {dv.dateAcceptationFr}</span>}
              </div>
            );
          })}
        </div>
      </Card>

      {parComm.length > 1 && (
        <Card>
          <div className="text-sm font-semibold mb-2">👤 Charge par commercial</div>
          <div className="grid gap-2 md:grid-cols-2">
            {parComm.map((p) => (
              <div key={p.c} className="rounded-xl border border-slate-200 p-2.5 text-xs">
                <div className="font-bold text-slate-800">{p.c}</div>
                <div className="mt-1 flex justify-between text-[11px] text-slate-500">
                  <span>✅ {p.envoyes} envoyés{p.retard > 0 ? <span className="text-rose-600 font-bold"> (🔴{p.retard} en retard)</span> : ""}</span>
                  <span>🎉 {p.acceptes} acceptés</span>
                </div>
                <div className="mt-0.5 flex justify-between text-[10px] font-semibold">
                  <span className="text-sky-600">Pipe : {eur(p.pipe)}</span>
                  <span className="text-emerald-600">Gagné : {eur(p.gagne)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ═══════════════════ STATS DES DEVIS GÉNÉRÉS ═══════════════════ */
// Photographie du pipe devis : taux de concrétisation, délai moyen
// d'acceptation, panier moyen, volume du mois, répartition des statuts et
// top villes. Règle anti-invention : pas de statut « perdu » sur les devis,
// le taux se lit « part des devis envoyés qui ont abouti ».
function StatsDevis({ etat }: { etat: EtatConsole }) {
  const AUJ = aujourdhui();
  const cle = (t?: string) => { const m = (t || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) : 0; };
  const enJours = (t?: string) => { const m = (t || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) / 86400000 : 0; };
  const eur = (n?: number) => (n || 0).toLocaleString("fr-FR") + " € HT/mois";
  const tous = etat.entreprises.flatMap((e) => (e.devisHistorique || []).map((dv) => ({ e, dv })));
  const st = (x: { dv: DevisC }) => x.dv.statut || "enregistre";
  const envoyes = tous.filter((x) => st(x) === "envoye");
  const acceptes = tous.filter((x) => st(x) === "accepte");
  const brouillons = tous.filter((x) => st(x) === "enregistre");
  const parts = envoyes.length + acceptes.length; // devis réellement envoyés au client
  const taux = parts > 0 ? Math.round((acceptes.length / parts) * 100) : 0;
  const delais = acceptes.filter((x) => x.dv.dateEnvoiFr && x.dv.dateAcceptationFr).map((x) => Math.max(0, Math.round(enJours(x.dv.dateAcceptationFr) - enJours(x.dv.dateEnvoiFr))));
  const delaiMoyen = delais.length ? Math.round(delais.reduce((a, b) => a + b, 0) / delais.length) : null;
  const loyers = tous.map((x) => x.dv.resume?.loyerMensuelHT || 0);
  const panier = loyers.length ? Math.round(loyers.reduce((a, b) => a + b, 0) / loyers.length) : 0;
  const mois = Math.floor(AUJ / 100); // aaaamm courant
  const duMois = tous.filter((x) => Math.floor(cle(x.dv.dateFr) / 100) === mois);
  const villes = new Map<string, { nb: number; pipe: number }>();
  envoyes.forEach(({ e, dv }) => { const v = (e.ville || "").trim() || "Ville à qualifier"; const z = villes.get(v) || { nb: 0, pipe: 0 }; z.nb++; z.pipe += dv.resume?.loyerMensuelHT || 0; villes.set(v, z); });
  const topVilles = [...villes.entries()].sort((a, b) => b[1].pipe - a[1].pipe).slice(0, 5);
  const total = tous.length;

  return (
    <Card>
      <div className="text-sm font-semibold mb-1">📈 Stats des devis générés</div>
      {total === 0 ? <div className="text-xs text-slate-400">Aucun devis archivé pour l'instant — les statistiques se rempliront dès le premier devis sauvegardé sur une fiche entreprise.</div> : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl bg-slate-50 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Taux de concrétisation</div>
              <div className="text-lg font-bold text-emerald-700">{taux}%</div>
              <div className="text-[10px] text-slate-400">{acceptes.length} accepté{acceptes.length > 1 ? "s" : ""} / {parts} envoyé{parts > 1 ? "s" : ""}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Délai moyen d'acceptation</div>
              <div className="text-lg font-bold text-cyan-700">{delaiMoyen == null ? "—" : delaiMoyen + " j"}</div>
              <div className="text-[10px] text-slate-400">{delaiMoyen == null ? "aucun devis accepté pour l'instant" : "envoi → acceptation"}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Panier moyen</div>
              <div className="text-lg font-bold text-slate-800">{panier.toLocaleString("fr-FR")} €</div>
              <div className="text-[10px] text-slate-400">loyer HT/mois par devis</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Volume du mois</div>
              <div className="text-lg font-bold text-sky-700">{duMois.length}</div>
              <div className="text-[10px] text-slate-400">{eur(duMois.reduce((t, x) => t + (x.dv.resume?.loyerMensuelHT || 0), 0))}</div>
            </div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-slate-600 mb-1">Répartition des statuts</div>
            <div className="flex h-4 overflow-hidden rounded-lg">
              {brouillons.length > 0 && <div style={{ width: (brouillons.length / total) * 100 + "%", background: "#fbbf24" }} title={"Brouillons : " + brouillons.length} />}
              {envoyes.length > 0 && <div style={{ width: (envoyes.length / total) * 100 + "%", background: "#0ea5e9" }} title={"Envoyés : " + envoyes.length} />}
              {acceptes.length > 0 && <div style={{ width: (acceptes.length / total) * 100 + "%", background: "#10b981" }} title={"Acceptés : " + acceptes.length} />}
            </div>
            <div className="mt-1 flex gap-3 flex-wrap">
              <span className="flex items-center gap-1 text-[10px] text-slate-500"><span className="h-2 w-2 rounded-sm" style={{ background: "#fbbf24" }} />Brouillons : {brouillons.length}</span>
              <span className="flex items-center gap-1 text-[10px] text-slate-500"><span className="h-2 w-2 rounded-sm" style={{ background: "#0ea5e9" }} />Envoyés : {envoyes.length}</span>
              <span className="flex items-center gap-1 text-[10px] text-slate-500"><span className="h-2 w-2 rounded-sm" style={{ background: "#10b981" }} />Acceptés : {acceptes.length}</span>
            </div>
          </div>
          {topVilles.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-slate-600 mb-1">Top villes du pipe (devis envoyés en cours)</div>
              <div className="space-y-1">
                {topVilles.map(([v, z]) => (
                  <div key={v} className="flex justify-between text-[11px]">
                    <span className="text-slate-600 font-medium">{v} <span className="text-slate-400">({z.nb} devis)</span></span>
                    <span className="font-semibold text-sky-700">{eur(z.pipe)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ═══════════════════ CONSOLE (onglets) ═══════════════════ */
export function ConsoleManager({ etat }: { etat: EtatConsole }) {
  const [tab, setTab] = useState("brief");
  const [ajustements, setAjustements] = useState<Ajustements>(() => lireAjustements());
  const ajuster = (a: ActiviteC, cle: string, note: NoteFlexible) => {
    setAjustements((prev) => {
      const c = cleAppel(a);
      const suivant: Ajustements = { ...prev, [c]: { ...(prev[c] || {}), [cle]: note } };
      try { localStorage.setItem(CLE_ADJ, JSON.stringify(suivant)); } catch { /* stockage indisponible : ajustement non persisté */ }
      return suivant;
    });
  };
  const d = useMemo(() => construire(etat), [etat]);
  const onglets = [
    ["brief", "☀️ Brief"], ["conversations", "💬 Conversations"], ["grille", "📚 Grille de scoring"], ["deals", "🎯 Deals"], ["devis", "🧾 Devis"],
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
      {tab === "brief" && <Brief d={d} etat={etat} />}
      {tab === "conversations" && <Conversations d={d} ajustements={ajustements} onAjuste={ajuster} />}
      {tab === "grille" && <Grille />}
      {tab === "deals" && <Deals d={d} etat={etat} />}
      {tab === "devis" && <DevisVue d={d} etat={etat} />}
      {tab === "devis" && <StatsDevis etat={etat} />}
      {tab === "prospection" && <Prospection d={d} etat={etat} />}
      {tab === "coaching" && <Coaching d={d} ajustements={ajustements} />}
      {tab === "insights" && <Insights d={d} />}
    </div>
  );
}
