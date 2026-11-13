// ── Poller IMAP maison — remplace le scénario Make « Integration Email » ────
// CAUSE DE LA CREATION (11/2026) : Make a désactivé le scénario le 04/11/2026
// (« Request Entity Too Large » : un email volumineux HTML/base64 explosait le
// payload HTTP). Ce poller reprend la main : zéro dépendance payante, point
// de reprise par UID en base, texte TRONQUE (jamais le HTML complet).
//
// Chaîne : cron cron-job.org (2 min) → GET /api/poll-emails?secret=…
//   1. lit le point de reprise (uid_max) dans la table crm_poll_etat ;
//   2. IMAP LOGIN + SELECT INBOX (TLS 993, OVH) ;
//   3. UID SEARCH UID <uid_max+1>:* (ou SINCE POLL_DEPUIS au 1er run) ;
//   4. pour chaque UID : FETCH BODY.PEEK[] (sans marquer lu) → parseur MIME
//      (text/plain prioritaire, repli html détagué, charsets 1252/UTF-8) ;
//   5. pousse { messageId, from, fromName, subject, text <= 20000, date } vers
//      /api/inbound-email (même classification IA + quarantaine crm_arrivees,
//      dédoublonnage déjà géré là-bas) — pushes PARALLÈLES (Promise.all) ;
//   6. met à jour uid_max → le prochain run reprend exactement après.
//
// GET /api/poll-emails?secret=…  → { scannes, pouses, quarantaines, ignores,
//   dejaEnBase, erreurs (5 max), nbErreurs, uidMax, dureeMs }.
// GET /api/poll-emails?config=1  → diagnostic variables (sans secret).
// Variables : POLL_IMAP_HOST (défaut ex3.mail.ovh.net), POLL_IMAP_USER,
//   POLL_IMAP_PASS, POLL_DEPUIS (défaut 1-Nov-2026), POLL_MAX (défaut 8),
//   INBOUND_EMAIL_SECRET (auth de cette route + secret du push).

import * as tls from "tls";

const HOST: string = process.env.POLL_IMAP_HOST || "ex3.mail.ovh.net";
const USER: string = process.env.POLL_IMAP_USER || "";
const PASS: string = process.env.POLL_IMAP_PASS || "";
const DEPUIS: string = process.env.POLL_DEPUIS || "1-Nov-2026";
const MAX: number = parseInt(process.env.POLL_MAX || "8", 10);
const SECRET: string = process.env.INBOUND_EMAIL_SECRET || "";
const SUP: string = process.env.SUPABASE_URL || "";
const KEY: string = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const DELAI_MS = 12000;

// ── Client IMAP minimal (portage éprouvé de agent-sav-v2/lib/imap.js) ──────
// Les littéraux IMAP comptent des OCTETS → accumulateur Buffer (jamais
// setEncoding utf8). Un faux "A5 OK" dans le corps d'un email ne termine
// pas la commande.
function extraireReponse(acc: Buffer, tag: string): { texte: string; consommation: number } | null {
  const morceaux: string[] = []; let i = 0;
  while (i < acc.length) {
    const finLigne = acc.indexOf(10, i);
    if (finLigne === -1) return null;
    const ligne = acc.slice(i, finLigne + 1).toString("latin1");
    const m = /\{(\d+)\}\r?\n$/.exec(ligne);
    if (m) {
      const n = parseInt(m[1], 10);
      if (acc.length < finLigne + 1 + n) return null;
      morceaux.push(ligne, "<LIT>" + acc.slice(finLigne + 1, finLigne + 1 + n).toString("utf8") + "</LIT>");
      i = finLigne + 1 + n; continue;
    }
    if (ligne.indexOf(tag + " ") === 0) { morceaux.push(ligne); return { texte: morceaux.join(""), consommation: finLigne + 1 }; }
    morceaux.push(ligne); i = finLigne + 1;
  }
  return null;
}

function connexionImap(): Promise<any> {
  return new Promise((res, rej) => {
    const so = tls.connect({ host: HOST, port: 993, rejectUnauthorized: true }, () => {
      let acc: Buffer = Buffer.alloc(0); let compteur = 0; let enCours: any = null;
      so.on("data", (chunk: Buffer) => {
        acc = Buffer.concat([acc, chunk]);
        if (!enCours) return;
        const fin = extraireReponse(acc, enCours.tag);
        if (fin !== null) {
          acc = acc.slice(fin.consommation);
          const a = enCours; enCours = null;
          clearTimeout(a.minuteur); a.res(fin.texte);
        }
      });
      res({
        command: (cmd: string) => {
          if (enCours) return Promise.reject(new Error("IMAP : commande deja en cours"));
          compteur++; const tag = "A" + compteur;
          return new Promise((res2: any, rej2: any) => {
            enCours = { tag, res: res2, minuteur: setTimeout(() => {
              const a = enCours; enCours = null;
              try { so.destroy(); } catch (e) {}
              a.rej(new Error("IMAP : pas de reponse sous " + DELAI_MS + " ms (" + cmd + ")"));
            }, DELAI_MS) };
            so.write(tag + " " + cmd + "\r\n");
          });
        },
        detruire: () => { try { so.destroy(); } catch (e) {} },
      });
    });
    so.once("error", rej);
  });
}

const estOk = (reponse: string, tag: string) => new RegExp("\\b" + tag + " OK", "m").test(reponse);
const uidsDeRecherche = (r: string) => {
  const m = /\* SEARCH ([^\r\n]*)/.exec(r);
  return m ? m[1].trim().split(/\s+/).filter(Boolean).map(Number) : [];
};
const litteralFetch = (r: string) => {
  const m = /<LIT>([\s\S]*?)<\/LIT>/.exec(r);
  return m ? m[1] : "";
};

// ── Parseur MIME minimal (portage de agent-sav-v2/lib/mail.js, sans images) ─
var CP1252_HAUT: any = {
  0x80: "\u20AC", 0x82: "\u201A", 0x83: "\u0192", 0x84: "\u201E", 0x85: "\u2026",
  0x86: "\u2020", 0x87: "\u2021", 0x88: "\u02C6", 0x89: "\u2030", 0x8A: "\u0160",
  0x8B: "\u2039", 0x8C: "\u0152", 0x8E: "\u017D", 0x91: "\u2018", 0x92: "\u2019",
  0x93: "\u201C", 0x94: "\u201D", 0x95: "\u2022", 0x96: "\u2013", 0x97: "\u2014",
  0x98: "\u02DC", 0x99: "\u2122", 0x9A: "\u0161", 0x9B: "\u203A", 0x9C: "\u0153",
  0x9E: "\u017E", 0x9F: "\u0178",
};
function octetsVers1252(s: string): string {
  let res = "";
  for (let i = 0; i < s.length; i++) {
    const b = s.charCodeAt(i) & 0xff;
    res += b >= 0x80 && b <= 0x9f && CP1252_HAUT[b] !== undefined ? CP1252_HAUT[b] : String.fromCharCode(b);
  }
  return res;
}
function utf8DeOctets(s: string): string {
  const octets: number[] = [];
  for (let i = 0; i < s.length; i++) octets.push(s.charCodeAt(i) & 0xff);
  const bytes = new Uint8Array(octets); let res = ""; let j = 0;
  while (j < bytes.length) {
    const b = bytes[j];
    if (b < 0x80) { res += String.fromCharCode(b); j += 1; }
    else if (b < 0xe0) { res += String.fromCharCode(((b & 0x1f) << 6) | (bytes[j + 1] & 0x3f)); j += 2; }
    else if (b < 0xf0) { res += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[j + 1] & 0x3f) << 6) | (bytes[j + 2] & 0x3f)); j += 3; }
    else {
      let cp = ((b & 0x07) << 18) | ((bytes[j + 1] & 0x3f) << 12) | ((bytes[j + 2] & 0x3f) << 6) | (bytes[j + 3] & 0x3f);
      cp -= 0x10000;
      res += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff)); j += 4;
    }
  }
  return res;
}
const estMonoOctet = (cs: string) => /1252|8859-1|8859-15|latin-?1|ascii/i.test(String(cs || ""));
const decoderOctets = (s: string, cs: string) => estMonoOctet(cs) ? octetsVers1252(s) : utf8DeOctets(s);
function octetsB64(s: string): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  s = String(s).replace(/[^A-Za-z0-9+/=]/g, "").replace(/=+$/, "");
  const out: number[] = []; let n = 0, bits = 0;
  for (let i = 0; i < s.length; i++) {
    const v = chars.indexOf(s[i]); if (v === -1) continue;
    n = (n << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((n >> bits) & 0xff); }
  }
  return out.map((b) => String.fromCharCode(b)).join("");
}
function decoderQ(v: string): string {
  return String(v).replace(/=([0-9A-F]{2})/gi, (_: string, h: string) => String.fromCharCode(parseInt(h, 16))).replace(/=\r?\n/g, "");
}
const charsetDe = (e: string) => { const m = /charset\s*=\s*"?([^";\r\n]+)"?/i.exec(String(e || "")); return m ? m[1].trim() : ""; };
function decoderMot(s: string): string {
  return String(s).replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_: string, cs: string, mode: string, donnees: string) => {
    try {
      if (mode.toUpperCase() === "B") return decoderOctets(octetsB64(donnees), cs);
      return decoderOctets(decoderQ(donnees.replace(/_/g, " ")), cs);
    } catch (e) { return donnees; }
  });
}
function detaguer(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}
// Retourne { from, fromNom, sujet, texte, messageId, date } — text/plain
// prioritaire, repli html DÉTAGUÉ (jamais d'images base64 → payload mince).
function parseMessage(brut: string): any {
  brut = String(brut || "");
  const idx = brut.indexOf("\r\n\r\n");
  const idx2 = idx !== -1 ? idx : brut.indexOf("\n\n");
  const sep2 = idx !== -1 ? "\r\n\r\n" : "\n\n";
  const tete = idx2 !== -1 ? brut.slice(0, idx2) : brut;
  const corps = idx2 !== -1 ? brut.slice(idx2 + sep2.length) : "";
  const d: any = {};
  tete.split(/\r?\n/).forEach((l: string) => {
    if (/^\s/.test(l)) { const ks = Object.keys(d); if (ks.length) d[ks[ks.length - 1]] += " " + l.trim(); return; }
    const j = l.indexOf(":"); if (j === -1) return;
    d[l.slice(0, j).trim().toLowerCase()] = l.slice(j + 1).trim();
  });
  const from = d["from"] || "";
  const mFrom = /<([^>]+)>/.exec(from);
  const from_addr = (mFrom ? mFrom[1] : from).trim();
  const from_nom = decoderMot(mFrom ? from.slice(0, mFrom.index).trim().replace(/^"|"$/g, "") : "");
  const sujet = decoderMot(d["subject"] || "");
  const cte = (d["content-transfer-encoding"] || "").toLowerCase();
  const csGlobal = charsetDe(d["content-type"]);
  function decoderPartie(contenu: string, encodage: string, cs: string): string {
    if (encodage === "base64") { try { return decoderOctets(octetsB64(contenu), cs); } catch (e) { return contenu; } }
    if (encodage === "quoted-printable") return decoderOctets(decoderQ(contenu), cs);
    if (cs && estMonoOctet(cs)) return octetsVers1252(contenu);
    return contenu;
  }
  function couperPartie(p: string): [string, string] {
    const finTete = p.indexOf("\r\n\r\n");
    const cut = finTete !== -1 ? [finTete, 4] : [p.indexOf("\n\n"), 2];
    if (cut[0] === -1) return ["", p];
    return [p.slice(0, cut[0]).replace(/\r?\n[ \t]+/g, " "), p.slice(cut[0] + cut[1])];
  }
  let texte = ""; let texteHtml = "";
  function parcourir(corpsPartie: string, enteteType: string) {
    const mBord = /boundary="?([^";\r\n]+)"?/i.exec(enteteType || "");
    if (!mBord) return;
    const bord = "--" + mBord[1];
    corpsPartie.split(bord).forEach((p: string) => {
      p = p.replace(/^\r?\n/, "");
      if (!p || p.indexOf("--") === 0) return;
      const pv = couperPartie(p);
      const mCT = /content-type:[^\r\n]*/i.exec(pv[0]);
      const typeComplet = (mCT ? mCT[0].replace(/^content-type:\s*/i, "") : "text/plain").trim();
      const type = typeComplet.split(";")[0].trim().toLowerCase();
      const pcte = /content-transfer-encoding:\s*([^\r\n]+)/i.exec(pv[0]);
      const encodage = (pcte ? pcte[1] : "").trim().toLowerCase();
      if (/^multipart\//.test(type)) { parcourir(pv[1], typeComplet); return; }
      const csPartie = charsetDe(typeComplet) || csGlobal;
      if (type.indexOf("text/plain") !== -1 && !texte) texte = decoderPartie(pv[1], encodage, csPartie).trim();
      if (type.indexOf("text/html") !== -1 && !texteHtml) texteHtml = decoderPartie(pv[1], encodage, csPartie);
    });
  }
  if (/boundary="?([^";\r\n]+)"?/i.test(d["content-type"] || "")) {
    parcourir(corps, d["content-type"]);
    if (!texte && texteHtml) texte = detaguer(texteHtml);
  } else {
    texte = decoderPartie(corps, cte, csGlobal).trim();
    if ((d["content-type"] || "").toLowerCase().indexOf("text/html") !== -1) texte = detaguer(texte);
  }
  return {
    from: (from_nom ? '"' + from_nom + '" ' : "") + "<" + from_addr + ">",
    fromNom: from_nom,
    sujet,
    texte: texte.substring(0, 20000),
    messageId: (d["message-id"] || "").replace(/[<>]/g, "").trim() || null,
    date: d["date"] || null,
  };
}

// ── Handler ─────────────────────────────────────────────────────────────────
export default async function handler(req: any, res: any) {
  const t0 = Date.now();
  const u = new URL(req.url || "/", "http://localhost");
  if (req.method === "GET" && u.searchParams.get("config") === "1") {
    return res.status(200).json({ ok: true, service: "poll-emails", variables: {
      POLL_IMAP_HOST: !!HOST, POLL_IMAP_USER: !!USER, POLL_IMAP_PASS: !!PASS,
      INBOUND_EMAIL_SECRET: !!SECRET, SUPABASE_URL: !!SUP, SERVICE_KEY: !!KEY } });
  }
  const fourni = String((req.headers && req.headers["x-webhook-secret"]) || u.searchParams.get("secret") || "");
  if (SECRET && fourni !== SECRET) return res.status(401).json({ ok: false, erreur: "secret invalide" });
  if (!USER || !PASS || !SUP || !KEY || !SECRET) return res.status(500).json({ ok: false, erreur: "config serveur incomplete ?config=1" });

  const sbH: any = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
  // 1. Point de reprise (uid_max) — table crm_poll_etat (id='imap').
  let uidMax = 0;
  try {
    const rx = await fetch(SUP + "/rest/v1/crm_poll_etat?id=eq.imap&select=uid_max", { headers: sbH });
    if (rx.ok) { const rows: any[] = await rx.json(); uidMax = (rows[0] && rows[0].uid_max) || 0; }
  } catch (e: any) { /* table absente → uidMax=0 → mode SINCE */ }

  // 2. IMAP + 3. recherche (reprise par UID, ou SINCE au premier run).
  let api: any = null;
  const etats: any = { scannes: 0, pouses: 0, quarantaines: 0, ignores: 0, dejaEnBase: 0, erreurs: [] as string[] };
  let uidTraite = uidMax;
  try {
    api = await connexionImap();
    const ech = (s: string) => String(s).replace(/(["\\])/g, "\\$1");
    const r1 = await api.command('LOGIN "' + ech(USER) + '" "' + ech(PASS) + '"');
    if (!estOk(r1, "A1")) throw new Error("IMAP LOGIN refuse : " + r1.split("\n").slice(0, 2).join(" ").slice(0, 150));
    await api.command("SELECT INBOX");
    let uids: number[] = [];
    if (uidMax > 0) {
      const r = await api.command("UID SEARCH UID " + (uidMax + 1) + ":*");
      uids = uidsDeRecherche(r).filter((x) => x > uidMax);
    } else {
      const r = await api.command("UID SEARCH SINCE " + DEPUIS);
      uids = uidsDeRecherche(r);
    }
    uids.sort((a, b) => a - b);
    const aTraiter = uids.slice(0, MAX);
    etats.scannes = aTraiter.length;

    // 4+5. Fetch IMAP SÉQUENTIEL (un seul socket), puis push PARALLÈLE vers
    // /api/inbound-email (les appels IA se chevauchent → run court).
    const msgs: any[] = [];
    for (const uid of aTraiter) {
      try {
        const brut = litteralFetch(await api.command("UID FETCH " + uid + " (BODY.PEEK[])"));
        msgs.push({ uid, msg: parseMessage(brut) });
      } catch (e: any) {
        etats.erreurs.push("uid " + uid + " fetch: " + String(e && e.message || e).slice(0, 100));
        break;
      }
    }
    etats.pouses = msgs.length;
    const hote = req.headers.host || "umob-crm.vercel.app";
    const results = await Promise.all(msgs.map(async (m: any) => {
      const uid = m.uid, msg = m.msg;
      try {
        const rep = await fetch("https://" + hote + "/api/inbound-email", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-webhook-secret": SECRET },
          body: JSON.stringify({ messageId: msg.messageId || ("imap-" + uid + "@umob-crm"), from: msg.from, fromName: msg.fromNom, subject: msg.sujet, text: msg.texte, date: msg.date }),
        });
        const jr: any = await rep.json().catch(() => ({}));
        if (rep.ok && jr.note === "deja en quarantaine") { etats.dejaEnBase++; return { uid, ok: true }; }
        if (rep.ok && jr.ignore) { etats.ignores++; return { uid, ok: true }; }
        if (rep.ok && jr.quarantaine) { etats.quarantaines++; return { uid, ok: true }; }
        return { uid, ok: false, err: "inbound " + rep.status + " " + String(jr.erreur || "").slice(0, 80) };
      } catch (e: any) {
        return { uid, ok: false, err: String(e && e.message || e).slice(0, 100) };
      }
    }));
    // uid_max n'avance que dans l'ordre des succès (Promise.all conserve
    // l'ordre) : un échec bloque la progression, le cron rejoue.
    for (const rr of results) {
      if (rr.ok) uidTraite = rr.uid;
      else { etats.erreurs.push("uid " + rr.uid + " : " + rr.err); break; }
    }
  } catch (e: any) {
    if (api) api.detruire();
    return res.status(500).json({ ok: false, erreur: String(e && e.message || e).slice(0, 300), uidMax, ...etats, erreurs: etats.erreurs.slice(0, 5), nbErreurs: etats.erreurs.length });
  }
  if (api) { try { await api.command("LOGOUT"); } catch (e) {} api.detruire(); }

  // 6. Mise à jour du point de reprise (seulement s'il a avancé).
  if (uidTraite > uidMax) {
    try {
      await fetch(SUP + "/rest/v1/crm_poll_etat?id=eq.imap", { method: "PATCH", headers: sbH, body: JSON.stringify({ uid_max: uidTraite, maj_a: new Date().toISOString() }) });
    } catch (e: any) { etats.erreurs.push("maj uid_max : " + String(e && e.message || e).slice(0, 80)); }
  }
  return res.status(200).json({ ok: true, uidMax: uidTraite, ...etats, erreurs: etats.erreurs.slice(0, 5), nbErreurs: etats.erreurs.length, dureeMs: Date.now() - t0 });
}
