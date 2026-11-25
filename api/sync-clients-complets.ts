// ── /api/sync-clients-complets v4 (autonome + lecture parallèle) ────────────
// GET ?run=1        → synchro complète Sheet « Clients Complets » → CRM
// GET ?test=sheet   → 1 page Sheet (diag)   GET ?test=full → tout le Sheet (diag)
// GET ?test=etat    → état CRM (diag)
// ────────────────────────────────────────────────────────────────────────────

// ── Shards Supabase (copié inline depuis etat-shards.ts) ─────────────────────
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
  // Écriture parallèle des shards
  await Promise.all(shards.map((s) =>
    fetch(base + "/rest/v1/crm_etat", { method: "POST", headers: { ...h, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ id: s.id, data: s.data, maj }) })
      .then((rr) => { if (!rr.ok) throw new Error("shard " + s.id + " " + rr.status); })
  ));
  const rl = await fetch(base + "/rest/v1/crm_etat?select=id&id=like.ent-%25", { headers: h });
  const exist: any[] = rl.ok ? await rl.json() : [];
  const gards = new Set(shards.map((s) => s.id));
  const stale = exist.map((x) => x.id).filter((id) => !gards.has(id));
  if (stale.length) await fetch(base + '/rest/v1/crm_etat?id=in.("' + stale.join('","') + '")', { method: "DELETE", headers: h });
  return { nbShards: shards.length, staleSupprimes: stale.length };
}

// ── CSV + Sheet ──────────────────────────────────────────────────────────────
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
const URL_SHEET_CSV = "https://docs.google.com/spreadsheets/d/1nikK5_dBeFSYuOLz8Inr7UsTXvdJZUbjhUoiof7FZCk/gviz/tq?tqx=out:csv&sheet=Clients%20Complets&tq=select%20*";
const UA = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36" };

const norme = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const normTel = (t: string) => (t || "").replace(/\D/g, "");
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

// Lecture parallèle du Sheet (10 pages en même temps)
async function lireToutSheet(): Promise<string[][]> {
  const vues = new Set<string>(); const toutes: string[][] = []; let avecEntete = false;
  let off = 0;
  while (off < 5000) {
    const offsets: number[] = [];
    for (let k = 0; k < 10; k++) offsets.push(off + k * 100);
    const reps = await Promise.all(offsets.map((o) =>
      fetch(URL_SHEET_CSV + "%20limit%20100%20offset%20" + o, { headers: UA })
        .then(async (r) => ({ ok: r.ok, status: r.status, text: await r.text() }))
        .catch((e) => ({ ok: false, status: 0, text: String(e) }))
    ));
    let totalNouvelles = 0;
    for (let k = 0; k < reps.length; k++) {
      const rep = reps[k];
      if (!rep.ok) { if (k === 0) throw new Error("HTTP " + rep.status + " offset " + offsets[k]); else break; }
      const page = parserCSV(rep.text);
      if (page.length === 0) break;
      if (!avecEntete) { toutes.push(page[0]); avecEntete = true; }
      let nouvelles = 0;
      for (const l of page.slice(1)) { const cle = JSON.stringify(l); if (!vues.has(cle)) { vues.add(cle); toutes.push(l); nouvelles++; } }
      totalNouvelles += nouvelles;
      if (page.length - 1 === 0 || nouvelles === 0) break;
    }
    if (totalNouvelles === 0) break;
    off += 1000;
  }
  if (!avecEntete) throw new Error("Sheet vide");
  return toutes;
}

async function chargerClientsSheet(): Promise<ClientSheet[]> {
  const lignes = await lireToutSheet();
  const tete = (lignes[0] || []).map(normH);
  const col = (n: string) => tete.findIndex((h) => h.startsWith(normH(n)));
  const colC = (n: string) => tete.findIndex((h) => h.includes(normH(n)));
  const cCode = col("Code client"), cNom = col("Nom client"), cVille = col("Ville"),
    cSiren = col("SIREN"), cStatutClient = col("Statut client"),
    cAdr = col("Adresse de livraison"),
    cPack = col("Libellé contrat"), cPackCode = col("Code produit"), cLib = col("Libellé contrat"), cLocam = col("N° dossier locam"),
    cProd = colC("libellé produit"), cEtat = col("Etat contrat"), cDd = col("Date début contrat"), cDf = col("Date fin contrat"),
    cNum = col("N° contrat"), cImm = col("Immatriculation"), cRq = col("Risque"),
    cContact = col("Contact principal"), cFonction = col("Fonction"), cTelFixe = col("Téléphone"), cMobile = col("Mobile"), cMail = col("E-mail"),
    cImp = col("Impayes"), cProc = col("Procedure collective");
  if (cCode < 0 || cNom < 0) throw new Error("Colonnes introuvables. Headers=" + JSON.stringify(tete));
  const clients: ClientSheet[] = [];
  const idx = new Map<string, ClientSheet>();
  const prem = new Map<string, number>(); const der = new Map<string, number>();
  const cleDate = (d: string) => { const p = d.trim().split("/").map(Number); return p.length === 3 ? p[2] * 10000 + p[1] * 100 + p[0] : NaN; };
  const p2 = (n: number) => (n < 10 ? "0" : "") + n;
  const fmtDate = (k: number) => p2(k % 100) + "/" + p2(Math.floor(k / 100) % 100) + "/" + Math.floor(k / 10000);
  for (const l of lignes.slice(1)) {
    const g = (i: number) => (i >= 0 && i < l.length ? l[i].trim() : "");
    const code = g(cCode); if (!code) continue;
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

function matchEntreprise(client: ClientSheet, ents: any[]): number {
  const nClient = norme(client.nom);
  if (!nClient) return -1;
  // 0. SIREN (le plus fiable)
  const sirenClient = normTel(client.siren || "");
  if (sirenClient.length >= 9) {
    for (let i = 0; i < ents.length; i++) if (normTel(ents[i].siren || "") === sirenClient) return i;
  }
  // 1. Nom exact normalisé
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    if (norme(e.nom || "") === nClient || norme(e.nomCommercial || "") === nClient) return i;
  }
  // 2. Téléphone
  const telsSheet = [normTel(client.telFixe), normTel(client.mobile)].filter((t) => t.length >= 9);
  if (telsSheet.length) {
    for (let i = 0; i < ents.length; i++) if (telsSheet.some((ts) => normTel(ents[i].tel || "") === ts)) return i;
  }
  // 3. Inclusion forte
  for (let i = 0; i < ents.length; i++) {
    const nE = norme(ents[i].nom || "") || norme(ents[i].nomCommercial || "");
    if (nE.length >= 5 && nClient.length >= 5 && (nE.includes(nClient) || nClient.includes(nE))) return i;
  }
  return -1;
}

const STATUT_CLIENT = "Client";

export default async function handler(req: any, res: any) {
  try {
    const base = new URL(req.url || "/", "http://localhost");
    const q = base.searchParams;
    const secret = process.env.SYNC_SECRET;
    if (secret && q.get("secret") !== secret) return res.status(403).json({ erreur: "secret invalide" });

    const supabaseUrl = process.env.SUPABASE_URL || "";
    const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

    if (q.get("test") === "sheet") {
      const rep = await fetch(URL_SHEET_CSV + "%20limit%205%20offset%200", { headers: UA });
      const txt = await rep.text();
      const page = parserCSV(txt);
      return res.status(200).json({ ok: rep.ok, status: rep.status, tailleTexte: txt.length, nbLignes: page.length, headers: page[0] || [] });
    }
    if (q.get("test") === "full") {
      const t0 = Date.now();
      const clients = await chargerClientsSheet();
      return res.status(200).json({ ok: true, clients: clients.length, dureeMs: Date.now() - t0 });
    }
    if (q.get("test") === "etat") {
      if (!supabaseUrl || !supaKey) return res.status(503).json({ erreur: "env manquante" });
      const t0 = Date.now();
      const { etat, nbShards } = await lireEtat(supabaseUrl, supaKey);
      return res.status(200).json({ ok: true, entreprises: etat?.entreprises?.length || 0, nbShards, dureeMs: Date.now() - t0 });
    }
    if (req.method === "GET" && !q.get("run")) {
      return res.status(200).json({ endpoint: "/api/sync-clients-complets", usage: "?run=1 · ?test=sheet|full|etat", env: !!supabaseUrl && !!supaKey });
    }
    if (!supabaseUrl || !supaKey) return res.status(503).json({ erreur: "SUPABASE_URL / KEY manquantes" });

    const t0 = Date.now();
    const clientsSheet = await chargerClientsSheet();
    console.log("SYNC: sheet =", clientsSheet.length, Date.now() - t0, "ms");
    const { etat, nbShards } = await lireEtat(supabaseUrl, supaKey);
    if (!etat || !Array.isArray(etat.entreprises)) return res.status(404).json({ erreur: "crm_etat introuvable" });
    const ents: any[] = etat.entreprises;
    const nbAvant = ents.length;
    console.log("SYNC: ents =", nbAvant, "shards =", nbShards, Date.now() - t0, "ms");

    let crees = 0, modifies = 0, inchanges = 0;
    const details: any[] = [];
    const utilises = new Set<number>();
    for (const cl of clientsSheet) {
      const i = matchEntreprise(cl, ents);
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
        const nouveau: any = {
          id, nom: cl.nom, nomCommercial: cl.nom, secteur: "", ville: cl.ville || "", site: "",
          tel: cl.telFixe || cl.mobile || "", franchiseur: "", modeLivraison: "", activite: "",
          statut: estActif ? STATUT_CLIENT : "Suspect",
          notes: "Code Sheet: " + cl.code + (statutSheet ? "\nStatut Sheet: " + statutSheet : ""),
          activites: [], siren: cl.siren || "", adresse: cl.adresse || "", cp: cl.cp || "",
          origine: "Import Sheet Clients Complets",
          pack: cl.packs || "", dateDebut: cl.dateDebut || "", dateFin: cl.dateFin || "",
          nbVehicules: cl.nbVehicules || "", contratLocam: cl.contrats || "",
          immatriculations: cl.immats || "", modeles: cl.modeles || [],
          contrats: cl.lignes.map((l) => ({ pack: l.pack || "", modele: l.modele || "", num: l.num || "", dateDebut: l.dateDebut || "", dateFin: l.dateFin || "", immats: l.immats || "", etat: l.etat || "", libelle: l.libelle, locam: l.locam })),
          risque: cl.risque || "",
        };
        ents.push(nouveau);
        crees++;
        if (details.length < 30) details.push({ action: "créé", nom: cl.nom, code: cl.code, statut: nouveau.statut });
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
