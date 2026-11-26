// ── /api/sync-clients-complets v6 — POST CSV ────────────────────────────────
// Accepte POST avec le CSV brut de l'onglet « Clients Complets » en body.
//   Content-Type: text/csv  → body = CSV brut
//   ou JSON { "csv": "..." }  ou form-data avec champ "csv"
// GET ?test=etat toujours dispo pour diagnostic.
// ────────────────────────────────────────────────────────────────────────────

// ── Shards Supabase (inline) ─────────────────────────────────────────────────
const SHARD_TAILLE = 1_000_000;
function decouperShards(etat: any) {
  const ents: any[] = Array.isArray(etat?.entreprises) ? etat.entreprises : [];
  const base = { ...etat, entreprises: [] as any[] };
  const shards: { id: string; data: any }[] = [];
  let cur: any[] = [], t = 0, n = 0;
  for (const e of ents) {
    const s = JSON.stringify(e).length;
    if (cur.length && t + s > SHARD_TAILLE) { shards.push({ id: "ent-" + String(n).padStart(4, "0"), data: { entreprises: cur } }); n++; cur = []; t = 0; }
    cur.push(e); t += s;
  }
  if (cur.length) shards.push({ id: "ent-" + String(n).padStart(4, "0"), data: { entreprises: cur } });
  return { base, shards };
}
function baseRest(sup: string) { return sup.replace(/\/+$/, "").replace(/\/rest\/v1$/, ""); }
async function lireEtat(sup: string, cle: string) {
  const base = baseRest(sup);
  const h = { apikey: cle, Authorization: "Bearer " + cle, "Content-Type": "application/json" };
  const r = await fetch(base + "/rest/v1/crm_etat?select=id,data,maj&or=(id.eq.main,id.like.ent-%25)", { headers: h });
  if (!r.ok) throw new Error("lecture " + r.status);
  const rows: any[] = await r.json();
  const main = rows.find((x) => x.id === "main") || rows[0];
  if (!main?.data) throw new Error("main introuvable");
  const etat: any = main.data;
  const vus = new Set<string>(); const ents: any[] = [];
  const ajouter = (liste: any[]) => { for (const e of liste || []) if (e?.id && !vus.has(e.id)) { vus.add(e.id); ents.push(e); } };
  ajouter(etat.entreprises);
  const shards = rows.filter((x) => x.id !== "main" && String(x.id).startsWith("ent-")).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const s of shards) ajouter((s.data || {}).entreprises);
  etat.entreprises = ents;
  return { etat, nbShards: shards.length };
}
async function ecrireEtat(sup: string, cle: string, etat: any) {
  const base = baseRest(sup);
  const h = { apikey: cle, Authorization: "Bearer " + cle, "Content-Type": "application/json" };
  const { base: baseData, shards } = decouperShards(etat);
  const maj = new Date().toISOString();
  const r = await fetch(base + "/rest/v1/crm_etat?id=eq.main", { method: "PATCH", headers: { ...h, Prefer: "return=minimal" }, body: JSON.stringify({ data: baseData, maj }) });
  if (!r.ok) throw new Error("ecriture main " + r.status);
  await Promise.all(shards.map((s) =>
    fetch(base + "/rest/v1/crm_etat", { method: "POST", headers: { ...h, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ id: s.id, data: s.data, maj }) })
      .then((rr) => { if (!rr.ok) throw new Error("shard " + s.id); })
  ));
  const rl = await fetch(base + "/rest/v1/crm_etat?select=id&id=like.ent-%25", { headers: h });
  const exist: any[] = rl.ok ? await rl.json() : [];
  const gards = new Set(shards.map((s) => s.id));
  const stale = exist.map((x) => x.id).filter((id) => !gards.has(id));
  if (stale.length) await fetch(base + '/rest/v1/crm_etat?id=in.("' + stale.join('","') + '")', { method: "DELETE", headers: h });
  return { nbShards: shards.length };
}

// ── CSV ──────────────────────────────────────────────────────────────────────
const parserCSV = (txt: string): string[][] => {
  const lignes: string[][] = []; let cur: string[] = []; let f = ""; let q = false;
  const GL = String.fromCharCode(34);
  for (let i = 0; i < txt.length; i++) { const ch = txt[i];
    if (q) { if (ch === GL) { if (txt[i + 1] === GL) { f += GL; i++; } else q = false; } else f += ch; }
    else if (ch === GL) q = true;
    else if (ch === ",") { cur.push(f); f = ""; }
    else if (ch === "\n") { cur.push(f); lignes.push(cur); cur = []; f = ""; }
    else if (ch !== "\r") f += ch; }
  if (f !== "" || cur.length) { cur.push(f); lignes.push(cur); }
  return lignes;
};
const norme = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const normTel = (t: string) => (t || "").replace(/\D/g, "");
// Un portable (06/07) n'a pas sa place dans « Téléphone entreprise » (règle Corentin :
// le mobile vit sur la fiche contact).
const estMobileFr = (t: string) => { const d = normTel(t || ""); const nat = d.startsWith("33") && d.length === 11 ? "0" + d.slice(2) : d; return nat.length === 10 && nat.charAt(0) === "0" && (nat.charAt(1) === "6" || nat.charAt(1) === "7"); };
const normH = (s: string) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
const MODELE_DEPUIS: [string, string][] = [["infinitypro","Infinity Pro"],["compactpro","Compact Pro"],["dailypro","Daily Pro"]];
const modeleDepuis = (p: string) => { const n = norme(p); const t = MODELE_DEPUIS.find(([k]) => n.includes(k)); return t ? t[1] : ""; };
const normRisque = (s: string) => {
  const n = norme(s); if (!n) return "";
  if (n.includes("bloque") || n.includes("block")) return "Bloqué";
  if (n.includes("defaut") || n.includes("impaye")) return "Impayé";
  if (n.includes("proced") || n.includes("collective") || n.includes("redressement") || n.includes("liquidation")) return "Procédure collective";
  if (n.includes("sommeil") || n.includes("inactif")) return "En sommeil";
  if (n.includes("actif")) return "";
  return s.trim();
};

interface ContratLigne { pack: string; modele: string; num: string; dateDebut: string; dateFin: string; immats: string; etat: string; libelle?: string; locam?: string }
interface ClientSheet {
  code: string; nom: string; ville: string; adresse?: string; cp?: string; siren?: string; statutClient?: string;
  packs: string; dateDebut: string; dateFin: string; nbVehicules: string;
  contrats: string; immats: string; risque: string; modeles: string[];
  lignes: ContratLigne[]; telFixe: string; mobile: string; email: string;
}

function chargerClientsDepuisCSV(csv: string): ClientSheet[] {
  const lignes = parserCSV(csv);
  if (!lignes.length) throw new Error("CSV vide");
  const tete = (lignes[0] || []).map(normH);
  const col = (n: string) => tete.findIndex((h) => h.startsWith(normH(n)));
  const colC = (n: string) => tete.findIndex((h) => h.includes(normH(n)));
  const cCode = col("Code client"), cNom = col("Nom client"), cVille = col("Ville"),
    cSiren = col("SIREN"), cStatutClient = col("Statut client"),
    cAdr = col("Adresse de livraison"),
    cPack = col("Libellé contrat"), cPackCode = col("Code produit"), cLib = col("Libellé contrat"), cLocam = col("N° dossier locam"),
    cProd = colC("libellé produit"), cEtat = col("Etat contrat"), cDd = col("Date début contrat"), cDf = col("Date fin contrat"),
    cNum = col("N° contrat"), cImm = col("Immatriculation"), cRq = col("Risque"),
    cTelFixe = col("Téléphone"), cMobile = col("Mobile"), cMail = col("E-mail"),
    cImp = col("Impayes"), cProc = col("Procedure collective");
  if (cCode < 0 || cNom < 0) throw new Error("Colonnes Code client/Nom client introuvables. Headers=" + JSON.stringify(tete.slice(0, 10)));
  const clients: ClientSheet[] = [];
  const idx = new Map<string, ClientSheet>();
  const prem = new Map<string, number>(); const der = new Map<string, number>();
  const cleDate = (d: string) => { const p = d.trim().split("/").map(Number); return p.length === 3 ? p[2] * 10000 + p[1] * 100 + p[0] : NaN; };
  const p2 = (n: number) => (n < 10 ? "0" : "") + n;
  const fmtDate = (k: number) => p2(k % 100) + "/" + p2(Math.floor(k / 100) % 100) + "/" + Math.floor(k / 10000);
  for (const l of lignes.slice(1)) {
    const g = (i: number) => (i >= 0 && i < l.length ? l[i].trim() : "");
    const code = g(cCode); if (!code) continue;
    // Ignorer les lignes d'exemple (code qui n'est pas C####)
    if (!/^C\d+$/i.test(code)) continue;
    if (!idx.has(code)) {
      const adr = g(cAdr); const mAdr = adr.match(/^(.*?)(\d{5})\s+(.+)$/);
      const c: ClientSheet = {
        code, nom: g(cNom), ville: mAdr ? mAdr[3].trim() : g(cVille),
        adresse: mAdr ? mAdr[1].trim().replace(/,\s*$/, "") : adr, cp: mAdr ? mAdr[2] : "",
        siren: g(cSiren), statutClient: g(cStatutClient),
        packs: "", dateDebut: "", dateFin: "", nbVehicules: "", contrats: "", immats: "",
        risque: "", modeles: [], lignes: [], telFixe: g(cTelFixe), mobile: g(cMobile), email: g(cMail),
      };
      idx.set(code, c); clients.push(c);
    }
    const c = idx.get(code)!;
    const p = g(cPack); if (p && !c.packs.includes(p)) c.packs = c.packs ? c.packs + " · " + p : p;
    const pr = modeleDepuis(g(cProd)); if (pr && !c.modeles.includes(pr)) c.modeles.push(pr);
    c.lignes.push({ pack: g(cPackCode) || g(cPack), modele: pr, num: g(cNum), dateDebut: g(cDd), dateFin: g(cDf), immats: g(cImm), etat: g(cEtat), libelle: g(cLib), locam: g(cLocam) });
    const n = g(cNum); if (n && !c.contrats.includes(n)) c.contrats = c.contrats ? c.contrats + ", " + n : n;
    const im = g(cImm); if (im && !c.immats.includes(im)) c.immats = c.immats ? c.immats + ", " + im : im;
    const kd = cleDate(g(cDd)); if (!Number.isNaN(kd) && (prem.get(code) === undefined || kd < prem.get(code)!)) { prem.set(code, kd); c.dateDebut = fmtDate(kd); }
    const kf = cleDate(g(cDf)); if (!Number.isNaN(kf) && (der.get(code) === undefined || kf > der.get(code)!)) { der.set(code, kf); c.dateFin = fmtDate(kf); }
    const rq = normRisque(g(cRq)); if (rq && !c.risque) c.risque = rq;
    else if (!c.risque && g(cImp).toLowerCase() === "true") c.risque = "Impayé";
    else if (!c.risque && g(cProc)) c.risque = "Procédure collective";
  }
  for (const c of clients) c.nbVehicules = c.immats ? String(c.immats.split(",").map((s) => s.trim()).filter(Boolean).length) : "";
  return clients;
}

interface IndexEnts { bySiren: Map<string, number>; byNom: Map<string, number>; byTel: Map<string, number>; nomsNorm: string[] }
function construireIndex(ents: any[]): IndexEnts {
  const bySiren = new Map<string, number>(), byNom = new Map<string, number>(), byTel = new Map<string, number>();
  const nomsNorm: string[] = new Array(ents.length);
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    const s = normTel(e.siren || ""); if (s.length >= 9 && !bySiren.has(s)) bySiren.set(s, i);
    const nn = norme(e.nom || ""), nc = norme(e.nomCommercial || "");
    if (nn && !byNom.has(nn)) byNom.set(nn, i);
    if (nc && !byNom.has(nc)) byNom.set(nc, i);
    const t = normTel(e.tel || ""); if (t.length >= 9 && !byTel.has(t)) byTel.set(t, i);
    nomsNorm[i] = nn || nc;
  }
  return { bySiren, byNom, byTel, nomsNorm };
}
function matchEntreprise(client: ClientSheet, idx: IndexEnts): number {
  const nClient = norme(client.nom);
  if (!nClient) return -1;
  const sc = normTel(client.siren || "");
  if (sc.length >= 9 && idx.bySiren.has(sc)) return idx.bySiren.get(sc)!;
  if (idx.byNom.has(nClient)) return idx.byNom.get(nClient)!;
  for (const t of [normTel(client.telFixe), normTel(client.mobile)]) if (t.length >= 9 && idx.byTel.has(t)) return idx.byTel.get(t)!;
  // 3. Inclusion forte UNIQUEMENT si le nom fait >= 8 caractères (évite les faux positifs)
  if (nClient.length >= 8) {
    const noms = idx.nomsNorm;
    for (let i = 0; i < noms.length; i++) { const nE = noms[i]; if (nE && nE.length >= 8 && (nE.includes(nClient) || nClient.includes(nE))) return i; }
  }
  return -1;
}

const STATUT_CLIENT = "Client";

async function lireBodyCSV(req: any): Promise<string> {
  // Vercel serverless: body peut être string, Buffer ou stream
  if (typeof req.body === "string") return req.body;
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    if (typeof (req.body as any).csv === "string") return (req.body as any).csv;
    return JSON.stringify(req.body);
  }
  // Lire le stream
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
  return new TextDecoder().decode(Buffer.concat(chunks as any));
}

export default async function handler(req: any, res: any) {
  try {
    const base = new URL(req.url || "/", "http://localhost");
    const q = base.searchParams;
    const secret = process.env.SYNC_SECRET;
    if (secret && q.get("secret") !== secret) return res.status(403).json({ erreur: "secret invalide" });
    const supabaseUrl = process.env.SUPABASE_URL || "";
    const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

    if (q.get("test") === "etat") {
      if (!supabaseUrl || !supaKey) return res.status(503).json({ erreur: "env manquante" });
      const { etat, nbShards } = await lireEtat(supabaseUrl, supaKey);
      return res.status(200).json({ ok: true, entreprises: etat?.entreprises?.length || 0, nbShards });
    }
    if (q.get("test") === "doublons") {
      if (!supabaseUrl || !supaKey) return res.status(503).json({ erreur: "env manquante" });
      const { etat } = await lireEtat(supabaseUrl, supaKey);
      const ents: any[] = etat.entreprises || [];
      const byNom = new Map<string, any[]>(); const bySiren = new Map<string, any[]>(); const byTel = new Map<string, any[]>();
      for (const e of ents) {
        const nn = norme(e.nom || "") || norme(e.nomCommercial || "");
        if (nn) { if (!byNom.has(nn)) byNom.set(nn, []); byNom.get(nn)!.push(e); }
        const s = normTel(e.siren || ""); if (s.length >= 9) { if (!bySiren.has(s)) bySiren.set(s, []); bySiren.get(s)!.push(e); }
        const t = normTel(e.tel || ""); if (t.length >= 9) { if (!byTel.has(t)) byTel.set(t, []); byTel.get(t)!.push(e); }
      }
      const doublonsNom = [...byNom.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => ({ cle: k, nb: v.length, noms: v.map((e) => e.nom || e.nomCommercial), ids: v.map((e) => e.id) }));
      const doublonsSiren = [...bySiren.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => ({ siren: k, nb: v.length, noms: v.map((e) => e.nom || e.nomCommercial), ids: v.map((e) => e.id) }));
      const doublonsTel = [...byTel.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => ({ tel: k, nb: v.length, noms: v.map((e) => e.nom || e.nomCommercial), ids: v.map((e) => e.id) }));
      return res.status(200).json({
        total: ents.length,
        doublonsNom: doublonsNom.length, detailNom: doublonsNom.slice(0, 30).map((d) => ({ cle: d.cle, fiches: d.noms.map((n, k) => ({ nom: n, id: d.ids[k], adresse: (byNom.get(d.cle)![k] as any).adresse || "", cp: (byNom.get(d.cle)![k] as any).cp || "", ville: (byNom.get(d.cle)![k] as any).ville || "", siren: (byNom.get(d.cle)![k] as any).siren || "", tel: (byNom.get(d.cle)![k] as any).tel || "", statut: (byNom.get(d.cle)![k] as any).statut || "" })) })),
        doublonsSiren: doublonsSiren.length, detailSiren: doublonsSiren.slice(0, 30),
        doublonsTel: doublonsTel.length, detailTel: doublonsTel.slice(0, 30),
      });
    }
    // ── Nettoyage « Téléphone entreprise » : déplace les portables (06/07) vers la
    //    fiche contact rattachée (si son tel est vide), puis vide le champ entreprise.
    //    ?test=nettoyerTel = dry-run (rapport seul) · ?run=nettoyerTel = écrit en base. ──
    if (q.get("test") === "nettoyerTel" || q.get("run") === "nettoyerTel") {
      if (!supabaseUrl || !supaKey) return res.status(503).json({ erreur: "env manquante" });
      const { etat } = await lireEtat(supabaseUrl, supaKey);
      const ents: any[] = etat.entreprises || [];
      const contacts: any[] = etat.contacts || [];
      let mobiles = 0, deplaces = 0, enNote = 0, sansContact = 0;
      const exemples: any[] = [];
      for (const e of ents) {
        if (!estMobileFr(e.tel || "")) continue;
        mobiles++;
        const telBrut = String(e.tel || "").trim();
        const lis = contacts.filter((c) => (c.entrepriseIds || []).includes(e.id));
        let deplace = false;
        for (const c of lis) {
          if (!normTel(c.tel || "")) {
            c.tel = telBrut; deplaces++; deplace = true;
            if (exemples.length < 20) exemples.push({ nom: e.nom || e.nomCommercial, tel: telBrut, versContact: (c.prenom + " " + c.nom).trim() });
            break;
          }
        }
        if (!deplace) {
          e.notes = (e.notes ? e.notes + "\n" : "") + (lis.length ? "Ancien tel entreprise (mobile, contact déjà renseigné) : " + telBrut : "Tel mobile sans contact rattaché : " + telBrut);
          if (lis.length) enNote++; else sansContact++;
        }
        e.tel = "";
      }
      const rapport: any = { ok: true, entreprisesTotales: ents.length, mobilesEnTelEntreprise: mobiles, deplacesSurContact: deplaces, gardesEnNote: enNote, sansContactLie: sansContact, exemples, date: new Date().toISOString() };
      if (q.get("run") === "nettoyerTel") { await ecrireEtat(supabaseUrl, supaKey, etat); rapport.ecrit = true; }
      else rapport.ecrit = false;
      return res.status(200).json(rapport);
    }
    // ── AUDIT LECTURE SEULE du CRM : GET ?test=audit[&q=belami][&dump=1] ──────────
    // ?test=audit        → rapport d'audit (entreprises + contacts + cross-check Sheet)
    // ?test=audit&q=X    → détail des entreprises dont le nom contient X + leurs contacts
    // ?test=audit&dump=1 → état COMPLET en JSON, exige ?secret=INBOUND_EMAIL_SECRET (jamais en clair)
    if (q.get("test") === "audit") {
      if (!supabaseUrl || !supaKey) return res.status(503).json({ erreur: "env manquante" });
      if (q.get("dump") === "1") {
        const secretAudit = process.env.INBOUND_EMAIL_SECRET || "";
        if (!secretAudit || q.get("secret") !== secretAudit) return res.status(401).json({ ok: false, erreur: "secret invalide" });
        const { etat, nbShards } = await lireEtat(supabaseUrl, supaKey);
        return res.status(200).json({ ok: true, dump: true, nbShards, etat });
      }
      const { etat, nbShards } = await lireEtat(supabaseUrl, supaKey);
      const ents: any[] = etat.entreprises || [];
      const contacts: any[] = etat.contacts || [];
      const deals: any[] = etat.deals || [];
      const entById = new Map<string, any>(ents.map((e) => [e.id, e]));
      const statuts: Record<string, number> = {}, origines: Record<string, number> = {}, franchiseurs: Record<string, number> = {};
      let avecSiren = 0, avecTel = 0, avecAdresse = 0, avecContrats = 0, nbActivites = 0, sansId = 0;
      for (const e of ents) {
        if (!e.id) sansId++;
        statuts[e.statut || "(vide)"] = (statuts[e.statut || "(vide)"] || 0) + 1;
        if (e.origine) origines[e.origine] = (origines[e.origine] || 0) + 1;
        if (e.franchiseur) franchiseurs[e.franchiseur] = (franchiseurs[e.franchiseur] || 0) + 1;
        if (normTel(e.siren || "").length >= 9) avecSiren++;
        if (normTel(e.tel || "").length >= 9) avecTel++;
        if (e.adresse) avecAdresse++;
        if (Array.isArray(e.contrats) && e.contrats.length) avecContrats++;
        if (Array.isArray(e.activites)) nbActivites += e.activites.length;
      }
      const gNom = new Map<string, any[]>(), gSiren = new Map<string, any[]>(), gTel = new Map<string, any[]>();
      for (const e of ents) {
        const nn = norme(e.nom || "") || norme(e.nomCommercial || ""); if (nn) { if (!gNom.has(nn)) gNom.set(nn, []); gNom.get(nn)!.push(e); }
        const s = normTel(e.siren || ""); if (s.length >= 9) { if (!gSiren.has(s)) gSiren.set(s, []); gSiren.get(s)!.push(e); }
        const t = normTel(e.tel || ""); if (t.length >= 9) { if (!gTel.has(t)) gTel.set(t, []); gTel.get(t)!.push(e); }
      }
      const fmtG = (g: Map<string, any[]>) => [...g.entries()].filter(([, v]) => v.length > 1)
        .map(([k, v]) => ({ cle: k, fiches: v.map((e) => ({ id: e.id, nom: e.nom, nomCommercial: e.nomCommercial || "", ville: e.ville || "", statut: e.statut || "", origine: e.origine || "" })) }));
      const doublons = { nom: fmtG(gNom), siren: fmtG(gSiren), tel: fmtG(gTel) };
      let sansNom = 0, prefixNum = 0, multi = 0, orphelins = 0, sansTel = 0, sansEmail = 0;
      const prefixExemples: any[] = [];
      const byEmail = new Map<string, any[]>(), byTel = new Map<string, any[]>(), byNomC = new Map<string, any[]>();
      const compteParEnt = new Map<string, number>();
      for (const c of contacts) {
        const nomComplet = (String(c.prenom || "") + " " + String(c.nom || "")).trim();
        const ids: string[] = Array.isArray(c.entrepriseIds) ? c.entrepriseIds : [];
        for (const id of ids) compteParEnt.set(id, (compteParEnt.get(id) || 0) + 1);
        if (!nomComplet) { sansNom++; continue; }
        if (/^\d[\d\s.\-]{2,}/.test(nomComplet)) {
          prefixNum++;
          if (prefixExemples.length < 60) prefixExemples.push({ id: c.id, nom: nomComplet, email: c.email || "", tel: c.tel || "", ents: ids.map((id) => entById.get(id)?.nom || id) });
        }
        if (ids.length > 1) multi++;
        if (!ids.length || ids.some((id) => !entById.has(id))) orphelins++;
        if (normTel(c.tel || "").length < 9) sansTel++;
        if (!c.email) sansEmail++;
        const em = String(c.email || "").toLowerCase(); if (em) { if (!byEmail.has(em)) byEmail.set(em, []); byEmail.get(em)!.push(c); }
        const tl = normTel(c.tel || ""); if (tl.length >= 9) { if (!byTel.has(tl)) byTel.set(tl, []); byTel.get(tl)!.push(c); }
        const nc = norme(nomComplet); if (nc) { if (!byNomC.has(nc)) byNomC.set(nc, []); byNomC.get(nc)!.push(c); }
      }
      const doublonsContacts = {
        email: [...byEmail.values()].filter((v) => v.length > 1).length,
        tel: [...byTel.values()].filter((v) => v.length > 1).length,
        nom: [...byNomC.values()].filter((v) => v.length > 1).length,
        detailEmail: [...byEmail.entries()].filter(([, v]) => v.length > 1).slice(0, 40)
          .map(([k, v]) => ({ cle: k, noms: v.map((c) => (String(c.prenom || "") + " " + String(c.nom || "")).trim()), ents: v.map((c) => (c.entrepriseIds || []).map((id) => entById.get(id)?.nom || id)) })),
      };
      const topEnts = [...compteParEnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
        .map(([id, n]) => ({ nom: entById.get(id)?.nom || id, id, nbContacts: n }));
      let qRes: any = null;
      const qq = q.get("q");
      if (qq) {
        const nq = norme(qq);
        qRes = ents.filter((e) => (norme(e.nom || "") + norme(e.nomCommercial || "")).includes(nq)).slice(0, 10).map((e) => ({
          id: e.id, nom: e.nom, nomCommercial: e.nomCommercial || "", siren: e.siren || "", tel: e.tel || "", ville: e.ville || "", statut: e.statut || "", origine: e.origine || "",
          contacts: contacts.filter((c) => (c.entrepriseIds || []).includes(e.id))
            .map((c) => ({ id: c.id, prenom: c.prenom || "", nom: c.nom || "", role: c.role || "", email: c.email || "", tel: c.tel || "" })),
        }));
      }
      let sheet: any = { erreur: "" };
      try {
        const SHEET_CSV = "https://docs.google.com/spreadsheets/d/1nikK5_dBeFSYuOLz8Inr7UsTXvdJZUbjhUoiof7FZCk/gviz/tq?tqx=out:csv&sheet=Clients%20Complets&tq=select%20*&limit=3000";
        const txt = await (await fetch(SHEET_CSV)).text();
        const clientsSheet = chargerClientsDepuisCSV(txt);
        const idx = construireIndex(ents);
        const matcheIds = new Set<string>();
        let absents = 0; const absentsListe: any[] = [];
        for (const cl of clientsSheet) {
          const i = matchEntreprise(cl, idx);
          if (i >= 0) matcheIds.add(ents[i].id); else { absents++; if (absentsListe.length < 200) absentsListe.push({ code: cl.code, nom: cl.nom, siren: cl.siren || "", ville: cl.ville || "" }); }
        }
        const crmClients = ents.filter((e) => norme(e.statut || "") === "client");
        const clientCrmSansSheet = crmClients.filter((e) => !matcheIds.has(e.id)).slice(0, 100)
          .map((e) => ({ id: e.id, nom: e.nom, siren: e.siren || "", ville: e.ville || "", origine: e.origine || "" }));
        sheet = { clientsSheet: clientsSheet.length, matches: matcheIds.size, absents, absentsListe, crmStatutClient: crmClients.length, clientCrmSansSheet: clientCrmSansSheet.length, clientCrmSansSheetApercu: clientCrmSansSheet };
      } catch (e: any) { sheet = { erreur: String(e).slice(0, 300) }; }
      return res.status(200).json({
        ok: true, audit: true, date: new Date().toISOString(), nbShards,
        entreprises: { total: ents.length, sansId, statuts, origines, franchiseurs, avecSiren, avecTel, avecAdresse, avecContrats, nbActivites },
        doublonsEntreprises: { nbNom: doublons.nom.length, nbSiren: doublons.siren.length, nbTel: doublons.tel.length, detailNom: doublons.nom, detailSiren: doublons.siren, detailTel: doublons.tel },
        contacts: { total: contacts.length, sansNom, prefixNumerique: prefixNum, prefixExemples, multiEntreprises: multi, orphelins, sansTel, sansEmail, doublonsContacts, topEntreprises: topEnts },
        deals: { total: deals.length },
        rechercheQ: qRes,
        sheet,
      });
    }
    // ── AUDIT CONTACTS SELLSY SUR CLIENTS SHEET — TOUJOURS DRY-RUN (aucune écriture) ──
    // Règle Corentin : une entreprise cliente du Sheet ne garde QUE ses contacts du Sheet.
    // ?test=auditContacts → liste les contacts importés Sellsy v8 (id = c + tag de lot)
    // rattachés à une entreprise matchée au Sheet, avec distinction détacher/supprimer.
    if (q.get("test") === "auditContacts" || q.get("run") === "nettoyerContactsSellsy") {
      if (!supabaseUrl || !supaKey) return res.status(503).json({ erreur: "env manquante" });
      const { etat } = await lireEtat(supabaseUrl, supaKey);
      const ents: any[] = etat.entreprises || [];
      const contacts: any[] = etat.contacts || [];
      const RE_SELLSY = /^c(entsv8|syv80[1-5]|yv806[ab]|fusion)_/;
      const SHEET_CSV = "https://docs.google.com/spreadsheets/d/1nikK5_dBeFSYuOLz8Inr7UsTXvdJZUbjhUoiof7FZCk/gviz/tq?tqx=out:csv&sheet=Clients%20Complets&tq=select%20*&limit=3000";
      const txt = await (await fetch(SHEET_CSV)).text();
      const clientsSheet = chargerClientsDepuisCSV(txt);
      const idx = construireIndex(ents);
      const sheetEntIds = new Set<string>();
      const absents: any[] = [];
      for (const cl of clientsSheet) {
        const i = matchEntreprise(cl, idx);
        if (i >= 0) sheetEntIds.add(ents[i].id); else if (absents.length < 200) absents.push({ code: cl.code, nom: cl.nom });
      }
      let surSheet = 0, aDetaire = 0, aSupprimer = 0;
      const parEnt: any[] = [];
      for (const c of contacts) {
        if (!RE_SELLSY.test(c.id || "")) continue;
        const ids: string[] = c.entrepriseIds || [];
        const sur = ids.filter((id) => sheetEntIds.has(id));
        if (!sur.length) continue;
        surSheet++;
        const autres = ids.filter((id) => !sheetEntIds.has(id));
        if (autres.length) aDetaire++; else aSupprimer++;
        if (parEnt.length < 300) parEnt.push({ contactId: c.id, nom: (String(c.prenom || "") + " " + String(c.nom || "")).trim(), email: c.email || "", tel: c.tel || "", entreprisesSheet: sur.map((id) => (ents.find((e) => e.id === id) || {}).nom || id), autresEntreprises: autres.length });
      }
      const rapport: any = { ok: true, auditContacts: true, ecrit: false, date: new Date().toISOString(),
        clientsSheet: clientsSheet.length, entreprisesSheetMatchees: sheetEntIds.size, clientsSheetAbsents: absents.length, absentsApercu: absents,
        contactsSellsyTotal: contacts.filter((c) => RE_SELLSY.test(c.id || "")).length,
        contactsSellsySurClientsSheet: surSheet, dontDetachementSeulement: aDetaire, dontSuppressionTotale: aSupprimer, detail: parEnt };
      if (q.get("run") === "nettoyerContactsSellsy") {
        const supprimes: any[] = [];
        const gardes: any[] = [];
        for (const c of contacts) {
          if (!RE_SELLSY.test(c.id || "")) { gardes.push(c); continue; }
          const ids: string[] = c.entrepriseIds || [];
          const reste = ids.filter((id) => !sheetEntIds.has(id));
          if (reste.length === ids.length) { gardes.push(c); continue; }
          supprimes.push(c);
          if (reste.length) { c.entrepriseIds = reste; gardes.push(c); }
        }
        etat.contacts = gardes;
        const baseApi = baseRest(supabaseUrl);
        const hB = { apikey: supaKey, Authorization: "Bearer " + supaKey, "Content-Type": "application/json" };
        const backupId = "backup-contacts-sellsy-sheet-2026-11-26";
        const rb = await fetch(baseApi + "/rest/v1/crm_etat", { method: "POST", headers: { ...hB, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ id: backupId, data: { date: new Date().toISOString(), raison: "backup avant nettoyage contacts Sellsy sur clients Sheet", contacts: supprimes }, maj: new Date().toISOString() }) });
        if (!rb.ok) throw new Error("backup " + rb.status + " " + (await rb.text()).slice(0, 200));
        await ecrireEtat(supabaseUrl, supaKey, etat);
        rapport.ecrit = true;
        rapport.contactsAvant = contacts.length;
        rapport.contactsApres = gardes.length;
        rapport.supprimes = supprimes.length;
        rapport.detachesConserves = aDetaire;
        rapport.backupId = backupId;
      }
      return res.status(200).json(rapport);
    }
    if (req.method === "GET") {
      return res.status(200).json({ endpoint: "/api/sync-clients-complets", usage: "POST le CSV de l'onglet Clients Complets en body (text/csv) · GET ?test=etat", env: !!supabaseUrl && !!supaKey });
    }
    if (!supabaseUrl || !supaKey) return res.status(503).json({ erreur: "SUPABASE_URL / KEY manquantes" });

    const t0 = Date.now();
    const csv = await lireBodyCSV(req);
    console.log("SYNC: csv reçu", csv.length, "caractères");
    const clientsSheet = chargerClientsDepuisCSV(csv);
    console.log("SYNC: clients =", clientsSheet.length, Date.now() - t0, "ms");

    const { etat, nbShards } = await lireEtat(supabaseUrl, supaKey);
    if (!etat || !Array.isArray(etat.entreprises)) return res.status(404).json({ erreur: "crm_etat introuvable" });
    const ents: any[] = etat.entreprises;
    const nbAvant = ents.length;
    const indexEnts = construireIndex(ents);
    console.log("SYNC: ents =", nbAvant, "index prêt", Date.now() - t0, "ms");

    let crees = 0, modifies = 0, inchanges = 0;
    const details: any[] = [];
    const utilises = new Set<number>();
    let logCount = 0;
    for (const cl of clientsSheet) {
      const i = matchEntreprise(cl, indexEnts);
      if (logCount < 15) { logCount++; console.log("MATCH", cl.code, JSON.stringify(cl.nom), "→", i >= 0 ? JSON.stringify(ents[i].nom || ents[i].nomCommercial) + " (statut=" + ents[i].statut + ")" : "AUCUN"); }
      const statutSheet = cl.statutClient || (cl.lignes.length ? cl.lignes[0].etat : "");
      const estActif = norme(statutSheet).includes("actif");
      if (i >= 0 && utilises.has(i)) { inchanges++; continue; }
      if (i >= 0) {
        utilises.add(i);
        const e = ents[i];
        const avant = JSON.stringify({ s: e.statut, p: e.pack, im: e.immatriculations, r: e.risque });
        if (cl.packs) e.pack = cl.packs;
        if (cl.dateDebut) e.dateDebut = cl.dateDebut;
        if (cl.dateFin) e.dateFin = cl.dateFin;
        if (cl.nbVehicules) e.nbVehicules = cl.nbVehicules;
        if (cl.contrats) e.contratLocam = cl.contrats;
        if (cl.immats) e.immatriculations = cl.immats;
        if (cl.modeles.length) e.modeles = cl.modeles;
        if (cl.lignes.length) e.contrats = cl.lignes.map((l) => ({ pack: l.pack || "", modele: l.modele || "", num: l.num || "", dateDebut: l.dateDebut || "", dateFin: l.dateFin || "", immats: l.immats || "", etat: l.etat || "", libelle: l.libelle, locam: l.locam }));
        if (cl.risque) e.risque = cl.risque;
        if (estActif && e.statut !== STATUT_CLIENT) e.statut = STATUT_CLIENT;
        if (cl.siren && !e.siren) e.siren = cl.siren;
        const noteCode = "Code Sheet: " + cl.code;
        if (!String(e.notes || "").includes(noteCode)) e.notes = e.notes ? e.notes + "\n" + noteCode : noteCode;
        if (!e.ville && cl.ville) e.ville = cl.ville;
        if (!e.adresse && cl.adresse) e.adresse = cl.adresse;
        if (!e.cp && cl.cp) e.cp = cl.cp;
        const apres = JSON.stringify({ s: e.statut, p: e.pack, im: e.immatriculations, r: e.risque });
        if (avant !== apres) { modifies++; if (details.length < 30) details.push({ action: "modifié", nom: e.nom || e.nomCommercial, code: cl.code }); }
        else inchanges++;
      } else {
        const id = "e-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
        ents.push({
          id, nom: cl.nom, nomCommercial: cl.nom, secteur: "", ville: cl.ville || "", site: "",
          tel: cl.telFixe || "", // jamais de mobile dans « Téléphone entreprise » : le portable va sur la fiche contact franchiseur: "", modeLivraison: "", activite: "",
          statut: estActif ? STATUT_CLIENT : "Suspect",
          notes: "Code Sheet: " + cl.code + (statutSheet ? "\nStatut Sheet: " + statutSheet : ""),
          activites: [], siren: cl.siren || "", adresse: cl.adresse || "", cp: cl.cp || "",
          origine: "Import Sheet Clients Complets",
          pack: cl.packs || "", dateDebut: cl.dateDebut || "", dateFin: cl.dateFin || "",
          nbVehicules: cl.nbVehicules || "", contratLocam: cl.contrats || "",
          immatriculations: cl.immats || "", modeles: cl.modeles || [],
          contrats: cl.lignes.map((l) => ({ pack: l.pack || "", modele: l.modele || "", num: l.num || "", dateDebut: l.dateDebut || "", dateFin: l.dateFin || "", immats: l.immats || "", etat: l.etat || "", libelle: l.libelle, locam: l.locam })),
          risque: cl.risque || "",
        });
        crees++;
        if (details.length < 30) details.push({ action: "créé", nom: cl.nom, code: cl.code, statut: estActif ? STATUT_CLIENT : "Suspect" });
      }
    }
    const { nbShards: nbShardsEcrits } = await ecrireEtat(supabaseUrl, supaKey, etat);
    const rapport = { ok: true, clientsSheet: clientsSheet.length, entreprisesAvant: nbAvant, entreprisesApres: ents.length, crees, modifies, inchanges, nbShards: nbShardsEcrits, dureeMs: Date.now() - t0, details, date: new Date().toISOString() };
    console.log("SYNC RAPPORT", JSON.stringify(rapport));
    return res.status(200).json(rapport);
  } catch (e: any) {
    console.error("SYNC ERREUR", String(e), String(e && e.stack || "").slice(0, 800));
    return res.status(500).json({ erreur: String(e), stack: String(e && e.stack || "").slice(0, 800) });
  }
}
