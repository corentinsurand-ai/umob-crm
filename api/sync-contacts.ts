// ── Accès shardé à l'état du CRM (table crm_etat) ────────────────────────────
// La ligne `main` contient tout l'état SAUF le tableau `entreprises`, qui est
// réparti dans des lignes `ent-0000`, `ent-0001`, ... d'environ 1 Mo de JSON
// chacune. Raison : un PATCH de la ligne complète (~10 Mo de jsonb) dépasse
// le statement_timeout de Postgres (erreur 57014) ; des écritures de ~1 Mo
// passent en quelques centaines de ms.

const SHARD_TAILLE = 1_000_000;

export function decouperShards(etat: any): { base: any; shards: { id: string; data: any }[] } {
  const ents: any[] = Array.isArray(etat?.entreprises) ? etat.entreprises : [];
  const base = { ...etat, entreprises: [] as any[] };
  const shards: { id: string; data: any }[] = [];
  let cur: any[] = [], t = 0, n = 0;
  for (const e of ents) {
    const s = JSON.stringify(e).length;
    if (cur.length && t + s > SHARD_TAILLE) {
      shards.push({ id: "ent-" + String(n).padStart(4, "0"), data: { entreprises: cur } });
      n++; cur = []; t = 0;
    }
    cur.push(e); t += s;
  }
  if (cur.length) shards.push({ id: "ent-" + String(n).padStart(4, "0"), data: { entreprises: cur } });
  return { base, shards };
}

function baseRest(sup: string): string {
  return sup.replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
}

/** Lit main + tous les shards et renvoie l'état fusionné (dédupliqué par id). */
export async function lireEtat(sup: string, cle: string): Promise<{ etat: any; maj: string | null; nbShards: number }> {
  const base = baseRest(sup);
  const h = { apikey: cle, Authorization: `Bearer ${cle}`, "Content-Type": "application/json" };
  const r = await fetch(base + "/rest/v1/crm_etat?select=id,data,maj&or=(id.eq.main,id.like.ent-%25)", { headers: h });
  if (!r.ok) throw new Error("lecture crm_etat " + r.status + " " + (await r.text()).slice(0, 200));
  const rows: any[] = await r.json();
  const main = rows.find((x) => x.id === "main") || rows[0];
  if (!main || !main.data) throw new Error("ligne main introuvable");
  const etat: any = main.data;
  const vus = new Set<string>();
  const ents: any[] = [];
  const ajouter = (liste: any[]) => {
    for (const e of liste || []) if (e && e.id && !vus.has(e.id)) { vus.add(e.id); ents.push(e); }
  };
  ajouter(Array.isArray(etat.entreprises) ? etat.entreprises : []);
  const shards = rows.filter((x) => x.id !== "main" && String(x.id).startsWith("ent-")).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const s of shards) ajouter((s.data || {}).entreprises);
  etat.entreprises = ents;
  return { etat, maj: main.maj || null, nbShards: shards.length };
}

/** Écrit l'état en shards : PATCH de main (petit) + upsert de chaque shard + ménage. */
export async function ecrireEtat(sup: string, cle: string, etat: any): Promise<{ nbShards: number; staleSupprimes: number }> {
  const base = baseRest(sup);
  const h = { apikey: cle, Authorization: `Bearer ${cle}`, "Content-Type": "application/json" };
  const { base: baseData, shards } = decouperShards(etat);
  const maj = new Date().toISOString();
  const r = await fetch(base + "/rest/v1/crm_etat?id=eq.main", {
    method: "PATCH", headers: { ...h, Prefer: "return=minimal" },
    body: JSON.stringify({ data: baseData, maj }),
  });
  if (!r.ok) throw new Error("ecriture main " + r.status + " " + (await r.text()).slice(0, 200));
  for (const s of shards) {
    const rr = await fetch(base + "/rest/v1/crm_etat", {
      method: "POST", headers: { ...h, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id: s.id, data: s.data, maj }),
    });
    if (!rr.ok) throw new Error("ecriture shard " + s.id + " " + rr.status + " " + (await rr.text()).slice(0, 200));
  }
  const rl = await fetch(base + "/rest/v1/crm_etat?select=id&id=like.ent-%25", { headers: h });
  const exist: any[] = rl.ok ? await rl.json() : [];
  const gards = new Set(shards.map((s) => s.id));
  const stale = exist.map((x) => x.id).filter((id) => !gards.has(id));
  if (stale.length) {
    const rd = await fetch(base + '/rest/v1/crm_etat?id=in.("' + stale.join('","') + '")', { method: "DELETE", headers: h });
    if (!rd.ok) throw new Error("cleanup shards " + rd.status);
  }
  return { nbShards: shards.length, staleSupprimes: stale.length };
}


// ============================================================
// /api/sync-contacts — Synchronise les contacts du CRM vers
// l'annuaire Ringover, pour que le NOM s'affiche sur les appels
// entrants et sortants dans l'appli Ringover (mobile + desktop).
// Stratégie : upsert via POST /v2/contacts (retrieve or create).
// Calibration : chaque réponse Ringover est journalisée dans les
// logs Vercel — à la 1re exécution, vérifier les payloads réels
// et ajuster (même méthode que le webhook appels).
// ============================================================

const API = "https://public-api.ringover.com/v2";

interface Rep {
  status: number;
  body: string;
}

async function ringo(methode: string, chemin: string, cle: string, corps?: unknown, maxCorp?: number): Promise<Rep> {
  try {
    const r = await fetch(API + chemin, {
      method: methode,
      headers: {
        // Auth Ringover = clé brute SANS Bearer (validé par le webhook appels)
        Authorization: cle,
        "Content-Type": "application/json",
      },
      body: corps ? JSON.stringify(corps) : undefined,
    });
    const t = await r.text();
    return { status: r.status, body: t.slice(0, maxCorp || 2000) };
  } catch (e) {
    return { status: 0, body: String(e) };
  }
}

// Conversion pour l'API Ringover : numbers[].number doit être un ENTIER au
// format international (33684625266), JAMAIS une chaîne ni un 0 initial
// (erreur 400 « expected integer » validée sur les vraies réponses).
function telEntier(tel: string): number {
  const d = (tel || "").replace(/\D/g, "");
  if (!d) return 0;
  if (d.startsWith("0")) return parseInt("33" + d.slice(1), 10);
  return parseInt(d, 10);
}

// Normalisation de téléphone : chiffres, 33 <-> 0
function normTel(s: string): string {
  const d = (s || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("33") && d.length >= 11) return "0" + d.slice(2);
  return d;
}

function propre(s: unknown): string {
  return typeof s === "string" ? s.trim() : "";
}

interface ContactCRM {
  prenom: string;
  nom: string;
  societe: string;
  tel: string;
  tel2: string;
  email: string;
  cle: string;
}

export default async function handler(req: any, res: any) {
  const base = new URL(req.url || "/", "http://localhost");

  // --- Mode TEMPS RÉEL : POST avec un seul contact en payload ---
  // Appelé par le CRM à chaque création/modif d'un contact avec tél.
  if (req.method === "POST" && req.body && req.body.contact) {
    const cle = process.env.RINGOVER_API_KEY;
    if (!cle) return res.status(503).json({ erreur: "RINGOVER_API_KEY absente" });
    const c = req.body.contact as any;
    // Multi-numéros : accepte tel (chaîne) ou tels (tableau)
    const telsBruts: string[] = Array.isArray(c.tels) ? c.tels.map((x: any) => propre(x)) : [propre(c.tel)];
    const tels = [...new Set(telsBruts.map(normTel).filter((x: string) => x && x.length >= 9))];
    if (!tels.length) return res.status(400).json({ erreur: "Numéro invalide", tel: propre(c.tel) });
    const anciensBruts: string[] = Array.isArray(c.anciens) ? c.anciens.map((x: any) => propre(x)) : [];
    const anciens = [...new Set(anciensBruts.map(normTel).filter((x: string) => x && x.length >= 9))];
    const prenom = propre(c.prenom);
    const nom = propre(c.nom);
    const societe = propre(c.societe);
    const email = propre(c.email);
    // UPSERT : supprimer les fiches Ringover existantes portant un de ces numéros,
    // puis recréer la carte à jour (le POST Ringover ne fait pas de mise à jour)
    const numsEntiers = new Set([...tels, ...anciens].map(telEntier));
    const aSupprimer: number[] = [];
    try {
      const repListeU = await ringo("GET", "/contacts?limit_count=100", cle, undefined, 400000);
      const du: any = JSON.parse(repListeU.body);
      const itemsU: any[] = Array.isArray(du) ? du : (du.contact_list || du.list || []);
      for (const it of itemsU) {
        const numsIt = (it.numbers || it.phone_numbers || []).map((n: any) => (typeof n === "object" ? n.number : n));
        if (!numsIt.some((n: any) => numsEntiers.has(n))) continue;
        // COLLÈGUE PROTÉGÉ : une fiche NOMMÉE qui possède aussi un numéro
        // hors de notre ensemble (autre employé partageant le fixe) ne nous
        // concerne pas -> on la garde. Sinon c'est notre ancienne fiche.
        const nommee = !!(it.firstname || it.lastname);
        if (nommee && numsIt.some((n: any) => !numsEntiers.has(n))) continue;
        aSupprimer.push(it.contact_id);
      }
    } catch (e) { /* liste illisible -> on tente la création */ }
    for (const idS of [...new Set(aSupprimer)]) {
      await ringo("DELETE", "/contacts/" + idS, cle);
      await new Promise((r3) => setTimeout(r3, 250));
    }
    // Format OFFICIEL validé (source : connecteur Pipedream Ringover create-contact) :
    // {contacts:[{firstname, lastname, company, is_shared, numbers:[{number, type}]}]}
    const nomAffiche = nom ? (societe ? nom + " (" + societe + ")" : nom) : "";
    const corps: any = {
      contacts: [{
        firstname: prenom,
        lastname: nomAffiche,
        company: societe,
        is_shared: true,
        numbers: tels.map((x: string) => ({ number: telEntier(x), type: "other" })),
      }],
    };
    if (email) corps.contacts[0].email = email;
    const rep = await ringo("POST", "/contacts", cle, corps);
    console.log("SYNC CONTACT (unitaire)", JSON.stringify({ tels, nom: (prenom + " " + nom).trim(), status: rep.status, reponse: rep.body }));
    if (rep.status >= 200 && rep.status < 300) {
      return res.status(200).json({ ok: true, status: rep.status, nom: (prenom + " " + nom).trim(), supprimes: aSupprimer.length, tels });
    }
    return res.status(502).json({ ok: false, status: rep.status, reponse: rep.body.slice(0, 500), note: "Format à calibrer — voir logs Vercel" });
  }

  // --- Mode GET ?purge=1 : SUPPRIMER les doublons (garder la fiche la plus récente par numéro) ---
  if (req.method === "GET" && base.searchParams.get("purge") === "1") {
    const cleP = process.env.RINGOVER_API_KEY;
    if (!cleP) return res.status(503).json({ erreur: "RINGOVER_API_KEY absente" });
    const parNumero = new Map<number, any[]>();
    let total = 0, structure: string[] = [];
    for (let page = 0; page < 5; page++) {
      const rep = await ringo("GET", "/contacts?limit_count=100&limit_offset=" + (page * 100), cleP, undefined, 400000);
      if (rep.status < 200 || rep.status >= 300) return res.status(502).json({ erreur: "Liste illisible", status: rep.status, reponse: rep.body.slice(0, 300) });
      let data: any;
      try { data = JSON.parse(rep.body); } catch (e) { return res.status(502).json({ erreur: "JSON invalide", apercu: rep.body.slice(0, 300) }); }
      const items: any[] = Array.isArray(data) ? data : (data.contact_list || data.list || []);
      if (!items.length) break;
      if (!structure.length && items[0]) structure = Object.keys(items[0]);
      for (const it of items) {
        const nums: number[] = (it.numbers || it.phone_numbers || []).map((n: any) => (typeof n === "object" ? n.number : n)).filter((n: any) => !!n);
        if (!nums.length) nums.push(-1 * (it.contact_id || 0));
        for (const n of nums) {
          if (!parNumero.has(n)) parNumero.set(n, []);
          parNumero.get(n).push(it);
        }
      }
      total += items.length;
      if (items.length < 100) break;
    }
    const supprimes: any[] = [], erreursP: any[] = [];
    for (const [num, items] of parNumero) {
      if (items.length <= 1) continue;
      const tries = [...items].sort((a: any, b: any) => (b.creation_date || "").localeCompare(a.creation_date || "") || (b.contact_id || 0) - (a.contact_id || 0));
      for (const vieux of tries.slice(1)) {
        const rep = await ringo("DELETE", "/contacts/" + vieux.contact_id, cleP);
        if (rep.status >= 200 && rep.status < 300) supprimes.push({ id: vieux.contact_id, nom: ((vieux.firstname || "") + " " + (vieux.lastname || "")).trim(), num });
        else erreursP.push({ id: vieux.contact_id, status: rep.status, reponse: rep.body.slice(0, 200) });
        await new Promise((rs) => setTimeout(rs, 250));
      }
    }
    return res.status(200).json({ total, groupes: parNumero.size, nbSupprimes: supprimes.length, supprimes, erreursP, structure });
  }

  // --- Mode GET ?list=1 : LISTER les contacts côté Ringover (vérification) ---
  if (req.method === "GET" && base.searchParams.get("list") === "1") {
    const cleList = process.env.RINGOVER_API_KEY;
    if (!cleList) return res.status(503).json({ erreur: "RINGOVER_API_KEY absente" });
    const rep = await ringo("GET", "/contacts?limit_count=100", cleList, undefined, 400000);
    let contacts: any = null;
    try { contacts = JSON.parse(rep.body); } catch (e) { contacts = rep.body.slice(0, 500); }
    const liste = Array.isArray(contacts) ? contacts : (contacts && typeof contacts === "object" && Array.isArray(contacts.contact_list)) ? contacts.contact_list : (contacts && typeof contacts === "object" && Array.isArray(contacts.list)) ? contacts.list : null;
    let resume: any = null;
    if (liste) {
      const parNum: any = {};
      for (const it of liste) {
        for (const n of it.numbers || []) {
          const num = (typeof n === "object" ? n.number : n);
          if (!parNum[num]) parNum[num] = [];
          parNum[num].push({ id: it.contact_id, prenom: it.firstname, nom: it.lastname, societe: it.company });
        }
      }
      resume = parNum;
    }
    return res.status(rep.status >= 200 && rep.status < 300 ? 200 : 502).json({ status: rep.status, nb: liste ? liste.length : "?", contact_list_count: (contacts && contacts.contact_list_count) || "?", resumeParNumero: resume, apercu: liste ? liste.slice(0, 10) : contacts });
  }

  // --- Déclencheur GET ?run=1 : sync complète depuis le navigateur ---
  const lancerSync = req.method === "GET" && base.searchParams.get("run") === "1";
  if (lancerSync) req.method = "POST-BATCH";
  const modeRebuild = req.method === "GET" && base.searchParams.get("rebuild") === "1";
  if (modeRebuild) req.method = "POST-BATCH";

  // --- Diagnostic GET ---
  if (req.method === "GET") {
    return res.status(200).json({
      version: "b-upsert",
      message: "Sync contacts CRM -> Ringover. POST sans body = sync complète du répertoire ; POST {contact:{prenom,nom,societe,tel,email}} = temps réel unitaire.",
      RINGOVER_API_KEY: !!process.env.RINGOVER_API_KEY,
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
  }
  if (req.method !== "POST" && req.method !== "POST-BATCH") {
    return res.status(400).json({ erreur: "POST uniquement (GET = diagnostic)" });
  }

  // --- Mode BATCH : sync complète du répertoire ---
  const cle = process.env.RINGOVER_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!cle || !supabaseUrl || !supaKey) {
    return res.status(503).json({
      erreur: "Variables manquantes (RINGOVER_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)",
      RINGOVER_API_KEY: !!cle,
      SUPABASE_URL: !!supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: !!supaKey,
    });
  }

  // 1. Lire l'état du CRM (même table crm_etat que le webhook, lecture shardée)
  let etat: any = null;
  try {
    etat = (await lireEtat(String(supabaseUrl), String(supaKey))).etat;
  } catch (e: any) {
    return res.status(502).json({ erreur: "Supabase illisible", detail: String(e).slice(0, 200) });
  }
  if (!etat || !Array.isArray(etat.contacts)) {
    return res.status(404).json({ erreur: "crm_etat introuvable / structure inconnue" });
  }

  // 2. Collecter les contacts à pousser (dédoublonnés par numéro)
  const vus = new Set<string>();
  const aPousser: ContactCRM[] = [];
  const entreprises: any[] = etat.entreprises || [];
  const contacts: any[] = etat.contacts || [];
  const nomDe = (eid: string) => {
    const e = entreprises.find((x) => x.id === eid);
    return e ? propre(e.nomCommercial || e.nom) : "";
  };
  for (const c of contacts) {
    const tel = normTel(propre(c.tel));
    if (!tel || tel.length < 9 || vus.has(tel)) continue;
    vus.add(tel);
    const entC = c.entrepriseIds && c.entrepriseIds[0] ? entreprises.find((x) => x.id === c.entrepriseIds[0]) : undefined;
    aPousser.push({
      prenom: propre(c.prenom),
      nom: propre(c.nom),
      societe: c.entrepriseIds && c.entrepriseIds.length ? nomDe(c.entrepriseIds[0]) : propre(c.entreprise || c.societe),
      tel,
      tel2: entC ? normTel(propre(entC.tel)) : "",
      email: propre(c.email), cle: tel,
    });
  }
  // Entreprises avec téléphone fixe -> contact "société"
  for (const e of entreprises) {
    const tel = normTel(propre(e.tel));
    if (!tel || tel.length < 9 || vus.has(tel)) continue;
    // Fiche société TOUJOURS créée (elle porte le fixe) : l'appli Ringover
    // y rattache les contacts qui portent le même nom `company` (sous-contacts).
    vus.add(tel);
    aPousser.push({
      prenom: "",
      nom: "",
      societe: propre(e.nomCommercial || e.nom),
      tel, tel2: "", email: "", cle: tel,
    });
  }

  // 2ter-prep. Nettoyage du nom CRM puis suffixe " (SOCIETE)" : le nom affiché
  // par Ringover identifie l'appartenance à l'entreprise (ex. "CIOVEL (CIAO PIZZA...)").
  for (const c of aPousser) {
    const m = c.nom.match(/^(.*?)\s*\((.+)\)\s*$/);
    if (m) {
      c.nom = m[1].trim();
      if (!c.societe) c.societe = m[2].trim();
    }
    if (c.nom && c.prenom && c.societe && !c.nom.endsWith("(" + c.societe + ")")) {
      c.nom = c.nom + " (" + c.societe + ")";
    }
  }

  // 2bis. Numéros déjà présents côté Ringover (anti-doublon)
  const existants = new Set<number>();
  const cartesParNum = new Map<number, Set<number>[]>(); // num -> les cartes Ringover qui le portent
  const cartesB: { nums: Set<number>; societe: string; prenom: string; nom: string }[] = [];
  try {
    const repListeB = await ringo("GET", "/contacts?limit_count=100", cle, undefined, 400000);
    const db: any = JSON.parse(repListeB.body);
    const itemsB: any[] = Array.isArray(db) ? db : (db.contact_list || db.list || []);
    for (const it of itemsB) {
      const numsCarteB = new Set<number>((it.numbers || it.phone_numbers || []).map((n: any) => (typeof n === "object" ? n.number : n)));
      cartesB.push({ id: it.contact_id, nums: numsCarteB, societe: propre(it.company), prenom: propre(it.firstname), nom: propre(it.lastname) });
      for (const n of numsCarteB) {
        existants.add(n);
        if (!cartesParNum.has(n)) cartesParNum.set(n, []);
        cartesParNum.get(n).push(numsCarteB);
      }
    }
  } catch (e) { /* liste illisible */ }

  // 2quater. Mode rebuild : supprimer d'abord TOUTES les fiches Ringover portant un numéro du CRM
  let supprimesR: any[] = [];
  if (modeRebuild) {
    const mesNums = new Set(aPousser.flatMap((c) => [c.tel, c.tel2].filter(Boolean).map(telEntier)));
    for (let pageR = 0; pageR < 5; pageR++) {
      const rep = await ringo("GET", "/contacts?limit_count=100&limit_offset=" + (pageR * 100), cle, undefined, 400000);
      if (rep.status < 200 || rep.status >= 300) break;
      let dataR: any;
      try { dataR = JSON.parse(rep.body); } catch (e) { break; }
      const itemsR: any[] = Array.isArray(dataR) ? dataR : (dataR.contact_list || dataR.list || []);
      if (!itemsR.length) break;
      for (const it of itemsR) {
        const numsR = (it.numbers || []).map((n: any) => (typeof n === "object" ? n.number : n));
        if (numsR.some((n: any) => mesNums.has(n))) {
          const repD = await ringo("DELETE", "/contacts/" + it.contact_id, cle);
          supprimesR.push({ id: it.contact_id, nom: ((it.firstname || "") + " " + (it.lastname || "")).trim(), ok: repD.status >= 200 && repD.status < 300, status: repD.status });
          await new Promise((r2) => setTimeout(r2, 250));
        }
      }
      if (itemsR.length < 100) break;
    }
    existants.clear();
    cartesB.length = 0;
    cartesParNum.clear();
  }

  // 3. Pousser vers Ringover (upsert), 2 req/s max
  const journal: any[] = [];
  let ok = 0, erreurs = 0;
  for (const c of aPousser.slice(0, 300)) {
    const numsCarte = [...new Set([c.tel, c.tel2].filter(Boolean).map(telEntier))];
    // Skip seulement si UNE MÊME carte Ringover porte DÉJÀ TOUS les numéros
    // (mobile + fixe société ensemble). Le fixe seul sur la carte société ne suffit pas.
    const carteComplete = numsCarte.length > 0 && cartesB.some((cb) =>
      (cb.prenom || cb.nom) && cb.nom === c.nom && cb.prenom === c.prenom &&
      numsCarte.every((m: number) => cb.nums.has(m)));
    // Fiche SOCIÉTÉ (prénom/nom vides) : ne pas skipper parce qu'un EMPLOYÉ porte le fixe.
    // Elle est conservée seulement s'il existe DÉJÀ une carte société du même nom avec ce numéro.
    const estSociete = !c.prenom && !c.nom;
    const societeDeja = estSociete && cartesB.some((cb) =>
      !cb.prenom && !cb.nom && cb.societe === c.societe && cb.nums.has(numsCarte[0]));
    if (estSociete ? societeDeja : carteComplete) {
      journal.push({ cle: c.cle, nom: (c.prenom + " " + c.nom).trim(), status: "deja", reponse: "d\u00e9j\u00e0 pr\u00e9sent, conserv\u00e9" });
      continue;
    }
    // Format OFFICIEL (cf. mode unitaire) : {contacts:[{...}], is_shared}
    const corps: any = {
      contacts: [{
        firstname: c.prenom,
        lastname: c.nom,
        company: c.societe,
        is_shared: true,
        numbers: [...new Set([c.tel, c.tel2].filter(Boolean).map(telEntier))].map((n: number) => ({ number: n, type: "other" })),
      }],
    };
    if (c.email) corps.contacts[0].email = c.email;
    // UPSERT : supprimer d'abord les anciennes cartes portant ces numéros
    // (sinon POST recrée à côté -> doublons). Même règle que le temps réel :
    // une fiche NOMMÉE qui possède aussi un numéro hors de cette carte est protégée.
    for (const cb of cartesB) {
      if (!numsCarte.some((m: number) => cb.nums.has(m))) continue;
      const nommee = !!(cb.prenom || cb.nom);
      if (nommee && [...cb.nums].some((n: number) => !numsCarte.includes(n))) continue;
      await ringo("DELETE", "/contacts/" + cb.id, cle);
      await new Promise((r4) => setTimeout(r4, 250));
    }
    const rep = await ringo("POST", "/contacts", cle, corps);
    journal.push({ cle: c.cle, nom: (c.prenom + " " + c.nom).trim(), status: rep.status, reponse: rep.body.slice(0, 400) });
    if (rep.status >= 200 && rep.status < 300) ok++; else erreurs++;
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log("SYNC CONTACTS RINGOVER", JSON.stringify({ envoyes: aPousser.length, ok, erreurs, premierEchec: journal.find((j) => j.status >= 300) || null }));
  return res.status(200).json({
    version: "b-upsert",
    envoyes: aPousser.length,
    supprimesAvant: supprimesR.length,
    supprimesDetail: supprimesR.slice(0, 40),
    ok,
    erreurs,
    journal: journal.slice(0, 20),
    note: "Vérifier les logs Vercel pour les payloads complets — calibrer le format si erreurs (même méthode que le webhook appels).",
  });
}
