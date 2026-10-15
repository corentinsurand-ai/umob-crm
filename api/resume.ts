// ── Endpoint serverless Vercel : résumé IA + questions « Breeze » (CRM U'mob).
// POST { mode: "resume" | "question", nom, faits[], appels[], activites[], historique[], question? }
// mode "resume" (défaut) → { resume, sentiment, recommandations[] } ; mode "question" → { reponse }.
// Règle anti-invention : l'IA ne s'appuie QUE sur le contexte fourni par la fiche.

type Corps = {
  mode?: "resume" | "question";
  nom?: string;
  faits?: string[];
  appels?: any[];
  activites?: string[];
  historique?: string[];
  question?: string | null;
};

const TRONQUE = (s: string, n: number): string => (s.length > n ? s.slice(0, n) + "…" : s);

const contexteDepuis = (c: Corps): string => {
  const morceaux: string[] = [];
  if (c.faits && c.faits.length) morceaux.push("FAITS CONNUS SUR LA FICHE :\n" + c.faits.map((f) => "- " + f).join("\n"));
  if (c.appels && c.appels.length) morceaux.push("APPELS ANALYSÉS (sentiment, score, sujets, transcription tronquée) :\n" + c.appels.map((a) => "- Appel " + (a.numeroAppel || "") + " (" + (a.directionAppel || "?") + ", " + (a.dureeAppel || "?") + ") — sentiment " + (a.sentiment || "?") + ", score " + (a.scoreIA != null ? a.scoreIA : "?") + "/5. Sujets : " + (a.sujets || "?") + ". Résumé : " + (a.resumeIA || "") + ". Transcription : " + TRONQUE(String(a.transcription || ""), 1500)).join("\n"));
  if (c.activites && c.activites.length) morceaux.push("DERNIÈRES ACTIVITÉS :\n" + c.activites.map((a) => "- " + a).join("\n"));
  if (c.historique && c.historique.length) morceaux.push("HISTORIQUE DE LA CONVERSATION :\n" + c.historique.map((h) => "- " + h).join("\n"));
  return morceaux.join("\n\n") || "(fiche vide)";
};

const appelerMistral = async (systeme: string, utilisateur: string, maxTokens: number): Promise<string> => {
  const rep = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + (process.env.MISTRAL_API_KEY || "") },
    body: JSON.stringify({
      model: "mistral-small-latest",
      temperature: 0.2,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systeme },
        { role: "user", content: utilisateur },
      ],
    }),
  });
  if (!rep.ok) throw new Error("Mistral a répondu " + rep.status);
  const data: any = await rep.json();
  return String((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "").trim();
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST uniquement" });
  if (!process.env.MISTRAL_API_KEY) return res.status(503).json({ error: "MISTRAL_API_KEY absente côté serveur" });
  try {
    const c: Corps = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const contexte = contexteDepuis(c);
    if (c.mode === "question") {
      const systeme = "Tu es l'assistant commercial du CRM U'mob, intégré à la fiche de l'entreprise « " + (c.nom || "?") + " ». Tu réponds en français, en 1 à 3 phrases courtes et naturelles, comme un commercial qui connaît son dossier. RÈGLE ABSOLUE : tu ne t'appuies QUE sur les informations du contexte fourni. Si l'information n'y est pas, dis-le simplement (« Je n'ai pas cette info sur la fiche »). Jamais d'invention, jamais de chiffre inventé.";
      const reponse = await appelerMistral(systeme, "CONTEXTE :\n" + contexte + "\n\nQUESTION : " + (c.question || ""), 600);
      return res.status(200).json({ reponse });
    }
    const systeme = "Tu es l'assistant commercial du CRM U'mob. Rédige le résumé de la fiche de l'entreprise « " + (c.nom || "?") + " » comme un commercial qui raconte le compte à un collègue : langage naturel, concret, 3 à 5 phrases. RÈGLE ABSOLUE : uniquement les informations du contexte fourni, aucune invention. Réponds STRICTEMENT en JSON valide : {\"resume\": \"...\", \"sentiment\": \"positif|neutre|négatif\", \"recommandations\": [\"...\", \"...\"]} — 2 à 4 recommandations actionnables, une phrase courte chacune. Pas de texte en dehors du JSON.";
    const brut = await appelerMistral(systeme, "CONTEXTE :\n" + contexte, 900);
    const m = brut.match(/\{[\s\S]*\}/);
    if (!m) return res.status(500).json({ error: "Réponse IA illisible", brut: brut.slice(0, 500) });
    const j = JSON.parse(m[0]);
    return res.status(200).json({ resume: j.resume || "", sentiment: j.sentiment || "neutre", recommandations: Array.isArray(j.recommandations) ? j.recommandations.slice(0, 4) : [] });
  } catch (e: any) {
    return res.status(500).json({ error: (e && e.message) || "Erreur serveur" });
  }
}
