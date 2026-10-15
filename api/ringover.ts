// ── Webhook Ringover → CRM U'mob ────────────────────────────────────────────
// Fonction serverless Vercel : Ringover pousse ici ses événements d'appel.
//   1. journalise le payload brut (calibration, cf. logs Vercel)
//   2. ignore les événements bruyants (ringing, answered, contact…)
//   3. récupère détails (numéros, durée, enregistrement) via l'API publique Ringover
//   4. récupère la transcription (Empower)
//   5. analyse IA Mistral : analyse commerciale + EXTRACTION des indications
//      données par l'appelant (entreprise, ville, secteur, franchiseur, activité,
//      mode de livraison, contact, e-mail, besoin) → remplissage automatique
//      des fiches, UNIQUEMENT les champs vides, valeurs normalisées des menus.
// Variables d'environnement Vercel : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   RINGOVER_API_KEY, MISTRAL_API_KEY, RINGOVER_NOS_NUMEROS (ex. "0449392956")

const EVENEMENTS_BRUIT = ["ringing", "answered", "answer", "contact", "in_progress", "created", "updated", "update"];

const OPTIONS_MODE_LIVRAISON = ["Scooter électrique", "Scooter thermique", "Vélo électrique", "Cargo bike", "Voiture", "À pied", "Uber Eats / Deliveroo", "Mixte"];
const OPTIONS_FRANCHISEUR = ["Indépendant", "Domino's Pizza", "Burger King", "McDonald's", "KFC", "Subway", "Pizza Hut", "O'Tacos", "La Boîte à Pizza"];
const OPTIONS_ACTIVITE = ["Restauration rapide", "Restauration traditionnelle", "Livraison de repas", "Boulangerie / Pâtisserie", "Commerce floral", "Alimentation bio", "Commerce de détail", "Services", "Autre"];

// Prompt système Mistral : les listes de valeurs sont injectées SANS guillemets
// imbriqués (join de tableaux), ce qui évite tout problème d'échappement.
const PROMPT_SYSTEME =
  "Tu analyses la transcription d'un appel téléphonique reçu par la société U'mob (location de scooters électriques à des professionnels, surtout restauration/livraison). Réponds UNIQUEMENT par un objet JSON, sans markdown, avec exactement ces clés : " +
  "resume (résumé factuel en 2-3 phrases en français), sentiment ('positif', 'neutre' ou 'négatif'), sujets (sujets, objections et signaux d'achat séparés par des virgules), score (entier de 1 à 5, qualité commerciale de l'appel), action (prochaine action recommandée en une phrase), " +
  "extraction (objet avec : nomEntreprise, ville, secteur, franchiseur, activite, modeLivraison, prenom, nom, role, email, besoin — chaque valeur est une chaîne). " +
  "Pour extraction : " +
  "franchiseur : uniquement si l'interlocuteur le dit explicitement, choisi parmi [" + OPTIONS_FRANCHISEUR.join(", ") + "] ; réponds 'Indépendant' seulement s'il le dit explicitement. " +
  "activite : choisi parmi [" + OPTIONS_ACTIVITE.join(", ") + "]. " +
  "modeLivraison : mode de livraison utilisé, choisi parmi [" + OPTIONS_MODE_LIVRAISON.join(", ") + "] ; si une plateforme de livraison est mentionnée (Uber Eats, Deliveroo, Just Eat, Stuart…), réponds 'Uber Eats / Deliveroo' ; plusieurs modes cités -> 'Mixte'. " +
  "nomEntreprise : nom de l'entreprise s'il le dit ; ville : ville mentionnée ; secteur : secteur d'activité mentionné ; prenom/nom/role : si l'interlocuteur se présente ; email : adresse dictée ; besoin : besoin exprimé en une phrase courte (nombre de scooters, zone, budget, délai…). " +
  "RÈGLES ABSOLUES : n'invente RIEN, ne devine RIEN ; chaque champ de extraction reste une chaîne vide si l'information n'est pas explicitement dite dans la transcription.";

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
      const h = { Authorization: RING }; // Ringover attend la clé SANS le préfixe "Bearer" (cf. doc officielle)
      // L'API /v2/calls/{call_id} renvoie {list_count, list: [...]} (constaté en prod)
      const r1 = await fetch("https://public-api.ringover.com/v2/calls/" + appelId, { headers: h });
      console.log("Ringover calls statut:", r1.status);
      let appel: any = null;
      if (r1.ok) {
        const c: any = await r1.json();
        console.log("Ringover calls JSON:", JSON.stringify(c).slice(0, 4000));
        appel = (Array.isArray(c.list) && c.list.length) ? c.list[0] : (c.data || null);
        if (!appel && Array.isArray(c) && c.length) appel = c[0];
      }
      if (appel) {
        const pick = (o: any, cles: string[]): string => { for (const k of cles) { const v = o?.[k]; if (v) return String(v); } return ""; };
        if (!caller) caller = pick(appel, ["caller_number", "from", "from_number", "source_number", "caller", "source", "number_a", "calling_number"]);
        if (!receiver) receiver = pick(appel, ["receiver_number", "to", "to_number", "destination_number", "callee", "destination", "number_b", "called_number"]);
        if (!enregistrement) enregistrement = pick(appel, ["recording_url", "record_url", "url_recording", "recording"]);
        if (!duration) duration = Number(pick(appel, ["duration", "call_duration", "length"])) || 0;
        console.log("Extraction appel:", JSON.stringify({ caller, receiver, duration, enregistrement: !!enregistrement }));
      }
      // Empower : la transcription se récupère via un calluuid obtenu depuis le
      // channel (doc: POST empower/platform/:platform/channel/:channelId puis
      // GET empower/call/:calluuid). On tente call_id puis channel_id en secours.
      const canal = String(d.channel_id ?? (appel && appel.channel_id) ?? "");
      const lireEmpower = async (uuid: string) => {
        const r = await fetch("https://public-api.ringover.com/v2/empower/call/" + uuid, { headers: h });
        console.log("Ringover empower statut:", r.status, "uuid:", uuid);
        if (!r.ok) return "";
        const e: any = await r.json();
        console.log("Ringover empower JSON:", JSON.stringify(e).slice(0, 4000));
        const ee = e.data || e;
        if (typeof ee.transcription === "string") return ee.transcription;
        if (Array.isArray(ee.transcriptions)) return ee.transcriptions.map((t: any) => String(t.text || t.content || "")).filter(Boolean).join("\n");
        if (Array.isArray(ee.messages)) return ee.messages.map((t: any) => String(t.text || t.content || "")).filter(Boolean).join("\n");
        if (typeof ee.summary === "string") return ee.summary;
        if (Array.isArray(ee.summaries)) return ee.summaries.map((t: any) => String(t.text || t.content || "")).filter(Boolean).join("\n");
        if (typeof ee.text === "string") return ee.text;
        return "";
      };
      if (!transcription) {
        // 1) résoudre le calluuid depuis le canal, si possible
        if (canal) {
          try {
            const rp = await fetch("https://public-api.ringover.com/v2/empower/platform/ringover/channel/" + canal, { method: "POST", headers: h });
            console.log("Ringover empower channel statut:", rp.status);
            if (rp.ok) {
              const jp: any = await rp.json();
              console.log("Ringover empower channel JSON:", JSON.stringify(jp).slice(0, 1500));
              const uu = (jp.data || jp || {}).calluuid || (jp.data || jp || {}).call_uuid || (jp.data || jp || {}).uuid || "";
              if (uu) transcription = await lireEmpower(String(uu));
            }
          } catch (e) { console.log("Empower channel erreur:", e); }
        }
        // 2) secours : le call_id du webhook fonctionne parfois directement
        if (!transcription) {
          try { transcription = await lireEmpower(appelId); } catch (e) { console.log("Empower call erreur:", e); }
        }
      }
    } catch (e) { console.log("Ringover API erreur:", e); }
  }

  // ── Analyse IA par Mistral : analyse commerciale + extraction ──
  let ia: any = {};
  if (MIST && transcription) {
    try {
      const rm = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + MIST },
        body: JSON.stringify({
          model: "mistral-small-latest", temperature: 0.2, max_tokens: 700,
          messages: [
            { role: "system", content: PROMPT_SYSTEME },
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

  // ── Remplissage automatique de la fiche depuis les indications de l'appelant ──
  // Règle absolue : on ne JAMAIS écraser une valeur existante ; on n'écrit que ce
  // que la transcription dit explicitement, dans les valeurs normalisées des menus.
  const extr: any = (ia && ia.extraction && typeof ia.extraction === "object") ? ia.extraction : {};
  const appliquerExtraction = (e: any, a: any): boolean => {
    let m = false;
    if (extr.nomEntreprise && (!e.nom || /^Appel /.test(e.nom))) { e.nom = String(extr.nomEntreprise).slice(0, 120); m = true; }
    if (extr.ville && !e.ville) { e.ville = String(extr.ville).slice(0, 80); m = true; }
    if (extr.secteur && !e.secteur) { e.secteur = String(extr.secteur).slice(0, 80); m = true; }
    if (extr.franchiseur && !e.franchiseur) {
      const fv = String(extr.franchiseur).trim();
      if (OPTIONS_FRANCHISEUR.includes(fv)) { e.franchiseur = fv; m = true; }
    }
    if (extr.activite && !e.activite) {
      const av = String(extr.activite).trim();
      if (OPTIONS_ACTIVITE.includes(av)) { e.activite = av; m = true; }
    }
    if (extr.modeLivraison && !e.modeLivraison) {
      const mv = String(extr.modeLivraison).trim();
      if (OPTIONS_MODE_LIVRAISON.includes(mv)) { e.modeLivraison = mv; m = true; }
    }
    if (extr.besoin) {
      const ligne = "Besoin exprimé (appel du " + (a.dateISO || "") + ") : " + String(extr.besoin).slice(0, 300);
      if (!(e.notes || "").includes(ligne)) { e.notes = (e.notes ? e.notes + "\n" : "") + ligne; m = true; }
    }
    return m;
  };
  // Création/mise à jour du CONTACT d'après la présentation de l'appelant.
  const gererContactExtrait = (cible: any, a: any): boolean => {
    if (!(extr.prenom || extr.nom)) return false;
    const tel = a.numeroAppel || "";
    const telN = (t: string) => String(t || "").replace(/\D/g, "");
    const existant = (etat.contacts || []).find((c: any) => telN(c.tel) && telN(c.tel) === telN(tel));
    if (existant) {
      let m = false;
      if (extr.prenom && !existant.prenom) { existant.prenom = String(extr.prenom).slice(0, 60); m = true; }
      if (extr.nom && !existant.nom) { existant.nom = String(extr.nom).slice(0, 60); m = true; }
      if (extr.role && !existant.role) { existant.role = String(extr.role).slice(0, 80); m = true; }
      if (extr.email && String(extr.email).includes("@") && !existant.email) { existant.email = String(extr.email).slice(0, 120); m = true; }
      if (!(existant.entrepriseIds || []).includes(cible.id)) { existant.entrepriseIds = [...(existant.entrepriseIds || []), cible.id]; m = true; }
      a.contactId = existant.id;
      return m;
    }
    const nc: any = {
      id: "c" + Date.now(),
      prenom: String(extr.prenom || "").slice(0, 60),
      nom: String(extr.nom || "").slice(0, 60),
      role: String(extr.role || "").slice(0, 80),
      email: String(extr.email || "").slice(0, 120),
      tel, entrepriseIds: [cible.id],
    };
    (etat.contacts = etat.contacts || []).push(nc);
    a.contactId = nc.id;
    return true;
  };

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
    const enrichi = appliquerExtraction(deja.entreprise, a) || gererContactExtrait(deja.entreprise, a) || modifie;
    if (!enrichi) return res.status(200).json({ ok: true, note: "rien de neuf", appelId });
    const ws = await fetch(SUP + "/rest/v1/crm_etat", {
      method: "POST",
      headers: { ...sbH, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify([{ id: "main", data: etat, maj: new Date().toISOString() }]),
    });
    if (!ws.ok) return res.status(500).json({ ok: false, erreur: "supabase_ecriture", statut: ws.status });
    console.log("Fusion enrichissement appel", appelId, "ok");
    return res.status(200).json({ ok: true, fusion: true, transcription: !!transcription, ficheEnrichie: true });
  }

  // ── Sens de l'appel + numéro client ──
  const notreNumero = NOS_NUMEROS.find((n) => n === normeTel(receiver) || n === normeTel(caller));
  const entrant: boolean = notreNumero ? normeTel(receiver) === notreNumero : !evt.includes("outgo");
  const numeroClient: string = entrant ? caller : receiver;

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
    const id = "e" + now.getTime();
    (etat.entreprises = etat.entreprises || []).push({
      id, nom: "Appel " + (numAffiche || "inconnu"), nomCommercial: "", secteur: "", ville: "", site: "",
      tel: numeroClient, franchiseur: "", modeLivraison: "", activite: "", statut: "Suspect",
      notes: "Fiche créée automatiquement par un appel Ringover " + sens + " non identifié dans le CRM. À qualifier (vérifier l'entreprise derrière ce numéro).",
      activites: [act], pack: "", dateDebut: "", dateFin: "", nbVehicules: "", contratLocam: "",
      immatriculations: "", modeles: [], contrats: [], risque: "",
    });
    entreprise = (etat.entreprises || []).find((e: any) => e.id === id);
    cree = true;
  }

  // ── Remplissage automatique : fiche rattachée ou Suspect fraîchement créé ──
  let ficheModifiee = false;
  if (entreprise) {
    ficheModifiee = appliquerExtraction(entreprise, act) || gererContactExtrait(entreprise, act);
    if (ficheModifiee) console.log("Fiche enrichie automatiquement:", entreprise.nom);
  }

  const ws = await fetch(SUP + "/rest/v1/crm_etat", {
    method: "POST",
    headers: { ...sbH, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([{ id: "main", data: etat, maj: now.toISOString() }]),
  });
  if (!ws.ok) { console.log("Ecriture Supabase KO:", ws.status); return res.status(500).json({ ok: false, erreur: "supabase_ecriture", statut: ws.status }); }
  return res.status(200).json({ ok: true, entreprise: entreprise ? entreprise.nom : "aucun rattachement", cree, ficheEnrichie: ficheModifiee, sentiment: ia.sentiment || null, score: act.scoreIA || null, transcriptionRecue: !!transcription });
}
