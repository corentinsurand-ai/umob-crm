// ── Webhook Ringover → CRM U'mob ────────────────────────────────────────────
// Fonction serverless Vercel : Ringover pousse ici ses événements d'appel
// (Dashboard Ringover > Developer > Webhooks). Le fonction :
//   1. journalise le payload brut (calibration des vrais formats, cf. logs Vercel)
//   2. récupère détails + transcription via l'API publique Ringover (best effort)
//   3. fait analyser la transcription par Mistral (résumé, sentiment, sujets, score)
//   4. rattiche l'appel à l'entreprise du CRM (matching par numéro, comme telCorrespond)
//      ou crée une fiche Suspect pour un appel entrant inconnu
//   5. écrit l'activité type "appel" enrichie dans la timeline de la fiche
// Variables d'environnement Vercel (type Config, PAS Secret pour VITE_ ; ici tout est serveur) :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RINGOVER_API_KEY (optionnelle),
//   MISTRAL_API_KEY (optionnelle), RINGOVER_NOS_NUMEROS (optionnelle, ex. "0449392956,0488888877")

export default async function handler(req: any, res: any) {
  if (req.method === "GET") {
    const e2 = process.env;
    return res.status(200).json({ ok: true, service: "ringover-webhook", diag: {
      SUPABASE_URL: !!e2.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: !!e2.SUPABASE_SERVICE_ROLE_KEY,
      RINGOVER_API_KEY: !!e2.RINGOVER_API_KEY, MISTRAL_API_KEY: !!e2.MISTRAL_API_KEY,
      RINGOVER_NOS_NUMEROS: !!e2.RINGOVER_NOS_NUMEROS
    } });
  }
  const env = process.env;
  const SUP: string = env.SUPABASE_URL || "";
  const KEY: string = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const RING: string = env.RINGOVER_API_KEY || "";
  const MIST: string = env.MISTRAL_API_KEY || "";
  const NOS_NUMEROS: string[] = (env.RINGOVER_NOS_NUMEROS || "0449392956").split(",").map((s: string) => s.replace(/\D/g, "")).filter(Boolean);

  let payload: any = {};
  try { payload = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); } catch (e) { payload = {}; }
  console.log("WEBHOOK RINGOVER brut:", JSON.stringify(payload));

  if (!SUP || !KEY) {
    console.log("ERREUR: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquantes");
    return res.status(500).json({ ok: false, erreur: "config serveur incomplète" });
  }

  const d = payload.data || payload;
  const appelId = String(d.call_id ?? d.callId ?? d.id ?? payload.call_id ?? Date.now());
  const evt = String(payload.event ?? payload.type ?? payload.name ?? "").toLowerCase();
  const caller = String(d.caller_number ?? d.from ?? d.caller ?? "");
  const receiver = String(d.receiver_number ?? d.to ?? d.callee ?? "");
  let duration = Number(d.duration ?? d.call_duration ?? 0) || 0;

  // Sens de l'appel : notre numéro est-il l'appelé (entrant) ou l'appelant (sortant) ?
  const normeTel = (t: any) => { const x = String(t || "").replace(/\D/g, ""); return x.startsWith("33") && x.length === 11 ? "0" + x.slice(2) : x; };
  const notreNumero = NOS_NUMEROS.find((n) => n === normeTel(receiver) || n === normeTel(caller));
  const entrant: boolean = notreNumero ? normeTel(receiver) === notreNumero : !evt.includes("outgo");
  const numeroClient: string = entrant ? caller : receiver;

  // ── Enrichissement via l'API publique Ringover (best effort, jamais bloquant) ──
  let transcription = "";
  let enregistrement = "";
  if (RING) {
    try {
      const h = { Authorization: "Bearer " + RING };
      const r1 = await fetch("https://public-api.ringover.com/v2/calls/" + appelId, { headers: h });
      console.log("Ringover calls:", r1.status);
      if (r1.ok) { const c: any = await r1.json(); const cc = c.data || c;
        enregistrement = String(cc.recording_url || cc.url_recording || cc.recording || "");
        if (!duration && cc.duration) duration = Number(cc.duration) || 0; }
      const r2 = await fetch("https://public-api.ringover.com/v2/empower/call/" + appelId, { headers: h });
      console.log("Ringover empower:", r2.status);
      if (r2.ok) { const e: any = await r2.json(); const ee = e.data || e;
        if (typeof ee.transcription === "string") transcription = ee.transcription;
        else if (Array.isArray(ee.transcriptions)) transcription = ee.transcriptions.map((t: any) => String(t.text || t.content || "")).filter(Boolean).join("\n");
        else if (Array.isArray(ee.messages)) transcription = ee.messages.map((t: any) => String(t.text || t.content || "")).filter(Boolean).join("\n"); }
    } catch (e) { console.log("Ringover API erreur:", e); }
  }

  // ── Analyse IA de la transcription par Mistral (jamais d'invention) ──
  let ia: any = {};
  if (MIST && transcription) {
    try {
      const rm = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + MIST },
        body: JSON.stringify({
          model: "mistral-small-latest", temperature: 0.2, max_tokens: 400,
          messages: [
            { role: "system", content: "Tu analyses la transcription d'un appel téléphonique de la société U'mob (location de scooters électriques à des professionnels, surtout restauration/livraison). Réponds UNIQUEMENT par un objet JSON, sans markdown : {\"resume\": \"résumé factuel en 2-3 phrases en français\", \"sentiment\": \"positif\", \"neutre\", \"négatif\", \"sujets\": \"sujets, objections et signaux d'achat séparés par des virgules\", \"score\": entier de 1 à 5 (qualité commerciale de l'appel), \"action\": \"prochaine action recommandée en une phrase\"}. N'invente RIEN qui n'est pas dans la transcription." },
            { role: "user", content: transcription.slice(0, 8000) },
          ],
        }),
      });
      if (rm.ok) {
        const jm: any = await rm.json();
        const t: string = (jm.choices && jm.choices[0] && jm.choices[0].message && jm.choices[0].message.content) || "";
        const m = t.match(/[\s\S]*\{[\s\S]*\}/);
        const m2 = t.match(/\{[\s\S]*\}/);
        if (m2) { try { ia = JSON.parse(m2[0]); } catch (e) { console.log("Mistral JSON illisible:", t.slice(0, 300)); } }
      } else { console.log("Mistral statut:", rm.status); }
    } catch (e) { console.log("Mistral erreur:", e); }
  }

  // ── Lecture de l'état du CRM (service role : contourne la RLS, côté serveur uniquement) ──
  const sbH: any = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
  const rl = await fetch(SUP + "/rest/v1/crm_etat?id=eq.main&select=data", { headers: sbH });
  if (!rl.ok) return res.status(500).json({ ok: false, erreur: "supabase_lecture", statut: rl.status });
  const rows: any[] = await rl.json();
  if (!rows.length) return res.status(200).json({ ok: true, note: "base CRM vide, appel ignoré" });
  const etat: any = rows[0].data;

  // Anti-doublon : ce appel a-t-il déjà été consigné ?
  const dejaLa = (etat.entreprises || []).some((e: any) => (e.activites || []).some((a: any) => a.appelId === appelId));
  if (dejaLa) return res.status(200).json({ ok: true, note: "appel déjà consigné", appelId });

  // ── Rattachement à l'entreprise (matching par numéro, tolérant aux formats) ──
  const qc = normeTel(numeroClient);
  let entreprise: any = null;
  let contactId: string | undefined;
  if (qc.length >= 6) {
    for (const e of etat.entreprises || []) {
      const et = normeTel(e.tel);
      if (et && (et === qc || et.includes(qc) || qc.includes(et))) { entreprise = e; break; }
      const ct = (etat.contacts || []).find((c: any) => (c.entrepriseIds || []).includes(e.id) && (() => { const ctn = normeTel(c.tel); return ctn && (ctn === qc || ctn.includes(qc) || qc.includes(ctn)); })());
      if (ct) { entreprise = e; contactId = ct.id; break; }
    }
  }

  // ── Construction de l'activité (mêmes champs que le front) ──
  const now = new Date();
  const p2 = (n: number) => (n < 10 ? "0" : "") + n;
  const dateISO = p2(now.getDate()) + "/" + p2(now.getMonth() + 1) + "/" + now.getFullYear();
  const date = p2(now.getHours()) + ":" + p2(now.getMinutes());
  const dureeTxt = duration ? Math.max(1, Math.round(duration / 60)) + " min" : "";
  const sens = entrant ? "entrant" : "sortant";
  const numAffiche = (numeroClient || "").replace(/(\d{2})(?=\d)/g, "$1 ").trim();
  const act: any = {
    date, dateISO, type: "appel", appelId,
    texte: "📞 Appel " + sens + (numeroClient ? (entrant ? " de " : " vers ") + numAffiche : "") + (dureeTxt ? " · " + dureeTxt : "") + (transcription ? "" : " (pas de transcription disponible)"),
    numeroAppel: numeroClient, directionAppel: sens, dureeAppel: dureeTxt,
  };
  if (contactId) act.contactId = contactId;
  if (ia.resume) act.resumeIA = String(ia.resume) + (ia.action ? " → Action recommandée : " + ia.action : "");
  if (ia.sentiment) act.sentiment = String(ia.sentiment);
  if (ia.sujets) act.sujets = String(ia.sujets);
  if (typeof ia.score === "number" && ia.score >= 1) act.scoreIA = Math.min(5, Math.max(1, Math.round(ia.score)));
  if (transcription) act.transcription = transcription;
  if (enregistrement) act.urlEnregistrement = enregistrement;

  let cree: boolean = false;
  if (entreprise) {
    entreprise.activites = [act, ...(entreprise.activites || [])];
  } else {
    // Appel entrant d'un numéro inconnu du CRM : fiche Suspect auto-créée (le numéro est une donnée réelle, aucune invention au-delà).
    const id = "e" + now.getTime();
    (etat.entreprises = etat.entreprises || []).push({
      id, nom: "Appel " + (numAffiche || "inconnu"), nomCommercial: "", secteur: "", ville: "", site: "",
      tel: numeroClient, franchiseur: "", modeLivraison: "", activite: "", statut: "Suspect",
      notes: "Fiche créée automatiquement par un appel Ringover " + sens + " non identifié dans le CRM. À qualifier (vérifier l'entreprise derrière ce numéro).",
      activites: [act], pack: "", dateDebut: "", dateFin: "", nbVehicules: "", contratLocam: "",
      immatriculations: "", modeles: [], contrats: [], risque: "",
    });
    cree = true;
  }

  // ── Réécriture de l'état ──
  const ws = await fetch(SUP + "/rest/v1/crm_etat", {
    method: "POST",
    headers: { ...sbH, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([{ id: "main", data: etat, maj: now.toISOString() }]),
  });
  if (!ws.ok) { console.log("Ecriture Supabase KO:", ws.status); return res.status(500).json({ ok: false, erreur: "supabase_ecriture", statut: ws.status }); }
  return res.status(200).json({ ok: true, entreprise: entreprise ? entreprise.nom : "fiche créée", cree, sentiment: ia.sentiment || null, score: act.scoreIA || null, transcriptionRecue: !!transcription });
}
