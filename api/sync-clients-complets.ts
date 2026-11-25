// ── /api/sync-clients-complets ──────────────────────────────────────────────
// Synchronise l'onglet « Clients Complets » du Google Sheet « Infos Service
// Client » vers le CRM (table crm_etat, état shardé).
//   - Si une entreprise du CRM correspond (nom normalisé ou téléphone),
//     elle est MISE À JOUR (statut, flotte, contrats, risque, notes).
//   - Sinon elle est CRÉÉE. JAMAIS de doublon.
// Appel : GET ?run=1  → synchro complète
//         GET ?test=sheet → lit 1 page du Sheet (diagnostic)
//         GET ?test=full  → lit tout le Sheet, compte les clients (diagnostic)
//         GET ?test=etat  → lit l'état CRM, compte les entreprises (diagnostic)
// ────────────────────────────────────────────────────────────────────────────

import { lireEtat, ecrireEtat } from "./etat-shards";

const UA = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36" };

// ── Mini-parseur CSV (identique à src/App.tsx) ──────────────────────────────
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

const norme = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const normTel = (t: string) => (t || "").replace(/\D/g, "");
const normH = (s: string) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

const MODELE_DEPUIS: [string, string][] = [
  ["infinitypro", "Infinity Pro"], ["compactpro", "Compact Pro"], ["dailypro", "Daily Pro"],
];
const modeleDepuis = (p: string): string => {
  const n = norme(p);
  const t = MODELE_DEPUIS.find(([k]) => n.includes(k));
  return t ? t[1] : "";
};

const normRisque = (s: string): string => {
  const n = norme(s);
  if (!n) return "";
  if (n.includes("bloque") || n.includes("block")) return "Bloqué";
  if (n.includes("defaut") || n.includes("impaye")) return "Impayé";
  if (n.includes("proced") || n.includes("collective") || n.includes("redressement") || n.includes("liquidation")) return "Procédure collective";
  if (n.includes("sommeil") || n.includes("inactif")) return "En sommeil";
  if (n.includes("actif")) return "";
  return s.trim();
};

interface ContratLigne { pack: string; modele: string; num: string; dateDebut: string; dateFin: string; immats: string; etat: string; libelle?: string; locam?: string }
interface ContactSheet { prenom: string; nom: string; role: string; tel: string; email: string }
interface ClientSheet {
  code: string; nom: string; ville: string; adresse?: string; cp?: string;
  packs: string; dateDebut: string; dateFin: string; nbVehicules: string;
  contrats: string; immats: string; risque: string; modeles: string[];
  lignes: ContratLigne[]; contacts: ContactSheet[]; telFixe: string; mobile: string; email: string;
}

// ── Lecture paginée du Sheet ─────────────────────────────────────────────────
const lireToutSheet = async (): Promise<string[][]> => {
  const vues = new Set<string>();
  const toutes: string[][] = [];
  let avecEntete = false;
  for (let off = 0; off < 5000;) {
    const rep = await fetch(URL_SHEET_CSV + "%20limit%20100%20offset%20" + off, { headers: UA });
    if (!rep.ok) throw new Error("HTTP " + rep.status + " offset " + off + " body=" + (await rep.text()).slice(0, 200));
    const page = parserCSV(await rep.text());
    if (page.length === 0) break;
    if (!avecEntete) { toutes.push(page[0]); avecEntete = true; }
    let nouvelles = 0;
    for (const l of page.slice(1)) {
      const cle = JSON.stringify(l);
      if (!vues.has(cle)) { vues.add(cle); toutes.push(l); nouvelles++; }
    }
    const nb = page.length - 1;
    if (nb === 0 || nouvelles === 0) break;
    off += nb;
  }
  if (!avecEntete) throw new Error("Sheet vide");
  return toutes;
};

const chargerClientsSheet = async (): Promise<ClientSheet[]> => {
  const lignes = await lireToutSheet();
  const tete = (lignes[0] || []).map(normH);
  const col = (n: string) => tete.findIndex((h) => h.startsWith(normH(n)));
  const colC = (n: string) => tete.findIndex((h) => h.includes(normH(n)));
  const cCode = col("Code client"), cNom = col("Nom client"), cVille = col("Ville"),
    cAdr = col("Adresse de livraison"),
    cPack = col("Libellé contrat"), cPackCode = col("Code produit"), cLib = col("Libellé contrat"), cLocam = col("N° dossier locam"),
    cProd = colC("libellé produit"), cEtat = col("Etat contrat"), cDd = col("Date début contrat"), cDf = col("Date fin contrat"),
    cNum = col("N° contrat"), cImm = col("Immatriculation"), cRq = col("Risque"),
    cContact = col("Contact principal"), cFonction = col("Fonction"), cTelFixe = col("Téléphone"), cMobile = col("Mobile"), cMail = col("E-mail"),
    cImp = col("Impayes"), cProc = col("Procedure collective");
  if (cCode < 0 || cNom < 0) throw new Error("Colonnes Code client / Nom client introuvables. Headers=" + JSON.stringify(tete));

  const clients: ClientSheet[] = [];
  const idx = new Map<string, ClientSheet>();
  const prem = new Map<string, number>();
  const der = new Map<string, number>();
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
        packs: "", dateDebut: "", dateFin: "", nbVehicules: "", contrats: "", immats: "",
        risque: "", modeles: [], lignes: [], contacts: [],
        telFixe: g(cTelFixe), mobile: g(cMobile), email: g(cMail),
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
    const principal = g(cContact); const tk = principal.split(/\s+/).filter(Boolean);
    const cp = tk.length > 1 ? tk[0] : "", cn = tk.length > 1 ? tk.slice(1).join(" ") : principal;
    const telC = g(cMobile) || g(cTelFixe);
    if ((cp || cn) && !c.contacts.some((x) => x.prenom === cp && x.nom === cn && x.tel === telC && x.email === g(cMail))) {
      c.contacts.push({ prenom: cp, nom: cn, role: g(cFonction), tel: telC, email: g(cMail) });
    }
  }
  for (const c of clients) c.nbVehicules = c.immats ? String(c.immats.split(",").map((s) => s.trim()).filter(Boolean).length) : "";
  return clients;
};

const matchEntreprise = (client: ClientSheet, ents: any[]): number => {
  const nClient = norme(client.nom);
  if (!nClient) return -1;
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    if (norme(e.nom || "") === nClient || norme(e.nomCommercial || "") === nClient) return i;
  }
  const telsSheet = [normTel(client.telFixe), normTel(client.mobile)].filter((t) => t.length >= 9);
  if (telsSheet.length) {
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (telsSheet.some((ts) => normTel(e.tel || "") === ts)) return i;
    }
  }
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    const nE = norme(e.nom || "") || norme(e.nomCommercial || "");
    if (nE.length >= 5 && nClient.length >= 5 && (nE.includes(nClient) || nClient.includes(nE))) return i;
  }
  return -1;
};

const STATUT_CLIENT = "Client";

// ── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req: any, res: any) {
  const base = new URL(req.url || "/", "http://localhost");
  const q = base.searchParams;
  const secret = process.env.SYNC_SECRET;
  if (secret && q.get("secret") !== secret) {
    return res.status(403).json({ erreur: "secret invalide" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // ── Mode diagnostic : 1 page du Sheet ──
  if (q.get("test") === "sheet") {
    try {
      const rep = await fetch(URL_SHEET_CSV + "%20limit%205%20offset%200", { headers: UA });
      const txt = await rep.text();
      const page = parserCSV(txt);
      return res.status(200).json({
        ok: rep.ok, status: rep.status, tailleTexte: txt.length,
        nbLignes: page.length, headers: page[0] || [],
        ligne1: page[1] || null, ligne2: page[2] || null,
      });
    } catch (e: any) { return res.status(500).json({ erreur: String(e) }); }
  }

  // ── Mode diagnostic : tout le Sheet, compte les clients ──
  if (q.get("test") === "full") {
    try {
      const t0 = Date.now();
      const clients = await chargerClientsSheet();
      return res.status(200).json({ ok: true, clients: clients.length, dureeMs: Date.now() - t0, premier: clients[0] ? { code: clients[0].code, nom: clients[0].nom } : null });
    } catch (e: any) { return res.status(500).json({ erreur: String(e), stack: String(e && e.stack || "").slice(0, 400) }); }
  }

  // ── Mode diagnostic : état CRM ──
  if (q.get("test") === "etat") {
    if (!supabaseUrl || !supaKey) return res.status(503).json({ erreur: "env manquante", SUPABASE_URL: !!supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: !!supaKey });
    try {
      const t0 = Date.now();
      const { etat, nbShards } = await lireEtat(String(supabaseUrl), String(supaKey));
      return res.status(200).json({ ok: true, entreprises: etat?.entreprises?.length || 0, nbShards, dureeMs: Date.now() - t0, clesEtat: Object.keys(etat || {}).slice(0, 20) });
    } catch (e: any) { return res.status(500).json({ erreur: String(e), stack: String(e && e.stack || "").slice(0, 400) }); }
  }

  // ── Mode info (défaut) ──
  if (req.method === "GET" && !q.get("run")) {
    return res.status(200).json({
      endpoint: "/api/sync-clients-complets",
      usage: "GET ?run=1 (synchro) · ?test=sheet | ?test=full | ?test=etat (diagnostics)",
      SUPABASE_URL: !!supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: !!supaKey, SYNC_SECRET_DEFINI: !!secret,
    });
  }

  if (!supabaseUrl || !supaKey) {
    return res.status(503).json({ erreur: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquantes" });
  }

  // ── Synchro complète ──
  try {
    const t0 = Date.now();
    const clientsSheet = await chargerClientsSheet();
    console.log("SYNC: clients sheet =", clientsSheet.length, "en", Date.now() - t0, "ms");

    const { etat, nbShards } = await lireEtat(String(supabaseUrl), String(supaKey));
    if (!etat || !Array.isArray(etat.entreprises)) return res.status(404).json({ erreur: "crm_etat introuvable" });
    const ents: any[] = etat.entreprises;
    const nbAvant = ents.length;
    console.log("SYNC: entreprises CRM =", nbAvant, "shards =", nbShards);

    let crees = 0, modifies = 0, inchanges = 0;
    const details: any[] = [];
    const utilises = new Set<number>();

    for (const cl of clientsSheet) {
      const i = matchEntreprise(cl, ents);
      const statutSheet = cl.lignes.length ? cl.lignes[0].etat : "";
      const estActifContrat = norme(statutSheet).includes("actif");

      if (i >= 0 && utilises.has(i)) { inchanges++; continue; }

      if (i >= 0) {
        utilises.add(i);
        const e = ents[i];
        const avant = JSON.stringify({ s: e.statut, p: e.pack, c: e.contratLocam, im: e.immatriculations, r: e.risque, n: e.nbVehicules });
        if (cl.packs) e.pack = cl.packs;
        if (cl.dateDebut) e.dateDebut = cl.dateDebut;
        if (cl.dateFin) e.dateFin = cl.dateFin;
        if (cl.nbVehicules) e.nbVehicules = cl.nbVehicules;
        if (cl.contrats) e.contratLocam = cl.contrats;
        if (cl.immats) e.immatriculations = cl.immats;
        if (cl.modeles.length) e.modeles = cl.modeles;
        if (cl.lignes.length) e.contrats = cl.lignes.map((l: ContratLigne) => ({
          pack: l.pack || "", modele: l.modele || "", num: l.num || "",
          dateDebut: l.dateDebut || "", dateFin: l.dateFin || "",
          immats: l.immats || "", etat: l.etat || "", libelle: l.libelle, locam: l.locam,
        }));
        if (cl.risque) e.risque = cl.risque;
        if (estActifContrat && e.statut !== STATUT_CLIENT) e.statut = STATUT_CLIENT;
        const noteCode = "Code Sheet: " + cl.code;
        if (!String(e.notes || "").includes(noteCode)) {
          e.notes = e.notes ? e.notes + "\n" + noteCode : noteCode;
        }
        if (!e.ville && cl.ville) e.ville = cl.ville;
        if (!e.adresse && cl.adresse) e.adresse = cl.adresse;
        if (!e.cp && cl.cp) e.cp = cl.cp;
        const apres = JSON.stringify({ s: e.statut, p: e.pack, c: e.contratLocam, im: e.immatriculations, r: e.risque, n: e.nbVehicules });
        if (avant !== apres) { modifies++; if (details.length < 30) details.push({ action: "modifié", nom: e.nom || e.nomCommercial, code: cl.code }); }
        else inchanges++;
      } else {
        const id = "e-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
        const nouveau: any = {
          id, nom: cl.nom, nomCommercial: cl.nom, secteur: "",
          ville: cl.ville || "", site: "", tel: cl.telFixe || cl.mobile || "",
          franchiseur: "", modeLivraison: "", activite: "",
          statut: estActifContrat ? STATUT_CLIENT : "Suspect",
          notes: "Code Sheet: " + cl.code + (statutSheet ? "\nStatut Sheet: " + statutSheet : ""),
          activites: [], siren: "", adresse: cl.adresse || "", cp: cl.cp || "",
          origine: "Import Sheet Clients Complets",
          pack: cl.packs || "", dateDebut: cl.dateDebut || "", dateFin: cl.dateFin || "",
          nbVehicules: cl.nbVehicules || "", contratLocam: cl.contrats || "",
          immatriculations: cl.immats || "", modeles: cl.modeles || [],
          contrats: cl.lignes.map((l: ContratLigne) => ({
            pack: l.pack || "", modele: l.modele || "", num: l.num || "",
            dateDebut: l.dateDebut || "", dateFin: l.dateFin || "",
            immats: l.immats || "", etat: l.etat || "", libelle: l.libelle, locam: l.locam,
          })),
          risque: cl.risque || "",
        };
        ents.push(nouveau);
        crees++;
        if (details.length < 30) details.push({ action: "créé", nom: cl.nom, code: cl.code, statut: nouveau.statut });
      }
    }

    const { nbShards: nbShardsEcrits } = await ecrireEtat(String(supabaseUrl), String(supaKey), etat);

    const rapport = {
      ok: true, clientsSheet: clientsSheet.length,
      entreprisesAvant: nbAvant, entreprisesApres: ents.length,
      crees, modifies, inchanges, nbShards: nbShardsEcrits,
      dureeMs: Date.now() - t0, details, date: new Date().toISOString(),
    };
    console.log("SYNC RAPPORT", JSON.stringify(rapport));
    return res.status(200).json(rapport);
  } catch (e: any) {
    console.error("SYNC ERREUR", String(e), String(e && e.stack || "").slice(0, 800));
    return res.status(500).json({ erreur: String(e), stack: String(e && e.stack || "").slice(0, 800) });
  }
}
