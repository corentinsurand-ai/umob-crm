// –– Endpoint serverless Vercel : envoi RÉEL du devis par mail via Resend (CRM U'mob).
// POST { dest, objet, corps, pdfBase64, nomPdf } → 200 { ok: true, id }.
// Expéditeur : Corentin Surand — U'mob <corentin.surand@umob.fr> (domaine umob.fr
// vérifié côté Resend). Clé API uniquement côté serveur (jamais navigateur).
// Le PDF est construit par le navigateur (genererPdfDevis) et passé en base64
// en pièce jointe — aucune donnée devis n'est stockée ici.

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ erreur: "POST uniquement" });
  if (!process.env.RESEND_API_KEY) return res.status(503).json({ erreur: "RESEND_API_KEY absente côté serveur — ajoute-la dans Vercel (type Config) puis Redeploy." });
  try {
    const c: any = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const dest = (c.dest || "").trim();
    if (!dest || !/.+@.+\..+/.test(dest)) return res.status(400).json({ erreur: "Adresse destinataire manquante ou invalide." });
    if (!c.pdfBase64) return res.status(400).json({ erreur: "PDF manquant." });
    const rep = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.RESEND_API_KEY },
      body: JSON.stringify({
        from: "Corentin Surand — U'mob <corentin.surand@umob.fr>",
        to: [dest],
        reply_to: "corentin.surand@umob.fr",
        subject: c.objet || "Offre de location U'mob",
        text: c.corps || "",
        attachments: [{ filename: c.nomPdf || "Devis-Umob.pdf", content: c.pdfBase64 }],
      }),
    });
    if (!rep.ok) {
      const detail = await rep.text().catch(() => "");
      return res.status(502).json({ erreur: "Resend a répondu " + rep.status + (detail ? " — " + detail.slice(0, 300) : "") });
    }
    const data: any = await rep.json().catch(() => ({}));
    return res.status(200).json({ ok: true, id: data?.id || "" });
  } catch (e: any) {
    return res.status(500).json({ erreur: (e && e.message) || "Erreur serveur" });
  }
}
