import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase, chargerEtat, sauverEtat } from "./lib/supabase";
import { Splash } from "./connexion";
import { DevisModule, DevisBrouillon, DevisArchive, SauvegardeDevis, ModeleMailDevis, DocumentDevis, telechargerPdfDevis, envoyerDevisParMail, rendreModeleMail } from "./devis";
import { ConsoleManager } from "./console";
import { DocusignVue } from "./docusign";
import type { DevisResume } from "./devis";

// ── Fermeture « au clic sur le fond » SANS piège de sélection de texte ──
// Quand on sélectionne du texte dans un champ du panneau et que le curseur
// glisse HORS de la fenêtre en relâchant, le navigateur déclenche un clic sur
// le fond assombri : la fenêtre se fermait et la saisie était perdue. On ne
// ferme donc que si le mousedown a AUSSI commencé sur le fond (vrai clic
// « hors de la fenêtre »), jamais pendant une sélection de texte qui déborde.
let fondMouseDown: unknown = null;
const fermerAuClicFond = (fermer: () => void) => ({
  onMouseDown: (ev: React.MouseEvent) => { fondMouseDown = ev.target; },
  onClick: (ev: React.MouseEvent) => { if (ev.target === ev.currentTarget && fondMouseDown === ev.currentTarget) fermer(); },
});


/* ============================== MODÈLE (structure HubSpot) ============================== */

// Les 5 étapes du pipeline commercial, dans l'ordre de progression d'un deal.
type Etape = "À qualifier" | "Proposition envoyée" | "Négociation" | "Gagné" | "Perdu";

// ── Les 3 objets du CRM, reliés entre eux par leurs identifiants (comme HubSpot) ──
// Entreprise ←(entrepriseIds)─ Contact : un contact peut appartenir à PLUSIEURS
//   entreprises (ex. Pierre Piron, gérant de 15 Domino's = 1 contact, 15 liens)
// Entreprise ←(entrepriseId)─ Deal    : un deal est rattaché à une entreprise…
// Contact    ←(contactId)─── Deal    : …et à un contact précis de cette entreprise
// ── Un CONTRAT individuel (source : lignes du Sheet « Infos Service
// Client », regroupées par n° de contrat — une ligne du Sheet = un scooter,
// donc un contrat peut couvrir plusieurs immatriculations). Un client à 2
// contrats (ex. LM PIZZA PUCE) obtient 2 blocs avec leurs DATES PROPRE,
// au lieu de la période fusionnée min/max qui ne correspondait à aucun
// contrat réel. ──
interface ContratLigne { pack: string; modele: string; num: string; dateDebut: string; dateFin: string; immats: string; etat: string }
interface Entreprise { id: string; nom: string; nomCommercial: string; secteur: string; ville: string; site: string; tel: string; franchiseur: string; modeLivraison: string; activite: string; statut: Statut; notes: string; activites: Activite[];
  // ── SIREN + adresse postale du siège : champs PERMANENTS (fiche À propos,
  //  modale). Remplis automatiquement par la recherche SIREN / API gouv à la
  //  création, ou saisis à la main. Vides si inconnus (jamais d'invention).
  //  Alimentent le pré-remplissage DocuSign (adresse, CP, SIREN). ──
  siren?: string; adresse?: string; cp?: string;
  // Origine de la relation commerciale : Groupe Client, Demande entrante, Autre.
  origine?: string;
  // ── Contrat & flotte (source : Sheet « Infos Service Client ») ──
  // Renseignés pour les SOCIÉTÉS CLIENTES : pack choisi, période du contrat,
  // nombre de véhicules, immatriculations. Comme tous les
  // champs auto-remplis : modifiables, et vides si la source ne sait rien.
  pack: string; dateDebut: string; dateFin: string; nbVehicules: string; contratLocam: string; immatriculations: string;
  // ── Modèle(s) de scooter U'mob loué(s) par le client (Infinity Pro /
  // Compact Pro / Daily Pro). Source auto : colonne « Libellé Produit » du
  // Sheet « Infos Service Client » ; sélection manuelle sinon (jamais
  // d'invention, cases toujours modifiables). ──
  modeles: string[];
  // ── Contrats individuels (un bloc par contrat). Les anciennes fiches
  // agrégées (pack/dates uniques) sont migrées en 1 contrat à l'ouverture. ──
  contrats: ContratLigne[];
  // ── Risque SAV (source : colonnes Statut_risque_client / Impayes /
  // Procedure_collective du Sheet « Infos Service Client »). Vide = aucun
  // risque signalé. Comme le statut, il reste corrigeable à la main. ──
  risque: string;
  // ── Devis sauvegardés depuis le module Devis (bouton « 💾 Sauvegarder sur la
  // fiche entreprise ») : brouillon complet ré-ouvrable + commentaire du
  // commercial + résumé figé (loyers, packs…). Persisté avec le reste de
  // l'état dans Supabase (jsonb) — rien à migrer côté base. ──
  devisHistorique?: DevisArchive[];
}
// Les activités ne vivent QUE sur les entreprises : un contact n'a plus sa
// propre liste d'activités (elles sont portées par ses entreprises, avec un
// lien `contactId` pour les retrouver).
interface Contact { id: string; prenom: string; nom: string; role: string; email: string; tel: string; entrepriseIds: string[] }

// Reconnaissance d'une personne déjà en base (anti-doublons) : même email,
// même téléphone (chiffres uniquement), ou même prénom+nom → c'est la MÊME
// personne (ex. gérant de plusieurs franchises : on RATTACHE, on ne duplique jamais).
const normTel = (t: string) => t.replace(/\D/g, "");
const formaterTelFr = (t: any): string => {
  const d = String(t || "").replace(/\D/g, "");
  const nat = d.startsWith("33") && d.length === 11 ? "0" + d.slice(2) : d;
  if (nat.length === 10 && nat.startsWith("0")) return nat.replace(/(\d{2})(?=\d)/g, "$1 ");
  return String(t || "").trim();
};
// Recherche téléphone « SOUPLE » : les formats ne sont jamais les bons dans la
// vraie vie (espaces, points, tirets, +33, 0 initial…). On ne garde que les
// chiffres et on équivalise le préfixe international 33 ↔ 0 national :
// « 04 78 22 10 87 », « 04.78.22.10.87 », « 0478221087 » et « +33478221087 »
// sont donc tous interchangeables, côté numéro stocké ET côté recherche tapée.
const normeTelRecherche = (t: string): string => {
  const d = (t || "").replace(/\D/g, "");
  return d.startsWith("33") && d.length === 11 ? "0" + d.slice(2) : d;
};
// Le critère lui-même est normalisé pareil : taper « 04 78 » ou « 04.78 » ou
// « 478 » revient au même. Moins de 2 chiffres → pas de recherche téléphonique
// (évite les faux positifs sur une requête textuelle comme « pizza »).
const telCorrespond = (q: string, tel: string): boolean => {
  const qd = normeTelRecherche(q);
  if (qd.length < 2) return false;
  const nt = normeTelRecherche(tel);
  // Recherche directe, puis variante internationale : taper « +33 6 12 45 »
  // (préfixe 33 PARTIEL) doit retrouver « 06 12 45 78 90 » comme le ferait
  // un numéro complet à 11 chiffres.
  if (nt.includes(qd)) return true;
  if (qd.startsWith("33")) return nt.includes("0" + qd.slice(2));
  return false;
};
// Normalisation de libellé pour comparer deux noms/enseignes : minuscules,
// sans accents ni ponctuation (sert à reconnaître une suggestion déjà CLIENTE
// en base sous un autre nom légal).
const norme = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
// ── Horodatage officiel du CRM : TOUT est sur l'heure de PARIS, quel que soit
//    le fuseau du navigateur (Intl avec timeZone explicite). dateParis = jj/mm/aaaa,
//    heureParis = hh:mm, dateHeureParis = « jj/mm/aaaa à hh:mm »,
//    isoParis = YYYY-MM-DD (champ <input type="date">). ──
const dateParis = (d: Date = new Date()): string => d.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
const heureParis = (d: Date = new Date()): string => d.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hour12: false });
const dateHeureParis = (d: Date = new Date()): string => dateParis(d) + " à " + heureParis(d);
const isoParis = (d: Date = new Date()): string => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
// ── Sheet « Infos Service Client » (Google Sheet partagé « lien », lu EN DIRECT
// par le navigateur au moment de la création via l’export CSV public — même mécanisme
// que l’API gouv, aucune clé API). Une ligne = un CONTRAT ; on agrège par code
// client. C’est la source officielle des clients : si le Sheet connaît la
// société, elle EST cliente. Échec réseau → liste vide, aucun blocage, et JAMAIS
// de champ contrat rempli sans donnée du Sheet (règle anti-invention). ──
interface ClientSheet { code: string; nom: string; ville: string; packs: string; dateDebut: string; dateFin: string; nbVehicules: string; contrats: string; immats: string; risque: string; modeles: string[]; lignes: ContratLigne[]; contacts: ContactSheet[] }
// Contact du Sheet : une ligne peut porter un interlocuteur (Prénom Contact /
// Nom Contact / Fonction Contact / Mobile Contact / Email Contact). Dédupliqués
// par prénom+nom+mobile+email — jamais inventés, uniquement ce que dit le Sheet.
interface ContactSheet { prenom: string; nom: string; role: string; tel: string; email: string }
// Mini-parseur CSV gérant les champs entre guillemets (virgules incluses).
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
// ── Le classeur compte ~1000 lignes mais l'export CSV de base n'en renvoie que
// ~106 (limite silencieuse de l'URL simple) : sans pagination, tous les
// clients au-delà de la 106e ligne (ex. Carlos Gomes Lopes, ligne 698) sont
// INVISIBLES pour le CRM. On pagine donc via le langage de requête Google
// (`tq=select * offset N` = index de départ dans le classeur). Une page
// renvoie 100-130 lignes : on avance du nombre de lignes REÇUES et on
// dédoublonne par ligne complète (JSON) — jamais de saut, jamais de doublon.
// Cache mémoire de 60 s : le Sheet est lu à chaque création, recherche et
// ouverture de fiche ; inutile de retélécharger ~10 pages à chaque fois. ──
const URL_SHEET_CSV = "https://docs.google.com/spreadsheets/d/1nikK5_dBeFSYuOLz8Inr7UsTXvdJZUbjhUoiof7FZCk/gviz/tq?tqx=out:csv&tq=select%20*";
let cacheSheet: { at: number; lignes: string[][] } | null = null;
const lireToutSheet = async (): Promise<string[][]> => {
  if (cacheSheet && Date.now() - cacheSheet.at < 60000) return cacheSheet.lignes;
  const vues = new Set<string>();
  const toutes: string[][] = [];
  let avecEntete = false;
  for (let off = 0; off < 5000;) {
    const rep = await fetch(URL_SHEET_CSV + "%20offset%20" + off);
    if (!rep.ok) throw new Error("HTTP " + rep.status);
    const page = parserCSV(await rep.text());
    if (page.length === 0) break;
    if (!avecEntete) { toutes.push(page[0]); avecEntete = true; }
    let nouvelles = 0;
    for (const l of page.slice(1)) {
      const cle = JSON.stringify(l);
      if (!vues.has(cle)) { vues.add(cle); toutes.push(l); nouvelles++; }
    }
    const nb = page.length - 1;
    if (nb === 0 || nouvelles === 0) break; /* fin du classeur atteinte */
    off += nb;
  }
  if (!avecEntete) throw new Error("Sheet vide");
  cacheSheet = { at: Date.now(), lignes: toutes };
  return toutes;
};
const chargerClientsSheet = async (): Promise<{ clients: ClientSheet[]; lectureOk: boolean }> => {
  try {
    const lignes = await lireToutSheet();
    const tete = (lignes[0] || []).map((h) => h.trim().toLowerCase());
    const col = (n: string) => tete.findIndex((h) => h === n.toLowerCase());
    const cCode = col("Code client"), cNom = col("Nom client"), cVille = col("Ville"),
      cPack = col("Libellé contrat"), cProd = tete.findIndex((h) => h.includes("libellé produit")), cEtat = col("Etat contrat"), cDd = col("Date début contrat"), cDf = col("Date fin contrat"),
      cNum = col("N° contrat"), cImm = col("Immatriculation"), cRq = col("Statut_risque_client"),
      cPrenom = col("Prénom Contact"), cNomCt = col("Nom Contact"), cFonction = col("Fonction Contact"), cMobile = col("Mobile Contact"), cMail = col("Email Contact"),
      cImp = col("Impayes"), cProc = col("Procedure_collective_Radiation");
    if (cCode < 0 || cNom < 0) return { clients: [], lectureOk: false }; /* page d’erreur Google 200 ou colonnes absentes */
    const clients: ClientSheet[] = []; const idx = new Map<string, ClientSheet>();
    const prem = new Map<string, number>(); const der = new Map<string, number>();
    const cleDate = (d: string) => { const p = d.trim().split("/").map(Number); return p.length === 3 ? p[2] * 10000 + p[1] * 100 + p[0] : NaN; };
    const p2 = (n: number) => (n < 10 ? "0" : "") + n;
    const fmtDate = (k: number) => p2(k % 100) + "/" + p2(Math.floor(k / 100) % 100) + "/" + Math.floor(k / 10000);
    for (const l of lignes.slice(1)) {
      const g = (i: number) => (i >= 0 && i < l.length ? l[i].trim() : "");
      const code = g(cCode); if (!code) continue;
      if (!idx.has(code)) { const c: ClientSheet = { code, nom: g(cNom), ville: g(cVille), packs: "", dateDebut: "", dateFin: "", nbVehicules: "", contrats: "", immats: "", risque: "", modeles: [], lignes: [], contacts: [] }; idx.set(code, c); clients.push(c); }
      const c = idx.get(code)!;
      const p = g(cPack); if (p && !c.packs.includes(p)) c.packs = c.packs ? c.packs + " · " + p : p;
      const pr = modeleDepuis(g(cProd)); if (pr && !c.modeles.includes(pr)) c.modeles.push(pr);
      c.lignes.push({ pack: g(cPack), modele: pr, num: g(cNum), dateDebut: g(cDd), dateFin: g(cDf), immats: g(cImm), etat: g(cEtat) });
      const n = g(cNum); if (n && !c.contrats.includes(n)) c.contrats = c.contrats ? c.contrats + ", " + n : n;
      const im = g(cImm); if (im && !c.immats.includes(im)) c.immats = c.immats ? c.immats + ", " + im : im;
      const kd = cleDate(g(cDd)); if (!Number.isNaN(kd) && (prem.get(code) === undefined || kd < prem.get(code)!)) { prem.set(code, kd); c.dateDebut = fmtDate(kd); }
      const kf = cleDate(g(cDf)); if (!Number.isNaN(kf) && (der.get(code) === undefined || kf > der.get(code)!)) { der.set(code, kf); c.dateFin = fmtDate(kf); }
      const rq = normRisque(g(cRq)); if (rq && !c.risque) c.risque = rq;
      else if (!c.risque && g(cImp).toLowerCase() === "true") c.risque = "Impayé";
      else if (!c.risque && g(cProc)) c.risque = "Procédure collective";
      // ── Interlocuteurs du Sheet : prénom + nom (+ fonction, mobile, email).
      // Dédupliqués par prénom+nom+tel+email ; une ligne sans nom est ignorée. ──
      const cp = g(cPrenom), cn = g(cNomCt);
      if ((cp || cn) && !c.contacts.some((x) => x.prenom === cp && x.nom === cn && x.tel === g(cMobile) && x.email === g(cMail))) {
        c.contacts.push({ prenom: cp, nom: cn, role: g(cFonction), tel: g(cMobile), email: g(cMail) });
      }
    }
    for (const c of clients) c.nbVehicules = c.immats ? String(c.immats.split(",").map((s) => s.trim()).filter(Boolean).length) : "";
    // ── Regroupement par CONTRAT (n° interne, jamais affiché) : plusieurs lignes du Sheet
    // partagent le même n° (une ligne par scooter). ──
    for (const c of clients) {
      const groupes = new Map<string, ContratLigne>();
      for (const l of c.lignes) {
        const cle = (l.num || "").trim() || "#" + l.pack + "|" + l.dateDebut;
        const ex = groupes.get(cle);
        if (!ex) groupes.set(cle, { ...l });
        else {
          if (l.immats && !(ex.immats || "").includes(l.immats)) ex.immats = ex.immats ? ex.immats + ", " + l.immats : l.immats;
          if (l.modele && !(ex.modele || "").includes(l.modele)) ex.modele = ex.modele ? ex.modele + " · " + l.modele : l.modele;
          if (!ex.dateDebut && l.dateDebut) ex.dateDebut = l.dateDebut;
          if (!ex.dateFin && l.dateFin) ex.dateFin = l.dateFin;
          if (!ex.etat && l.etat) ex.etat = l.etat;
        }
      }
      c.lignes = Array.from(groupes.values());
    }
    return { clients, lectureOk: true };
  } catch { return { clients: [], lectureOk: false }; /* réseau indisponible : pas de blocage, aucune invention */ }
};
// Reconnaissance prudente d’un client du Sheet (règle anti-invention : noms
// normalisés comparés strictement, ville tolérante aux arrondissements ; dans le
// doute on ne marque PAS). Le « Nom client » du Sheet peut être du type
// « GAF (BOITE A PIZZA ANNEMASSE) » : on compare nom légal, base et parenthèse.
// Formes juridiques ignorées pour comparer les noms légaux : la base INSEE
// « SARL LCD » doit matcher le « LCD » du Sheet, et « NKM SARL » ↔ « NKM ».
const FORMES_JURIDIQUES = new Set(["sarl", "sas", "sasu", "eurl", "sa", "sci", "snc", "scm", "selarl", "selas", "ei", "sca", "scs", "scp", "gaec"]);
const epurerBase = (s: string): string => {
  const mots = String(s || "").split(/\s+/).filter(Boolean)
    .filter((w) => !FORMES_JURIDIQUES.has(w.toLowerCase().replace(/[^a-z]/g, "")));
  return norme(mots.join(" "));
};
// Reconnaissance d'un client du Sheet — l'IDENTITÉ d'une société est son NOM
// LÉGAL (base sans forme juridique) : « PIRYVE » ≠ « PIRYVE 2 », « FPS12 » ≠
// « GRAPP » — deux sociétés différentes ne matchent JAMAIS. Une marque de
// franchise (Domino's…) est portée par des dizaines de sociétés : elle
// n'identifie JAMAIS un client à elle seule (les villes du Sheet sont des
// SITES DE CONTRAT, pas des sièges — GRAPP Angoulême a une ligne à Bordeaux,
// PIRYVE Pau une ligne à Lons — donc la ville ne peut pas départager).
// L'enseigne ne sert que pour une enseigne locale unique, avec ville compatible.
const trouverClientSheet = (clients: ClientSheet[], nomLegal: string, enseigne: string, ville: string): ClientSheet | undefined =>
  clients.find((c) => {
    const base = c.nom.split(" (")[0].trim();
    const paren = (c.nom.match(/\(([^)]*)\)/) || [])[1] || "";
    const nBase = epurerBase(nomLegal.split(" (")[0].trim());
    const cBase = epurerBase(base);
    const nL = norme(nomLegal), ens = norme(enseigne), v = norme(ville), vC = norme(c.ville);
    const villesOK = v === "" || vC === "" || v === vC || (v.length >= 4 && vC.length >= 4 && (v.startsWith(vC) || vC.startsWith(v)));
    const memeBase = nBase !== "" && cBase !== "" && nBase === cBase;
    const franchise = franchiseurDepuis(enseigne) !== "";
    return memeBase
      || (villesOK && nL !== "" && (nL === norme(base) || nL === norme(c.nom)))
      || (villesOK && ens !== "" && ens.length >= 5 && !franchise && (ens === norme(base) || ens === norme(paren) || norme(c.nom).includes(ens)));
  });
// (b accepte un Contact OU un ContactSimple de l'annuaire : seuls ces 4 champs comptent)
const memePersonne = (a: { prenom: string; nom: string; email: string; tel: string }, b: { prenom: string; nom: string; email: string; tel: string }) =>
  (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) ||
  (a.tel && b.tel && normTel(a.tel) === normTel(b.tel)) ||
  (a.prenom.trim().toLowerCase() === b.prenom.trim().toLowerCase() &&
    a.nom.trim().toLowerCase() === b.nom.trim().toLowerCase());
// Clés « propriétaire » d’un contact proposé : son prénom+nom normalisé, et si
// son rôle mentionne une holding (« Gérant · via ADAVEN »), la holding aussi.
// Sert à retirer de la liste les sociétés suggérées quand on DÉCOCHE leur dirigeant
// (les sociétés de Bourbao sont collectées via la holding ADAVEN : décocher
// Bourbao les retire, décocher Chbihi retire les siennes).
const clesContact = (ct: { prenom: string; nom: string; role: string }): string[] => {
  const l = [norme(ct.prenom + " " + ct.nom)];
  const m = ct.role.match(/via\s+(.+)$/i);
  if (m) l.push(norme(m[1].trim()));
  return l.filter(Boolean);
};

// ── Franchiseurs connus : si l’enseigne INSEE contient une de ces marques,
// le champ « Franchiseur » prend la valeur normalisée du menu déroulant. Ce n’est
// PAS de l’invention : l’enseigne vient de l’INSEE, et la marque du réseau est un
// fait public. Enseigne sans marque connue → champ vide (jamais de guess). ──
const FRANCHISEURS: [string, string][] = [
  ["dominospizza", "Domino's Pizza"], ["pizzahut", "Pizza Hut"], ["sushishop", "Sushi Shop"],
  ["boiteapizza", "La Boîte à Pizza"], ["eatsushi", "Eat Sushi"], ["pizzatime", "Pizza Time"],
  ["misterpizza", "Mister Pizza"], ["classcroute", "Class'Croute"], ["tuttipizza", "Tutti Pizza"],
];
const franchiseurDepuis = (enseigne: string): string => {
  const e = norme(norme(enseigne));
  const t = FRANCHISEURS.find(([k]) => e.includes(k));
  return t ? t[1] : "";
};

// ── Modèles de scooters U'mob : valeurs proposées à la sélection, à la
// création d'entreprise comme à l'édition. modeleDepuis() traduit un libellé
// du Sheet (« INFINITY PRO », « COMPACT PRO », « DAILY PRO »…) vers la valeur
// normalisée du CRM ; libellé inconnu → vide (jamais de guess). ──
const MODELES_SCOOTER = ["Infinity Pro", "Compact Pro", "Daily Pro"];
const MODELE_DEPUIS: [string, string][] = [
  ["infinitypro", "Infinity Pro"], ["compactpro", "Compact Pro"], ["dailypro", "Daily Pro"],
];
const modeleDepuis = (p: string): string => {
  const n = norme(p);
  const t = MODELE_DEPUIS.find(([k]) => n.includes(k));
  return t ? t[1] : "";
};
// Affichage lisible d'un pack : on retire le préfixe « Modèle » et on place
// le « + » DERRIÈRE la valeur — « Modèle Confort + 48 » → « Confort 48+ »,
// « Modèle Zen 36 » → « Zen 36 ». Ne touche pas aux données, juste à l'affichage.
const affPack = (p: string): string =>
  (p || "").replace(/^Mod[eè]le\s+/i, "").replace(/\s*\+\s*([0-9]+)/, " $1+").replace(/\s+/g, " ").trim();
// ── Fusion des contrats individuels vers les champs agrégés historiques
// (pack, période globale min/max, immatriculations, nb véhicules) :
// la fiche garde ses compteurs de synthèse, mais la VÉRITÉ vit dans
// `contrats` — un bloc par contrat avec ses propres dates. ──
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
    pack: uniq(v.map((c) => c.pack)).join(" · "),
    contratLocam: "",
    dateDebut: debuts.length ? fmt(Math.min(...debuts)) : "",
    dateFin: fins.length ? fmt(Math.max(...fins)) : "",
    immatriculations: immatsUniques.join(", "),
    nbVehicules: immatsUniques.length ? String(immatsUniques.length) : "",
  };
};

// ── Types d'activités façon HubSpot ──
// "etape" est un type interne : il trace les mouvements de deals dans le pipeline
// (généré automatiquement, jamais saisi à la main par l'utilisateur).
// Les autres types sont consignés manuellement depuis le composer des fiches.
type TypeActivite = "note" | "email" | "appel" | "tache" | "reunion" | "etape" | "devis";
// dateISO : date de RÉALISATION réelle (jj/mm/aaaa), enregistrée automatiquement
// à la création et modifiable au moment de la saisie (rattrapage d'une activité
// passée). `date` garde le libellé court historique ("auj.", "15/10") pour la
// compatibilité des anciennes activités.
// `contactId`/`dealId` (optionnels) : liens de l'activité vers un contact et/ou
// un deal de SON entreprise. Les activités ne vivent QUE sur les entreprises.
interface Activite { date: string; texte: string; type?: TypeActivite; echeance?: string; dateISO?: string; heure?: string; heureEche?: string; contactId?: string; dealId?: string; fait?: boolean; clotureLe?: string; /* Champs enrichis par le webhook Ringover (api/ringover.ts) : analyse IA de l appel — jamais d invention, vides si la source est muette. */ appelId?: string; numeroAppel?: string; directionAppel?: string; dureeAppel?: string; resumeIA?: string; sentiment?: string; sujets?: string; scoreIA?: number; transcription?: string; urlEnregistrement?: string; scorecard?: { [k: string]: { note: number; j: string } } }

// Source de vérité unique pour l'affichage de chaque type dans la timeline :
// icône, libellé et couleur (utilisés par la timeline ET le composer, donc cohérents partout).
// ── Scorecard Plan de vente U'mob, version téléphone (7 critères du référentiel
// fourni par Corentin). Notée 0/1/2 par l'IA sur chaque appel analysé. ──
const CRITERES_SCORECARD: [string, string][] = [
  ["accueil", "1. Accueil & cadre de l'appel"],
  ["decouverte", "2. Découverte flotte & coûts"],
  ["decisionnaire", "3. Décisionnaire & timing identifiés"],
  ["comparatif", "4. Comparatif systématique (thermique / concurrent / ancienne génération)"],
  ["prix", "5. Jamais le prix avant les 4 validations (offre / maintenance / produit / 48 mois)"],
  ["objections", "6. Objections sans confrontation"],
  ["prochaineEtape", "7. Prochaine étape datée (qualifier + booker le RDV terrain)"],
];
const META_ACT: Record<TypeActivite, { icone: string; libelle: string; couleur: string }> = {
  note: { icone: "📝", libelle: "Note", couleur: "#f59e0b" },
  email: { icone: "✉️", libelle: "E-mail envoyé", couleur: "#0ea5e9" },
  appel: { icone: "📞", libelle: "Appel consigné", couleur: "#57c26b" },
  tache: { icone: "✅", libelle: "Tâche", couleur: "#8b5cf6" },
  reunion: { icone: "📅", libelle: "Réunion", couleur: "#ef8f3c" },
  etape: { icone: "➜", libelle: "Étape du deal", couleur: "#4f9ee8" },
  devis: { icone: "🧾", libelle: "Devis", couleur: "#94a3b8" },
};

// Même chose pour le deal : plus de liste d'activités propre. Les « étapes »
// horodatées sont journalisées sur l'entreprise avec un lien `dealId`.
interface Deal { id: string; nom: string; entrepriseId: string; contactId: string; montant: number; etape: Etape; action: string; echeance: string; notes: string; fait: boolean }

// L'état global de l'application : la base de données entière tient dans cet objet.
interface Etat { entreprises: Entreprise[]; contacts: Contact[]; deals: Deal[]; devis?: DevisBrouillon | null; modelesMailDevis?: ModeleMailDevis[]; signatureMail?: string; documentsDevis?: DocumentDevis[] }

// Couleur officielle de chaque étape (réutilisée partout : kanban, badges, fiches…).
const ETAPES: { nom: Etape; couleur: string }[] = [
  { nom: "À qualifier", couleur: "#e8b83a" },
  { nom: "Proposition envoyée", couleur: "#ef8f3c" },
  { nom: "Négociation", couleur: "#4f9ee8" },
  { nom: "Gagné", couleur: "#57c26b" },
  { nom: "Perdu", couleur: "#9aa3ae" },
];
const couleurEtape = (e: Etape) => ETAPES.find((x) => x.nom === e)!.couleur;

// ── Données de démonstration ──
// 8 entreprises, 9 contacts et 8 deals fictifs (type clients U'mob : livreurs lyonnais).
// Quelques activités typées sont semées pour que les timelines soient parlantes
// dès l'ouverture (un appel consigné, un e-mail, une réunion, une tâche avec échéance…).
const SEED: Etat = {
  entreprises: [
    { id: "e1", statut: "Client", nom: "Rotisserie du Rhône", nomCommercial: "Rotisserie du Rhône — Lyon 7e", secteur: "Restauration", ville: "Lyon 7e", site: "rotisserie-du-rhone.fr", tel: "04 72 11 02 44", franchiseur: "Indépendant", modeLivraison: "Scooter électrique", activite: "Restauration traditionnelle", notes: "Contrat annuel signé. 3 scooters livrés le 20/10.", activites: [{ date: "auj.", texte: "Point de livraison confirmé avec Julien — créneau 8h-10h.", type: "note" }, { date: "auj.", texte: "Appel 6 min : souhaite la maintenance incluse dans le contrat annuel.", type: "appel", contactId: "c1" }, { date: "12/10", texte: "Étape : Négociation → Gagné", type: "etape", dealId: "d1" }] },
    { id: "e2", statut: "Client", nom: "Poké Bowl Express", nomCommercial: "Poké Bowl Express — Lyon 3e", secteur: "Restauration", ville: "Lyon 3e", site: "pokebowl-express.fr", tel: "04 78 22 10 87", franchiseur: "Indépendant", modeLivraison: "Scooter électrique", activite: "Restauration rapide", notes: "2 scooters + abonnement maintenance.", activites: [{ date: "08/10", texte: "Proposition envoyée : abonnement 2 scooters + maintenance", type: "email", contactId: "c2" }, { date: "08/10", texte: "Étape : Proposition envoyée → Gagné", type: "etape", dealId: "d2" }] },
    { id: "e3", statut: "Prospect", nom: "Bières & Burgers", nomCommercial: "Bières & Burgers — Villeurbanne", secteur: "Restauration", ville: "Villeurbanne", site: "bieres-et-burgers.fr", tel: "04 72 55 71 03", franchiseur: "Burger King", modeLivraison: "Mixte", activite: "Restauration rapide", notes: "Chaîne en expansion, levier flotte 4 scooters.", activites: [{ date: "12/10", texte: "Visite du 2e restaurant — très intéressé par le levier flotte.", type: "reunion" }, { date: "11/10", texte: "A demandé une remise sur la 4e année — à creuser en négo.", type: "appel", contactId: "c3" }, { date: "11/10", texte: "Visite effectuée", type: "note", dealId: "d3" }] },
    { id: "e4", statut: "Prospect", nom: "Fleurs Martin & Fils", nomCommercial: "Fleurs Martin & Fils — Lyon 6e", secteur: "Commerce floral", ville: "Lyon 6e", site: "martin-fleurs.fr", tel: "04 72 39 18 66", franchiseur: "Indépendant", modeLivraison: "Vélo électrique", activite: "Commerce floral", notes: "Livraisons matinales, besoin de 2 scooters.", activites: [{ date: "10/10", texte: "Proposition envoyée par email", type: "email", dealId: "d4" }] },
    { id: "e5", statut: "Prospect", nom: "L'Atelier Pizzeria", nomCommercial: "Domino's Pizza — Lyon 1er", secteur: "Restauration", ville: "Lyon 1er", site: "atelier-pizzeria.fr", tel: "04 37 45 09 12", franchiseur: "Domino's Pizza", modeLivraison: "Scooter électrique", activite: "Restauration rapide", notes: "" },
    { id: "e6", statut: "Prospect", nom: "Café des Jacobins", nomCommercial: "Café des Jacobins — Lyon 2e", secteur: "Café / brunch", ville: "Lyon 2e", site: "jacquou.fr", tel: "04 72 60 34 21", franchiseur: "Indépendant", modeLivraison: "À pied", activite: "Restauration traditionnelle", notes: "Budget serré, périmètre à réduire.", activites: [{ date: "09/10", texte: "Préparer une proposition à périmètre réduit", type: "tache", echeance: "16/10" }] },
    { id: "e7", statut: "Suspect", nom: "Marché Bio Villeurbanne", nomCommercial: "Marché Bio — Villeurbanne", secteur: "Alimentation bio", ville: "Villeurbanne", site: "marche-bio-69.fr", tel: "—", franchiseur: "Indépendant", modeLivraison: "Cargo bike", activite: "Alimentation bio", notes: "Contact entrant via le site." },
    { id: "e8", statut: "Suspect", nom: "Wok City", nomCommercial: "Wok City — Lyon 8e", secteur: "Restauration", ville: "Lyon 8e", site: "wok-city.fr", tel: "04 78 00 55 71", franchiseur: "Indépendant", modeLivraison: "Scooter électrique", activite: "Restauration rapide", notes: "" },
    { id: "e9", statut: "Suspect", nom: "S.A.R.L DP Lyon 3", nomCommercial: "Domino's Pizza — Lyon 3e", secteur: "Restauration", ville: "Lyon 3e", site: "dominos.fr", tel: "04 78 55 21 09", franchiseur: "Domino's Pizza", modeLivraison: "Scooter électrique", activite: "Restauration rapide", notes: "" },
    /* ════ CLIENTS RÉELS — importés du Sheet « Infos Service Client » (14/10/2026) ════
       Chaque ligne = un code client du Sheet (contrats) : pack choisi,
       période (min début → max fin des contrats du client), nombre de véhicules
       uniques, immatriculations. Mode de livraison
       « Scooter électrique » pour tous : c'est le produit réellement loué
       (COMPACT PRO / INFINITY PRO / S4-S5 Delivery = scooters U'mob, colonne
       Libellé Produit du Sheet). Activité renseignée d'après l'enseigne
       réelle (vérifiée sur le web pour les cas ambigus). Champ `risque`
       alimenté par les colonnes Statut_risque_client / Impayes /
       Procedure_collective du Sheet. Franchiseur laissé VIDE : le Sheet ne
       le connaît pas (règle anti-fausses-infos). Contacts réels rattachés. */
    { id: "e10", statut: "Client", nom: "GAF", nomCommercial: "Boîte à Pizza Annemasse", secteur: "Restauration", ville: "Annemasse", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Intégral + 48", dateDebut: "15/03/2024", dateFin: "05/04/2028", nbVehicules: "2", contratLocam: "", immatriculations: "GQ-591-NL, GQ-692-NL", risque: "Impayé", notes: "Code client C0010 — importé du Sheet « Infos Service Client » (14/10/2026). ⚠️ Impayé (source Sheet SAV)." },
    { id: "e11", statut: "Client", nom: "LA GROTTA AZZURA", nomCommercial: "La Grotte", secteur: "Restauration", ville: "Saint-Étienne", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration traditionnelle", pack: "Modèle Intégral + 48", dateDebut: "26/06/2024", dateFin: "10/08/2028", nbVehicules: "3", contratLocam: "", immatriculations: "GX-881-RL, GX-801-RL, GX-742-RL", notes: "Code client C0033 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e12", statut: "Client", nom: "JMBS", nomCommercial: "Cosmo Sushi", secteur: "Restauration", ville: "Mandelieu-la-Napoule", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Intégral 48 · Modèle Intégral + 48", dateDebut: "26/03/2021", dateFin: "10/09/2027", nbVehicules: "4", contratLocam: "", immatriculations: "FY-042-CC, GH-367-WG, GH-412-WG, GH-441-WG", notes: "Code client C0046 — importé du Sheet « Infos Service Client » (14/10/2026). Autre site : Fréjus (JHE Fréjus Sushi, mêmes gérants)." },
    { id: "e13", statut: "Client", nom: "NKM SARL", nomCommercial: "Dol's Pizza", secteur: "Restauration", ville: "Dole", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48 · Modèle Confort + 50", dateDebut: "13/01/2025", dateFin: "29/08/2030", nbVehicules: "8", contratLocam: "", immatriculations: "HA-008-QX, HA-035-QX, HA-905-QW, HA-945-QW, HA-974-QW, HL-239-NP, HL-209-NP, HL-281-NP", notes: "Code client C0071 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e14", statut: "Client", nom: "H2 ASSOCIÉS", nomCommercial: "Pizza All Over World", secteur: "Restauration", ville: "Nice", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "01/05/2023", dateFin: "30/06/2027", nbVehicules: "2", contratLocam: "", immatriculations: "GN-036-XF, GN-082-XF", notes: "Code client C0109 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e15", statut: "Client", nom: "ALVAREZ MARC", nomCommercial: "Bella Pizza", secteur: "Restauration", ville: "Thonon-les-Bains", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "23/10/2024", dateFin: "30/11/2028", nbVehicules: "1", contratLocam: "", immatriculations: "GZ-706-MH", notes: "Code client C0111 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e16", statut: "Client", nom: "SUSHI NOGENT DÉVELOPPEMENT", nomCommercial: "Sushi Shop", secteur: "Restauration", ville: "Nogent-sur-Marne", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort 48", dateDebut: "22/02/2023", dateFin: "10/04/2027", nbVehicules: "4", contratLocam: "", immatriculations: "GM-463-FL, GM-490-FL, GM-510-FL, GM-526-FL", notes: "Code client C0113 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e17", statut: "Client", nom: "AVENIR PIZZA", nomCommercial: "Pizza Time", secteur: "Restauration", ville: "Le Bourget", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort 48", dateDebut: "23/02/2023", dateFin: "09/04/2027", nbVehicules: "2", contratLocam: "", immatriculations: "GM-669-FZ, GM-703-FZ", notes: "Code client C0123 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e18", statut: "Client", nom: "STYLE BURGER", nomCommercial: "Delim's Burger", secteur: "Restauration", ville: "Épinay-sur-Seine", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort 48 · Modèle Confort + 48", dateDebut: "10/06/2021", dateFin: "30/08/2027", nbVehicules: "3", contratLocam: "", immatriculations: "FZ-440-WL, GQ-416-AJ, GQ-485-AJ", notes: "Code client C0135 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e19", statut: "Client", nom: "DOCRIVE", nomCommercial: "Class'Croute Paris 19", secteur: "Restauration", ville: "Paris", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Zen 36 · Modèle Confort + 48", dateDebut: "01/01/2018", dateFin: "08/03/2027", nbVehicules: "4", contratLocam: "", immatriculations: "ES-134-WF, ES-138-WF, ES-139-WF, GL-082-XH", risque: "Procédure collective", notes: "Code client C0143 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e20", statut: "Client", nom: "VIGILANTI JEAN CLAUDE", nomCommercial: "Fratelli Pizzas", secteur: "Restauration", ville: "Nice", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "12/11/2025", dateFin: "10/02/2030", nbVehicules: "2", contratLocam: "", immatriculations: "HG-937-LK, HG-968-LK", notes: "Code client C0152 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e21", statut: "Client", nom: "TTF CORPORATION", nomCommercial: "Pizza Hut", secteur: "Restauration", ville: "Pontault-Combault", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48 · Modèle Confort + 50", dateDebut: "28/09/2023", dateFin: "21/07/2030", nbVehicules: "4", contratLocam: "", immatriculations: "GR-862-JA, GR-825-JA, GT-902-JA, HK-231-TS", notes: "Code client C0162 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e22", statut: "Client", nom: "BON PLAN", nomCommercial: "Spidzza Grand Mère", secteur: "Restauration", ville: "Valence", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "VP · Modèle Confort + 48 · Modèle Confort + 50", dateDebut: "01/03/2019", dateFin: "20/04/2030", nbVehicules: "5", contratLocam: "", immatriculations: "FD-069-TL, FJ-579-KQ, GA-162-TM, FB-680-XL, HH-138-TT", risque: "Impayé", notes: "Code client C0199 — importé du Sheet « Infos Service Client » (14/10/2026). ⚠️ Impayé (source Sheet SAV)." },
    { id: "e23", statut: "Client", nom: "CCR", nomCommercial: "Mister Pizza", secteur: "Restauration", ville: "Antibes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48 · Modèle Confort + 50", dateDebut: "12/11/2025", dateFin: "12/05/2030", nbVehicules: "5", contratLocam: "", immatriculations: "HG-720-LT, HG-682-LT, HG-640-LT, HJ-902-PJ, HJ-553-PJ", notes: "Code client C0210 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e24", statut: "Client", nom: "AHI (AHIKA) LYON 7", nomCommercial: "", secteur: "Restauration", ville: "Lyon", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Intégral + 48", dateDebut: "16/07/2024", dateFin: "15/08/2028", nbVehicules: "1", contratLocam: "", immatriculations: "GY-681-EE", notes: "Code client C0212 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e25", statut: "Client", nom: "MAHE.COM", nomCommercial: "Pizza Le 33", secteur: "Restauration", ville: "Grasse", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort 48", dateDebut: "20/09/2021", dateFin: "30/09/2025", nbVehicules: "4", contratLocam: "", immatriculations: "GB-389-RF, GB-766-RF, GB-156-RG, GB-279-RG", notes: "Code client C0213 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e26", statut: "Client", nom: "RICA", nomCommercial: "Mister Pizza", secteur: "Restauration", ville: "Le Cannet", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48 · Modèle Confort + 50", dateDebut: "11/01/2024", dateFin: "30/05/2030", nbVehicules: "12", contratLocam: "", immatriculations: "GT-150-NE, HC-881-WP, HC-812-WP, HG-191-SY, HG-230-SY, HG-148-SY, HG-094-SY, HG-025-SY, HG-935-SX, HG-851-SX, HJ-564-XC, HJ-486-XC", notes: "Code client C0229 — importé du Sheet « Infos Service Client » (14/10/2026). Autre site : Cannes." },
    { id: "e27", statut: "Client", nom: "JSD SUSHIS", nomCommercial: "Sushi Or Not Sushi", secteur: "Restauration", ville: "Marseille", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort 48", dateDebut: "20/12/2018", dateFin: "20/10/2023", nbVehicules: "1", contratLocam: "", immatriculations: "FB-799-SD", risque: "Impayé + Procédure collective", notes: "Code client C0232 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e28", statut: "Client", nom: "TCHIKO", nomCommercial: "Pizza Time Poissy", secteur: "Restauration", ville: "Poissy", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort 48 · Modèle Confort + 48", dateDebut: "07/03/2022", dateFin: "20/12/2028", nbVehicules: "4", contratLocam: "", immatriculations: "GB-027-QV, GZ-604-WC, GZ-578-WC, GZ-552-WC", notes: "Code client C0245 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e29", statut: "Client", nom: "CARNOT", nomCommercial: "Mister Pizza Cannes", secteur: "Restauration", ville: "Cannes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "04/02/2025", dateFin: "28/03/2029", nbVehicules: "15", contratLocam: "", immatriculations: "HB-023-HJ, HB-051-HJ, HB-091-HJ, HB-130-HJ, HB-171-HJ, HB-223-HJ, HB-676-HH, HB-720-HH, HB-757-HH, HB-798-HH, HB-831-HH, HB-961-HH, HB-297-HJ, HB-450-HJ, HB-928-HH", notes: "Code client C0251 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e30", statut: "Client", nom: "ADG", nomCommercial: "Mister Pizza Cannes", secteur: "Restauration", ville: "Cannes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort 48 · Modèle Confort + 48", dateDebut: "26/04/2023", dateFin: "27/02/2029", nbVehicules: "8", contratLocam: "", immatriculations: "GN-245-LJ, GV-228-TW, HB-344-MM, HB-314-MM, HB-276-MM, HB-257-MM, HB-216-MM, HB-162-MM", notes: "Code client C0252 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e31", statut: "Client", nom: "VTN.INC", nomCommercial: "La Boîte à Pizza Muret", secteur: "Restauration", ville: "Muret", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "30/04/2024", dateFin: "20/06/2028", nbVehicules: "3", contratLocam: "", immatriculations: "GW-563-LK, GW-627-LK, GW-695-LK", notes: "Code client C0256 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e32", statut: "Client", nom: "FRANK", nomCommercial: "Pizza Time Franconville", secteur: "Restauration", ville: "Franconville", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 36", dateDebut: "26/06/2024", dateFin: "31/07/2029", nbVehicules: "2", contratLocam: "", immatriculations: "GX-634-QR, HK-970-ZE", notes: "Code client C0259 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e33", statut: "Client", nom: "DAFNEY", nomCommercial: "Pizza Time St-Ouen-l'Aumône", secteur: "Restauration", ville: "Saint-Ouen-l'Aumône", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort 48", dateDebut: "11/02/2019", dateFin: "30/10/2026", nbVehicules: "3", contratLocam: "", immatriculations: "FD-205-SB, GJ-828-KV, GJ-849-KV", notes: "Code client C0260 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e34", statut: "Client", nom: "LOIRE SUSHI", nomCommercial: "Eat Sushi", secteur: "Restauration", ville: "Saint-Étienne", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Intégral 48 · Modèle Intégral + 48", dateDebut: "18/05/2022", dateFin: "28/02/2028", nbVehicules: "3", contratLocam: "", immatriculations: "GG-700-HQ, GT-109-SW, GT-083-SW", notes: "Code client C0268 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e35", statut: "Client", nom: "CHEZ PINO", nomCommercial: "", secteur: "Restauration", ville: "Valence", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48 · Modèle Confort + 50", dateDebut: "28/03/2024", dateFin: "02/09/2030", nbVehicules: "3", contratLocam: "", immatriculations: "GV-297-YF, HL-892-NN, HL-811-NN", notes: "Code client C0270 — importé du Sheet « Infos Service Client » (14/10/2026). Autre site : Portes-lès-Valence." },
    { id: "e36", statut: "Client", nom: "SEBA", nomCommercial: "Pizza Time Champs-sur-Marne", secteur: "Restauration", ville: "Champs-sur-Marne", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "16/01/2025", dateFin: "15/02/2029", nbVehicules: "2", contratLocam: "", immatriculations: "HB-693-FB, HB-738-FB", notes: "Code client C0272 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e37", statut: "Client", nom: "ALLO PIZZA KELLY BURGER", nomCommercial: "", secteur: "Restauration", ville: "Antibes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "10/02/2025", dateFin: "09/03/2029", nbVehicules: "4", contratLocam: "", immatriculations: "HB-423-SK, HB-465-SK, HB-497-SK, HB-532-SK", notes: "Code client C0281 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e38", statut: "Client", nom: "SIMHA 7", nomCommercial: "Zapi Sushi", secteur: "Restauration", ville: "Nogent-sur-Marne", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 50", dateDebut: "15/05/2026", dateFin: "14/07/2030", nbVehicules: "2", contratLocam: "", immatriculations: "HK-666-SH, HK-773-SH", notes: "Code client C0284 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e39", statut: "Client", nom: "MORENO US", nomCommercial: "Mega Pizza", secteur: "Restauration", ville: "Metz", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "23/06/2023", dateFin: "20/02/2028", nbVehicules: "2", contratLocam: "", immatriculations: "GH-141-LA, GT-807-KQ", notes: "Code client C0297 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e40", statut: "Client", nom: "KEVIN", nomCommercial: "Indian Star", secteur: "Restauration", ville: "Beausoleil", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "04/07/2024", dateFin: "20/12/2029", nbVehicules: "3", contratLocam: "", immatriculations: "GX-192-TC, HG-776-DS, HG-801-DS", notes: "Code client C0306 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e41", statut: "Client", nom: "CHAMEROY", nomCommercial: "L'Antiboise", secteur: "Restauration", ville: "Antibes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Zen + 48 · Modèle Confort + 48", dateDebut: "25/06/2024", dateFin: "30/12/2029", nbVehicules: "3", contratLocam: "", immatriculations: "GX-912-FA, HG-722-EM, HG-635-EM", notes: "Code client C0307 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e42", statut: "Client", nom: "M BAREK", nomCommercial: "Le D'Lys Tacos", secteur: "Restauration", ville: "Antibes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "28/09/2023", dateFin: "20/10/2029", nbVehicules: "3", contratLocam: "", immatriculations: "GR-073-DR, HE-340-SW, HE-385-SW", notes: "Code client C0308 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e43", statut: "Client", nom: "MA-ROSE", nomCommercial: "Pizza Time Taverny", secteur: "Restauration", ville: "Taverny", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 36", dateDebut: "24/10/2024", dateFin: "23/11/2027", nbVehicules: "2", contratLocam: "", immatriculations: "GZ-020-HH, GZ-936-HG", notes: "Code client C0309 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e44", statut: "Client", nom: "LES 2 FRÈRES", nomCommercial: "Specialitaly", secteur: "Restauration", ville: "Menton", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "27/04/2023", dateFin: "27/05/2027", nbVehicules: "2", contratLocam: "", immatriculations: "GN-497-LH, GN-532-LH", risque: "À risque", notes: "Code client C0320 — importé du Sheet « Infos Service Client » (14/10/2026). ⚠️ À risque (source Sheet SAV)." },
    { id: "e45", statut: "Client", nom: "GMA", nomCommercial: "La Boîte à Pizza Cugnaux", secteur: "Restauration", ville: "Cugnaux", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort 48", dateDebut: "25/04/2019", dateFin: "30/04/2023", nbVehicules: "4", contratLocam: "", immatriculations: "FF-967-QV, FF-043-QW, FF-134-QW, FF-223-QW", risque: "Procédure collective", notes: "Code client C0321 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e46", statut: "Client", nom: "SUSHI WAKO", nomCommercial: "Wako", secteur: "Restauration", ville: "Le Vésinet", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Zen 48", dateDebut: "15/09/2020", dateFin: "14/09/2024", nbVehicules: "1", contratLocam: "", immatriculations: "FS-603-RR", risque: "À risque", notes: "Code client C0336 — importé du Sheet « Infos Service Client » (14/10/2026). Autres sites : Nanterre, Puteaux. ⚠️ À risque (source Sheet SAV)." },
    { id: "e47", statut: "Client", nom: "MER", nomCommercial: "Mister Pizza Nice Californie", secteur: "Restauration", ville: "Nice", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 50", dateDebut: "15/06/2026", dateFin: "14/08/2030", nbVehicules: "10", contratLocam: "", immatriculations: "HL-992-FA, HL-072-FB, HL-034-FB, HL-949-FA, HL-334-FB, HL-129-FB, HL-491-FB, HL-573-FB, HL-420-FB, HL-199-FB", notes: "Code client C0338 — importé du Sheet « Infos Service Client » (14/10/2026). Autre site : Vence." },
    { id: "e48", statut: "Client", nom: "MEV", nomCommercial: "Allo Japonais", secteur: "Restauration", ville: "Poitiers", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Zen + 48 · Modèle Zen + 50", dateDebut: "28/12/2023", dateFin: "25/10/2030", nbVehicules: "3", contratLocam: "", immatriculations: "GT-511-DN, HM-129-KS, HM-116-KS", risque: "À risque", notes: "Code client C0339 — importé du Sheet « Infos Service Client » (14/10/2026). ⚠️ À risque (source Sheet SAV)." },
    { id: "e49", statut: "Client", nom: "STAR CHICKEN", nomCommercial: "", secteur: "Restauration", ville: "Albi", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "23/06/2023", dateFin: "22/06/2027", nbVehicules: "1", contratLocam: "", immatriculations: "GH-258-SN", risque: "Impayé", notes: "Code client C0350 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e50", statut: "Client", nom: "COSTES RESTAURATION", nomCommercial: "Tutti Pizza — Montauban Voltaire", secteur: "Restauration", ville: "Montauban", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48 · Modèle Confort + 50", dateDebut: "13/01/2025", dateFin: "02/10/2030", nbVehicules: "2", contratLocam: "", immatriculations: "HA-866-YL, HM-050-CT", notes: "Code client C0359 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e51", statut: "Client", nom: "SYSM", nomCommercial: "Mister Pizza Mandelieu", secteur: "Restauration", ville: "Mandelieu-la-Napoule", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "30/06/2023", dateFin: "20/01/2030", nbVehicules: "9", contratLocam: "", immatriculations: "GQ-937-BF, GQ-892-BF, HG-633-HG, HG-658-HG, HG-686-HG, HG-711-HG, HG-736-HG, HG-765-HG, HG-605-HG", notes: "Code client C0360 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e52", statut: "Client", nom: "JAIVASAVI", nomCommercial: "La Galaxie", secteur: "Restauration", ville: "Saint-Vallier-de-Thiey", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "03/04/2025", dateFin: "20/05/2029", nbVehicules: "1", contratLocam: "", immatriculations: "HC-338-QQ", notes: "Code client C0361 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e53", statut: "Client", nom: "ALIDA", nomCommercial: "Jassmin Pizza", secteur: "Restauration", ville: "Villecresnes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort 48", dateDebut: "10/10/2019", dateFin: "10/10/2023", nbVehicules: "1", contratLocam: "", immatriculations: "FK-829-NE", risque: "Impayé", notes: "Code client C0362 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e54", statut: "Client", nom: "BOBUN BOULEVARD", nomCommercial: "", secteur: "Restauration", ville: "Lyon", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort 48", dateDebut: "07/11/2022", dateFin: "20/04/2027", nbVehicules: "1", contratLocam: "", immatriculations: "GM-279-EZ", risque: "Impayé", notes: "Code client C0368 — importé du Sheet « Infos Service Client » (14/10/2026). ⚠️ Impayé (source Sheet SAV)." },
    { id: "e55", statut: "Client", nom: "ABDELHAFID GAZZAH", nomCommercial: "Stop Pizza 2", secteur: "Restauration", ville: "Antibes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Zen + 48", dateDebut: "16/02/2023", dateFin: "20/03/2027", nbVehicules: "1", contratLocam: "", immatriculations: "GM-957-CW", notes: "Code client C0376 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e56", statut: "Client", nom: "BING ME", nomCommercial: "Arigato", secteur: "Restauration", ville: "Bruges", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Zen 48 · Modèle Zen + 48", dateDebut: "10/08/2022", dateFin: "10/01/2028", nbVehicules: "2", contratLocam: "", immatriculations: "GH-698-YA, GS-034-RA", risque: "À risque", notes: "Code client C0387 — importé du Sheet « Infos Service Client » (14/10/2026). ⚠️ À risque (source Sheet SAV)." },
    { id: "e57", statut: "Client", nom: "AEW CANNES", nomCommercial: "Asiakeo", secteur: "Restauration", ville: "Cannes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort 48", dateDebut: "22/07/2022", dateFin: "22/08/2026", nbVehicules: "1", contratLocam: "", immatriculations: "GH-399-PH", notes: "Code client C0388 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e58", statut: "Client", nom: "NOSANTOKUNOSUSHIS", nomCommercial: "Samouraï Sushi Dijon", secteur: "Restauration", ville: "Dijon", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "04/06/2024", dateFin: "20/07/2028", nbVehicules: "1", contratLocam: "", immatriculations: "GX-913-FZ", notes: "Code client C0392 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e59", statut: "Client", nom: "AU FOURNIL DE STEPH", nomCommercial: "Allo Pizza Sète", secteur: "Restauration", ville: "Sète", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 50", dateDebut: "05/02/2026", dateFin: "04/04/2030", nbVehicules: "2", contratLocam: "", immatriculations: "HH-119-ZQ, HH-179-ZQ", notes: "Code client C0397 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    /* ══ Cas de TEST multi-contrats (données réelles du Sheet, ajoutées 14/10 pour
       valider les blocs « un contrat = ses propres dates »). 3 contrats,
       flotte MIXTE : 4 Compact Pro + 2 Daily Pro + 1 Daily
       Pro. Statut risque Sheet = « Sous surve » (valeur hors menu,
       laissée en note). ══ */
    { id: "e60", statut: "Client", nom: "LM PIZZA PUCE", nomCommercial: "LM Pizza Puce — Lyon 4e", secteur: "Restauration", ville: "Lyon", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48 · Modèle Confort + 50", dateDebut: "30/04/2024", dateFin: "11/10/2030", nbVehicules: "7", contratLocam: "", immatriculations: "GW-830-NW, GW-890-NW, GX-336-VG, GX-519-VG, GX-644-VG, GX-758-VG, HM-816-GW", modeles: ["Compact Pro", "Daily Pro"],
      contrats: [
        { pack: "Modèle Confort + 48", modele: "Daily Pro", num: "", dateDebut: "30/04/2024", dateFin: "10/06/2028", immats: "GW-830-NW, GW-890-NW", etat: "2" },
        { pack: "Modèle Confort + 48", modele: "Compact Pro", num: "", dateDebut: "27/06/2024", dateFin: "26/07/2028", immats: "GX-336-VG, GX-519-VG, GX-644-VG, GX-758-VG", etat: "2" },
        { pack: "Modèle Confort + 50", modele: "Daily Pro", num: "", dateDebut: "12/08/2026", dateFin: "11/10/2030", immats: "HM-816-GW", etat: "2" },
      ],
      notes: "Code client C2119 — SIREN 925301327 · 5 Place Commandant Arnaud, 69004 Lyon. ⚠️ « Sous surveillance » (source Sheet SAV). 3 contrats actifs, flotte mixte Compact Pro / Daily Pro." },
  ],
  contacts: [
    { id: "c1", prenom: "Julien", nom: "Faure", role: "Gérant", email: "j.faure@rotisserie-du-rhone.fr", tel: "06 12 44 87 21", entrepriseIds: ["e1"] },
    { id: "c2", prenom: "Amine", nom: "Berrada", role: "Gérant", email: "amine@pokebowl-express.fr", tel: "06 45 21 33 09", entrepriseIds: ["e2"] },
    { id: "c3", prenom: "Charlotte", nom: "Ly", role: "Directrice exploitation", email: "c.ly@bieres-et-burgers.fr", tel: "06 88 12 54 76", entrepriseIds: ["e3"] },
    { id: "c9", prenom: "Kevin", nom: "Dubois", role: "Responsable achats", email: "k.dubois@bieres-et-burgers.fr", tel: "06 77 34 12 98", entrepriseIds: ["e3"] },
    { id: "c4", prenom: "Marc", nom: "Martin", role: "Gérant", email: "marc@martin-fleurs.fr", tel: "06 23 76 90 12", entrepriseIds: ["e4"] },
    { id: "c5", prenom: "Sofiane", nom: "Kaci", role: "Gérant", email: "sofiane@atelier-pizzeria.fr", tel: "06 51 88 22 47", entrepriseIds: ["e5"] },
    { id: "c6", prenom: "Élodie", nom: "Perrin", role: "Gérante", email: "elodie@jacquou.fr", tel: "06 14 02 88 53", entrepriseIds: ["e6"] },
    { id: "c7", prenom: "Nadia", nom: "Belkacem", role: "Responsable achats", email: "nadia@marche-bio-69.fr", tel: "—", entrepriseIds: ["e7"] },
    { id: "c8", prenom: "Lina", nom: "Nguyen", role: "Gérante", email: "lina@wok-city.fr", tel: "06 92 45 11 08", entrepriseIds: ["e8"] },
    // Cas PIERRE PIRON : gérant de plusieurs sociétés (15 Domino's) → UN SEUL
    // contact dont le rôle = sa qualité réelle (ex-INSEE « Gérant »), et les
    // sociétés qu'il dirige sont portées par les LIENS (entrepriseIds), pas par
    // le libellé du rôle.
    { id: "c10", prenom: "Pierre", nom: "Piron", role: "Gérant", email: "p.piron@dp-piron.fr", tel: "06 11 22 33 44", entrepriseIds: ["e5", "e9"] },
    /* ════ CONTACTS RÉELS des clients ci-dessus — Sheet « Infos Service Client » ════ */
    { id: "c11", prenom: "Ismail", nom: "Akdogan", role: "Gérant", email: "bap.annemasse@gmail.com", tel: "06 20 47 60 40", entrepriseIds: ["e10"] },
    { id: "c12", prenom: "Kasim", nom: "Altinel", role: "Ancien dirigeant", email: "bap.annemasse@gmail.com", tel: "07 62 74 48 48", entrepriseIds: ["e10"] },
    { id: "c13", prenom: "Daniel", nom: "Pigniatelli Piattone", role: "Gérant", email: "dan4stelle@hotmail.fr", tel: "", entrepriseIds: ["e11"] },
    { id: "c14", prenom: "Vincent", nom: "Pigniatelli Piattone", role: "Frère gérant", email: "", tel: "06 21 54 48 86", entrepriseIds: ["e11"] },
    { id: "c15", prenom: "Hélène", nom: "Silbercher", role: "Femme du gérant", email: "", tel: "06 27 03 62 92", entrepriseIds: ["e12"] },
    { id: "c16", prenom: "Jérôme", nom: "Silbercher", role: "Gérant", email: "j.silbercher@gmail.com", tel: "06 27 33 32 13", entrepriseIds: ["e12"] },
