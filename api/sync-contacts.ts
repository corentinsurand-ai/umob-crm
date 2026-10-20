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

async function ringo(methode: string, chemin: string, cle: string, corps?: unknown): Promise<Rep> {
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
    return { status: r.status, body: t.slice(0, 2000) };
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
    const tel = normTel(propre(c.tel));
    if (!tel || tel.length < 9) return res.status(400).json({ erreur: "Numéro invalide", tel: propre(c.tel) });
    const prenom = propre(c.prenom);
    const nom = propre(c.nom);
    const societe = propre(c.societe);
    const email = propre(c.email);
    // Format OFFICIEL validé (source : connecteur Pipedream Ringover create-contact) :
    // {contacts:[{firstname, lastname, company, is_shared, numbers:[{number, type}]}]}
    const corps: any = {
      contacts: [{
        firstname: prenom || (societe ? societe : ""),
        lastname: nom || "Inconnu",
        company: societe,
        is_shared: true,
        numbers: [{ number: telEntier(tel), type: "other" }],
      }],
    };
    if (email) corps.contacts[0].email = email;
    const rep = await ringo("POST", "/contacts", cle, corps);
    console.log("SYNC CONTACT (unitaire)", JSON.stringify({ tel, nom: (prenom + " " + nom).trim(), status: rep.status, reponse: rep.body }));
    if (rep.status >= 200 && rep.status < 300) {
      return res.status(200).json({ ok: true, status: rep.status, nom: (prenom + " " + nom).trim(), tel });
    }
    return res.status(502).json({ ok: false, status: rep.status, reponse: rep.body.slice(0, 500), note: "Format à calibrer — voir logs Vercel" });
  }

  // --- Mode GET ?list=1 : LISTER les contacts côté Ringover (vérification) ---
  if (req.method === "GET" && base.searchParams.get("list") === "1") {
    const cleList = process.env.RINGOVER_API_KEY;
    if (!cleList) return res.status(503).json({ erreur: "RINGOVER_API_KEY absente" });
    const rep = await ringo("GET", "/contacts?limit_count=100", cleList);
    let contacts: any = null;
    try { contacts = JSON.parse(rep.body); } catch (e) { contacts = rep.body.slice(0, 500); }
    const liste = Array.isArray(contacts) ? contacts : (contacts && typeof contacts === "object" && Array.isArray(contacts.contact_list)) ? contacts.contact_list : (contacts && typeof contacts === "object" && Array.isArray(contacts.list)) ? contacts.list : null;
    return res.status(rep.status >= 200 && rep.status < 300 ? 200 : 502).json({ status: rep.status, nb: liste ? liste.length : "?", apercu: liste ? liste.slice(0, 10) : contacts });
  }

  // --- Déclencheur GET ?run=1 : sync complète depuis le navigateur ---
  const lancerSync = req.method === "GET" && base.searchParams.get("run") === "1";
  if (lancerSync) req.method = "POST-BATCH";

  // --- Diagnostic GET ---
  if (req.method === "GET") {
    return res.status(200).json({
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

  // 1. Lire l'état du CRM (même table crm_etat que le webhook)
  const rEtat = await fetch(supabaseUrl + "/rest/v1/crm_etat?select=*", {
    headers: { apikey: supaKey, Authorization: "Bearer " + supaKey },
  });
  if (!rEtat.ok) {
    return res.status(502).json({ erreur: "Supabase illisible", status: rEtat.status });
  }
  const lignes = await rEtat.json();
  let etat: any = null;
  for (const l of lignes) {
    const candidat = l.etat || l.data || l.value || l;
    if (candidat && Array.isArray(candidat.contacts)) {
      if (!etat || JSON.stringify(candidat).length > JSON.stringify(etat).length) etat = candidat;
    }
  }
  if (!etat) {
    return res.status(404).json({ erreur: "crm_etat introuvable / structure inconnue", nbLignes: lignes.length });
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
    aPousser.push({
      prenom: propre(c.prenom),
      nom: propre(c.nom),
      societe: c.entrepriseIds && c.entrepriseIds.length ? nomDe(c.entrepriseIds[0]) : propre(c.entreprise || c.societe),
      tel, email: propre(c.email), cle: tel,
    });
  }
  // Entreprises avec téléphone fixe -> contact "société"
  for (const e of entreprises) {
    const tel = normTel(propre(e.tel));
    if (!tel || tel.length < 9 || vus.has(tel)) continue;
    vus.add(tel);
    aPousser.push({
      prenom: "",
      nom: propre(e.nomCommercial || e.nom),
      societe: propre(e.ville || ""),
      tel, email: "", cle: tel,
    });
  }

  // 3. Pousser vers Ringover (upsert), 2 req/s max
  const journal: any[] = [];
  let ok = 0, erreurs = 0;
  for (const c of aPousser.slice(0, 300)) {
    // Format OFFICIEL (cf. mode unitaire) : {contacts:[{...}], is_shared}
    const corps: any = {
      contacts: [{
        firstname: c.prenom || (c.societe ? c.societe : ""),
        lastname: c.nom || "Inconnu",
        company: c.societe,
        is_shared: true,
        numbers: [{ number: telEntier(c.tel), type: "other" }],
      }],
    };
    if (c.email) corps.contacts[0].email = c.email;
    const rep = await ringo("POST", "/contacts", cle, corps);
    journal.push({ cle: c.cle, nom: (c.prenom + " " + c.nom).trim(), status: rep.status, reponse: rep.body.slice(0, 400) });
    if (rep.status >= 200 && rep.status < 300) ok++; else erreurs++;
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log("SYNC CONTACTS RINGOVER", JSON.stringify({ envoyes: aPousser.length, ok, erreurs, premierEchec: journal.find((j) => j.status >= 300) || null }));
  return res.status(200).json({
    envoyes: aPousser.length,
    ok,
    erreurs,
    journal: journal.slice(0, 20),
    note: "Vérifier les logs Vercel pour les payloads complets — calibrer le format si erreurs (même méthode que le webhook appels).",
  });
}
