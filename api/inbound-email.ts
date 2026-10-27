// ── E-mails entrants → quarantaine CRM U'mob ────────────────────────────────
// Fonction serverless Vercel : l'automatisation Make (surveillance IMAP de la
// boîte OVH) pousse ici chaque nouvel e-mail de demande entrante.
//
// POST /api/inbound-email   → quarantaine (RÈGLE FORTE : rien n'entre dans le
//   CRM sans validation humaine — l'e-mail est stocké dans la table dédiée
//   crm_arrivees, l'utilisateur valide ensuite dans la vue « 📥 Entrantes ») :
//   1. vérifie le secret partagé (INBOUND_EMAIL_SECRET, header x-webhook-secret
//      ou ?secret=… — exigé si défini)
//   2. normalise le message (texte brut prioritaire, HTML débarassé des balises)
//   3. extraction IA Mistral (nom entreprise, ville, secteur, contact, besoin) —
//      JAMAIS d'invention : champ vide si l'e-mail ne le dit pas
//   4. dédoublonne par messageId (re-POST du même e-mail = ignoré)
//   5. insère la ligne dans crm_arrivees (service role : la RLS ne s'applique
//      qu'aux utilisateurs connectés, Make n'a pas de session)
// GET  /api/inbound-email   → diagnostic : variables présentes + compteur.
//
// Payload attendu (Make, module HTTP) : { messageId, from, fromName, subject,
// text, html, date } — messageId est indispensable pour le dédoublonnage.
const SUP: string = process.env.SUPABASE_URL || "";
const KEY: string = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const MIST: string = process.env.MISTRAL_API_KEY || "";
const SECRET: string = process.env.INBOUND_EMAIL_SECRET || "";

const PROMPT = "Tu analyses un e-mail reçu par la société U'mob (location de scooters électriques à des professionnels, surtout restauration/livraison). Réponds UNIQUEMENT par un objet JSON, sans markdown, avec exactement ces clés : nomEntreprise (nom de la société qui écrit, vide si elle ne se présente pas), ville, secteur, prenom, nom, role, tel (numéro de téléphone figurant dans l'e-mail), besoin (besoin exprimé en une phrase courte : nombre de scooters, zone, budget, délai…), resume (résumé en 2 phrases max). RÈGLES ABSOLUES : n'invente RIEN ; chaque clé reste une chaîne VIDE si l'information n'est pas explicitement écrite dans l'e-mail ; ne mets JAMAIS U'mob comme nomEntreprise ; écris U'mob exactement ainsi avec l'apostrophe.";

const sansBalises = (h: string) => String(h || "")
  .replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

export default async function handler(req: any, res: any) {
  if (req.method === "GET") {
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

  const p: any = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) || {};
  const messageId = String(p.messageId ?? p.uid ?? p.id ?? Date.now());
  const deEmail = String(p.from || p.sender || "").replace(/^.*<|>.*$/g, "").trim().toLowerCase();
  const deNom = String(p.fromName || p.senderName || (p.from || "").replace(/<.*>/, "").replace(/"/g, "").trim() || "").slice(0, 120);
  const sujet = String(p.subject || p.sujet || "").slice(0, 300);
  const messageBrut = String(p.text || p.plain || "") || sansBalises(String(p.html || ""));
  const message = messageBrut.slice(0, 20000);

  const sbH: any = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
  // Dédoublonnage : le même e-mail re-poussé (relance du scénario Make) est ignoré.
  const rex = await fetch(SUP + "/rest/v1/crm_arrivees?id=eq." + encodeURIComponent(messageId) + "&select=id", { headers: sbH });
  if (rex.ok) { const rows: any[] = await rex.json(); if (rows.length) return res.status(200).json({ ok: true, note: "déjà en quarantaine", messageId }); }

  // Extraction IA (facultative : sans clé Mistral, l'e-mail part tel quel —
  // l'humain lira le message complet dans la quarantaine).
  let ia: any = {};
  if (MIST && message.length > 20) {
    try {
      const rm = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + MIST },
        body: JSON.stringify({ model: "mistral-small-latest", temperature: 0.2, max_tokens: 900,
          messages: [ { role: "system", content: PROMPT },
            { role: "user", content: "Expéditeur : " + deNom + " <" + deEmail + ">\nSujet : " + sujet + "\n\n" + message.slice(0, 12000) } ] }),
      });
      if (rm.ok) {
        const jm: any = await rm.json();
        const t: string = (jm.choices && jm.choices[0] && jm.choices[0].message && jm.choices[0].message.content) || "";
        const m2 = t.match(/\{[\s\S]*\}/);
        if (m2) { try { ia = JSON.parse(m2[0]); } catch { ia = {}; } }
      }
    } catch (e) { console.log("Mistral erreur:", e); }
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
  return res.status(200).json({ ok: true, quarantaine: true, messageId });
}
