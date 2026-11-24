// ── maj-franchiseur : tague franchiseur « Domino's Pizza » + import v8 server-side ──
// GET ?config=1 | ?secret=…&stats=1 | ?secret=…&sirens=1 | ?secret=…&dry=1
//     | ?secret=…&importv8=1&lot=N   (N = 0..8, ou "all")  → importe un lot v8 puis tague Domino's
//     | ?secret=…                    → tague Domino's seul
export const config = { maxDuration: 300 };

const SUP: string = process.env.SUPABASE_URL || "";
const KEY: string = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SECRET: string = process.env.MAJ_FRANCHISEUR_SECRET || process.env.INBOUND_EMAIL_SECRET || "";

const SIRENS_DOMINO: string[] = ["503883480", "982743650", "902098425", "920639853", "932719750", "999587371", "821823226", "895105070", "922348693", "106227655", "533087367", "841622210", "991740614", "849379730", "803671874", "820321362", "821911872", "501603922", "534541966", "820438380", "888046596", "887840361", "820308005", "830555421", "818835290", "400228227", "833310717", "851312140", "832364525", "528185648", "817874696", "443515655", "500617634", "943149419", "524329877", "909064503", "795143569", "912151362", "900279647", "984102277", "953316668", "883813206", "819626854", "910092782", "893124487", "840603237", "527479224", "488863986", "510651078", "921576609", "498338698", "891995458", "832780332", "895105047", "499369403", "819187493", "510763766", "991709536", "523072528", "898371992", "804946754", "789823473", "848797981", "895105054", "910853985", "830619771", "521065466", "808574123", "831067038", "811584242", "801616988", "802653881", "919928044", "953059862", "800251787", "820161784", "991813023", "838949014", "100677863", "750019135", "813600996", "942426131", "880848734", "882057045", "498166511", "994987196", "823621024", "103320891", "885319673", "537568529", "941140196", "503654071", "477879514", "814374559", "521989863", "841622038", "832951792", "832491179", "502268733", "909538324", "510693823", "949419436", "828284976", "834975674", "895097921", "501054282", "910145721"];

const LOTS: string[] = [
  "import-sellsy-clients-v8",
  "import-sellsy-v8-01", "import-sellsy-v8-02", "import-sellsy-v8-03",
  "import-sellsy-v8-04", "import-sellsy-v8-05",
  "import-sellsy-v8-06a", "import-sellsy-v8-06b",
  "import-sellsy-v8-repair-fusion",
];

const norm = (s: any): string => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const digits = (s: any): string => String(s || "").replace(/\.0+$/, "").replace(/\D/g, "");

// ── helpers copiés de App.tsx ──
const normTel = (t: string) => String(t || "").replace(/\D/g, "");
const formaterTelFr = (t: any): string => {
  const d = String(t || "").replace(/\D/g, "");
  const nat = d.startsWith("33") && d.length === 11 ? "0" + d.slice(2) : d;
  if (nat.length === 10 && nat.startsWith("0")) return nat.replace(/(\d{2})(?=\d)/g, "$1 ");
  return String(t || "").trim();
};
const norme = (s: any) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const cleNomGroupe = (s: any) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter(Boolean).sort().join(" ");
const memePersonne = (a: any, b: any) =>
  (a.email && b.email && String(a.email).toLowerCase() === String(b.email).toLowerCase()) ||
  (a.tel && b.tel && normTel(a.tel) === normTel(b.tel)) ||
  (String(a.prenom || "").trim().toLowerCase() === String(b.prenom || "").trim().toLowerCase() &&
    String(a.nom || "").trim().toLowerCase() === String(b.nom || "").trim().toLowerCase());
const fusionnerContrats = (cs: any[]): any => {
  const v = cs || [];
  const uniq = (arr: string[]) => Array.from(new Set(arr.map((s) => String(s).trim()).filter(Boolean)));
  const cleDate = (d: string) => { const p = String(d || "").trim().split("/").map(Number); return p.length === 3 ? p[2] * 10000 + p[1] * 100 + p[0] : NaN; };
  const p2 = (n: number) => (n < 10 ? "0" : "") + n;
  const fmt = (k: number) => p2(k % 100) + "/" + p2(Math.floor(k / 100) % 100) + "/" + Math.floor(k / 10000);
  const debuts = v.map((c) => cleDate(c.dateDebut)).filter((n) => !Number.isNaN(n));
  const fins = v.map((c) => cleDate(c.dateFin)).filter((n) => !Number.isNaN(n));
  const immatsUniques = uniq(v.flatMap((c) => String(c.immats || "").split(",")));
  return {
    pack: uniq(v.map((c) => c.pack || "")).join(" · "),
    contratLocam: "",
    dateDebut: debuts.length ? fmt(Math.min(...debuts)) : "",
    dateFin: fins.length ? fmt(Math.max(...fins)) : "",
    immatriculations: immatsUniques.join(", "),
    nbVehicules: immatsUniques.length ? String(immatsUniques.length) : "",
  };
};
const isoVersFr = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso || "").trim());
  return m ? m[3] + "/" + m[2] + "/" + m[1] : (iso || "");
};

const GH_RAW = "https://raw.githubusercontent.com/corentinsurand-ai/umob-crm/import-v8/data-import/";
const GH_API = "https://api.github.com/repos/corentinsurand-ai/umob-crm/contents/data-import/p2?ref=import-v8";

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error("fetch " + url + " → " + r.status);
  return r.text();
}

// Charge un lot v8 : clients-v8 = JSON array unique ; les autres = parties jsonl
// (ou fragments .frag.* pour 06a/06b, lignes longues repliées avec préfixe ">>").
async function chargerLot(lot: string): Promise<any[]> {
  if (lot === "import-sellsy-clients-v8") {
    const t = await fetchText(GH_RAW + "import-sellsy-clients-v8.json");
    return JSON.parse(t);
  }
  const lr = await fetch(GH_API);
  if (!lr.ok) throw new Error("listing p2 → " + lr.status);
  const listing: any[] = await lr.json();
  const names: string[] = listing.filter((x: any) => String(x.name).startsWith(lot + ".")).map((x: any) => x.name).sort();
  const frags = names.filter((n) => n.includes(".frag."));
  const use = frags.length ? frags : names.filter((n) => n.endsWith(".jsonl"));
  if (!use.length) throw new Error("aucune partie pour " + lot);
  let texte = "";
  for (const n of use) texte += await fetchText(GH_RAW + "p2/" + n);
  const lignes: string[] = [];
  for (const l of texte.split("\n")) {
    if (l.startsWith(">>") && lignes.length) lignes[lignes.length - 1] += l.slice(2);
    else lignes.push(l);
  }
  const out: any[] = [];
  let erreurs = 0;
  for (const l of lignes) {
    const t = l.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { erreurs++; }
  }
  return Object.assign(out, { erreursParse: erreurs, parties: use.length });
}

// Réplique fidèle de importerQuarantaine (App.tsx) avec index O(1).
function appliquerImport(etat: any, fiches: any[], tagLot: string) {
  let entreprises: any[] = [...(etat.entreprises || [])];
  let contacts: any[] = [...(etat.contacts || [])];
  const byNorme = new Map<string, any>(), byCle = new Map<string, any>(), bySiren = new Map<string, any>(), byTel = new Map<string, any>();
  const indexer = (x: any) => {
    const nn = norme(x.nom); if (nn && !byNorme.has(nn)) byNorme.set(nn, x);
    const ck = cleNomGroupe(x.nom); if (ck && !byCle.has(ck)) byCle.set(ck, x);
    const sr = digits(x.siren); if (sr) { if (!bySiren.has(sr)) bySiren.set(sr, x); }
    const tl = normTel(x.tel || ""); if (tl.length >= 6 && !byTel.has(tl)) byTel.set(tl, x);
  };
  entreprises.forEach(indexer);
  const trouver = (en: any): any => {
    if (en.nom) {
      const nn = norme(en.nom); if (nn && byNorme.has(nn)) return byNorme.get(nn);
      const ck = cleNomGroupe(en.nom); if (ck && byCle.has(ck)) return byCle.get(ck);
    }
    const sr = digits(en.siren); if (sr && bySiren.has(sr)) return bySiren.get(sr);
    const telN = normTel(en.tel || "");
    if (telN.length >= 6) {
      if (byTel.has(telN)) return byTel.get(telN);
      for (const [tl, x] of byTel) if (tl.includes(telN) || telN.includes(tl)) return x;
    }
    return null;
  };
  const resume: any = { crees: 0, fusionnes: 0, contactsCrees: 0, contactsRattaches: 0, activitesAjoutees: 0, contratsAjoutes: 0 };
  fiches.forEach((f: any, i: number) => {
    const en = f.entreprise || {};
    const contrats = (en.contrats || []).map((c: any) => ({
      pack: c.pack || "", modele: c.modele || "", num: c.num || "", dateDebut: isoVersFr(c.dateDebut || ""),
      dateFin: isoVersFr(c.dateFin || ""), immats: (c.immats || []).join(", "), etat: c.etat || "",
    }));
    const activites = (en.activites || []).map((a: any) => ({
      date: isoVersFr(a.date), dateISO: (a.date || "").trim(), type: "note",
      texte: a.texte + "\n\n[📥 " + (a.provenance || "Sellsy") + "]",
    }));
    const existante = trouver(en);
    let entId: string;
    if (existante) {
      entId = existante.id;
      resume.fusionnes++;
      entreprises = entreprises.map((x: any) => {
        if (x.id !== entId) return x;
        const byNum = new Map<string, any>();
        const mergeImmats = (a: string, b: string) => Array.from(new Set([...String(a || "").split(","), ...String(b || "").split(",")] .map((s) => s.trim()).filter(Boolean))).join(", ");
        for (const k of (x.contrats || [])) {
          if (!k.num) { byNum.set("sansnum_" + byNum.size, k); continue; }
          const e = byNum.get(k.num);
          if (!e) { byNum.set(k.num, { ...k }); continue; }
          byNum.set(k.num, { ...e,
            pack: e.pack || k.pack, modele: e.modele || k.modele,
            dateDebut: e.dateDebut || k.dateDebut, dateFin: e.dateFin || k.dateFin, etat: e.etat || k.etat,
            immats: mergeImmats(e.immats, k.immats) });
        }
        for (const c of contrats) {
          if (!c.num) continue;
          const e = byNum.get(c.num);
          if (e) {
            e.dateDebut = e.dateDebut || c.dateDebut; e.dateFin = e.dateFin || c.dateFin;
            e.pack = e.pack || c.pack; e.modele = e.modele || c.modele; e.etat = e.etat || c.etat;
            e.immats = mergeImmats(e.immats, c.immats);
          } else { byNum.set(c.num, c); resume.contratsAjoutes++; }
        }
        const contratsFin = Array.from(byNum.values());
        const acts = [...(x.activites || [])];
        for (const a of activites) if (!acts.some((k: any) => k.dateISO === a.dateISO && k.texte === a.texte)) { acts.unshift(a); resume.activitesAjoutees++; }
        const fusion = { ...x,
          statut: (en.statut === "Client" ? "Client" : x.statut),
          ville: x.ville || en.ville || "", cp: x.cp || en.cp || "", adresse: x.adresse || en.adresse || "",
          siren: x.siren || en.siren || "", tel: x.tel || formaterTelFr(en.tel || ""),
          modeLivraison: x.modeLivraison || en.modeLivraison || "",
          risque: x.risque || en.risque || "",
          contrats: contratsFin, activites: acts,
          notes: (x.notes && en.notes && String(x.notes).includes(en.notes)) ? x.notes : [x.notes, en.notes].filter(Boolean).join("\n"),
        };
        return { ...fusion, ...fusionnerContrats(contratsFin) };
      });
    } else {
      entId = "e" + tagLot + "_" + i + "_" + Math.random().toString(36).slice(2, 8);
      resume.crees++;
      resume.activitesAjoutees += activites.length;
      resume.contratsAjoutes += contrats.length;
      const modeles = Array.from(new Set(contrats.flatMap((c: any) => String(c.modele || "").split(" · ").map((s: string) => s.trim()).filter(Boolean))));
      const nv: any = {
        id: entId, nom: en.nom || "Sans nom", nomCommercial: "", secteur: "", ville: en.ville || "", site: "",
        tel: formaterTelFr(en.tel || ""), franchiseur: "", modeLivraison: en.modeLivraison || "Scooter électrique",
        activite: "", statut: en.statut || "Suspect", notes: en.notes || "", activites,
        modeles, contrats, risque: en.risque || "", origine: "Import Sellsy (quarantaine)",
        siren: en.siren || "", adresse: en.adresse || "", cp: en.cp || "",
        devisHistorique: [], devisImportes: [],
        ...fusionnerContrats(contrats),
      };
      entreprises.push(nv);
      indexer(nv);
    }
    (f.contacts || []).forEach((ct: any, j: number) => {
      if (!ct.nom && !ct.prenom) return;
      const pers = { prenom: ct.prenom || "", nom: ct.nom || "", email: ct.email || "", tel: ct.tel || "" };
      const connu = contacts.find((x: any) => memePersonne(pers, x));
      if (connu) {
        if (!connu.entrepriseIds.includes(entId)) {
          contacts = contacts.map((x: any) => x.id === connu.id ? { ...x, entrepriseIds: [...x.entrepriseIds, entId], role: x.role || ct.role || "", email: x.email || ct.email || "", tel: x.tel || formaterTelFr(ct.tel || "") } : x);
          resume.contactsRattaches++;
        }
      } else {
        contacts.push({ id: "c" + tagLot + "_" + i + "_" + j + "_" + Math.random().toString(36).slice(2, 8), prenom: ct.prenom || "", nom: ct.nom || "", role: ct.role || "", email: ct.email || "", tel: formaterTelFr(ct.tel || ""), entrepriseIds: [entId] });
        resume.contactsCrees++;
      }
    });
  });
  etat.entreprises = entreprises;
  etat.contacts = contacts;
  return resume;
}

export default async function handler(req: any, res: any) {
  const u = new URL(req.url || "/", "http://localhost");
  if (u.searchParams.get("config") === "1") {
    return res.status(200).json({ ok: true, service: "maj-franchiseur", variables: {
      SUPABASE_URL: !!SUP, SUPABASE_SERVICE_ROLE_KEY: !!KEY, SECRET: !!SECRET } });
  }
  const fourni = String(u.searchParams.get("secret") || (req.headers && req.headers["x-webhook-secret"]) || "");
  if (!SECRET || fourni !== SECRET) return res.status(401).json({ ok: false, erreur: "secret invalide" });
  if (!SUP || !KEY) return res.status(500).json({ ok: false, erreur: "config serveur incomplète" });
  const base = SUP.replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const sbH: any = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };

  const rget = await fetch(base + "/rest/v1/crm_etat?id=eq.main&select=data,maj", { headers: sbH });
  if (!rget.ok) return res.status(500).json({ ok: false, erreur: "lecture", statut: rget.status });
  const rows: any[] = await rget.json();
  if (!rows.length || !rows[0].data) return res.status(404).json({ ok: false, erreur: "ligne main introuvable" });
  const etat: any = rows[0].data;
  const ents: any[] = Array.isArray(etat.entreprises) ? etat.entreprises : [];

  if (u.searchParams.get("sirens") === "1") {
    const set = new Set<string>();
    for (const e of ents) { const s = digits(e.siren); if (s) set.add(s); }
    return res.status(200).json({ ok: true, sirens: true, maj: rows[0].maj || null, total: ents.length, sirens: [...set].sort() });
  }

  if (u.searchParams.get("stats") === "1") {
    const rall = await fetch(base + "/rest/v1/crm_etat?select=id,maj", { headers: sbH });
    const allRows: any[] = rall.ok ? await rall.json() : [];
    const contacts: any[] = Array.isArray(etat.contacts) ? etat.contacts : [];
    const deals: any[] = Array.isArray(etat.deals) ? etat.deals : [];
    let avecSiren = 0, avecSellsy = 0, avecDomino = 0, taguesDomino = 0;
    const origines: any = {}, statuts: any = {};
    for (const e of ents) {
      const blob = norm(JSON.stringify(e));
      if (digits(e.siren)) avecSiren++;
      if (blob.includes("sellsy")) avecSellsy++;
      if (blob.includes("domino")) avecDomino++;
      if (String(e.franchiseur || "") === "Domino's Pizza") taguesDomino++;
      if (e.origine) origines[e.origine] = (origines[e.origine] || 0) + 1;
      statuts[e.statut || "(vide)"] = (statuts[e.statut || "(vide)"] || 0) + 1;
    }
    return res.status(200).json({ ok: true, stats: true, lignes: allRows, majMain: rows[0]?.maj || null,
      totalEntreprises: ents.length, totalContacts: contacts.length, totalDeals: deals.length,
      avecSiren, avecSellsy, avecDomino, taguesDomino, origines, statuts });
  }

  // ── mode import v8 server-side ──
  const importv8 = u.searchParams.get("importv8") === "1";
  let lotsResume: any[] = [];
  if (importv8) {
    const lotParam = u.searchParams.get("lot") || "all";
    const lots = lotParam === "all" ? LOTS : [LOTS[Number(lotParam)]];
    for (const lot of lots) {
      if (!lot) return res.status(400).json({ ok: false, erreur: "lot invalide", lotParam });
      const fiches: any[] = await chargerLot(lot);
      const res = appliquerImport(etat, fiches, lot.replace(/[^a-z0-9]/g, "").slice(-6));
      lotsResume.push({ lot, fiches: fiches.length, erreursParse: (fiches as any).erreursParse || 0, parties: (fiches as any).parties || 1, ...res });
    }
  }

  // ── matching Domino's ──
  const sirenSet = new Set(SIRENS_DOMINO);
  const rapport: any[] = [];
  let modifiees = 0, blob = 0;
  for (const e of etat.entreprises || []) {
    const nNom = norm(e.nom), nCom = norm(e.nomCommercial), siren = digits(e.siren);
    let match = "";
    if ((nNom + " " + nCom).includes("domino")) match = "nom";
    else if (siren && (sirenSet.has(siren) || sirenSet.has(siren.replace(/^0+/, "")))) match = "siren";
    else if (norm(JSON.stringify(e)).includes("domino")) { match = "blob"; blob++; }
    if (!match) continue;
    const avant = String(e.franchiseur || "");
    rapport.push({ id: e.id, nom: e.nom, nomCommercial: e.nomCommercial || "", siren, ville: e.ville || "", statut: e.statut || "", avant, match });
    if (match !== "blob" && avant !== "Domino's Pizza") { e.franchiseur = "Domino's Pizza"; modifiees++; }
  }

  const dry = u.searchParams.get("dry") === "1";
  if (dry) {
    return res.status(200).json({ ok: true, dry: true, importv8, lots: lotsResume, total: (etat.entreprises || []).length,
      matches: rapport.length, dontSiren: rapport.filter((r: any) => r.match === "siren").length, blob, modifieesPrevues: modifiees,
      rapport: rapport.slice(0, 400) });
  }

  let rput: any = null, corpsErr = "";
  for (let essai = 1; essai <= 2; essai++) {
    rput = await fetch(base + "/rest/v1/crm_etat?id=eq.main", {
      method: "PATCH", headers: { ...sbH, Prefer: "return=minimal" },
      body: JSON.stringify({ data: etat, maj: new Date().toISOString() }),
    });
    if (rput.ok) break;
    corpsErr = (await rput.text()).slice(0, 300);
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!rput || !rput.ok) return res.status(500).json({ ok: false, erreur: "ecriture", statut: rput?.status, corps: corpsErr, importv8, lots: lotsResume });
  return res.status(200).json({ ok: true, dry: false, importv8, lots: lotsResume, total: (etat.entreprises || []).length,
    matches: rapport.length, modifiees, rapport: rapport.slice(0, 400) });
}
