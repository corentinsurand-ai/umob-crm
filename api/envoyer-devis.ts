// ── Endpoint serverless Vercel : envoi réel du devis par e-mail (via Resend).
// POST { destinataire, objet, texte, nomPdf?, pdfBase64? } → { ok, id }.
// Nécessite 2 variables d'environnement dans Vercel (Settings → Environment
// Variables) : RESEND_API_KEY (clé Resend) et MAIL_FROM (expéditeur vérifié,
// ex. "U'mob <corentin@umob.fr>" — domaine umob.fr validé chez Resend).
// Le HTML est composé côté serveur : en-tête logo U'mob, corps du message,
// signature complète. Le PDF passe en pièce jointe (base64).

// Logo officiel hébergé sur le site U'mob (mis en cache par les messageries).
const LOGO_URL = "https://umob.fr/wp-content/themes/g5_helium/custom/images/Logo-umob.png";

const echapper = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Texte brut → paragraphes HTML (styles inline uniquement : compatibilité messageries).
const corpsVersHtml = (texte: string): string =>
  texte.split(/\n{2,}/).map((b: string) => b.trim()).filter(Boolean)
    .map((b: string) => "<p style=\"margin:0 0 14px;\">" + echapper(b).replace(/\n/g, "<br/>") + "</p>")
    .join("");

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST uniquement" });
  if (!process.env.RESEND_API_KEY) return res.status(503).json({ error: "RESEND_API_KEY absente côté serveur" });
  if (!process.env.MAIL_FROM) return res.status(503).json({ error: "MAIL_FROM absente côté serveur" });
  try {
    const c: any = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const destinataire = String(c.destinataire || "").trim();
    const objet = String(c.objet || "").trim();
    const texte = String(c.texte || "");
    if (!destinataire || !objet) return res.status(400).json({ error: "Destinataire et objet requis" });

    const html = [
      "<div style=\"margin:0;padding:24px 12px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;\">",
      "<table role=\"presentation\" width=\"600\" align=\"center\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;\">",
      "<tr><td style=\"padding:22px 28px 18px;border-bottom:4px solid #A4D03D;\"><img src=\"" + LOGO_URL + "\" width=\"160\" alt=\"U'MOB\" style=\"display:block;border:0;\"/></td></tr>",
      "<tr><td style=\"padding:24px 28px 8px;color:#1e293b;font-size:14px;line-height:1.65;\">" + corpsVersHtml(texte) + "</td></tr>",
      "<tr><td style=\"padding:18px 28px 24px;color:#475569;font-size:13px;line-height:1.55;\">",
      "<hr style=\"border:none;border-top:2px solid #A4D03D;margin:0 0 16px;\"/>",
      "<p style=\"margin:0 0 2px;font-weight:bold;font-size:15px;color:#1e293b;\">Corentin Surand</p>",
      "<p style=\"margin:0 0 10px;font-weight:bold;color:#5c9e14;\">U'MOB — Scooters électriques en location</p>",
      "<p style=\"margin:0;\">53 avenue Carnot, 69250 Neuville-sur-Saône<br/>04 82 29 96 78 — <a href=\"https://www.umob.fr\" style=\"color:#5c9e14;\">www.umob.fr</a></p>",
      "</td></tr></table></div>",
    ].join("");

    const corps: any = { from: process.env.MAIL_FROM, to: [destinataire], subject: objet, html, text: texte };
    if (c.pdfBase64) corps.attachments = [{ filename: c.nomPdf || "Devis-Umob.pdf", content: c.pdfBase64 }];

    const rep = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.RESEND_API_KEY },
      body: JSON.stringify(corps),
    });
    const data: any = await rep.json();
    if (!rep.ok) return res.status(502).json({ error: (data && (data.message || data.name)) || "Refus Resend" });
    return res.status(200).json({ ok: true, id: data.id || null });
  } catch (e: any) {
    return res.status(500).json({ error: (e && e.message) || "Erreur serveur" });
  }
}
