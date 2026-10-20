// ── Webhook Ringover → CRM U'mob ────────────────────────────────────────────
// Fonction serverless Vercel : Ringover pousse ici ses événements d'appel.
//
// GET  /api/ringover        → diagnostic complet :
//   sans paramètre : lit les derniers appels via l'API et teste les routes.
//   ?call_id=...&channel_id=... : teste directement les routes sur CET appel.
// POST /api/ringover        → traitement d'un événement webhook Ringover :
//   1. journalise le payload brut
//   2. ignore le bruit (ringing, answered, contact…)
//   3. récupère détails (numéros, durée, enregistrement) via GET /v2/calls/{id}
//   4. récupère la transcription (routes documentées, testées dans l'ordre)
//   5. analyse IA Mistral + extraction des indications de l'appelant
//   6. rattache à une fiche (matching numéro) ou crée un Suspect ; fusion tardive
//
// Doc officielle (developer.ringover.com, Ringover Public API 2.1.0) :
//   - Base URL : https://public-api.ringover.com/v2
//   - Auth     : header "Authorization: <api-key>" (SANS préfixe Bearer)
//   - Rate limit : 2 req/s par clé → petites pauses entre les requêtes
// Variables d'environnement Vercel : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   RINGOVER_API_KEY, MISTRAL_API_KEY, RINGOVER_NOS_NUMEROS,
//   RINGOVER_EMPOWER_PLATFORM (optionnel : nom de plateforme Empower),
//   RINGOVER_WEBHOOK_SECRET (recommandé : secret partagé exigé sur chaque POST
//   — à ajouter à l'URL webhook Ringover sous la forme ?secret=XXX)

const EVENEMENTS_BRUIT = ["ringing", "answered", "answer", "contact", "in_progress", "created", "updated", "update"];

const OPTIONS_MODE_LIVRAISON = ["Scooter électrique", "Scooter thermique", "Vélo électrique", "Cargo bike", "Voiture", "À pied", "Uber Eats / Deliveroo", "Mixte"];
const OPTIONS_FRANCHISEUR = ["Indépendant", "Domino's Pizza", "Burger King", "McDonald's", "KFC", "Subway", "Pizza Hut", "O'Tacos", "La Boîte à Pizza"];
const OPTIONS_ACTIVITE = ["Restauration rapide", "Restauration traditionnelle", "Livraison de repas", "Boulangerie / Pâtisserie", "Commerce floral", "Alimentation bio", "Commerce de détail", "Services", "Autre"];

const PROMPT_SYSTEME =
  "Tu analyses la transcription d'un appel téléphonique reçu par la société U'mob (location de scooters électriques à des professionnels, surtout restauration/livraison). Réponds UNIQUEMENT par un objet JSON, sans markdown, avec exactement ces clés : " +
  "PERSPECTIVE : tu fais partie de l'équipe commerciale d'U'mob — TU ES U'MOB. Rédige le résumé du point de vue du commercial U'mob : l'interlocuteur externe est « le client » ou « le prospect » ; parle de « notre offre », « nos scooters », « notre pack Confort Plus » — JAMAIS de la société U'mob à la 3e personne (« la société U'mob propose… » interdit). Écris U'mob EXACTEMENT ainsi, avec l'apostrophe — jamais « UMob », « Umob », « U mob » ni « U-Mob ». " +
  "resume (résumé factuel en 2-3 phrases en français), sentiment ('positif', 'neutre' ou 'négatif'), sujets (sujets, objections et signaux d'achat séparés par des virgules), score (entier de 1 à 5, qualité commerciale de l'appel), action (prochaine action recommandée en une phrase), delaiJours (entier 1 à 14 : nombre de jours avant l'action recommandée ; si l'interlocuteur ou le salarié dit un délai précis dans l'appel ('je rappelle demain', 'la semaine prochaine'), calcule-le en jours ; sinon réponds 2), " +
  "extraction (objet avec : nomEntreprise, ville, secteur, franchiseur, activite, modeLivraison, prenom, nom, role, email, besoin — chaque valeur est une chaîne). " +
  "Pour extraction : " +
  "franchiseur : uniquement si l'interlocuteur le dit explicitement, choisi parmi [" + OPTIONS_FRANCHISEUR.join(", ") + "] ; réponds 'Indépendant' seulement s'il le dit explicitement. " +
  "activite : choisi parmi [" + OPTIONS_ACTIVITE.join(", ") + "]. " +
  "modeLivraison : mode de livraison utilisé, choisi parmi [" + OPTIONS_MODE_LIVRAISON.join(", ") + "] ; si une plateforme de livraison est mentionnée (Uber Eats, Deliveroo, Just Eat, Stuart…), réponds 'Uber Eats / Deliveroo' ; plusieurs modes cités -> 'Mixte'. " +
  "nomEntreprise : nom de l'entreprise s'il le dit ; ville : ville mentionnée ; secteur : secteur d'activité mentionné ; prenom/nom/role : UNIQUEMENT si c'est l'INTERLOCUTEUR EXTERNE (le client ou prospect appelé) qui se présente ; JAMAIS le salarié U'mob qui répond (il dit souvent son propre prénom en décrochant) ; email : adresse dictée ; besoin : besoin exprimé en une phrase courte (nombre de scooters, zone, budget, délai…). " +
  "ATTENTION AU SENS DE L'APPEL : la transcription peut être un appel SORTANT, voire un MESSAGE LAISSÉ SUR UN RÉPONDEUR par un commercial U'mob (il se présente, ex. « Corentin Surand de la société U'mob », et laisse un numéro de rappel). Si c'est le cas : resume doit dire que le commercial U'mob a laissé un message de rappel au prospect (cite le motif et le numéro à rappeler) ; extraction (nomEntreprise, ville, secteur, franchiseur, activite, modeLivraison, prenom, nom, role, email) reste TOTALEMENT VIDE ; action = une action tournée vers le PROSPECT (ex. « Relancer le prospect par SMS s'il n'a pas rappelé »), JAMAIS « relancer Corentin Surand » ni relancer un membre de l'équipe U'mob. " +
  "nomEntreprise : ne mets JAMAIS « U'mob », « Umob », « Youmab », « UMAB », « Youmob » ni aucune variante : c'est NOTRE propre société, jamais le client. " +
  "MODÈLES DE SCOOTERS U'MOB : la gamme s'écrit EXACTEMENT « Infinity Pro », « Compact Pro », « Daily Pro » (version livraison : « S4-S5 Delivery »). Dans resume, sujets et extraction, utilise TOUJOURS ces orthographes exactes — jamais « Infiniti Pro », « Infinity », « Compact pro », « DailyPro » ni d'autres variantes écorchées ; si la transcription déforme un nom de modèle, écris-le correctement. " +
  "RÈGLES ABSOLUES : n'invente RIEN, ne devine RIEN ; chaque champ de extraction reste une chaîne vide si l'information n'est pas explicitement dite dans la transcription.";

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Extraction du texte de transcription depuis la réponse RÉELLE de
// GET /v2/transcriptions/{call_id} : [{ transcription_data: { speeches: [{ text }], text } }]
// (priorité au format confirmé en prod ; repli sur le scan générique)
const extraireTexte = (j: any): string => {
  const tab = Array.isArray(j) ? j : [j];
  for (const el of tab) {
    const td = el?.transcription_data ?? el?.data?.transcription_data;
    if (td && Array.isArray(td.speeches) && td.speeches.length) {
      const phrases = td.speeches.map((s: any) => (typeof s?.text === "string" ? s.text.trim() : "")).filter(Boolean);
      if (phrases.length) return phrases.join("\n");
    }
    if (typeof td?.text === "string" && td.text.trim().length > 20) return td.text.trim();
    if (typeof el?.summary?.text === "string" && el.summary.text.trim().length > 20) return el.summary.text.trim();
  }
  const parcourir = (x: any, profondeur: number): string => {
    if (x == null || profondeur > 4) return "";
    if (typeof x === "string") return x.trim();
    if (Array.isArray(x)) {
      const morceaux = x.map((e: any) => parcourir(e, profondeur + 1)).filter(Boolean);
      return morceaux.length ? morceaux.join("\n") : "";
    }
    if (typeof x === "object") {
      for (const k of ["transcription", "transcript", "text", "content", "summary", "sentence", "message"]) {
        if (typeof x[k] === "string" && x[k].trim()) return x[k].trim();
      }
      if (x.data) { const r = parcourir(x.data, profondeur + 1); if (r) return r; }
      if (Array.isArray(x.list)) { const r = parcourir(x.list, profondeur + 1); if (r) return r; }
      // objet résultat direct : concaténer les valeurs texte
      const vals = Object.values(x).map((v: any) => parcourir(v, profondeur + 1)).filter(Boolean);
      return vals.length ? vals.join("\n") : "";
    }
    return "";
  };
  return parcourir(j, 0);
};

export default async function handler(req: any, res: any) {
  const env = process.env;
  const SUP: string = env.SUPABASE_URL || "";
  const KEY: string = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const RING: string = env.RINGOVER_API_KEY || "";
  const MIST: string = env.MISTRAL_API_KEY || "";
  const NOS_NUMEROS: string[] = (env.RINGOVER_NOS_NUMEROS || "0449392956").split(",").map((s: string) => s.replace(/\D/g, "")).filter(Boolean);
  const epureNom = (s: any) => String(s || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
  const NOS_NOMS: string[] = (env.RINGOVER_NOS_NOMS || "Corentin Surand").split(",").map(epureNom).filter(Boolean);
  // Un membre de l'équipe U'mob (qui se présente au téléphone) ne doit JAMAIS devenir un contact client
  const estEquipe = (p: any, n: any): boolean => {
    const c = epureNom(String(p || "") + " " + String(n || "")).trim();
    if (!c || c.length < 4) return false;
    return NOS_NOMS.some((x) => c === x || (x.length >= 5 && (c.includes(x) || x.includes(c))));
  };
  const PLATEFORME_EMPOWER: string = env.RINGOVER_EMPOWER_PLATFORM || "";
  // ── SECRET WEBHOOK : si RINGOVER_WEBHOOK_SECRET est défini (recommandé), tout
  // POST doit porter ce secret — header x-webhook-secret OU ?secret=XXX dans
  // l'URL configurée chez Ringover. Sinon rejet 401 : quiconque connaît l'URL
  // ne peut plus injecter de faux appels dans le CRM. Le GET de diagnostic
  // reste ouvert (aucune donnée sensible n'y est exposée) ; le replay interne
  // (?replay=1) transmet le secret à son propre POST. ──
  const SECRET_WHH: string = env.RINGOVER_WEBHOOK_SECRET || "";

  if (req.method === "GET") {
    // ── DIAGNOSTIC : teste les routes documentées sur un appel réel ──
    const diag: any = { ok: true, service: "ringover-webhook-diag", variables: {
      SUPABASE_URL: !!SUP, SUPABASE_SERVICE_ROLE_KEY: !!KEY, RINGOVER_API_KEY: !!RING,
      MISTRAL_API_KEY: !!MIST, RINGOVER_NOS_NUMEROS: !!env.RINGOVER_NOS_NUMEROS, RINGOVER_NOS_NOMS: !!env.RINGOVER_NOS_NOMS,
      RINGOVER_EMPOWER_PLATFORM: !!PLATEFORME_EMPOWER, RINGOVER_WEBHOOK_SECRET: !!SECRET_WHH,
    }, etapes: [] };
    if (!RING) { diag.erreur = "RINGOVER_API_KEY absente"; return res.status(200).json(diag); }
    const h = { Authorization: RING };
    // req.url peut être un chemin relatif chez Vercel → toujours fournir une base
    const urlReq = new URL(req.url || "/", "http://localhost");
    const params = urlReq.searchParams;
    const pid = (params.get("call_id") || "").trim();
    const pch = (params.get("channel_id") || "").trim();
    if (pid) diag.parametre = { call_id: pid, channel_id: pch || null };
    try {
      // 1) derniers appels (doc : GET /v2/calls, pagination limit_count)
      let dernier: any = null;
      const mapAppel = (c: any) => ({ call_id: c.call_id, channel_id: c.channel_id, direction: c.direction, from: c.from_number, to: c.to_number, duration: c.duration, start: c.start_time, end: c.end_time, tags: c.tags, disponible: Object.keys(c).slice(0, 40) });
      const r0 = await fetch("https://public-api.ringover.com/v2/calls?limit_count=5", { headers: h });
      diag.etapes.push({ route: "GET /v2/calls?limit_count=5", statut: r0.status });
      if (r0.ok) {
        const j0: any = await r0.json();
        const liste = j0.list || [];
        diag.derniersAppels = liste.map(mapAppel);
        dernier = liste[0] || null;
        if (!dernier) {
          // liste vide : essai avec filtre date (48 dernières heures)
          await attendre(400);
          const depuis = Math.floor(Date.now() / 1000) - 172800;
          const r0b = await fetch("https://public-api.ringover.com/v2/calls?limit_count=10&date_from=" + depuis, { headers: h });
          diag.etapes.push({ route: "GET /v2/calls?limit_count=10&date_from=48h", statut: r0b.status });
          if (r0b.ok) {
            const lb = (await r0b.json()).list || [];
            diag.derniersAppels = lb.map(mapAppel);
            dernier = lb[0] || null;
          } else {
            diag.etapes.push({ route: "GET /v2/calls?date_from", corps: (await r0b.text()).slice(0, 400) });
          }
        }
      } else {
        diag.etapes.push({ route: "GET /v2/calls", statut: r0.status, corps: (await r0.text()).slice(0, 400) });
      }
      // ── RATTRAPAGE : le listing /v2/calls renvoie souvent une liste VIDE
      // (comportement constaté en prod) → on liste aussi les appels DÉJÀ CONSIGNÉS
      // DANS LE CRM : leur appelId suffit pour un replay ?call_id=...&replay=1 ──
      if (SUP && KEY) {
        try {
          const rsC = await fetch(SUP + "/rest/v1/crm_etat?id=eq.main&select=data", { headers: { apikey: KEY, Authorization: "Bearer " + KEY } });
          if (rsC.ok) {
            const rowsC: any[] = await rsC.json();
            const etatC: any = (rowsC[0] || {}).data || {};
            const appelsCRM: any[] = [];
            for (const e of etatC.entreprises || []) {
              for (const a of e.activites || []) {
                if (a.appelId) appelsCRM.push({ entreprise: e.nomCommercial || e.nom, entrepriseId: e.id, appelId: a.appelId, numero: a.numeroAppel || null, sens: a.directionAppel || null, duree: a.dureeAppel || null, date: a.dateISO || null, heure: a.heure || null, transcription: String(a.transcription || "").length, pourReplay: "/api/ringover?call_id=" + a.appelId + "&replay=1" });
              }
            }
            diag.appelsCRM = appelsCRM.slice(0, 15);
            if (!diag.appelsCRM.length) diag.noteCRM = "aucun appel consigné dans le CRM";
          }
        } catch (e: any) { diag.noteCRM = "lecture CRM impossible: " + String(e).slice(0, 120); }
      }
      // paramètre explicite prioritaire
      if (pid && !(dernier && String(dernier.call_id) === pid)) dernier = { call_id: pid, channel_id: pch || "" };

      if (dernier) {
        const cid = String(dernier.call_id);
        const canaux = [...new Set([String(dernier.channel_id || ""), pch].filter(Boolean))];
        // 2) détail d'un appel (doc : get a specific call by ID)
        await attendre(400);
        const r1 = await fetch("https://public-api.ringover.com/v2/calls/" + cid, { headers: h });
        const j1 = r1.ok ? await r1.json() : null;
        diag.etapes.push({ route: "GET /v2/calls/" + cid, statut: r1.status, champs: j1 ? Object.keys(j1.list ? j1.list[0] || {} : j1) : null, corpsBrut: j1 ? JSON.stringify(j1).slice(0, 1500) : null });
        // 3) routes transcription candidates (doc : get a single transcription by call ID)
        const essaisTranscription = [
          "https://public-api.ringover.com/v2/calls/" + cid + "/transcription",
          "https://public-api.ringover.com/v2/transcriptions/" + cid,
          "https://public-api.ringover.com/v2/transcriptions?call_id=" + cid,
          "https://public-api.ringover.com/v2/calls/" + cid + "/transcriptions",
        ];
        for (const url of essaisTranscription) {
          await attendre(400);
          try {
            const rt = await fetch(url, { headers: h });
            const corpsBrut = rt.ok ? (await rt.text()).slice(0, 1200) : "";
            diag.etapes.push({ route: url.replace("https://public-api.ringover.com", ""), statut: rt.status, corps: corpsBrut });
          } catch (e: any) { diag.etapes.push({ route: url, erreur: String(e).slice(0, 120) }); }
        }
        // 4) enregistrement par canal (doc : get call recording for a specific channel)
        for (const chid of canaux) {
          for (const url of ["https://public-api.ringover.com/v2/calls/" + chid + "/recording", "https://public-api.ringover.com/v2/calls/" + cid + "/recording"]) {
            await attendre(400);
            try {
              const rr = await fetch(url, { headers: h });
              const corpsBrut = rr.ok ? (await rr.text()).slice(0, 400) : "";
              diag.etapes.push({ route: url.replace("https://public-api.ringover.com", ""), statut: rr.status, typeContenu: rr.headers.get("content-type") || "", corps: corpsBrut });
            } catch (e: any) { diag.etapes.push({ route: url, erreur: String(e).slice(0, 120) }); }
          }
        }
        // 5) Empower (doc : call details by uuid, summary, call uuid from platform+channel)
        const essaisEmpower = [
          "https://public-api.ringover.com/v2/empower/call/" + cid,
          "https://public-api.ringover.com/v2/empower/call/" + cid + "/summary",
          "https://public-api.ringover.com/v2/empower/call/" + cid + "/moments",
        ];
        if (PLATEFORME_EMPOWER && canaux.length) essaisEmpower.push("https://public-api.ringover.com/v2/empower/call-uuid/platform/" + PLATEFORME_EMPOWER + "/channel/" + canaux[0]);
        for (const url of essaisEmpower) {
          await attendre(400);
          try {
            const re = await fetch(url, { headers: h });
            const corpsBrut = re.ok ? (await re.text()).slice(0, 1200) : "";
            diag.etapes.push({ route: url.replace("https://public-api.ringover.com", ""), statut: re.status, corps: corpsBrut });
          } catch (e: any) { diag.etapes.push({ route: url, erreur: String(e).slice(0, 120) }); }
        }
      } else {
        diag.note = "aucun appel dans l'historique et aucun paramètre call_id — visite /api/ringover?call_id=... (le call_id figure dans les logs du webhook) ou passe un appel";
      }
    } catch (e: any) { diag.erreurGlobal = String(e).slice(0, 200); }
    // ── REPLAY : ?call_id=...&replay=1 → rejoue le pipeline POST sur cet appel ──
    if (pid && params.get("replay")) {
      try {
        const host = (req.headers && (req.headers.host || req.headers["x-forwarded-host"])) || "umob-crm.vercel.app";
        const rep = await fetch("https://" + host + "/api/ringover", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-webhook-secret": SECRET_WHH },
          body: JSON.stringify({ resource: "replay", event: "hangup", data: { call_id: pid, channel_id: pch } }),
        });
        diag.replay = { statut: rep.status, corps: (await rep.text()).slice(0, 2000) };
      } catch (e: any) { diag.replay = { erreur: String(e).slice(0, 200) }; }
    }
    return res.status(200).json(diag);
  }

  // ══════════════════════════ POST : traitement webhook ══════════════════════════
  // ── Vérification du SECRET WEBHOOK (voir commentaire plus haut) : rejet
  // immédiat 401 de tout POST sans le secret attendu. ──
  if (SECRET_WHH) {
    const urlPost = new URL(req.url || "/", "http://localhost");
    const fourni = String((req.headers && (req.headers["x-webhook-secret"] || req.headers["x-ringover-secret"])) || urlPost.searchParams.get("secret") || "");
    if (fourni !== SECRET_WHH) {
      console.log("POST rejeté : secret webhook invalide ou absent");
      return res.status(401).json({ ok: false, erreur: "secret webhook invalide" });
    }
  }
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
  // Format d'affichage français : 33698824873 → « 06 98 82 48 73 » (jamais « 33 69 88 24 87 3 »).
  const formaterTelFr = (t: any): string => {
  const d = String(t || "").replace(/\D/g, "");
  const nat = d.startsWith("33") && d.length === 11 ? "0" + d.slice(2) : d;
  if (nat.length === 10 && nat.startsWith("0")) return nat.replace(/(\d{2})(?=\d)/g, "$1 ");
  return String(t || "").trim();
};
  let caller = String(d.caller_number ?? d.from ?? d.caller ?? d.from_number ?? d.source_number ?? "");
  let receiver = String(d.receiver_number ?? d.to ?? d.callee ?? d.to_number ?? d.destination_number ?? "");
  let duration = Number(d.duration ?? d.call_duration ?? 0) || 0;
  let transcription = "";
  let repliSummary = ""; // résumé IA Ringover : utilisé UNIQUEMENT si aucune vraie transcription n'est trouvée
  let enregistrement = String(d.record_url ?? d.recording_url ?? "");
  let canal = String(d.channel_id ?? "");

  // ── Détails via GET /v2/calls/{call_id} (réponse documentée {list_count, list:[...]}) ──
  const h = { Authorization: RING };
  if (RING) {
    try {
      const r1 = await fetch("https://public-api.ringover.com/v2/calls/" + appelId, { headers: h });
      console.log("Ringover calls statut:", r1.status);
      if (r1.ok) {
        const c: any = await r1.json();
        const appel = (Array.isArray(c.list) && c.list.length) ? c.list[0] : (c.data || null);
        if (appel) {
          const pick = (o: any, cles: string[]): string => { for (const k of cles) { const v = o?.[k]; if (v) return String(v); } return ""; };
          if (!caller) caller = pick(appel, ["from_number", "caller_number", "from", "source_number"]);
          if (!receiver) receiver = pick(appel, ["to_number", "receiver_number", "to", "destination_number"]);
          if (!canal) canal = pick(appel, ["channel_id"]);
          if (!duration) duration = Number(pick(appel, ["incall_duration", "total_duration", "duration", "call_duration", "length"])) || 0;
          if (!enregistrement) enregistrement = pick(appel, ["record", "recording_url", "record_url", "url_recording"]);
          // résumé IA fourni par Ringover (champ summary du détail d'appel) — repli si pas de transcription
          const sumTxt = appel?.summary?.text;
          if (typeof sumTxt === "string" && sumTxt.trim().length > 20) repliSummary = sumTxt.trim().slice(0, 60000);
          console.log("Extraction appel:", JSON.stringify({ caller, receiver, duration, canal }));
        }
      }
      // ── Transcription : routes documentées, testées dans l'ordre (rate limit 2/s) ──
      const essais = [
        "https://public-api.ringover.com/v2/transcriptions/" + appelId, // route confirmée en prod (200)
        "https://public-api.ringover.com/v2/calls/" + appelId + "/transcription",
      ];
      for (const url of essais) {
        if (transcription) break;
        await attendre(400);
        try {
          const rt = await fetch(url, { headers: h });
          console.log("Transcription essai:", url.replace("https://public-api.ringover.com", ""), "statut:", rt.status);
          if (rt.ok) {
            const jt: any = await rt.json().catch(() => null);
            const texte = jt ? extraireTexte(jt) : "";
            if (texte && texte.length > 20) transcription = texte.slice(0, 60000);
          }
        } catch (e) { console.log("Transcription erreur:", String(e).slice(0, 120)); }
      }
      // ── Empower : détail + résumé (doc : call details by uuid / AI-generated summary) ──
      if (!transcription) {
        const essaisEmpower = [
          "https://public-api.ringover.com/v2/empower/call/" + appelId,
          "https://public-api.ringover.com/v2/empower/call/" + appelId + "/summary",
        ];
        if (PLATEFORME_EMPOWER && canal) essaisEmpower.push("https://public-api.ringover.com/v2/empower/call-uuid/platform/" + PLATEFORME_EMPOWER + "/channel/" + canal);
        for (const url of essaisEmpower) {
          if (transcription) break;
          await attendre(400);
          try {
            const re = await fetch(url, { headers: h });
            console.log("Empower essai:", url.replace("https://public-api.ringover.com", ""), "statut:", re.status);
            if (re.ok) {
              const je: any = await re.json().catch(() => null);
              const texte = je ? extraireTexte(je) : "";
              if (texte && texte.length > 20) transcription = texte.slice(0, 60000);
            }
          } catch (e) { console.log("Empower erreur:", String(e).slice(0, 120)); }
        }
      }
      // ── Enregistrement par canal (doc : get call recording for a specific channel) ──
      if (!enregistrement && canal) {
        await attendre(400);
        try {
          const rr = await fetch("https://public-api.ringover.com/v2/calls/" + canal + "/recording", { headers: h });
          console.log("Recording (canal) statut:", rr.status);
          if (rr.ok) {
            const jr: any = await rr.json().catch(() => null);
            const texte = jr ? extraireTexte(jr) : "";
            if (texte && /^https?:\/\//.test(texte)) enregistrement = texte;
          }
        } catch (e) { console.log("Recording erreur:", String(e).slice(0, 120)); }
      }
      // ── Repli : si aucune vraie transcription n'a été trouvée, on utilise le
      // résumé IA Ringover. La vraie transcription reste TOUJOURS prioritaire ──
      if (!transcription && repliSummary) { transcription = repliSummary; console.log("Transcription absente : repli sur le résumé IA Ringover (" + repliSummary.length + " car.)"); }
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
            { role: "user", content: transcription.slice(0, 24000) }, // appels longs : 24k car. au lieu de 8k (les résumés tronquaient)
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

  // ── Remplissage automatique de la fiche (uniquement champs vides, valeurs normalisées) ──
  const extr: any = (ia && ia.extraction && typeof ia.extraction === "object") ? ia.extraction : {};
  // Garde-fou : « U'mob » (ou une variante entendue par la transcription : Youmab, UMAB…) est NOTRE société — jamais le nom du client/prospect.
  const estNomUmob = (s: any): boolean => ["umob", "youmab", "umab", "youmob", "yumob", "umov"].includes(String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, ""));
  const appliquerExtraction = (e: any, a: any): boolean => {
    let m = false;
    if (extr.nomEntreprise && !estNomUmob(extr.nomEntreprise) && (!e.nom || /^Appel /.test(e.nom))) { e.nom = String(extr.nomEntreprise).slice(0, 120); m = true; }
    if (estNomUmob(extr.nomEntreprise)) console.log("nomEntreprise ignoré : c'est U'mob (notre société), pas le client");
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
      // UNE seule ligne "Besoin exprimé" par fiche : les replays de l'analyse produisent
      // des variantes quasi identiques du même besoin — on REMPLACE, on n'accumule jamais.
      const ligne = "Besoin exprimé (appel du " + (a.dateISO || "") + ") : " + String(extr.besoin).slice(0, 300);
      const autres = String(e.notes || "").split("\n").filter((l: string) => !l.startsWith("Besoin exprimé (") && l.trim());
      const nouvelles = autres.length ? autres.join("\n") + "\n" + ligne : ligne;
      if (String(e.notes || "") !== nouvelles) { e.notes = nouvelles; m = true; }
    }
    return m;
  };
  const gererContactExtrait = (cible: any, a: any): boolean => {
    if (!(extr.prenom || extr.nom)) return false;
    if (estEquipe(extr.prenom, extr.nom)) { console.log("Contact extrait ignoré : membre de l'équipe U'mob (" + extr.prenom + " " + extr.nom + ")"); return false; }
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

  // ── Tâche CRM automatique : transforme l'action recommandée en tâche planifiée ──
  // Autonome : ses propres date/dateISO (p2/date/dateISO principaux sont déclarés plus bas,
  // et ce helper est aussi appelé dans le chemin "fusion" AVANT leur déclaration)
  const creerTacheSuivante = (ent: any, a: any): boolean => {
    const actionTxt = String(ia.action || "").trim();
    if (!actionTxt || actionTxt.length < 5 || !ent) return false;
    // pas de doublon : une seule tâche par appel
    if ((ent.activites || []).some((x: any) => x.tacheDepuisAppel === appelId)) return false;
    let delai = Number(ia.delaiJours);
    if (!Number.isFinite(delai) || delai < 1 || delai > 14) delai = 2;
    const n = new Date();
    const q2 = (x: number) => (x < 10 ? "0" : "") + x;
    const ech = new Date(Date.now() + delai * 86400000);
    const nP = n.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }).split("-").map(Number); // heure de Paris (Vercel tourne en UTC)
    const echP = ech.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }).split("-").map(Number);
    const tache: any = {
      date: n.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hour12: false }),
      dateISO: q2(nP[2]) + "/" + q2(nP[1]) + "/" + nP[0],
      heure: n.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hour12: false }),
      type: "tache",
      echeance: q2(echP[2]) + "/" + q2(echP[1]) + "/" + echP[0],
      texte: "✅ " + actionTxt.slice(0, 300) + " (suggérée par l'IA après l'appel)",
      tacheDepuisAppel: appelId,
    };
    if (a.contactId) tache.contactId = a.contactId;
    ent.activites = [a, tache, ...(ent.activites || []).filter((x: any) => x !== a)];
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
    // une transcription déjà stockée sous forme "un mot par ligne" est un artefact
    // de l'ancien extracteur → on la considère comme absente pour la remplacer
    const lignes = String(a.transcription || "").split("\n");
    const garbage = a.transcription && lignes.length >= 30 && lignes.every((l: string) => l.trim().split(/\s+/).length <= 3);
    if (garbage) delete a.transcription;
    let modifie = false;
    // transcription : on remplit si absente, et on REMPLACE si la nouvelle est plus
    // complète (appel long : le 1er événement peut stocker une transcription
    // PARTIELE que l'événement tardif (summary/record_available) doit écraser)
    if (transcription && (!a.transcription || transcription.length > String(a.transcription).length)) { a.transcription = transcription; modifie = true; }
    if (enregistrement && !a.urlEnregistrement) { a.urlEnregistrement = enregistrement; modifie = true; }
    // L'analyse IA REMPLACE systématiquement : un replay avec la transcription
    // complète doit écraser le résumé/score générés sur une version partielle.
    if (ia.resume) { a.resumeIA = String(ia.resume) + (ia.action ? " → Action recommandée : " + ia.action : ""); modifie = true; }
    if (ia.sentiment) { a.sentiment = String(ia.sentiment); modifie = true; }
    if (ia.sujets) { a.sujets = String(ia.sujets); modifie = true; }
    if (typeof ia.score === "number") { a.scoreIA = Math.min(5, Math.max(1, Math.round(ia.score))); modifie = true; }
    if (duration && !a.dureeAppel) { a.dureeAppel = Math.max(1, Math.round(duration / 60)) + " min"; modifie = true; }
    const tacheCreeeFusion = creerTacheSuivante(deja.entreprise, a);
    const enrichi = appliquerExtraction(deja.entreprise, a) || gererContactExtrait(deja.entreprise, a) || modifie || tacheCreeeFusion;
    if (!enrichi) return res.status(200).json({ ok: true, note: "rien de neuf", appelId });
    const ws = await fetch(SUP + "/rest/v1/crm_etat", {
      method: "POST",
      headers: { ...sbH, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify([{ id: "main", data: etat, maj: new Date().toISOString() }]),
    });
    if (!ws.ok) return res.status(500).json({ ok: false, erreur: "supabase_ecriture", statut: ws.status });
    console.log("Fusion enrichissement appel", appelId, "ok");
    return res.status(200).json({ ok: true, fusion: true, transcription: !!transcription, ficheEnrichie: true, tacheCreee: tacheCreeeFusion });
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
  const nowP = now.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }).split("-").map(Number); // heure de Paris (Vercel tourne en UTC)
  const dateISO = p2(nowP[2]) + "/" + p2(nowP[1]) + "/" + nowP[0];
  const date = now.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hour12: false });
  const dureeTxt = duration ? Math.max(1, Math.round(duration / 60)) + " min" : "";
  const sens = entrant ? "entrant" : "sortant";
  const numAffiche = formaterTelFr(numeroClient);
  const act: any = {
    date, dateISO, heure: date, type: "appel", appelId,
    texte: "📞 Appel " + sens + (numeroClient ? (entrant ? " de " : " vers ") + numAffiche : "") + (dureeTxt ? " · " + dureeTxt : "") + (transcription ? "" : " (transcription en attente)"),
    numeroAppel: formaterTelFr(numeroClient), directionAppel: sens, dureeAppel: dureeTxt,
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
      tel: formaterTelFr(numeroClient), franchiseur: "", modeLivraison: "", activite: "", statut: "Suspect",
      notes: "Fiche créée automatiquement par un appel Ringover " + sens + " non identifié dans le CRM. À qualifier (vérifier l'entreprise derrière ce numéro).",
      activites: [act], pack: "", dateDebut: "", dateFin: "", nbVehicules: "", contratLocam: "",
      immatriculations: "", modeles: [], contrats: [], risque: "",
    });
    entreprise = (etat.entreprises || []).find((e: any) => e.id === id);
    cree = true;
  }

  let ficheModifiee = false;
  let tacheCreee = false;
  if (entreprise) {
    tacheCreee = creerTacheSuivante(entreprise, act);
    ficheModifiee = appliquerExtraction(entreprise, act) || gererContactExtrait(entreprise, act);
    if (ficheModifiee) console.log("Fiche enrichie automatiquement:", entreprise.nom);
  }

  const ws = await fetch(SUP + "/rest/v1/crm_etat", {
    method: "POST",
    headers: { ...sbH, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([{ id: "main", data: etat, maj: now.toISOString() }]),
  });
  if (!ws.ok) { console.log("Ecriture Supabase KO:", ws.status); return res.status(500).json({ ok: false, erreur: "supabase_ecriture", statut: ws.status }); }
  return res.status(200).json({ ok: true, entreprise: entreprise ? entreprise.nom : "aucun rattachement", cree, ficheEnrichie: ficheModifiee, tacheCreee, sentiment: ia.sentiment || null, score: act.scoreIA || null, transcriptionRecue: !!transcription });
}
