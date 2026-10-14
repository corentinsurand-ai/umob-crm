import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase, chargerEtat, sauverEtat } from "./lib/supabase";
import { Splash } from "./connexion";

/* ============================== MODÃLE (structure HubSpot) ============================== */

// Les 5 Ã©tapes du pipeline commercial, dans l'ordre de progression d'un deal.
type Etape = "Ã qualifier" | "Proposition envoyÃ©e" | "NÃ©gociation" | "GagnÃ©" | "Perdu";

// ââ Les 3 objets du CRM, reliÃ©s entre eux par leurs identifiants (comme HubSpot) ââ
// Entreprise â(entrepriseIds)â Contact : un contact peut appartenir Ã  PLUSIEURS
//   entreprises (ex. Pierre Piron, gÃ©rant de 15 Domino's = 1 contact, 15 liens)
// Entreprise â(entrepriseId)â Deal    : un deal est rattachÃ© Ã  une entrepriseâ¦
// Contact    â(contactId)âââ Deal    : â¦et Ã  un contact prÃ©cis de cette entreprise
// ââ Un CONTRAT Locam individuel (source : lignes du Sheet Â« Infos Service
// Client Â», regroupÃ©es par nÂ° de contrat â une ligne du Sheet = un scooter,
// donc un contrat peut couvrir plusieurs immatriculations). Un client Ã  2
// contrats (ex. LM PIZZA PUCE) obtient 2 blocs avec leurs DATES PROPRES,
// au lieu de la pÃ©riode fusionnÃ©e min/max qui ne correspondait Ã  aucun
// contrat rÃ©el. ââ
interface ContratLigne { pack: string; modele: string; num: string; dateDebut: string; dateFin: string; immats: string; etat: string }
interface Entreprise { id: string; nom: string; nomCommercial: string; secteur: string; ville: string; site: string; tel: string; franchiseur: string; modeLivraison: string; activite: string; statut: Statut; notes: string; activites: Activite[];
  // ââ Contrat & flotte (source : Sheet Â« Infos Service Client Â» / Locam) ââ
  // RenseignÃ©s pour les SOCIÃTÃS CLIENTES : pack choisi, pÃ©riode du contrat,
  // nombre de vÃ©hicules, nÂ° de contrat Locam, immatriculations. Comme tous les
  // champs auto-remplis : modifiables, et vides si la source ne sait rien.
  pack: string; dateDebut: string; dateFin: string; nbVehicules: string; contratLocam: string; immatriculations: string;
  // ââ ModÃ¨le(s) de scooter U'mob louÃ©(s) par le client (Infinity Pro /
  // Compact Pro / Daily Pro). Source auto : colonne Â« LibellÃ© Produit client Â»
  // du Sheet Â« Infos Service Client Â» ; sÃ©lection manuelle sinon (jamais
  // d'invention, cases toujours modifiables). ââ
  modeles: string[];
  // ââ Contrats individuels (un bloc par contrat Locam). Les anciennes fiches
  // agrÃ©gÃ©es (pack/dates uniques) sont migrÃ©es en 1 contrat Ã  l'ouverture. ââ
  contrats: ContratLigne[];
  // ââ Risque SAV (source : colonnes Statut_risque_client / Impayes /
  // Procedure_collective du Sheet Â« Infos Service Client Â»). Vide = aucun
  // risque signalÃ©. Comme le statut, il reste corrigeable Ã  la main. ââ
  risque: string; }
interface Contact { id: string; prenom: string; nom: string; role: string; email: string; tel: string; entrepriseIds: string[]; activites: Activite[] }

// Reconnaissance d'une personne dÃ©jÃ  en base (anti-doublons) : mÃªme email,
// mÃªme tÃ©lÃ©phone (chiffres uniquement), ou mÃªme prÃ©nom+nom â c'est la MÃME
// personne (ex. gÃ©rant de plusieurs franchises : on RATTACHE, on ne duplique jamais).
const normTel = (t: string) => t.replace(/\D/g, "");
// Normalisation de libellÃ© pour comparer deux noms/enseignes : minuscules,
// sans accents ni ponctuation (sert Ã  reconnaÃ®tre une suggestion dÃ©jÃ  CLIENTE
// en base sous un autre nom lÃ©gal).
const norme = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
// ââ Sheet Â« Infos Service Client Â» (Google Sheet partagÃ© Â« lien Â», lu EN DIRECT
// par le navigateur au moment de la crÃ©ation via lâexport CSV public â mÃªme mÃ©canisme
// que lâAPI gouv, aucune clÃ© API). Une ligne = un CONTRAT ; on agrÃ¨ge par code
// client. Câest la source officielle des clients : si le Sheet connaÃ®t la
// sociÃ©tÃ©, elle EST cliente. Ãchec rÃ©seau â liste vide, aucun blocage, et JAMAIS
// de champ contrat rempli sans donnÃ©e du Sheet (rÃ¨gle anti-invention). ââ
interface ClientSheet { code: string; nom: string; ville: string; packs: string; dateDebut: string; dateFin: string; nbVehicules: string; contrats: string; immats: string; risque: string; modeles: string[]; lignes: ContratLigne[] }
// Mini-parseur CSV gÃ©rant les champs entre guillemets (virgules incluses).
const parserCSV = (txt: string): string[][] => {
  const lignes: string[][] = []; let cur: string[] = []; let f = ""; let q = false;
  const GL = String.fromCharCode(34);
  for (let i = 0; i < txt.length; i++) { const ch = txt[i];
    if (q) { if (ch === GL) { if (txt[i + 1] === GL) { f += GL; i++; } else q = false; } else f += ch; }
    else if (ch === GL) q = true;
    else if (ch === ",") { cur.push(f); f = ""; }
    else if (ch === "\n") { cur.push(f); lignes.push(cur); cur = []; f = ""; }
    else if (ch !== "\r") f += ch; }
  if (f !== "" || cur.length) { cur.push(f); lignes.push(cur); }
  return lignes;
};
const chargerClientsSheet = async (): Promise<{ clients: ClientSheet[]; lectureOk: boolean }> => {
  try {
    const rep = await fetch("https://docs.google.com/spreadsheets/d/1nikK5_dBeFSYuOLz8Inr7UsTXvdJZUbjhUoiof7FZCk/gviz/tq?tqx=out:csv");
    if (!rep.ok) return { clients: [], lectureOk: false };
    const lignes = parserCSV(await rep.text());
    const tete = (lignes[0] || []).map((h) => h.trim().toLowerCase());
    const col = (n: string) => tete.findIndex((h) => h === n.toLowerCase());
    const cCode = col("Code client"), cNom = col("Nom client"), cVille = col("Ville"),
      cPack = col("LibellÃ© contrat"), cProd = tete.findIndex((h) => h.includes("libellÃ© produit")), cEtat = col("Etat contrat"), cDd = col("Date dÃ©but contrat"), cDf = col("Date fin contrat"),
      cNum = col("NÂ° contrat"), cImm = col("Immatriculation"), cRq = col("Statut_risque_client"),
      cImp = col("Impayes"), cProc = col("Procedure_collective_Radiation");
    if (cCode < 0 || cNom < 0) return { clients: [], lectureOk: false }; /* page dâerreur Google 200 ou colonnes absentes */
    const clients: ClientSheet[] = []; const idx = new Map<string, ClientSheet>();
    const prem = new Map<string, number>(); const der = new Map<string, number>();
    const cleDate = (d: string) => { const p = d.trim().split("/").map(Number); return p.length === 3 ? p[2] * 10000 + p[1] * 100 + p[0] : NaN; };
    const p2 = (n: number) => (n < 10 ? "0" : "") + n;
    const fmtDate = (k: number) => p2(k % 100) + "/" + p2(Math.floor(k / 100) % 100) + "/" + Math.floor(k / 10000);
    for (const l of lignes.slice(1)) {
      const g = (i: number) => (i >= 0 && i < l.length ? l[i].trim() : "");
      const code = g(cCode); if (!code) continue;
      if (!idx.has(code)) { const c: ClientSheet = { code, nom: g(cNom), ville: g(cVille), packs: "", dateDebut: "", dateFin: "", nbVehicules: "", contrats: "", immats: "", risque: "", modeles: [], lignes: [] }; idx.set(code, c); clients.push(c); }
      const c = idx.get(code)!;
      const p = g(cPack); if (p && !c.packs.includes(p)) c.packs = c.packs ? c.packs + " Â· " + p : p;
      const pr = modeleDepuis(g(cProd)); if (pr && !c.modeles.includes(pr)) c.modeles.push(pr);
      c.lignes.push({ pack: g(cPack), modele: pr, num: g(cNum), dateDebut: g(cDd), dateFin: g(cDf), immats: g(cImm), etat: g(cEtat) });
      const n = g(cNum); if (n && !c.contrats.includes(n)) c.contrats = c.contrats ? c.contrats + ", " + n : n;
      const im = g(cImm); if (im && !c.immats.includes(im)) c.immats = c.immats ? c.immats + ", " + im : im;
      const kd = cleDate(g(cDd)); if (!Number.isNaN(kd) && (prem.get(code) === undefined || kd < prem.get(code)!)) { prem.set(code, kd); c.dateDebut = fmtDate(kd); }
      const kf = cleDate(g(cDf)); if (!Number.isNaN(kf) && (der.get(code) === undefined || kf > der.get(code)!)) { der.set(code, kf); c.dateFin = fmtDate(kf); }
      const rq = g(cRq); if (rq && !c.risque) c.risque = rq;
      else if (!c.risque && g(cImp).toLowerCase() === "true") c.risque = "ImpayÃ©";
      else if (!c.risque && g(cProc)) c.risque = "ProcÃ©dure collective";
    }
    for (const c of clients) c.nbVehicules = c.immats ? String(c.immats.split(",").map((s) => s.trim()).filter(Boolean).length) : "";
    // ââ Regroupement par CONTRAT (nÂ° Locam) : plusieurs lignes du Sheet
    // partagent le mÃªme nÂ° (une ligne par scooter). ââ
    for (const c of clients) {
      const groupes = new Map<string, ContratLigne>();
      for (const l of c.lignes) {
        const cle = (l.num || "").trim() || "#" + l.pack + "|" + l.dateDebut;
        const ex = groupes.get(cle);
        if (!ex) groupes.set(cle, { ...l });
        else {
          if (l.immats && !(ex.immats || "").includes(l.immats)) ex.immats = ex.immats ? ex.immats + ", " + l.immats : l.immats;
          if (l.modele && !(ex.modele || "").includes(l.modele)) ex.modele = ex.modele ? ex.modele + " Â· " + l.modele : l.modele;
          if (!ex.dateDebut && l.dateDebut) ex.dateDebut = l.dateDebut;
          if (!ex.dateFin && l.dateFin) ex.dateFin = l.dateFin;
          if (!ex.etat && l.etat) ex.etat = l.etat;
        }
      }
      c.lignes = Array.from(groupes.values());
    }
    return { clients, lectureOk: true };
  } catch { return { clients: [], lectureOk: false }; /* rÃ©seau indisponible : pas de blocage, aucune invention */ }
};
// Reconnaissance prudente dâun client du Sheet (rÃ¨gle anti-invention : noms
// normalisÃ©s comparÃ©s strictement, ville tolÃ©rante aux arrondissements ; dans le
// doute on ne marque PAS). Le Â« Nom client Â» du Sheet peut Ãªtre du type
// Â« GAF (BOITE A PIZZA ANNEMASSE) Â» : on compare nom lÃ©gal, base et parenthÃ¨se.
const trouverClientSheet = (clients: ClientSheet[], nomLegal: string, enseigne: string, ville: string): ClientSheet | undefined =>
  clients.find((c) => {
    const base = c.nom.split(" (")[0].trim();
    const paren = (c.nom.match(/\(([^)]*)\)/) || [])[1] || "";
    const nL = norme(nomLegal), baseL = norme(nomLegal.split(" (")[0].trim()), ens = norme(enseigne), v = norme(ville), vC = norme(c.ville); // lâINSEE renvoie le nom complet avec lâenseigne entre parenthÃ¨ses : on compare aussi la base seule
    const villesOK = v === "" || vC === "" || v === vC || (v.length >= 4 && vC.length >= 4 && (v.startsWith(vC) || vC.startsWith(v)));
    return villesOK && ((
      (baseL !== "" && (baseL === norme(base) || baseL === norme(c.nom))) || (nL !== "" && (nL === norme(base) || nL === norme(c.nom)))
    ) || (
      ens !== "" && ens.length >= 5 && (ens === norme(base) || ens === norme(paren) || norme(c.nom).includes(ens))
    ));
  });
// (b accepte un Contact OU un ContactSimple de l'annuaire : seuls ces 4 champs comptent)
const memePersonne = (a: { prenom: string; nom: string; email: string; tel: string }, b: { prenom: string; nom: string; email: string; tel: string }) =>
  (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) ||
  (a.tel && b.tel && normTel(a.tel) === normTel(b.tel)) ||
  (a.prenom.trim().toLowerCase() === b.prenom.trim().toLowerCase() &&
    a.nom.trim().toLowerCase() === b.nom.trim().toLowerCase());
// ClÃ©s Â« propriÃ©taire Â» dâun contact proposÃ© : son prÃ©nom+nom normalisÃ©, et si
// son rÃ´le mentionne une holding (Â« GÃ©rant Â· via ADAVEN Â»), la holding aussi.
// Sert Ã  retirer de la liste les sociÃ©tÃ©s suggÃ©rÃ©es quand on DÃCOCHE leur dirigeant
// (les sociÃ©tÃ©s de Bourbao sont collectÃ©es via la holding ADAVEN : dÃ©cocher
// Bourbao les retire, dÃ©cocher Chbihi retire les siennes).
const clesContact = (ct: { prenom: string; nom: string; role: string }): string[] => {
  const l = [norme(ct.prenom + " " + ct.nom)];
  const m = ct.role.match(/via\s+(.+)$/i);
  if (m) l.push(norme(m[1].trim()));
  return l.filter(Boolean);
};

// ââ Franchiseurs connus : si lâenseigne INSEE contient une de ces marques,
// le champ Â« Franchiseur Â» prend la valeur normalisÃ©e du menu dÃ©roulant. Ce nâest
// PAS de lâinvention : lâenseigne vient de lâINSEE, et la marque du rÃ©seau est un
// fait public. Enseigne sans marque connue â champ vide (jamais de guess). ââ
const FRANCHISEURS: [string, string][] = [
  ["dominospizza", "Domino's Pizza"], ["pizzahut", "Pizza Hut"], ["sushishop", "Sushi Shop"],
  ["boiteapizza", "La BoÃ®te Ã  Pizza"], ["eatsushi", "Eat Sushi"], ["pizzatime", "Pizza Time"],
  ["misterpizza", "Mister Pizza"], ["classcroute", "Class'Croute"], ["tuttipizza", "Tutti Pizza"],
];
const franchiseurDepuis = (enseigne: string): string => {
  const e = norme(enseigne);
  const t = FRANCHISEURS.find(([k]) => e.includes(k));
  return t ? t[1] : "";
};

// ââ ModÃ¨les de scooters U'mob : valeurs proposÃ©es Ã  la sÃ©lection, Ã  la
// crÃ©ation d'entreprise comme Ã  l'Ã©dition. modeleDepuis() traduit un libellÃ©
// du Sheet (Â« INFINITY PRO Â», Â« COMPACT PRO Â», Â« DAILY PRO Â»â¦) vers la valeur
// normalisÃ©e du CRM ; libellÃ© inconnu â vide (jamais de guess). ââ
const MODELES_SCOOTER = ["Infinity Pro", "Compact Pro", "Daily Pro"];
const MODELE_DEPUIS: [string, string][] = [
  ["infinitypro", "Infinity Pro"], ["compactpro", "Compact Pro"], ["dailypro", "Daily Pro"],
];
const modeleDepuis = (p: string): string => {
  const n = norme(p);
  const t = MODELE_DEPUIS.find(([k]) => n.includes(k));
  return t ? t[1] : "";
};
// ââ Fusion des contrats individuels vers les champs agrÃ©gÃ©s historiques
// (pack, pÃ©riode globale min/max, nÂ° Locam, immatriculations, nb vÃ©hicules) :
// la fiche garde ses compteurs de synthÃ¨se, mais la VÃRITÃ vit dans
// `contrats` â un bloc par contrat avec ses propres dates. ââ
const fusionnerContrats = (cs: ContratLigne[]): { pack: string; dateDebut: string; dateFin: string; nbVehicules: string; contratLocam: string; immatriculations: string } => {
  const v = cs || [];
  const uniq = (arr: string[]) => Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
  const cleDate = (d: string) => { const p = d.trim().split("/").map(Number); return p.length === 3 ? p[2] * 10000 + p[1] * 100 + p[0] : NaN; };
  const p2 = (n: number) => (n < 10 ? "0" : "") + n;
  const fmt = (k: number) => p2(k % 100) + "/" + p2(Math.floor(k / 100) % 100) + "/" + Math.floor(k / 10000);
  const debuts = v.map((c) => cleDate(c.dateDebut)).filter((n) => !Number.isNaN(n));
  const fins = v.map((c) => cleDate(c.dateFin)).filter((n) => !Number.isNaN(n));
  const immatsUniques = uniq(v.flatMap((c) => (c.immats || "").split(",")));
  return {
    pack: uniq(v.map((c) => c.pack)).join(" Â· "),
    contratLocam: uniq(v.map((c) => c.num)).join(", "),
    dateDebut: debuts.length ? fmt(Math.min(...debuts)) : "",
    dateFin: fins.length ? fmt(Math.max(...fins)) : "",
    immatriculations: immatsUniques.join(", "),
    nbVehicules: immatsUniques.length ? String(immatsUniques.length) : "",
  };
};

// ââ Types d'activitÃ©s faÃ§on HubSpot ââ
// "etape" est un type interne : il trace les mouvements de deals dans le pipeline
// (gÃ©nÃ©rÃ© automatiquement, jamais saisi Ã  la main par l'utilisateur).
// Les autres types sont consignÃ©s manuellement depuis le composer des fiches.
type TypeActivite = "note" | "email" | "appel" | "tache" | "reunion" | "etape";
interface Activite { date: string; texte: string; type?: TypeActivite; echeance?: string }

// Source de vÃ©ritÃ© unique pour l'affichage de chaque type dans la timeline :
// icÃ´ne, libellÃ© et couleur (utilisÃ©s par la timeline ET le composer, donc cohÃ©rents partout).
const META_ACT: Record<TypeActivite, { icone: string; libelle: string; couleur: string }> = {
  note: { icone: "ð", libelle: "Note", couleur: "#f59e0b" },
  email: { icone: "âï¸", libelle: "E-mail envoyÃ©", couleur: "#0ea5e9" },
  appel: { icone: "ð", libelle: "Appel consignÃ©", couleur: "#57c26b" },
  tache: { icone: "â", libelle: "TÃ¢che", couleur: "#8b5cf6" },
  reunion: { icone: "ð", libelle: "RÃ©union", couleur: "#ef8f3c" },
  etape: { icone: "â", libelle: "Ãtape du deal", couleur: "#4f9ee8" },
};

interface Deal { id: string; nom: string; entrepriseId: string; contactId: string; montant: number; etape: Etape; action: string; echeance: string; notes: string; fait: boolean; activites: Activite[] }

// L'Ã©tat global de l'application : la base de donnÃ©es entiÃ¨re tient dans cet objet.
interface Etat { entreprises: Entreprise[]; contacts: Contact[]; deals: Deal[] }

// Couleur officielle de chaque Ã©tape (rÃ©utilisÃ©e partout : kanban, badges, fichesâ¦).
const ETAPES: { nom: Etape; couleur: string }[] = [
  { nom: "Ã qualifier", couleur: "#e8b83a" },
  { nom: "Proposition envoyÃ©e", couleur: "#ef8f3c" },
  { nom: "NÃ©gociation", couleur: "#4f9ee8" },
  { nom: "GagnÃ©", couleur: "#57c26b" },
  { nom: "Perdu", couleur: "#9aa3ae" },
];
const couleurEtape = (e: Etape) => ETAPES.find((x) => x.nom === e)!.couleur;

// ââ DonnÃ©es de dÃ©monstration ââ
// 8 entreprises, 9 contacts et 8 deals fictifs (type clients U'mob : livreurs lyonnais).
// Quelques activitÃ©s typÃ©es sont semÃ©es pour que les timelines soient parlantes
// dÃ¨s l'ouverture (un appel consignÃ©, un e-mail, une rÃ©union, une tÃ¢che avec Ã©chÃ©anceâ¦).
const SEED: Etat = {
  entreprises: [
    { id: "e1", statut: "Client", nom: "Rotisserie du RhÃ´ne", nomCommercial: "Rotisserie du RhÃ´ne â Lyon 7e", secteur: "Restauration", ville: "Lyon 7e", site: "rotisserie-du-rhone.fr", tel: "04 72 11 02 44", franchiseur: "IndÃ©pendant", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration traditionnelle", notes: "Contrat annuel signÃ©. 3 scooters livrÃ©s le 20/10.", activites: [{ date: "auj.", texte: "Point de livraison confirmÃ© avec Julien â crÃ©neau 8h-10h.", type: "note" }] },
    { id: "e2", statut: "Client", nom: "PokÃ© Bowl Express", nomCommercial: "PokÃ© Bowl Express â Lyon 3e", secteur: "Restauration", ville: "Lyon 3e", site: "pokebowl-express.fr", tel: "04 78 22 10 87", franchiseur: "IndÃ©pendant", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", notes: "2 scooters + abonnement maintenance." },
    { id: "e3", statut: "Prospect", nom: "BiÃ¨res & Burgers", nomCommercial: "BiÃ¨res & Burgers â Villeurbanne", secteur: "Restauration", ville: "Villeurbanne", site: "bieres-et-burgers.fr", tel: "04 72 55 71 03", franchiseur: "Burger King", modeLivraison: "Mixte", activite: "Restauration rapide", notes: "ChaÃ®ne en expansion, levier flotte 4 scooters.", activites: [{ date: "12/10", texte: "Visite du 2e restaurant â trÃ¨s intÃ©ressÃ© par le levier flotte.", type: "reunion" }] },
    { id: "e4", statut: "Prospect", nom: "Fleurs Martin & Fils", nomCommercial: "Fleurs Martin & Fils â Lyon 6e", secteur: "Commerce floral", ville: "Lyon 6e", site: "martin-fleurs.fr", tel: "04 72 39 18 66", franchiseur: "IndÃ©pendant", modeLivraison: "VÃ©lo Ã©lectrique", activite: "Commerce floral", notes: "Livraisons matinales, besoin de 2 scooters." },
    { id: "e5", statut: "Prospect", nom: "L'Atelier Pizzeria", nomCommercial: "Domino's Pizza â Lyon 1er", secteur: "Restauration", ville: "Lyon 1er", site: "atelier-pizzeria.fr", tel: "04 37 45 09 12", franchiseur: "Domino's Pizza", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", notes: "" },
    { id: "e6", statut: "Prospect", nom: "CafÃ© des Jacobins", nomCommercial: "CafÃ© des Jacobins â Lyon 2e", secteur: "CafÃ© / brunch", ville: "Lyon 2e", site: "jacquou.fr", tel: "04 72 60 34 21", franchiseur: "IndÃ©pendant", modeLivraison: "Ã pied", activite: "Restauration traditionnelle", notes: "Budget serrÃ©, pÃ©rimÃ¨tre Ã  rÃ©duire.", activites: [{ date: "09/10", texte: "PrÃ©parer une proposition Ã  pÃ©rimÃ¨tre rÃ©duit", type: "tache", echeance: "16/10" }] },
    { id: "e7", statut: "Suspect", nom: "MarchÃ© Bio Villeurbanne", nomCommercial: "MarchÃ© Bio â Villeurbanne", secteur: "Alimentation bio", ville: "Villeurbanne", site: "marche-bio-69.fr", tel: "â", franchiseur: "IndÃ©pendant", modeLivraison: "Cargo bike", activite: "Alimentation bio", notes: "Contact entrant via le site." },
    { id: "e8", statut: "Suspect", nom: "Wok City", nomCommercial: "Wok City â Lyon 8e", secteur: "Restauration", ville: "Lyon 8e", site: "wok-city.fr", tel: "04 78 00 55 71", franchiseur: "IndÃ©pendant", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", notes: "" },
    { id: "e9", statut: "Suspect", nom: "S.A.R.L DP Lyon 3", nomCommercial: "Domino's Pizza â Lyon 3e", secteur: "Restauration", ville: "Lyon 3e", site: "dominos.fr", tel: "04 78 55 21 09", franchiseur: "Domino's Pizza", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", notes: "" },
    /* ââââ CLIENTS RÃELS â importÃ©s du Sheet Â« Infos Service Client Â» (14/10/2026) ââââ
       Chaque ligne = un code client du Sheet (contrats Locam) : pack choisi,
       pÃ©riode (min dÃ©but â max fin des contrats du client), nombre de vÃ©hicules
       uniques, nÂ° de contrat(s) Locam, immatriculations. Mode de livraison
       Â« Scooter Ã©lectrique Â» pour tous : c'est le produit rÃ©ellement louÃ©
       (COMPACT PRO / INFINITY PRO / S4-S5 Delivery = scooters U'mob, colonne
       LibellÃ© Produit du Sheet). ActivitÃ© renseignÃ©e d'aprÃ¨s l'enseigne
       rÃ©elle (vÃ©rifiÃ©e sur le web pour les cas ambigus). Champ `risque`
       alimentÃ© par les colonnes Statut_risque_client / Impayes /
       Procedure_collective du Sheet. Franchiseur laissÃ© VIDE : le Sheet ne
       le connaÃ®t pas (rÃ¨gle anti-fausses-infos). Contacts rÃ©els rattachÃ©s. */
    { id: "e10", statut: "Client", nom: "GAF", nomCommercial: "BoÃ®te Ã  Pizza Annemasse", secteur: "Restauration", ville: "Annemasse", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le IntÃ©gral + 48", dateDebut: "15/03/2024", dateFin: "05/04/2028", nbVehicules: "2", contratLocam: "CO01559", immatriculations: "GQ-591-NL, GQ-692-NL", risque: "ImpayÃ©", notes: "Code client C0010 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026). â ï¸ ImpayÃ© (source Sheet SAV)." },
    { id: "e11", statut: "Client", nom: "LA GROTTA AZZURA", nomCommercial: "La Grotte", secteur: "Restauration", ville: "Saint-Ãtienne", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration traditionnelle", pack: "ModÃ¨le IntÃ©gral + 48", dateDebut: "26/06/2024", dateFin: "10/08/2028", nbVehicules: "3", contratLocam: "CO01677", immatriculations: "GX-881-RL, GX-801-RL, GX-742-RL", notes: "Code client C0033 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e12", statut: "Client", nom: "JMBS", nomCommercial: "Cosmo Sushi", secteur: "Restauration", ville: "Mandelieu-la-Napoule", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le IntÃ©gral 48 Â· ModÃ¨le IntÃ©gral + 48", dateDebut: "26/03/2021", dateFin: "10/09/2027", nbVehicules: "4", contratLocam: "CO01398, CO01397", immatriculations: "FY-042-CC, GH-367-WG, GH-412-WG, GH-441-WG", notes: "Code client C0046 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026). Autre site : FrÃ©jus (JHE FrÃ©jus Sushi, mÃªmes gÃ©rants)." },
    { id: "e13", statut: "Client", nom: "NKM SARL", nomCommercial: "Dol's Pizza", secteur: "Restauration", ville: "Dole", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort + 48 Â· ModÃ¨le Confort + 50", dateDebut: "13/01/2025", dateFin: "29/08/2030", nbVehicules: "8", contratLocam: "CO01844, CO02220", immatriculations: "HA-008-QX, HA-035-QX, HA-905-QW, HA-945-QW, HA-974-QW, HL-239-NP, HL-209-NP, HL-281-NP", notes: "Code client C0071 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e14", statut: "Client", nom: "H2 ASSOCIÃS", nomCommercial: "Pizza All Over World", secteur: "Restauration", ville: "Nice", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort + 48", dateDebut: "01/05/2023", dateFin: "30/06/2027", nbVehicules: "2", contratLocam: "CO02104", immatriculations: "GN-036-XF, GN-082-XF", notes: "Code client C0109 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e15", statut: "Client", nom: "ALVAREZ MARC", nomCommercial: "Bella Pizza", secteur: "Restauration", ville: "Thonon-les-Bains", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort + 48", dateDebut: "23/10/2024", dateFin: "30/11/2028", nbVehicules: "1", contratLocam: "CO01765", immatriculations: "GZ-706-MH", notes: "Code client C0111 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e16", statut: "Client", nom: "SUSHI NOGENT DÃVELOPPEMENT", nomCommercial: "Sushi Shop", secteur: "Restauration", ville: "Nogent-sur-Marne", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort 48", dateDebut: "22/02/2023", dateFin: "10/04/2027", nbVehicules: "4", contratLocam: "CO01206", immatriculations: "GM-463-FL, GM-490-FL, GM-510-FL, GM-526-FL", notes: "Code client C0113 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e17", statut: "Client", nom: "AVENIR PIZZA", nomCommercial: "Pizza Time", secteur: "Restauration", ville: "Le Bourget", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort 48", dateDebut: "23/02/2023", dateFin: "09/04/2027", nbVehicules: "2", contratLocam: "CO00605", immatriculations: "GM-669-FZ, GM-703-FZ", notes: "Code client C0123 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e18", statut: "Client", nom: "STYLE BURGER", nomCommercial: "Delim's Burger", secteur: "Restauration", ville: "Ãpinay-sur-Seine", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort 48 Â· ModÃ¨le Confort + 48", dateDebut: "10/06/2021", dateFin: "30/08/2027", nbVehicules: "3", contratLocam: "CO00645, CO01159", immatriculations: "FZ-440-WL, GQ-416-AJ, GQ-485-AJ", notes: "Code client C0135 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e19", statut: "Client", nom: "DOCRIVE", nomCommercial: "Class'Croute Paris 19", secteur: "Restauration", ville: "Paris", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Zen 36 Â· ModÃ¨le Confort + 48", dateDebut: "01/01/2018", dateFin: "08/03/2027", nbVehicules: "4", contratLocam: "CO00923, CO00922", immatriculations: "ES-134-WF, ES-138-WF, ES-139-WF, GL-082-XH", risque: "ProcÃ©dure collective", notes: "Code client C0143 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e20", statut: "Client", nom: "VIGILANTI JEAN CLAUDE", nomCommercial: "Fratelli Pizzas", secteur: "Restauration", ville: "Nice", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort + 48", dateDebut: "12/11/2025", dateFin: "10/02/2030", nbVehicules: "2", contratLocam: "CO02086", immatriculations: "HG-937-LK, HG-968-LK", notes: "Code client C0152 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e21", statut: "Client", nom: "TTF CORPORATION", nomCommercial: "Pizza Hut", secteur: "Restauration", ville: "Pontault-Combault", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort + 48 Â· ModÃ¨le Confort + 50", dateDebut: "28/09/2023", dateFin: "21/07/2030", nbVehicules: "4", contratLocam: "CO01357, CO01494, CO02192", immatriculations: "GR-862-JA, GR-825-JA, GT-902-JA, HK-231-TS", notes: "Code client C0162 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e22", statut: "Client", nom: "BON PLAN", nomCommercial: "Spidzza Grand MÃ¨re", secteur: "Restauration", ville: "Valence", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "VP Â· ModÃ¨le Confort + 48 Â· ModÃ¨le Confort + 50", dateDebut: "01/03/2019", dateFin: "20/04/2030", nbVehicules: "5", contratLocam: "CO00075, CO01162, CO02136", immatriculations: "FD-069-TL, FJ-579-KQ, GA-162-TM, FB-680-XL, HH-138-TT", risque: "ImpayÃ©", notes: "Code client C0199 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026). â ï¸ ImpayÃ© (source Sheet SAV)." },
    { id: "e23", statut: "Client", nom: "CCR", nomCommercial: "Mister Pizza", secteur: "Restauration", ville: "Antibes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort + 48 Â· ModÃ¨le Confort + 50", dateDebut: "12/11/2025", dateFin: "12/05/2030", nbVehicules: "5", contratLocam: "CO02085, CO02155", immatriculations: "HG-720-LT, HG-682-LT, HG-640-LT, HJ-902-PJ, HJ-553-PJ", notes: "Code client C0210 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e24", statut: "Client", nom: "AHI (AHIKA) LYON 7", nomCommercial: "", secteur: "Restauration", ville: "Lyon", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le IntÃ©gral + 48", dateDebut: "16/07/2024", dateFin: "15/08/2028", nbVehicules: "1", contratLocam: "CO01694", immatriculations: "GY-681-EE", notes: "Code client C0212 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e25", statut: "Client", nom: "MAHE.COM", nomCommercial: "Pizza Le 33", secteur: "Restauration", ville: "Grasse", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort 48", dateDebut: "20/09/2021", dateFin: "30/09/2025", nbVehicules: "4", contratLocam: "CO00114", immatriculations: "GB-389-RF, GB-766-RF, GB-156-RG, GB-279-RG", notes: "Code client C0213 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e26", statut: "Client", nom: "RICA", nomCommercial: "Mister Pizza", secteur: "Restauration", ville: "Le Cannet", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort + 48 Â· ModÃ¨le Confort + 50", dateDebut: "11/01/2024", dateFin: "30/05/2030", nbVehicules: "12", contratLocam: "CO01506, CO01943, CO02099, CO02164", immatriculations: "GT-150-NE, HC-881-WP, HC-812-WP, HG-191-SY, HG-230-SY, HG-148-SY, HG-094-SY, HG-025-SY, HG-935-SX, HG-851-SX, HJ-564-XC, HJ-486-XC", notes: "Code client C0229 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026). Autre site : Cannes." },
    { id: "e27", statut: "Client", nom: "JSD SUSHIS", nomCommercial: "Sushi Or Not Sushi", secteur: "Restauration", ville: "Marseille", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort 48", dateDebut: "20/12/2018", dateFin: "20/10/2023", nbVehicules: "1", contratLocam: "CO01322", immatriculations: "FB-799-SD", risque: "ImpayÃ© + ProcÃ©dure collective", notes: "Code client C0232 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e28", statut: "Client", nom: "TCHIKO", nomCommercial: "Pizza Time Poissy", secteur: "Restauration", ville: "Poissy", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort 48 Â· ModÃ¨le Confort + 48", dateDebut: "07/03/2022", dateFin: "20/12/2028", nbVehicules: "4", contratLocam: "CO00879, CO01775", immatriculations: "GB-027-QV, GZ-604-WC, GZ-578-WC, GZ-552-WC", notes: "Code client C0245 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e29", statut: "Client", nom: "CARNOT", nomCommercial: "Mister Pizza Cannes", secteur: "Restauration", ville: "Cannes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort + 48", dateDebut: "04/02/2025", dateFin: "28/03/2029", nbVehicules: "15", contratLocam: "CO01875", immatriculations: "HB-023-HJ, HB-051-HJ, HB-091-HJ, HB-130-HJ, HB-171-HJ, HB-223-HJ, HB-676-HH, HB-720-HH, HB-757-HH, HB-798-HH, HB-831-HH, HB-961-HH, HB-297-HJ, HB-450-HJ, HB-928-HH", notes: "Code client C0251 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e30", statut: "Client", nom: "ADG", nomCommercial: "Mister Pizza Cannes", secteur: "Restauration", ville: "Cannes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort 48 Â· ModÃ¨le Confort + 48", dateDebut: "26/04/2023", dateFin: "27/02/2029", nbVehicules: "8", contratLocam: "CO00993, CO01573, CO01861", immatriculations: "GN-245-LJ, GV-228-TW, HB-344-MM, HB-314-MM, HB-276-MM, HB-257-MM, HB-216-MM, HB-162-MM", notes: "Code client C0252 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e31", statut: "Client", nom: "VTN.INC", nomCommercial: "La BoÃ®te Ã  Pizza Muret", secteur: "Restauration", ville: "Muret", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort + 48", dateDebut: "30/04/2024", dateFin: "20/06/2028", nbVehicules: "3", contratLocam: "CO01611", immatriculations: "GW-563-LK, GW-627-LK, GW-695-LK", notes: "Code client C0256 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e32", statut: "Client", nom: "FRANK", nomCommercial: "Pizza Time Franconville", secteur: "Restauration", ville: "Franconville", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort + 36", dateDebut: "26/06/2024", dateFin: "31/07/2029", nbVehicules: "2", contratLocam: "CO01671, CO02201", immatriculations: "GX-634-QR, HK-970-ZE", notes: "Code client C0259 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e33", statut: "Client", nom: "DAFNEY", nomCommercial: "Pizza Time St-Ouen-l'AumÃ´ne", secteur: "Restauration", ville: "Saint-Ouen-l'AumÃ´ne", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort 48", dateDebut: "11/02/2019", dateFin: "30/10/2026", nbVehicules: "3", contratLocam: "CO00904, CO00903", immatriculations: "FD-205-SB, GJ-828-KV, GJ-849-KV", notes: "Code client C0260 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e34", statut: "Client", nom: "LOIRE SUSHI", nomCommercial: "Eat Sushi", secteur: "Restauration", ville: "Saint-Ãtienne", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le IntÃ©gral 48 Â· ModÃ¨le IntÃ©gral + 48", dateDebut: "18/05/2022", dateFin: "28/02/2028", nbVehicules: "3", contratLocam: "CO00596, CO01522", immatriculations: "GG-700-HQ, GT-109-SW, GT-083-SW", notes: "Code client C0268 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e35", statut: "Client", nom: "CHEZ PINO", nomCommercial: "", secteur: "Restauration", ville: "Valence", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort + 48 Â· ModÃ¨le Confort + 50", dateDebut: "28/03/2024", dateFin: "02/09/2030", nbVehicules: "3", contratLocam: "CO01572, CO02222", immatriculations: "GV-297-YF, HL-892-NN, HL-811-NN", notes: "Code client C0270 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026). Autre site : Portes-lÃ¨s-Valence." },
    { id: "e36", statut: "Client", nom: "SEBA", nomCommercial: "Pizza Time Champs-sur-Marne", secteur: "Restauration", ville: "Champs-sur-Marne", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort + 48", dateDebut: "16/01/2025", dateFin: "15/02/2029", nbVehicules: "2", contratLocam: "CO01854", immatriculations: "HB-693-FB, HB-738-FB", notes: "Code client C0272 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e37", statut: "Client", nom: "ALLO PIZZA KELLY BURGER", nomCommercial: "", secteur: "Restauration", ville: "Antibes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort + 48", dateDebut: "10/02/2025", dateFin: "09/03/2029", nbVehicules: "4", contratLocam: "CO01889", immatriculations: "HB-423-SK, HB-465-SK, HB-497-SK, HB-532-SK", notes: "Code client C0281 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e38", statut: "Client", nom: "SIMHA 7", nomCommercial: "Zapi Sushi", secteur: "Restauration", ville: "Nogent-sur-Marne", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort + 50", dateDebut: "15/05/2026", dateFin: "14/07/2030", nbVehicules: "2", contratLocam: "CO02190", immatriculations: "HK-666-SH, HK-773-SH", notes: "Code client C0284 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e39", statut: "Client", nom: "MORENO US", nomCommercial: "Mega Pizza", secteur: "Restauration", ville: "Metz", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort + 48", dateDebut: "23/06/2023", dateFin: "20/02/2028", nbVehicules: "2", contratLocam: "CO01114, CO01507", immatriculations: "GH-141-LA, GT-807-KQ", notes: "Code client C0297 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e40", statut: "Client", nom: "KEVIN", nomCommercial: "Indian Star", secteur: "Restauration", ville: "Beausoleil", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort + 48", dateDebut: "04/07/2024", dateFin: "20/12/2029", nbVehicules: "3", contratLocam: "CO01688, CO02065", immatriculations: "GX-192-TC, HG-776-DS, HG-801-DS", notes: "Code client C0306 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e41", statut: "Client", nom: "CHAMEROY", nomCommercial: "L'Antiboise", secteur: "Restauration", ville: "Antibes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Zen + 48 Â· ModÃ¨le Confort + 48", dateDebut: "25/06/2024", dateFin: "30/12/2029", nbVehicules: "3", contratLocam: "CO01659, CO02067", immatriculations: "GX-912-FA, HG-722-EM, HG-635-EM", notes: "Code client C0307 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e42", statut: "Client", nom: "M BAREK", nomCommercial: "Le D'Lys Tacos", secteur: "Restauration", ville: "Antibes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort + 48", dateDebut: "28/09/2023", dateFin: "20/10/2029", nbVehicules: "3", contratLocam: "CO01356, CO02018", immatriculations: "GR-073-DR, HE-340-SW, HE-385-SW", notes: "Code client C0308 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e43", statut: "Client", nom: "MA-ROSE", nomCommercial: "Pizza Time Taverny", secteur: "Restauration", ville: "Taverny", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort + 36", dateDebut: "24/10/2024", dateFin: "23/11/2027", nbVehicules: "2", contratLocam: "CO01768", immatriculations: "GZ-020-HH, GZ-936-HG", notes: "Code client C0309 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e44", statut: "Client", nom: "LES 2 FRÃRES", nomCommercial: "Specialitaly", secteur: "Restauration", ville: "Menton", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort + 48", dateDebut: "27/04/2023", dateFin: "27/05/2027", nbVehicules: "2", contratLocam: "CO01229", immatriculations: "GN-497-LH, GN-532-LH", risque: "Ã risque", notes: "Code client C0320 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026). â ï¸ Ã risque (source Sheet SAV)." },
    { id: "e45", statut: "Client", nom: "GMA", nomCommercial: "La BoÃ®te Ã  Pizza Cugnaux", secteur: "Restauration", ville: "Cugnaux", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort 48", dateDebut: "25/04/2019", dateFin: "30/04/2023", nbVehicules: "4", contratLocam: "CO00209", immatriculations: "FF-967-QV, FF-043-QW, FF-134-QW, FF-223-QW", risque: "ProcÃ©dure collective", notes: "Code client C0321 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e46", statut: "Client", nom: "SUSHI WAKO", nomCommercial: "Wako", secteur: "Restauration", ville: "Le VÃ©sinet", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Zen 48", dateDebut: "15/09/2020", dateFin: "14/09/2024", nbVehicules: "1", contratLocam: "CO00749", immatriculations: "FS-603-RR", risque: "Ã risque", notes: "Code client C0336 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026). Autres sites : Nanterre, Puteaux. â ï¸ Ã risque (source Sheet SAV)." },
    { id: "e47", statut: "Client", nom: "MER", nomCommercial: "Mister Pizza Nice Californie", secteur: "Restauration", ville: "Nice", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort + 50", dateDebut: "15/06/2026", dateFin: "14/08/2030", nbVehicules: "10", contratLocam: "CO02209", immatriculations: "HL-992-FA, HL-072-FB, HL-034-FB, HL-949-FA, HL-334-FB, HL-129-FB, HL-491-FB, HL-573-FB, HL-420-FB, HL-199-FB", notes: "Code client C0338 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026). Autre site : Vence." },
    { id: "e48", statut: "Client", nom: "MEV", nomCommercial: "Allo Japonais", secteur: "Restauration", ville: "Poitiers", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Zen + 48 Â· ModÃ¨le Zen + 50", dateDebut: "28/12/2023", dateFin: "25/10/2030", nbVehicules: "3", contratLocam: "CO01490, CO02249", immatriculations: "GT-511-DN, HM-129-KS, HM-116-KS", risque: "Ã risque", notes: "Code client C0339 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026). â ï¸ Ã risque (source Sheet SAV)." },
    { id: "e49", statut: "Client", nom: "STAR CHICKEN", nomCommercial: "", secteur: "Restauration", ville: "Albi", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort + 48", dateDebut: "23/06/2023", dateFin: "22/06/2027", nbVehicules: "1", contratLocam: "CO01107", immatriculations: "GH-258-SN", risque: "ImpayÃ©", notes: "Code client C0350 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e50", statut: "Client", nom: "COSTES RESTAURATION", nomCommercial: "Tutti Pizza â Montauban Voltaire", secteur: "Restauration", ville: "Montauban", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort + 48 Â· ModÃ¨le Confort + 50", dateDebut: "13/01/2025", dateFin: "02/10/2030", nbVehicules: "2", contratLocam: "CO01845, CO02239", immatriculations: "HA-866-YL, HM-050-CT", notes: "Code client C0359 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e51", statut: "Client", nom: "SYSM", nomCommercial: "Mister Pizza Mandelieu", secteur: "Restauration", ville: "Mandelieu-la-Napoule", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort + 48", dateDebut: "30/06/2023", dateFin: "20/01/2030", nbVehicules: "9", contratLocam: "CO01361, CO02082", immatriculations: "GQ-937-BF, GQ-892-BF, HG-633-HG, HG-658-HG, HG-686-HG, HG-711-HG, HG-736-HG, HG-765-HG, HG-605-HG", notes: "Code client C0360 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e52", statut: "Client", nom: "JAIVASAVI", nomCommercial: "La Galaxie", secteur: "Restauration", ville: "Saint-Vallier-de-Thiey", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort + 48", dateDebut: "03/04/2025", dateFin: "20/05/2029", nbVehicules: "1", contratLocam: "CO01924", immatriculations: "HC-338-QQ", notes: "Code client C0361 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e53", statut: "Client", nom: "ALIDA", nomCommercial: "Jassmin Pizza", secteur: "Restauration", ville: "Villecresnes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort 48", dateDebut: "10/10/2019", dateFin: "10/10/2023", nbVehicules: "1", contratLocam: "CO00813", immatriculations: "FK-829-NE", risque: "ImpayÃ©", notes: "Code client C0362 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e54", statut: "Client", nom: "BOBUN BOULEVARD", nomCommercial: "", secteur: "Restauration", ville: "Lyon", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort 48", dateDebut: "07/11/2022", dateFin: "20/04/2027", nbVehicules: "1", contratLocam: "CO01438", immatriculations: "GM-279-EZ", risque: "ImpayÃ©", notes: "Code client C0368 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026). â ï¸ ImpayÃ© (source Sheet SAV)." },
    { id: "e55", statut: "Client", nom: "ABDELHAFID GAZZAH", nomCommercial: "Stop Pizza 2", secteur: "Restauration", ville: "Antibes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Zen + 48", dateDebut: "16/02/2023", dateFin: "20/03/2027", nbVehicules: "1", contratLocam: "CO01386", immatriculations: "GM-957-CW", notes: "Code client C0376 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e56", statut: "Client", nom: "BING ME", nomCommercial: "Arigato", secteur: "Restauration", ville: "Bruges", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Zen 48 Â· ModÃ¨le Zen + 48", dateDebut: "10/08/2022", dateFin: "10/01/2028", nbVehicules: "2", contratLocam: "CO00839, CO01467", immatriculations: "GH-698-YA, GS-034-RA", risque: "Ã risque", notes: "Code client C0387 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026). â ï¸ Ã risque (source Sheet SAV)." },
    { id: "e57", statut: "Client", nom: "AEW CANNES", nomCommercial: "Asiakeo", secteur: "Restauration", ville: "Cannes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort 48", dateDebut: "22/07/2022", dateFin: "22/08/2026", nbVehicules: "1", contratLocam: "CO00254", immatriculations: "GH-399-PH", notes: "Code client C0388 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e58", statut: "Client", nom: "NOSANTOKUNOSUSHIS", nomCommercial: "SamouraÃ¯ Sushi Dijon", secteur: "Restauration", ville: "Dijon", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort + 48", dateDebut: "04/06/2024", dateFin: "20/07/2028", nbVehicules: "1", contratLocam: "CO01644", immatriculations: "GX-913-FZ", notes: "Code client C0392 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
    { id: "e59", statut: "Client", nom: "AU FOURNIL DE STEPH", nomCommercial: "Allo Pizza SÃ¨te", secteur: "Restauration", ville: "SÃ¨te", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide", pack: "ModÃ¨le Confort + 50", dateDebut: "05/02/2026", dateFin: "04/04/2030", nbVehicules: "2", contratLocam: "CO02141", immatriculations: "HH-119-ZQ, HH-179-ZQ", notes: "Code client C0397 â importÃ© du Sheet Â« Infos Service Client Â» (14/10/2026)." },
  ],
  contacts: [
    { id: "c1", prenom: "Julien", nom: "Faure", role: "GÃ©rant", email: "j.faure@rotisserie-du-rhone.fr", tel: "06 12 44 87 21", entrepriseIds: ["e1"], activites: [{ date: "auj.", texte: "Appel 6 min : souhaite la maintenance incluse dans le contrat annuel.", type: "appel" }] },
    { id: "c2", prenom: "Amine", nom: "Berrada", role: "GÃ©rant", email: "amine@pokebowl-express.fr", tel: "06 45 21 33 09", entrepriseIds: ["e2"], activites: [{ date: "08/10", texte: "Proposition envoyÃ©e : abonnement 2 scooters + maintenance", type: "email" }] },
    { id: "c3", prenom: "Charlotte", nom: "Ly", role: "Directrice exploitation", email: "c.ly@bieres-et-burgers.fr", tel: "06 88 12 54 76", entrepriseIds: ["e3"], activites: [{ date: "11/10", texte: "A demandÃ© une remise sur la 4e annÃ©e â Ã  creuser en nÃ©go.", type: "appel" }] },
    { id: "c9", prenom: "Kevin", nom: "Dubois", role: "Responsable achats", email: "k.dubois@bieres-et-burgers.fr", tel: "06 77 34 12 98", entrepriseIds: ["e3"] },
    { id: "c4", prenom: "Marc", nom: "Martin", role: "GÃ©rant", email: "marc@martin-fleurs.fr", tel: "06 23 76 90 12", entrepriseIds: ["e4"] },
    { id: "c5", prenom: "Sofiane", nom: "Kaci", role: "GÃ©rant", email: "sofiane@atelier-pizzeria.fr", tel: "06 51 88 22 47", entrepriseIds: ["e5"] },
    { id: "c6", prenom: "Ãlodie", nom: "Perrin", role: "GÃ©rante", email: "elodie@jacquou.fr", tel: "06 14 02 88 53", entrepriseIds: ["e6"] },
    { id: "c7", prenom: "Nadia", nom: "Belkacem", role: "Responsable achats", email: "nadia@marche-bio-69.fr", tel: "â", entrepriseIds: ["e7"] },
    { id: "c8", prenom: "Lina", nom: "Nguyen", role: "GÃ©rante", email: "lina@wok-city.fr", tel: "06 92 45 11 08", entrepriseIds: ["e8"] },
    // Cas PIERRE PIRON : gÃ©rant de plusieurs sociÃ©tÃ©s (15 Domino's) â UN SEUL
    // contact dont le rÃ´le = sa qualitÃ© rÃ©elle (ex-INSEE Â« GÃ©rant Â»), et les
    // sociÃ©tÃ©s qu'il dirige sont portÃ©es par les LIENS (entrepriseIds), pas par
    // le libellÃ© du rÃ´le.
    { id: "c10", prenom: "Pierre", nom: "Piron", role: "GÃ©rant", email: "p.piron@dp-piron.fr", tel: "06 11 22 33 44", entrepriseIds: ["e5", "e9"] },
    /* ââââ CONTACTS RÃELS des clients ci-dessus â Sheet Â« Infos Service Client Â» ââââ */
    { id: "c11", prenom: "Ismail", nom: "Akdogan", role: "GÃ©rant", email: "bap.annemasse@gmail.com", tel: "06 20 47 60 40", entrepriseIds: ["e10"] },
    { id: "c12", prenom: "Kasim", nom: "Altinel", role: "Ancien dirigeant", email: "bap.annemasse@gmail.com", tel: "07 62 74 48 48", entrepriseIds: ["e10"] },
    { id: "c13", prenom: "Daniel", nom: "Pigniatelli Piattone", role: "GÃ©rant", email: "dan4stelle@hotmail.fr", tel: "", entrepriseIds: ["e11"] },
    { id: "c14", prenom: "Vincent", nom: "Pigniatelli Piattone", role: "FrÃ¨re gÃ©rant", email: "", tel: "06 21 54 48 86", entrepriseIds: ["e11"] },
    { id: "c15", prenom: "HÃ©lÃ¨ne", nom: "Silbercher", role: "Femme du gÃ©rant", email: "", tel: "06 27 03 62 92", entrepriseIds: ["e12"] },
    { id: "c16", prenom: "JÃ©rÃ´me", nom: "Silbercher", role: "GÃ©rant", email: "j.silbercher@gmail.com", tel: "06 27 33 32 13", entrepriseIds: ["e12"] },
    { id: "c17", prenom: "Mohammed", nom: "Harden", role: "", email: "m_harden@ymail.com", tel: "06 59 95 05 04", entrepriseIds: ["e14"] },
    { id: "c18", prenom: "Marc", nom: "Alvarez", role: "Dirigeant", email: "DDP.ALVAREZ@YAHOO.FR", tel: "06 20 92 21 96", entrepriseIds: ["e15"] },
    { id: "c19", prenom: "CÃ©dric", nom: "Adam", role: "GÃ©rant", email: "cadam@sushishop.fr", tel: "06 33 05 60 72", entrepriseIds: ["e16"] },
    { id: "c20", prenom: "Reyhan", nom: "Coban", role: "Nouveau gÃ©rant", email: "avenir.pizzatime@gmail.com", tel: "", entrepriseIds: ["e17"] },
    { id: "c21", prenom: "Wajdi", nom: "Habib", role: "AssociÃ©", email: "avenir.pizzatime@gmail.com", tel: "06.40.66.84.43", entrepriseIds: ["e17"] },
    { id: "c22", prenom: "Houcine", nom: "Dahili", role: "GÃ©rant associÃ©", email: "h.dahili@hotmail.fr", tel: "06 58 81 80 58", entrepriseIds: ["e18"] },
    { id: "c23", prenom: "Youssef", nom: "Ounasser", role: "GÃ©rant", email: "styleburger@yahoo.com", tel: "06 20 16 08 54", entrepriseIds: ["e18"] },
    { id: "c24", prenom: "Christian", nom: "Archer", role: "GÃ©rant", email: "Christian.archer@wanadoo.fr", tel: "", entrepriseIds: ["e19"] },
    { id: "c25", prenom: "Jean Claude", nom: "Vigilanti", role: "", email: "jcfratelli@live.fr", tel: "06 35 24 91 42", entrepriseIds: ["e20"] },
    { id: "c26", prenom: "Romain", nom: "Camagie", role: "GÃ©rant", email: "misterpizzaantibes@gmail.com", tel: "06 77 66 97 77", entrepriseIds: ["e23"] },
    { id: "c27", prenom: "Maxence", nom: "Bottero", role: "GÃ©rant", email: "maxencebottero@hotmail.com", tel: "", entrepriseIds: ["e25"] },
    { id: "c28", prenom: "Didier", nom: "Chiaramonti", role: "", email: "ornotsushi@gmail.com", tel: "07 86 03 35 73", entrepriseIds: ["e27"] },
    { id: "c29", prenom: "Sofiane", nom: "Housni", role: "Contact SAV", email: "sofiane.housni.78260@gmail.com", tel: "06.51.46.51.03", entrepriseIds: ["e28"] },
    { id: "c30", prenom: "Didier", nom: "Gomez", role: "GÃ©rant", email: "gomezdidier@wanadoo.fr", tel: "06 11 52 52 87", entrepriseIds: ["e29"] },
    { id: "c31", prenom: "Gilles", nom: "Anguerra", role: "GÃ©rant", email: "comptabilite@mister-pizza.net", tel: "06 09 55 38 55", entrepriseIds: ["e30"] },
    { id: "c32", prenom: "Jessica", nom: "Mahuet", role: "AssociÃ©e", email: "jessicamahuet@yahoo.fr", tel: "", entrepriseIds: ["e31"] },
    { id: "c33", prenom: "William", nom: "Charles", role: "Nouveau gÃ©rant", email: "wicharles42@gmail.com", tel: "06 03 39 32 75", entrepriseIds: ["e34"] },
    { id: "c34", prenom: "Alicia", nom: "Pino", role: "", email: "", tel: "06 37 82 38 72", entrepriseIds: ["e35"] },
    { id: "c35", prenom: "Christian", nom: "Pino", role: "", email: "christian.pino@orange.fr", tel: "06 13 63 93 17", entrepriseIds: ["e35"] },
    { id: "c37", prenom: "Beyhan", nom: "Akdemir", role: "Nouveau gÃ©rant", email: "seba.pizzatime@gmail.com", tel: "06 28 13 22 85", entrepriseIds: ["e36"] },
    { id: "c38", prenom: "SÃ©bastien", nom: "Tesson", role: "Responsable SAV", email: "spike159@hotmail.fr", tel: "06 24 47 50 07", entrepriseIds: ["e36"] },
    { id: "c39", prenom: "Taha", nom: "Abdelaal", role: "Manager", email: "seba.pizzatime@gmail.com", tel: "06 51 72 25 49", entrepriseIds: ["e36"] },
    { id: "c40", prenom: "Zara", nom: "Imajdine", role: "Assistante administrative", email: "seba.pizzatime@gmail.com", tel: "07 62 55 49 92", entrepriseIds: ["e36"] },
    { id: "c41", prenom: "Liam", nom: "Saidi", role: "Nouveau gÃ©rant", email: "liamnzl@icloud.com", tel: "06 98 98 79 40", entrepriseIds: ["e37"] },
    { id: "c42", prenom: "Samir", nom: "Saidi", role: "Ancien gÃ©rant", email: "ouicsam@live.fr", tel: "06 51 73 16 74", entrepriseIds: ["e37"] },
    { id: "c43", prenom: "Franck", nom: "Bouteboul", role: "GÃ©rant", email: "franck.bouteboul@orange.fr", tel: "06 22 47 05 03", entrepriseIds: ["e38"] },
    { id: "c44", prenom: "JosÃ©", nom: "Moreno Monja", role: "GÃ©rant", email: "megapizza57@gmail.com", tel: "06 26 15 29 83", entrepriseIds: ["e39"] },
    { id: "c45", prenom: "Sinnathurai", nom: "Kavilendran", role: "GÃ©rant", email: "indianstarkevin@gmail.com", tel: "06 10 25 80 07", entrepriseIds: ["e40"] },
    { id: "c46", prenom: "FrÃ©dÃ©ric", nom: "Chameroy", role: "GÃ©rant", email: "fredchameroy@yahoo.fr", tel: "06 18 42 15 91", entrepriseIds: ["e41"] },
    { id: "c47", prenom: "Tahar", nom: "M'Barek", role: "GÃ©rant", email: "ledlys.mb@outlook.fr", tel: "06 31 41 96 93", entrepriseIds: ["e42"] },
    { id: "c48", prenom: "Sertac", nom: "Colak", role: "PrÃ©sident", email: "colak.sertac@gmail.com", tel: "06 98 23 23 05", entrepriseIds: ["e43"] },
    { id: "c49", prenom: "Gael", nom: "Nollot", role: "GÃ©rant", email: "gn.bap.cugnaux@gmail.com", tel: "06 59 40 71 16", entrepriseIds: ["e45"] },
    { id: "c50", prenom: "AndrÃ©", nom: "Cong", role: "GÃ©rant", email: "restaurant@sushi-wako78.fr", tel: "06 22 74 46 58", entrepriseIds: ["e46"] },
    { id: "c51", prenom: "Dong", nom: "An", role: "Manager / fils gÃ©rant", email: "dong.an88@yahoo.fr", tel: "06 52 50 00 08", entrepriseIds: ["e46"] },
    { id: "c52", prenom: "Adil", nom: "Elatmani", role: "GÃ©rant", email: "adil.2b@hotmail.fr", tel: "06 61 64 47 34", entrepriseIds: ["e47"] },
    { id: "c53", prenom: "Alexandre", nom: "Robert", role: "GÃ©rant", email: "alexandre.robert.06@gmail.com", tel: "06 98 28 47 34", entrepriseIds: ["e47"] },
    { id: "c54", prenom: "Matthieu", nom: "Lequertier", role: "AssociÃ©", email: "matthieu.lequertier@gmail.com", tel: "06 35 17 53 48", entrepriseIds: ["e49"] },
    { id: "c55", prenom: "Xavier", nom: "Barbier", role: "GÃ©rant", email: "barbier-xavier@orange.fr", tel: "682613140", entrepriseIds: ["e49"] },
    { id: "c56", prenom: "Sandra", nom: "Martin", role: "Femme du gÃ©rant", email: "", tel: "06 68 95 03 14", entrepriseIds: ["e51"] },
    { id: "c57", prenom: "Youssef", nom: "Doudouh", role: "PrÃ©sident", email: "mp.sysm@hotmail.com", tel: "06 64 03 63 92", entrepriseIds: ["e51"] },
    { id: "c58", prenom: "Iqbal", nom: "Shanawaz", role: "Ancien gÃ©rant", email: "lagalaxie06460@gmail.com", tel: "06 52 04 90 39", entrepriseIds: ["e52"] },
    { id: "c59", prenom: "Saranya", nom: "Umabathi", role: "Dirigeant", email: "lagalaxie06460@gmail.com", tel: "07 85 03 25 12", entrepriseIds: ["e52"] },
    { id: "c60", prenom: "Abdelhafid", nom: "Gazzah", role: "GÃ©rant", email: "nathalie.gazzah@gmail.com", tel: "06 76 65 04 84", entrepriseIds: ["e55"] },
    { id: "c61", prenom: "Bingfu", nom: "Peng", role: "", email: "364546783@qq.com", tel: "06 98 13 61 96", entrepriseIds: ["e56"] },
    { id: "c62", prenom: "Aline", nom: "Leblanc", role: "Manager / SAV", email: "", tel: "07 78 82 74 91", entrepriseIds: ["e57"] },
  ],
  deals: [
    { id: "d1", nom: "Contrat annuel â flotte 3 scooters", entrepriseId: "e1", contactId: "c1", montant: 42, etape: "GagnÃ©", action: "Kick-off maintenance", echeance: "20/10", notes: "", fait: false, activites: [{ date: "12/10", texte: "Ãtape : NÃ©gociation â GagnÃ©" }] },
    { id: "d2", nom: "Abonnement 2 scooters", entrepriseId: "e2", contactId: "c2", montant: 31, etape: "GagnÃ©", action: "Planifier livraison flotte", echeance: "22/10", notes: "", fait: false, activites: [{ date: "08/10", texte: "Ãtape : Proposition envoyÃ©e â GagnÃ©" }] },
    { id: "d3", nom: "Flotte 4 scooters + maintenance", entrepriseId: "e3", contactId: "c3", montant: 58, etape: "NÃ©gociation", action: "RDV nÃ©go â levier flotte 4 scooters", echeance: "15/10", notes: "Sensible au prix, envisager 10% sur la 4e annÃ©e.", fait: false, activites: [{ date: "11/10", texte: "Visite effectuÃ©e" }] },
    { id: "d4", nom: "2 scooters livraisons matinales", entrepriseId: "e4", contactId: "c4", montant: 24, etape: "Proposition envoyÃ©e", action: "Relancer la proposition (J+3)", echeance: "13/10", notes: "", fait: false, activites: [{ date: "10/10", texte: "Proposition envoyÃ©e par email" }] },
    { id: "d5", nom: "Abonnement 1 scooter", entrepriseId: "e5", contactId: "c5", montant: 18, etape: "Proposition envoyÃ©e", action: "Attente retour devis", echeance: "17/10", notes: "", fait: false, activites: [] },
    { id: "d6", nom: "2 scooters pÃ©rimÃ¨tre rÃ©duit", entrepriseId: "e6", contactId: "c6", montant: 15, etape: "NÃ©gociation", action: "RÃ©duire le pÃ©rimÃ¨tre â 2 scooters", echeance: "16/10", notes: "Refuser 3 scooters pour l'instant.", fait: false, activites: [] },
    { id: "d7", nom: "DÃ©couverte â livraison bio", entrepriseId: "e7", contactId: "c7", montant: 36, etape: "Ã qualifier", action: "Appel dÃ©couverte Ã  programmer", echeance: "15/10", notes: "Contact entrant via le site.", fait: false, activites: [] },
    { id: "d8", nom: "Essai 1 scooter", entrepriseId: "e8", contactId: "c8", montant: 12, etape: "Ã qualifier", action: "Qualifier pÃ©rimÃ¨tre & budget", echeance: "18/10", notes: "", fait: false, activites: [] },
  ],
};

// ââ Persistance PRODUCTION (Supabase) ââââââââââââââââââââââââââââââââââââââââ
// La base vit dans la table `crm_etat` (une ligne jsonb, voir src/lib/supabase.ts) :
// chargÃ©e Ã  l'ouverture, sauvegardÃ©e automatiquement Ã  chaque modification.
// La normalisation ci-dessous (champs manquants â valeurs vides, `activites`
// rÃ©injectÃ©, `entrepriseId` â `entrepriseIds`) s'applique aussi bien aux
// donnÃ©es distantes qu'au seed : les fiches importÃ©es du Sheet ne contiennent
// pas toutes les clÃ©s, et un enregistrement sans `activites` ferait planter
// les .map() en aval (crash "not iterable").
function normaliser(s: Etat): Etat {
  return {
    ...s,
    entreprises: (s.entreprises || []).map((x) => ({
      nomCommercial: "", franchiseur: "", modeLivraison: "", activite: "", statut: "Suspect",
      // Migration Â« Contrat & flotte Â» : champs absents des vieilles
      // sauvegardes â vides (jamais d'invention).
      pack: "", dateDebut: "", dateFin: "", nbVehicules: "", contratLocam: "", immatriculations: "",
      // Migration Â« Risque Â» : champ absent des vieilles sauvegardes â vide.
      risque: "",
      modeles: [],
      ...x,
      contrats: x.contrats || ((x.pack || x.contratLocam) ? [{ pack: x.pack || "", modele: "", num: x.contratLocam || "", dateDebut: x.dateDebut || "", dateFin: x.dateFin || "", immats: x.immatriculations || "", etat: "" }] : []),
      activites: x.activites || [],
    })),
    // Migration contacts : l'ancien champ unique `entrepriseId` devient un
    // TABLEAU `entrepriseIds` (un contact peut appartenir Ã  plusieurs
    // entreprises). Les vieux enregistrements sont convertis Ã  la volÃ©e.
    contacts: (s.contacts || []).map((x) => ({
      ...x,
      entrepriseIds: x.entrepriseIds || ((x as { entrepriseId?: string }).entrepriseId ? [(x as { entrepriseId: string }).entrepriseId] : []),
      activites: x.activites || [],
    })),
  };
}

// Ãtat Â« base vide Â» (aucune donnÃ©e dans Supabase). UtilisÃ© par l'Ã©cran
// d'initialisation : on ne prÃ©-remplit JAMAIS sans dÃ©cision explicite.
const ETAT_VIDE: Etat = { entreprises: [], contacts: [], deals: [] };

// DÃ©connexion manuelle (bouton de la barre latÃ©rale).
async function seDeconnecter() {
  await supabase.auth.signOut();
}

/* ============================== UI DE BASE ============================== */

// Petit badge colorÃ© (Ã©tapes du pipeline, Ã©chÃ©ances, compteursâ¦).
// Le fond est la couleur passÃ©e avec ~13% d'opacitÃ© (suffixe hexa "22").
function Badge({ texte, couleur }: { texte: string; couleur: string }) {
  return (
    <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold" style={{ background: `${couleur}22`, color: "#334155" }}>
      {texte}
    </span>
  );
}

// Styles partagÃ©s des champs de formulaire (input/textarea/select de la modale).
const champ = "w-full rounded-xl border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-cyan-500";
const label = "mb-1 block text-[11px] font-bold text-slate-500";

/* ââ Nouveaux champs Â« fiche entreprise Â» : Franchiseur / Mode de livraison /
   ActivitÃ© ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
   Valeurs NORMALISÃES en menus dÃ©roulants (et non du texte libre) : c'est ce
   qui permettra de filtrer proprement et surtout de faire remplir ces champs
   automatiquement plus tard â par l'analyse IA des conversations (appels,
   e-mails) ou par une recherche internet automatique sur l'entreprise.
   L'IA n'aura qu'Ã  choisir dans la liste au lieu d'inventer du texte. */
const OPTIONS_FRANCHISEUR = ["IndÃ©pendant", "Domino's Pizza", "Burger King", "McDonald's", "KFC", "Subway", "Pizza Hut", "O'Tacos", "La BoÃ®te Ã  Pizza"];
const OPTIONS_MODE_LIVRAISON = ["Scooter Ã©lectrique", "Scooter thermique", "VÃ©lo Ã©lectrique", "Cargo bike", "Voiture", "Ã pied", "Mixte"];
const OPTIONS_ACTIVITE = ["Restauration rapide", "Restauration traditionnelle", "Livraison de repas", "Boulangerie / PÃ¢tisserie", "Commerce floral", "Alimentation bio", "Commerce de dÃ©tail", "Services", "Autre"];
// Valeurs du champ Â« Risque Â» (source Sheet SAV : Statut_risque_client,
// Impayes, Procedure_collective). L'option vide Â« â Â» de ChampSelect vaut
// Â« aucun risque signalÃ© Â».
const OPTIONS_RISQUE = ["ImpayÃ©", "Ã risque", "ProcÃ©dure collective", "ImpayÃ© + ProcÃ©dure collective"];

/* ââ Statut du cycle de vie : Suspect â Prospect â Client âââââââââââââââââââ
   C'est le seul champ que l'humain maÃ®trise totalement : ni les API ni l'IA
   ne le remplissent automatiquement (on ne Â« devine Â» pas qu'un prospect est
   devenu client), c'est l'Ã©quipe commerciale qui le fait Ã©voluer au fil du
   cycle. Couleurs : Suspect = gris, Prospect = bleu, Client = vert. */
const STATUTS = ["Suspect", "Prospect", "Client"] as const;
type Statut = (typeof STATUTS)[number];
const COULEUR_STATUT: Record<string, string> = { Suspect: "#94a3b8", Prospect: "#4f9ee8", Client: "#57c26b" };

/* Menu dÃ©roulant rÃ©utilisable, stylÃ© exactement comme les champs texte
   (mÃªmes bordures arrondies, mÃªme focus cyan). Valeur vide = option Â« â Â». */
function ChampSelect({ valeur, options, onChange }: { valeur: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <select className={champ} value={valeur} onChange={(e) => onChange(e.target.value)}>
      <option value="">â</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

/* ââ Annuaire de DÃMONSTRATION pour la recherche auto d'entreprise ââââââââââ
   Dans la version dÃ©ployÃ©e, la recherche par SIREN appellera l'API publique
   Â« Recherche d'entreprises Â» (recherche-entreprises.api.gouv.fr â gratuite,
   sans clÃ©, donnÃ©es INSEE : dÃ©nomination, NOM COMMERCIAL/sigle/enseigne,
   adresse, activitÃ© NAF, dirigeantsâ¦) et la recherche par tÃ©lÃ©phone fixe
   l'API Pappers (standard des entreprises). Le canvas Ã©tant 100 % hors-ligne,
   on SIMULE ces sources avec quelques fiches locales : l'Ã©cran et le
   comportement seront identiques le jour oÃ¹ on branche les vraies API.
   â ï¸ RÃ¨gle anti-fausses-infos : un champ inconnu des sources reste VIDE
   (ex. NVL ATLAS â l'INSEE ne connaÃ®t ni son enseigne, ni son tÃ©lÃ©phone,
   ni son mode de livraison). */
const ANNUAIRE_DEMO = [
  // `sources` = provenance des donnÃ©es ; `contactsTrouves` = contacts
  // identifiÃ©s (dirigeant INSEE, annuairesâ¦) proposÃ©s Ã  la crÃ©ation avec
  // des cases Ã  cocher / dÃ©cocher.
  { siren: "823456782", tel: "0147501122", telAffiche: "01 47 50 11 22", nom: "S.A.R.L SGZ", nomCommercial: "Domino's Pizza â Nanterre", ville: "Nanterre", secteur: "Restauration", site: "dominos.fr", franchiseur: "Domino's Pizza", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide",
    sources: ["INSEE", "Pappers", "Web"],
    contactsTrouves: [{ prenom: "Sebastien", nom: "ZIG", role: "GÃ©rant", email: "be-s75@hotmail.fr", tel: "+33 6 50 22 33 00" }] },
  { siren: "512345678", tel: "0472110244", telAffiche: "04 72 11 02 44", nom: "Rotisserie du RhÃ´ne", nomCommercial: "Rotisserie du RhÃ´ne â Lyon 7e", ville: "Lyon 7e", secteur: "Restauration", site: "rotisserie-du-rhone.fr", franchiseur: "IndÃ©pendant", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration traditionnelle",
    sources: ["INSEE", "Pappers"],
    contactsTrouves: [{ prenom: "Julien", nom: "Faure", role: "GÃ©rant", email: "j.faure@rotisserie-du-rhone.fr", tel: "06 12 44 87 21" }] },
  { siren: "901234567", tel: "0437998877", telAffiche: "04 37 99 88 77", nom: "Le Kiosque Ã  Burgers", nomCommercial: "Le Kiosque Ã  Burgers â Lyon 9e", ville: "Lyon 9e", secteur: "Restauration", site: "kiosque-a-burgers.fr", franchiseur: "Burger King", modeLivraison: "Mixte", activite: "Restauration rapide",
    sources: ["INSEE", "Pappers", "Web"],
    contactsTrouves: [{ prenom: "Kevin", nom: "Dubois", role: "Responsable achats", email: "k.dubois@bieres-et-burgers.fr", tel: "06 77 34 12 98" }] },
  { siren: "753456789", tel: "0478442266", telAffiche: "04 78 44 22 66", nom: "Sushi Loop", nomCommercial: "Sushi Loop â Villeurbanne", ville: "Villeurbanne", secteur: "Restauration", site: "sushiloop.fr", franchiseur: "IndÃ©pendant", modeLivraison: "Scooter Ã©lectrique", activite: "Livraison de repas",
    sources: ["INSEE", "Pappers"],
    contactsTrouves: [{ prenom: "Lina", nom: "Nguyen", role: "GÃ©rante", email: "lina@sushiloop.fr", tel: "06 92 45 11 08" }] },
  { siren: "404567890", tel: "0472669911", telAffiche: "04 72 66 99 11", nom: "Fournil de Gerland", nomCommercial: "Fournil de Gerland â Lyon 7e", ville: "Lyon 7e", secteur: "Boulangerie", site: "fournil-gerland.fr", franchiseur: "IndÃ©pendant", modeLivraison: "Cargo bike", activite: "Boulangerie / PÃ¢tisserie",
    sources: ["INSEE", "Pappers", "Web"],
    contactsTrouves: [{ prenom: "Marc", nom: "Martin", role: "GÃ©rant", email: "marc@fournil-gerland.fr", tel: "06 23 76 90 12" }] },
  // Cas PIERRE PIRON : autre sociÃ©tÃ© du mÃªme gÃ©rant. S'il est dÃ©jÃ  dans le CRM
  // (seed), la recherche ne recrÃ©e PAS un 2e contact : le panneau affiche
  // Â« dÃ©jÃ  connu â sera rattachÃ© Â» et l'enregistrement ajoute juste un lien
  // entreprise â contact sur le contact EXISTANT. En production, le rÃ´le
  // viendra de la qualitÃ© INSEE (GÃ©rant, PrÃ©sident de SASâ¦), et chaque sociÃ©tÃ©
  // oÃ¹ il est dirigeant crÃ©era un lien â jamais un libellÃ© inventÃ©.
  { siren: "812345678", tel: "0472398877", telAffiche: "04 72 39 88 77", nom: "S.A.R.L DP Lyon 6", nomCommercial: "Domino's Pizza â Lyon 6e", ville: "Lyon 6e", secteur: "Restauration", site: "dominos.fr", franchiseur: "Domino's Pizza", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide",
    sources: ["INSEE", "Pappers"],
    contactsTrouves: [{ prenom: "Pierre", nom: "Piron", role: "GÃ©rant", email: "p.piron@dp-piron.fr", tel: "06 11 22 33 44" }] },
  // AUTRE sociÃ©tÃ© du mÃªme gÃ©rant (M. Piron), MÃME activitÃ© (NAF) â sera
  // suggÃ©rÃ©e Ã  la crÃ©ation de n'importe laquelle de ses sociÃ©tÃ©s du mÃªme NAF.
  { siren: "823456783", tel: "0478661274", telAffiche: "04 78 66 12 74", nom: "S.A.R.L DP Lyon 7", nomCommercial: "Domino's Pizza â Lyon 7e", ville: "Lyon 7e", secteur: "Restauration", site: "dominos.fr", franchiseur: "Domino's Pizza", modeLivraison: "Scooter Ã©lectrique", activite: "Restauration rapide",
    sources: ["INSEE", "Pappers"],
    contactsTrouves: [{ prenom: "Pierre", nom: "Piron", role: "GÃ©rant", email: "p.piron@dp-piron.fr", tel: "06 11 22 33 44" }] },
  // SociÃ©tÃ© de M. Piron avec un NAF DIFFÃRENT (holding) â ne doit JAMAIS Ãªtre
  // suggÃ©rÃ©e lors d'une crÃ©ation de restaurant : le filtre Â« mÃªme code NAF Â»
  // l'exclut (rÃ¨gle anti-fausses-infos : pas d'assimilation hasardeuse).
  { siren: "834567890", tel: "0472335590", telAffiche: "04 72 33 55 90", nom: "PIRON INVEST", nomCommercial: "", ville: "Lyon 6e", secteur: "Finance", site: "", franchiseur: "", modeLivraison: "", activite: "ActivitÃ©s de holding",
    sources: ["INSEE"],
    contactsTrouves: [{ prenom: "Pierre", nom: "Piron", role: "PrÃ©sident", email: "p.piron@dp-piron.fr", tel: "06 11 22 33 44" }] },
  // â ï¸ VRAIE entreprise, COMPILATION MULTI-SOURCES du 14/10 : INSEE (NVL
  // ATLAS, SAS, 62 rue de GenÃ¨ve Gaillard, NAF restauration rapide) +
  // web/annuaires (enseigne Â« Atlas Halal Â» boucherie au mÃªme local,
  // tÃ©lÃ©phone 04 85 47 94 39 via Bottin.fr). Dirigeant INSEE : Hatam RACHED
  // (PrÃ©sident de SAS) â proposÃ© Ã  la crÃ©ation en contact. E-mail/tÃ©lÃ©phone
  // perso du dirigeant : inconnus â vides (jamais d'invention).
  { siren: "100515550", tel: "0485479439", telAffiche: "04 85 47 94 39", nom: "NVL ATLAS", nomCommercial: "Atlas Halal â Gaillard", ville: "Gaillard", secteur: "Boucherie", site: "", franchiseur: "", modeLivraison: "", activite: "Commerce de dÃ©tail",
    sources: ["INSEE", "Annuaire web", "Google"],
    contactsTrouves: [{ prenom: "Hatam", nom: "RACHED", role: "PrÃ©sident de SAS", email: "", tel: "" }] },
];

/* ============================== MODALE ============================== */

// Â« Cible Â» = ce que la modale doit Ã©diter. C'est le routeur du formulaire :
//  - id: null    â mode crÃ©ation (on part d'un modÃ¨le vide)
//  - id: valeur  â mode modification (on charge l'objet existant)
//  - preset     â prÃ©-remplissage d'une association lors d'une crÃ©ation
//                 (ex. Â« + Contact Â» depuis une fiche entreprise prÃ©-coche l'entreprise)
type Cible =
  | { type: "entreprise"; id: string | null; preset?: undefined }
  | { type: "contact"; id: string | null; preset?: string }
  | { type: "deal"; id: string | null; preset?: string };

// Â« FicheRef Â» = une page record Ã  afficher (entreprise ou contact).
// Contrairement Ã  Cible, l'id est obligatoire : une fiche modifie via la modale.
type FicheRef = { type: "entreprise" | "contact"; id: string };

// Â« ContactSimple Â» = contact identifiÃ© par la recherche automatique (SIREN/tÃ©lÃ©phone).
// Format allÃ©gÃ© : on ne crÃ©e pas encore un Contact complet, on propose juste
// les infos trouvÃ©es, l'utilisateur coche/dÃ©coche avant crÃ©ation.
type ContactSimple = { prenom: string; nom: string; role: string; email: string; tel: string };

// Â« SocieteSimple Â» = une AUTRE sociÃ©tÃ© du mÃªme dirigeant, suggÃ©rÃ©e Ã  la
// crÃ©ation (ex. le 2e Domino's de M. Piron). MÃªme principe que les contacts :
// une case Ã  cocher pour accepter ou refuser chaque crÃ©ation.
type SocieteSimple = { nom: string; nomCommercial: string; ville: string; secteur: string; site: string; tel: string; franchiseur: string; modeLivraison: string; activite: string; dejaClient?: string; proprietaire?: string };

// ModÃ¨les vierges servant de point de dÃ©part en mode crÃ©ation.
const ENT_VIDE: Entreprise = { id: "", nom: "", nomCommercial: "", secteur: "", ville: "", site: "", tel: "", franchiseur: "", modeLivraison: "", activite: "", statut: "Suspect", notes: "", activites: [], pack: "", dateDebut: "", dateFin: "", nbVehicules: "", contratLocam: "", immatriculations: "", risque: "", modeles: [], contrats: [] };
const CTC_VIDE: Contact = { id: "", prenom: "", nom: "", role: "", email: "", tel: "", entrepriseIds: [], activites: [] };
const DEAL_VIDE: Deal = { id: "", nom: "", entrepriseId: "", contactId: "", montant: 0, etape: "Ã qualifier", action: "", echeance: "", notes: "", fait: false, activites: [] };

// Formulaire gÃ©nÃ©rique pour les 3 types d'objets. Une seule modale, un rendu
// conditionnel par type (cible.type) : l'entreprise a son bloc, le contact le sien, etc.
function Modale({
  cible, etat, onClose, onSauver, onSupprimer, onOuvre, onOuvreFiche,
}: {
  cible: Cible;
  etat: Etat;
  onClose: () => void;
  onSauver: (c: Cible, donnees: Entreprise | Contact | Deal, contactsAuto?: ContactSimple[], societesAuto?: SocieteSimple[]) => void;
  onSupprimer: (c: Cible) => void;
  onOuvre: (c: Cible) => void;       // ouvre une AUTRE modale (Ã©dition d'un deal, crÃ©ation d'un contactâ¦)
  onOuvreFiche: (f: FicheRef) => void; // navigue vers une page record (ferme la modale)
}) {
  // Ãtat local = copie de travail de l'objet en cours d'Ã©dition.
  // On ne charge l'objet correspondant au type de la cible ; les autres restent vides.
  // En crÃ©ation, `preset` prÃ©-remplit l'association (entreprise du contact, entreprise du deal).
  const [ent, setEnt] = useState<Entreprise>(
    cible.type === "entreprise" ? (etat.entreprises.find((e) => e.id === cible.id) || ENT_VIDE) : ENT_VIDE
  );
  const [ctc, setCtc] = useState<Contact>(
    cible.type === "contact" ? (etat.contacts.find((c) => c.id === cible.id) || { ...CTC_VIDE, entrepriseIds: cible.preset ? [cible.preset] : [] }) : CTC_VIDE
  );
  const [deal, setDeal] = useState<Deal>(
    cible.type === "deal" ? (etat.deals.find((d) => d.id === cible.id) || { ...DEAL_VIDE, entrepriseId: cible.preset || "" }) : DEAL_VIDE
  );
  // ââ Recherche automatique : SIREN ou NOM -> VRAIE API Recherche dâentreprises
  // (data.gouv, appelÃ©e depuis le navigateur, gratuite, sans clÃ©, CORS ouvert).
  // TÃ©lÃ©phone -> annuaire local pour lâinstant (lâAPI Pappers branchera la
  // vraie recherche par tÃ©lÃ©phone plus tard). RÃ¨gle anti-fausses-infos conservÃ©e :
  // les champs inconnus de la source restent VIDES, jamais dâinvention.
  const [qRecherche, setQRecherche] = useState("");
  const [msgRecherche, setMsgRecherche] = useState<{ ok: boolean; texte: string } | null>(null);
  // Score de confiance /100 de la fiche compilÃ©e (affichÃ© sous la barre de
  // recherche) + provenance des donnÃ©es (INSEE, Pappers, annuaires webâ¦).
  const [scoreFiche, setScoreFiche] = useState<{ score: number; sources: string[] } | null>(null);
  // Contacts identifiÃ©s par la recherche (dirigeant INSEE, annuairesâ¦) :
  // proposÃ©s Ã  la crÃ©ation avec des cases Ã COCHER â cochÃ©s par dÃ©faut, on
  // peut dÃ©cocher ceux qu'on ne veut pas crÃ©er avec l'entreprise.
  const [contactsProposes, setContactsProposes] = useState<(ContactSimple & { coche: boolean })[]>([]);
  // AUTRES sociÃ©tÃ©s du mÃªme dirigeant (mÃªme code NAF) suggÃ©rÃ©es Ã  la crÃ©ation,
  // avec UNE case Ã  cocher par sociÃ©tÃ© â DÃCOCHÃES par dÃ©faut : crÃ©er une
  // entreprise est plus engageant que rattacher un contact, on opte IN.
  const [societesProposees, setSocietesProposees] = useState<(SocieteSimple & { siren: string; sources: string[]; coche: boolean })[]>([]);
  // ââ Applique une fiche trouvÃ©e (API gouv OU annuaire local) : prÃ©-remplit le
  // formulaire, propose les contacts identifiÃ©s, calcule le score de confiance.
  const appliquer = (f: (typeof ANNUAIRE_DEMO)[number]) => {
    // Toutes les infos trouvÃ©es prÃ©-remplissent le formulaire ; les champs
    // inconnus des sources RESTENT VIDES (jamais d'invention), et
    // l'utilisateur garde la main pour vÃ©rifier avant d'enregistrer.
    setEnt((e) => ({
      ...e,
      nom: f.nom, nomCommercial: f.nomCommercial, ville: f.ville, secteur: f.secteur, tel: f.telAffiche, site: f.site,
      franchiseur: f.franchiseur, modeLivraison: f.modeLivraison, activite: f.activite,
    }));
    // Contacts identifiÃ©s : proposÃ©s COCHÃS par dÃ©faut (on pourra dÃ©cocher).
    setContactsProposes(f.contactsTrouves.map((ct) => ({ ...ct, coche: true })));
    // ââ AUTRES SOCIÃTÃS DU MÃME DIRIGEANT âââââââââââââââââââââââââââââââââââ
    // On cherche dans l'annuaire les sociÃ©tÃ©s qui ont UN DIRIGEANT EN COMMUN
    // (mÃªme personne : email / tÃ©l / prÃ©nom+nom) ET le MÃME code NAF (champ
    // `activite`) â c'est le critÃ¨re demandÃ© par Corentin : suggÃ©rer les autres
    // sociÃ©tÃ©s de M. Piron Â« avec le mÃªme code NAF par exemple Â». Les sociÃ©tÃ©s
    // dÃ©jÃ  en base ne sont pas re-proposÃ©es ; les suggestions sont DÃCOCHÃES
    // par dÃ©faut (acceptation explicite, case par case). En production, cette
    // liste viendra d'une recherche inversÃ©e par dirigeant (API Pappers).
    const dejaEnBase = (g: { nom: string; nomCommercial: string }) =>
      etat.entreprises.some((x) =>
        x.nom.trim().toLowerCase() === g.nom.trim().toLowerCase() ||
        (g.nomCommercial !== "" && x.nomCommercial.trim().toLowerCase() === g.nomCommercial.trim().toLowerCase()));
    const autres = ANNUAIRE_DEMO.filter((g) =>
      g !== f &&
      g.activite === f.activite && // mÃªme code NAF uniquement
      g.contactsTrouves.some((gc) => f.contactsTrouves.some((fc) => memePersonne(gc, fc)))
    ).filter((g) => !dejaEnBase(g));
    setSocietesProposees(autres.map((g) => ({ ...g, coche: false })));
    // Message explicite : on liste les champs rÃ©ellement remplis et on rappelle
    // que les champs inconnus des sources restent vides (rÃ¨gle anti-fausses
    // infos) â pour Ã©viter l'impression que Â« rien ne s'est rempli Â».
    const remplis = [
      f.nom && "nom",
      f.nomCommercial && "nom commercial",
      f.ville && "ville",
      f.secteur && "secteur",
      f.telAffiche && "tÃ©lÃ©phone",
      f.site && "site web",
      f.franchiseur && "franchiseur",
      f.modeLivraison && "mode de livraison",
      f.activite && "activitÃ©",
    ].filter(Boolean) as string[];
    // ââ SCORE DE CONFIANCE /100 ââââââââââââââââââââââââââââââââââââââââââââââ
    // Compilation de toutes les sources : chaque champ renseignÃ© apporte des
    // points selon son poids pour une fiche exploitable (somme des poids = 100).
    // Plus les sources couvrent la fiche, plus le score monte â mais un champ
    // sans source fiable ne rapporte RIEN (rÃ¨gle anti-fausses infos), et tout
    // reste modifiable Ã  la main avant enregistrement.
    const POIDS: [unknown, number][] = [
      [f.nom, 15], [f.nomCommercial, 10], [f.ville, 10], [f.secteur, 10],
      [f.telAffiche, 15], [f.site, 5], [f.franchiseur, 10],
      [f.modeLivraison, 10], [f.activite, 10], [f.contactsTrouves.length, 5],
    ];
    const score = POIDS.reduce((s, [v, p]) => s + (v ? p : 0), 0);
    setScoreFiche({ score, sources: f.sources });
    setMsgRecherche({
      ok: true,
      texte: `â¨ ${f.nom} trouvÃ©${f.ville ? ` (${f.ville})` : ""} â ${remplis.length} champ${remplis.length > 1 ? "s" : ""} rempli${remplis.length > 1 ? "s" : ""} : ${remplis.join(", ")}.`
        + (f.contactsTrouves.length
          ? ` ð¤ ${f.contactsTrouves.length} contact${f.contactsTrouves.length > 1 ? "s" : ""} identifiÃ©${f.contactsTrouves.length > 1 ? "s" : ""} â crÃ©ation proposÃ©e ci-dessous (dÃ©cochez si besoin).`
          : "")
        + (autres.length
          ? ` ð¢ ${autres.length} autre${autres.length > 1 ? "s" : ""} sociÃ©tÃ©${autres.length > 1 ? "s" : ""} du mÃªme dirigeant (mÃªme NAF) suggÃ©rÃ©e${autres.length > 1 ? "s" : ""} ci-dessous.`
          : "")
        + " Champs inconnus des sources : laissÃ©s vides (jamais d'invention).",
    });
  };
  // ââ NAF (code) -> activitÃ© CRM, et section NAF -> secteur CRM. Mappings factuels
  // (libellÃ©s INSEE). Code inconnu -> champ laissÃ© VIDE.
  const NAF_ACTIVITE: Record<string, string> = {
    "56.10A": "Restauration traditionnelle", "56.10B": "Restauration traditionnelle",
    "56.10C": "Restauration rapide", "56.10D": "Restauration traditionnelle",
    "56.21Z": "Restauration rapide", "10.71A": "Boulangerie / PÃ¢tisserie",
    "10.71B": "Boulangerie / PÃ¢tisserie", "10.71C": "PÃ¢tisserie",
    "10.71D": "Boulangerie / PÃ¢tisserie", "10.85Z": "Livraison de repas",
    "10.86Z": "Livraison de repas", "47.11A": "Commerce alimentaire",
    "47.11B": "Commerce alimentaire", "47.11C": "Commerce alimentaire",
    "47.11D": "Commerce alimentaire", "47.11E": "Commerce alimentaire",
    "47.11F": "Commerce alimentaire", "47.22Z": "Boucherie",
    "47.23Z": "Poissonnerie", "47.24Z": "Boulangerie / PÃ¢tisserie",
    "53.20Z": "Livraison / messagerie", "49.41A": "Transport routier de fret",
    "49.41B": "Transport routier de fret",
  };
  const SECTION_SECTEUR: Record<string, string> = {
    A: "Agriculture", B: "Industrie", C: "Industrie", D: "Ãnergie", E: "Eau / dÃ©chets",
    F: "Construction", G: "Commerce", H: "Transport", I: "Restauration",
    J: "Information / communication", K: "Finance", L: "Immobilier",
    M: "Services", N: "Services", O: "Administration", P: "Enseignement",
    Q: "SantÃ©", R: "Culture / loisirs", S: "Autres services", T: "Autres services", U: "Autres services",
  };
  const capitaliser = (s: string) =>
    s.toLowerCase().replace(/(^|[\s'â-])(.)/g, (m, a, b) => a + b.toUpperCase());
  // Convertit un rÃ©sultat de lâAPI gouv en fiche compilÃ©e. Champs inconnus de
  // lâINSEE (tÃ©lÃ©phone, site, franchiseur, mode de livraison) : VIDES.
  // Dirigeants PERSONNES MORALES (ex. une holding comme ADAVEN, PrÃ©sident de SAS) :
  // une sociÃ©tÃ© ne peut pas Ãªtre un contact â on va chercher SES propres
  // dirigeants personnes physiques (ex. Nicolas Bourbao, gÃ©rant dâADAVEN). Le
  // rÃ´le mentionne la sociÃ©tÃ© intermÃ©diaire : info rÃ©elle INSEE, zÃ©ro invention.
  const depuisGouv = async (r: Record<string, unknown>, clientsSheet: ClientSheet[]): Promise<{ fiche: (typeof ANNUAIRE_DEMO)[number]; soeurs: SocieteSimple[] }> => {
    const siege = (r.siege || {}) as Record<string, any>;
    const enseigne = String(siege.nom_commercial || (Array.isArray(siege.liste_enseignes) ? siege.liste_enseignes[0] : "") || "");
    const ville = siege.libelle_commune ? capitaliser(String(siege.libelle_commune)) : "";
    const naf = String(r.activite_principale || "");
    const estPhysique = (d: unknown) => {
      const dd = d as Record<string, any>;
      return dd && dd.type_dirigeant === "personne physique" && dd.nom && dd.prenoms;
    };
    const enContact = (d: unknown, suffixeRole = "") => {
      const dd = d as Record<string, any>;
      return {
        prenom: String(dd.prenoms || "").split(" ")[0],
        nom: String(dd.nom || "").replace(/\s*\(.*\)\s*/g, "").trim(),
        role: String(dd.qualite || "") + suffixeRole, email: "", tel: "",
      };
    };
    const dirs = (r.dirigeants as unknown[]) || [];
    let contacts = dirs.filter(estPhysique).slice(0, 3).map((d) => enContact(d));
    // RÃ©solution des dirigeants personnes morales (1 niveau, max 2 sociÃ©tÃ©s).
    const morales = dirs
      .filter((d) => {
        const dd = d as Record<string, any>;
        return dd && dd.type_dirigeant === "personne morale" && dd.siren;
      })
      .slice(0, 2);
    for (const m of morales) {
      const mm = m as Record<string, any>;
      try {
        const rep = await fetch("https://recherche-entreprises.api.gouv.fr/search?q=" + encodeURIComponent(String(mm.siren)) + "&per_page=1");
        if (!rep.ok) continue;
        const js = (await rep.json()) as { results?: Record<string, unknown>[] };
        const rm = (js.results || [])[0];
        if (!rm) continue;
        const dm = ((rm.dirigeants as unknown[]) || []).filter(estPhysique).slice(0, 1)
          .map((d) => enContact(d, " Â· via " + String(mm.denomination || mm.siren)));
        contacts = contacts.concat(dm).slice(0, 3);
      } catch { /* rÃ©seau indisponible : on garde les personnes physiques dÃ©jÃ  trouvÃ©es */ }
    }
    // ââ SociÃ©tÃ©s sÅurs â TOUS les dirigeants identifiÃ©s ââââââââââââââââââââââââ
    // On cherche les autres sociÃ©tÃ©s de CHAQUE dirigeant identifiÃ© : (1) les
    // personnes physiques (ex. les autres Dominoâs de Chbihi) ; (2) le DIRIGEANT
    // PERSONNE MORALE lui-mÃªme (ex. ADAVEN) â ses sociÃ©tÃ©s sont celles oÃ¹ ADAVEN
    // est dirigeant : NB1, ONES 22, LANTREGOR (Dominoâs Pizza), ARMORYCâ¦ Le cas
    // Bourbao/Â­ADAVEN/Â­NOUR BREIZH : les sociÃ©tÃ©s du gÃ©rant rÃ©el sont portÃ©es par la
    // holding, donc seule la recherche par personne morale les remonte.
    let societesSoeurs: SocieteSimple[] = [];
    // Un PANIER par dirigeant interrogÃ© + dÃ©duplication globale par SIREN :
    // on entrelacera les paniers Ã  la fin (cf. fusion ci-dessous).
    const paniers: SocieteSimple[][] = [];
    const vus = new Set<string>();
    const dejaConnues = etat.entreprises.map((e) => e.nom.trim().toLowerCase());
    const sectionRef = String(r.section_activite_principale || "");
    const ajouterSoeurs = async (terme: string, physique: boolean, proprio: string) => {
      try {
        const repS = await fetch("https://recherche-entreprises.api.gouv.fr/search?q=" + encodeURIComponent(terme) + (physique ? "&personne_physique=true" : "&personne_morale=true") + "&per_page=15");
        if (!repS.ok) return;
        const jsS = (await repS.json()) as { results?: Record<string, unknown>[] };
        const liste = (jsS.results || []).filter((x) =>
          x.etat_administratif === "A" &&
          String(x.siren) !== String(r.siren) &&
          (sectionRef === "" || String((x as Record<string, any>).section_activite_principale || "") === sectionRef)
        );
        const panier: SocieteSimple[] = [];
        for (const x of liste) {
          const sx = x as Record<string, any>;
          const nomX = String(sx.nom_complet || "").trim().toLowerCase();
          if (dejaConnues.includes(nomX)) continue;
          if (vus.has(String(sx.siren))) continue;
          const sg = (sx.siege || {}) as Record<string, any>;
          const vx = sg.libelle_commune ? capitaliser(String(sg.libelle_commune)) : "";
          const enseigneX = String(sg.nom_commercial || (Array.isArray(sg.liste_enseignes) ? sg.liste_enseignes[0] : "") || "");
          // ââ DÃ©jÃ  client ? On signale les suggestions correspondant Ã  une fiche
          // CLIENT existante (les clients rÃ©els du Sheet ont Ã©tÃ© importÃ©s dans la base).
          // Reconnaissance prudente, rÃ¨gle anti-invention : mÃªme enseigne ET mÃªme
          // ville que la fiche client (le nom lÃ©gal peut diffÃ©rer) ; dans le doute,
          // pas de badge.
          const cli = etat.entreprises.find((e) => {
            if (e.statut !== "Client" || !enseigneX) return false;
            const ensFiche = (e.nomCommercial.split(" â ")[0] || e.nomCommercial).trim();
            const vA = norme(e.ville), vB = norme(vx);
            return norme(ensFiche) === norme(enseigneX) && vA !== "" &&
              (vA === vB || (vA.length >= 4 && vB.length >= 4 && (vA.startsWith(vB) || vB.startsWith(vA))));
          });
          // ââ Le Sheet Â« Infos Service Client Â» est interrogÃ© EN DIRECT : si la
          // sociÃ©tÃ© sÅur y figure, elle est cliente â badge vert Ã  la crÃ©ation.
          const sh = trouverClientSheet(clientsSheet, String(sx.nom_complet || ""), enseigneX, vx);
          panier.push({
            siren: String(sx.siren || ""),
            dejaClient: cli ? cli.nomCommercial : (sh ? sh.nom : ""),
            proprietaire: norme(proprio),
            nom: String(sx.nom_complet || ""),
            nomCommercial: enseigneX && vx ? enseigneX + " â " + vx : enseigneX,
            ville: vx,
            secteur: SECTION_SECTEUR[String(sx.section_activite_principale || "")] || "",
            site: "", tel: "", franchiseur: franchiseurDepuis(enseigneX), modeLivraison: "",
            activite: NAF_ACTIVITE[String(sx.activite_principale || "")] || "",
            sources: ["INSEE Â· API Recherche dâentreprises"],
          });
          vus.add(String(sx.siren));
        }
        paniers.push(panier);
      } catch { /* rÃ©seau indisponible : on garde ce qui est dÃ©jÃ  collectÃ© */ }
    };
    // (1) personnes physiques identifiÃ©es (max 2, sinon trop dâappels)
    for (const c of contacts.slice(0, 2)) {
      await ajouterSoeurs(c.prenom + " " + c.nom, true, c.prenom + " " + c.nom);
    }
    // (2) dirigeants personnes morales (les holdings â ex. ADAVEN : max 1)
    for (const mm of morales.slice(0, 1)) {
      await ajouterSoeurs(String(mm.denomination || ""), false, String(mm.denomination || mm.siren));
    }
    // ââ Fusion des paniers EN ENTRERELAÃANT les dirigeants : sans Ã§a, un gros
    // portefeuille (ex. les 8 Dominoâs de Chbihi) remplit la limite et cache
    // complÃ¨tement les autres (ex. ceux de Bourbao, portÃ©s par la holding
    // ADAVEN). On alterne 1 pour 1 entre les paniers, limite globale 9.
    let tour = 0;
    while (societesSoeurs.length < 9 && paniers.some((p) => p.length > 0)) {
      const panier = paniers[tour % paniers.length];
      if (panier.length > 0) societesSoeurs.push(panier.shift()!);
      tour++;
      if (tour > 300) break; // garde-fou
    }
    return {
      fiche: {
        siren: String(r.siren || ""), tel: "", telAffiche: "",
        nom: String(r.nom_complet || r.nom_raison_sociale || ""),
        nomCommercial: enseigne && ville ? enseigne + " â " + ville : enseigne,
        ville,
        secteur: SECTION_SECTEUR[String(r.section_activite_principale || "")] || "",
        site: "", franchiseur: franchiseurDepuis(enseigne), modeLivraison: "",
        activite: NAF_ACTIVITE[naf] || "",
        sources: ["INSEE Â· API Recherche dâentreprises"],
        contactsTrouves: contacts,
      },
      soeurs: societesSoeurs,
    };
  };
  const rienTrouve = () => {
    setMsgRecherche({ ok: false, texte: "Aucune entreprise trouvÃ©e pour Â« " + qRecherche + " Â» â remplissez la fiche manuellement." });
    setScoreFiche(null);
    setContactsProposes([]);
    setSocietesProposees([]);
  };
  const annuaireLocal = (q: string) => {
    const qt = qRecherche.trim().toLowerCase();
    return ANNUAIRE_DEMO.find((x) =>
      x.siren === q || x.tel === q ||
      (qt.length >= 3 && (x.nom.toLowerCase().includes(qt) || x.nomCommercial.toLowerCase().includes(qt)))
    );
  };
  // ââ Recherche rÃ©elle : SIREN (9 chiffres) ou nom (â¥ 3 caractÃ¨res) ->
  // API Recherche dâentreprises. TÃ©lÃ©phone -> annuaire local. Repli sur
  // lâannuaire local en cas dâÃ©chec ou de rÃ©sultat vide.
  // Repli annuaire local : consulter le Sheet AUSSI ici (le chemin API gouv
  // le fait dÃ©jÃ ) â sinon un client du Sheet crÃ©Ã© via l'annuaire arrive sans
  // contrats ni modÃ¨les.
  const remplirDepuisSheet = (f: { nom: string; nomCommercial: string; ville: string }) => {
    chargerClientsSheet().then(({ clients }) => {
      const cliS = trouverClientSheet(clients, f.nom, (f.nomCommercial.split(" â ")[0] || f.nomCommercial), f.ville);
      if (cliS) setEnt((e) => ({ ...e, statut: "Client" as Statut, pack: cliS.packs, modeles: cliS.modeles, contrats: cliS.lignes, dateDebut: cliS.dateDebut, dateFin: cliS.dateFin, nbVehicules: cliS.nbVehicules, contratLocam: cliS.contrats, immatriculations: cliS.immats, risque: cliS.risque, notes: "Client selon le Sheet Â« Infos Service Client Â» (" + cliS.code + " Â· " + cliS.nom + ") â contrat prÃ©-rempli depuis le Sheet, Ã  vÃ©rifier avant enregistrement." }));
    });
  };
  const enrichir = async () => {
    let q = qRecherche.replace(/\D/g, "");
    if (q.length === 11 && q.startsWith("33")) q = "0" + q.slice(2);
    const qt = qRecherche.trim();
    if (q.length >= 10 && q.startsWith("0")) {
      const f = annuaireLocal(q);
      if (f) { appliquer(f); remplirDepuisSheet(f); }
      else rienTrouve();
      return;
    }
    if (!(q.length === 9 || qt.length >= 3)) { rienTrouve(); return; }
    setMsgRecherche({ ok: true, texte: "ð Recherche en coursâ¦" });
    try {
      const url = "https://recherche-entreprises.api.gouv.fr/search?q=" + encodeURIComponent(qt || q) + "&per_page=5";
      const rep = await fetch(url);
      if (!rep.ok) throw new Error("HTTP " + rep.status);
      const js = (await rep.json()) as { results?: Record<string, unknown>[] };
      const resultats = js.results || [];
      const actifs = resultats.filter((r) => r.etat_administratif === "A");
      const r = (actifs.length ? actifs : resultats)[0];
      if (r) {
                const { clients: clientsSheet, lectureOk: sheetOk } = await chargerClientsSheet();
        const { fiche, soeurs } = await depuisGouv(r, clientsSheet);
        appliquer(fiche);
        // ââ Sheet en direct : si la sociÃ©tÃ© cherchÃ©e est CLIENTE, on coche
        // Â« Client Â» et on prÃ©-remplit les champs contrat & flotte depuis le
        // Sheet (donnÃ©es rÃ©elles de la source officielle â rien dâinventÃ©,
        // lâutilisateur vÃ©rifie avant dâenregistrer ; sans match, tout reste vide).
        const cliS = trouverClientSheet(clientsSheet, fiche.nom, (fiche.nomCommercial.split(" â ")[0] || fiche.nomCommercial), fiche.ville);
        if (cliS) {
          setEnt((e) => ({ ...e, statut: "Client" as Statut, pack: cliS.packs, modeles: cliS.modeles, contrats: cliS.lignes, dateDebut: cliS.dateDebut, dateFin: cliS.dateFin, nbVehicules: cliS.nbVehicules, contratLocam: cliS.contrats, immatriculations: cliS.immats, risque: cliS.risque, notes: "Client selon le Sheet Â« Infos Service Client Â» (" + cliS.code + " Â· " + cliS.nom + ") â contrat prÃ©-rempli depuis le Sheet, Ã  vÃ©rifier avant enregistrement." }));
        }
        // Sheet illisible : partage retirÃ© ou Google bloque lâaccÃ¨s anonyme.
        // On le DIT au lieu de laisser croire quâaucune sociÃ©tÃ© nâest cliente.
        if (!sheetOk) setMsgRecherche((m) => m ? { ...m, texte: m.texte + " â ï¸ Sheet Â« Infos Service Client Â» illisible â badges Â« DÃ©jÃ  client Â» et contrat auto indisponibles â vÃ©rifier le partage Â« lien Â»." } : m);
        if (soeurs.length > 0) {
          setSocietesProposees((prev) => prev.concat(soeurs.map((s) => ({ ...s, coche: false }))));
        }
      } else {
        const f = annuaireLocal(q);
        if (f) { appliquer(f); remplirDepuisSheet(f); }
        else rienTrouve();
      }
    } catch {
      const f = annuaireLocal(q);
      if (f) { appliquer(f); remplirDepuisSheet(f); }
      else {
        rienTrouve();
        setMsgRecherche({ ok: false, texte: "â ï¸ Recherche en ligne indisponible (erreur rÃ©seau) et absente de lâannuaire local â remplissez la fiche manuellement." });
      }
    }
  };
  const nouveau = !cible.id; // pas d'id = on est en train de CRÃER l'objet
  const titre =
    cible.type === "entreprise" ? (nouveau ? "Nouvelle entreprise" : ent.nom)
    : cible.type === "contact" ? (nouveau ? "Nouveau contact" : `${ctc.prenom} ${ctc.nom}`)
    : (nouveau ? "Nouveau deal" : deal.nom);

  // SÃ©lecteurs d'associations pour le bloc entreprise (et pour filtrer les
  // contacts disponibles dans le formulaire deal : on ne propose que les
  // contacts de l'entreprise choisie).
  const contactsEntreprise = (eid: string) => etat.contacts.filter((c) => c.entrepriseIds.includes(eid));
  const dealsEntreprise = (eid: string) => etat.deals.filter((d) => d.entrepriseId === eid);

  return (
    // Fond assombri : cliquer DESSUS ferme la modale (clic hors du formulaire).
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* stopPropagation : un clic Ã  l'intÃ©rieur du panneau ne doit PAS fermer. */}
      <motion.div
        initial={{ scale: 0.94, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-black text-slate-800">{titre}</h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-[13px] font-semibold text-slate-400 hover:bg-slate-100">â</button>
        </div>

        {/* -------- BLOC ENTREPRISE : champs + associations (visible uniquement pour cible.type === "entreprise") -------- */}
        {cible.type === "entreprise" && (
          <>
            {/* Barre de recherche auto : SIREN ou tÃ©lÃ©phone fixe â prÃ©-remplit
                toute la fiche. DÃ©mo hors-ligne (annuaire local) ; en production :
                API data.gouv pour le SIREN + API Pappers pour le tÃ©lÃ©phone. */}
            <div className="mt-4 rounded-xl border border-cyan-100 bg-cyan-50/70 p-3">
              <div className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-cyan-700">ð Recherche automatique â SIREN, tÃ©lÃ©phone ou nom</div>
              <div className="flex gap-2">
                <input
                  className={champ}
                  value={qRecherche}
                  onChange={(e) => setQRecherche(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); enrichir(); } }}
                  placeholder="ex. 823456782, 01 47 50 11 22 ou Domino's"
                />
                <button onClick={enrichir}
                  className="shrink-0 rounded-xl px-4 text-[12px] font-black text-white"
                  style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>
                  Rechercher
                </button>
              </div>
              {msgRecherche && (
                <div className={"mt-1.5 text-[11.5px] font-semibold " + (msgRecherche.ok ? "text-emerald-600" : "text-orange-500")}>
                  {msgRecherche.texte}
                </div>
              )}
              {/* Score de confiance de la fiche compilÃ©e : vert â¥ 75, orange
                  40-74, rouge < 40. Chaque donnÃ©e reste modifiable Ã  la main. */}
              {scoreFiche && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 shadow-sm">
                  <span className="text-[11.5px] font-black"
                    style={{ color: scoreFiche.score >= 75 ? "#16a34a" : scoreFiche.score >= 40 ? "#f59e0b" : "#ef4444" }}>
                    ð¡ï¸ Score de confiance : {scoreFiche.score}/100
                  </span>
                  <span className="text-[10px] font-semibold text-slate-400">
                    Sources compilÃ©es : {scoreFiche.sources.join(" + ")}
                  </span>
                  <span className="ml-auto text-[10px] font-bold text-slate-500">
                    â Champs auto-remplis modifiables
                  </span>
                </div>
              )}
              <div className="mt-1 text-[10px] text-slate-400">DÃ©mo hors-ligne â en production : API Recherche d'entreprises (data.gouv) pour le SIREN, Pappers pour le tÃ©lÃ©phone.</div>

              {/* Panneau Â« Contacts identifiÃ©s Â» : chaque contact trouvÃ© par la recherche auto
                  est proposÃ© Ã  la crÃ©ation, cochÃ© par dÃ©faut. L'utilisateur peut dÃ©cocher
                  ceux qu'il ne veut PAS crÃ©er (rÃ¨gle forte : rien n'est imposÃ©). */}
              {nouveau && contactsProposes.length > 0 && (
                <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-black text-emerald-800">
                      ð¥ Contacts identifiÃ©s ({contactsProposes.filter((x) => x.coche).length}/{contactsProposes.length} seront crÃ©Ã©s ou rattachÃ©s)
                    </span>
                    {/* Tout cocher / tout dÃ©cocher en un clic. */}
                    <button
                      onClick={() => {
                        const toutCoche = contactsProposes.every((x) => x.coche);
                        const apres = contactsProposes.map((x) => ({ ...x, coche: !toutCoche }));
                        setContactsProposes(apres);
                        const cles = apres.filter((x) => x.coche).flatMap(clesContact);
                        setSocietesProposees((prev) => prev.filter((g) => !g.proprietaire || cles.includes(g.proprietaire)));
                      }}
                      className="text-[11px] font-bold text-emerald-700 underline hover:text-emerald-900">
                      {contactsProposes.every((x) => x.coche) ? "Tout dÃ©cocher" : "Tout cocher"}
                    </button>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {contactsProposes.map((ct, i) => {
                      // Anti-doublons en direct : si la personne est dÃ©jÃ  dans
                      // le CRM (mÃªme email / tÃ©l / prÃ©nom+nom), on ne crÃ©e PAS un
                      // 2e contact â on RATTACHE juste la nouvelle entreprise.
                      const existant = etat.contacts.find((x) => memePersonne(ct, x));
                      return (
                      /* Une ligne = une case Ã  cocher + nom/role + coordonnÃ©es visibles. */
                      <label key={i} className="flex cursor-pointer items-start gap-2 rounded-lg bg-white px-2.5 py-2 hover:bg-emerald-50">
                        <input
                          type="checkbox"
                          checked={ct.coche}
                          onChange={() => {
                          const apres = contactsProposes.map((x, j) => (j === i ? { ...x, coche: !x.coche } : x));
                          setContactsProposes(apres);
                          // DÃ©cocher un dirigeant retire AUSSI ses sociÃ©tÃ©s suggÃ©rÃ©es
                          // (les siennes + celles collectÃ©es via sa holding).
                          const cles = apres.filter((x) => x.coche).flatMap(clesContact);
                          setSocietesProposees((prev) => prev.filter((g) => !g.proprietaire || cles.includes(g.proprietaire)));
                        }}
                          className="mt-0.5 h-4 w-4 accent-emerald-600" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12px] font-bold text-slate-800">
                            {ct.prenom} {ct.nom}
                            {ct.role && <span className="ml-1.5 font-medium text-slate-500">â {ct.role}</span>}
                          </span>
                          {(ct.email || ct.tel) && (
                            <span className="block text-[11px] text-slate-500">
                              {[ct.email, ct.tel].filter(Boolean).join(" Â· ")}
                            </span>
                          )}
                          {existant ? (
                            <span className="mt-0.5 block text-[10.5px] font-bold text-cyan-700">
                              ð dÃ©jÃ  dans ton CRM ({existant.entrepriseIds.length} entreprise{existant.entrepriseIds.length > 1 ? "s" : ""}) â sera rattachÃ©, pas de doublon crÃ©Ã©
                            </span>
                          ) : (
                            <span className="mt-0.5 block text-[10.5px] font-bold text-emerald-600">â¨ nouveau contact â sera crÃ©Ã©</span>
                          )}
                        </span>
                      </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Panneau Â« Autres sociÃ©tÃ©s du mÃªme dirigeant Â» : le rÃ©seau
                  d'affaires du dirigeant identifiÃ© (recherche inversÃ©e par
                  dirigeant en production). UNE case PAR sociÃ©tÃ©, DÃCOCHÃE par
                  dÃ©faut â on accepte explicitement chaque crÃ©ation ; les
                  sociÃ©tÃ©s cochÃ©es seront crÃ©Ã©es avec le dirigeant rattachÃ©. */}
              {nouveau && societesProposees.length > 0 && (
                <div className="mt-3 rounded-xl border border-cyan-200 bg-cyan-50/60 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-black text-cyan-800">
                      ð¢ Autres sociÃ©tÃ©s de {contactsProposes[0]?.prenom} {contactsProposes[0]?.nom} â mÃªme NAF ({societesProposees.filter((x) => x.coche).length}/{societesProposees.length} cochÃ©e{Math.min(societesProposees.filter((x) => x.coche).length, 1) ? "s" : ""} â crÃ©Ã©es)
                    </span>
                    <button
                      onClick={() => {
                        const toutCoche = societesProposees.every((x) => x.coche);
                        setSocietesProposees(societesProposees.map((x) => ({ ...x, coche: !toutCoche })));
                      }}
                      className="text-[11px] font-bold text-cyan-700 underline hover:text-cyan-900">
                      {societesProposees.every((x) => x.coche) ? "Tout dÃ©cocher" : "Tout cocher"}
                    </button>
                  </div>
                  <div className="mt-1 text-[10px] text-cyan-600">
                    DÃ©cochÃ©es par dÃ©faut : coche uniquement celles que tu veux ajouter au CRM maintenant. Le dirigeant sera rattachÃ© Ã  chacune. Les suggestions marquÃ©es Â« DÃ©jÃ  client Â» existent dÃ©jÃ  en base (clients du Sheet Â« Infos Service Client Â», interrogÃ© en direct) â inutile de les recrÃ©er. DÃ©cocher un dirigeant ci-dessus retire aussi ses sociÃ©tÃ©s de cette liste.
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {societesProposees.map((g, i) => (
                      <label key={g.siren} className="flex cursor-pointer items-start gap-2 rounded-lg bg-white px-2.5 py-2 hover:bg-cyan-50">
                        <input
                          type="checkbox"
                          checked={g.coche}
                          onChange={() => setSocietesProposees(societesProposees.map((x, j) => (j === i ? { ...x, coche: !x.coche } : x)))}
                          className="mt-0.5 h-4 w-4 accent-cyan-600" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12px] font-bold text-slate-800">
                            {g.nom}
                            {g.ville && <span className="ml-1.5 font-medium text-slate-500">â {g.ville}</span>}
                            {g.dejaClient && <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black text-emerald-700">DÃ©jÃ  clientÂ : {g.dejaClient}</span>}
                          </span>
                          {(g.nomCommercial || g.activite || g.tel) && (
                            <span className="block text-[11px] text-slate-500">
                              {[g.nomCommercial, g.activite, g.tel].filter(Boolean).join(" Â· ")}
                            </span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className={label}>Nom *</label>
                <input className={champ} value={ent.nom} onChange={(e) => setEnt({ ...ent, nom: e.target.value })} /></div>
              {/* Nom commercial = enseigne trouvÃ©e via API + ville Ã  la fin
                  (ex. Â« Domino's Pizza â Nanterre Â»). Si l'API n'a rien trouvÃ©
                  d'officiel, on laisse VIDE plutÃ´t que d'inventer (rÃ¨gle
                  anti-fausses-informations). */}
              <div className="col-span-2"><label className={label}>Nom commercial <span className="font-normal normal-case text-slate-400">(enseigne + ville, ex. Domino's Pizza â Nanterre)</span></label>
                <input className={champ} value={ent.nomCommercial} onChange={(e) => setEnt({ ...ent, nomCommercial: e.target.value })} placeholder="ex. Domino's Pizza â Nanterre" /></div>
              {/* Statut du cycle de vie (Suspect / Prospect / Client) : c'est
                  l'Ã©quipe commerciale qui le fait Ã©voluer â jamais auto. */}
              <div><label className={label}>Statut</label>
                <ChampSelect valeur={ent.statut} options={[...STATUTS]} onChange={(v) => setEnt({ ...ent, statut: v as Statut })} /></div>
              <div><label className={label}>Secteur</label>
                <input className={champ} value={ent.secteur} onChange={(e) => setEnt({ ...ent, secteur: e.target.value })} placeholder="ex. Restauration" /></div>
              <div><label className={label}>Ville</label>
                <input className={champ} value={ent.ville} onChange={(e) => setEnt({ ...ent, ville: e.target.value })} /></div>
              <div><label className={label}>Site web</label>
                <input className={champ} value={ent.site} onChange={(e) => setEnt({ ...ent, site: e.target.value })} /></div>
              <div><label className={label}>TÃ©lÃ©phone</label>
                <input className={champ} value={ent.tel} onChange={(e) => setEnt({ ...ent, tel: e.target.value })} /></div>
              {/* Nouveaux champs normalisÃ©s en menus dÃ©roulants : aujourd'hui
                  choisis Ã  la main, Ã  terme remplis automatiquement par l'IA
                  (analyse des conversations / recherche internet sur
                  l'entreprise) â d'oÃ¹ des options figÃ©es plutÃ´t que du texte
                  libre : l'IA n'aura qu'Ã  sÃ©lectionner la bonne valeur. */}
              <div><label className={label}>Franchiseur</label>
                <ChampSelect valeur={ent.franchiseur} options={OPTIONS_FRANCHISEUR} onChange={(v) => setEnt({ ...ent, franchiseur: v })} /></div>
              <div><label className={label}>Mode de livraison</label>
                <ChampSelect valeur={ent.modeLivraison} options={OPTIONS_MODE_LIVRAISON} onChange={(v) => setEnt({ ...ent, modeLivraison: v })} /></div>
              <div><label className={label}>ActivitÃ©</label>
                <ChampSelect valeur={ent.activite} options={OPTIONS_ACTIVITE} onChange={(v) => setEnt({ ...ent, activite: v })} /></div>
              {/* ââ Contrat & flotte : renseignÃ©s pour les clients (source :
                  Sheet Â« Infos Service Client Â» / contrats Locam). Ãditables
                  Ã  la main, comme tous les champs du CRM. ââ */}
              <div className="col-span-2 mt-1 rounded-lg bg-slate-50 px-2 py-1.5 text-[11px] font-black uppercase tracking-wider text-slate-400">ModÃ¨les de scooter (U'mob)</div>
              <div className="col-span-2"><label className={label}>ModÃ¨le(s) louÃ©(s) par ce client</label>
                <div className="flex flex-wrap gap-1.5">
                  {MODELES_SCOOTER.map((m) => {
                    const on = (ent.modeles || []).includes(m);
                    return (
                      <button key={m} type="button" onClick={() => setEnt((x) => ({ ...x, modeles: on ? (x.modeles || []).filter((y) => y !== m) : [...(x.modeles || []), m] }))}
                        className={"rounded-lg px-2.5 py-1.5 text-[12px] font-bold transition " + (on ? "bg-emerald-500 text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200")}>
                        {on ? "â " : ""}{m}
                      </button>
                    );
                  })}
                  {(ent.modeles || []).filter((m) => !MODELES_SCOOTER.includes(m)).map((m) => (
                    <button key={m} type="button" onClick={() => setEnt((x) => ({ ...x, modeles: (x.modeles || []).filter((y) => y !== m) }))}
                      className="rounded-lg bg-emerald-500 px-2.5 py-1.5 text-[12px] font-bold text-white shadow-sm">â {m}</button>
                  ))}
                </div>
                <div className="mt-1 text-[10.5px] text-slate-400">PrÃ©-cochÃ©s automatiquement si le client figure dans le Sheet Â« Infos Service Client Â» (colonne LibellÃ© Produit client) â sinon sÃ©lection manuelle.</div>
              </div>
              <div className="col-span-2 mt-1 rounded-lg bg-slate-50 px-2 py-1.5 text-[11px] font-black uppercase tracking-wider text-slate-400">Contrat & flotte (Locam) â un bloc par contrat</div>
              {(ent.contrats || []).map((k, i) => (
                <div key={i} className="col-span-2 rounded-xl border border-slate-200 bg-slate-50/60 p-2">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[11px] font-black text-slate-500">Contrat {i + 1}{k.num ? " â " + k.num : ""}{k.etat ? " Â· " + k.etat : ""}</span>
                    <button type="button" onClick={() => setEnt((x) => ({ ...x, contrats: (x.contrats || []).filter((_, j) => j !== i) }))}
                      className="text-[11px] font-bold text-red-400 hover:underline">â Retirer</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className={label}>Pack</label>
                      <input className={champ} value={k.pack} onChange={(e) => setEnt((x) => ({ ...x, contrats: (x.contrats || []).map((k2, j) => j === i ? { ...k2, pack: e.target.value } : k2) }))} placeholder="ex. ModÃ¨le Confort + 48" /></div>
                    <div><label className={label}>NÂ° Locam</label>
                      <input className={champ} value={k.num} onChange={(e) => setEnt((x) => ({ ...x, contrats: (x.contrats || []).map((k2, j) => j === i ? { ...k2, num: e.target.value } : k2) }))} placeholder="ex. CO01559" /></div>
                    <div><label className={label}>DÃ©but</label>
                      <input className={champ} value={k.dateDebut} onChange={(e) => setEnt((x) => ({ ...x, contrats: (x.contrats || []).map((k2, j) => j === i ? { ...k2, dateDebut: e.target.value } : k2) }))} placeholder="ex. 15/03/2024" /></div>
                    <div><label className={label}>Fin</label>
                      <input className={champ} value={k.dateFin} onChange={(e) => setEnt((x) => ({ ...x, contrats: (x.contrats || []).map((k2, j) => j === i ? { ...k2, dateFin: e.target.value } : k2) }))} placeholder="ex. 05/04/2028" /></div>
                    <div className="col-span-2"><label className={label}>Immatriculations</label>
                      <input className={champ} value={k.immats} onChange={(e) => setEnt((x) => ({ ...x, contrats: (x.contrats || []).map((k2, j) => j === i ? { ...k2, immats: e.target.value } : k2) }))} placeholder="ex. GQ-591-NL, GQ-692-NL" /></div>
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => setEnt((x) => ({ ...x, contrats: [...(x.contrats || []), { pack: "", modele: "", num: "", dateDebut: "", dateFin: "", immats: "", etat: "" }] }))}
                className="col-span-2 rounded-lg border border-dashed border-slate-300 py-1.5 text-[12px] font-bold text-cyan-600 hover:bg-cyan-50">+ Ajouter un contrat</button>
              <div><label className={label}>Risque (source SAV)</label>
                <ChampSelect valeur={ent.risque} options={OPTIONS_RISQUE} onChange={(v) => setEnt({ ...ent, risque: v })} /></div>
              <div className="col-span-2"><label className={label}>Notes</label>
                <textarea rows={2} className={champ + " resize-none"} value={ent.notes} onChange={(e) => setEnt({ ...ent, notes: e.target.value })} /></div>
            </div>
            {/* Panneau d'associations, seulement en modification (une nouvelle
                entreprise ne peut pas encore avoir de contacts ni de deals). */}
            {!nouveau && (
              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">Contacts ({contactsEntreprise(ent.id).length})</span>
                  <button onClick={() => onOuvre({ type: "contact", id: null, preset: ent.id })}
                    className="text-[11px] font-bold text-cyan-600 hover:underline">+ Ajouter</button>
                </div>
                {/* Cliquer un contact ouvre sa PAGE RECORD (pas son Ã©dition). */}
                {contactsEntreprise(ent.id).map((c) => (
                  <button key={c.id} onClick={() => onOuvreFiche({ type: "contact", id: c.id })}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left hover:bg-white">
                    <span className="text-[12px] font-semibold text-slate-700">{c.prenom} {c.nom} <span className="text-slate-400">Â· {c.role}</span></span>
                    <span className="text-[10px] font-bold text-cyan-600">âº</span>
                  </button>
                ))}
                <div className="mb-1.5 mt-3 text-[11px] font-black uppercase tracking-wider text-slate-400">Deals ({dealsEntreprise(ent.id).length})</div>
                {/* Les deals n'ont pas de page record : ils s'Ã©ditent en modale. */}
                {dealsEntreprise(ent.id).map((d) => (
                  <button key={d.id} onClick={() => onOuvre({ type: "deal", id: d.id })}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left hover:bg-white">
                    <span className="text-[12px] font-semibold text-slate-700">{d.nom}</span>
                    <span className="flex items-center gap-2">
                      <Badge texte={d.etape} couleur={couleurEtape(d.etape)} />
                      <span className="text-[11px] font-black text-slate-600">{d.montant} kâ¬</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="mt-5 flex items-center gap-2">
              {/* Fallback "Sans nom" pour ne jamais crÃ©er d'entreprise sans titre.
                  En crÃ©ation, on transmet aussi les contacts cochÃ©s ET les
                  autres sociÃ©tÃ©s du dirigeant cochÃ©es (3e et 4e arguments). */}
              <button onClick={() => onSauver(cible, { ...ent, ...fusionnerContrats(ent.contrats), nom: ent.nom.trim() || "Sans nom" },
                nouveau ? contactsProposes.filter((x) => x.coche) : undefined,
                nouveau ? societesProposees.filter((x) => x.coche) : undefined)}
                className="flex-1 rounded-xl py-2.5 text-[13px] font-black text-white" style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>
                {nouveau ? "CrÃ©er l'entreprise" : "Enregistrer"}
              </button>
              {/* Le bouton Supprimer n'existe qu'en modification (pas en crÃ©ation). */}
              {!nouveau && (
                <button onClick={() => onSupprimer(cible)}
                  className="rounded-xl border border-red-200 px-3 py-2.5 text-[12px] font-bold text-red-500 hover:bg-red-50">Supprimer</button>
              )}
            </div>
          </>
        )}

        {/* -------- BLOC CONTACT -------- */}
        {cible.type === "contact" && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div><label className={label}>PrÃ©nom *</label>
                <input className={champ} value={ctc.prenom} onChange={(e) => setCtc({ ...ctc, prenom: e.target.value })} /></div>
              <div><label className={label}>Nom *</label>
                <input className={champ} value={ctc.nom} onChange={(e) => setCtc({ ...ctc, nom: e.target.value })} /></div>
              <div><label className={label}>RÃ´le</label>
                <input className={champ} value={ctc.role} onChange={(e) => setCtc({ ...ctc, role: e.target.value })} placeholder="ex. GÃ©rant" /></div>
              {/* L'association entreprise est MULTI-comptes (ex. Pierre Piron,
                  gÃ©rant de 15 Domino's = 1 contact, 15 cases cochÃ©es) :
                  chaque case = un rattachement indÃ©pendant. */}
              <div className="col-span-2"><label className={label}>Entreprises liÃ©es</label>
                <div className="max-h-36 space-y-0.5 overflow-y-auto rounded-xl border border-slate-200 p-1.5">
                  {etat.entreprises.map((x) => (
                    <label key={x.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-50">
                      <input type="checkbox"
                        checked={ctc.entrepriseIds.includes(x.id)}
                        onChange={(e) => setCtc({ ...ctc, entrepriseIds: e.target.checked ? [...ctc.entrepriseIds, x.id] : ctc.entrepriseIds.filter((i) => i !== x.id) })}
                        className="h-4 w-4 accent-emerald-600" />
                      <span className="truncate text-[12px] font-semibold text-slate-700">{x.nom}</span>
                      {x.nomCommercial && <span className="truncate text-[10px] text-slate-400">{x.nomCommercial}</span>}
                    </label>
                  ))}
                </div></div>
              <div><label className={label}>Email</label>
                <input className={champ} value={ctc.email} onChange={(e) => setCtc({ ...ctc, email: e.target.value })} /></div>
              <div><label className={label}>TÃ©lÃ©phone</label>
                <input className={champ} value={ctc.tel} onChange={(e) => setCtc({ ...ctc, tel: e.target.value })} /></div>
            </div>
            {/* Liens croisÃ©s vers les pages record de CHAQUE entreprise liÃ©e. */}
            {ctc.entrepriseIds.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
                {ctc.entrepriseIds.map((eid) => (
                  <button key={eid} onClick={() => onOuvreFiche({ type: "entreprise", id: eid })}
                    className="text-[11px] font-bold text-cyan-600 hover:underline">
                    â {etat.entreprises.find((x) => x.id === eid)?.nom}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-5 flex items-center gap-2">
              <button onClick={() => onSauver(cible, { ...ctc, prenom: ctc.prenom.trim() || "?", nom: ctc.nom.trim() || "?", entrepriseIds: ctc.entrepriseIds })}
                className="flex-1 rounded-xl py-2.5 text-[13px] font-black text-white" style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>
                {nouveau ? "CrÃ©er le contact" : "Enregistrer"}
              </button>
              {!nouveau && (
                <button onClick={() => onSupprimer(cible)}
                  className="rounded-xl border border-red-200 px-3 py-2.5 text-[12px] font-bold text-red-500 hover:bg-red-50">Supprimer</button>
              )}
            </div>
          </>
        )}

        {/* -------- BLOC DEAL -------- */}
        {cible.type === "deal" && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className={label}>Nom du deal *</label>
                <input className={champ} value={deal.nom} onChange={(e) => setDeal({ ...deal, nom: e.target.value })} placeholder="ex. Contrat annuel â flotte 3 scooters" /></div>
              {/* Si on change d'entreprise, on rÃ©initialise le contact : un contact
                  de l'ancienne entreprise ne peut pas rester rattachÃ© au deal. */}
              <div><label className={label}>Entreprise</label>
                <select className={champ + " bg-white"} value={deal.entrepriseId}
                  onChange={(e) => setDeal({ ...deal, entrepriseId: e.target.value, contactId: "" })}>
                  <option value="">â Choisir â</option>
                  {etat.entreprises.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}
                </select></div>
              {/* Le menu ne propose QUE les contacts de l'entreprise sÃ©lectionnÃ©e. */}
              <div><label className={label}>Contact</label>
                <select className={champ + " bg-white"} value={deal.contactId} onChange={(e) => setDeal({ ...deal, contactId: e.target.value })}>
                  <option value="">â Choisir â</option>
                  {contactsEntreprise(deal.entrepriseId).map((x) => <option key={x.id} value={x.id}>{x.prenom} {x.nom}</option>)}
                </select></div>
              <div><label className={label}>Montant (kâ¬)</label>
                <input type="number" className={champ} value={deal.montant} onChange={(e) => setDeal({ ...deal, montant: Number(e.target.value) })} /></div>
              <div><label className={label}>Ãtape</label>
                <select className={champ + " bg-white"} value={deal.etape} onChange={(e) => setDeal({ ...deal, etape: e.target.value as Etape })}>
                  {ETAPES.map((x) => <option key={x.nom} value={x.nom}>{x.nom}</option>)}
                </select></div>
              <div><label className={label}>Prochaine action</label>
                <input className={champ} value={deal.action} onChange={(e) => setDeal({ ...deal, action: e.target.value })} /></div>
              <div><label className={label}>ÃchÃ©ance</label>
                <input className={champ} value={deal.echeance} onChange={(e) => setDeal({ ...deal, echeance: e.target.value })} placeholder="ex. 15/10" /></div>
              <div className="col-span-2"><label className={label}>Notes</label>
                <textarea rows={2} className={champ + " resize-none"} value={deal.notes} onChange={(e) => setDeal({ ...deal, notes: e.target.value })} /></div>
            </div>
            {/* Historique compact du deal : les 5 derniÃ¨res activitÃ©s, plus rÃ©centes d'abord. */}
            {!nouveau && deal.activites.length > 0 && (
              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <div className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-slate-400">Historique</div>
                {deal.activites.slice(-5).reverse().map((a, i) => (
                  <div key={i} className="text-[11px] text-slate-500">
                    <span className="font-bold text-slate-600">{a.date}</span> â {a.texte}
                  </div>
                ))}
              </div>
            )}
            <div className="mt-5 flex items-center gap-2">
              <button onClick={() => onSauver(cible, { ...deal, nom: deal.nom.trim() || "Deal sans nom" })}
                className="flex-1 rounded-xl py-2.5 text-[13px] font-black text-white" style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>
                {nouveau ? "CrÃ©er le deal" : "Enregistrer"}
              </button>
              {!nouveau && (
                <button onClick={() => onSupprimer(cible)}
                  className="rounded-xl border border-red-200 px-3 py-2.5 text-[12px] font-bold text-red-500 hover:bg-red-50">Supprimer</button>
              )}
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

/* ============================== FICHES (pages record faÃ§on HubSpot) ============================== */

// Carte blanche gÃ©nÃ©rique des pages record : titre, action optionnelle en haut
// Ã  droite (bouton Â« + Ajouter Â» des cartes d'association), et contenu.
function CarteFiche({ titre, action, children }: { titre: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">{titre}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

// Une ligne Â« propriÃ©tÃ© Â» faÃ§on HubSpot : libellÃ© Ã  gauche, valeur Ã  droite.
// La valeur vide ("") s'affiche comme un tiret. `label` est renommÃ© `libelle`
// en paramÃ¨tre pour ne pas Ã©craser la constante `label` dÃ©finie plus haut.
function Prop({ label: libelle, valeur }: { label: string; valeur: string }) {
  return (
    /* PropriÃ©tÃ© empilÃ©e faÃ§on HubSpot : petit libellÃ© au-dessus, valeur en
       dessous â bien plus lisible qu'un libellÃ©/valeur sur la mÃªme ligne
       quand les colonnes sont Ã©troites. break-words (et non break-all)
       pour couper uniquement sur les espaces. */
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{libelle}</div>
      <div className="break-words text-[13px] font-semibold text-slate-800">{valeur || "â"}</div>
    </div>
  );
}

/* Style commun des champs Â« sur place Â» : discret par dÃ©faut (bordure
   transparente), survol lÃ©ger, cyan au focus â le panneau reste aussi lisible
   qu'avant, mais chaque champ devient un vrai input sans ouvrir la modale. */
const styleChampInline = "w-full rounded-lg border border-transparent bg-transparent px-1 py-0.5 -mx-1 text-[13px] font-semibold text-slate-800 outline-none transition-colors hover:border-slate-200 hover:bg-slate-50 focus:border-cyan-500 focus:bg-white";

/* PropriÃ©tÃ© texte Ã©ditable Â« sur place Â» (inline), comme le panneau Ã propos
   de HubSpot : on clique dans la valeur et on tape directement. La valeur
   remonte au parent Ã  chaque frappe (patch du champ modifiÃ© uniquement). */
function PropTexte({ label: libelle, valeur, onChange }: { label: string; valeur: string; onChange: (v: string) => void }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{libelle}</div>
      <input className={styleChampInline} value={valeur} onChange={(e) => onChange(e.target.value)} placeholder="â" />
    </div>
  );
}

/* Idem en MENU DÃROULANT pour les champs normalisÃ©s (Franchiseur, Mode de
   livraison, ActivitÃ©) : le petit chevron â¾ signale que la valeur se change
   sur place ; l'option Â« â Â» sert de valeur vide. */
function PropSelect({ label: libelle, valeur, options, onChange }: { label: string; valeur: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{libelle}</div>
      <div className="relative">
        <select className={styleChampInline + " cursor-pointer appearance-none truncate pr-5"} value={valeur} onChange={(e) => onChange(e.target.value)}>
          <option value="">â</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        {/* Chevron dÃ©coratif (le select natif a son rendu retirÃ© via
            appearance-none) : pointer-events-none pour laisser le clic passer. */}
        <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[9px] text-slate-400">â¾</span>
      </div>
    </div>
  );
}

/* ---- Â« RÃ©sumÃ© de la fiche Â» faÃ§on IA (comme Breeze dans HubSpot) ----
   Le canvas tourne entiÃ¨rement dans le navigateur, sans accÃ¨s Ã  un modÃ¨le de
   langage : la synthÃ¨se ci-dessous est donc CALCULÃE LOCALEMENT Ã  partir de la
   timeline (derniÃ¨re activitÃ© reformulÃ©e, prochaine action en attente,
   sentiment estimÃ© par mots-clÃ©s). Dans la version dÃ©ployÃ©e, ce mÃªme emplacement
   sera branchÃ© sur l'API Mistral pour une vraie gÃ©nÃ©ration de texte. */
function genererResumeIA(nom: string, events: { date: string; texte: string; type?: TypeActivite }[], prochaine?: { nom: string; action: string; echeance: string } | null) {
  const derniere = events[0];
  // Sentiment estimÃ© sur les 5 activitÃ©s les plus rÃ©centes (comme la ligne
  // Â« Sentiment Â» du rÃ©sumÃ© HubSpot de la capture) : positif si mots-clÃ©s
  // enthousiastes, nÃ©gatif si mots-clÃ©s d'insatisfaction, neutre sinon.
  const corpus = events.slice(0, 5).map((x) => x.texte).join(" ").toLowerCase();
  let sentiment = "neutre";
  let couleurSentiment = "#94a3b8";
  if (/(satisfait|content|ravi|parfait|super|enthousiaste|intÃ©ressÃ©|interessÃ©|validÃ©|valide|impatient)/.test(corpus)) { sentiment = "positif"; couleurSentiment = "#57c26b"; }
  if (/(mÃ©content|mecontent|dÃ©Ã§u|decu|problÃ¨me|probleme|panne|trop cher|refus|refuse|annulÃ©|annule|retard|inquiet)/.test(corpus)) { sentiment = "nÃ©gatif"; couleurSentiment = "#ef4444"; }
  // Paragraphe narratif : derniÃ¨re activitÃ© citÃ©e + action de suivi en attente.
  const texte =
    (derniere
      ? `Le ${derniere.date} â ${META_ACT[derniere.type || "note"].libelle.toLowerCase()} : Â« ${derniere.texte.slice(0, 160)}${derniere.texte.length > 160 ? "â¦" : ""} Â».`
      : `${nom} n'a encore aucune activitÃ© enregistrÃ©e.`) +
    (prochaine && prochaine.action
      ? ` Une action de suivi est prÃ©vue : ${prochaine.action}${prochaine.echeance ? ` (le ${prochaine.echeance})` : ""}${prochaine.nom ? ` sur le deal Â« ${prochaine.nom} Â»` : ""}.`
      : " Aucune action de suivi en attente.");
  // Â« Sources Â» = nombre d'Ã©vÃ©nements qui alimentent la synthÃ¨se (comme HubSpot).
  return { texte, sentiment, couleurSentiment, sources: events.length };
}

/* ---- Â« Posez une question Â» faÃ§on Breeze HubSpot : l'utilisateur interroge
   la fiche en langage naturel. La rÃ©ponse est une RECHERCHE PAR PERTINENCE
   calculÃ©e localement sur les FAITS de la fiche (propriÃ©tÃ©s, contrats,
   contacts, deals, activitÃ©s). Sans correspondance, on le DIT honnÃªtement
   (jamais d'invention). Prochaine Ã©tape : brancher l'API Mistral avec ce
   mÃªme contexte de faits. */
const MOTS_VIDES = new Set(["le", "la", "les", "un", "une", "des", "de", "du", "et", "ou", "est", "sont", "que", "qui", "quoi", "quand", "quel", "quelle", "quels", "quelles", "combien", "dans", "sur", "pour", "avec", "sans", "ce", "cet", "cette", "ces", "son", "sa", "ses", "au", "aux", "en", "il", "elle", "on", "nous", "vous", "je", "tu", "se", "par", "plus", "tout", "tous", "peut", "fais", "fait", "chez"]);
const motsUtiles = (s: string): string[] =>
  s.split(/[\s,;:!?.']+|[’]/).map((m) => norme(m)).filter((m) => m.length > 2 && !MOTS_VIDES.has(m));
const repondreLocalement = (question: string, faits: string[]): { reponse: string; trouve: boolean } => {
  const mots = motsUtiles(question);
  if (!mots.length) return { reponse: "Pose ta question pour que je cherche dans la fiche.", trouve: false };
  const scores = faits.map((f) => {
    const nf = norme(f);
    return mots.reduce((s, m) => s + (nf.includes(m) ? 1 : 0), 0);
  });
  const iMeilleur = scores.indexOf(Math.max(...scores));
  if (scores[iMeilleur] === 0) return { reponse: "Je n'ai rien trouvÃ© sur ce sujet dans cette fiche â les donnÃ©es du CRM restent la source de vÃ©ritÃ©.", trouve: false };
  return { reponse: faits[iMeilleur], trouve: true };
};

/* Carte affichÃ©e en bas de la colonne droite des fiches Entreprise/Contact :
   badge IA, date de gÃ©nÃ©ration + nombre de sources, paragraphe synthÃ©tisÃ©
   et ligne Â« Sentiment Â». */
function ResumeIA({ nom, events, prochaine, faits, suggestions }: {
  nom: string;
  events: { date: string; texte: string; type?: TypeActivite }[];
  prochaine?: { nom: string; action: string; echeance: string } | null;
  faits: string[];
  suggestions?: string[];
}) {
  const r = genererResumeIA(nom, events, prochaine);
  const [q, setQ] = useState("");
  const [rep, setRep] = useState<{ reponse: string; trouve: boolean } | null>(null);
  const poser = (question: string) => {
    setQ(question);
    setRep(repondreLocalement(question, faits));
  };
  // Date du jour au format long franÃ§ais, comme Â« GÃ©nÃ©rÃ© le 14 octobre 2026 Â».
  const generee = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  return (
    <CarteFiche titre="RÃ©sumÃ© de la fiche"
      action={<span className="rounded-full px-2 py-0.5 text-[9.5px] font-black text-white"
        style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>â¨ IA</span>}>
      <div className="mb-1.5 text-[10px] text-slate-400">GÃ©nÃ©rÃ© le {generee} Â· {r.sources} source{r.sources > 1 ? "s" : ""}</div>
      <p className="text-[12.5px] leading-relaxed text-slate-600">{r.texte}</p>
      {/* Ligne sentiment, comme dans le rÃ©sumÃ© HubSpot de la capture. */}
      <div className="mt-2 flex items-center gap-1.5 rounded-xl bg-slate-50 px-2 py-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.couleurSentiment }} />
        <span className="text-[11px] font-bold text-slate-500">Sentiment : <span style={{ color: r.couleurSentiment }}>{r.sentiment}</span></span>
      </div>
      {/* Zone Â« Posez une question Â» faÃ§on Breeze HubSpot : rÃ©ponse cherchÃ©e
          localement dans les faits de la fiche (branchement Mistral Ã  venir). */}
      <div className="mt-2.5 border-t border-slate-100 pt-2.5">
        <div className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400">Posez une question sur cette fiche</div>
        <div className="flex gap-1.5">
          <input value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) setRep(repondreLocalement(q, faits)); }}
            placeholder="ex. Quand se termine le contrat ?"
            className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[12px] outline-none focus:border-cyan-400" />
          <button type="button" onClick={() => { if (q.trim()) setRep(repondreLocalement(q, faits)); }}
            className="shrink-0 rounded-lg px-2.5 py-1.5 text-[12px] font-black text-white"
            style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>Demander</button>
        </div>
        {(suggestions || []).length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {(suggestions || []).map((s) => (
              <button key={s} type="button" onClick={() => poser(s)}
                className="rounded-full border border-slate-200 px-2 py-0.5 text-[10.5px] font-bold text-slate-500 hover:border-cyan-300 hover:text-cyan-600">{s}</button>
            ))}
          </div>
        )}
        {rep && (
          <div className={"mt-2 rounded-xl px-2.5 py-2 text-[12px] leading-relaxed " + (rep.trouve ? "bg-slate-50 text-slate-600" : "bg-amber-50 text-amber-700")}>
            <span className="mr-1">â¨</span>{rep.reponse}
          </div>
        )}
        <div className="mt-1.5 text-[9.5px] text-slate-300">RÃ©ponse calculÃ©e Ã  partir de la fiche â les donnÃ©es du CRM restent la source de vÃ©ritÃ©.</div>
      </div>
    </CarteFiche>
  );
}

// Transforme une date affichÃ©e ("auj.", "15/10", "2/10"â¦) en nombre triable :
// "auj." est toujours en tÃªte (9999), sinon on garde le jour du mois (int parsÃ©).
// Astuce simple valable parce que toutes les dates de dÃ©mo sont dans le mÃªme mois.
const valDate = (s: string) => (s === "auj." ? 9999 : parseInt(s, 10) || 0);

// Timeline d'activitÃ©s des fiches. Chaque event peut Ãªtre :
//  - une activitÃ© de la fiche elle-mÃªme (note, appelâ¦ sans deal rattachÃ©)
//  - une activitÃ© d'un deal associÃ© (porte une rÃ©fÃ©rence `deal` â lien cliquable)
function Chronologie({ events, onOuvre }: { events: (Activite & { deal?: Deal })[]; onOuvre: (c: Cible) => void }) {
  if (events.length === 0) {
    return (
      <div className="text-[12px] text-slate-400">
        Aucune activitÃ© pour le moment. Utilise les boutons ci-dessus pour consigner une note, un e-mail, un appel, une tÃ¢che ou une rÃ©union.
      </div>
    );
  }
  return (
    <div className="divide-y divide-slate-50">
      {events.map((ev, i) => {
        // RÃ©tro-compatibilitÃ© : les anciennes activitÃ©s (prÃ©-typage) n'ont pas de
        // `type`. On le dÃ©duit : rattachÃ©e Ã  un deal â changement d'Ã©tape, sinon note.
        const typeEff: TypeActivite = ev.type ?? (ev.deal ? "etape" : "note");
        const meta = META_ACT[typeEff]; // icÃ´ne/couleur/libellÃ© du type
        return (
          <div key={i} className="flex items-start gap-3 py-2.5">
            {/* Pastille de l'icÃ´ne : couleur du type Ã  ~9% d'opacitÃ© (suffixe "18"). */}
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px]"
              style={{ background: `${meta.couleur}18` }}>{meta.icone}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-black uppercase tracking-wider" style={{ color: meta.couleur }}>{meta.libelle}</div>
              <div className="text-[12.5px] leading-relaxed text-slate-700">{ev.texte}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                <span className="font-bold">{ev.date}</span>
                {/* Badge d'Ã©chÃ©ance pour les tÃ¢ches et rÃ©unions planifiÃ©es. */}
                {ev.echeance && <Badge texte={`Ã©chÃ©ance ${ev.echeance}`} couleur={meta.couleur} />}
                {/* Lien vers le deal source de l'activitÃ© (ouvre la modale deal). */}
                {ev.deal && (
                  <button onClick={() => onOuvre({ type: "deal", id: ev.deal!.id })}
                    className="truncate font-semibold text-cyan-600 hover:underline">{ev.deal.nom}</button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Les 5 types d'activitÃ©s saisissables Ã  la main (l'Â« Ã©tape Â» est exclue :
// elle est gÃ©nÃ©rÃ©e automatiquement par les mouvements de pipeline).
const TYPES_COMPOSER: { type: "note" | "email" | "appel" | "tache" | "reunion"; icone: string; libelle: string }[] = [
  { type: "note", icone: "ð", libelle: "Note" },
  { type: "email", icone: "âï¸", libelle: "E-mail" },
  { type: "appel", icone: "ð", libelle: "Appel" },
  { type: "tache", icone: "â", libelle: "TÃ¢che" },
  { type: "reunion", icone: "ð", libelle: "RÃ©union" },
];

// Composer faÃ§on HubSpot : rangÃ©e de boutons (Note, E-mail, Appel, TÃ¢che, RÃ©union),
// puis un mini-formulaire adaptÃ© au type choisi. Machine Ã  Ã©tats simple :
//  - typeSel : type en cours de saisie (null = aucun formulaire ouvert)
//  - texte / echeance : champs du formulaire, rÃ©initialisÃ©s Ã  chaque fermeture
function ComposerActivites({ onAjouter }: {
  onAjouter: (type: "note" | "email" | "appel" | "tache" | "reunion", texte: string, echeance?: string) => void;
}) {
  const [typeSel, setTypeSel] = useState<(typeof TYPES_COMPOSER)[number]["type"] | null>(null);
  const [texte, setTexte] = useState("");
  const [echeance, setEcheance] = useState("");

  // Fermeture = remise Ã  zÃ©ro complÃ¨te du formulaire.
  const fermer = () => { setTypeSel(null); setTexte(""); setEcheance(""); };
  // Validation : texte obligatoire, Ã©chÃ©ance transmise seulement si non vide.
  const ajouter = () => {
    const t = texte.trim();
    if (!t || !typeSel) return;
    onAjouter(typeSel, t, echeance.trim() || undefined);
    fermer();
  };

  return (
    <div>
      {/* RangÃ©e de boutons : re-cliquer le type actif le dÃ©sÃ©lectionne (toggle). */}
      <div className="flex flex-wrap gap-1.5">
        {TYPES_COMPOSER.map((b) => (
          <button key={b.type} onClick={() => { if (typeSel === b.type) fermer(); else { setTypeSel(b.type); setTexte(""); setEcheance(""); } }}
            className="flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[12px] font-bold transition-colors"
            style={typeSel === b.type
              ? { borderColor: META_ACT[b.type].couleur, background: `${META_ACT[b.type].couleur}14`, color: META_ACT[b.type].couleur }
              : { borderColor: "#e2e8f0", background: "#ffffff", color: "#475569" }}>
            <span>{b.icone}</span> {b.libelle}
          </button>
        ))}
      </div>
      {/* Formulaire contextuel : placeholder adaptÃ© au type, champ Ã©chÃ©ance
          supplÃ©mentaire pour les tÃ¢ches et les rÃ©unions uniquement. */}
      {typeSel && (
        <div className="mt-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="mb-2 text-[10.5px] font-black uppercase tracking-wider" style={{ color: META_ACT[typeSel].couleur }}>
            {META_ACT[typeSel].icone} {META_ACT[typeSel].libelle}
          </div>
          <textarea rows={2} value={texte} onChange={(ev) => setTexte(ev.target.value)}
            placeholder={
              typeSel === "note" ? "Contenu de la noteâ¦"
              : typeSel === "email" ? "Sujet et contenu de l'e-mail envoyÃ©â¦"
              : typeSel === "appel" ? "Compte-rendu de l'appelâ¦"
              : typeSel === "tache" ? "Que doit-on faire ?"
              : "Objet et conclusions de la rÃ©unionâ¦"
            }
            className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12.5px] outline-none focus:border-cyan-500" />
          {(typeSel === "tache" || typeSel === "reunion") && (
            <input value={echeance} onChange={(ev) => setEcheance(ev.target.value)}
              placeholder={typeSel === "tache" ? "ÃchÃ©ance (ex. 15/10)" : "Date de la rÃ©union (ex. 18/10)"}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12.5px] outline-none focus:border-cyan-500" />
          )}
          <div className="mt-2.5 flex justify-end gap-2">
            <button onClick={fermer}
              className="rounded-xl px-3 py-1.5 text-[12px] font-bold text-slate-400 hover:bg-slate-100">Annuler</button>
            <button onClick={ajouter}
              className="rounded-xl px-3.5 py-1.5 text-[12px] font-black text-white"
              style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>
              Enregistrer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// En-tÃªte des pages record : bandeau dÃ©gradÃ©, avatar initiales chevauchant le
// bandeau, nom + infos clÃ©s, et boutons d'action passÃ©s par le parent.
function EnteteFiche({ initiales, nom, sous, boutons }: { initiales: string; nom: string; sous: string; boutons: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="h-12" style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }} />
      {/* L'avatar remonte de 20px (-mt-5) pour chevaucher le bandeau,
          liserÃ© blanc de 4px pour l'effet Â« photo de profil Â». */}
      <div className="flex flex-wrap items-center gap-3 px-4 pb-4">
        <div className="-mt-5 flex h-12 w-12 items-center justify-center rounded-2xl border-4 border-white text-[15px] font-black text-white shadow-md"
          style={{ background: "linear-gradient(135deg,#0ea5e9,#14b8a6)" }}>
          {initiales}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-black text-slate-800">{nom}</div>
          <div className="truncate text-[12px] text-slate-400">{sous}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">{boutons}</div>
      </div>
    </div>
  );
}

/* ---- Page record ENTREPRISE : colonne principale (Ã propos + ActivitÃ©s),
        colonne droite (RÃ©sumÃ© + Contacts + Deals), comme une fiche HubSpot. ---- */
function FicheEntreprise({ etat, id, onRetour, onOuvre, onOuvreFiche, onActivite, onModifie }: {
  etat: Etat; id: string;
  onRetour: () => void;
  onOuvre: (c: Cible) => void;              // ouvre la modale (Ã©dition, dealsâ¦)
  onOuvreFiche: (f: FicheRef) => void;     // navigue vers une autre page record
  onActivite: (type: "entreprise" | "contact", id: string, activite: Activite) => void; // journalise une activitÃ©
  onModifie: (patch: Partial<Entreprise>) => void; // Ã©dition directe du panneau Â« Ã propos Â»
}) {
  const e = etat.entreprises.find((x) => x.id === id);
  // Garde-fou : si l'entreprise a Ã©tÃ© supprimÃ©e pendant qu'on Ã©tait sur sa
  // fiche, on n'affiche que le bouton retour (Ã©vite un Ã©cran blanc cassÃ©).
  if (!e) {
    return <button onClick={onRetour} className="text-[12px] font-bold text-slate-400 hover:text-slate-600">â Entreprises</button>;
  }
  // ââ AgrÃ©gats dÃ©rivÃ©s de l'Ã©tat (recalculÃ©s Ã  chaque rendu, pas besoin de cache) ââ
  const contacts = etat.contacts.filter((c) => c.entrepriseIds.includes(e.id));
  const deals = etat.deals.filter((d) => d.entrepriseId === e.id);
  const actifs = deals.filter((d) => d.etape !== "GagnÃ©" && d.etape !== "Perdu");
  const pipeline = actifs.reduce((s, d) => s + d.montant, 0);
  // Timeline = activitÃ©s de l'entreprise ELLE-MÃME + activitÃ©s de ses deals
  // (on rattache le deal Ã  chaque Ã©vÃ©nement pour le lien cliquable),
  // triÃ©es de la plus rÃ©cente Ã  la plus ancienne.
  const events = [
    ...e.activites,
    ...deals.flatMap((d) => d.activites.map((a) => ({ ...a, deal: d }))),
  ].sort((x, y) => valDate(y.date) - valDate(x.date));
  // ââ Prochaine action en attente (1er deal non fermÃ© avec une action Ã  faire) :
  // elle alimente le rÃ©sumÃ© Â« IA Â» affichÃ© en bas de la colonne droite. ââ
  const prochaine = deals.find((d) => d.action && !d.fait && d.etape !== "GagnÃ©" && d.etape !== "Perdu");

  // Le composer remonte son activitÃ© au parent avec la date du jour.
  const ajouterActivite = (type: "note" | "email" | "appel" | "tache" | "reunion", texte: string, echeance?: string) => {
    onActivite("entreprise", e.id, { date: "auj.", texte, type, echeance });
  };

  return (
    <div className="space-y-4">
      <button onClick={onRetour} className="text-[12px] font-bold text-slate-400 hover:text-slate-600">â Entreprises</button>

      {/* En-tÃªte : avatar initiales, infos clÃ©s, boutons Modifier / + Contact. */}
      <EnteteFiche
        initiales={e.nom.slice(0, 2).toUpperCase()}
        nom={e.nom}
        sous={[e.secteur, e.ville, e.tel, e.site].filter(Boolean).join("  Â·  ")}
        boutons={
          <>
            <button onClick={() => onOuvre({ type: "entreprise", id: e.id })}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:bg-slate-50">
              â Modifier
            </button>
            {/* Nouveau contact prÃ©-rattachÃ© Ã  cette entreprise (preset). */}
            <button onClick={() => onOuvre({ type: "contact", id: null, preset: e.id })}
              className="rounded-xl px-3 py-1.5 text-[12px] font-black text-white"
              style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>
              + Contact
            </button>
          </>
        }
      />

      {/* 3 colonnes comme la fiche HubSpot de la capture : Â« Ã propos Â» Ã  gauche,
          ActivitÃ©s au centre, associations + rÃ©sumÃ© Ã  droite. Grille Ã  largeur
          minimale + dÃ©filement horizontal si le panneau est Ã©troit (mÃªme logique
          que le pipeline) : les 3 colonnes restent ainsi toujours visibles. */}
      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[860px] grid-cols-[minmax(0,240px)_minmax(0,1fr)_minmax(0,270px)] gap-4">
          {/* Colonne gauche : Ã propos (= panneau Â« Informations clÃ©s Â» HubSpot). */}
          <div>
            <CarteFiche titre="Ã propos">
              {/* PropriÃ©tÃ©s empilÃ©es, libellÃ© au-dessus de la valeur. */}
              <div className="space-y-2.5">
              {/* Tous les champs sont Ã©ditables DIRECTEMENT dans le panneau
                  (comme les fiches HubSpot) : texte libre ou menu dÃ©roulant,
                  sans passer par la modale â Modifier. Les 3 champs normalisÃ©s
                  seront Ã  terme remplis automatiquement par l'analyse des
                  conversations ou une recherche internet sur l'entreprise. */}
              {/* Statut du cycle de vie, en tÃªte de fiche : c'est LE champ
                  pilotÃ© Ã  100 % par l'Ã©quipe commerciale (ni les API ni l'IA
                  ne Â« devinent Â» qu'un prospect est devenu client). */}
              <PropSelect label="Statut" valeur={e.statut} options={[...STATUTS]} onChange={(v) => onModifie({ statut: v as Statut })} />
              <PropTexte label="Secteur" valeur={e.secteur} onChange={(v) => onModifie({ secteur: v })} />
              <PropTexte label="Ville" valeur={e.ville} onChange={(v) => onModifie({ ville: v })} />
              {/* Enseigne officielle (champ Â« nom commercial Â» de l'INSEE) avec
                  la ville ajoutÃ©e Ã  la fin, ex. Â« Domino's Pizza â Nanterre Â».
                  Vide si aucune source fiable â jamais d'invention. */}
              <PropTexte label="Nom commercial" valeur={e.nomCommercial} onChange={(v) => onModifie({ nomCommercial: v })} />
              <PropSelect label="Franchiseur" valeur={e.franchiseur} options={OPTIONS_FRANCHISEUR} onChange={(v) => onModifie({ franchiseur: v })} />
              <PropSelect label="Mode de livraison" valeur={e.modeLivraison} options={OPTIONS_MODE_LIVRAISON} onChange={(v) => onModifie({ modeLivraison: v })} />
              <PropSelect label="ActivitÃ©" valeur={e.activite} options={OPTIONS_ACTIVITE} onChange={(v) => onModifie({ activite: v })} />
              <PropTexte label="TÃ©lÃ©phone" valeur={e.tel} onChange={(v) => onModifie({ tel: v })} />
              <PropTexte label="Site web" valeur={e.site} onChange={(v) => onModifie({ site: v })} />
              {/* Champs calculÃ©s : lecture seule. */}
              <Prop label="Contacts" valeur={String(contacts.length)} />
              <Prop label="Pipeline actif" valeur={`${pipeline} kâ¬`} />
            </div>
            {/* Les notes libres s'affichent en encart sous les propriÃ©tÃ©s. */}
              {e.notes && <p className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-2.5 text-[12.5px] leading-relaxed text-slate-600">{e.notes}</p>}
            </CarteFiche>
          </div>

          {/* Colonne centrale : ActivitÃ©s (composer + timeline), comme le
              bandeau central de la fiche HubSpot. */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 text-[13px] font-black text-slate-700">ActivitÃ©s</div>
            <ComposerActivites onAjouter={ajouterActivite} />
            <div className="mt-3">
              <Chronologie events={events} onOuvre={onOuvre} />
            </div>
          </div>

          {/* Colonne droite : associations puis rÃ©sumÃ© (comme HubSpot). */}
          <div className="space-y-4">
            {/* Carte Â« Contrat & flotte Â» : affichÃ©e seulement si un champ
                contrat est renseignÃ© (les prospects n'ont pas de contrat).
                Chaque ligne est Ã©ditable sur place (mÃªme mÃ©canisme inline
                que le panneau Ã propos). Source des donnÃ©es auto : Sheet
                Â« Infos Service Client Â» (packs, dates, vÃ©hicules, Locam). */}
            {(e.pack || e.contratLocam || e.nbVehicules || e.immatriculations || e.risque || (e.modeles && e.modeles.length) || (e.contrats && e.contrats.length)) && (
              <CarteFiche titre="ðµ Contrat & flotte">
                <div className="space-y-2">
                  {e.risque && (
                    <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5">
                      <span className="text-[13px]">â ï¸</span>
                      <span className="text-[12px] font-bold text-red-600">{e.risque}</span>
                      <span className="ml-auto text-[10px] font-medium text-red-400">source SAV</span>
                    </div>
                  )}
                  {(e.modeles || []).length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">ModÃ¨les</span>
                      {e.modeles.map((m) => (
                        <span key={m} className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11.5px] font-bold text-emerald-700">ðµ {m}</span>
                      ))}
                    </div>
                  )}
                  <PropTexte label="Pack choisi" valeur={e.pack} onChange={(v) => onModifie({ pack: v })} />
                  {(e.contrats || []).map((k, i) => (
                    <div key={i} className="rounded-xl border border-slate-200 bg-slate-50/60 p-2">
                      <div className="mb-1 text-[11px] font-black text-slate-500">Contrat {i + 1}{k.num ? " â " + k.num : ""}{k.etat ? " Â· " + k.etat : ""}</div>
                      <div className="grid grid-cols-2 gap-2">
                        <PropTexte label="Pack" valeur={k.pack} onChange={(v) => { const cs = (e.contrats || []).map((k2, j) => j === i ? { ...k2, pack: v } : k2); onModifie({ contrats: cs, ...fusionnerContrats(cs) }); }} />
                        <PropTexte label="NÂ° Locam" valeur={k.num} onChange={(v) => { const cs = (e.contrats || []).map((k2, j) => j === i ? { ...k2, num: v } : k2); onModifie({ contrats: cs, ...fusionnerContrats(cs) }); }} />
                        <PropTexte label="DÃ©but" valeur={k.dateDebut} onChange={(v) => { const cs = (e.contrats || []).map((k2, j) => j === i ? { ...k2, dateDebut: v } : k2); onModifie({ contrats: cs, ...fusionnerContrats(cs) }); }} />
                        <PropTexte label="Fin" valeur={k.dateFin} onChange={(v) => { const cs = (e.contrats || []).map((k2, j) => j === i ? { ...k2, dateFin: v } : k2); onModifie({ contrats: cs, ...fusionnerContrats(cs) }); }} />
                        <div className="col-span-2"><PropTexte label="Immatriculations" valeur={k.immats} onChange={(v) => { const cs = (e.contrats || []).map((k2, j) => j === i ? { ...k2, immats: v } : k2); onModifie({ contrats: cs, ...fusionnerContrats(cs) }); }} /></div>
                      </div>
                    </div>
                  ))}
                  <div className="flex gap-3">
                    <div className="min-w-0 flex-1"><Prop label="VÃ©hicules" valeur={e.nbVehicules} /></div>
                    <div className="min-w-0 flex-1"><PropSelect label="Risque" valeur={e.risque} options={OPTIONS_RISQUE} onChange={(v) => onModifie({ risque: v })} /></div>
                  </div>
                </div>
              </CarteFiche>
            )}
            {/* Carte associations : chaque contact ouvre sa page record. */}
          <CarteFiche titre={`Contacts (${contacts.length})`}
            action={<button onClick={() => onOuvre({ type: "contact", id: null, preset: e.id })}
              className="text-[11px] font-bold text-cyan-600 hover:underline">+ Ajouter</button>}>
            {contacts.length === 0 && <div className="text-[11.5px] text-slate-400">Aucun contact rattachÃ©.</div>}
            <div className="space-y-1">
              {contacts.map((c) => (
                <button key={c.id} onClick={() => onOuvreFiche({ type: "contact", id: c.id })}
                  className="flex w-full items-center gap-2 rounded-xl px-1.5 py-1.5 text-left hover:bg-slate-50">
                  {/* Avatar rond avec les initiales du contact. */}
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-100 text-[11px] font-black text-cyan-700">
                    {c.prenom[0]}{c.nom[0]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-bold text-slate-700">{c.prenom} {c.nom}</span>
                    <span className="block truncate text-[10px] text-slate-400">{c.role}</span>
                    {/* E-mail et tÃ©lÃ©phone visibles directement, comme sur la
                        carte contact HubSpot de la capture. */}
                    {c.email && <span className="mt-0.5 block truncate text-[10.5px] font-medium text-slate-500">âï¸ {c.email}</span>}
                    {c.tel && <span className="block truncate text-[10.5px] font-medium text-slate-500">ð {c.tel}</span>}
                  </span>
                </button>
              ))}
            </div>
          </CarteFiche>

          {/* Carte deals : titre avec total en kâ¬, chaque deal ouvre la modale. */}
          <CarteFiche titre={`Deals (${deals.length} Â· ${deals.reduce((s, d) => s + d.montant, 0)} kâ¬)`}
            action={<button onClick={() => onOuvre({ type: "deal", id: null, preset: e.id })}
              className="text-[11px] font-bold text-cyan-600 hover:underline">+ Ajouter</button>}>
            {deals.length === 0 && <div className="text-[11.5px] text-slate-400">Aucun deal en cours.</div>}
            <div className="space-y-1">
              {deals.map((d) => (
                <button key={d.id} onClick={() => onOuvre({ type: "deal", id: d.id })}
                  className="w-full rounded-xl px-1.5 py-1.5 text-left hover:bg-slate-50">
                  <span className="block truncate text-[12px] font-bold text-slate-700">{d.nom}</span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <Badge texte={d.etape} couleur={couleurEtape(d.etape)} />
                    <span className="text-[11px] font-black text-slate-600">{d.montant} kâ¬</span>
                  </span>
                </button>
              ))}
            </div>
          </CarteFiche>

            {/* RÃ©sumÃ© Â« IA Â» + zone de questions en bas de la colonne droite. */}
            <ResumeIA nom={e.nom} events={events} prochaine={prochaine}
              faits={[
                e.statut ? e.nom + " a le statut Â« " + e.statut + " Â»." : "",
                e.ville ? e.nom + " est situÃ© Ã  " + e.ville + "." : "",
                e.tel ? "Le tÃ©lÃ©phone de " + e.nom + " est le " + e.tel + "." : "",
                e.secteur ? "Secteur : " + e.secteur + "." : "",
                e.activite ? "ActivitÃ© : " + e.activite + "." : "",
                e.franchiseur ? "Franchiseur : " + e.franchiseur + "." : "",
                e.modeLivraison ? "Mode de livraison : " + e.modeLivraison + "." : "",
                e.risque ? "â ï¸ Risque signalÃ© : " + e.risque + "." : "",
                (e.modeles || []).length > 0 ? e.nom + " loue des scooters " + e.modeles.join(" et ") + "." : "",
                (e.contrats || []).length > 0 ? e.nom + " a " + e.contrats.length + (e.contrats.length > 1 ? " contrats" : " contrat") + " Locam." : "",
                ...(e.contrats || []).map((k) => "Contrat " + k.num + " (" + k.pack + ") : du " + k.dateDebut + " au " + k.dateFin + (k.immats ? ", immatriculations " + k.immats : "") + "."),
                e.dateDebut && e.dateFin ? "La pÃ©riode totale des contrats va du " + e.dateDebut + " au " + e.dateFin + "." : "",
                e.contratLocam ? "NumÃ©ros de contrat Locam : " + e.contratLocam + "." : "",
                e.nbVehicules ? e.nom + " exploite " + e.nbVehicules + " vÃ©hicule(s)." : "",
                e.immatriculations ? "Immatriculations de la flotte : " + e.immatriculations + "." : "",
                ...etat.contacts.filter((x) => x.entrepriseIds.includes(e.id)).map((x) => x.prenom + " " + x.nom + (x.role ? " (" + x.role + ")" : "") + " est un contact de " + e.nom + (x.tel ? " â tÃ©l. " + x.tel : "") + (x.email ? " â email " + x.email : "") + "."),
                ...etat.deals.filter((d) => d.entrepriseId === e.id).map((d) => "Deal Â« " + d.nom + " Â» : " + d.montant + " kâ¬, Ã©tape Â« " + d.etape + " Â»" + (d.action ? ", prochaine action : " + d.action + (d.echeance ? " (le " + d.echeance + ")" : "") : "") + "."),
                ...events.map((ev) => META_ACT[ev.type || "note"].libelle + " du " + ev.date + " : " + ev.texte + "."),
              ].filter(Boolean)}
              suggestions={["Quand se termine le contrat ?", "Quels modÃ¨les loue ce client ?", "Qui sont les contacts ?", "OÃ¹ se situe l'entreprise ?", "Quelle est la derniÃ¨re activitÃ© ?"]} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Page record CONTACT : mÃªme structure que l'entreprise, mais les
        associations sont l'entreprise (unique) + ses deals personnels. ---- */
function FicheContact({ etat, id, onRetour, onOuvre, onOuvreFiche, onActivite }: {
  etat: Etat; id: string;
  onRetour: () => void;
  onOuvre: (c: Cible) => void;
  onOuvreFiche: (f: FicheRef) => void;
  onActivite: (type: "entreprise" | "contact", id: string, activite: Activite) => void;
}) {
  const c = etat.contacts.find((x) => x.id === id);
  // MÃªme garde-fou que la fiche entreprise : contact supprimÃ© â retour simple.
  if (!c) {
    return <button onClick={onRetour} className="text-[12px] font-bold text-slate-400 hover:text-slate-600">â Contacts</button>;
  }
  // AgrÃ©gats : TOUTES les entreprises du contact (multi-comptes), deals portÃ©s
  // PAR CE CONTACT (contactId), timeline de ses propres activitÃ©s + deals.
  const entreprises = etat.entreprises.filter((x) => c.entrepriseIds.includes(x.id));
  const deals = etat.deals.filter((d) => d.contactId === c.id);
  const actifs = deals.filter((d) => d.etape !== "GagnÃ©" && d.etape !== "Perdu");
  const events = [
    ...c.activites,
    ...deals.flatMap((d) => d.activites.map((a) => ({ ...a, deal: d }))),
  ].sort((x, y) => valDate(y.date) - valDate(x.date));
  // Prochaine action en attente : alimente le rÃ©sumÃ© Â« IA Â» de la colonne droite.
  const prochaine = deals.find((d) => d.action && !d.fait && d.etape !== "GagnÃ©" && d.etape !== "Perdu");

  const ajouterActivite = (type: "note" | "email" | "appel" | "tache" | "reunion", texte: string, echeance?: string) => {
    onActivite("contact", c.id, { date: "auj.", texte, type, echeance });
  };

  return (
    <div className="space-y-4">
      <button onClick={onRetour} className="text-[12px] font-bold text-slate-400 hover:text-slate-600">â Contacts</button>

      <EnteteFiche
        initiales={(c.prenom[0] || "") + (c.nom[0] || "")}
        nom={`${c.prenom} ${c.nom}`}
        sous={[c.role, entreprises.map((x) => x.nom).join(", "), c.email, c.tel].filter(Boolean).join("  Â·  ")}
        boutons={
          <>
            <button onClick={() => onOuvre({ type: "contact", id: c.id })}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:bg-slate-50">
              â Modifier
            </button>
            {/* Nouveau deal : si le contact n'a qu'UNE entreprise, on la
                prÃ©-coche ; s'il en a plusieurs, l'utilisateur choisit dans
                la modale (pas de dÃ©duction hasardeuse). */}
            <button onClick={() => onOuvre({ type: "deal", id: null, preset: c.entrepriseIds.length === 1 ? c.entrepriseIds[0] : "" })}
              className="rounded-xl px-3 py-1.5 text-[12px] font-black text-white"
              style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>
              + Deal
            </button>
          </>
        }
      />

      {/* 3 colonnes faÃ§on HubSpot : Ã propos Ã  gauche, ActivitÃ©s au centre,
          associations + rÃ©sumÃ© Ã  droite (mÃªme structure que la fiche entreprise,
          dÃ©filement horizontal si le panneau est Ã©troit). */}
      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[860px] grid-cols-[minmax(0,240px)_minmax(0,1fr)_minmax(0,270px)] gap-4">
          {/* Colonne gauche : Ã propos. */}
          <div>
            <CarteFiche titre="Ã propos">
              {/* PropriÃ©tÃ©s empilÃ©es, libellÃ© au-dessus de la valeur. */}
              <div className="space-y-2.5">
              <Prop label="PrÃ©nom" valeur={c.prenom} />
              <Prop label="Nom" valeur={c.nom} />
              <Prop label="RÃ´le" valeur={c.role} />
              <Prop label="Email" valeur={c.email} />
              <Prop label="TÃ©lÃ©phone" valeur={c.tel} />
              <Prop label="Entreprises" valeur={entreprises.map((x) => x.nom).join(", ") || "â"} />
              <Prop label="Deals" valeur={String(deals.length)} />
              <Prop label="Pipeline actif" valeur={`${actifs.reduce((s, d) => s + d.montant, 0)} kâ¬`} />
              </div>
            </CarteFiche>
          </div>

          {/* Colonne centrale : ActivitÃ©s (composer + timeline). */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 text-[13px] font-black text-slate-700">ActivitÃ©s</div>
            <ComposerActivites onAjouter={ajouterActivite} />
            <div className="mt-3">
              <Chronologie events={events} onOuvre={onOuvre} />
            </div>
          </div>

          {/* Colonne droite : associations puis rÃ©sumÃ©. */}
          <div className="space-y-4">
            {/* Association inverse : l'entreprise du contact (association unique). */}
          {/* TOUTES les entreprises liÃ©es (un contact peut en avoir plusieurs :
              ex. franchisÃ© multi-sites). Chaque carte est cliquable. */}
          <CarteFiche titre={`Entreprises (${entreprises.length})`}>
            {entreprises.length > 0 ? entreprises.map((en) => (
              <button key={en.id} onClick={() => onOuvreFiche({ type: "entreprise", id: en.id })}
                className="flex w-full items-center gap-2 rounded-xl px-1.5 py-1.5 text-left hover:bg-slate-50">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-black text-white"
                  style={{ background: "linear-gradient(135deg,#0ea5e9,#14b8a6)" }}>
                  {en.nom.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-bold text-slate-700">{en.nom}</span>
                  <span className="block truncate text-[10px] text-slate-400">{en.secteur} Â· {en.ville}</span>
                </span>
              </button>
            )) : (
              <div className="text-[11.5px] text-slate-400">Aucune entreprise rattachÃ©e.</div>
            )}
          </CarteFiche>

          <CarteFiche titre={`Deals (${deals.length})`}
            action={<button onClick={() => onOuvre({ type: "deal", id: null, preset: c.entrepriseIds.length === 1 ? c.entrepriseIds[0] : "" })}
              className="text-[11px] font-bold text-cyan-600 hover:underline">+ Ajouter</button>}>
            {deals.length === 0 && <div className="text-[11.5px] text-slate-400">Aucun deal en cours.</div>}
            <div className="space-y-1">
              {deals.map((d) => (
                <button key={d.id} onClick={() => onOuvre({ type: "deal", id: d.id })}
                  className="w-full rounded-xl px-1.5 py-1.5 text-left hover:bg-slate-50">
                  <span className="block truncate text-[12px] font-bold text-slate-700">{d.nom}</span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <Badge texte={d.etape} couleur={couleurEtape(d.etape)} />
                    <span className="text-[11px] font-black text-slate-600">{d.montant} kâ¬</span>
                  </span>
                </button>
              ))}
            </div>
          </CarteFiche>

            {/* RÃ©sumÃ© Â« IA Â» + zone de questions en bas de la colonne droite. */}
            <ResumeIA nom={c.prenom + " " + c.nom} events={events} prochaine={prochaine}
              faits={[
                c.prenom + " " + c.nom + (c.role ? " est " + c.role : "") + (c.email ? " â email " + c.email : "") + (c.tel ? " â tÃ©l. " + c.tel : "") + ".",
                ...etat.entreprises.filter((x) => (c.entrepriseIds || []).includes(x.id)).map((x) => c.prenom + " " + c.nom + " est rattachÃ© Ã  " + x.nom + (x.ville ? " (" + x.ville + ")" : "") + ", statut Â« " + x.statut + " Â»" + (x.tel ? " â tÃ©l. " + x.tel : "") + "."),
                ...etat.deals.filter((d) => d.contactId === c.id).map((d) => "Deal Â« " + d.nom + " Â» : " + d.montant + " kâ¬, Ã©tape Â« " + d.etape + " Â»" + (d.action ? ", prochaine action : " + d.action : "") + "."),
                ...events.map((ev) => META_ACT[ev.type || "note"].libelle + " du " + ev.date + " : " + ev.texte + "."),
              ].filter(Boolean)}
              suggestions={["Quelles sont ses entreprises ?", "Quel est son email ?", "Quelle est la derniÃ¨re activitÃ© ?"]} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================== VUES ============================== */

/* ---- Tableau de bord : 6 KPIs + rÃ©partition du pipeline + actions Ã  venir. ---- */
function VueDashboard({ etat, onOuvre }: { etat: Etat; onOuvre: (c: Cible) => void }) {
  // Â« Actif Â» = ni gagnÃ© ni perdu (tout ce qui est encore en jeu).
  const actifs = etat.deals.filter((d) => d.etape !== "GagnÃ©" && d.etape !== "Perdu");
  const pipeline = actifs.reduce((s, d) => s + d.montant, 0);
  const gagnes = etat.deals.filter((d) => d.etape === "GagnÃ©").reduce((s, d) => s + d.montant, 0);
  const fermes = etat.deals.filter((d) => d.etape === "GagnÃ©" || d.etape === "Perdu").length;
  // Taux de closing = gagnÃ©s / deals fermÃ©s (gagnÃ©s + perdus). 0 si rien de fermÃ©.
  const closing = fermes ? Math.round((etat.deals.filter((d) => d.etape === "GagnÃ©").length / fermes) * 100) : 0;

  const kpis = [
    { label: "Pipeline actif", valeur: `${pipeline} kâ¬`, couleur: "#4f9ee8" },
    { label: "SignÃ©s", valeur: `${gagnes} kâ¬`, couleur: "#57c26b" },
    { label: "Taux de closing", valeur: `${closing} %`, couleur: "#8b5cf6" },
    { label: "Deals actifs", valeur: actifs.length, couleur: "#ef8f3c" },
    { label: "Entreprises", valeur: etat.entreprises.length, couleur: "#0ea5e9" },
    { label: "Contacts", valeur: etat.contacts.length, couleur: "#14b8a6" },
  ];

  // Deals avec une prochaine action non faite : c'est la liste Â« Ã surveiller Â».
  const aSurveiller = etat.deals.filter((d) => d.action && !d.fait && d.etape !== "GagnÃ©" && d.etape !== "Perdu");

  return (
    <div className="space-y-4">
      {/* RangÃ©e de KPIs : 2 colonnes de base, jusqu'Ã  6 sur grand Ã©cran. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{k.label}</div>
            <div className="text-[22px] font-black" style={{ color: k.couleur }}>{k.valeur}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* RÃ©partition : barre horizontale par Ã©tape (hors Â« Perdu Â», moins parlant),
            normalisÃ©e par l'Ã©tape la plus lourde pour que 100% = max. */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 text-[13px] font-black text-slate-700">RÃ©partition du pipeline</div>
          <div className="space-y-2.5">
            {ETAPES.filter((x) => x.nom !== "Perdu").map((x) => {
              const ds = etat.deals.filter((d) => d.etape === x.nom);
              const total = ds.reduce((s, d) => s + d.montant, 0);
              const max = Math.max(...ETAPES.map((y) => etat.deals.filter((d) => d.etape === y.nom).reduce((s, d) => s + d.montant, 0)), 1);
              return (
                <div key={x.nom}>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-slate-600">{x.nom}</span>
                    <span className="font-black text-slate-500">{ds.length} Â· {total} kâ¬</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full" style={{ width: `${(total / max) * 100}%`, background: x.couleur }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {/* Ã surveiller : chaque ligne ouvre le deal concernÃ© en modale. */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 text-[13px] font-black text-slate-700">Actions Ã  venir ({aSurveiller.length})</div>
          <div className="space-y-2">
            {aSurveiller.length === 0 && <div className="text-[12px] text-slate-400">Rien en attente. ð</div>}
            {aSurveiller.map((d) => {
              const e = etat.entreprises.find((x) => x.id === d.entrepriseId);
              return (
                <button key={d.id} onClick={() => onOuvre({ type: "deal", id: d.id })}
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2 text-left hover:bg-slate-100">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: couleurEtape(d.etape) }} />
                  <span className="flex-1">
                    <span className="block text-[12px] font-bold text-slate-700">{d.action}</span>
                    <span className="block text-[10.5px] text-slate-400">{e?.nom} Â· {d.nom}</span>
                  </span>
                  <Badge texte={d.echeance || "â"} couleur={couleurEtape(d.etape)} />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Liste des entreprises : tableau Ã  colonnes faÃ§on page index HubSpot. ----
   La recherche filtre sur nom + NOM COMMERCIAL + secteur + ville, insensible
   Ã  la casse. */
function VueEntreprises({ etat, recherche, onOuvre }: { etat: Etat; recherche: string; onOuvre: (c: Cible) => void }) {
  const q = recherche.toLowerCase().trim();
  const liste = etat.entreprises.filter((e) =>
    !q || [e.nom, e.nomCommercial, e.statut, e.secteur, e.ville].join(" ").toLowerCase().includes(q));
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* DÃ©filement horizontal si le panneau est Ã©troit : les colonnes gardent
          une largeur lisible (min-w + whitespace-nowrap) au lieu de s'Ã©craser. */}
      <div className="overflow-x-auto">
      <table className="w-full min-w-[700px] text-left">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            <th className="px-4 py-2.5">Entreprise</th>
            <th className="px-4 py-2.5">Statut</th>
            <th className="px-4 py-2.5">Ville</th>
            <th className="px-4 py-2.5">TÃ©lÃ©phone</th>
            <th className="px-4 py-2.5">Contacts</th>
            <th className="px-4 py-2.5">Deals actifs</th>
            <th className="px-4 py-2.5 text-right">Pipeline</th>
          </tr>
        </thead>
        <tbody>
          {/* Compteurs (contacts, deals actifs, pipeline) recalculÃ©s par ligne :
              acceptable pour quelques centaines de lignes, sans dÃ©normalisation. */}
          {liste.map((e) => {
            const nbC = etat.contacts.filter((c) => c.entrepriseIds.includes(e.id)).length;
            const actifs = etat.deals.filter((d) => d.entrepriseId === e.id && d.etape !== "GagnÃ©" && d.etape !== "Perdu");
            return (
              /* Toute la ligne est cliquable â ouvre la page record de l'entreprise. */
              <tr key={e.id} onClick={() => onOuvre({ type: "entreprise", id: e.id })}
                className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2">
                    {/* Avatar carrÃ© arrondi avec initiales. */}
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-black text-white"
                      style={{ background: "linear-gradient(135deg,#0ea5e9,#14b8a6)" }}>
                      {e.nom.slice(0, 2).toUpperCase()}
                    </span>
                    <span>
                      <span className="block text-[12.5px] font-bold text-slate-800">{e.nom}</span>
                      <span className="block text-[10.5px] text-slate-400">{e.secteur}</span>
                    </span>
                  </span>
                </td>
                {/* Badge colorÃ© du statut : gris = Suspect, bleu = Prospect,
                    vert = Client (comme le cycle de vie HubSpot). */}
                <td className="whitespace-nowrap px-4 py-2.5">
                  <Badge texte={e.statut} couleur={COULEUR_STATUT[e.statut]} />
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-[12.5px] text-slate-500">{e.ville || "â"}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-[12.5px] text-slate-500">{e.tel || "â"}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-[12.5px] font-bold text-slate-600">{nbC}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-[12.5px] font-bold text-slate-600">{actifs.length}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right text-[12.5px] font-black text-slate-700">{actifs.reduce((s, d) => s + d.montant, 0)} kâ¬</td>
              </tr>
            );
          })}
          {liste.length === 0 && (
            <tr><td colSpan={7} className="px-4 py-6 text-center text-[12px] text-slate-400">Aucune entreprise trouvÃ©e.</td></tr>
          )}
        </tbody>
      </table>
      </div>
      <button onClick={() => onOuvre({ type: "entreprise", id: null })}
        className="w-full border-t border-slate-100 py-2.5 text-[12px] font-bold text-cyan-600 hover:bg-slate-50">
        + Nouvelle entreprise
      </button>
    </div>
  );
}

/* ---- Liste des contacts : mÃªme principe, tableau Ã  colonnes. ----
   La recherche inclut le nom de l'entreprise du contact (recherche croisÃ©e). */
function VueContacts({ etat, recherche, onOuvre }: { etat: Etat; recherche: string; onOuvre: (c: Cible) => void }) {
  const q = recherche.toLowerCase().trim();
  const liste = etat.contacts.filter((c) => {
    // Recherche croisÃ©e : on matche aussi le nom de CHAQUE entreprise liÃ©e.
    const es = etat.entreprises.filter((x) => c.entrepriseIds.includes(x.id));
    return !q || [c.prenom, c.nom, c.role, c.email, ...es.map((x) => x.nom)].join(" ").toLowerCase().includes(q);
  });
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* MÃªme principe que la liste entreprises : largeur minimale garantie,
          dÃ©filement horizontal si le panneau est Ã©troit. */}
      <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            <th className="px-4 py-2.5">Contact</th>
            <th className="px-4 py-2.5">Entreprise</th>
            <th className="px-4 py-2.5">Email</th>
            <th className="px-4 py-2.5">TÃ©lÃ©phone</th>
            <th className="px-4 py-2.5 text-right">Deals</th>
          </tr>
        </thead>
        <tbody>
          {liste.map((c) => {
            const es = etat.entreprises.filter((x) => c.entrepriseIds.includes(x.id));
            const ds = etat.deals.filter((d) => d.contactId === c.id);
            return (
              /* La ligne ouvre la fiche du contactâ¦ */
              <tr key={c.id} onClick={() => onOuvre({ type: "contact", id: c.id })}
                className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-2.5">
                  <span className="text-[12.5px] font-bold text-slate-800">{c.prenom} {c.nom}</span>
                  <span className="block text-[10.5px] text-slate-400">{c.role}</span>
                </td>
                <td className="px-4 py-2.5">
                  {/* â¦mais chaque entreprise liÃ©e est un bouton sÃ©parÃ© :
                      stopPropagation Ã©vite de dÃ©clencher le clic de la ligne.
                      Un contact multi-comptes affiche tous ses liens. */}
                  {es.length > 0 ? es.map((en) => (
                    <button key={en.id} onClick={(ev) => { ev.stopPropagation(); onOuvre({ type: "entreprise", id: en.id }); }}
                      className="mr-1.5 text-[12px] font-semibold text-cyan-600 hover:underline">{en.nom}</button>
                  )) : <span className="text-[12px] text-slate-400">â</span>}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-[12.5px] text-slate-500">{c.email || "â"}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-[12.5px] text-slate-500">{c.tel || "â"}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right text-[12.5px] font-black text-slate-600">{ds.length}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <button onClick={() => onOuvre({ type: "contact", id: null })}
        className="w-full border-t border-slate-100 py-2.5 text-[12px] font-bold text-cyan-600 hover:bg-slate-50">
        + Nouveau contact
      </button>
    </div>
  );
}

/* ---- Pipeline kanban : une colonne par Ã©tape, drag & drop des cartes deal. ----
   NB : les cartes sont des <div> NATIVES et non des <motion.div> : framer-motion
   intercepte onDragStart/onDrop, ce qui casserait le glisser-dÃ©posÃ©. */
function VuePipeline({ etat, recherche, onOuvre, onMove }: {
  etat: Etat; recherche: string; onOuvre: (c: Cible) => void;
  onMove: (id: string, etape: Etape) => void;
}) {
  // Ãtat du glisser en cours : id de la carte saisie + colonne survolÃ©e (pour le surlignage).
  const [dragId, setDragId] = useState<string | null>(null);
  const [survol, setSurvol] = useState<Etape | null>(null);
  const q = recherche.toLowerCase().trim();
  // La recherche porte sur le deal + son entreprise + son contact + son action.
  const visibles = etat.deals.filter((d) => {
    const e = etat.entreprises.find((x) => x.id === d.entrepriseId);
    const c = etat.contacts.find((x) => x.id === d.contactId);
    return !q || [d.nom, e?.nom || "", c?.nom || "", d.action].join(" ").toLowerCase().includes(q);
  });

  return (
    // Les 5 colonnes gardent TOUJOURS une largeur lisible (min-w) : si le panneau
    // est trop Ã©troit, on dÃ©file horizontalement plutÃ´t que d'Ã©craser les cartes.
    <div className="overflow-x-auto pb-2">
    <div className="grid min-w-[880px] grid-cols-5 gap-3">
      {ETAPES.map((col) => {
        const cartes = visibles.filter((d) => d.etape === col.nom);
        const total = cartes.reduce((s, d) => s + d.montant, 0);
        return (
          /* Zone de dÃ©pÃ´t : preventDefault est OBLIGATOIRE dans onDragOver,
             sinon le navigateur refuse le drop. */
          <div key={col.nom}
            onDragOver={(e) => { e.preventDefault(); setSurvol(col.nom); }}
            onDragLeave={() => setSurvol((s) => (s === col.nom ? null : s))}
            onDrop={(e) => { e.preventDefault(); setSurvol(null); if (dragId) onMove(dragId, col.nom); setDragId(null); }}
            className="flex min-h-[300px] flex-col rounded-2xl border p-3 transition-colors"
            style={{ background: survol === col.nom ? `${col.couleur}0f` : "#f8fafc", borderColor: survol === col.nom ? col.couleur : "#e2e8f0" }}
          >
            {/* En-tÃªte de colonne : Ã©tape + compteur (nombre de deals Â· total kâ¬). */}
            <div className="mb-3 flex items-center justify-between">
              <span className="flex items-center gap-2 text-[12px] font-black text-slate-700">
                <span className="h-2 w-2 rounded-full" style={{ background: col.couleur }} />
                {col.nom}
              </span>
              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500 shadow-sm">
                {cartes.length} Â· {total} kâ¬
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-2.5">
              {cartes.map((d) => {
                const e = etat.entreprises.find((x) => x.id === d.entrepriseId);
                const c = etat.contacts.find((x) => x.id === d.contactId);
                return (
                  /* Carte draggable : on mÃ©morise l'id au moment de la prise.
                     Un simple clic (sans drag) ouvre le deal en modale. */
                  <div key={d.id}
                    draggable
                    onDragStart={() => setDragId(d.id)}
                    onClick={() => onOuvre({ type: "deal", id: d.id })}
                    className="cursor-pointer rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[12.5px] font-bold text-slate-800">{d.nom}</span>
                      <span className="text-[12px] font-black" style={{ color: col.couleur }}>{d.montant} kâ¬</span>
                    </div>
                    <div className="mt-1 text-[10.5px] text-slate-500">{e?.nom}{c ? ` Â· ${c.prenom} ${c.nom}` : ""}</div>
                    {/* Prochaine action du deal, avec pastille verte si Â« fait Â». */}
                    {d.action && (
                      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-500">
                        <span className="h-1 w-1 rounded-full" style={{ background: d.fait ? "#57c26b" : col.couleur }} />
                        {d.fait ? "Fait" : `${d.action} â ${d.echeance}`}
                      </div>
                    )}
                  </div>
                );
              })}
              {/* Bouton Â« + Deal Â» ancrÃ© en bas de colonne grÃ¢ce Ã  mt-auto. */}
              <button onClick={() => onOuvre({ type: "deal", id: null, preset: "" })}
                className="mt-auto rounded-xl border border-dashed border-slate-300 py-1.5 text-[11px] font-bold text-slate-400 hover:border-cyan-400 hover:text-cyan-500">
                + Deal
              </button>
            </div>
          </div>
        );
      })}
    </div>
    </div>
  );
}

/* ============================== APP ============================== */

/* Composant racine : dÃ©tient l'ÃTAT GLOBAL unique (`etat` = toute la base),
   le routeur interne (vue active, fiche ouverte, modale ouverte) et les
   mutations (sauver / supprimer / dÃ©placer / journaliser une activitÃ©). */
export default function App() {
  const [etat, setEtat] = useState<Etat>(ETAT_VIDE); // la Â« base de donnÃ©es Â»
  const [chargement, setChargement] = useState(true);        // chargement initial Supabase
  const [baseVide, setBaseVide] = useState(false);          // 1re ouverture â Ã©cran d'initialisation
  const [erreurChargement, setErreurChargement] = useState<string | null>(null);
  const [sync, setSync] = useState<"ok" | "ecriture" | "erreur">("ok"); // Ã©tat de synchronisation
  const charge = useRef(false);                              // vrai dÃ¨s que l'Ã©tat initial est arrivÃ©
  const [vue, setVue] = useState<"dashboard" | "entreprises" | "contacts" | "pipeline">("dashboard"); // liste affichÃ©e
  const [recherche, setRecherche] = useState("");     // recherche globale du header
  const [cible, setCible] = useState<Cible | null>(null); // modale ouverte (null = fermÃ©e)
  const [fiche, setFiche] = useState<FicheRef | null>(null); // page record ouverte (null = liste)

  // Routeur des listes : une entreprise / un contact EXISTANT ouvre sa page
  // record ; tout le reste (id null = crÃ©ation, deals = pas de page record)
  // tombe dans la modale.
  const ouvrir = (c: Cible) => {
    if ((c.type === "entreprise" || c.type === "contact") && c.id) setFiche({ type: c.type, id: c.id });
    else setCible(c);
  };
  // Navigation entre pages record (associations cliquables) : la modale se ferme
  // pour laisser place Ã  la fiche (comme HubSpot qui navigue d'une fiche Ã  l'autre).
  const ouvrirFiche = (f: FicheRef) => { setFiche(f); setCible(null); };

  // Chargement initial : l'Ã©tat complet vient de Supabase. PremiÃ¨re ouverture
  // (aucune ligne en base) â Ã©cran d'initialisation â on ne prÃ©-remplit
  // JAMAIS les donnÃ©es sans dÃ©cision explicite.
  useEffect(() => {
    chargerEtat()
      .then((d) => {
        if (d) setEtat(normaliser(d as Etat));
        else setBaseVide(true);
      })
      .catch((err: unknown) => setErreurChargement(err instanceof Error ? err.message : String(err)))
      .finally(() => { setChargement(false); charge.current = true; });
  }, []);

  // Sauvegarde automatique : chaque modification part vers Supabase aprÃ¨s
  // 800 ms de calme (debounce) â les Ã©ditions inline rapides ne dÃ©clenchent
  // pas 50 requÃªtes. L'indicateur de la barre latÃ©rale reflÃ¨te le sync.
  useEffect(() => {
    if (!charge.current) return; // rien Ã  sauvegarder tant que l'Ã©tat initial n'est pas chargÃ©
    setSync("ecriture");
    const minuteur = setTimeout(async () => {
      try { await sauverEtat(etat); setSync("ok"); }
      catch { setSync("erreur"); }
    }, 800);
    return () => clearTimeout(minuteur);
  }, [etat]);

  // Ãcran d'entrÃ©e : chargement ou erreur de connexion Ã  la base.
  if (chargement) return <Splash texte="Chargement du CRMâ¦" />;
  if (erreurChargement) return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-100 px-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl text-[20px] font-black text-white"
        style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>U'</div>
      <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow">
        <div className="mb-2 text-[15px] font-black text-slate-800">Impossible de charger le CRM</div>
        <p className="text-[13px] leading-relaxed text-slate-500">{erreurChargement}</p>
        <button onClick={() => window.location.reload()}
          className="mt-4 rounded-xl px-4 py-2 text-[12px] font-black text-white"
          style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>RÃ©essayer</button>
      </div>
    </div>
  );

  // Ãcran d'initialisation (base vide) : importer les vraies donnÃ©es ou partir
  // de zÃ©ro â au choix, jamais automatiquement.
  if (baseVide) return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-slate-100 px-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl text-[20px] font-black text-white"
        style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>U'</div>
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-7 shadow">
        <div className="mb-1 text-center text-[16px] font-black text-slate-800">Bienvenue dans ton CRM ð</div>
        <p className="mb-5 text-center text-[13px] leading-relaxed text-slate-500">
          La base est vide pour l'instant. Tu peux importer les <b>50 clients rÃ©els</b> du
          Sheet Â« Infos Service Client Â» (contrats Locam, flotte, risques SAV, 51 contacts),
          ou partir de zÃ©ro. Aucune dÃ©cision n'est irrÃ©versible.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button onClick={() => { setEtat(normaliser(SEED)); setBaseVide(false); }}
            className="flex-1 rounded-xl px-4 py-2.5 text-[13px] font-black text-white"
            style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>
            ð¥ Importer les 50 clients rÃ©els
          </button>
          <button onClick={() => { setEtat(ETAT_VIDE); setBaseVide(false); }}
            className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-[13px] font-black text-slate-600 hover:bg-slate-50">
            ð Partir de zÃ©ro
          </button>
        </div>
      </div>
    </div>
  );

  // Journalise une activitÃ© (note, e-mail, appelâ¦) sur une entreprise ou un
  // contact, de faÃ§on immuable : on recrÃ©e le tableau plutÃ´t que le muter.
  const ajouterActivite = (type: "entreprise" | "contact", id: string, activite: Activite) => {
    setEtat((s) => type === "entreprise"
      ? { ...s, entreprises: s.entreprises.map((x) => (x.id === id ? { ...x, activites: [...x.activites, activite] } : x)) }
      : { ...s, contacts: s.contacts.map((x) => (x.id === id ? { ...x, activites: [...x.activites, activite] } : x)) }
    );
  };

  // Ãdition directe depuis le panneau Â« Ã propos Â» de la fiche entreprise :
  // on n'applique que le PATCH (champs modifiÃ©s) sur l'objet existant, de faÃ§on
  // immuable. La sauvegarde Supabase suit toute seule via le useEffect.
  const modifierEntreprise = (id: string, patch: Partial<Entreprise>) => {
    setEtat((s) => ({ ...s, entreprises: s.entreprises.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  };

  // Enregistrement depuis la modale : fait tout en une seule passe d'Ã©tat.
  const sauver = (c: Cible, donnees: Entreprise | Contact | Deal, contactsAuto?: ContactSimple[], societesAuto?: SocieteSimple[]) => {
    // Les ids sont gÃ©nÃ©rÃ©s HORS du updater React (qui doit rester pur, donc sans
    // Date.now() interne). Un petit compteur Ã©vite les collisions si plusieurs
    // objets sont crÃ©Ã©s dans la mÃªme milliseconde (ex. entreprise + 2 contacts).
    const base = Date.now();
    const idSuivantLocal = (prefixe: string, i: number) => `${prefixe}${base + i}`;
    // L'id final de l'entreprise : connu AVANT l'update pour rattacher les contacts.
    const ent = c.type === "entreprise" ? (donnees as Entreprise) : null;
    const idEnt = ent ? (ent.id || idSuivantLocal("e", 0)) : "";
    setEtat((s) => {
      if (c.type === "entreprise") {
        // Si l'id existe dÃ©jÃ  â modification (on remplace) ; sinon â crÃ©ation
        // avec l'id gÃ©nÃ©rÃ© ci-dessus. En crÃ©ation, on intÃ¨gre aussi les contacts
        // cochÃ©s, avec l'ANTI-DOUBLONS : une personne dÃ©jÃ  en base (mÃªme email,
        // mÃªme tÃ©lÃ©phone, ou mÃªme prÃ©nom+nom) n'est JAMAIS recrÃ©Ã©e â on ajoute
        // juste l'entreprise Ã  ses liens existants (cas Pierre Piron : 1 contact,
        // 15 Domino's). Seule une personne inconnue devient un nouveau contact.
        const e = donnees as Entreprise;
        const existe = s.entreprises.some((x) => x.id === e.id);
        if (existe) {
          return { ...s, entreprises: s.entreprises.map((x) => (x.id === e.id ? e : x)) };
        }
        const contactsFinaux = [...s.contacts];
        // Rattache les contacts cochÃ©s Ã  une entreprise `eid`, avec le mÃªme
        // anti-doublons partout : le contact n'est crÃ©Ã© qu'une seule fois puis
        // liÃ© Ã  chaque sociÃ©tÃ© (principale + sociÃ©tÃ©s suggÃ©rÃ©es cochÃ©es).
        let n = 0;
        const rattacher = (eid: string) => {
          (contactsAuto || []).forEach((ct) => {
            const connu = contactsFinaux.find((x) => memePersonne(ct, x));
            if (connu) {
              // Personne dÃ©jÃ  en base â RATTACHEMENT au contact existant.
              const idx = contactsFinaux.indexOf(connu);
              if (!connu.entrepriseIds.includes(eid)) {
                contactsFinaux[idx] = { ...connu, entrepriseIds: [...connu.entrepriseIds, eid] };
              }
            } else {
              // Vraie nouvelle personne â crÃ©ation, rattachÃ©e Ã  cette sociÃ©tÃ©.
              contactsFinaux.push({
                id: idSuivantLocal("c", ++n),
                prenom: ct.prenom.trim(), nom: ct.nom.trim(), role: ct.role,
                email: ct.email, tel: ct.tel,
                entrepriseIds: [eid], activites: [],
              });
            }
          });
        };
        rattacher(idEnt);
        // AUTRES sociÃ©tÃ©s du dirigeant (cochÃ©es dans le panneau cyan) : chacune
        // est crÃ©Ã©e comme une entreprise complÃ¨te (champs de la source, jamais
        // d'invention), statut par dÃ©faut Â« Suspect Â» (le statut reste pilotÃ©
        // 100 % humain), et le dirigeant est rattachÃ© Ã  chacune via `rattacher`.
        const nouvellesSocietes: Entreprise[] = (societesAuto || []).map((g, i) => ({
          id: idSuivantLocal("e", i + 1),
          nom: g.nom, nomCommercial: g.nomCommercial, secteur: g.secteur, ville: g.ville,
          site: g.site, tel: g.tel, franchiseur: g.franchiseur, modeLivraison: g.modeLivraison,
          activite: g.activite, statut: "Suspect", notes: "", activites: [],
          pack: "", dateDebut: "", dateFin: "", nbVehicules: "", contratLocam: "", immatriculations: "", risque: "", modeles: [], contrats: [],
        }));
        nouvellesSocietes.forEach((ns) => rattacher(ns.id));
        return {
          ...s,
          entreprises: [...s.entreprises, { ...e, id: idEnt }, ...nouvellesSocietes],
          contacts: contactsFinaux,
        };
      }
      if (c.type === "contact") {
        const ct = donnees as Contact;
        const existe = s.contacts.some((x) => x.id === ct.id);
        return { ...s, contacts: existe ? s.contacts.map((x) => (x.id === ct.id ? ct : x)) : [...s.contacts, { ...ct, id: idSuivantLocal("c", 1) }] };
      }
      // Cas deal : on compare l'Ã©tape avant/aprÃ¨s pour tracer le mouvement
      // dans l'historique du deal (visible dans la timeline des fiches).
      const d = donnees as Deal;
      const ancien = s.deals.find((x) => x.id === d.id);
      const activites =
        ancien && ancien.etape !== d.etape
          ? [...d.activites, { date: "auj.", texte: `Ãtape : ${ancien.etape} â ${d.etape}`, type: "etape" }]
          : d.activites;
      const existe = s.deals.some((x) => x.id === d.id);
      return { ...s, deals: existe ? s.deals.map((x) => (x.id === d.id ? { ...d, activites } : x)) : [...s.deals, { ...d, activites, id: idSuivantLocal("d", 1) }] };
    });
    setCible(null); // la modale se ferme aprÃ¨s enregistrement
  };

  // Suppression avec cascades cohÃ©rentes :
  //  - entreprise supprimÃ©e â ses deals sont supprimÃ©s, ses contacts DÃTACHÃS
  //  - contact supprimÃ© â ses deals sont DÃTACHÃS (pas supprimÃ©s)
  // (on privilÃ©gie la perte minimale d'information)
  const supprimer = (c: Cible) => {
    setEtat((s) => {
      if (c.type === "entreprise") {
        return { ...s, entreprises: s.entreprises.filter((x) => x.id !== c.id), contacts: s.contacts.map((x) => (x.entrepriseIds.includes(c.id) ? { ...x, entrepriseIds: x.entrepriseIds.filter((i) => i !== c.id) } : x)), deals: s.deals.filter((x) => x.entrepriseId !== c.id) };
      }
      if (c.type === "contact") {
        return { ...s, contacts: s.contacts.filter((x) => x.id !== c.id), deals: s.deals.map((x) => (x.contactId === c.id ? { ...x, contactId: "" } : x)) };
      }
      return { ...s, deals: s.deals.filter((x) => x.id !== c.id) };
    });
    setCible(null);
    // Si l'objet supprimÃ© Ã©tait affichÃ© en page record, on retourne Ã  la liste
    // (sinon la fiche pointerait vers un objet inexistant â Ã©cran vide).
    setFiche((f) => (f && f.type === c.type && f.id === c.id ? null : f));
  };

  // DÃ©placement kanban (drag & drop) : change l'Ã©tape et trace le mouvement
  // dans l'historique du deal, comme une modification via la modale.
  const deplacer = (id: string, etape: Etape) => {
    setEtat((s) => ({
      ...s,
      deals: s.deals.map((d) =>
        d.id === id && d.etape !== etape
          ? { ...d, etape, activites: [...d.activites, { date: "auj.", texte: `Ãtape : ${d.etape} â ${etape}`, type: "etape" }] }
          : d
      ),
    }));
  };

  // IcÃ´nes de la navigation (barre latÃ©rale + version mobile).
  const ICONES_NAV: Record<string, string> = { dashboard: "ð", entreprises: "ð¢", contacts: "ð¥", pipeline: "ð" };

  // Les 4 vues principales, dans l'ordre de la barre latÃ©rale.
  const onglets = [
    ["dashboard", "Tableau de bord"],
    ["entreprises", "Entreprises"],
    ["contacts", "Contacts"],
    ["pipeline", "Pipeline"],
  ] as const;

  // Le bouton Â« + Â» du header crÃ©e l'objet cohÃ©rent avec la vue affichÃ©e.
  const boutonAjout: Record<string, Cible> = {
    dashboard: { type: "deal", id: null, preset: "" },
    entreprises: { type: "entreprise", id: null },
    contacts: { type: "contact", id: null },
    pipeline: { type: "deal", id: null, preset: "" },
  };

  return (
    // Racine en flex : barre latÃ©rale (sticky, pleine hauteur) + zone de contenu.
    <div className="flex min-h-screen bg-slate-100 font-sans">
      {/* Barre latÃ©rale faÃ§on HubSpot â visible dÃ¨s 640px (sm:flex), cachÃ©e
          sur mobile oÃ¹ la navigation prend la forme de chips dans le header. */}
      <aside className="sticky top-0 hidden h-screen w-48 shrink-0 flex-col border-r border-slate-200 bg-white p-3 sm:flex">
        <div className="mb-5 flex items-center gap-2.5 px-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl text-[13px] font-black text-white"
            style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>U'</div>
          <div>
            <div className="text-[13px] font-black leading-tight text-slate-800">CRM U'mob</div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Entreprises Â· Contacts Â· Deals</div>
          </div>
        </div>
        {/* Navigation : changer de vue ferme automatiquement la page record. */}
        {onglets.map(([cle, label]) => (
          <button key={cle} onClick={() => { setFiche(null); setVue(cle as typeof vue); }}
            className={"mb-0.5 flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[12.5px] font-bold transition-colors " + (vue === cle ? "bg-slate-100 text-cyan-700" : "text-slate-500 hover:bg-slate-50")}>
            <span className="text-[14px]">{ICONES_NAV[cle]}</span> {label}
          </button>
        ))}
        {/* Synchronisation + dÃ©connexion, ancrÃ©es en bas (mt-auto pousse tout
            le reste vers le haut). L'indicateur reflÃ¨te l'Ã©tat de la base. */}
        <div className="mt-auto px-1">
          <div className="mb-1.5 text-[9.5px] font-bold leading-relaxed text-slate-400">
            {sync === "ecriture" && "ð¾ Sauvegarde en coursâ¦"}
            {sync === "ok" && "â Base synchronisÃ©e"}
            {sync === "erreur" && "â ï¸ Ãchec de sauvegarde â vÃ©rifie ta connexion"}
          </div>
          <button onClick={seDeconnecter}
            className="w-full rounded-xl px-3 py-1.5 text-left text-[11px] font-bold text-slate-400 transition-colors hover:bg-slate-50 hover:text-red-500">
            Se dÃ©connecter
          </button>
        </div>
      </aside>

      {/* Zone de contenu principale (min-w-0 Ã©vite les dÃ©bordements du flex). */}
      <div className="min-w-0 flex-1">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          {/* Logo compact : seulement sur mobile (la sidebar l'affiche dÃ©jÃ  ailleurs). */}
          <div className="flex items-center gap-2.5 sm:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl text-[13px] font-black text-white"
              style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>U'</div>
            <div className="text-[13px] font-black text-slate-800">CRM U'mob</div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercherâ¦"
              className="w-44 rounded-xl border border-slate-200 px-3 py-1.5 text-[12px] outline-none focus:border-cyan-500" />
            <button onClick={() => setCible(boutonAjout[vue])}
              className="rounded-xl px-3 py-1.5 text-[12px] font-black text-white"
              style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>
              + {vue === "entreprises" ? "Entreprise" : vue === "contacts" ? "Contact" : "Deal"}
            </button>
          </div>
        </div>
        {/* Navigation mobile : chips dÃ©filables (Ã©quivalent de la sidebar). */}
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-2 sm:hidden">
          {onglets.map(([cle, label]) => (
            <button key={cle} onClick={() => { setFiche(null); setVue(cle as typeof vue); }}
              className="whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-bold transition-colors"
              style={{ background: vue === cle ? "#e2e8f0" : "transparent", color: vue === cle ? "#0f766e" : "#94a3b8" }}>
              {ICONES_NAV[cle]} {label}
            </button>
          ))}
        </div>
      </header>

      {/* Rendu principal : la page record ÃCRASE la liste quand elle est ouverte.
          `onOuvre={setCible}` dans les fiches : leurs boutons ouvrent des modales.
          Les listes utilisent `ouvrir` (le routeur modale/fiche) et le pipeline
          reÃ§oit aussi `deplacer` pour le drag & drop. */}
      <main className="mx-auto max-w-7xl px-4 py-4">
        {fiche?.type === "entreprise" ? (
          <FicheEntreprise etat={etat} id={fiche.id} onRetour={() => setFiche(null)}
            onOuvre={setCible} onOuvreFiche={ouvrirFiche} onActivite={ajouterActivite}
            onModifie={(patch) => modifierEntreprise(fiche.id, patch)} />
        ) : fiche?.type === "contact" ? (
          <FicheContact etat={etat} id={fiche.id} onRetour={() => setFiche(null)}
            onOuvre={setCible} onOuvreFiche={ouvrirFiche} onActivite={ajouterActivite} />
        ) : (
          <>
            {vue === "dashboard" && <VueDashboard etat={etat} onOuvre={ouvrir} />}
            {vue === "entreprises" && <VueEntreprises etat={etat} recherche={recherche} onOuvre={ouvrir} />}
            {vue === "contacts" && <VueContacts etat={etat} recherche={recherche} onOuvre={ouvrir} />}
            {vue === "pipeline" && <VuePipeline etat={etat} recherche={recherche} onOuvre={setCible} onMove={deplacer} />}
          </>
        )}
      </main>
      </div>

      {/* Modale en overlay : la key force le remontage du state interne quand
          on change de cible (crÃ©ation â modification d'un autre objet). */}
      <AnimatePresence>
        {cible && (
          <Modale key={cible.type + (cible.id || "nouveau")} cible={cible} etat={etat}
            onClose={() => setCible(null)} onSauver={sauver} onSupprimer={supprimer} onOuvre={setCible}
            onOuvreFiche={ouvrirFiche} />
        )}
      </AnimatePresence>
    </div>
  );
}

