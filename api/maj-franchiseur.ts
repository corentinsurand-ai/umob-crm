// ── Mise à jour en masse : franchiseur « Domino's Pizza » ─────────────────────
// GET /api/maj-franchiseur?config=1            → diagnostic (variables présentes)
// GET /api/maj-franchiseur?secret=…&dry=1      → aperçu des fiches matchées, SANS écriture
// GET /api/maj-franchiseur?secret=…            → applique franchiseur = "Domino's Pizza"
// Secret = MAJ_FRANCHISEUR_SECRET, sinon INBOUND_EMAIL_SECRET (déjà en env Vercel).
// Matching : nom / nom commercial contenant « domino » (insensible casse/accents/
// apostrophe) OU SIREN dans la liste ci-dessous (extraite du Sheet « Clients
// Complets » + des exports Sellsy v3→v8, 24/11/2026).
const SUP: string = process.env.SUPABASE_URL || "";
const KEY: string = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SECRET: string = process.env.MAJ_FRANCHISEUR_SECRET || process.env.INBOUND_EMAIL_SECRET || "";

const SIRENS_DOMINO: string[] = ["106227655", "400228227", "443515655", "488863986", "498166511", "498338698", "499369403", "500617634", "501054282", "501603922", "502268733", "503654071", "503883480", "510651078", "510693823", "510763766", "521065466", "523072528", "524329877", "527479224", "528185648", "533087367", "534541966", "537568529", "750019135", "795143569", "800251787", "801616988", "803671874", "808574123", "811584242", "813600996", "818835290", "819187493", "819626854", "820161784", "820308005", "820321362", "820438380", "821823226", "821911872", "823621024", "830555421", "830619771", "831067038", "832364525", "832491179", "832780332", "832951792", "833310717", "834975674", "838949014", "841622038", "841622210", "848797981", "849379730", "851312140", "880848734", "882057045", "885319673", "887840361", "888046596", "891995458", "893124487", "895097921", "895105047", "895105054", "895105070", "900279647", "902098425", "909538324", "910092782", "910853985", "912151362", "919928044", "920639853", "922348693", "942426131", "953059862", "953316668", "982743650", "984102277", "991709536", "991813023", "994987196"];

const norm = (s: any): string => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const digits = (s: any): string => String(s || "").replace(/\D/g, "");

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
  let modifiees = 0;
  for (const e of ents) {
    const nNom = norm(e.nom), nCom = norm(e.nomCommercial), siren = digits(e.siren);
    let match = "";
    if ((nNom + " " + nCom).includes("domino")) match = "nom";
    else if (siren && sirenSet.has(siren)) match = "siren";
    if (!match) continue;
    const avant = String(e.franchiseur || "");
    rapport.push({ id: e.id, nom: e.nom, nomCommercial: e.nomCommercial || "", siren, ville: e.ville || "", statut: e.statut || "", avant, match });
    if (avant !== "Domino's Pizza") { e.franchiseur = "Domino's Pizza"; modifiees++; }
  }

  const dry = u.searchParams.get("dry") === "1";
  if (dry) return res.status(200).json({ ok: true, dry: true, total: ents.length, matches: rapport.length, modifieesPrevues: modifiees, rapport });

  const rput = await fetch(base + "/rest/v1/crm_etat?id=eq.main", {
    method: "PATCH",
    headers: { ...sbH, Prefer: "return=minimal" },
    body: JSON.stringify({ data: etat, maj: new Date().toISOString() }),
  });
  if (!rput.ok) return res.status(500).json({ ok: false, erreur: "ecriture crm_etat", statut: rput.status, corps: (await rput.text()).slice(0, 300) });
  return res.status(200).json({ ok: true, dry: false, total: ents.length, matches: rapport.length, modifiees, rapport });
}
