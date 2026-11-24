// ── Mise à jour en masse : franchiseur « Domino's Pizza » + diagnostic état ────
// GET /api/maj-franchiseur?config=1            → diagnostic (variables présentes)
// GET /api/maj-franchiseur?secret=…&stats=1     → stats de l'état live (sans modifier)
// GET /api/maj-franchiseur?secret=…&dry=1      → aperçu SANS écriture
// GET /api/maj-franchiseur?secret=…            → applique franchiseur = "Domino's Pizza"
const SUP: string = process.env.SUPABASE_URL || "";
const KEY: string = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SECRET: string = process.env.MAJ_FRANCHISEUR_SECRET || process.env.INBOUND_EMAIL_SECRET || "";

const SIRENS_DOMINO: string[] = ["840603237", "103320891", "900279647", "895097921", "523072528", "501054282", "510763766", "841622038", "880848734", "537568529", "820321362", "921576609", "750019135", "528185648", "803671874", "503654071", "801616988", "802653881", "910145721", "808574123", "942426131", "817874696", "848797981", "984102277", "885319673", "820161784", "814374559", "477879514", "949419436", "821911872", "838949014", "920639853", "828284976", "902098425", "882057045", "910853985", "502268733", "534541966", "832491179", "912151362", "830555421", "851312140", "821823226", "527479224", "991813023", "991709536", "510693823", "498338698", "909538324", "830619771", "800251787", "499369403", "820438380", "100677863", "953316668", "832951792", "834975674", "883813206", "795143569", "888046596", "841622210", "106227655", "510651078", "909064503", "521989863", "941140196", "895105054", "891995458", "818835290", "849379730", "533087367", "831067038", "498166511", "893124487", "922348693", "804946754", "943149419", "982743650", "813600996", "832780332", "832364525", "488863986", "524329877", "811584242", "503883480", "819626854", "910092782", "898371992", "895105047", "789823473", "820308005", "919928044", "819187493", "443515655", "932719750", "521065466", "500617634", "991740614", "501603922", "895105070", "953059862", "999587371", "887840361", "833310717", "994987196", "823621024", "400228227"];

const norm = (s: any): string => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const digits = (s: any): string => String(s || "").replace(/\.0+$/, "").replace(/\D/g, "");

export default async function handler(req: any, res: any) {
  const u = new URL(req.url || "/", "http://localhost");
  if (u.searchParams.get("config") === "1") {
    return res.status(200).json({ ok: true, service: "maj-franchiseur", variables: {
      SUPABASE_URL: !!SUP, SUPABASE_SERVICE_ROLE_KEY: !!KEY, SECRET: !!SECRET } });
  }
  const fourni = String(u.searchParams.get("secret") || (req.headers && req.headers["x-webhook-secret"]) || "");
  if (!SECRET || fourni !== SECRET) return res.status(401).json({ ok: false, erreur: "secret invalide" });
  if (!SUP || !KEY) return res.status(500).json({ ok: false, erreur: "config serveur incomplète" });
  const base = SUP.replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const sbH: any = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };

  // ── mode stats : inventaire de crm_etat (toutes lignes) ──
  if (u.searchParams.get("stats") === "1") {
    const rall = await fetch(base + "/rest/v1/crm_etat?select=id,maj", { headers: sbH });
    const allRows: any[] = rall.ok ? await rall.json() : [];
    const rget = await fetch(base + "/rest/v1/crm_etat?id=eq.main&select=data,maj", { headers: sbH });
    const rows: any[] = rget.ok ? await rget.json() : [];
    const etat: any = rows[0]?.data || {};
    const ents: any[] = Array.isArray(etat.entreprises) ? etat.entreprises : [];
    const contacts: any[] = Array.isArray(etat.contacts) ? etat.contacts : [];
    const deals: any[] = Array.isArray(etat.deals) ? etat.deals : [];
    let avecSiren = 0, avecSellsy = 0, avecDomino = 0, avecOrigine = 0;
    const origines: any = {};
    const statuts: any = {};
    for (const e of ents) {
      const blob = norm(JSON.stringify(e));
      if (digits(e.siren)) avecSiren++;
      if (blob.includes("sellsy")) avecSellsy++;
      if (blob.includes("domino")) avecDomino++;
      if (e.origine) { avecOrigine++; origines[e.origine] = (origines[e.origine] || 0) + 1; }
      statuts[e.statut || "(vide)"] = (statuts[e.statut || "(vide)"] || 0) + 1;
    }
    return res.status(200).json({ ok: true, stats: true,
      lignes: allRows, majMain: rows[0]?.maj || null,
      totalEntreprises: ents.length, totalContacts: contacts.length, totalDeals: deals.length,
      avecSiren, avecSellsy, avecDomino, avecOrigine, origines, statuts });
  }

  const rget = await fetch(base + "/rest/v1/crm_etat?id=eq.main&select=data", { headers: sbH });
  if (!rget.ok) return res.status(500).json({ ok: false, erreur: "lecture crm_etat", statut: rget.status, corps: (await rget.text()).slice(0, 300) });
  const rows: any[] = await rget.json();
  if (!rows.length || !rows[0].data) return res.status(404).json({ ok: false, erreur: "ligne crm_etat introuvable" });
  const etat: any = rows[0].data;
  const ents: any[] = Array.isArray(etat.entreprises) ? etat.entreprises : [];

  const sirenSet = new Set(SIRENS_DOMINO);
  const rapport: any[] = [];
  let modifiees = 0, blob = 0;
  for (const e of ents) {
    const nNom = norm(e.nom), nCom = norm(e.nomCommercial), siren = digits(e.siren);
    let match = "";
    if ((nNom + " " + nCom).includes("domino")) match = "nom";
    else if (siren && (sirenSet.has(siren) || sirenSet.has(siren.replace(/^0+/, "")))) match = "siren";
    else if (norm(JSON.stringify(e)).includes("domino")) { match = "blob"; blob++; }
    if (!match) continue;
    const avant = String(e.franchiseur || "");
    rapport.push({ id: e.id, nom: e.nom, nomCommercial: e.nomCommercial || "", siren, ville: e.ville || "", statut: e.statut || "", avant, match });
    if (match !== "blob" && avant !== "Domino's Pizza") { e.franchiseur = "Domino's Pizza"; modifiees++; }
  }

  const dry = u.searchParams.get("dry") === "1";
  if (dry) {
    const avecSiren = ents.filter((e: any) => digits(e.siren)).length;
    const dontSiren = rapport.filter((r: any) => r.match === "siren").length;
    return res.status(200).json({ ok: true, dry: true, total: ents.length, avecSiren, matches: rapport.length, dontSiren, blob, modifieesPrevues: modifiees, rapport });
  }

  let rput: any = null, corpsErr = "";
  for (let essai = 1; essai <= 3; essai++) {
    rput = await fetch(base + "/rest/v1/crm_etat?id=eq.main", {
      method: "PATCH",
      headers: { ...sbH, Prefer: "return=minimal" },
      body: JSON.stringify({ data: etat, maj: new Date().toISOString() }),
    });
    if (rput.ok) break;
    corpsErr = (await rput.text()).slice(0, 300);
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (!rput || !rput.ok) return res.status(500).json({ ok: false, erreur: "ecriture crm_etat", statut: rput?.status, corps: corpsErr });
  return res.status(200).json({ ok: true, dry: false, total: ents.length, matches: rapport.length, modifiees, rapport });
}
