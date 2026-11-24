// ── Mise à jour en masse : franchiseur « Domino's Pizza » ─────────────────────
// GET /api/maj-franchiseur?config=1            → diagnostic (variables présentes)
// GET /api/maj-franchiseur?secret=…&dry=1      → aperçu SANS écriture
// GET /api/maj-franchiseur?secret=…            → applique franchiseur = "Domino's Pizza"
// Secret = MAJ_FRANCHISEUR_SECRET, sinon INBOUND_EMAIL_SECRET (déjà en env Vercel).
// Matching : nom/nomCommercial contenant « domino », OU SIREN dans la liste
// (Sheet « Clients Complets » + exports Sellsy v3→v8 nom/comptesSellsy, 24/11/2026).
// Les fiches où « domino » n'apparaît que dans le reste de la fiche (notes,
// activités…) sont listées avec match="blob" mais NON modifiées (faux positifs).
const SUP: string = process.env.SUPABASE_URL || "";
const KEY: string = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SECRET: string = process.env.MAJ_FRANCHISEUR_SECRET || process.env.INBOUND_EMAIL_SECRET || "";

const SIRENS_DOMINO: string[] = ["100677863", "103320891", "106227655", "400228227", "443515655", "477879514", "488863986", "498166511", "498338698", "499369403", "500617634", "501054282", "501603922", "502268733", "503654071", "503883480", "510651078", "510693823", "510763766", "521065466", "521989863", "523072528", "524329877", "527479224", "528185648", "533087367", "534541966", "537568529", "750019135", "789823473", "795143569", "800251787", "801616988", "802653881", "803671874", "804946754", "808574123", "811584242", "813600996", "814374559", "817874696", "818835290", "819187493", "819626854", "820161784", "820308005", "820321362", "820438380", "821823226", "821911872", "823621024", "828284976", "830555421", "830619771", "831067038", "832364525", "832491179", "832780332", "832951792", "833310717", "834975674", "838949014", "840603237", "841622038", "841622210", "848797981", "849379730", "851312140", "880848734", "882057045", "883813206", "885319673", "887840361", "888046596", "891995458", "893124487", "895097921", "895105047", "895105054", "895105070", "898371992", "900279647", "902098425", "909064503", "909538324", "910092782", "910145721", "910853985", "912151362", "919928044", "920639853", "921576609", "922348693", "932719750", "941140196", "942426131", "943149419", "949419436", "953059862", "953316668", "982743650", "984102277", "991709536", "991740614", "991813023", "994987196", "999587371"];

const norm = (s: any): string => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
// SIREN : on retire un éventuel suffixe « .0 » (reste d'import) avant de ne garder que les chiffres.
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
  // RÈGLE DURABLE : SUPABASE_URL peut contenir /rest/v1 → normaliser la base.
  const base = SUP.replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const sbH: any = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };

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

  // Écriture : le jsonb complet peut dépasser le statement timeout → jusqu'à 3 essais.
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
