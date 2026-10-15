// ── Webhook Ringover → CRM U'mob ────────────────────────────────────────────
// Fonction serverless Vercel : Ringover pousse ici ses événements d'appel.
//   1. journalise le payload brut (calibration, cf. logs Vercel)
//   2. ignore les événements bruyants (ringing, answered, contact…)
//   3. récupère détails (numéros, durée, enregistrement) via l'API publique Ringover
//   4. récupère la transcription (Empower) — souvent disponible seulement sur les
//      événements TARDIFS (record_available / transcription_available / summary_available)
//   5. fait analyser la transcription par Mistral (résumé, sentiment, sujets, score)
//   6. rattache l'appel à l'entreprise du CRM (matching par numéro) ou crée un Suspect ;
//      si l'appel est déjà consigné, FUSIONNE l'enrichissement tardif (transcription, IA)
// Variables d'environnement Vercel : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   RINGOVER_API_KEY, MISTRAL_API_KEY, RINGOVER_NOS_NUMEROS (ex. "0449392956")

const EVENEMENTS_BRUIT = ["ringing", "answered", "answer", "contact", "in_progress", "created", "updated", "update"];

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

  // Bruit de sonnerie/décroché/contact : on ignore (l'anti-doublon verrait l'appel
  // déjà consigné et les détails ne sont pas encore disponibles de toute façon).
  if (EVENEMENTS_BRUIT.includes(evt)) {
    console.log("Webhook ignoré (événement bruyant):", evt, "call", appelId);
    return res.status(200).json({ ok: true, ignore: evt });
  }

  const normeTel = (t: any) => { const x = String(t || "").replace(/\D/g, ""); return x.startsWith("33") && x.length === 11 ? "0" + x.slice(2) : x; };
  let caller = String(d.caller_number ?? d.from ?? d.caller ?? d.from_number ?? d.source_number ?? "");
  let receiver = String(d.receiver_number ?? d.to ?? d.callee ?? d.to_number ?? d.destination_number ?? "");
  let duration = Number(d.duration ?? d.call_duration ?? 0) || 0;
  let transcription = "";
  let enregistrement = String(d.record_url ?? d.recording_url ?? "");

  // ── Détails + transcription via l'API publique Ringover (le webhook seul est muet) ──
  if (RING) {
    try {
      const h = { Authorization: "Bearer " + RING };
      const r1 = await fetch("https://public-api.ringover.com/v2/calls/" + appelId, { headers: h });
      console.log("Ringover calls statut:", r1.status);
      if (r1.ok) {
        const c: any = await r1.json();
        console.log("Ringover calls JSON:", JSON.stringify(c).slice(0, 2500));
        const cc = c.data || c;
        const pick = (o: any, cles: string[]): string => { for (const k of cles) { const v = o?.[k]; if (v) return String(v); } return ""; };
        if (!caller) caller = pick(cc, ["caller_number", "from", "from_number", "source_number", "caller", "source"]);
        if (!receiver) receiver = pick(cc, ["receiver_number", "to", "to_number", "destination_number", "callee", "destination"]);
        if (!enregistrement) enregistrement = pick(cc, ["recording_url", "record_url", "url_recording", "recording"]);
        if (!duration) duration = Number(pick(cc, ["duration", "call_duration", "length"])) || 0;
      }
      const r2 = await fetch("https://public-api.ringover.com/v2/empower/call/" + appelId, { headers: h });
      console.log("Ringover empower statut:", r2.status);
      if (r2.ok) {
        const e: any = await r2.json();
        console.log("Ringover empower JSON:", JSON.stringify(e).slice(0, 2500));
        const ee = e.data || e;
        if (typeof ee.transcription === "string") transcription = ee.transcription;
        else if (Array.isArray(ee.transcriptions)) transcription = ee.transcriptions.map((t: any) => String(t.text || t.content || "")).filter(Boolean).join("\n");
        else if (Array.isArray(ee.messages)) transcription = ee.messages.map((t: any) => String(t.text || t.content || "")).filter(Boolean).join("\n");
        else if (typeof ee.summary === "string") transcription = ee.summary;
        else if (Array.isArray(ee.summaries)) transcription = ee.summaries.map((t: any) => String(t.text || t.content || "")).filter(Boolean).join("\n");
      }
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

  // ── L'appel est-il déjà consigné ? Oui → FUSION de l'enrichissement tardif ──
  let deja: any = null;
  for (const e of etat.entreprises || []) {
    const a = (e.activites || []).find((x: any) => x.appelId === appelId);
    if (a) { deja = { entreprise: e, activite: a }; break; }
  }
  if (deja) {
    const a = deja.activite;
    let modifie = false;
    if (transcription && !a.transcription) { a.transcription = transcription; modifie = true; }
    if (enregistrement && !a.urlEnregistrement) { a.urlEnregistrement = enregistrement; modifie = true; }
    if (ia.resume && !a.resumeIA) { a.resumeIA = String(ia.resume) + (ia.action ? " → Action recommandée : " + ia.action : ""); modifie = true; }
    if (ia.sentiment && !a.sentiment) { a.sentiment = String(ia.sentiment); modifie = true; }
    if (ia.sujets && !a.sujets) { a.sujets = String(ia.sujets); modifie = true; }
    if (typeof ia.score === "number" && !a.scoreIA) { a.scoreIA = Math.min(5, Math.max(1, Math.round(ia.score))); modifie = true; }
    if (duration && !a.dureeAppel) { a.dureeAppel = Math.max(1, Math.round(duration / 60)) + " min"; modifie = true; }
    if (!modifie) return res.status(200).json({ ok: true, note: "rien de neuf", appelId });
    const ws = await fetch(SUP + "/rest/v1/crm_etat", {
      method: "POST",
      headers: { ...sbH, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify([{ id: "main", data: etat, maj: new Date().toISOString() }]),
    });
    if (!ws.ok) return res.status(500).json({ ok: false, erreur: "supabase_ecriture", statut: ws.status });
    console.log("Fusion enrichissement appel", appelId, "ok");
    return res.status(200).json({ ok: true, fusion: true, transcription: !!transcription });
  }

  // ── Sens de l'appel + numéro client ──
  const notreNumero = NOS_NUMEROS.find((n) => n === normeTel(receiver) || n === normeTel(caller));
  const entrant: boolean = notreNumero ? normeTel(receiver) === notreNumero : !evt.includes("outgo");
  const numeroClient: string = entrant ? caller : receiver;

  // Sans numéro exploitable ET sans transcription : rien de fiable à consigner.
  if (normeTel(numeroClient).length < 6 && !transcription) {
    console.log("Appel", appelId, "ignoré : ni numéro ni transcription disponible");
    return res.status(200).json({ ok: true, ignore: "données insuffisantes", evt });
  }

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
    texte: "📞 Appel " + sens + (numeroClient ? (entrant ? " de " : " vers ") + numAffiche : "") + (dureeTxt ? " · " + dureeTxt : "") + (transcription ? "" : " (transcription en attente)"),
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
  } else if (normeTel(numeroClient).length >= 6) {
    // Appel d'un numéro inconnu du CRM : fiche Suspect auto-créée (donnée réelle, aucune invention au-delà).
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

  const ws = await fetch(SUP + "/rest/v1/crm_etat", {
    method: "POST",
    headers: { ...sbH, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([{ id: "main", data: etat, maj: now.toISOString() }]),
  });
  if (!ws.ok) { console.log("Ecriture Supabase KO:", ws.status); return res.status(500).json({ ok: false, erreur: "supabase_ecriture", statut: ws.status }); }
  return res.status(200).json({ ok: true, entreprise: entreprise ? entreprise.nom : (cree ? "fiche créée" : "aucun rattachement"), cree, sentiment: ia.sentiment || null, score: act.scoreIA || null, transcriptionRecue: !!transcription });
}
