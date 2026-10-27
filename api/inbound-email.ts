// ── E-mails entrants → tri IA → quarantaine CRM U'mob ────────────────────────
// Fonction serverless Vercel : l'automatisation Make (surveillance IMAP de la
// boîte OVH) pousse ici CHAQUE e-mail reçu. L'IA analyse le message et :
//
//   • ressemble à une DEMANDE ENTRANTE (prospect qui se renseigne, demande de
//     devis, prise de contact, SAV client…) → quarantaine crm_arrivees, pour
//     validation humaine dans la vue « 📥 Entrantes » du CRM ;
//   • newsletter / notification / spam / administratif / e-mail personnel →
//     IGNORÉ silencieusement (répond { ignore: true }, rien en base) ;
//   • IA injoignable ou e-mail trop court pour être analysé → quarantaine par
//     PRUDENCE (l'humain décide, règle forte : jamais de perte silencieuse
//     d'un message qui aurait pu être une demande).
//
// POST /api/inbound-email  → secret partagé (INBOUND_EMAIL_SECRET, header
//   x-webhook-secret ou ?secret=…), payload Make : { messageId, from,
//   fromName, subject, text, html, date }. Dédoublonnage par messageId.
// GET  /api/inbound-email  → diagnostic : variables présentes.
const SUP: string = process.env.SUPABASE_URL || "";
const KEY: string = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const MIST: string = process.env.MISTRAL_API_KEY || "";
const SECRET: string = process.env.INBOUND_EMAIL_SECRET || "";

// Un seul appel IA pour DEUX jobs : (1) classification — est-ce une demande
// entrante d'un prospect/client U'mob, ou du bruit à ignorer ; (2) extraction
// des indications. RÈGLE ABSOLUE : n'invente RIEN, champ vide si l'e-mail ne
// le dit pas explicitement.
const PROMPT = "Tu analyses un e-mail reçu par la société U'mob (location de scooters électriques à des professionnels, surtout restauration/livraison). Réponds UNIQUEMENT par un objet JSON, sans markdown, avec EXACTEMENT ces clés : estDemande (booléen true/false : true UNIQUEMENT si l'expéditeur est un PROSPECT potentiel qui écrit pour devenir client — question sur l'offre, demande de devis ou de renseignement commercial, prise de contact pour s'équiper ; false dans TOUS les autres cas : demandes de SAV ou réclamations de clients existants, candidatures spontanées, newsletters, notifications automatiques, spams, e-mails administratifs, factures, e-mails personnels, fournisseurs — même si l'e-mail vient d'un client U'mob existant, un SAV n'est PAS une demande entrante) ; categorie (une seule valeur parmi 'demande', 'sav', 'candidature', 'admin', 'newsletter', 'spam', 'autre') ; raison (en français, 15 mots max, pourquoi cette classification) ; nomEntreprise (nom de la société qui écrit, VIDE si elle ne se présente pas ; ne mets JAMAIS U'mob) ; ville ; secteur ; prenom ; nom ; role ; tel (numéro de téléphone figurant DANS l'e-mail, VIDE sinon) ; besoin (besoin exprimé en une phrase courte : nombre de scooters, zone, budget, délai…) ; resume (résumé en 2 phrases max). RÈGLES ABSOLUES : n'invente RIEN, chaque clé reste une chaîne VIDE si l'information n'est pas explicitement écrite dans l'e-mail ; écris U'mob exactement ainsi avec l'apostrophe.";

const sansBalises = (h: string) => String(h || "")
  .replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

const analyseIA = async (deNom: string, deEmail: string, sujet: string, message: string): Promise<any> => {
  const rm = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + MIST },
    body: JSON.stringify({ model: "mistral-small-latest", temperature: 0.2, max_tokens: 900,
      messages: [ { role: "system", content: PROMPT },
        { role: "user", content: "Expéditeur : " + deNom + " <" + deEmail + ">\nSujet : " + sujet + "\n\n" + message.slice(0, 12000) } ] }),
  });
  if (!rm.ok) throw new Error("mistral " + rm.status);
  const jm: any = await rm.json();
  const t: string = (jm.choices && jm.choices[0] && jm.choices[0].message && jm.choices[0].message.content) || "";
  const m2 = t.match(/\{[\s\S]*\}/);
  if (!m2) throw new Error("pas de json");
  return JSON.parse(m2[0]);
};

const deEmailB = (p: any) => String(p.from || p.sender || "").replace(/^.*<|>.*$/g, "").trim().toLowerCase();

export default async function handler(req: any, res: any) {
  if (req.method === "GET") {
    // Mode vérification du secret : ?check=XXX compare au secret ACTIF du
    // déploiement (utile pour déboguer un 401 : la valeur d'une variable
    // Vercel ne s'applique qu'après un Redeploy). On ne révèle jamais le
    // secret — seulement si le test correspond, et sa longueur.
    const u0 = new URL(req.url || "/", "http://localhost");
    const essai = u0.searchParams.get("check");
    if (essai !== null) {
      return res.status(200).json({ ok: true, service: "inbound-email",
        secretOk: SECRET === essai,
        longueurAttendue: SECRET ? SECRET.length : 0, longueurRecue: essai.length,
        note: "Si secretOk=false : la valeur testée n'est pas celle du déploiement actif — vérifie la variable Vercel ET fais un Redeploy." });
    }
    return res.status(200).json({ ok: true, service: "inbound-email", variables: {
      SUPABASE_URL: !!SUP, SUPABASE_SERVICE_ROLE_KEY: !!KEY, MISTRAL_API_KEY: !!MIST, INBOUND_EMAIL_SECRET: !!SECRET } });
  }
  // ── Secret partagé : sans lui, quiconque connaît l'URL pourrait injecter
  // de faux e-mails dans la quarantaine. ──
  if (SECRET) {
    const u = new URL(req.url || "/", "http://localhost");
    const fourni = String((req.headers && req.headers["x-webhook-secret"]) || u.searchParams.get("secret") || "");
    if (fourni !== SECRET) return res.status(401).json({ ok: false, erreur: "secret invalide" });
  }
  if (!SUP || !KEY) return res.status(500).json({ ok: false, erreur: "config serveur incomplète" });

  // Payload accepté en JSON OU en formulaire (application/x-www-form-urlencoded,
  // le format que Make construit sans jamais casser sur les guillemets/retours
  // à la ligne du contenu d'e-mail).
  let p: any = {};
  const brut: any = req.body;
  if (typeof brut === "string" && brut.trim()) {
    const t = brut.trim();
    if (t.startsWith("{")) {
      try { p = JSON.parse(t); } catch { p = Object.fromEntries(new URLSearchParams(t)); }
    } else {
      p = Object.fromEntries(new URLSearchParams(t));
    }
  } else if (brut && typeof brut === "object") {
    p = brut;
  }
  // Dédoublonnage robuste : si Make ne fournit pas d'ID de message, on en
  // fabrique un déterministe à partir de l'expéditeur + sujet + date (le
  // même e-mail re-poussé donnera le même ID, pas un timestamp aléatoire).
  const messageId = String(p.messageId || p.uid || p.id || ""
    || (("mk-" + deEmailB(p) + "|" + String(p.subject || "") + "|" + String(p.date || "")).replace(/[^a-zA-Z0-9@.\-|]/g, "").slice(0, 180)));
  const deEmail = String(p.from || p.sender || "").replace(/^.*<|>.*$/g, "").trim().toLowerCase();
  const deNom = String(p.fromName || p.senderName || (p.from || "").replace(/<.*>/, "").replace(/"/g, "").trim() || "").slice(0, 120);
  const sujet = String(p.subject || p.sujet || "").slice(0, 300);
  const messageBrut = String(p.text || p.plain || "") || sansBalises(String(p.html || ""));
  const message = messageBrut.slice(0, 20000);

  const sbH: any = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
  // Dédoublonnage : le même e-mail re-poussé (relance du scénario Make) est ignoré.
  const rex = await fetch(SUP + "/rest/v1/crm_arrivees?id=eq." + encodeURIComponent(messageId) + "&select=id", { headers: sbH });
  if (rex.ok) { const rows: any[] = await rex.json(); if (rows.length) return res.status(200).json({ ok: true, note: "déjà en quarantaine", messageId }); }

  // ── Classification + extraction IA. Trois issues :
  //   estDemande === false  → ignoré silencieusement (newsletter, spam…)
  //   estDemande === true    → quarantaine
  //   IA injoignable / e-mail trop court / réponses illisibles → quarantaine
  //   PAR PRUDENCE (l'humain décide — jamais de perte silencieuse).
  let ia: any = {};
  let classe = "incertain";
  if (MIST && message.length > 30) {
    try {
      ia = await analyseIA(deNom, deEmail, sujet, message);
      classe = ia.estDemande === true ? "demande" : ia.estDemande === false ? "non_demande" : "incertain";
    } catch (e: any) { console.log("Mistral erreur:", e?.message || e); }
  }
  if (classe === "non_demande") {
    return res.status(200).json({ ok: true, ignore: true, categorie: String(ia.categorie || "autre").slice(0, 30), raison: String(ia.raison || "").slice(0, 120) });
  }

  // Repli regex : téléphone français dans le corps si l'IA ne l'a pas trouvé.
  const telIA = String(ia.tel || "").replace(/\D/g, "");
  let tel = telIA;
  if (tel.length < 6) {
    const m = message.match(/(?:\+33|\b0)\s?[1-9](?:[\s.\-]?\d{2}){4}/);
    if (m) tel = m[0];
  }

  const data = {
    deNom, deEmail, sujet, message: messageBrut.slice(0, 6000),
    // Classification conservée avec l'entrée : la carte de quarantaine
    // l'affiche (transparence — l'humain voit POURQUOI l'e-mail est là).
    classe: classe === "demande" ? String(ia.categorie || "demande").slice(0, 30) : "incertain",
    raisonIA: String(ia.raison || "").slice(0, 160),
    nomEntreprise: String(ia.nomEntreprise || "").slice(0, 120),
    ville: String(ia.ville || "").slice(0, 80),
    secteur: String(ia.secteur || "").slice(0, 80),
    prenom: String(ia.prenom || "").slice(0, 60),
    nom: String(ia.nom || "").slice(0, 60),
    tel: String(tel || "").slice(0, 20),
    besoin: String(ia.besoin || ia.resume || "").slice(0, 300),
  };
  const ins = await fetch(SUP + "/rest/v1/crm_arrivees", {
    method: "POST",
    headers: { ...sbH, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([{ id: messageId, data, recu_le: p.date ? new Date(p.date).toISOString() : new Date().toISOString() }]),
  });
  if (!ins.ok) return res.status(500).json({ ok: false, erreur: "supabase_ecriture", statut: ins.status, corps: (await ins.text()).slice(0, 200) });
  return res.status(200).json({ ok: true, quarantaine: true, messageId, classe: data.classe });
}
