// ── Régénération du résumé IA d'un appel ────────────────────────────────────
// POST /api/regenerer-resume  { transcription }
// Relance l'analyse Mistral (résumé, sentiment, sujets, score, action) sur la
// transcription stockée dans le CRM — bouton « ✨↻ Régénérer » de la fiche.
// Endpoint SANS ÉCRITURE : il renvoie l'analyse au front, qui met à jour
// l'activité en place ; la sauvegarde habituelle de l'état persiste.
const PROMPT_REGEN =
  "Tu analyses la transcription d'un appel téléphonique de la société U'mob (location de scooters électriques à des professionnels, surtout restauration/livraison). Réponds UNIQUEMENT par un objet JSON, sans markdown, avec exactement ces clés : " +
  "PERSPECTIVE : tu fais partie de l'équipe commerciale d'U'mob — TU ES U'MOB. Rédige le résumé du point de vue du commercial U'mob : l'interlocuteur externe est « le client » ou « le prospect » ; parle de « notre offre », « nos scooters », « notre pack Confort Plus » — JAMAIS de la société U'mob à la 3e personne (« la société U'mob propose… » interdit). Écris U'mob EXACTEMENT ainsi, avec l'apostrophe — jamais « UMob », « Umob », « U mob » ni « U-Mob ». " +
  "resume (résumé factuel en 2-3 phrases en français), sentiment ('positif', 'neutre' ou 'négatif'), sujets (sujets, objections et signaux d'achat séparés par des virgules), score (entier de 1 à 5, qualité commerciale de l'appel), action (prochaine action recommandée en une phrase). " +
  "scorecard (objet avec 7 critères du Plan de vente U'mob version téléphone, chacun { note: entier 0, 1 ou 2 (0 = absent, 1 = partiel, 2 = maîtrisé), j: une phrase factuelle justifiant la note) : accueil (accueil & cadre de l'appel), decouverte (découverte flotte & coûts : nombre de scooters, usage, coût essence mensuel, pannes), decisionnaire (décisionnaire & timing identifiés), comparatif (comparatif systématique : thermique, concurrent ou ancienne génération U'mob), prix (règle d'or : le prix n'est JAMAIS donné avant les 4 validations offre/maintenance/produit/48 mois — note 2 si la règle est respectée, 0 si le prix est annoncé trop tôt), objections (objections traitées sans confrontation, « c'est trop cher » → demander pourquoi), prochaineEtape (prochaine étape datée — l'objectif de l'appel sédentaire : qualifier + booker le RDV terrain)). Critère non observable dans cet appel → note 0 et j = 'non observé'. " +
  "MODÈLES DE SCOOTERS U'MOB : la gamme s'écrit EXACTEMENT « Infinity Pro », « Compact Pro », « Daily Pro » (version livraison : « S4-S5 Delivery »). Utilise TOUJOURS ces orthographes exactes — jamais « Infiniti Pro », « Infinity », « Compact pro », « DailyPro » ni d'autres variantes écorchées ; si la transcription déforme un nom de modèle, écris-le correctement. " +
  "RÈGLES ABSOLUES : n'invente RIEN, ne devine RIEN ; fonde chaque affirmation sur la transcription.";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, erreur: "POST uniquement" });
  const MIST: string = process.env.MISTRAL_API_KEY || "";
  if (!MIST) return res.status(500).json({ ok: false, erreur: "MISTRAL_API_KEY absente" });
  let transcription = "";
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    transcription = String(b.transcription || "");
  } catch (e) { transcription = ""; }
  if (transcription.trim().length < 20) return res.status(400).json({ ok: false, erreur: "transcription manquante ou trop courte" });
  try {
    const rm = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + MIST },
      body: JSON.stringify({
        model: "mistral-small-latest", temperature: 0.2, max_tokens: 1600, // 700 tronquait le JSON AVANT la clé scorecard (7 critères + justifications) — elle n'arrivait jamais
        messages: [
          { role: "system", content: PROMPT_REGEN },
          { role: "user", content: transcription.slice(0, 24000) }, // transcription complète (appels longs)
        ],
      }),
    });
    if (!rm.ok) return res.status(502).json({ ok: false, erreur: "mistral statut " + rm.status });
    const jm: any = await rm.json();
    const t: string = (jm.choices && jm.choices[0] && jm.choices[0].message && jm.choices[0].message.content) || "";
    const m2 = t.match(/\{[\s\S]*\}/);
    if (!m2) return res.status(502).json({ ok: false, erreur: "réponse IA illisible" });
    let ia: any = {};
    try { ia = JSON.parse(m2[0]); } catch (e) { return res.status(502).json({ ok: false, erreur: "JSON IA illisible" }); }
    return res.status(200).json({
      ok: true,
      resumeIA: ia.resume ? String(ia.resume) + (ia.action ? " → Action recommandée : " + ia.action : "") : null,
      sentiment: ia.sentiment ? String(ia.sentiment) : null,
      sujets: ia.sujets ? String(ia.sujets) : null,
      scoreIA: typeof ia.score === "number" ? Math.min(5, Math.max(1, Math.round(ia.score))) : null,
      scorecard: ia.scorecard && typeof ia.scorecard === "object" ? ia.scorecard : null,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, erreur: String((e && e.message) || e || "erreur") });
  }
}
