// ── maj-franchiseur : tague franchiseur « Domino's Pizza » + diagnostics ────────
// GET ?config=1 | ?secret=…&stats=1 | ?secret=…&sirens=1 | ?secret=…&dry=1 | ?secret=…
const SUP: string = process.env.SUPABASE_URL || "";
const KEY: string = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SECRET: string = process.env.MAJ_FRANCHISEUR_SECRET || process.env.INBOUND_EMAIL_SECRET || "";

const SIRENS_DOMINO: string[] = ["503883480", "982743650", "902098425", "920639853", "932719750", "999587371", "821823226", "895105070", "922348693", "106227655", "533087367", "841622210", "991740614", "849379730", "803671874", "820321362", "821911872", "501603922", "534541966", "820438380", "888046596", "887840361", "820308005", "830555421", "818835290", "400228227", "833310717", "851312140", "832364525", "528185648", "817874696", "443515655", "500617634", "943149419", "524329877", "909064503", "795143569", "912151362", "900279647", "984102277", "953316668", "883813206", "819626854", "910092782", "893124487", "840603237", "527479224", "488863986", "510651078", "921576609", "498338698", "891995458", "832780332", "895105047", "499369403", "819187493", "510763766", "991709536", "523072528", "898371992", "804946754", "789823473", "848797981", "895105054", "910853985", "830619771", "521065466", "808574123", "831067038", "811584242", "801616988", "802653881", "919928044", "953059862", "800251787", "820161784", "991813023", "838949014", "100677863", "750019135", "813600996", "942426131", "880848734", "882057045", "498166511", "994987196", "823621024", "103320891", "885319673", "537568529", "941140196", "503654071", "477879514", "814374559", "521989863", "841622038", "832951792", "832491179", "502268733", "909538324", "510693823", "949419436", "828284976", "834975674", "895097921", "501054282", "910145721"];

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

  const rget = await fetch(base + "/rest/v1/crm_etat?id=eq.main&select=data,maj", { headers: sbH });
  if (!rget.ok) return res.status(500).json({ ok: false, erreur: "lecture", statut: rget.status });
  const rows: any[] = await rget.json();
  if (!rows.length || !rows[0].data) return res.status(404).json({ ok: false, erreur: "ligne main introuvable" });
  const etat: any = rows[0].data;
  const ents: any[] = Array.isArray(etat.entreprises) ? etat.entreprises : [];

  // ── mode sirens : liste les SIREN présents (pour diff avec les fichiers d'import) ──
  if (u.searchParams.get("sirens") === "1") {
    const set = new Set<string>();
    for (const e of ents) { const s = digits(e.siren); if (s) set.add(s); }
    return res.status(200).json({ ok: true, sirens: true, maj: rows[0].maj || null, total: ents.length, sirens: [...set].sort() });
  }

  // ── mode stats ──
  if (u.searchParams.get("stats") === "1") {
    const rall = await fetch(base + "/rest/v1/crm_etat?select=id,maj", { headers: sbH });
    const allRows: any[] = rall.ok ? await rall.json() : [];
    const contacts: any[] = Array.isArray(etat.contacts) ? etat.contacts : [];
    const deals: any[] = Array.isArray(etat.deals) ? etat.deals : [];
    let avecSiren = 0, avecSellsy = 0, avecDomino = 0;
    const origines: any = {}, statuts: any = {};
    for (const e of ents) {
      const blob = norm(JSON.stringify(e));
      if (digits(e.siren)) avecSiren++;
      if (blob.includes("sellsy")) avecSellsy++;
      if (blob.includes("domino")) avecDomino++;
      if (e.origine) origines[e.origine] = (origines[e.origine] || 0) + 1;
      statuts[e.statut || "(vide)"] = (statuts[e.statut || "(vide)"] || 0) + 1;
    }
    return res.status(200).json({ ok: true, stats: true, lignes: allRows, majMain: rows[0]?.maj || null,
      totalEntreprises: ents.length, totalContacts: contacts.length, totalDeals: deals.length,
      avecSiren, avecSellsy, avecDomino, origines, statuts });
  }

  // ── matching Domino's ──
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
    return res.status(200).json({ ok: true, dry: true, total: ents.length, matches: rapport.length,
      dontSiren: rapport.filter((r: any) => r.match === "siren").length, blob, modifieesPrevues: modifiees, rapport });
  }

  let rput: any = null, corpsErr = "";
  for (let essai = 1; essai <= 3; essai++) {
    rput = await fetch(base + "/rest/v1/crm_etat?id=eq.main", {
      method: "PATCH", headers: { ...sbH, Prefer: "return=minimal" },
      body: JSON.stringify({ data: etat, maj: new Date().toISOString() }),
    });
    if (rput.ok) break;
    corpsErr = (await rput.text()).slice(0, 300);
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (!rput || !rput.ok) return res.status(500).json({ ok: false, erreur: "ecriture", statut: rput?.status, corps: corpsErr });
  return res.status(200).json({ ok: true, dry: false, total: ents.length, matches: rapport.length, modifiees, rapport });
}
