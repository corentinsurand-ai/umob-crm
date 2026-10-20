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
interface Activite { date: string; texte: string; type?: TypeActivite; echeance?: string; dateISO?: string; heure?: string; contactId?: string; dealId?: string; fait?: boolean; clotureLe?: string; /* Champs enrichis par le webhook Ringover (api/ringover.ts) : analyse IA de l appel — jamais d invention, vides si la source est muette. */ appelId?: string; numeroAppel?: string; directionAppel?: string; dureeAppel?: string; resumeIA?: string; sentiment?: string; sujets?: string; scoreIA?: number; transcription?: string; urlEnregistrement?: string; scorecard?: { [k: string]: { note: number; j: string } } }

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
    { id: "c17", prenom: "Mohammed", nom: "Harden", role: "", email: "m_harden@ymail.com", tel: "06 59 95 05 04", entrepriseIds: ["e14"] },
    { id: "c18", prenom: "Marc", nom: "Alvarez", role: "Dirigeant", email: "DDP.ALVAREZ@YAHOO.FR", tel: "06 20 92 21 96", entrepriseIds: ["e15"] },
    { id: "c19", prenom: "Cédric", nom: "Adam", role: "Gérant", email: "cadam@sushishop.fr", tel: "06 33 05 60 72", entrepriseIds: ["e16"] },
    { id: "c20", prenom: "Reyhan", nom: "Coban", role: "Nouveau gérant", email: "avenir.pizzatime@gmail.com", tel: "", entrepriseIds: ["e17"] },
    { id: "c21", prenom: "Wajdi", nom: "Habib", role: "Associé", email: "avenir.pizzatime@gmail.com", tel: "06.40.66.84.43", entrepriseIds: ["e17"] },
    { id: "c22", prenom: "Houcine", nom: "Dahili", role: "Gérant associé", email: "h.dahili@hotmail.fr", tel: "06 58 81 80 58", entrepriseIds: ["e18"] },
    { id: "c23", prenom: "Youssef", nom: "Ounasser", role: "Gérant", email: "styleburger@yahoo.com", tel: "06 20 16 08 54", entrepriseIds: ["e18"] },
    { id: "c24", prenom: "Christian", nom: "Archer", role: "Gérant", email: "Christian.archer@wanadoo.fr", tel: "", entrepriseIds: ["e19"] },
    { id: "c25", prenom: "Jean Claude", nom: "Vigilanti", role: "", email: "jcfratelli@live.fr", tel: "06 35 24 91 42", entrepriseIds: ["e20"] },
    { id: "c26", prenom: "Romain", nom: "Camagie", role: "Gérant", email: "misterpizzaantibes@gmail.com", tel: "06 77 66 97 77", entrepriseIds: ["e23"] },
    { id: "c27", prenom: "Maxence", nom: "Bottero", role: "Gérant", email: "maxencebottero@hotmail.com", tel: "", entrepriseIds: ["e25"] },
    { id: "c28", prenom: "Didier", nom: "Chiaramonti", role: "", email: "ornotsushi@gmail.com", tel: "07 86 03 35 73", entrepriseIds: ["e27"] },
    { id: "c29", prenom: "Sofiane", nom: "Housni", role: "Contact SAV", email: "sofiane.housni.78260@gmail.com", tel: "06.51.46.51.03", entrepriseIds: ["e28"] },
    { id: "c30", prenom: "Didier", nom: "Gomez", role: "Gérant", email: "gomezdidier@wanadoo.fr", tel: "06 11 52 52 87", entrepriseIds: ["e29"] },
    { id: "c31", prenom: "Gilles", nom: "Anguerra", role: "Gérant", email: "comptabilite@mister-pizza.net", tel: "06 09 55 38 55", entrepriseIds: ["e30"] },
    { id: "c32", prenom: "Jessica", nom: "Mahuet", role: "Associée", email: "jessicamahuet@yahoo.fr", tel: "", entrepriseIds: ["e31"] },
    { id: "c33", prenom: "William", nom: "Charles", role: "Nouveau gérant", email: "wicharles42@gmail.com", tel: "06 03 39 32 75", entrepriseIds: ["e34"] },
    { id: "c34", prenom: "Alicia", nom: "Pino", role: "", email: "", tel: "06 37 82 38 72", entrepriseIds: ["e35"] },
    { id: "c35", prenom: "Christian", nom: "Pino", role: "", email: "christian.pino@orange.fr", tel: "06 13 63 93 17", entrepriseIds: ["e35"] },
    { id: "c37", prenom: "Beyhan", nom: "Akdemir", role: "Nouveau gérant", email: "seba.pizzatime@gmail.com", tel: "06 28 13 22 85", entrepriseIds: ["e36"] },
    { id: "c38", prenom: "Sébastien", nom: "Tesson", role: "Responsable SAV", email: "spike159@hotmail.fr", tel: "06 24 47 50 07", entrepriseIds: ["e36"] },
    { id: "c39", prenom: "Taha", nom: "Abdelaal", role: "Manager", email: "seba.pizzatime@gmail.com", tel: "06 51 72 25 49", entrepriseIds: ["e36"] },
    { id: "c40", prenom: "Zara", nom: "Imajdine", role: "Assistante administrative", email: "seba.pizzatime@gmail.com", tel: "07 62 55 49 92", entrepriseIds: ["e36"] },
    { id: "c41", prenom: "Liam", nom: "Saidi", role: "Nouveau gérant", email: "liamnzl@icloud.com", tel: "06 98 98 79 40", entrepriseIds: ["e37"] },
    { id: "c42", prenom: "Samir", nom: "Saidi", role: "Ancien gérant", email: "ouicsam@live.fr", tel: "06 51 73 16 74", entrepriseIds: ["e37"] },
    { id: "c43", prenom: "Franck", nom: "Bouteboul", role: "Gérant", email: "franck.bouteboul@orange.fr", tel: "06 22 47 05 03", entrepriseIds: ["e38"] },
    { id: "c44", prenom: "José", nom: "Moreno Monja", role: "Gérant", email: "megapizza57@gmail.com", tel: "06 26 15 29 83", entrepriseIds: ["e39"] },
    { id: "c45", prenom: "Sinnathurai", nom: "Kavilendran", role: "Gérant", email: "indianstarkevin@gmail.com", tel: "06 10 25 80 07", entrepriseIds: ["e40"] },
    { id: "c46", prenom: "Frédéric", nom: "Chameroy", role: "Gérant", email: "fredchameroy@yahoo.fr", tel: "06 18 42 15 91", entrepriseIds: ["e41"] },
    { id: "c47", prenom: "Tahar", nom: "M'Barek", role: "Gérant", email: "ledlys.mb@outlook.fr", tel: "06 31 41 96 93", entrepriseIds: ["e42"] },
    { id: "c48", prenom: "Sertac", nom: "Colak", role: "Président", email: "colak.sertac@gmail.com", tel: "06 98 23 23 05", entrepriseIds: ["e43"] },
    { id: "c49", prenom: "Gael", nom: "Nollot", role: "Gérant", email: "gn.bap.cugnaux@gmail.com", tel: "06 59 40 71 16", entrepriseIds: ["e45"] },
    { id: "c50", prenom: "André", nom: "Cong", role: "Gérant", email: "restaurant@sushi-wako78.fr", tel: "06 22 74 46 58", entrepriseIds: ["e46"] },
    { id: "c51", prenom: "Dong", nom: "An", role: "Manager / fils gérant", email: "dong.an88@yahoo.fr", tel: "06 52 50 00 08", entrepriseIds: ["e46"] },
    { id: "c52", prenom: "Adil", nom: "Elatmani", role: "Gérant", email: "adil.2b@hotmail.fr", tel: "06 61 64 47 34", entrepriseIds: ["e47"] },
    { id: "c53", prenom: "Alexandre", nom: "Robert", role: "Gérant", email: "alexandre.robert.06@gmail.com", tel: "06 98 28 47 34", entrepriseIds: ["e47"] },
    { id: "c54", prenom: "Matthieu", nom: "Lequertier", role: "Associé", email: "matthieu.lequertier@gmail.com", tel: "06 35 17 53 48", entrepriseIds: ["e49"] },
    { id: "c55", prenom: "Xavier", nom: "Barbier", role: "Gérant", email: "barbier-xavier@orange.fr", tel: "682613140", entrepriseIds: ["e49"] },
    { id: "c56", prenom: "Sandra", nom: "Martin", role: "Femme du gérant", email: "", tel: "06 68 95 03 14", entrepriseIds: ["e51"] },
    { id: "c57", prenom: "Youssef", nom: "Doudouh", role: "Président", email: "mp.sysm@hotmail.com", tel: "06 64 03 63 92", entrepriseIds: ["e51"] },
    { id: "c58", prenom: "Iqbal", nom: "Shanawaz", role: "Ancien gérant", email: "lagalaxie06460@gmail.com", tel: "06 52 04 90 39", entrepriseIds: ["e52"] },
    { id: "c59", prenom: "Saranya", nom: "Umabathi", role: "Dirigeant", email: "lagalaxie06460@gmail.com", tel: "07 85 03 25 12", entrepriseIds: ["e52"] },
    { id: "c60", prenom: "Abdelhafid", nom: "Gazzah", role: "Gérant", email: "nathalie.gazzah@gmail.com", tel: "06 76 65 04 84", entrepriseIds: ["e55"] },
    { id: "c61", prenom: "Bingfu", nom: "Peng", role: "", email: "364546783@qq.com", tel: "06 98 13 61 96", entrepriseIds: ["e56"] },
    { id: "c62", prenom: "Aline", nom: "Leblanc", role: "Manager / SAV", email: "", tel: "07 78 82 74 91", entrepriseIds: ["e57"] },
    { id: "c63", prenom: "Gabriel", nom: "Michelini", role: "Gérant", email: "lmpizzapuce@gmail.com", tel: "06 84 54 52 36", entrepriseIds: ["e60"] },
  ],
  deals: [
    { id: "d1", nom: "Contrat annuel — flotte 3 scooters", entrepriseId: "e1", contactId: "c1", montant: 42, etape: "Gagné", action: "Kick-off maintenance", echeance: "20/10", notes: "", fait: false },
    { id: "d2", nom: "Abonnement 2 scooters", entrepriseId: "e2", contactId: "c2", montant: 31, etape: "Gagné", action: "Planifier livraison flotte", echeance: "22/10", notes: "", fait: false },
    { id: "d3", nom: "Flotte 4 scooters + maintenance", entrepriseId: "e3", contactId: "c3", montant: 58, etape: "Négociation", action: "RDV négo — levier flotte 4 scooters", echeance: "15/10", notes: "Sensible au prix, envisager 10% sur la 4e année.", fait: false },
    { id: "d4", nom: "2 scooters livraisons matinales", entrepriseId: "e4", contactId: "c4", montant: 24, etape: "Proposition envoyée", action: "Relancer la proposition (J+3)", echeance: "13/10", notes: "", fait: false },
    { id: "d5", nom: "Abonnement 1 scooter", entrepriseId: "e5", contactId: "c5", montant: 18, etape: "Proposition envoyée", action: "Attente retour devis", echeance: "17/10", notes: "", fait: false },
    { id: "d6", nom: "2 scooters périmètre réduit", entrepriseId: "e6", contactId: "c6", montant: 15, etape: "Négociation", action: "Réduire le périmètre — 2 scooters", echeance: "16/10", notes: "Refuser 3 scooters pour l'instant.", fait: false },
    { id: "d7", nom: "Découverte — livraison bio", entrepriseId: "e7", contactId: "c7", montant: 36, etape: "À qualifier", action: "Appel découverte à programmer", echeance: "15/10", notes: "Contact entrant via le site.", fait: false },
    { id: "d8", nom: "Essai 1 scooter", entrepriseId: "e8", contactId: "c8", montant: 12, etape: "À qualifier", action: "Qualifier périmètre & budget", echeance: "18/10", notes: "", fait: false },
  ],
};

// ── Persistance PRODUCTION (Supabase) ────────────────────────────────────────
// La base vit dans la table `crm_etat` (une ligne jsonb, voir src/lib/supabase.ts) :
// chargée à l'ouverture, sauvegardée automatiquement à chaque modification.
// La normalisation ci-dessous (champs manquants → valeurs vides, `activites`
// réinjecté, `entrepriseId` → `entrepriseIds`) s'applique aussi bien aux
// données distantes qu'au seed : les fiches importées du Sheet ne contiennent
// pas toutes les clés, et un enregistrement sans `activites` ferait planter
// les .map() en aval (crash "not iterable").
function normaliser(s: Etat): Etat {
  // ── 1. Structure de base : champs manquants → valeurs vides ──
  const entreprises = (s.entreprises || []).map((x) => ({
    nomCommercial: "", franchiseur: "", modeLivraison: "", activite: "", statut: "Suspect",
    // Migration « Contrat & flotte » : champs absents des vieilles
    // sauvegardes → vides (jamais d'invention).
    pack: "", dateDebut: "", dateFin: "", nbVehicules: "", contratLocam: "", immatriculations: "",
    // Migration « Risque » : champ absent des vieilles sauvegardes → vide.
    risque: "",
    // Migration « Origine » : champ absent des vieilles sauvegardes → vide.
    origine: "",
    modeles: [],
    ...x,
    contrats: x.contrats || ((x.pack || x.contratLocam) ? [{ pack: x.pack || "", modele: "", num: "", dateDebut: x.dateDebut || "", dateFin: x.dateFin || "", immats: x.immatriculations || "", etat: "" }] : []),
    activites: (x.activites || []).slice(),
    // Téléphone au format français lisible (06 13 88 67 56) : corrige les
    // anciens numéros bruts « 33698824873 » venus de Ringover. Le matching
    // téléphonique (normTel) ignore les espaces — aucun impact recherche.
    tel: formaterTelFr(x.tel),
    // Devis archivés : même logique de migration douce que les activités.
    devisHistorique: (x.devisHistorique || []).slice(),
  }));
  // Migration contacts : l'ancien champ unique `entrepriseId` devient un
  // TABLEAU `entrepriseIds` (un contact peut appartenir à plusieurs
  // entreprises). Les vieux enregistrements sont convertis à la volée.
  const contacts = (s.contacts || []).map((x) => ({
    ...x,
    entrepriseIds: x.entrepriseIds || ((x as { entrepriseId?: string }).entrepriseId ? [(x as { entrepriseId: string }).entrepriseId] : []),
    tel: formaterTelFr(x.tel),
  }));
  const deals = (s.deals || []).map((x) => ({ ...x }));

  // ── 2. Migration « activités centralisées » : avant ce refacto, les fiches
  // CONTACT et DEAL portaient leur propre liste `activites`. Ces activités
  // sont DÉPLACÉES vers l'entreprise liée, avec un lien `contactId`/`dealId`
  // pour continuer à les retrouver depuis les fiches contact et deal.
  // Idempotent : après migration, les contacts/deals n'ont plus de `activites`,
  // donc un second passage ne déplace rien.
  const versEntreprise = (eid: string, a: Activite, patch: Partial<Activite>) => {
    const e = entreprises.find((x) => x.id === eid);
    if (e) e.activites.push({ ...a, ...patch });
  };
  for (const c of contacts) {
    const legacy = (c as Contact & { activites?: Activite[] }).activites;
    if (legacy && legacy.length > 0) {
      const eid = c.entrepriseIds && c.entrepriseIds[0];
      if (eid) legacy.forEach((a) => versEntreprise(eid, a, { contactId: c.id }));
    }
  }
  for (const d of deals) {
    const legacy = (d as Deal & { activites?: Activite[] }).activites;
    if (legacy && legacy.length > 0) {
      legacy.forEach((a) => versEntreprise(d.entrepriseId, a, { dealId: d.id }));
    }
  }
  // On retire ensuite la clé `activites` des contacts/deals (elle n'existe
  // plus dans le modèle : seule l'entreprise porte des activités).
  const contactsFinaux = contacts.map(({ activites, ...reste }: { activites?: Activite[] } & Contact) => reste);
  const dealsFinaux = deals.map(({ activites, ...reste }: { activites?: Activite[] } & Deal) => reste);
  return { ...s, entreprises, contacts: contactsFinaux, deals: dealsFinaux, modelesMailDevis: (s.modelesMailDevis || []).slice(), signatureMail: typeof s.signatureMail === "string" ? s.signatureMail : undefined, documentsDevis: Array.isArray(s.documentsDevis) ? (s.documentsDevis as DocumentDevis[]).filter((x: any) => x && x.contenuBase64) : undefined };
}

// État « base vide » (aucune donnée dans Supabase). Utilisé par l'écran
// d'initialisation : on ne pré-remplit JAMAIS sans décision explicite.
const ETAT_VIDE: Etat = { entreprises: [], contacts: [], deals: [] };

// Déconnexion manuelle (bouton de la barre latérale).
async function seDeconnecter() {
  await supabase.auth.signOut();
}

/* ============================== UI DE BASE ============================== */

// Petit badge coloré (étapes du pipeline, échéances, compteurs…).
// Le fond est la couleur passée avec ~13% d'opacité (suffixe hexa "22").
function Badge({ texte, couleur }: { texte: string; couleur: string }) {
  return (
    <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold" style={{ background: `${couleur}22`, color: "#334155" }}>
      {texte}
    </span>
  );
}

// Styles partagés des champs de formulaire (input/textarea/select de la modale).
const champ = "w-full rounded-xl border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-cyan-500";
const label = "mb-1 block text-[11px] font-bold text-slate-500";

/* ── Nouveaux champs « fiche entreprise » : Franchiseur / Mode de livraison /
   Activité ──────────────────────────────────────────────────────────────────
   Valeurs NORMALISÉES en menus déroulants (et non du texte libre) : c'est ce
   qui permettra de filtrer proprement et surtout de faire remplir ces champs
   automatiquement plus tard — par l'analyse IA des conversations (appels,
   e-mails) ou par une recherche internet automatique sur l'entreprise.
   L'IA n'aura qu'à choisir dans la liste au lieu d'inventer du texte. */
const OPTIONS_FRANCHISEUR = ["Indépendant", "Domino's Pizza", "Burger King", "McDonald's", "KFC", "Subway", "Pizza Hut", "O'Tacos", "La Boîte à Pizza"];
const OPTIONS_MODE_LIVRAISON = ["U'mob", "Scooter électrique", "Scooter thermique", "Vélo électrique", "Cargo bike", "Voiture", "À pied", "Uber Eats / Deliveroo", "Mixte"];
const OPTIONS_ACTIVITE = ["Restauration rapide", "Restauration traditionnelle", "Livraison de repas", "Boulangerie / Pâtisserie", "Commerce floral", "Alimentation bio", "Commerce de détail", "Services", "Autre"];
// ── Origine de la relation (champ « Origine » du panneau À propos) ──
const OPTIONS_ORIGINE = ["Groupe Client", "Demande entrante", "Autre"];
// Valeurs du champ « Risque » (source Sheet SAV : Statut_risque_client,
// Impayes, Procedure_collective). L'option vide « — » de ChampSelect vaut
// « aucun risque signalé ».
const OPTIONS_RISQUE = ["Impayé", "Mauvais payeur", "À risque", "Sous surveillance", "Procédure collective", "Impayé + Procédure collective"];
// ── Normalisation du libellé de risque : le Sheet (ou d'anciennes fiches)
// contient parfois des valeurs tronquées ou mal orthographiées (« Mauvais pa »,
// « Impaye », « Sous surve », « Mauvais payeurs »…). On les ramène au libellé
// PROPRE du menu — comparaison sur la forme normalisée (sans accents ni
// espaces). Valeur inconnue → laissée telle quelle (jamais d'invention). ──
const EQUIV_RISQUE: [string, string][] = [
  ["mauvaispa", "Mauvais payeur"], ["mauvaispayeur", "Mauvais payeur"], ["mauvaispayeurs", "Mauvais payeur"],
  ["impaye", "Impayé"], ["impayes", "Impayé"], ["impayer", "Impayé"],
  ["soussurve", "Sous surveillance"], ["soussurveillance", "Sous surveillance"],
  ["procedurecollective", "Procédure collective"], ["procedurecollectiveradiation", "Procédure collective"],
  ["arisque", "À risque"],
  ["impayeprocedurecollective", "Impayé + Procédure collective"],
];
const normRisque = (r: string): string => {
  const n = norme(r);
  const t = EQUIV_RISQUE.find(([k]) => k === n);
  return t ? t[1] : (r || "");
};

/* ── Statut du cycle de vie : Suspect → Prospect → Client ───────────────────
   C'est le seul champ que l'humain maîtrise totalement : ni les API ni l'IA
   ne le remplissent automatiquement (on ne « devine » pas qu'un prospect est
   devenu client), c'est l'équipe commerciale qui le fait évoluer au fil du
   cycle. Couleurs : Suspect = gris, Prospect = bleu, Client = vert. */
const STATUTS = ["Suspect", "Prospect", "Client"] as const;
type Statut = (typeof STATUTS)[number];
const COULEUR_STATUT: Record<string, string> = { Suspect: "#94a3b8", Prospect: "#4f9ee8", Client: "#57c26b" };

/* Menu déroulant réutilisable, stylé exactement comme les champs texte
   (mêmes bordures arrondies, même focus cyan). Valeur vide = option « — ». */
function ChampSelect({ valeur, options, onChange }: { valeur: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <select className={champ} value={valeur} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

/* ── Annuaire de DÉMONSTRATION pour la recherche auto d'entreprise ──────────
   Dans la version déployée, la recherche par SIREN appellera l'API publique
   « Recherche d'entreprises » (recherche-entreprises.api.gouv.fr — gratuite,
   sans clé, données INSEE : dénomination, NOM COMMERCIAL/sigle/enseigne,
   adresse, activité NAF, dirigeants…) et la recherche par téléphone fixe
   l'API Pappers (standard des entreprises). Le canvas étant 100 % hors-ligne,
   on SIMULE ces sources avec quelques fiches locales : l'écran et le
   comportement seront identiques le jour où on branche les vraies API.
   ⚠️ Règle anti-fausses-infos : un champ inconnu des sources reste VIDE
   (ex. NVL ATLAS — l'INSEE ne connaît ni son enseigne, ni son téléphone,
   ni son mode de livraison). */
const ANNUAIRE_DEMO = [
  // Cas de TEST multi-contrats (Corentin, 14/10) : SIREN réel de LM PIZZA PUCE —
  // la recherche par SIREN trouve la fiche même sans réseau ; les 3 contrats
  // viennent, eux, du Sheet en direct à la création.
  { siren: "925301327", tel: "0684545236", telAffiche: "06 84 54 52 36", nom: "LM PIZZA PUCE", nomCommercial: "LM Pizza Puce — Lyon 4e", ville: "Lyon", secteur: "Restauration", site: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide",
    sources: ["INSEE", "Sheet Infos Service Client"],
    contactsTrouves: [{ prenom: "Gabriel", nom: "Michelini", role: "Gérant", email: "lmpizzapuce@gmail.com", tel: "06 84 54 52 36" }] },
  // `sources` = provenance des données ; `contactsTrouves` = contacts
  // identifiés (dirigeant INSEE, annuaires…) proposés à la création avec
  // des cases à cocher / décocher.
  { siren: "823456782", tel: "0147501122", telAffiche: "01 47 50 11 22", nom: "S.A.R.L SGZ", nomCommercial: "Domino's Pizza — Nanterre", ville: "Nanterre", secteur: "Restauration", site: "dominos.fr", franchiseur: "Domino's Pizza", modeLivraison: "Scooter électrique", activite: "Restauration rapide",
    sources: ["INSEE", "Pappers", "Web"],
    contactsTrouves: [{ prenom: "Sebastien", nom: "ZIG", role: "Gérant", email: "be-s75@hotmail.fr", tel: "+33 6 50 22 33 00" }] },
  { siren: "512345678", tel: "0472110244", telAffiche: "04 72 11 02 44", nom: "Rotisserie du Rhône", nomCommercial: "Rotisserie du Rhône — Lyon 7e", ville: "Lyon 7e", secteur: "Restauration", site: "rotisserie-du-rhone.fr", franchiseur: "Indépendant", modeLivraison: "Scooter électrique", activite: "Restauration traditionnelle",
    sources: ["INSEE", "Pappers"],
    contactsTrouves: [{ prenom: "Julien", nom: "Faure", role: "Gérant", email: "j.faure@rotisserie-du-rhone.fr", tel: "06 12 44 87 21" }] },
  { siren: "901234567", tel: "0437998877", telAffiche: "04 37 99 88 77", nom: "Le Kiosque à Burgers", nomCommercial: "Le Kiosque à Burgers — Lyon 9e", ville: "Lyon 9e", secteur: "Restauration", site: "kiosque-a-burgers.fr", franchiseur: "Burger King", modeLivraison: "Mixte", activite: "Restauration rapide",
    sources: ["INSEE", "Pappers", "Web"],
    contactsTrouves: [{ prenom: "Kevin", nom: "Dubois", role: "Responsable achats", email: "k.dubois@bieres-et-burgers.fr", tel: "06 77 34 12 98" }] },
  { siren: "753456789", tel: "0478442266", telAffiche: "04 78 44 22 66", nom: "Sushi Loop", nomCommercial: "Sushi Loop — Villeurbanne", ville: "Villeurbanne", secteur: "Restauration", site: "sushiloop.fr", franchiseur: "Indépendant", modeLivraison: "Scooter électrique", activite: "Livraison de repas",
    sources: ["INSEE", "Pappers"],
    contactsTrouves: [{ prenom: "Lina", nom: "Nguyen", role: "Gérante", email: "lina@sushiloop.fr", tel: "06 92 45 11 08" }] },
  { siren: "404567890", tel: "0472669911", telAffiche: "04 72 66 99 11", nom: "Fournil de Gerland", nomCommercial: "Fournil de Gerland — Lyon 7e", ville: "Lyon 7e", secteur: "Boulangerie", site: "fournil-gerland.fr", franchiseur: "Indépendant", modeLivraison: "Cargo bike", activite: "Boulangerie / Pâtisserie",
    sources: ["INSEE", "Pappers", "Web"],
    contactsTrouves: [{ prenom: "Marc", nom: "Martin", role: "Gérant", email: "marc@fournil-gerland.fr", tel: "06 23 76 90 12" }] },
  // Cas PIERRE PIRON : autre société du même gérant. S'il est déjà dans le CRM
  // (seed), la recherche ne recrée PAS un 2e contact : le panneau affiche
  // « déjà connu — sera rattaché » et l'enregistrement ajoute juste un lien
  // entreprise ↔ contact sur le contact EXISTANT. En production, le rôle
  // viendra de la qualité INSEE (Gérant, Président de SAS…), et chaque société
  // où il est dirigeant créera un lien — jamais un libellé inventé.
  { siren: "812345678", tel: "0472398877", telAffiche: "04 72 39 88 77", nom: "S.A.R.L DP Lyon 6", nomCommercial: "Domino's Pizza — Lyon 6e", ville: "Lyon 6e", secteur: "Restauration", site: "dominos.fr", franchiseur: "Domino's Pizza", modeLivraison: "Scooter électrique", activite: "Restauration rapide",
    sources: ["INSEE", "Pappers"],
    contactsTrouves: [{ prenom: "Pierre", nom: "Piron", role: "Gérant", email: "p.piron@dp-piron.fr", tel: "06 11 22 33 44" }] },
  // AUTRE société du même gérant (M. Piron), MÊME activité (NAF) → sera
  // suggérée à la création de n'importe laquelle de ses sociétés du même NAF.
  { siren: "823456783", tel: "0478661274", telAffiche: "04 78 66 12 74", nom: "S.A.R.L DP Lyon 7", nomCommercial: "Domino's Pizza — Lyon 7e", ville: "Lyon 7e", secteur: "Restauration", site: "dominos.fr", franchiseur: "Domino's Pizza", modeLivraison: "Scooter électrique", activite: "Restauration rapide",
    sources: ["INSEE", "Pappers"],
    contactsTrouves: [{ prenom: "Pierre", nom: "Piron", role: "Gérant", email: "p.piron@dp-piron.fr", tel: "06 11 22 33 44" }] },
  // Société de M. Piron avec un NAF DIFFÉRENT (holding) → ne doit JAMAIS être
  // suggérée lors d'une création de restaurant : le filtre « même code NAF »
  // l'exclut (règle anti-fausses-infos : pas d'assimilation hasardeuse).
  { siren: "834567890", tel: "0472335590", telAffiche: "04 72 33 55 90", nom: "PIRON INVEST", nomCommercial: "", ville: "Lyon 6e", secteur: "Finance", site: "", franchiseur: "", modeLivraison: "", activite: "Activités de holding",
    sources: ["INSEE"],
    contactsTrouves: [{ prenom: "Pierre", nom: "Piron", role: "Président", email: "p.piron@dp-piron.fr", tel: "06 11 22 33 44" }] },
  // ⚠️ VRAIE entreprise, COMPILATION MULTI-SOURCES du 14/10 : INSEE (NVL
  // ATLAS, SAS, 62 rue de Genève Gaillard, NAF restauration rapide) +
  // web/annuaires (enseigne « Atlas Halal » boucherie au même local,
  // téléphone 04 85 47 94 39 via Bottin.fr). Dirigeant INSEE : Hatam RACHED
  // (Président de SAS) — proposé à la création en contact. E-mail/téléphone
  // perso du dirigeant : inconnus → vides (jamais d'invention).
  { siren: "100515550", tel: "0485479439", telAffiche: "04 85 47 94 39", nom: "NVL ATLAS", nomCommercial: "Atlas Halal — Gaillard", ville: "Gaillard", secteur: "Boucherie", site: "", franchiseur: "", modeLivraison: "", activite: "Commerce de détail",
    sources: ["INSEE", "Annuaire web", "Google"],
    contactsTrouves: [{ prenom: "Hatam", nom: "RACHED", role: "Président de SAS", email: "", tel: "" }] },
];

/* ============================== MODALE ============================== */

// « Cible » = ce que la modale doit éditer. C'est le routeur du formulaire :
//  - id: null    → mode création (on part d'un modèle vide)
//  - id: valeur  → mode modification (on charge l'objet existant)
//  - preset     → pré-remplissage d'une association lors d'une création
//                 (ex. « + Contact » depuis une fiche entreprise pré-coche l'entreprise)
type Cible =
  | { type: "entreprise"; id: string | null; preset?: undefined }
  | { type: "contact"; id: string | null; preset?: string }
  | { type: "deal"; id: string | null; preset?: string };

// « FicheRef » = une page record à afficher (entreprise ou contact).
// Contrairement à Cible, l'id est obligatoire : une fiche modifie via la modale.
type FicheRef = { type: "entreprise" | "contact" | "deal"; id: string };

// « ContactSimple » = contact identifié par la recherche automatique (SIREN/téléphone).
// Format allégé : on ne crée pas encore un Contact complet, on propose juste
// les infos trouvées, l'utilisateur coche/décoche avant création.
type ContactSimple = { prenom: string; nom: string; role: string; email: string; tel: string };

// « SocieteSimple » = une AUTRE société du même dirigeant, suggérée à la
// création (ex. le 2e Domino's de M. Piron). Même principe que les contacts :
// une case à cocher pour accepter ou refuser chaque création.
type SocieteSimple = { nom: string; nomCommercial: string; ville: string; secteur: string; site: string; tel: string; franchiseur: string; modeLivraison: string; activite: string; dejaClient?: string; proprietaire?: string };

// Modèles vierges servant de point de départ en mode création.
const ENT_VIDE: Entreprise = { id: "", nom: "", nomCommercial: "", secteur: "", ville: "", site: "", tel: "", franchiseur: "", modeLivraison: "", activite: "", statut: "Suspect", notes: "", activites: [], pack: "", dateDebut: "", dateFin: "", nbVehicules: "", contratLocam: "", immatriculations: "", risque: "", modeles: [], contrats: [], siren: "", adresse: "", cp: "" };
const CTC_VIDE: Contact = { id: "", prenom: "", nom: "", role: "", email: "", tel: "", entrepriseIds: [] };
const DEAL_VIDE: Deal = { id: "", nom: "", entrepriseId: "", contactId: "", montant: 0, etape: "À qualifier", action: "", echeance: "", notes: "", fait: false };

// Formulaire générique pour les 3 types d'objets. Une seule modale, un rendu
// conditionnel par type (cible.type) : l'entreprise a son bloc, le contact le sien, etc.
function Modale({
  cible, etat, onClose, onSauver, onSupprimer, onOuvre, onOuvreFiche,
}: {
  cible: Cible;
  etat: Etat;
  onClose: () => void;
  onSauver: (c: Cible, donnees: Entreprise | Contact | Deal, contactsAuto?: ContactSimple[], societesAuto?: SocieteSimple[]) => void;
  onSupprimer: (c: Cible) => void;
  onOuvre: (c: Cible) => void;       // ouvre une AUTRE modale (édition d'un deal, création d'un contact…)
  onOuvreFiche: (f: FicheRef) => void; // navigue vers une page record (ferme la modale)
}) {
  // État local = copie de travail de l'objet en cours d'édition.
  // On ne charge l'objet correspondant au type de la cible ; les autres restent vides.
  // En création, `preset` pré-remplit l'association (entreprise du contact, entreprise du deal).
  const [ent, setEnt] = useState<Entreprise>(
    cible.type === "entreprise" ? (etat.entreprises.find((e) => e.id === cible.id) || ENT_VIDE) : ENT_VIDE
  );
  const [ctc, setCtc] = useState<Contact>(
    cible.type === "contact" ? (etat.contacts.find((c) => c.id === cible.id) || { ...CTC_VIDE, entrepriseIds: cible.preset ? [cible.preset] : [] }) : CTC_VIDE
  );
  const [deal, setDeal] = useState<Deal>(
    cible.type === "deal" ? (etat.deals.find((d) => d.id === cible.id) || { ...DEAL_VIDE, entrepriseId: cible.preset || "" }) : DEAL_VIDE
  );
  // ── Recherche automatique : SIREN ou NOM -> VRAIE API Recherche d’entreprises
  // (data.gouv, appelée depuis le navigateur, gratuite, sans clé, CORS ouvert).
  // Téléphone -> annuaire local pour l’instant (l’API Pappers branchera la
  // vraie recherche par téléphone plus tard). Règle anti-fausses-infos conservée :
  // les champs inconnus de la source restent VIDES, jamais d’invention.
  const [qRecherche, setQRecherche] = useState("");
  const [msgRecherche, setMsgRecherche] = useState<{ ok: boolean; texte: string } | null>(null);
  // Score de confiance /100 de la fiche compilée (affiché sous la barre de
  // recherche) + provenance des données (INSEE, Pappers, annuaires web…).
  const [scoreFiche, setScoreFiche] = useState<{ score: number; sources: string[] } | null>(null);
  // Contacts identifiés par la recherche (dirigeant INSEE, annuaires…) :
  // proposés à la création avec des cases À COCHER — cochés par défaut, on
  // peut décocher ceux qu'on ne veut pas créer avec l'entreprise.
  const [contactsProposes, setContactsProposes] = useState<(ContactSimple & { coche: boolean })[]>([]);
  // AUTRES sociétés du même dirigeant (même code NAF) suggérées à la création,
  // avec UNE case à cocher par société — DÉCOCHÉES par défaut : créer une
  // entreprise est plus engageant que rattacher un contact, on opte IN.
  const [societesProposees, setSocietesProposees] = useState<(SocieteSimple & { siren: string; sources: string[]; coche: boolean })[]>([]);
  // ── Applique une fiche trouvée (API gouv OU annuaire local) : pré-remplit le
  // formulaire, propose les contacts identifiés, calcule le score de confiance.
  const appliquer = (f: (typeof ANNUAIRE_DEMO)[number]) => {
    // Toutes les infos trouvées pré-remplissent le formulaire ; les champs
    // inconnus des sources RESTENT VIDES (jamais d'invention), et
    // l'utilisateur garde la main pour vérifier avant d'enregistrer.
    setEnt((e) => ({
      ...e,
      nom: f.nom, nomCommercial: f.nomCommercial, ville: f.ville, secteur: f.secteur, tel: f.telAffiche, site: f.site,
      franchiseur: f.franchiseur, modeLivraison: f.modeLivraison, activite: f.activite,
      siren: f.siren || "", adresse: (f as any).adresse || "", cp: (f as any).cp || "",
    }));
    // Contacts identifiés : proposés COCHÉS par défaut (on pourra décocher).
    setContactsProposes(f.contactsTrouves.map((ct) => ({ ...ct, coche: true })));
    // ── AUTRES SOCIÉTÉS DU MÊME DIRIGEANT ───────────────────────────────────
    // On cherche dans l'annuaire les sociétés qui ont UN DIRIGEANT EN COMMUN
    // (même personne : email / tél / prénom+nom) ET le MÊME code NAF (champ
    // `activite`) — c'est le critère demandé par Corentin : suggérer les autres
    // sociétés de M. Piron « avec le même code NAF par exemple ». Les sociétés
    // déjà en base ne sont pas re-proposées ; les suggestions sont DÉCOCHÉES
    // par défaut (acceptation explicite, case par case). En production, cette
    // liste viendra d'une recherche inversée par dirigeant (API Pappers).
    const dejaEnBase = (g: { nom: string; nomCommercial: string }) =>
      etat.entreprises.some((x) =>
        x.nom.trim().toLowerCase() === g.nom.trim().toLowerCase() ||
        (g.nomCommercial !== "" && x.nomCommercial.trim().toLowerCase() === g.nomCommercial.trim().toLowerCase()));
    const autres = ANNUAIRE_DEMO.filter((g) =>
      g !== f &&
      g.activite === f.activite && // même code NAF uniquement
      g.contactsTrouves.some((gc) => f.contactsTrouves.some((fc) => memePersonne(gc, fc)))
    ).filter((g) => !dejaEnBase(g));
    setSocietesProposees(autres.map((g) => ({ ...g, coche: false })));
    // Message explicite : on liste les champs réellement remplis et on rappelle
    // que les champs inconnus des sources restent vides (règle anti-fausses
    // infos) — pour éviter l'impression que « rien ne s'est rempli ».
    const remplis = [
      f.nom && "nom",
      f.nomCommercial && "nom commercial",
      f.ville && "ville",
      f.secteur && "secteur",
      f.telAffiche && "téléphone",
      f.site && "site web",
      f.franchiseur && "franchiseur",
      f.modeLivraison && "mode de livraison",
      f.activite && "activité",
    ].filter(Boolean) as string[];
    // ── SCORE DE CONFIANCE /100 ──────────────────────────────────────────────
    // Compilation de toutes les sources : chaque champ renseigné apporte des
    // points selon son poids pour une fiche exploitable (somme des poids = 100).
    // Plus les sources couvrent la fiche, plus le score monte — mais un champ
    // sans source fiable ne rapporte RIEN (règle anti-fausses infos), et tout
    // reste modifiable à la main avant enregistrement.
    const POIDS: [unknown, number][] = [
      [f.nom, 15], [f.nomCommercial, 10], [f.ville, 10], [f.secteur, 10],
      [f.telAffiche, 15], [f.site, 5], [f.franchiseur, 10],
      [f.modeLivraison, 10], [f.activite, 10], [f.contactsTrouves.length, 5],
    ];
    const score = POIDS.reduce((s, [v, p]) => s + (v ? p : 0), 0);
    setScoreFiche({ score, sources: f.sources });
    setMsgRecherche({
      ok: true,
      texte: `✨ ${f.nom} trouvé${f.ville ? ` (${f.ville})` : ""} — ${remplis.length} champ${remplis.length > 1 ? "s" : ""} rempli${remplis.length > 1 ? "s" : ""} : ${remplis.join(", ")}.`
        + (f.contactsTrouves.length
          ? ` 👤 ${f.contactsTrouves.length} contact${f.contactsTrouves.length > 1 ? "s" : ""} identifié${f.contactsTrouves.length > 1 ? "s" : ""} — création proposée ci-dessous (décochez si besoin).`
          : "")
        + (autres.length
          ? ` 🏢 ${autres.length} autre${autres.length > 1 ? "s" : ""} société${autres.length > 1 ? "s" : ""} du même dirigeant (même NAF) suggérée${autres.length > 1 ? "s" : ""} ci-dessous.`
          : "")
        + " Champs inconnus des sources : laissés vides (jamais d'invention).",
    });
  };
  // ── NAF (code) -> activité CRM, et section NAF -> secteur CRM. Mappings factuels
  // (libellés INSEE). Code inconnu -> champ laissé VIDE.
  const NAF_ACTIVITE: Record<string, string> = {
    "56.10A": "Restauration traditionnelle", "56.10B": "Restauration traditionnelle",
    "56.10C": "Restauration rapide", "56.10D": "Restauration traditionnelle",
    "56.21Z": "Restauration rapide", "10.71A": "Boulangerie / Pâtisserie",
    "10.71B": "Boulangerie / Pâtisserie", "10.71C": "Pâtisserie",
    "10.71D": "Boulangerie / Pâtisserie", "10.85Z": "Livraison de repas",
    "10.86Z": "Livraison de repas", "47.11A": "Commerce alimentaire",
    "47.11B": "Commerce alimentaire", "47.11C": "Commerce alimentaire",
    "47.11D": "Commerce alimentaire", "47.11E": "Commerce alimentaire",
    "47.11F": "Commerce alimentaire", "47.22Z": "Boucherie",
    "47.23Z": "Poissonnerie", "47.24Z": "Boulangerie / Pâtisserie",
    "53.20Z": "Livraison / messagerie", "49.41A": "Transport routier de fret",
    "49.41B": "Transport routier de fret",
  };
  const SECTION_SECTEUR: Record<string, string> = {
    A: "Agriculture", B: "Industrie", C: "Industrie", D: "Énergie", E: "Eau / déchets",
    F: "Construction", G: "Commerce", H: "Transport", I: "Restauration",
    J: "Information / communication", K: "Finance", L: "Immobilier",
    M: "Services", N: "Services", O: "Administration", P: "Enseignement",
    Q: "Santé", R: "Culture / loisirs", S: "Autres services", T: "Autres services", U: "Autres services",
  };
  const capitaliser = (s: string) =>
    s.toLowerCase().replace(/(^|[\s'’-])(.)/g, (m, a, b) => a + b.toUpperCase());
  // Convertit un résultat de l’API gouv en fiche compilée. Champs inconnus de
  // l’INSEE (téléphone, site, franchiseur, mode de livraison) : VIDES.
  // Dirigeants PERSONNES MORALES (ex. une holding comme ADAVEN, Président de SAS) :
  // une société ne peut pas être un contact — on va chercher SES propres
  // dirigeants personnes physiques (ex. Nicolas Bourbao, gérant d’ADAVEN). Le
  // rôle mentionne la société intermédiaire : info réelle INSEE, zéro invention.
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
    // Résolution des dirigeants personnes morales (1 niveau, max 2 sociétés).
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
          .map((d) => enContact(d, " · via " + String(mm.denomination || mm.siren)));
        contacts = contacts.concat(dm).slice(0, 3);
      } catch { /* réseau indisponible : on garde les personnes physiques déjà trouvées */ }
    }
    // ── Sociétés sœurs — TOUS les dirigeants identifiés ────────────────────────
    // On cherche les autres sociétés de CHAQUE dirigeant identifié : (1) les
    // personnes physiques (ex. les autres Domino’s de Chbihi) ; (2) le DIRIGEANT
    // PERSONNE MORALE lui-même (ex. ADAVEN) — ses sociétés sont celles où ADAVEN
    // est dirigeant : NB1, ONES 22, LANTREGOR (Domino’s Pizza), ARMORYC… Le cas
    // Bourbao/­ADAVEN/­NOUR BREIZH : les sociétés du gérant réel sont portées par la
    // holding, donc seule la recherche par personne morale les remonte.
    let societesSoeurs: SocieteSimple[] = [];
    // Un PANIER par dirigeant interrogé + déduplication globale par SIREN :
    // on entrelacera les paniers à la fin (cf. fusion ci-dessous).
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
          // ── Déjà client ? On signale les suggestions correspondant à une fiche
          // CLIENT existante (les clients réels du Sheet ont été importés dans la base).
          // Reconnaissance prudente, règle anti-invention : même enseigne ET même
          // ville que la fiche client (le nom légal peut différer) ; dans le doute,
          // pas de badge.
          const cli = etat.entreprises.find((e) => {
            if (e.statut !== "Client" || !enseigneX) return false;
            const ensFiche = (e.nomCommercial.split(" — ")[0] || e.nomCommercial).trim();
            const vA = norme(e.ville), vB = norme(vx);
            return norme(ensFiche) === norme(enseigneX) && vA !== "" &&
              (vA === vB || (vA.length >= 4 && vB.length >= 4 && (vA.startsWith(vB) || vB.startsWith(vA))));
          });
          // ── Le Sheet « Infos Service Client » est interrogé EN DIRECT : si la
          // société sœur y figure, elle est cliente → badge vert à la création.
          const sh = trouverClientSheet(clientsSheet, String(sx.nom_complet || ""), enseigneX, vx);
          panier.push({
            siren: String(sx.siren || ""),
            dejaClient: cli ? cli.nomCommercial : (sh ? sh.nom : ""),
            proprietaire: norme(proprio),
            nom: String(sx.nom_complet || ""),
            nomCommercial: enseigneX && vx ? enseigneX + " — " + vx : enseigneX,
            ville: vx,
            secteur: SECTION_SECTEUR[String(sx.section_activite_principale || "")] || "",
            site: "", tel: "", franchiseur: franchiseurDepuis(enseigneX), modeLivraison: "",
            activite: NAF_ACTIVITE[String(sx.activite_principale || "")] || "",
            sources: ["INSEE · API Recherche d’entreprises"],
          });
          vus.add(String(sx.siren));
        }
        paniers.push(panier);
      } catch { /* réseau indisponible : on garde ce qui est déjà collecté */ }
    };
    // (1) personnes physiques identifiées (max 2, sinon trop d’appels)
    for (const c of contacts.slice(0, 2)) {
      await ajouterSoeurs(c.prenom + " " + c.nom, true, c.prenom + " " + c.nom);
    }
    // (2) dirigeants personnes morales (les holdings — ex. ADAVEN : max 1)
    for (const mm of morales.slice(0, 1)) {
      await ajouterSoeurs(String(mm.denomination || ""), false, String(mm.denomination || mm.siren));
    }
    // ── Fusion des paniers EN ENTRERELAÇANT les dirigeants : sans ça, un gros
    // portefeuille (ex. les 8 Domino’s de Chbihi) remplit la limite et cache
    // complètement les autres (ex. ceux de Bourbao, portés par la holding
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
        adresse: String(siege.adresse || ""), cp: String(siege.code_postal || ""),
        nom: String(r.nom_complet || r.nom_raison_sociale || ""),
        nomCommercial: enseigne && ville ? enseigne + " — " + ville : enseigne,
        ville,
        secteur: SECTION_SECTEUR[String(r.section_activite_principale || "")] || "",
        site: "", franchiseur: franchiseurDepuis(enseigne), modeLivraison: "",
        activite: NAF_ACTIVITE[naf] || "",
        sources: ["INSEE · API Recherche d’entreprises"],
        contactsTrouves: contacts,
      },
      soeurs: societesSoeurs,
    };
  };
  const rienTrouve = () => {
    setMsgRecherche({ ok: false, texte: "Aucune entreprise trouvée pour « " + qRecherche + " » — remplissez la fiche manuellement." });
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
  // ── Recherche réelle : SIREN (9 chiffres) ou nom (≥ 3 caractères) ->
  // API Recherche d’entreprises. Téléphone -> annuaire local. Repli sur
  // l’annuaire local en cas d’échec ou de résultat vide.
  // Repli annuaire local : consulter le Sheet AUSSI ici (le chemin API gouv
  // le fait déjà) — sinon un client du Sheet créé via l'annuaire arrive sans
  // contrats ni modèles.
  const remplirDepuisSheet = (f: { nom: string; nomCommercial: string; ville: string }) => {
    chargerClientsSheet().then(({ clients }) => {
      const cliS = trouverClientSheet(clients, f.nom, (f.nomCommercial.split(" — ")[0] || f.nomCommercial), f.ville);
      if (cliS) {
        const fr = franchiseurDepuis(f.nomCommercial.split(" — ")[0] || "") || franchiseurDepuis(cliS.nom) || "Indépendant";
        setEnt((e) => ({ ...e, statut: "Client" as Statut, modeLivraison: "U'mob", franchiseur: fr, pack: cliS.packs, modeles: cliS.modeles, contrats: cliS.lignes.map((l: ContratLigne) => ({ ...l, num: "" })), dateDebut: cliS.dateDebut, dateFin: cliS.dateFin, nbVehicules: cliS.nbVehicules, contratLocam: "", immatriculations: cliS.immats, risque: cliS.risque, notes: "Client selon le Sheet « Infos Service Client » (" + cliS.code + " · " + cliS.nom + ") — contrat pré-rempli depuis le Sheet, à vérifier avant enregistrement." }));
        // Contacts du Sheet : mêmes règles que le chemin API gouv (fusion avec
        // les contacts déjà proposés, complétion tel/email, ajout sinon).
        if (cliS.contacts.length > 0) {
          setContactsProposes((prev) => {
            const fusion = [...prev];
            for (const sc of cliS.contacts) {
              const mem = fusion.find((p) => norme(p.prenom) === norme(sc.prenom) && norme(p.nom) === norme(sc.nom));
              if (mem) {
                if (!mem.tel && sc.tel) mem.tel = sc.tel;
                if (!mem.email && sc.email) mem.email = sc.email;
                if (!mem.role && sc.role) mem.role = sc.role;
              } else {
                fusion.push({ prenom: sc.prenom, nom: sc.nom, role: sc.role || "Contact (Sheet)", email: sc.email, tel: sc.tel, coche: true });
              }
            }
            return fusion;
          });
        }
      }
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
    setMsgRecherche({ ok: true, texte: "🔎 Recherche en cours…" });
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
        // ── Sheet en direct : si la société cherchée est CLIENTE, on coche
        // « Client » et on pré-remplit les champs contrat & flotte depuis le
        // Sheet (données réelles de la source officielle — rien d’inventé,
        // l’utilisateur vérifie avant d’enregistrer ; sans match, tout reste vide).
        const cliS = trouverClientSheet(clientsSheet, fiche.nom, (fiche.nomCommercial.split(" — ")[0] || fiche.nomCommercial), fiche.ville);
        if (cliS) {
          // Client du Sheet : mode de livraison « U'mob » (c'est la flotte louée)
          // et franchiseur détecté depuis l'enseigne (marque connue) — sinon
          // « Indépendant ». Règle anti-invention : la marque vient de l'enseigne
          // INSEE/Sheet, et « Indépendant » = absence de marque connue.
          const fr = franchiseurDepuis(fiche.nomCommercial.split(" — ")[0] || "") || franchiseurDepuis(cliS.nom) || "Indépendant";
          setEnt((e) => ({ ...e, statut: "Client" as Statut, modeLivraison: "U'mob", franchiseur: fr, pack: cliS.packs, modeles: cliS.modeles, contrats: cliS.lignes.map((l: ContratLigne) => ({ ...l, num: "" })), dateDebut: cliS.dateDebut, dateFin: cliS.dateFin, nbVehicules: cliS.nbVehicules, contratLocam: "", immatriculations: cliS.immats, risque: cliS.risque, notes: "Client selon le Sheet « Infos Service Client » (" + cliS.code + " · " + cliS.nom + ") — contrat pré-rempli depuis le Sheet, à vérifier avant enregistrement." }));
          // ── Contacts du Sheet : prénom/nom/fonction/mobile/email du client
          // reconnu. On fusionne avec les dirigeants INSEE déjà proposés : si
          // un dirigeant INSEE correspond (prénom+nom), on COMPLÈTE son tel et
          // son email avec les valeurs du Sheet ; les interlocuteurs du Sheet
          // inconnus d'INSEE sont ajoutés cochés (source : Sheet, info réelle).
          if (cliS.contacts.length > 0) {
            setContactsProposes((prev) => {
              const fusion = [...prev];
              for (const sc of cliS.contacts) {
                const meme = fusion.find((p) => norme(p.prenom) === norme(sc.prenom) && norme(p.nom) === norme(sc.nom));
                if (meme) {
                  if (!meme.tel && sc.tel) meme.tel = sc.tel;
                  if (!meme.email && sc.email) meme.email = sc.email;
                  if (!meme.role && sc.role) meme.role = sc.role;
                } else {
                  fusion.push({ prenom: sc.prenom, nom: sc.nom, role: sc.role || "Contact (Sheet)", email: sc.email, tel: sc.tel, coche: true });
                }
              }
              return fusion;
            });
          }
        }
        // Sheet illisible : partage retiré ou Google bloque l’accès anonyme.
        // On le DIT au lieu de laisser croire qu’aucune société n’est cliente.
        if (!sheetOk) setMsgRecherche((m) => m ? { ...m, texte: m.texte + " ⚠️ Sheet « Infos Service Client » illisible — badges « Déjà client » et contrat auto indisponibles — vérifier le partage « lien »." } : m);
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
        setMsgRecherche({ ok: false, texte: "⚠️ Recherche en ligne indisponible (erreur réseau) et absente de l’annuaire local — remplissez la fiche manuellement." });
      }
    }
  };
  const nouveau = !cible.id; // pas d'id = on est en train de CRÉER l'objet
  const titre =
    cible.type === "entreprise" ? (nouveau ? "Nouvelle entreprise" : ent.nom)
    : cible.type === "contact" ? (nouveau ? "Nouveau contact" : `${ctc.prenom} ${ctc.nom}`)
    : (nouveau ? "Nouveau deal" : deal.nom);

  // Sélecteurs d'associations pour le bloc entreprise (et pour filtrer les
  // contacts disponibles dans le formulaire deal : on ne propose que les
  // contacts de l'entreprise choisie).
  const contactsEntreprise = (eid: string) => etat.contacts.filter((c) => c.entrepriseIds.includes(eid));
  const dealsEntreprise = (eid: string) => etat.deals.filter((d) => d.entrepriseId === eid);

  return (
    // Fond assombri : cliquer DESSUS ferme la modale (clic hors du formulaire).
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      {...fermerAuClicFond(onClose)}
    >
      {/* stopPropagation : un clic à l'intérieur du panneau ne doit PAS fermer. */}
      <motion.div
        initial={{ scale: 0.94, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-black text-slate-800">{titre}</h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-[13px] font-semibold text-slate-400 hover:bg-slate-100">✕</button>
        </div>

        {/* -------- BLOC ENTREPRISE : champs + associations (visible uniquement pour cible.type === "entreprise") -------- */}
        {cible.type === "entreprise" && (
          <>
            {/* Barre de recherche auto : SIREN ou téléphone fixe → pré-remplit
                toute la fiche. Démo hors-ligne (annuaire local) ; en production :
                API data.gouv pour le SIREN + API Pappers pour le téléphone. */}
            <div className="mt-4 rounded-xl border border-cyan-100 bg-cyan-50/70 p-3">
              <div className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-cyan-700">🔎 Recherche automatique — SIREN, téléphone ou nom</div>
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
              {/* Score de confiance de la fiche compilée : vert ≥ 75, orange
                  40-74, rouge < 40. Chaque donnée reste modifiable à la main. */}
              {scoreFiche && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 shadow-sm">
                  <span className="text-[11.5px] font-black"
                    style={{ color: scoreFiche.score >= 75 ? "#16a34a" : scoreFiche.score >= 40 ? "#f59e0b" : "#ef4444" }}>
                    🛡️ Score de confiance : {scoreFiche.score}/100
                  </span>
                  <span className="text-[10px] font-semibold text-slate-400">
                    Sources compilées : {scoreFiche.sources.join(" + ")}
                  </span>
                  <span className="ml-auto text-[10px] font-bold text-slate-500">
                    ✓ Champs auto-remplis modifiables
                  </span>
                </div>
              )}
              <div className="mt-1 text-[10px] text-slate-400">Démo hors-ligne — en production : API Recherche d'entreprises (data.gouv) pour le SIREN, Pappers pour le téléphone.</div>

              {/* Panneau « Contacts identifiés » : chaque contact trouvé par la recherche auto
                  est proposé à la création, coché par défaut. L'utilisateur peut décocher
                  ceux qu'il ne veut PAS créer (règle forte : rien n'est imposé). */}
              {nouveau && contactsProposes.length > 0 && (
                <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-black text-emerald-800">
                      👥 Contacts identifiés ({contactsProposes.filter((x) => x.coche).length}/{contactsProposes.length} seront créés ou rattachés)
                    </span>
                    {/* Tout cocher / tout décocher en un clic. */}
                    <button
                      onClick={() => {
                        const toutCoche = contactsProposes.every((x) => x.coche);
                        const apres = contactsProposes.map((x) => ({ ...x, coche: !toutCoche }));
                        setContactsProposes(apres);
                        const cles = apres.filter((x) => x.coche).flatMap(clesContact);
                        setSocietesProposees((prev) => prev.filter((g) => !g.proprietaire || cles.includes(g.proprietaire)));
                      }}
                      className="text-[11px] font-bold text-emerald-700 underline hover:text-emerald-900">
                      {contactsProposes.every((x) => x.coche) ? "Tout décocher" : "Tout cocher"}
                    </button>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {contactsProposes.map((ct, i) => {
                      // Anti-doublons en direct : si la personne est déjà dans
                      // le CRM (même email / tél / prénom+nom), on ne crée PAS un
                      // 2e contact — on RATTACHE juste la nouvelle entreprise.
                      const existant = etat.contacts.find((x) => memePersonne(ct, x));
                      return (
                      /* Une ligne = une case à cocher + nom/role + coordonnées visibles. */
                      <label key={i} className="flex cursor-pointer items-start gap-2 rounded-lg bg-white px-2.5 py-2 hover:bg-emerald-50">
                        <input
                          type="checkbox"
                          checked={ct.coche}
                          onChange={() => {
                          const apres = contactsProposes.map((x, j) => (j === i ? { ...x, coche: !x.coche } : x));
                          setContactsProposes(apres);
                          // Décocher un dirigeant retire AUSSI ses sociétés suggérées
                          // (les siennes + celles collectées via sa holding).
                          const cles = apres.filter((x) => x.coche).flatMap(clesContact);
                          setSocietesProposees((prev) => prev.filter((g) => !g.proprietaire || cles.includes(g.proprietaire)));
                        }}
                          className="mt-0.5 h-4 w-4 accent-emerald-600" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12px] font-bold text-slate-800">
                            {ct.prenom} {ct.nom}
                            {ct.role && <span className="ml-1.5 font-medium text-slate-500">— {ct.role}</span>}
                          </span>
                          {(ct.email || ct.tel) && (
                            <span className="block text-[11px] text-slate-500">
                              {[ct.email, ct.tel].filter(Boolean).join(" · ")}
                            </span>
                          )}
                          {existant ? (
                            <span className="mt-0.5 block text-[10.5px] font-bold text-cyan-700">
                              🔗 déjà dans ton CRM ({existant.entrepriseIds.length} entreprise{existant.entrepriseIds.length > 1 ? "s" : ""}) — sera rattaché, pas de doublon créé
                            </span>
                          ) : (
                            <span className="mt-0.5 block text-[10.5px] font-bold text-emerald-600">✨ nouveau contact — sera créé</span>
                          )}
                        </span>
                      </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Panneau « Autres sociétés du même dirigeant » : le réseau
                  d'affaires du dirigeant identifié (recherche inversée par
                  dirigeant en production). UNE case PAR société, DÉCOCHÉE par
                  défaut — on accepte explicitement chaque création ; les
                  sociétés cochées seront créées avec le dirigeant rattaché. */}
              {nouveau && societesProposees.length > 0 && (
                <div className="mt-3 rounded-xl border border-cyan-200 bg-cyan-50/60 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-black text-cyan-800">
                      🏢 Autres sociétés de {contactsProposes[0]?.prenom} {contactsProposes[0]?.nom} — même NAF ({societesProposees.filter((x) => x.coche).length}/{societesProposees.length} cochée{Math.min(societesProposees.filter((x) => x.coche).length, 1) ? "s" : ""} → créées)
                    </span>
                    <button
                      onClick={() => {
                        const toutCoche = societesProposees.every((x) => x.coche);
                        setSocietesProposees(societesProposees.map((x) => ({ ...x, coche: !toutCoche })));
                      }}
                      className="text-[11px] font-bold text-cyan-700 underline hover:text-cyan-900">
                      {societesProposees.every((x) => x.coche) ? "Tout décocher" : "Tout cocher"}
                    </button>
                  </div>
                  <div className="mt-1 text-[10px] text-cyan-600">
                    Décochées par défaut : coche uniquement celles que tu veux ajouter au CRM maintenant. Le dirigeant sera rattaché à chacune. Les suggestions marquées « Déjà client » existent déjà en base (clients du Sheet « Infos Service Client », interrogé en direct) — inutile de les recréer. Décocher un dirigeant ci-dessus retire aussi ses sociétés de cette liste.
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
                            {g.ville && <span className="ml-1.5 font-medium text-slate-500">— {g.ville}</span>}
                            {g.dejaClient && <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black text-emerald-700">Déjà client : {g.dejaClient}</span>}
                          </span>
                          {(g.nomCommercial || g.activite || g.tel) && (
                            <span className="block text-[11px] text-slate-500">
                              {[g.nomCommercial, g.activite, g.tel].filter(Boolean).join(" · ")}
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
              {/* Nom commercial = enseigne trouvée via API + ville à la fin
                  (ex. « Domino's Pizza — Nanterre »). Si l'API n'a rien trouvé
                  d'officiel, on laisse VIDE plutôt que d'inventer (règle
                  anti-fausses-informations). */}
              <div className="col-span-2"><label className={label}>Nom commercial <span className="font-normal normal-case text-slate-400">(enseigne + ville, ex. Domino's Pizza — Nanterre)</span></label>
                <input className={champ} value={ent.nomCommercial} onChange={(e) => setEnt({ ...ent, nomCommercial: e.target.value })} placeholder="ex. Domino's Pizza — Nanterre" /></div>
              {/* SIREN + adresse du siège : permanents, remplis par la recherche SIREN ou à la main (jamais d'invention). */}
              <div><label className={label}>SIREN</label>
                <input className={champ} value={ent.siren ?? ""} onChange={(e) => setEnt({ ...ent, siren: e.target.value })} placeholder="123 456 789" /></div>
              <div><label className={label}>Code postal</label>
                <input className={champ} value={ent.cp ?? ""} onChange={(e) => setEnt({ ...ent, cp: e.target.value })} placeholder="69003" /></div>
              <div className="col-span-2"><label className={label}>Adresse postale</label>
                <input className={champ} value={ent.adresse ?? ""} onChange={(e) => setEnt({ ...ent, adresse: e.target.value })} placeholder="12 rue de la Paix" /></div>
              {/* Statut du cycle de vie (Suspect / Prospect / Client) : c'est
                  l'équipe commerciale qui le fait évoluer — jamais auto. */}
              <div><label className={label}>Statut</label>
                <ChampSelect valeur={ent.statut} options={[...STATUTS]} onChange={(v) => setEnt({ ...ent, statut: v as Statut })} /></div>
              <div><label className={label}>Secteur</label>
                <input className={champ} value={ent.secteur} onChange={(e) => setEnt({ ...ent, secteur: e.target.value })} placeholder="ex. Restauration" /></div>
              <div><label className={label}>Ville</label>
                <input className={champ} value={ent.ville} onChange={(e) => setEnt({ ...ent, ville: e.target.value })} /></div>
              <div><label className={label}>Site web</label>
                <input className={champ} value={ent.site} onChange={(e) => setEnt({ ...ent, site: e.target.value })} /></div>
              <div><label className={label}>Téléphone</label>
                <input className={champ} value={ent.tel} onChange={(e) => setEnt({ ...ent, tel: e.target.value })} /></div>
              {/* Nouveaux champs normalisés en menus déroulants : aujourd'hui
                  choisis à la main, à terme remplis automatiquement par l'IA
                  (analyse des conversations / recherche internet sur
                  l'entreprise) — d'où des options figées plutôt que du texte
                  libre : l'IA n'aura qu'à sélectionner la bonne valeur. */}
              <div><label className={label}>Franchiseur</label>
                <ChampSelect valeur={ent.franchiseur} options={OPTIONS_FRANCHISEUR} onChange={(v) => setEnt({ ...ent, franchiseur: v })} /></div>
              <div><label className={label}>Mode de livraison</label>
                <ChampSelect valeur={ent.modeLivraison} options={OPTIONS_MODE_LIVRAISON} onChange={(v) => setEnt({ ...ent, modeLivraison: v })} /></div>
              <div><label className={label}>Activité</label>
                <ChampSelect valeur={ent.activite} options={OPTIONS_ACTIVITE} onChange={(v) => setEnt({ ...ent, activite: v })} /></div>
              {/* ── Contrat & flotte : renseignés pour les clients (source :
                  Sheet « Infos Service Client »). Éditables
                  à la main, comme tous les champs du CRM. ── */}
              <div className="col-span-2 mt-1 rounded-lg bg-slate-50 px-2 py-1.5 text-[11px] font-black uppercase tracking-wider text-slate-400">Modèles de scooter (U'mob)</div>
              <div className="col-span-2"><label className={label}>Modèle(s) loué(s) par ce client</label>
                <div className="flex flex-wrap gap-1.5">
                  {MODELES_SCOOTER.map((m) => {
                    const on = (ent.modeles || []).includes(m);
                    return (
                      <button key={m} type="button" onClick={() => setEnt((x) => ({ ...x, modeles: on ? (x.modeles || []).filter((y) => y !== m) : [...(x.modeles || []), m] }))}
                        className={"rounded-lg px-2.5 py-1.5 text-[12px] font-bold transition " + (on ? "bg-emerald-500 text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200")}>
                        {on ? "✓ " : ""}{m}
                      </button>
                    );
                  })}
                  {(ent.modeles || []).filter((m) => !MODELES_SCOOTER.includes(m)).map((m) => (
                    <button key={m} type="button" onClick={() => setEnt((x) => ({ ...x, modeles: (x.modeles || []).filter((y) => y !== m) }))}
                      className="rounded-lg bg-emerald-500 px-2.5 py-1.5 text-[12px] font-bold text-white shadow-sm">✓ {m}</button>
                  ))}
                </div>
                <div className="mt-1 text-[10.5px] text-slate-400">Pré-cochés automatiquement si le client figure dans le Sheet « Infos Service Client » (colonne Libellé Produit) — sinon sélection manuelle.</div>
              </div>
              <div className="col-span-2 mt-1 rounded-lg bg-slate-50 px-2 py-1.5 text-[11px] font-black uppercase tracking-wider text-slate-400">Contrat & flotte — un bloc par contrat</div>
              {(ent.contrats || []).map((k, i) => (
                <div key={i} className="col-span-2 rounded-xl border border-slate-200 bg-slate-50/60 p-2">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[11px] font-black text-slate-500">Contrat {i + 1}{k.etat ? " · " + k.etat : ""}</span>
                    <button type="button" onClick={() => setEnt((x) => ({ ...x, contrats: (x.contrats || []).filter((_, j) => j !== i) }))}
                      className="text-[11px] font-bold text-red-400 hover:underline">✕ Retirer</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className={label}>Pack</label>
                      <input className={champ} value={affPack(k.pack)} onChange={(e) => setEnt((x) => ({ ...x, contrats: (x.contrats || []).map((k2, j) => j === i ? { ...k2, pack: e.target.value } : k2) }))} placeholder="ex. Confort 48+" /></div>
                    <div><label className={label}>Début</label>
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
                {/* Risque : champ texte LIBRE avec suggestions (datalist) — le
                    SAV peut écrire des statuts non standard (ex. « Mauvais
                    payeur »), qu'un menu fermé empêchait de saisir. */}
                <input className={champ} value={normRisque(ent.risque)} list="options-risque" onChange={(e) => setEnt({ ...ent, risque: e.target.value })} placeholder="ex. Impayé, Mauvais payeur…" />
                <datalist id="options-risque">{OPTIONS_RISQUE.map((o) => <option key={o} value={o} />)}</datalist></div>
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
                {/* Cliquer un contact ouvre sa PAGE RECORD (pas son édition). */}
                {contactsEntreprise(ent.id).map((c) => (
                  <button key={c.id} onClick={() => onOuvreFiche({ type: "contact", id: c.id })}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left hover:bg-white">
                    <span className="text-[12px] font-semibold text-slate-700">{c.prenom} {c.nom} <span className="text-slate-400">· {c.role}</span></span>
                    <span className="text-[10px] font-bold text-cyan-600">›</span>
                  </button>
                ))}
                <div className="mb-1.5 mt-3 text-[11px] font-black uppercase tracking-wider text-slate-400">Deals ({dealsEntreprise(ent.id).length})</div>
                {/* Chaque deal ouvre sa page record (la modale se ferme). */}
                {dealsEntreprise(ent.id).map((d) => (
                  <button key={d.id} onClick={() => onOuvreFiche({ type: "deal", id: d.id })}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left hover:bg-white">
                    <span className="text-[12px] font-semibold text-slate-700">{d.nom}</span>
                    <span className="flex items-center gap-2">
                      <Badge texte={d.etape} couleur={couleurEtape(d.etape)} />
                      <span className="text-[11px] font-black text-slate-600">{d.montant} k€</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="mt-5 flex items-center gap-2">
              {/* Fallback "Sans nom" pour ne jamais créer d'entreprise sans titre.
                  En création, on transmet aussi les contacts cochés ET les
                  autres sociétés du dirigeant cochées (3e et 4e arguments). */}
              <button onClick={() => onSauver(cible, { ...ent, ...fusionnerContrats(ent.contrats), nom: ent.nom.trim() || "Sans nom" },
                nouveau ? contactsProposes.filter((x) => x.coche) : undefined,
                nouveau ? societesProposees.filter((x) => x.coche) : undefined)}
                className="flex-1 rounded-xl py-2.5 text-[13px] font-black text-white" style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>
                {nouveau ? "Créer l'entreprise" : "Enregistrer"}
              </button>
              {/* Le bouton Supprimer n'existe qu'en modification (pas en création). */}
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
              <div><label className={label}>Prénom *</label>
                <input className={champ} value={ctc.prenom} onChange={(e) => setCtc({ ...ctc, prenom: e.target.value })} /></div>
              <div><label className={label}>Nom *</label>
                <input className={champ} value={ctc.nom} onChange={(e) => setCtc({ ...ctc, nom: e.target.value })} /></div>
              <div><label className={label}>Rôle</label>
                <input className={champ} value={ctc.role} onChange={(e) => setCtc({ ...ctc, role: e.target.value })} placeholder="ex. Gérant" /></div>
              {/* L'association entreprise est MULTI-comptes (ex. Pierre Piron,
                  gérant de 15 Domino's = 1 contact, 15 cases cochées) :
                  chaque case = un rattachement indépendant. */}
              <div className="col-span-2"><label className={label}>Entreprises liées</label>
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
              <div><label className={label}>Téléphone</label>
                <input className={champ} value={ctc.tel} onChange={(e) => setCtc({ ...ctc, tel: e.target.value })} /></div>
            </div>
            {/* Liens croisés vers les pages record de CHAQUE entreprise liée. */}
            {ctc.entrepriseIds.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
                {ctc.entrepriseIds.map((eid) => (
                  <button key={eid} onClick={() => onOuvreFiche({ type: "entreprise", id: eid })}
                    className="text-[11px] font-bold text-cyan-600 hover:underline">
                    → {etat.entreprises.find((x) => x.id === eid)?.nom}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-5 flex items-center gap-2">
              <button onClick={() => onSauver(cible, { ...ctc, prenom: ctc.prenom.trim() || "?", nom: ctc.nom.trim() || "?", entrepriseIds: ctc.entrepriseIds })}
                className="flex-1 rounded-xl py-2.5 text-[13px] font-black text-white" style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>
                {nouveau ? "Créer le contact" : "Enregistrer"}
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
                <input className={champ} value={deal.nom} onChange={(e) => setDeal({ ...deal, nom: e.target.value })} placeholder="ex. Contrat annuel — flotte 3 scooters" /></div>
              {/* Si on change d'entreprise, on réinitialise le contact : un contact
                  de l'ancienne entreprise ne peut pas rester rattaché au deal. */}
              <div><label className={label}>Entreprise</label>
                <select className={champ + " bg-white"} value={deal.entrepriseId}
                  onChange={(e) => setDeal({ ...deal, entrepriseId: e.target.value, contactId: "" })}>
                  <option value="">— Choisir —</option>
                  {etat.entreprises.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}
                </select></div>
              {/* Le menu ne propose QUE les contacts de l'entreprise sélectionnée. */}
              <div><label className={label}>Contact</label>
                <select className={champ + " bg-white"} value={deal.contactId} onChange={(e) => setDeal({ ...deal, contactId: e.target.value })}>
                  <option value="">— Choisir —</option>
                  {contactsEntreprise(deal.entrepriseId).map((x) => <option key={x.id} value={x.id}>{x.prenom} {x.nom}</option>)}
                </select></div>
              <div><label className={label}>Montant (k€)</label>
                <input type="number" className={champ} value={deal.montant} onChange={(e) => setDeal({ ...deal, montant: Number(e.target.value) })} /></div>
              <div><label className={label}>Étape</label>
                <select className={champ + " bg-white"} value={deal.etape} onChange={(e) => setDeal({ ...deal, etape: e.target.value as Etape })}>
                  {ETAPES.map((x) => <option key={x.nom} value={x.nom}>{x.nom}</option>)}
                </select></div>
              <div><label className={label}>Prochaine action</label>
                <input className={champ} value={deal.action} onChange={(e) => setDeal({ ...deal, action: e.target.value })} /></div>
              <div><label className={label}>Échéance</label>
                <input className={champ} value={deal.echeance} onChange={(e) => setDeal({ ...deal, echeance: e.target.value })} placeholder="ex. 15/10" /></div>
              <div className="col-span-2"><label className={label}>Notes</label>
                <textarea rows={2} className={champ + " resize-none"} value={deal.notes} onChange={(e) => setDeal({ ...deal, notes: e.target.value })} /></div>
            </div>
            {/* Historique compact du deal : les 5 dernières activités de
                l'entreprise liées à ce deal (lien `dealId`), plus récentes d'abord. */}
            {!nouveau && (() => {
              const hist = (etat.entreprises.find((x) => x.id === deal.entrepriseId)?.activites || [])
                .filter((a) => a.dealId === deal.id).slice(-5).reverse();
              return hist.length > 0 ? (
                <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  <div className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-slate-400">Historique</div>
                  {hist.map((a, i) => (
                    <div key={i} className="text-[11px] text-slate-500">
                      <span className="font-bold text-slate-600">{(a.dateISO || a.date) + ((a.heure || (/^\d{1,2}:\d{2}$/.test(a.date || "") ? a.date : "")) ? " · " + (a.heure || (/^\d{1,2}:\d{2}$/.test(a.date || "") ? a.date : "")) : "")}</span> — {a.texte}
                    </div>
                  ))}
                </div>
              ) : null;
            })()}
            <div className="mt-5 flex items-center gap-2">
              <button onClick={() => onSauver(cible, { ...deal, nom: deal.nom.trim() || "Deal sans nom" })}
                className="flex-1 rounded-xl py-2.5 text-[13px] font-black text-white" style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>
                {nouveau ? "Créer le deal" : "Enregistrer"}
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

/* ============================== FICHES (pages record façon HubSpot) ============================== */

// Carte blanche générique des pages record : titre, action optionnelle en haut
// à droite (bouton « + Ajouter » des cartes d'association), et contenu.
function CarteFiche({ titre, action, children }: { titre: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">{titre}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

// Une ligne « propriété » façon HubSpot : libellé à gauche, valeur à droite.
// La valeur vide ("") s'affiche comme un tiret. `label` est renommé `libelle`
// en paramètre pour ne pas écraser la constante `label` définie plus haut.
function Prop({ label: libelle, valeur }: { label: string; valeur: string }) {
  return (
    /* Propriété empilée façon HubSpot : petit libellé au-dessus, valeur en
       dessous — bien plus lisible qu'un libellé/valeur sur la même ligne
       quand les colonnes sont étroites. break-words (et non break-all)
       pour couper uniquement sur les espaces. */
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{libelle}</div>
      <div className="break-words text-[13px] font-semibold text-slate-800">{valeur || "—"}</div>
    </div>
  );
}

/* Style commun des champs « sur place » : discret par défaut (bordure
   transparente), survol léger, cyan au focus — le panneau reste aussi lisible
   qu'avant, mais chaque champ devient un vrai input sans ouvrir la modale. */
const styleChampInline = "w-full rounded-lg border border-transparent bg-transparent px-1 py-0.5 -mx-1 text-[13px] font-semibold text-slate-800 outline-none transition-colors hover:border-slate-200 hover:bg-slate-50 focus:border-cyan-500 focus:bg-white";

/* Propriété texte éditable « sur place » (inline), comme le panneau À propos
   de HubSpot : on clique dans la valeur et on tape directement. La valeur
   remonte au parent à chaque frappe (patch du champ modifié uniquement). */
function PropTexte({ label: libelle, valeur, onChange }: { label: string; valeur: string; onChange: (v: string) => void }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{libelle}</div>
      <input className={styleChampInline} value={valeur} onChange={(e) => onChange(e.target.value)} placeholder="—" />
    </div>
  );
}

/* Idem en MENU DÉROULANT pour les champs normalisés (Franchiseur, Mode de
   livraison, Activité) : le petit chevron ▾ signale que la valeur se change
   sur place ; l'option « — » sert de valeur vide. */
function PropSelect({ label: libelle, valeur, options, onChange }: { label: string; valeur: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{libelle}</div>
      <div className="relative">
        <select className={styleChampInline + " cursor-pointer appearance-none truncate pr-5"} value={valeur} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        {/* Chevron décoratif (le select natif a son rendu retiré via
            appearance-none) : pointer-events-none pour laisser le clic passer. */}
        <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[9px] text-slate-400">▾</span>
      </div>
    </div>
  );
}

/* ---- « Résumé de la fiche » façon IA (comme Breeze dans HubSpot) ----
   Le canvas tourne entièrement dans le navigateur, sans accès à un modèle de
   langage : la synthèse ci-dessous est donc CALCULÉE LOCALEMENT à partir de la
   timeline (dernière activité reformulée, prochaine action en attente,
   sentiment estimé par mots-clés). Dans la version déployée, ce même emplacement
   sera branché sur l'API Mistral pour une vraie génération de texte. */
/* Résumé IA v3 : synthèse locale enrichie — appels analysés (webhook Ringover),
   sentiment, score moyen, recommandations — complétée à l OUVERTURE de la fiche
   par un vrai résumé Mistral via l endpoint serverless /api/resume (production).
   Règle anti-invention inchangée : le moteur local ne fait que compter et citer
   les données de la fiche, JAMAIS deviner. */
type EvResume = { date: string; texte: string; type?: TypeActivite; dateISO?: string; heure?: string; resumeIA?: string; sentiment?: string; scoreIA?: number; sujets?: string; transcription?: string };
function genererResumeIA(nom: string, events: EvResume[], prochaine?: { nom: string; action: string; echeance: string } | null, faits?: string[]) {
  const derniere = events[0];
  // ── Appels analysés par l IA (webhook Ringover) : resumeIA / sentiment /
  // scoreIA / sujets viennent TELS QUELS des activités d appel analysées. ──
  const appels = events.filter((x) => x.type === "appel" && !!(x.resumeIA || x.sentiment || x.scoreIA || x.transcription));
  const dernierAppel = appels[0];
  const sentiments = appels.map((x) => x.sentiment || "").filter(Boolean);
  const nPos = sentiments.filter((s) => s === "positif").length;
  const nNeg = sentiments.filter((s) => s === "négatif").length;
  const sentimentDominant = nPos > nNeg ? "positif" : nNeg > nPos ? "négatif" : "neutre";
  const scores = appels.map((x) => x.scoreIA).filter((x): x is number => typeof x === "number");
  const scoreMoyen = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;
  // Sentiment global : priorité au sentiment IA des appels analysés (le plus
  // récent l emporte), sinon estimation locale par mots-clés (repli).
  let sentiment = "neutre";
  let couleurSentiment = "#94a3b8";
  const sentIA = appels.find((x) => x.sentiment === "positif" || x.sentiment === "négatif");
  if (sentIA) { sentiment = sentIA.sentiment as string; couleurSentiment = sentiment === "positif" ? "#57c26b" : "#ef4444"; }
  else {
    const corpus = events.slice(0, 5).map((x) => x.texte).join(" ").toLowerCase();
    if (/(satisfait|content|ravi|parfait|super|enthousiaste|intéressé|interessé|validé|valide|impatient)/.test(corpus)) { sentiment = "positif"; couleurSentiment = "#57c26b"; }
    if (/(mécontent|mecontent|déçu|decu|problème|probleme|panne|trop cher|refus|refuse|annulé|annule|retard|inquiet)/.test(corpus)) { sentiment = "négatif"; couleurSentiment = "#ef4444"; }
  }
  // ── Profil « À propos » de la fiche : les faits de PROPRIÉTÉS (statut, ville,
  //   secteur, franchiseur, risque, modèles, contrats, flotte, contacts) —
  //   pas les faits d'activité, déjà cités par la narrative ci-dessous.
  const cleProfil = [" a le statut «", " est situé à ", "Secteur :", "Activité :", "Franchiseur :", "⚠️ Risque signalé", " loue les modèles", "Mode de livraison :", " contrats.", " contrat.", " exploite ", "Les contacts de "];
  const profil = (faits || []).filter((f) => cleProfil.some((c) => f.includes(c))).slice(0, 10);
  // ── Paragraphe narratif : profil (À propos + contrats + flotte + contacts),
  //     puis dernière activité, appels analysés, action en attente. ──
  // ── Résumé rédigé en langage NATUREL : les faits « À propos » ne sont PAS
  //     collés bout à bout — on les REDÉCOUPE en une vraie phrase de
  //     présentation (« X est un prospect indépendant du commerce floral,
  //     basé à Lyon »), puis viennent les phrases d'actualité (dernier
  //     échange, appels analysés, pipeline). Jamais d'invention : chaque
  //     mot vient d'un FAIT de la fiche. ──
  const val = (f: string | undefined, apres: string): string => {
    if (!f) return "";
    const i = f.indexOf(apres);
    return i >= 0 ? f.slice(i + apres.length).replace(/\.\s*$/, "") : "";
  };
  const pStatut = profil.find((f) => f.includes(" a le statut «"));
  const statut = pStatut ? (pStatut.match(/« ([^»]*) »/) || [])[1] || "" : "";
  const ville = val(profil.find((f) => f.includes(" est situé à ")), " est situé à ");
  const secteur = val(profil.find((f) => f.startsWith("Secteur :")), "Secteur :");
  const franchiseur = val(profil.find((f) => f.startsWith("Franchiseur :")), "Franchiseur :");
  const livraison = val(profil.find((f) => f.startsWith("Mode de livraison :")), "Mode de livraison :");
  const modeles = val(profil.find((f) => f.includes(" loue les modèles")), " loue les modèles de scooter ");
  const contacts = val(profil.find((f) => f.startsWith("Les contacts de ")), " sont : ");
  const risqueTxt = val(profil.find((f) => f.startsWith("⚠️")), "⚠️ Risque signalé : ");
  // Les faits de CONTRATS (déjà rédigés en prose : « Le contrat CO… se termine
  // le … ») sont gardés tels quels, après la phrase de présentation.
  const faitsContrats = profil.filter((f) => f.startsWith("Le contrat") || f.startsWith("Contrat ") || f.startsWith("Numéros de contrat") || f.startsWith("La période totale") || f.startsWith("Immatriculations"));
  const morceaux: string[] = [];
  // Phrase de présentation : qui est ce compte, en une phrase fluide.
  if (statut || ville || secteur) {
    morceaux.push(
      nom + " est " + (statut === "Client" ? "un client" : statut === "Prospect" ? "un prospect" : statut === "Suspect" ? "un suspect à qualifier" : "un compte")
        + (franchiseur && franchiseur !== "Indépendant" ? " du réseau " + franchiseur : franchiseur === "Indépendant" ? " indépendant" : "")
        + (secteur ? " — " + secteur.toLowerCase() : "")
        + (ville ? " — basé à " + ville : "") + "."
    );
  }
  if (livraison) morceaux.push("Pour ses livraisons, il compte sur le " + livraison.toLowerCase() + ".");
  if (modeles) morceaux.push("Côté flotte, il loue des scooters " + modeles + ".");
  if (contacts) morceaux.push(contacts.includes(", ") ? "Les personnes à connaître chez " + nom + " : " + contacts + "." : contacts + " est la personne à connaître chez " + nom + ".");
  if (risqueTxt) morceaux.push("⚠️ Point de vigilance : " + risqueTxt.toLowerCase() + " — à voir avec le SAV.");
  morceaux.push(...faitsContrats);
  if (derniere) {
    const h = derniere.heure || (/^[0-9]{1,2}:[0-9]{2}$/.test(derniere.date || "") ? derniere.date : "");
    morceaux.push("Dernier échange le " + (derniere.dateISO || derniere.date) + (h ? " à " + h : "") + " (" + META_ACT[derniere.type || "note"].libelle.toLowerCase() + ") : « " + derniere.texte.slice(0, 160) + (derniere.texte.length > 160 ? "…" : "") + " »");
  }
  if (appels.length) {
    morceaux.push(appels.length === 1
      ? "L'IA a analysé un appel avec ce compte" + (dernierAppel && dernierAppel.resumeIA ? ", le dernier en date indique : « " + dernierAppel.resumeIA.slice(0, 140) + (dernierAppel.resumeIA.length > 140 ? "…" : "") + " »" : "")
      : "L'IA a analysé " + appels.length + " appels avec ce compte" + (dernierAppel && dernierAppel.resumeIA ? ", le dernier en date indique : « " + dernierAppel.resumeIA.slice(0, 140) + (dernierAppel.resumeIA.length > 140 ? "…" : "") + " »" : ""));
  }
  if (prochaine && prochaine.action) {
    morceaux.push("Côté pipeline, la prochaine étape est « " + prochaine.action + " »" + (prochaine.echeance ? " prévue le " + prochaine.echeance : "") + (prochaine.nom ? " sur le deal « " + prochaine.nom + " »" : ""));
  }
  const texte = morceaux.length
    ? morceaux.filter(Boolean).map((s) => s.replace(/\.\s*$/, "")).join(". ").replace(/\s+/g, " ") + "."
    : "Rien à raconter pour l'instant : cette fiche est toute neuve. Consigne une note ou un appel, et le résumé s'écrira tout seul !";
  // ── Recommandations locales : reformulations de FAITS de la fiche, jamais d invention. ──
  const recommandations: string[] = [];
  if (prochaine && prochaine.action) recommandations.push("Prochaine action prévue : " + prochaine.action + (prochaine.echeance ? " (le " + prochaine.echeance + ")" : "") + (prochaine.nom ? " — deal « " + prochaine.nom + " »" : "") + ".");
  if (dernierAppel && dernierAppel.sentiment === "négatif") recommandations.push("Sentiment négatif au dernier appel : rappeler pour lever l'objection avant de faire avancer le deal.");
  if (dernierAppel && dernierAppel.sentiment === "positif") recommandations.push("Dernier appel bien perçu" + (scoreMoyen ? " (score moyen " + scoreMoyen + "/5)" : "") + " : capitaliser sur cette dynamique pour proposer la prochaine étape.");
  const risque = (faits || []).find((f) => f.indexOf("⚠️") === 0);
  if (risque) recommandations.push(risque + " Coordonner avec le SAV avant toute relance commerciale.");
  if (!prochaine || !prochaine.action) recommandations.push("Aucune action de suivi définie : fixer la prochaine étape (appel, devis ou visite).");
  return { texte, sentiment, couleurSentiment, sources: events.length, nbAppels: appels.length, sentimentDominant, scoreMoyen, dernierAppel, recommandations };
}

/* ---- « Posez une question » façon Breeze HubSpot : l'utilisateur interroge
   la fiche en langage naturel. Le canvas n'a pas accès à un modèle de langage :
   la réponse est donc une RECHERCHE PAR PERTINENCE calculée localement sur les
   FAITS de la fiche (propriétés, contrats, contacts, deals, activités). On
   normalise la question, on retire les mots vides, on score le recouvrement de
   mots-clés. Sans correspondance, on le DIT honnêtement (jamais d'invention).
   En prod, ce même emplacement sera branché sur l'API Mistral avec ce contexte. */
const MOTS_VIDES = new Set(["le", "la", "les", "un", "une", "des", "de", "du", "et", "ou", "est", "sont", "que", "qui", "quoi", "quand", "quel", "quelle", "quels", "quelles", "combien", "dans", "sur", "pour", "avec", "sans", "ce", "cet", "cette", "ces", "son", "sa", "ses", "au", "aux", "en", "il", "elle", "on", "nous", "vous", "je", "tu", "se", "par", "plus", "tout", "tous", "peut", "fais", "fait", "chez"]);
const motsUtiles = (s: string): string[] =>
  s.split(/[\s,;:!?.']+|[’]/).map((m) => norme(m)).filter((m) => m.length > 2 && !MOTS_VIDES.has(m));
const repondreLocalement = (question: string, faits: string[]): { reponse: string; trouve: boolean } => {
  const mots = motsUtiles(question);
  if (!mots.length) return { reponse: "Pose ta question pour que je cherche dans la fiche.", trouve: false };
  const poids = (m: string) => 1 / Math.log2(2 + faits.filter((f) => norme(f).includes(m)).length);
  const scores = faits.map((_, i) => {
    const gagnes = mots.filter((m) => norme(faits[i]).includes(m));
    return gagnes.reduce((s, m) => s + poids(m), 0) + gagnes.length * 0.001;
  });
  const iMeilleur = scores.indexOf(Math.max(...scores));
  if (scores[iMeilleur] === 0) return { reponse: "Je n'ai rien trouvé sur ce sujet dans cette fiche — les données du CRM restent la source de vérité.", trouve: false };
  return { reponse: faits[iMeilleur], trouve: true };
};

/* Carte « Résumé de la fiche » v3 : synthèse locale enrichie (narrative, appels
   analysés Ringover, sentiment, recommandations), GÉNÉRÉE AUTOMATIQUEMENT à
   l ouverture de la fiche puis complétée par Mistral via l endpoint serverless
   /api/resume en production. Le canvas n expose pas cet endpoint : le fetch
   échoue silencieusement et le moteur local reste affiché. */
function ResumeIA({ nom, events, prochaine, faits, suggestions }: {
  nom: string; events: EvResume[];
  prochaine?: { nom: string; action: string; echeance: string } | null;
  faits: string[]; suggestions?: string[];
}) {
  const r = genererResumeIA(nom, events, prochaine, faits);
  const [q, setQ] = useState("");
  // Conversation complète façon chat : chaque question ET réponse reste à
  // l'écran (bulles user à droite, réponses IA à gauche) tant que la fiche
  // est ouverte — plus de réponse unique remplacée à chaque question.
  const [messages, setMessages] = useState<{ id: number; de: "moi" | "ia"; texte: string; locale?: boolean }[]>([{ id: 0, de: "ia", texte: "Salut 👋 Je connais cette fiche par cœur — pose-moi ta question : contrats, contacts, appels, pipeline…", locale: true }]);
  const [ia, setIa] = useState<{ resume: string; recommandations: string[]; sentiment?: string } | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [cleIA, setCleIA] = useState(0); // « ✨ Régénérer » relance la génération Mistral
  const generee = new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" });
  // Contexte des appels analysés envoyé à l IA (en production) : résumés,
  // sentiments, scores et transcriptions tronquées — les VRAIS faits de la fiche.
  const contexteAppels = events
    .filter((x) => x.type === "appel" && !!(x.resumeIA || x.transcription))
    .slice(0, 5)
    .map((x) => "Appel du " + (x.dateISO || x.date) + (x.heure ? " à " + x.heure : "") + (x.sentiment ? ", sentiment " + x.sentiment : "") + (x.scoreIA ? ", score " + x.scoreIA + "/5" : "") + (x.resumeIA ? " — résumé : " + x.resumeIA : "") + (x.transcription ? " — transcription : " + x.transcription.slice(0, 1500) : ""));
  // Historique des 10 dernières activités de la fiche (tout type confondu) :
  // l IA reçoit la fiche ENTIÈRE — À propos (faits), appels analysés ET timeline.
  const contexteActivites = events.slice(0, 10)
    .map((x) => "Le " + (x.dateISO || x.date) + (x.heure ? " à " + x.heure : "") + " — " + (x.type || "note") + " : " + x.texte);
  const questionIA = async (question?: string) => {
    setEnCours(true);
    try {
      const reponse = await fetch("/api/resume", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: question ? "question" : "resume", nom, faits: faits.filter(Boolean), appels: contexteAppels, activites: contexteActivites, historique: messages.slice(-6).map((m) => (m.de === "moi" ? "Utilisateur : " : "IA : ") + m.texte), question: question || null }) });
      if (!reponse.ok) return null;
      const d = await reponse.json();
      if (question) return { question: true, reponse: String(d.reponse || "") };
      return { question: false, resume: String(d.resume || ""), recommandations: Array.isArray(d.recommandations) ? d.recommandations.map((x: unknown) => String(x)) : [], sentiment: d.sentiment ? String(d.sentiment) : undefined };
    } catch { return null; /* endpoint absent (canvas) ou réseau : moteur local, aucune panne */ }
    finally { setEnCours(false); }
  };
  // GÉNÉRATION AUTOMATIQUE à l ouverture de la fiche : le résumé local
  // s affiche instantanément, puis la version Mistral (production) complète
  // les sections. Rejouable via le bouton « ✨ Régénérer ».
  useEffect(() => {
    let vivant = true;
    (async () => {
      const d = await questionIA();
      if (vivant && d && !d.question && d.resume) setIa({ resume: d.resume, recommandations: d.recommandations, sentiment: d.sentiment });
    })();
    return () => { vivant = false; };
  }, [nom, cleIA]);
  const poser = (question: string) => {
    const qPosee = question.trim();
    if (!qPosee) return;
    setQ("");
    // La question part dans la conversation, et une bulle réponse LOCALE
    // (calculée instantanément sur les faits) s'affiche immédiatement.
    const idReponse = Date.now();
    const locale = repondreLocalement(qPosee, faits);
    setMessages((m) => [...m, { id: idReponse + 1, de: "moi", texte: qPosee }, { id: idReponse, de: "ia", texte: locale.reponse, locale: true }]);
    // La réponse Mistral (production) remplace la bulle locale dès qu'elle
    // arrive — même id, contenu enrichi, la conversation reste lisible.
    (async () => {
      const d = await questionIA(qPosee);
      if (d && d.question && d.reponse) setMessages((m) => m.map((x) => (x.id === idReponse ? { ...x, texte: d.reponse, locale: false } : x)));
    })();
  };
  const texteResume = ia && ia.resume ? ia.resume : r.texte;
  const recos = ia && ia.recommandations.length > 0 ? ia.recommandations : r.recommandations;
  const couleurSentiment = ia && ia.sentiment === "positif" ? "#57c26b" : ia && ia.sentiment === "négatif" ? "#ef4444" : r.couleurSentiment;
  return (
    <CarteFiche titre="Résumé de la fiche"
      action={<span className="flex items-center gap-1">
        <span className="rounded-full px-2 py-0.5 text-[9.5px] font-black text-white"
          style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>✨ IA</span>
        {ia && <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[9.5px] font-black text-white">Mistral AI</span>}
      </span>}>
      <div className="mb-1.5 flex items-center gap-2 text-[10px] text-slate-400">
        <span>Généré le {generee} · {r.sources} source{r.sources > 1 ? "s" : ""}</span>
        <button type="button" onClick={() => { setIa(null); setCleIA((x) => x + 1); }}
          className="font-black text-cyan-600 hover:underline" title="Relancer la génération du résumé par l IA">✨ Régénérer</button>
        {enCours && <span>· génération IA…</span>}
      </div>
      <p className="text-[12.5px] leading-relaxed text-slate-600">{texteResume}</p>
      {/* Ligne sentiment : priorité au sentiment renvoyé par l IA. */}
      <div className="mt-2 flex items-center gap-1.5 rounded-xl bg-slate-50 px-2 py-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: couleurSentiment }} />
        <span className="text-[11px] font-bold text-slate-500">Sentiment : <span style={{ color: couleurSentiment }}>{ia && ia.sentiment ? ia.sentiment : r.sentiment}</span></span>
      </div>
      {/* Appels analysés par l IA (webhook Ringover) : nombre, sentiment dominant,
          score moyen, résumé du dernier appel. */}
      {r.nbAppels > 0 && (
        <div className="mt-2 rounded-xl border border-emerald-100 bg-emerald-50/60 px-2.5 py-2">
          <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] font-bold">
            <span>📞 {r.nbAppels} appel{r.nbAppels > 1 ? "s" : ""} analysé{r.nbAppels > 1 ? "s" : ""}</span>
            <span className={"rounded-full px-2 py-0.5 " + (r.sentimentDominant === "positif" ? "bg-emerald-100 text-emerald-700" : r.sentimentDominant === "négatif" ? "bg-rose-100 text-rose-700" : "bg-slate-200 text-slate-600")}>Sentiment global : {r.sentimentDominant}</span>
            {r.scoreMoyen > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">Score moyen : {r.scoreMoyen}/5</span>}
          </div>
          {r.dernierAppel && r.dernierAppel.resumeIA && <div className="mt-1 text-[11.5px] leading-relaxed text-slate-700">Dernier appel : {r.dernierAppel.resumeIA}</div>
          }
          {r.dernierAppel && r.dernierAppel.sujets && <div className="mt-0.5 text-[11px] text-slate-500">Sujets / signaux : {r.dernierAppel.sujets}</div>
          }
        </div>
      )}
      {/* Recommandations : issues de l IA (production) ou du moteur local. */}
      {recos.length > 0 && (
        <div className="mt-2">
          <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-slate-400">✅ À faire &amp; recommandations</div>
          <ul className="ml-1 list-disc space-y-0.5 pl-3 text-[11.5px] leading-relaxed text-slate-600 marker:text-slate-300">
            {recos.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        </div>
      )}
      {/* Fenêtre de conversation « Breeze » : en-tête avec avatar + nom + statut,
          fil de bulles scrollable (user à droite, IA à gauche), champ arrondi
          avec bouton d'envoi intégré. La réponse locale s'affiche immédiatement,
          la réponse Mistral la remplace en production. */}
      <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2"
          style={{ background: "linear-gradient(135deg,#f0fdf4,#f0f9ff)" }}>
          <span className="flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-black text-white shadow"
            style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>✨</span>
          <div className="min-w-0 flex-1">
            <div className="text-[11.5px] font-black text-slate-700">Assistant de la fiche</div>
            <div className="flex items-center gap-1 text-[9.5px] font-semibold text-slate-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {ia ? "Connecté à Mistral AI · voit toute la fiche" : "Voit toute la fiche · réponses locales"}
            </div>
          </div>
          {messages.length > 1 && (
            <button type="button" onClick={() => setMessages([{ id: 0, de: "ia", texte: "Salut 👋 Je connais cette fiche par cœur — pose-moi ta question : contrats, contacts, appels, pipeline…", locale: true }])}
              className="shrink-0 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[9.5px] font-black text-slate-400 hover:text-slate-600">↺ Effacer</button>
          )}
        </div>
        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto bg-slate-50/50 px-3 py-3">
          {messages.map((m) => m.de === "moi" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md px-3 py-1.5 text-[12px] leading-relaxed text-white shadow-sm"
                style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>{m.texte}</div>
            </div>
          ) : (
            <div key={m.id} className="flex items-start justify-start gap-1.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[9px] shadow-sm"
                style={{ color: "#4f9ee8" }}>✨</span>
              <div className={"max-w-[85%] rounded-2xl rounded-bl-md px-3 py-1.5 text-[12px] leading-relaxed shadow-sm " + (m.locale && m.texte.indexOf("Je n'ai rien trouvé") === 0 ? "bg-amber-50 text-amber-700" : "bg-white text-slate-700")}>{m.texte}</div>
            </div>
          ))}
        </div>
        {(suggestions || []).length > 0 && messages.filter((m) => m.de === "moi").length < 2 && (
          <div className="flex flex-wrap gap-1 border-t border-slate-100 bg-white px-3 pt-2">
            {(suggestions || []).map((s) => (
              <button key={s} type="button" onClick={() => poser(s)}
                className="rounded-full border border-slate-200 px-2 py-0.5 text-[10.5px] font-bold text-slate-500 hover:border-cyan-300 hover:text-cyan-600">{s}</button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1.5 bg-white px-2.5 py-2">
          <input value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") poser(q); }}
            placeholder="Pose ta question sur cette fiche…"
            className="min-w-0 flex-1 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-[12px] outline-none focus:border-cyan-400" />
          <button type="button" onClick={() => poser(q)} disabled={!q.trim()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] text-white disabled:opacity-40"
            style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }} title="Envoyer">➤</button>
        </div>
        <div className="bg-white px-3 pb-2 text-[9px] text-slate-300">{ia ? "Conversation Mistral AI — l'IA voit toute la fiche et vos échanges précédents." : "Réponses calculées à partir de la fiche — conversation enrichie par Mistral AI en production."}</div>
      </div>
    </CarteFiche>
  );
}

// Transforme une date affichée en nombre triable : on utilise la date de
// réalisation réelle (dateISO, jj/mm/aaaa) quand elle existe, sinon le libellé
// court historique (« auj. » en tête, sinon jour du mois parsé).
const valDate = (s: string, iso?: string) => {
  // ── Tri robuste : dateISO est parfois au format ISO (YYYY-MM-DD) et non
  //    jj/mm/aaaa — sans ça, les activités récentes tombaient en BAS de la
  //    timeline. On normalise tout en AAAAMMJJ comparable : ISO, jj/mm/aaaa
  //    (année optionnelle), « auj. » = date du jour. ──
  const jma = (j: number, m: number, a: number) => j + m * 100 + a * 10000;
  const isoM = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(iso || "");
  if (isoM) return jma(Number(isoM[3]), Number(isoM[2]), Number(isoM[1]));
  const p = (iso || "").split("/").map(Number);
  if (p.length === 3 && p.every((n) => !isNaN(n)) && p[2] > 31) return jma(p[0], p[1], p[2]);
  const sM = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/.exec((s || "").trim());
  if (sM) {
    const aBrut = sM[3] ? Number(sM[3].length === 2 ? "20" + sM[3] : sM[3]) : new Date().getFullYear();
    return jma(Number(sM[1]), Number(sM[2]), aBrut);
  }
  if ((s || "").trim() === "auj.") { const d = new Date(); return jma(d.getDate(), d.getMonth() + 1, d.getFullYear()); }
  return parseInt(s, 10) || 0;
};
// Tri « plus récent en haut » : date (AAAAMMJJ) décroissante, puis départage
// par l'heure (hh:mm, comparaison lexicale suffisante) pour les activités
// du MÊME jour — sans ça, elles restaient dans l'ordre de création.
const triRecentes = (a: Activite, b: Activite) =>
  valDate(b.date, b.dateISO) - valDate(a.date, a.dateISO) ||
  (b.heure || "").localeCompare(a.heure || "");

// Timeline d'activités des fiches. Chaque event peut être :
//  - une activité de la fiche elle-même (note, appel… sans deal rattaché)
//  - une activité d'un deal associé (porte une référence `deal` → lien cliquable)
function Chronologie({ events, onOuvre, contacts, deals, onSupprimer, onMaj, onOuvrirTache }: { events: (Activite & { deal?: Deal })[]; onOuvre: (c: Cible) => void; contacts?: Contact[]; deals?: Deal[]; onSupprimer?: (ev: Activite & { deal?: Deal }) => void; onMaj?: (ev: Activite & { deal?: Deal }, patch: Partial<Activite>) => void; onOuvrirTache?: (ev: Activite & { deal?: Deal }) => void }) {
  if (events.length === 0) {
    return (
      <div className="text-[12px] text-slate-400">
        Aucune activité pour le moment. Utilise les boutons ci-dessus pour consigner une note, un e-mail, un appel, une tâche ou une réunion.
      </div>
    );
  }
  // ── Régénération manuelle du résumé IA d'un appel (bouton « ✨↻ Régénérer ») :
  // la transcription est envoyée à /api/regenerer-resume (Mistral) et
  // l'activité est mise à jour en place via onMaj — la sauvegarde
  // habituelle de l'état persiste le nouveau résumé dans Supabase.
  const [regenResume, setRegenResume] = useState<{ i: number; enCours: boolean; erreur: string }>({ i: -1, enCours: false, erreur: "" });
  const regenererResumeIA = async (ev: Activite, i: number) => {
    if (!ev.transcription || regenResume.enCours) return;
    setRegenResume({ i, enCours: true, erreur: "" });
    try {
      const r = await fetch("/api/regenerer-resume", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcription: ev.transcription }) });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j || !j.ok) { setRegenResume({ i, enCours: false, erreur: (j && j.erreur) || "erreur " + r.status }); return; }
      const patch: any = {};
      if (j.resumeIA) patch.resumeIA = String(j.resumeIA);
      if (j.sentiment) patch.sentiment = String(j.sentiment);
      if (j.sujets) patch.sujets = String(j.sujets);
      if (typeof j.scoreIA === "number") patch.scoreIA = j.scoreIA;
      if (j.scorecard) patch.scorecard = j.scorecard;
      if (Object.keys(patch).length) onMaj?.(ev, patch);
      setRegenResume({ i: -1, enCours: false, erreur: "" });
    } catch (e: any) { setRegenResume({ i, enCours: false, erreur: String((e && e.message) || e || "erreur réseau") }); }
  };
  return (
    <div className="divide-y divide-slate-50">
      {events.map((ev, i) => {
        // Rétro-compatibilité : les anciennes activités (pré-typage) n'ont pas de
        // `type` → note par défaut.
        const typeEff: TypeActivite = ev.type ?? "note";
        const meta = META_ACT[typeEff]; // icône/couleur/libellé du type
        // Résolution des liens de l'activité : contact lié et/ou deal lié.
        const ct = ev.contactId ? (contacts || []).find((x) => x.id === ev.contactId) : null;
        const dd = ev.dealId ? (deals || []).find((x) => x.id === ev.dealId) : null;
        return (
          <div key={i} className="group/act flex items-start gap-3 py-2.5">
            {/* Poubelle : suppression de l'activité en cas d'erreur (visible au
                survol de la ligne, confirmation demandée). Rendue uniquement si
                le parent fournit un handler (fiche entreprise). */}
            {/* Pastille de l'icône : couleur du type à ~9% d'opacité (suffixe "18"). */}
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px]"
              style={{ background: `${meta.couleur}18` }}>{meta.icone}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-black uppercase tracking-wider" style={{ color: meta.couleur }}>{meta.libelle}</div>
              {/* Badge « À faire / Réalisée » des tâches & réunions : cliquable
                  quand le parent fournit onMaj (clôturer / rouvrir en place). */}
              {(onMaj || onOuvrirTache) && (ev.type === "tache" || ev.type === "reunion") && (ev.fait ? (
                <button onClick={() => onOuvrirTache ? onOuvrirTache(ev) : onMaj?.(ev, { fait: false, clotureLe: undefined })}
                  title="Tâche clôturée — cliquer pour la rouvrir"
                  className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700 hover:bg-emerald-200">
                  ✓ Réalisée{ev.clotureLe ? " le " + ev.clotureLe : ""} · rouvrir
                </button>
              ) : (
                <button onClick={() => onOuvrirTache ? onOuvrirTache(ev) : onMaj?.(ev, { fait: true, clotureLe: dateParis() })}
                  title="Marquer cette tâche comme réalisée"
                  className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-black text-violet-700 hover:bg-violet-200">
                  ○ À faire · cliquer pour clôturer
                </button>
              ))}
              <div className={"text-[12.5px] leading-relaxed " + (ev.fait ? "text-slate-400 line-through" : "text-slate-700")}>{ev.texte}</div>
              {(ev.type === "appel" && !!(ev.resumeIA || ev.transcription || ev.sentiment)) && (
                <div className="mt-1.5 rounded-lg border border-emerald-100 bg-emerald-50/60 px-2.5 py-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] font-bold">
                    {!!ev.sentiment && (
                      <span className={"rounded-full px-2 py-0.5 " + (ev.sentiment === "positif" ? "bg-emerald-100 text-emerald-700" : ev.sentiment === "négatif" ? "bg-rose-100 text-rose-700" : "bg-slate-200 text-slate-600")}>{"Sentiment : " + ev.sentiment}</span>
                    )}
                    {!!ev.scoreIA && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">{"Score appel : " + ev.scoreIA + "/5"}</span>
                    )}
                    <span className="text-slate-400">✨ analyse IA de l'appel Ringover</span>
                    {!!ev.transcription && onMaj && (
                      <button onClick={() => regenererResumeIA(ev, i)}
                        disabled={regenResume.enCours}
                        title="Relance l'analyse IA sur la transcription (résumé, sentiment, score, sujets)"
                        className="rounded-full bg-cyan-100 px-2 py-0.5 text-cyan-700 hover:bg-cyan-200 disabled:opacity-50">
                        {(regenResume.enCours && regenResume.i === i) ? "⏳ Analyse…" : "✨↻ Régénérer"}
                      </button>
                    )}
                  </div>
                  {(regenResume.i === i && !!regenResume.erreur) && (
                    <div className="mt-1 text-[10.5px] font-semibold text-rose-600">{"⚠️ " + regenResume.erreur}</div>
                  )}
                  {!!ev.resumeIA && <div className="mt-1 text-[12px] leading-relaxed text-slate-700">{ev.resumeIA}</div>}
                  {!!ev.sujets && <div className="mt-1 text-[11px] text-slate-500">{"Sujets / signaux : " + ev.sujets}</div>}
                  {!!ev.scorecard && (
                    <div className="mt-1.5 rounded-lg bg-white/80 px-2 py-1.5">
                      <div className="text-[9.5px] font-bold uppercase tracking-wider text-cyan-800 mb-1">📋 Scorecard Plan de vente U'mob (0 à 2 par critère)</div>
                      <div className="space-y-0.5">
                        {CRITERES_SCORECARD.map(([k, l]) => {
                          const c = ev.scorecard?.[k];
                          const n = typeof c?.note === "number" ? c.note : 0;
                          return (
                            <div key={k} className="flex items-start gap-1.5 text-[10.5px]">
                              <span className={"shrink-0 rounded px-1 py-0.5 font-bold " + (n === 2 ? "bg-emerald-100 text-emerald-700" : n === 1 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700")}>{n}/2</span>
                              <span className="text-slate-600">{l}{c && c.j ? <span className="text-slate-400"> — {c.j}</span> : null}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {!!ev.transcription && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[11px] font-semibold text-cyan-600">📄 Transcription de l'appel</summary>
                      <div className="mt-1 whitespace-pre-wrap text-[11.5px] leading-relaxed text-slate-600">{ev.transcription}</div>
                    </details>
                  )}
                  {!!ev.urlEnregistrement && (
                    <a href={ev.urlEnregistrement} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[11px] font-semibold text-cyan-600 hover:underline">▶️ Écouter l'enregistrement</a>
                  )}
                </div>
              )}
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                <span className="font-bold">{(ev.dateISO || ev.date) + ((ev.heure || (/^\d{1,2}:\d{2}$/.test(ev.date || "") ? ev.date : "")) ? " · " + (ev.heure || (/^\d{1,2}:\d{2}$/.test(ev.date || "") ? ev.date : "")) : "")}</span>
                {/* Badge d'échéance pour les tâches et réunions planifiées. */}
                {ev.echeance && <Badge texte={`échéance ${ev.echeance}`} couleur={meta.couleur} />}
                {/* Lien vers le contact rattaché à l'activité (ouvre la modale). */}
                {ct && (
                  <button onClick={() => onOuvre({ type: "contact", id: ct.id })}
                    className="truncate font-semibold text-cyan-600 hover:underline">👤 {ct.prenom} {ct.nom}</button>
                )}
                {/* Lien vers le deal rattaché à l'activité (ouvre la modale deal). */}
                {(dd || ev.deal) && (
                  <button onClick={() => onOuvre({ type: "deal", id: (dd || ev.deal!).id })}
                    className="truncate font-semibold text-cyan-600 hover:underline">{(dd || ev.deal!).nom}</button>
                )}
              </div>
            </div>
            {onSupprimer && (
              <button
                onClick={() => { if (window.confirm(`Supprimer cette activité ?\n\n« ${(ev.texte || "").slice(0, 80)}${(ev.texte || "").length > 80 ? "…" : ""} »`)) onSupprimer(ev); }}
                title="Supprimer cette activité"
                className="shrink-0 self-center rounded-lg px-1.5 py-1 text-[12px] text-slate-300 opacity-0 transition-colors hover:bg-red-50 hover:text-red-500 group-hover/act:opacity-100"
              >🗑️</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Les 5 types d'activités saisissables à la main (l'« étape » est exclue :
// elle est générée automatiquement par les mouvements de pipeline).
const TYPES_COMPOSER: { type: "note" | "email" | "appel" | "tache" | "reunion"; icone: string; libelle: string }[] = [
  { type: "note", icone: "📝", libelle: "Note" },
  { type: "email", icone: "✉️", libelle: "E-mail" },
  { type: "appel", icone: "📞", libelle: "Appel" },
  { type: "tache", icone: "✅", libelle: "Tâche" },
  { type: "reunion", icone: "📅", libelle: "Réunion" },
];

// Composer façon HubSpot : rangée de boutons (Note, E-mail, Appel, Tâche, Réunion),
// puis un mini-formulaire adapté au type choisi. Machine à états simple :
//  - typeSel : type en cours de saisie (null = aucun formulaire ouvert)
//  - texte / echeance : champs du formulaire, réinitialisés à chaque fermeture
function ComposerActivites({ onAjouter, contacts, deals, onOuvrirDevis }: {
  onAjouter: (type: "note" | "email" | "appel" | "tache" | "reunion", texte: string, echeance?: string, dateRea?: string, lien?: { contactId?: string; dealId?: string }) => void;
  onOuvrirDevis?: () => void; // ouvre le module Devis avec le compte de la fiche pré-rempli
  // Listes optionnelles de rattachement (contacts & deals de l'entreprise
  // affichée) : quand elles sont fournies, deux petits menus permettent de
  // lier l'activité à un contact et/ou un deal.
  contacts?: { id: string; prenom: string; nom: string }[];
  deals?: { id: string; nom: string }[];
}) {
  const [typeSel, setTypeSel] = useState<(typeof TYPES_COMPOSER)[number]["type"] | null>(null);
  const [texte, setTexte] = useState("");
  const [echeance, setEcheance] = useState("");
  // Liens optionnels de l'activité vers un contact / un deal de l'entreprise.
  const [contactId, setContactId] = useState("");
  const [dealId, setDealId] = useState("");
  // Date de réalisation réelle, pré-remplie avec la date du jour (jj/mm/aaaa) :
  // c'est L'HORODATAGE officiel de l'activité, modifiable pour rattraper une
  // action faite hier ou avant.
  const aujourdhui = dateParis();
  const [dateRea, setDateRea] = useState(aujourdhui);

  // Fermeture = remise à zéro complète du formulaire.
  const fermer = () => { setTypeSel(null); setTexte(""); setEcheance(""); setContactId(""); setDealId(""); setDateRea(aujourdhui); };
  // Validation : texte obligatoire, échéance transmise seulement si non vide.
  const ajouter = () => {
    const t = texte.trim();
    if (!t || !typeSel) return;
    onAjouter(typeSel, t, echeance.trim() || undefined, dateRea.trim() || undefined, { contactId: contactId || undefined, dealId: dealId || undefined });
    fermer();
  };

  return (
    <div>
      {/* Rangée de boutons : re-cliquer le type actif le désélectionne (toggle). */}
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
        {onOuvrirDevis && (
          <button onClick={onOuvrirDevis}
            title="Créer un devis pour cette entreprise — le module Devis s'ouvre avec le compte pré-rempli"
            className="flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[12px] font-bold transition-colors"
            style={{ borderColor: "#94a3b8", background: "#f1f5f9", color: "#475569" }}>
            📄 Devis
          </button>
        )}
      </div>
      {/* Formulaire contextuel : placeholder adapté au type, champ échéance
          supplémentaire pour les tâches et les réunions uniquement. */}
      {typeSel && (
        <div className="mt-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[10.5px] font-black uppercase tracking-wider" style={{ color: META_ACT[typeSel].couleur }}>
              {META_ACT[typeSel].icone} {META_ACT[typeSel].libelle}
            </div>
            <Dictee valeur={texte} onTexte={setTexte} />
          </div>
          <textarea rows={2} value={texte} onChange={(ev) => setTexte(ev.target.value)}
            placeholder={
              typeSel === "note" ? "Contenu de la note…"
              : typeSel === "email" ? "Sujet et contenu de l'e-mail envoyé…"
              : typeSel === "appel" ? "Compte-rendu de l'appel…"
              : typeSel === "tache" ? "Que doit-on faire ?"
              : "Objet et conclusions de la réunion…"
            }
            className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12.5px] outline-none focus:border-cyan-500" />
          {/* Date de réalisation : pré-remplie avec aujourd'hui, modifiable
              (rattrapage d'une activité réalisée plus tôt). */}
          <input value={dateRea} onChange={(ev) => setDateRea(ev.target.value)}
            placeholder="Date de réalisation (ex. 14/10/2026)"
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12.5px] outline-none focus:border-cyan-500" />
          {(typeSel === "tache" || typeSel === "reunion") && (
            <input value={echeance} onChange={(ev) => setEcheance(ev.target.value)}
              placeholder={typeSel === "tache" ? "Échéance (ex. 15/10)" : "Date de la réunion (ex. 18/10)"}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12.5px] outline-none focus:border-cyan-500" />
          )}
          {/* Rattachements optionnels : un contact et/ou un deal de l'entreprise. */}
          {((contacts && contacts.length > 0) || (deals && deals.length > 0)) && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {contacts && contacts.length > 0 && (
                <select value={contactId} onChange={(ev) => setContactId(ev.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-[11.5px] font-medium text-slate-600 outline-none focus:border-cyan-500">
                  <option value="">👤 Contact lié (optionnel)</option>
                  {contacts.map((c) => <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>)}
                </select>
              )}
              {deals && deals.length > 0 && (
                <select value={dealId} onChange={(ev) => setDealId(ev.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-[11.5px] font-medium text-slate-600 outline-none focus:border-cyan-500">
                  <option value="">🎯 Deal lié (optionnel)</option>
                  {deals.map((d) => <option key={d.id} value={d.id}>{d.nom}</option>)}
                </select>
              )}
            </div>
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

// En-tête des pages record : bandeau dégradé, avatar initiales chevauchant le
// bandeau, nom + infos clés, et boutons d'action passés par le parent.
function EnteteFiche({ initiales, nom, sous, badge, boutons }: { initiales: string; nom: string; sous: string; badge?: React.ReactNode; boutons: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="h-12" style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }} />
      {/* L'avatar remonte de 20px (-mt-5) pour chevaucher le bandeau,
          liseré blanc de 4px pour l'effet « photo de profil ». */}
      <div className="flex flex-wrap items-center gap-3 px-4 pb-4">
        <div className="-mt-5 flex h-12 w-12 items-center justify-center rounded-2xl border-4 border-white text-[15px] font-black text-white shadow-md"
          style={{ background: "linear-gradient(135deg,#0ea5e9,#14b8a6)" }}>
          {initiales}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-black text-slate-800">{nom}</div>
          <div className="truncate text-[12px] text-slate-400">{sous}</div>
          {badge}
        </div>
        <div className="flex flex-wrap items-center gap-2">{boutons}</div>
      </div>
    </div>
  );
}

/* ---- Page record ENTREPRISE : colonne principale (À propos + Activités),
        colonne droite (Résumé + Contacts + Deals), comme une fiche HubSpot. ---- */
// ── Synchronisation Sheet à l'OUVERTURE de la fiche entreprise : à chaque fois
// qu'on ouvre une page entreprise qui a des contrats et un statut, le CRM relit
// le Sheet « Infos Service Client » et réaligne les données SOURCÉES SHEET
// (pack, dates, flotte, modèles, contrats, risque, statut Client) sur la
// dernière version publiée. Anti-invention maintenu : si le Sheet ne connaît
// pas la société ou est illisible, on ne touche à RIEN. Les champs saisis à la
// main (notes, contacts, deals, activités) ne sont jamais écrasés. ──
function SyncSheetOuverture({ ent, contacts, onModifie, onMajContacts }: { ent: Entreprise; contacts: Contact[]; onModifie: (patch: Partial<Entreprise>) => void; onMajContacts: (mods: { id: string; tel?: string; email?: string; role?: string }[]) => void }) {
  const [sync, setSync] = useState<"enCours" | "ok" | "rien" | "ko">("enCours");
  useEffect(() => {
    let annule = false;
    (async () => {
      // Seules les fiches « avec contrats et statut » concernent le Sheet :
      // pas de contrats ni de statut Client → rien à réaligner.
      if (!((ent.contrats || []).length > 0 || ent.pack || ent.statut === "Client")) { if (!annule) setSync("rien"); return; }
      // Le CSV public de Google peut être refusé par intermittence (limite de
      // débit) : on retente une 2e fois après un court délai avant d'abandonner.
      let clients: ClientSheet[] = [];
      let lectureOk = false;
      for (let essai = 0; essai < 2 && !lectureOk && !annule; essai++) {
        const r = await chargerClientsSheet();
        clients = r.clients; lectureOk = r.lectureOk;
        if (!lectureOk) await new Promise((d) => setTimeout(d, 1200));
      }
      if (!lectureOk || annule) { if (!annule) setSync("ko"); return; }
      const cliS = trouverClientSheet(clients, ent.nom, (ent.nomCommercial.split(" — ")[0] || ent.nomCommercial), ent.ville);
      if (!cliS) { if (!annule) setSync("rien"); return; }
      // Réalignement UNIQUEMENT des champs dont le Sheet est la source, et
      // seulement si quelque chose a changé (pas de commit inutile, pas de
      // boucle : le patch ne redéclenche pas l'effet, qui ne vit qu'au montage).
      const patch: Partial<Entreprise> = {
        statut: "Client",
        pack: cliS.packs, modeles: cliS.modeles,
        contrats: cliS.lignes.map((l) => ({ ...l, num: "" })),
        dateDebut: cliS.dateDebut, dateFin: cliS.dateFin,
        nbVehicules: cliS.nbVehicules, immatriculations: cliS.immats,
        risque: cliS.risque,
      };
      const change =
        ent.statut !== "Client" || ent.pack !== cliS.packs ||
        (ent.modeles || []).join("|") !== cliS.modeles.join("|") ||
        ent.dateDebut !== cliS.dateDebut || ent.dateFin !== cliS.dateFin ||
        ent.nbVehicules !== cliS.nbVehicules || ent.immatriculations !== cliS.immats ||
        ent.risque !== cliS.risque ||
        (ent.contrats || []).map((k) => [k.pack, k.modele, k.dateDebut, k.dateFin, k.immats, k.etat].join("|")).join("§") !==
          cliS.lignes.map((l) => [l.pack, l.modele, l.dateDebut, l.dateFin, l.immats, l.etat].join("|")).join("§");
      if (change) onModifie(patch);
      // ── RATTRAPAGE des contacts existants : les fiches créées AVANT la
      // synchronisation Sheet des contacts n'ont pas le téléphone/email des
      // interlocuteurs. On complète uniquement les champs MANQUANTS (jamais
      // d'écrasement d'une saisie manuelle), contact reconnu par prénom+nom
      // normalisés. Source : colonnes Mobile/Email/Fonction Contact du Sheet. ──
      const mods = cliS.contacts
        .map((sc) => {
          const ct = contacts.find((c) => norme(c.prenom) === norme(sc.prenom) && norme(c.nom) === norme(sc.nom));
          if (!ct) return null;
          const m: { id: string; tel?: string; email?: string; role?: string } = { id: ct.id };
          let utile = false;
          if (!ct.tel && sc.tel) { m.tel = sc.tel; utile = true; }
          if (!ct.email && sc.email) { m.email = sc.email; utile = true; }
          if (!ct.role && sc.role) { m.role = sc.role; utile = true; }
          return utile ? m : null;
        })
        .filter(Boolean) as { id: string; tel?: string; email?: string; role?: string }[];
      if (mods.length) onMajContacts(mods);
      if (!annule) setSync("ok");
    })();
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ent.id]);
  const LIBELLES: Record<typeof sync, string> = {
    enCours: "↻ Vérification Sheet…", ok: "✓ À jour avec le Sheet", rien: "", ko: "⚠ Sheet indisponible — réessaie en rouvrant la fiche",
  };
  const lib = LIBELLES[sync];
  if (!lib) return null;
  return (
    <span className="text-[10px] font-bold text-slate-400"
      title="Contrats et statut resynchronises sur le Sheet a chaque ouverture.">
      {lib}
    </span>
  );
}

// ── VOLET DE RECHERCHE GLOBALE : s'affiche sous la barre « Rechercher… »
//    du header dès les premiers caractères tapés. Résultats groupés par type
//    (entreprises, contacts, devis, deals, activités), chaque ligne mène à la
//    fiche concernée. Match : nom commercial, nom légal, ville, téléphone
//    (tolérant 33 ↔ 0, espaces, partiel), n° d'offre, noms de deals et textes
//    d'activités (≥ 2 caractères). ──
function VoletRecherche({ q, etat, onOuvre }: { q: string; etat: Etat; onOuvre: (c: Cible) => void }) {
  const t = q.trim().toLowerCase();
  const mTxt = (x?: string) => !!t && (x || "").toLowerCase().includes(t);
  const mTel = (x?: string) => telCorrespond(q, x || "");
  const rEnt = etat.entreprises.filter((e) => mTxt(e.nom) || mTxt(e.nomCommercial) || mTxt(e.ville) || mTel(e.tel)).slice(0, 6);
  const entDe = (id: string) => etat.entreprises.find((e) => e.id === id);
  const rCt = etat.contacts.filter((c) => mTxt(c.prenom + " " + c.nom) || mTxt(c.nom) || mTel(c.tel) || mTxt(c.email)).slice(0, 5);
  const rDv: { dv: DevisArchive; entId: string; entNom: string }[] = [];
  etat.entreprises.forEach((e) => (e.devisHistorique ?? []).forEach((dv) => {
    if (mTxt(dv.resume?.numOffre) || mTxt(e.nomCommercial || e.nom) || mTxt(e.nom) || mTel(e.tel)) rDv.push({ dv, entId: e.id, entNom: e.nomCommercial || e.nom });
  }));
  const rDvTop = rDv.slice(0, 6);
  const rDe = etat.deals.filter((d) => mTxt(d.nom)).slice(0, 5);
  const rAc: { a: Activite; e: Entreprise }[] = [];
  if (t.length >= 2) etat.entreprises.forEach((e) => e.activites.forEach((a) => { if (mTxt(a.texte)) rAc.push({ a, e }); }));
  const rAcTop = rAc.slice(0, 5);
  const nb = rEnt.length + rCt.length + rDvTop.length + rDe.length + rAcTop.length;
  const G = ({ titre, items }: { titre: string; items: { cle: string; nom: string; sub?: string; droite?: string; go: () => void }[] }) => (
    items.length === 0 ? null : (
      <div>
        <div className="px-3 py-1 text-[9.5px] font-bold uppercase tracking-wider text-slate-400 bg-slate-50/80">{titre} ({items.length})</div>
        {items.map((it) => (
          <button key={it.cle} onClick={it.go} className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11.5px] hover:bg-cyan-50 cursor-pointer">
            <span className="flex-1 truncate font-semibold text-slate-800">{it.nom}</span>
            {it.sub && <span className="truncate text-[10px] text-slate-400">{it.sub}</span>}
            {it.droite && <span className="text-[10px] text-slate-500">{it.droite}</span>}
            <span className="text-cyan-600">↗</span>
          </button>
        ))}
      </div>
    )
  );
  return (
    <div className="absolute right-0 top-full z-50 mt-1.5 w-[440px] max-w-[85vw] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
      <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[10.5px] font-bold text-slate-500">
        {nb} résultat{nb > 1 ? "s" : ""} pour « {q.trim()} »
      </div>
      <div className="max-h-80 divide-y divide-slate-100 overflow-auto">
        {nb === 0 && <p className="px-3 py-5 text-center text-xs text-slate-400">Aucun résultat — essaie un nom, un n° de devis ou un téléphone.</p>}
        <G titre="🏢 Entreprises" items={rEnt.map((e) => ({ cle: "e" + e.id, nom: e.nomCommercial || e.nom, sub: e.nomCommercial ? e.nom : undefined, droite: [e.ville, e.tel].filter(Boolean).join(" · "), go: () => onOuvre({ type: "entreprise", id: e.id }) }))} />
        <G titre="👥 Contacts" items={rCt.map((c) => ({ cle: "c" + c.id, nom: c.prenom + " " + c.nom, sub: c.role || undefined, droite: [entDe(c.entrepriseIds[0] || "")?.nomCommercial || entDe(c.entrepriseIds[0] || "")?.nom, c.tel].filter(Boolean).join(" · "), go: () => onOuvre({ type: "contact", id: c.id }) }))} />
        <G titre="🧾 Devis" items={rDvTop.map((x) => ({ cle: "d" + x.dv.id, nom: (x.dv.resume?.numOffre || "—") + " — " + x.entNom, droite: (x.dv.resume?.loyerMensuelHT ? Math.round(x.dv.resume.loyerMensuelHT).toLocaleString("fr-FR") + " €/mois" : "") + (x.dv.statut === "accepte" ? " 🎉" : x.dv.statut === "envoye" ? " ✅" : ""), go: () => onOuvre({ type: "entreprise", id: x.entId }) }))} />
        <G titre="🎯 Deals" items={rDe.map((d) => ({ cle: "k" + d.id, nom: d.nom, sub: d.etape, droite: d.montant ? d.montant.toLocaleString("fr-FR") + " €/mois" : undefined, go: () => onOuvre({ type: "deal", id: d.id }) }))} />
        <G titre="🎧 Activités" items={rAcTop.map((x, i) => ({ cle: "a" + i + x.e.id, nom: x.a.texte, droite: (x.e.nomCommercial || x.e.nom) + (x.a.date ? " · " + x.a.date : ""), go: () => onOuvre({ type: "entreprise", id: x.e.id }) }))} />
      </div>
    </div>
  );
}

function FicheEntreprise({ etat, id, onRetour, onOuvre, onOuvreFiche, onActivite, onModifie, onMajContacts, onRouvrirDevis, onMarquerDevisEnvoye, onMarquerDevisAccepte, onAnnulerDevisAccepte, onSupprimerDevis, onSupprimerActivite, onMajActivite, onOuvrirDevis }: {
  etat: Etat; id: string;
  onRetour: () => void;
  onOuvre: (c: Cible) => void;              // ouvre la modale (édition, deals…)
  onOuvreFiche: (f: FicheRef) => void;     // navigue vers une autre page record
  onActivite: (id: string, activite: Activite) => void; // journalise une activité SUR l'entreprise
  onModifie: (patch: Partial<Entreprise>) => void; // édition directe du panneau « À propos »
  onMajContacts: (mods: { id: string; tel?: string; email?: string; role?: string }[]) => void; // rattrapage Sheet des contacts
  onRouvrirDevis: (dv: DevisArchive) => void; // recharge un devis archivé dans le module Devis (lié à son original)
  onMarquerDevisEnvoye: (devisId: string, dateRelanceFr: string) => void; // statut Envoyé + tâche de relance à la DATE CHOISIE par le commercial
  onMarquerDevisAccepte: (devisId: string) => void; // devis accepté : supprime la tâche de relance + consigne l'acceptation dans les activités
  onAnnulerDevisAccepte: (devisId: string) => void; // annule une acceptation faite par erreur (tâche de relance recréée)
  onSupprimerDevis: (devisId: string) => void; // supprime le devis archivé de la fiche
  onSupprimerActivite: (ev: Activite) => void; // supprime une activité de la timeline (erreur de saisie)
  onMajActivite?: (ev: Activite, patch: Partial<Activite>) => void; // clôture / réouverture d'une tâche depuis la timeline
  onOuvrirDevis?: () => void; // ouvre le module Devis avec ce compte pré-rempli
}) {
  // ── Choix de la DATE DE RELANCE avant l'envoi d'un devis par mail : la
  // relance n'est plus imposée à J+7, c'est le commercial qui décide (date
  // OBLIGATOIRE — l'envoi est bloqué tant qu'elle n'est pas choisie). ──
  const [relancePour, setRelancePour] = useState<string | null>(null);
  const [dateRelance, setDateRelance] = useState<string>("");
  // Envoi REEL du devis par mail (Resend) depuis la fiche : pendant l'appel
  // réseau le bouton est désactivé (anti double envoi), et une FENÊTRE demande
  // de choisir le MODÈLE de mail souhaité avant l'envoi (même logique que le
  // module Devis).
  const [envoiFicheEnCours, setEnvoiFicheEnCours] = useState(false);
  const [modelePour, setModelePour] = useState<string | null>(null);
  const [modeleChoisiFiche, setModeleChoisiFiche] = useState<string>("");
  // ── Panneau « tâche » ouvert depuis la timeline (MÊME modale que l'agenda) :
  //    l'activité cliquée via un badge « À faire / Réalisée ». ──
  const [tachePanel, setTachePanel] = useState<Activite | null>(null);
  const e = etat.entreprises.find((x) => x.id === id);
  // Garde-fou : si l'entreprise a été supprimée pendant qu'on était sur sa
  // fiche, on n'affiche que le bouton retour (évite un écran blanc cassé).
  if (!e) {
    return <button onClick={onRetour} className="text-[12px] font-bold text-slate-400 hover:text-slate-600">← Entreprises</button>;
  }
  // ── Agrégats dérivés de l'état (recalculés à chaque rendu, pas besoin de cache) ──
  const contacts = etat.contacts.filter((c) => c.entrepriseIds.includes(e.id));
  // Format € compact pour les résumés de devis (2 décimales, style fr).
  const fmtEur = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  const deals = etat.deals.filter((d) => d.entrepriseId === e.id);
  const actifs = deals.filter((d) => d.etape !== "Gagné" && d.etape !== "Perdu");
  const pipeline = actifs.reduce((s, d) => s + d.montant, 0);
  // Timeline = les activités de l'entreprise (source unique : les activités
  // des contacts et des deals vivent ICI, avec liens `contactId`/`dealId`),
  // triées de la plus récente à la plus ancienne.
  const events = [...e.activites].sort(triRecentes);
  // ── Prochaine action en attente (1er deal non fermé avec une action à faire) :
  // elle alimente le résumé « IA » affiché en bas de la colonne droite. ──
  const prochaine = deals.find((d) => d.action && !d.fait && d.etape !== "Gagné" && d.etape !== "Perdu");

  // Le composer remonte son activité au parent avec la date du jour + liens.
  const ajouterActivite = (type: "note" | "email" | "appel" | "tache" | "reunion", texte: string, echeance?: string, dateRea?: string, lien?: { contactId?: string; dealId?: string }) => {
    // dateISO = date de réalisation réelle (transmise par le composer) ; on garde
    // aussi le libellé court cohérent (« auj. » si réalisé aujourd'hui, sinon jj/mm).
    const estAuj = dateRea === dateParis();
    onActivite(e.id, { date: dateRea ? (estAuj ? "auj." : dateRea.slice(0, 5)) : "auj.", texte, type, echeance, dateISO: dateRea || dateParis(), heure: heureParis(), contactId: lien?.contactId, dealId: lien?.dealId });
  };

  return (
    <div className="space-y-4">
      <button onClick={onRetour} className="text-[12px] font-bold text-slate-400 hover:text-slate-600">← Entreprises</button>

      {/* En-tête : avatar initiales, infos clés, boutons Modifier / + Contact. */}
      <EnteteFiche
        initiales={e.nom.slice(0, 2).toUpperCase()}
        nom={e.nom}
        sous={[e.secteur, e.ville, e.tel, e.site].filter(Boolean).join("  ·  ")}
        boutons={
          <>
            <button onClick={() => onOuvre({ type: "entreprise", id: e.id })}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:bg-slate-50">
              ✎ Modifier
            </button>
            {/* Devis : ouvre le module Devis avec ce compte pré-rempli. */}
            {onOuvrirDevis && (
              <button onClick={onOuvrirDevis}
                title="Créer un devis pour cette entreprise — module Devis pré-rempli"
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:bg-slate-50">
                📄 Devis
              </button>
            )}
            {/* Nouveau contact pré-rattaché à cette entreprise (preset). */}
            <button onClick={() => onOuvre({ type: "contact", id: null, preset: e.id })}
              className="rounded-xl px-3 py-1.5 text-[12px] font-black text-white"
              style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>
              + Contact
            </button>
          </>
        }
      />

      {/* 3 colonnes comme la fiche HubSpot de la capture : « À propos » à gauche,
          Activités au centre, associations + résumé à droite. Grille à largeur
          minimale + défilement horizontal si le panneau est étroit (même logique
          que le pipeline) : les 3 colonnes restent ainsi toujours visibles. */}
      <div className="overflow-x-auto pb-2 h-[calc(100vh-230px)]">
        <div className="grid h-full min-w-[860px] grid-cols-[minmax(0,240px)_minmax(0,1fr)_minmax(0,270px)] gap-4 [&>div]:h-full [&>div]:min-h-0 [&>div]:overflow-y-auto [&>div]:overscroll-contain [&>div]:[scrollbar-width:none] [&>div]:[&::-webkit-scrollbar]:hidden">
          {/* Colonne gauche : À propos (= panneau « Informations clés » HubSpot). */}
          <div className="col-roulette">
            <CarteFiche titre="À propos">
              {/* Propriétés empilées, libellé au-dessus de la valeur. */}
              <div className="space-y-2.5">
              {/* Tous les champs sont éditables DIRECTEMENT dans le panneau
                  (comme les fiches HubSpot) : texte libre ou menu déroulant,
                  sans passer par la modale ✎ Modifier. Les 3 champs normalisés
                  seront à terme remplis automatiquement par l'analyse des
                  conversations ou une recherche internet sur l'entreprise. */}
              {/* Statut du cycle de vie, en tête de fiche : c'est LE champ
                  piloté à 100 % par l'équipe commerciale (ni les API ni l'IA
                  ne « devinent » qu'un prospect est devenu client). */}
              <PropSelect label="Statut" valeur={e.statut} options={[...STATUTS]} onChange={(v) => onModifie({ statut: v as Statut })} />
              {/* Origine de la relation : comment cette entreprise est entrée dans le CRM. */}
              <PropSelect label="Origine" valeur={e.origine ?? ""} options={OPTIONS_ORIGINE} onChange={(v) => onModifie({ origine: v })} />
              <PropTexte label="Secteur" valeur={e.secteur} onChange={(v) => onModifie({ secteur: v })} />
              <PropTexte label="SIREN" valeur={e.siren ?? ""} onChange={(v) => onModifie({ siren: v })} />
              <PropTexte label="Adresse postale" valeur={e.adresse ?? ""} onChange={(v) => onModifie({ adresse: v })} />
              <PropTexte label="Code postal" valeur={e.cp ?? ""} onChange={(v) => onModifie({ cp: v })} />
              <PropTexte label="Ville" valeur={e.ville} onChange={(v) => onModifie({ ville: v })} />
              {/* Enseigne officielle (champ « nom commercial » de l'INSEE) avec
                  la ville ajoutée à la fin, ex. « Domino's Pizza — Nanterre ».
                  Vide si aucune source fiable — jamais d'invention. */}
              <PropTexte label="Nom commercial" valeur={e.nomCommercial} onChange={(v) => onModifie({ nomCommercial: v })} />
              <PropSelect label="Franchiseur" valeur={e.franchiseur} options={OPTIONS_FRANCHISEUR} onChange={(v) => onModifie({ franchiseur: v })} />
              <PropSelect label="Mode de livraison" valeur={e.modeLivraison} options={OPTIONS_MODE_LIVRAISON} onChange={(v) => onModifie({ modeLivraison: v })} />
              <PropSelect label="Activité" valeur={e.activite} options={OPTIONS_ACTIVITE} onChange={(v) => onModifie({ activite: v })} />
              <PropTexte label="Téléphone" valeur={e.tel} onChange={(v) => onModifie({ tel: v })} />
              <PropTexte label="Site web" valeur={e.site} onChange={(v) => onModifie({ site: v })} />
              {/* Champs calculés : lecture seule. */}
              <Prop label="Pipeline actif" valeur={`${pipeline} k€`} />
            </div>
            {/* Les notes libres s'affichent en encart sous les propriétés. */}
              {e.notes && <p className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-2.5 text-[12.5px] leading-relaxed text-slate-600">{e.notes}</p>}
            </CarteFiche>

            {/* Devis archivés depuis le module Devis (bouton « 💾 Sauvegarder
                sur la fiche entreprise »), sous « À propos ». « Rouvrir »
                recharge le brouillon tel quel dans le module Devis ;
                « ⬇ PDF » télécharge SEUL le devis en PDF (mise en page
                U'mob — logo officiel, couleurs du site, totaux par
                tableau), sans ouvrir de mail ; « Mail + PDF » télécharge
                le devis en PDF (mis en page, sans données internes) et
                ouvre un e-mail court à compléter. */}
            {(e.devisHistorique?.length ?? 0) > 0 && (
              <div className="mt-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[13px] font-black text-slate-700">🧾 Devis</div>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{e.devisHistorique!.length}</span>
                </div>
                <div className="space-y-2">
                  {e.devisHistorique!.map((dv) => {
                    const mailCt = (contacts.find((c) => (c.email || "").trim())?.email || "").trim();
                    return (
                      <div key={dv.id} className="rounded-xl border border-slate-200 p-2.5 text-[11.5px]">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-700">{dv.resume?.numOffre || "Devis"}</span>
                          {/* Statut du devis : ✅ envoyé au client (mail + PDF) ou
                              💾 simplement enregistré. Les archives d'avant le
                              champ n'en portent pas → « Enregistré » par défaut. */}
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${dv.statut === "enregistre" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                            {dv.statut === "accepte" ? `🎉 Accepté${dv.dateAcceptationFr ? ` le ${dv.dateAcceptationFr}` : ""}` : dv.statut === "envoye" ? `✅ Envoyé au client${dv.dateEnvoiFr ? ` le ${dv.dateEnvoiFr}` : ""}` : "💾 Enregistré"}
                          </span>
                          <span className="text-[10px] font-semibold text-slate-400">{dv.dateFr}{dv.dateISO && !Number.isNaN(new Date(dv.dateISO).getTime()) ? ` à ${heureParis(new Date(dv.dateISO))}` : ""}</span>
                        </div>
                        <p className="mt-0.5 text-slate-600">
                          {dv.resume?.nbChassis ?? 0} scooter(s) · {dv.resume?.duree ?? "—"} mois · <span className="font-bold">{fmtEur(dv.resume?.loyerMensuelHT ?? 0)} HT/mois</span>
                        </p>
                        {dv.commentaire && <p className="mt-1 whitespace-pre-wrap border-l-2 border-emerald-300 pl-2 italic text-slate-500">{dv.commentaire}</p>}
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <button onClick={() => onRouvrirDevis(dv)} className="rounded-xl border border-slate-200 px-2 py-0.5 text-[10.5px] font-bold text-slate-600 hover:bg-slate-50">🚀 Rouvrir</button>
                          <button onClick={() => { try { telechargerPdfDevis(dv.resume); } catch { /* échec du téléchargement : sans bloquer la fiche */ } }} title="Télécharger ce devis en PDF (logo officiel + couleurs U'mob + totaux par tableau)" className="rounded-xl px-2 py-0.5 text-[10.5px] font-bold hover:opacity-80" style={{ background: "#b0c300", color: "#3d4200" }}>⬇ PDF</button>
                          {dv.statut !== "accepte" && (
                          <button
                            onClick={() => {
                              // L'envoi exige la DATE DE RELANCE choisie par le commercial :
                              // le clic ouvre le mini-formulaire ci-dessous (date obligatoire).
                              setRelancePour(dv.id);
                              setDateRelance(isoParis(new Date(Date.now() + 7 * 86400000)));
                            }}
                            className="rounded-xl border border-slate-200 px-2 py-0.5 text-[10.5px] font-bold text-slate-600 hover:bg-slate-50">✉️ Mail + PDF</button>
                          )}
                          {dv.statut !== "accepte" ? (
                          <button
                            onClick={() => {
                              if (window.confirm(`Marquer le devis n° ${dv.resume?.numOffre || ""} comme ACCEPTÉ par le client ? La tâche de relance sera supprimée et l'acceptation consignée dans les activités.`)) onMarquerDevisAccepte(dv.id);
                            }}
                            title="Le client a accepté le devis : supprime la tâche de relance et consigne l'acceptation"
                            className="rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700 hover:bg-emerald-100">🎉 Accepté</button>
                          ) : (
                          <button
                            onClick={() => {
                              if (window.confirm(`Annuler l'acceptation du devis n° ${dv.resume?.numOffre || ""} ? Le devis redevient « envoyé », la note d'acceptation est retirée et la tâche de relance est recréée.`)) onAnnulerDevisAccepte(dv.id);
                            }}
                            title="Correction d'erreur : annule l'acceptation (le devis redevient envoyé, la tâche de relance est recréée)"
                            className="rounded-xl border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10.5px] font-bold text-amber-700 hover:bg-amber-100">↩️ Annuler l'acceptation</button>
                          )}
                          <button
                            onClick={() => {
                              if (window.confirm(`Supprimer définitivement le devis n° ${dv.resume?.numOffre || ""} de la fiche ?`)) onSupprimerDevis(dv.id);
                            }}
                            title="Supprimer ce devis archivé"
                            className="rounded-xl border border-slate-200 px-2 py-0.5 text-[10.5px] font-bold text-slate-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50">🗑️</button>
                        </div>
                        {relancePour === dv.id && (
                          <div className="mt-1.5 rounded-lg border border-emerald-200 bg-emerald-50/60 p-2">
                            <p className="text-[10.5px] font-bold text-slate-600">📅 À quelle date veux-tu relancer ce devis ? (obligatoire — une tâche sera créée sur la fiche)</p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <input type="date" value={dateRelance} onChange={(ev) => setDateRelance(ev.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700" />
                              <button
                                disabled={!dateRelance}
                                onClick={() => { setModeleChoisiFiche(""); setModelePour(dv.id); }}
                                className="rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed">✉️ Envoyer le devis</button>
                              <button onClick={() => setRelancePour(null)} className="rounded-xl border border-slate-200 px-2 py-0.5 text-[10.5px] font-bold text-slate-500 hover:bg-slate-50">Annuler</button>
                            </div>
                          </div>
                        )}
                        {modelePour === dv.id && (() => {
                          const res = dv.resume;
                          if (!res) return null;
                          const modeles = etat.modelesMailDevis ?? [];
                          const mChoisi = modeles.find((m) => m.id === modeleChoisiFiche) ?? null;
                          const corpsCourt = "Bonjour,\n\nVeuillez trouver ci-joint notre offre de location n\u00b0 " + (res.numOffre || "") + " pour " + e.nom + ", valable jusqu'au " + (res.dateValiditeFr || dv.dateFr) + ".\n\nBien cordialement,\n" + (res.commercial || "") + "\nU'MOB — 53 avenue Carnot, 69250 Neuville-sur-Saône — 04 82 29 96 78 — www.umob.fr";
                          const objetFinal = mChoisi ? rendreModeleMail(mChoisi.objet, res) : (dv.mail?.objet || "Offre de location U'mob");
                          const corpsFinal = mChoisi ? rendreModeleMail(mChoisi.corps, res) : (dv.mail?.corps || corpsCourt);
                          return (
                            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4" {...fermerAuClicFond(() => setModelePour(null))}>
                              <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={(ev) => ev.stopPropagation()}>
                                <div className="flex items-center justify-between px-4 py-2.5 border-b bg-slate-50">
                                  <p className="font-semibold text-sm text-slate-700">✉️ Avec quel modèle veux-tu envoyer ce devis ?</p>
                                  <button type="button" className="text-slate-400 hover:text-slate-700 text-xl leading-none cursor-pointer" onClick={() => setModelePour(null)}>×</button>
                                </div>
                                <div className="px-4 py-3 space-y-2 max-h-[60vh] overflow-y-auto">
                                  {modeles.length === 0 && (
                                    <p className="text-[11px] text-slate-400 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">Aucun modèle enregistré pour l'instant — tu peux en créer depuis le module Devis (étape 5 → envoyer par mail). Le message ci-dessous sera utilisé.</p>
                                  )}
                                  <label className={"flex items-start gap-2 rounded-xl border px-3 py-2 cursor-pointer " + (modeleChoisiFiche === "" ? "border-emerald-400 bg-emerald-50" : "border-slate-200")}>
                                    <input type="radio" checked={modeleChoisiFiche === ""} onChange={() => setModeleChoisiFiche("")} className="mt-0.5 accent-emerald-600" />
                                    <div><p className="text-[12.5px] font-bold text-slate-700">Message enregistré avec le devis (par défaut)</p><p className="text-[11px] text-slate-400">L'objet et le corps sauvegardés au moment du devis</p></div>
                                  </label>
                                  {modeles.map((m) => (
                                    <label key={m.id} className={"flex items-start gap-2 rounded-xl border px-3 py-2 cursor-pointer " + (modeleChoisiFiche === m.id ? "border-emerald-400 bg-emerald-50" : "border-slate-200")}>
                                      <input type="radio" checked={modeleChoisiFiche === m.id} onChange={() => setModeleChoisiFiche(m.id)} className="mt-0.5 accent-emerald-600" />
                                      <div className="min-w-0"><p className="text-[12.5px] font-bold text-slate-700 truncate">{m.nom}</p><p className="text-[11px] text-slate-400 truncate">{m.objet}</p></div>
                                    </label>
                                  ))}
                                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                                    <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Aperçu</p>
                                    <p className="text-xs font-semibold text-slate-700 mb-1">{objetFinal}</p>
                                    <pre className="text-xs text-slate-600 whitespace-pre-wrap font-sans max-h-40 overflow-y-auto">{corpsFinal}</pre>
                                  </div>
                                  <p className="text-[11px] text-slate-400">📎 Le PDF du devis sera joint automatiquement — le mail part de corentin.surand@umob.fr dès le clic.</p>
                                </div>
                                <div className="border-t bg-white p-4 flex gap-2">
                                  <button
                                    disabled={envoiFicheEnCours}
                                    onClick={async () => {
                                      if (envoiFicheEnCours) return;
                                      if (!mailCt) { window.alert("Aucune adresse e-mail connue sur ce compte \u2014 renseigne l'e-mail de la société ou d'un contact, puis réessaie."); return; }
                                      const p = dateRelance.split("-"); const fr = p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : dateRelance;
                                      setEnvoiFicheEnCours(true);
                                      const rep = await envoyerDevisParMail(res, objetFinal, corpsFinal, mailCt, { signatureHtml: etat.signatureMail });
                                      setEnvoiFicheEnCours(false);
                                      if (!rep.ok) {
                                        window.alert("L'envoi a échoué : " + (rep.erreur || "erreur inconnue") + "\n\nLe mail n'est PAS parti et le devis n'est PAS marqué envoyé \u2014 vérifie et réessaie.");
                                        return;
                                      }
                                      onMarquerDevisEnvoye(dv.id, fr); // uniquement si le mail est réellement parti
                                      setModelePour(null);
                                      setRelancePour(null);
                                    }}
                                    className="flex-1 rounded-xl px-3 py-1.5 text-[12px] font-black text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                    style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>{envoiFicheEnCours ? "⏳ Envoi en cours…" : "✉️ Envoyer le devis"}</button>
                                  <button onClick={() => setModelePour(null)} className="rounded-xl border border-slate-200 px-3 py-1.5 text-[12px] font-bold text-slate-500 hover:bg-slate-50">Annuler</button>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Colonne centrale : Activités (composer + timeline), comme le
              bandeau central de la fiche HubSpot. */}
          <div className="col-roulette rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 text-[13px] font-black text-slate-700">Activités</div>
            <ComposerActivites onAjouter={ajouterActivite} contacts={contacts} deals={deals} onOuvrirDevis={onOuvrirDevis} />
            <div className="mt-3">
              <Chronologie events={events} onOuvre={onOuvre} contacts={contacts} deals={deals} onSupprimer={onSupprimerActivite} onMaj={onMajActivite} onOuvrirTache={setTachePanel} />
            </div>
            {/* Panneau « tâche » de la timeline : MÊME modale que l'agenda,
                ouverte par les badges « À faire / Réalisée ». */}
            <AnimatePresence>
              {tachePanel && (() => {
                const t = tachePanel;
                return (
                  <ModaleTache key={t.id || (t.texte + (t.echeance || ""))}
                    kind={t.type === "reunion" ? "reunion" : "tache"} titre={t.texte}
                    contexte={e.nomCommercial || e.nom}
                    dateFr={t.echeance || dateParis()} heure={t.heure} fait={!!t.fait}
                    lien={{ type: "entreprise", id: e.id }}
                    onOuvre={onOuvre} onFermer={() => setTachePanel(null)}
                    onModifier={(ti, d, h) => { onMajActivite?.(t, { texte: ti, echeance: d, heure: h }); setTachePanel(null); }}
                    onCloturer={() => { onMajActivite?.(t, { fait: true, clotureLe: dateParis() }); setTachePanel(null); }}
                    onRouvrir={() => { onMajActivite?.(t, { fait: false, clotureLe: undefined }); setTachePanel(null); }}
                    onCloturerEtSuivante={(txt, d) => {
                      onMajActivite?.(t, { fait: true, clotureLe: dateParis() });
                      ajouterActivite("tache", txt, d, undefined, { contactId: t.contactId, dealId: t.dealId });
                      setTachePanel(null);
                    }} />
                );
              })()}
            </AnimatePresence>
          </div>

          {/* Colonne droite : associations puis résumé (comme HubSpot). */}
          <div className="col-roulette space-y-4">
            {/* Carte « Contrat & flotte » : affichée seulement si un champ
                contrat est renseigné (les prospects n'ont pas de contrat).
                Chaque ligne est éditable sur place (même mécanisme inline
                que le panneau À propos). Source des données auto : Sheet
                « Infos Service Client » (packs, dates, véhicules). */}
            {(e.pack || e.nbVehicules || e.immatriculations || e.risque || (e.modeles && e.modeles.length > 0) || ((e.contrats || []).length > 0)) && (
              <CarteFiche titre="🛵 Contrat & flotte" action={<SyncSheetOuverture ent={e} contacts={contacts} onModifie={onModifie} onMajContacts={onMajContacts} />}>
                <div className="space-y-2">
                  {e.risque && (
                    <div className="w-full overflow-hidden rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5">
                      <div className="flex w-full items-start gap-2">
                        <span className="shrink-0 text-[13px] leading-snug">⚠️</span>
                        <span className="w-full whitespace-normal break-words text-[12px] font-bold leading-snug text-red-600">{normRisque(e.risque)}</span>
                      </div>
                      <div className="mt-0.5 text-right text-[10px] font-medium text-red-400">source SAV</div>
                    </div>
                  )}
                  {(e.modeles || []).length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Modèles</span>
                      {e.modeles.map((m) => (
                        <span key={m} className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11.5px] font-bold text-emerald-700">🛵 {m}</span>
                      ))}
                    </div>
                  )}
                  {(e.contrats || []).map((k, i) => (
                    <div key={i} className="rounded-xl border border-slate-200 bg-slate-50/60 p-2">
                      <div className="mb-1 text-[11px] font-black text-slate-500">Contrat {i + 1}{k.etat ? " · " + k.etat : ""}</div>
                      <div className="grid grid-cols-2 gap-2">
                        <PropTexte label="Pack" valeur={affPack(k.pack)} onChange={(v) => { const cs = (e.contrats || []).map((k2, j) => j === i ? { ...k2, pack: v } : k2); onModifie({ contrats: cs, ...fusionnerContrats(cs) }); }} />
                        <PropTexte label="Début" valeur={k.dateDebut} onChange={(v) => { const cs = (e.contrats || []).map((k2, j) => j === i ? { ...k2, dateDebut: v } : k2); onModifie({ contrats: cs, ...fusionnerContrats(cs) }); }} />
                        <PropTexte label="Fin" valeur={k.dateFin} onChange={(v) => { const cs = (e.contrats || []).map((k2, j) => j === i ? { ...k2, dateFin: v } : k2); onModifie({ contrats: cs, ...fusionnerContrats(cs) }); }} />
                        <div className="col-span-2"><PropTexte label="Immatriculations" valeur={k.immats} onChange={(v) => { const cs = (e.contrats || []).map((k2, j) => j === i ? { ...k2, immats: v } : k2); onModifie({ contrats: cs, ...fusionnerContrats(cs) }); }} /></div>
                      </div>
                    </div>
                  ))}
                  <div><Prop label="Véhicules" valeur={e.nbVehicules} /></div>
                </div>
              </CarteFiche>
            )}
            {/* Carte associations : chaque contact ouvre sa page record. */}
          <CarteFiche titre={`Contacts (${contacts.length})`}
            action={<button onClick={() => onOuvre({ type: "contact", id: null, preset: e.id })}
              className="text-[11px] font-bold text-cyan-600 hover:underline">+ Ajouter</button>}>
            {contacts.length === 0 && <div className="text-[11.5px] text-slate-400">Aucun contact rattaché.</div>}
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
                    {/* E-mail et téléphone visibles directement, comme sur la
                        carte contact HubSpot de la capture. */}
                    {c.email && <span className="mt-0.5 block truncate text-[10.5px] font-medium text-slate-500">✉️ {c.email}</span>}
                    {c.tel && <span className="block truncate text-[10.5px] font-medium text-slate-500">📞 {c.tel}</span>}
                  </span>
                </button>
              ))}
            </div>
          </CarteFiche>

          {/* Carte deals : titre avec total en k€, chaque deal ouvre la modale. */}
          <CarteFiche titre={`Deals (${deals.length} · ${deals.reduce((s, d) => s + d.montant, 0)} k€)`}
            action={<button onClick={() => onOuvre({ type: "deal", id: null, preset: e.id })}
              className="text-[11px] font-bold text-cyan-600 hover:underline">+ Ajouter</button>}>
            {deals.length === 0 && <div className="text-[11.5px] text-slate-400">Aucun deal en cours.</div>}
            <div className="space-y-1">
              {deals.map((d) => (
                <button key={d.id} onClick={() => onOuvreFiche({ type: "deal", id: d.id })}
                  className="w-full rounded-xl px-1.5 py-1.5 text-left hover:bg-slate-50">
                  <span className="block truncate text-[12px] font-bold text-slate-700">{d.nom}</span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <Badge texte={d.etape} couleur={couleurEtape(d.etape)} />
                    <span className="text-[11px] font-black text-slate-600">{d.montant} k€</span>
                  </span>
                </button>
              ))}
            </div>
          </CarteFiche>

            {/* Résumé « IA » + zone de questions en bas de la colonne droite.
                faits = tout ce que la zone « Posez une question » peut citer :
                propriétés, contrats, contacts, deals, activités. */}
            <ResumeIA nom={e.nom} events={events} prochaine={prochaine}
              faits={[
                e.statut ? e.nom + " a le statut « " + e.statut + " »." : "",
                e.ville ? e.nom + " est situé à " + e.ville + "." : "",
                e.tel ? "Le téléphone de " + e.nom + " est le " + e.tel + "." : "",
                e.secteur ? "Secteur : " + e.secteur + "." : "",
                e.activite ? "Activité : " + e.activite + "." : "",
                e.franchiseur ? "Franchiseur : " + e.franchiseur + "." : "",
                e.modeLivraison ? "Mode de livraison : " + e.modeLivraison + "." : "",
                e.risque ? "⚠️ Risque signalé : " + normRisque(e.risque) + "." : "",
                (e.modeles || []).length > 0 ? e.nom + " loue les modèles de scooter " + e.modeles.join(" et ") + "." : "",
                (e.contrats || []).length > 0 ? e.nom + " a " + e.contrats.length + (e.contrats.length > 1 ? " contrats" : " contrat") + "." : "",
                ...(e.contrats || []).map((k) => "Le contrat " + (affPack(k.pack) || "sans nom") + " se termine le " + k.dateFin + "."),
                ...(e.contrats || []).map((k) => "Contrat " + (affPack(k.pack) || "") + " : du " + k.dateDebut + " au " + k.dateFin + (k.immats ? ", immatriculations " + k.immats : "") + "."),
                e.dateDebut && e.dateFin ? "La période totale des contrats va du " + e.dateDebut + " au " + e.dateFin + "." : "",
                e.nbVehicules ? e.nom + " exploite " + e.nbVehicules + " véhicule(s)." : "",
                e.immatriculations ? "Immatriculations de la flotte : " + e.immatriculations + "." : "",
                (etat.contacts.filter((x) => x.entrepriseIds.includes(e.id)).length > 0 ? "Les contacts de " + e.nom + " sont : " + etat.contacts.filter((x) => x.entrepriseIds.includes(e.id)).map((x) => x.prenom + " " + x.nom).join(", ") + "." : ""),
                ...etat.contacts.filter((x) => x.entrepriseIds.includes(e.id)).map((x) => x.prenom + " " + x.nom + (x.role ? " (" + x.role + ")" : "") + " est un contact de " + e.nom + (x.tel ? " — tél. " + x.tel : "") + (x.email ? " — email " + x.email : "") + "."),
                ...etat.deals.filter((d) => d.entrepriseId === e.id).map((d) => "Deal « " + d.nom + " » : " + d.montant + " k€, étape « " + d.etape + " »" + (d.action ? ", prochaine action : " + d.action + (d.echeance ? " (le " + d.echeance + ")" : "") : "") + "."),
                (events.length > 0 ? "Dernière activité : " + events[0].texte + "." : ""),
              ].filter(Boolean)}
              suggestions={["Quand se termine le contrat ?", "Quels modèles loue ce client ?", "Qui sont les contacts ?", "Où se situe l'entreprise ?", "Quelle est la dernière activité ?"]} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Page record CONTACT : même structure que l'entreprise, mais la colonne
        Activités est en CONSULTATION SEULE — les activités vivent sur les
        entreprises (sources uniques) et on affiche celles qui sont liées à
        ce contact (lien `contactId`) ou à l'un de ses deals (lien `dealId`). ---- */
function FicheContact({ etat, id, onRetour, onOuvre, onOuvreFiche }: {
  etat: Etat; id: string;
  onRetour: () => void;
  onOuvre: (c: Cible) => void;
  onOuvreFiche: (f: FicheRef) => void;
}) {
  const c = etat.contacts.find((x) => x.id === id);
  // Même garde-fou que la fiche entreprise : contact supprimé → retour simple.
  if (!c) {
    return <button onClick={onRetour} className="text-[12px] font-bold text-slate-400 hover:text-slate-600">← Contacts</button>;
  }
  // Agrégats : TOUTES les entreprises du contact (multi-comptes), deals portés
  // PAR CE CONTACT (contactId). Timeline = activités de SES entreprises qui
  // lui sont liées (contactId) ou liées à l'un de ses deals (dealId).
  const entreprises = etat.entreprises.filter((x) => c.entrepriseIds.includes(x.id));
  const deals = etat.deals.filter((d) => d.contactId === c.id);
  const actifs = deals.filter((d) => d.etape !== "Gagné" && d.etape !== "Perdu");
  const idsDeals = new Set(deals.map((d) => d.id));
  const events = entreprises.flatMap((en) =>
    en.activites.filter((a) => a.contactId === c.id || (a.dealId && idsDeals.has(a.dealId)))
  ).sort(triRecentes);
  // Prochaine action en attente : alimente le résumé « IA » de la colonne droite.
  const prochaine = deals.find((d) => d.action && !d.fait && d.etape !== "Gagné" && d.etape !== "Perdu");

  return (
    <div className="space-y-4">
      <button onClick={onRetour} className="text-[12px] font-bold text-slate-400 hover:text-slate-600">← Contacts</button>

      <EnteteFiche
        initiales={(c.prenom[0] || "") + (c.nom[0] || "")}
        nom={`${c.prenom} ${c.nom}`}
        sous={[c.role, entreprises.map((x) => x.nom).join(", "), c.email, c.tel].filter(Boolean).join("  ·  ")}
        boutons={
          <>
            <button onClick={() => onOuvre({ type: "contact", id: c.id })}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:bg-slate-50">
              ✎ Modifier
            </button>
            {/* Nouveau deal : si le contact n'a qu'UNE entreprise, on la
                pré-coche ; s'il en a plusieurs, l'utilisateur choisit dans
                la modale (pas de déduction hasardeuse). */}
            <button onClick={() => onOuvre({ type: "deal", id: null, preset: c.entrepriseIds.length === 1 ? c.entrepriseIds[0] : "" })}
              className="rounded-xl px-3 py-1.5 text-[12px] font-black text-white"
              style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>
              + Deal
            </button>
          </>
        }
      />

      {/* 3 colonnes façon HubSpot : À propos à gauche, Activités au centre,
          associations + résumé à droite (même structure que la fiche entreprise,
          défilement horizontal si le panneau est étroit). */}
      <div className="overflow-x-auto pb-2 h-[calc(100vh-230px)]">
        <div className="grid h-full min-w-[860px] grid-cols-[minmax(0,240px)_minmax(0,1fr)_minmax(0,270px)] gap-4 [&>div]:h-full [&>div]:min-h-0 [&>div]:overflow-y-auto [&>div]:overscroll-contain [&>div]:[scrollbar-width:none] [&>div]:[&::-webkit-scrollbar]:hidden">
          {/* Colonne gauche : À propos. */}
          <div className="col-roulette">
            <CarteFiche titre="À propos">
              {/* Propriétés empilées, libellé au-dessus de la valeur. */}
              <div className="space-y-2.5">
              <Prop label="Prénom" valeur={c.prenom} />
              <Prop label="Nom" valeur={c.nom} />
              <Prop label="Rôle" valeur={c.role} />
              <Prop label="Email" valeur={c.email} />
              <Prop label="Téléphone" valeur={c.tel} />
              <Prop label="Entreprises" valeur={entreprises.map((x) => x.nom).join(", ") || "—"} />
              <Prop label="Deals" valeur={String(deals.length)} />
              <Prop label="Pipeline actif" valeur={`${actifs.reduce((s, d) => s + d.montant, 0)} k€`} />
              </div>
            </CarteFiche>
          </div>

          {/* Colonne centrale : Activités en CONSULTATION SEULE (elles sont
              ajoutées depuis la fiche de l'entreprise, où elles vivent). */}
          <div className="col-roulette rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 text-[13px] font-black text-slate-700">Activités</div>
            <div className="mb-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 text-[11.5px] font-medium text-slate-400">
              ℹ️ Les activités se consignent depuis la fiche d'une entreprise — chaque activité peut être reliée à {c.prenom}. Elles s'affichent ici automatiquement.
            </div>
            <Chronologie events={events} onOuvre={onOuvre} contacts={[c]} deals={deals} />
          </div>

          {/* Colonne droite : associations puis résumé. */}
          <div className="col-roulette space-y-4">
            {/* Association inverse : l'entreprise du contact (association unique). */}
          {/* TOUTES les entreprises liées (un contact peut en avoir plusieurs :
              ex. franchisé multi-sites). Chaque carte est cliquable. */}
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
                  <span className="block truncate text-[10px] text-slate-400">{en.secteur} · {en.ville}</span>
                </span>
              </button>
            )) : (
              <div className="text-[11.5px] text-slate-400">Aucune entreprise rattachée.</div>
            )}
          </CarteFiche>

          <CarteFiche titre={`Deals (${deals.length})`}
            action={<button onClick={() => onOuvre({ type: "deal", id: null, preset: c.entrepriseIds.length === 1 ? c.entrepriseIds[0] : "" })}
              className="text-[11px] font-bold text-cyan-600 hover:underline">+ Ajouter</button>}>
            {deals.length === 0 && <div className="text-[11.5px] text-slate-400">Aucun deal en cours.</div>}
            <div className="space-y-1">
              {deals.map((d) => (
                <button key={d.id} onClick={() => onOuvreFiche({ type: "deal", id: d.id })}
                  className="w-full rounded-xl px-1.5 py-1.5 text-left hover:bg-slate-50">
                  <span className="block truncate text-[12px] font-bold text-slate-700">{d.nom}</span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <Badge texte={d.etape} couleur={couleurEtape(d.etape)} />
                    <span className="text-[11px] font-black text-slate-600">{d.montant} k€</span>
                  </span>
                </button>
              ))}
            </div>
          </CarteFiche>

            {/* Résumé « IA » + zone de questions en bas de la colonne droite. */}
            <ResumeIA nom={c.prenom + " " + c.nom} events={events} prochaine={prochaine}
              faits={[
                c.prenom + " " + c.nom + (c.role ? " est " + c.role : "") + (c.email ? " — email " + c.email : "") + (c.tel ? " — tél. " + c.tel : "") + ".",
                ...etat.entreprises.filter((x) => (c.entrepriseIds || []).includes(x.id)).map((x) => c.prenom + " " + c.nom + " est rattaché à " + x.nom + (x.ville ? " (" + x.ville + ")" : "") + ", statut « " + x.statut + " »" + (x.tel ? " — tél. " + x.tel : "") + "."),
                ...etat.deals.filter((d) => d.contactId === c.id).map((d) => "Deal « " + d.nom + " » : " + d.montant + " k€, étape « " + d.etape + " »" + (d.action ? ", prochaine action : " + d.action : "") + "."),
                ...events.map((ev) => META_ACT[ev.type || "note"].libelle + " du " + ev.date + " : " + ev.texte + "."),
              ].filter(Boolean)}
              suggestions={["Quelles sont ses entreprises ?", "Quel est son email ?", "Quelle est la dernière activité ?"]} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Page record DEAL : même structure que les fiches entreprise/contact —
      « À propos » éditable en direct à gauche (montant, étape, prochaine
      action, notes…), Activités en CONSULTATION au centre (elles vivent sur
      l'entreprise, liées via `dealId`), associations + résumé IA à droite. ---- */
function FicheDeal({ etat, id, onRetour, onOuvre, onOuvreFiche, onModifie }: {
  etat: Etat; id: string;
  onRetour: () => void;
  onOuvre: (c: Cible) => void;              // ouvre la modale (édition complète…)
  onOuvreFiche: (f: FicheRef) => void;     // navigue vers une autre page record
  onModifie: (patch: Partial<Deal>) => void; // édition directe du panneau « À propos »
}) {
  const d = etat.deals.find((x) => x.id === id);
  // Garde-fou : deal supprimé pendant qu'on était sur sa fiche → retour simple.
  if (!d) {
    return <button onClick={onRetour} className="text-[12px] font-bold text-slate-400 hover:text-slate-600">← Deals</button>;
  }
  // Agrégats : entreprise porteuse, contact référent, activités liées (elles
  // sont portées par l'entreprise avec un lien `dealId`).
  const entreprise = etat.entreprises.find((x) => x.id === d.entrepriseId);
  const contact = etat.contacts.find((x) => x.id === d.contactId);
  const events = (entreprise ? entreprise.activites.filter((a) => a.dealId === d.id) : [])
    .slice().sort(triRecentes);
  // Prochaine action en attente : alimente le résumé « IA » (null si faite/fermée).
  const prochaine = d.action && !d.fait && d.etape !== "Gagné" && d.etape !== "Perdu" ? d : null;

  return (
    <div className="space-y-4">
      <button onClick={onRetour} className="text-[12px] font-bold text-slate-400 hover:text-slate-600">← Deals</button>

      <EnteteFiche
        initiales={d.nom.slice(0, 2).toUpperCase()}
        nom={d.nom}
        sous={[entreprise?.nom, contact ? contact.prenom + " " + contact.nom : "", d.montant + " k€", d.etape].filter(Boolean).join("  ·  ")}
        boutons={
          <button onClick={() => onOuvre({ type: "deal", id: d.id, preset: "" })}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:bg-slate-50">
            ✎ Modifier
          </button>
        }
      />

      {/* 3 colonnes façon HubSpot, défilement horizontal si le panneau est étroit. */}
      <div className="overflow-x-auto pb-2 h-[calc(100vh-230px)]">
        <div className="grid h-full min-w-[860px] grid-cols-[minmax(0,240px)_minmax(0,1fr)_minmax(0,270px)] gap-4 [&>div]:h-full [&>div]:min-h-0 [&>div]:overflow-y-auto [&>div]:overscroll-contain [&>div]:[scrollbar-width:none] [&>div]:[&::-webkit-scrollbar]:hidden">
          {/* Colonne gauche : À propos — tout est éditable EN DIRECT. */}
          <div className="col-roulette">
            <CarteFiche titre="À propos">
              <div className="space-y-2.5">
              {/* L'étape change via le select ; le changement est tracé
                  automatiquement dans l'historique (comme la modale/kanban). */}
              <PropSelect label="Étape" valeur={d.etape} options={ETAPES.map((x) => x.nom)} onChange={(v) => onModifie({ etape: v as Etape })} />
              {/* Montant en k€ : saisie libre convertie en nombre (virgule acceptée). */}
              <PropTexte label="Montant (k€)" valeur={String(d.montant)} onChange={(v) => onModifie({ montant: v.trim() === "" ? 0 : Number(v.replace(",", ".")) || 0 })} />
              <PropTexte label="Prochaine action" valeur={d.action} onChange={(v) => onModifie({ action: v })} />
              <PropTexte label="Échéance" valeur={d.echeance} onChange={(v) => onModifie({ echeance: v })} />
              {/* Bascule « faite / à faire » : gros bouton explicite. */}
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Prochaine action — statut</div>
                <button onClick={() => onModifie({ fait: !d.fait })}
                  className={"mt-0.5 rounded-lg px-2 py-1 text-[12px] font-black transition-colors " + (d.fait ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" : "bg-orange-100 text-orange-700 hover:bg-orange-200")}>
                  {d.fait ? "✓ Faite" : "○ À faire"}
                </button>
              </div>
              {/* Notes libres, éditables en place. */}
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Notes</div>
                <textarea rows={3} value={d.notes} onChange={(e) => onModifie({ notes: e.target.value })}
                  placeholder="—"
                  className="w-full resize-none rounded-lg border border-transparent bg-transparent px-1 py-0.5 -mx-1 text-[12.5px] font-medium leading-relaxed text-slate-700 outline-none transition-colors hover:border-slate-200 hover:bg-slate-50 focus:border-cyan-500 focus:bg-white" />
              </div>
              </div>
            </CarteFiche>
          </div>

          {/* Colonne centrale : Activités en CONSULTATION SEULE (elles sont
              ajoutées depuis la fiche de l'entreprise, où elles vivent). */}
          <div className="col-roulette rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 text-[13px] font-black text-slate-700">Activités</div>
            <div className="mb-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 text-[11.5px] font-medium text-slate-400">
              ℹ️ Les activités se consignent depuis la fiche de l'entreprise {entreprise ? <span className="font-bold text-slate-500">{entreprise.nom}</span> : ""} — chaque activité peut être reliée à ce deal. Elles s'affichent ici automatiquement.
            </div>
            <Chronologie events={events} onOuvre={onOuvre} contacts={contact ? [contact] : []} deals={[d]} />
          </div>

          {/* Colonne droite : associations puis résumé. */}
          <div className="col-roulette space-y-4">
            <CarteFiche titre="Entreprise">
              {entreprise ? (
                <button onClick={() => onOuvreFiche({ type: "entreprise", id: entreprise.id })}
                  className="flex w-full items-center gap-2 rounded-xl px-1.5 py-1.5 text-left hover:bg-slate-50">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-black text-white"
                    style={{ background: "linear-gradient(135deg,#0ea5e9,#14b8a6)" }}>
                    {entreprise.nom.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-bold text-slate-700">{entreprise.nom}</span>
                    <span className="block truncate text-[10px] text-slate-400">{entreprise.secteur} · {entreprise.ville}</span>
                  </span>
                </button>
              ) : <div className="text-[11.5px] text-slate-400">Aucune entreprise rattachée.</div>}
            </CarteFiche>

            <CarteFiche titre="Contact">
              {contact ? (
                <button onClick={() => onOuvreFiche({ type: "contact", id: contact.id })}
                  className="flex w-full items-center gap-2 rounded-xl px-1.5 py-1.5 text-left hover:bg-slate-50">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-100 text-[11px] font-black text-cyan-700">
                    {contact.prenom[0]}{contact.nom[0]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-bold text-slate-700">{contact.prenom} {contact.nom}</span>
                    <span className="block truncate text-[10px] text-slate-400">{contact.role}</span>
                  </span>
                </button>
              ) : <div className="text-[11.5px] text-slate-400">Aucun contact référent.</div>}
            </CarteFiche>

            {/* Résumé « IA » + zone de questions. */}
            <ResumeIA nom={d.nom} events={events} prochaine={prochaine}
              faits={[
                "Deal « " + d.nom + " » : " + d.montant + " k€, étape « " + d.etape + " ».",
                entreprise ? "Deal porté par " + entreprise.nom + (entreprise.ville ? " (" + entreprise.ville + ")" : "") + ", statut « " + entreprise.statut + " »." : "",
                contact ? "Contact référent : " + contact.prenom + " " + contact.nom + (contact.role ? " (" + contact.role + ")" : "") + (contact.tel ? " — tél. " + contact.tel : "") + (contact.email ? " — email " + contact.email : "") + "." : "",
                d.action ? "Prochaine action : " + d.action + (d.fait ? " (faite)" : "") + (d.echeance ? " — échéance " + d.echeance : "") + "." : "",
                ...events.map((ev) => META_ACT[ev.type || "note"].libelle + " du " + (ev.dateISO || ev.date) + " : " + ev.texte + "."),
              ].filter(Boolean)}
              suggestions={["Quel est le montant du deal ?", "Qui est le contact référent ?", "Quelle est la prochaine action ?", "Quelle est la dernière activité ?"]} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================== VUES ============================== */

/* ---- Agenda : calendrier mensuel de tout ce qu'il faut FAIRE — tâches,
       réunions (échéances des activités) et prochaines actions des deals.
       Sources : activites (type tache/reunion) avec echeance + deals avec
       action non faite et echeance. Cliquer un jour affiche le détail ;
       cliquer un élément ouvre la fiche / le deal correspondant. ---- */
// Parse une échéance ("16/10", "18/10/2026", "auj.") en {j, m, a} — l'année
// manquante est celle en cours. Retourne null si incompréhensible.
const parseEcheance = (s: string): { j: number; m: number; a: number } | null => {
  const t = (s || "").trim();
  if (!t || t === "auj.") return null;
  const p = t.split("/").map(Number);
  // ⚠️ mois 0-indexé pour matcher new Date().getMonth()
  if (p.length === 3 && p.every((n) => !Number.isNaN(n))) return { j: p[0], m: p[1] - 1, a: p[2] };
  if (p.length === 2 && p.every((n) => !Number.isNaN(n))) return { j: p[0], m: p[1] - 1, a: new Date().getFullYear() };
  return null;
};
const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const JOURS_FR = ["L", "M", "M", "J", "V", "S", "D"];

/* ---- Mini-calendrier de saisie de date : utilisé par le formulaire
        « ➕ Consigner » de l'agenda (date de réalisation ET échéance de
        l'action suivante). S'ouvre sur le mois de la valeur actuelle (ou du
        jour), navigation ←/→, un clic sur un jour remonte « j/m/a ». ---- */
function MiniCalendrier({ valeur, onChoisit }: { valeur: string; onChoisit: (jjmmaaaa: string) => void }) {
  const auj = new Date();
  const sel = valeur ? parseEcheance(valeur) : null;
  const [mois, setMois] = useState(sel ? { a: sel.a, m: sel.m } : { a: auj.getFullYear(), m: auj.getMonth() });
  const nbJours = new Date(mois.a, mois.m + 1, 0).getDate();
  const decal = (new Date(mois.a, mois.m, 1).getDay() + 6) % 7;
  const cases: (number | null)[] = Array(decal).fill(null).concat(Array.from({ length: nbJours }, (_, i) => i + 1));
  return (
    <div className="mt-1.5 rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm">
      <div className="mb-1.5 flex items-center justify-between">
        <button onClick={() => setMois(mois.m === 0 ? { a: mois.a - 1, m: 11 } : { a: mois.a, m: mois.m - 1 })}
          className="rounded-lg px-2 py-0.5 text-[13px] font-black text-slate-400 hover:bg-slate-100">←</button>
        <span className="text-[11px] font-black capitalize text-slate-700">{MOIS_FR[mois.m]} {mois.a}</span>
        <button onClick={() => setMois(mois.m === 11 ? { a: mois.a + 1, m: 0 } : { a: mois.a, m: mois.m + 1 })}
          className="rounded-lg px-2 py-0.5 text-[13px] font-black text-slate-400 hover:bg-slate-100">→</button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[8px] font-black uppercase text-slate-300">
        {JOURS_FR.map((j, i) => <div key={i} className="pb-0.5">{j}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cases.map((j, i) => j === null ? <div key={i} /> : (
          <button key={i} onClick={() => onChoisit(`${j}/${mois.m + 1}/${mois.a}`)}
            className={"h-6 rounded-md text-[10.5px] font-bold transition-colors " +
              (sel && sel.j === j && sel.m === mois.m && sel.a === mois.a
                ? "bg-cyan-500 text-white"
                : j === auj.getDate() && mois.m === auj.getMonth() && mois.a === auj.getFullYear()
                  ? "text-cyan-600 hover:bg-cyan-50"
                  : "text-slate-600 hover:bg-slate-100")}>
            {j}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---- Bouton « 🎤 Dicter » : transcription vocale (Web Speech API du
        navigateur, en français) qui AJOUTE le texte reconnu à la fin du
        champ ciblé. Recliquer pendant l'écoute = arrêt. La valeur du champ
        est figée dans un ref au DÉBUT de l'écoute et chaque segment reconnu
        s'y empile : la dictée ne « saute » jamais, le texte arrive au fil de
        la parole (résultats intermédiaires visibles en direct). Navigateur
        sans dictée (Firefox, anciens Safari) → bouton simplement masqué. ---- */
function Dictee({ valeur, onTexte }: { valeur: string; onTexte: (t: string) => void }) {
  const [ecoute, setEcoute] = useState(false);
  const [erreur, setErreur] = useState("");
  const recRef = useRef<any>(null);
  const baseRef = useRef("");
  const accRef = useRef("");
  // Arrêt propre si le formulaire se ferme pendant une écoute.
  useEffect(() => () => { try { recRef.current?.stop(); } catch {} }, []);
  const SR = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : undefined;
  if (!SR) return null;
  const demarrer = () => {
    try {
      const rec = new SR();
      rec.lang = "fr-FR";
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e: any) => {
        let final = "", interime = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) final += r[0].transcript; else interime += r[0].transcript;
        }
        if (final.trim()) accRef.current = (accRef.current ? accRef.current + " " : "") + final.trim();
        onTexte(((baseRef.current ? baseRef.current + " " : "") + accRef.current + (interime.trim() ? " " + interime.trim() : "")).replace(/\s+/g, " ").trim());
      };
      rec.onerror = (e: any) => { setErreur(e && e.error === "not-allowed" ? "micro refusé" : "erreur micro"); setEcoute(false); };
      rec.onend = () => setEcoute(false);
      baseRef.current = valeur.trim();
      accRef.current = "";
      recRef.current = rec;
      setErreur("");
      setEcoute(true);
      rec.start();
    } catch { setErreur("démarrage impossible"); setEcoute(false); }
  };
  return (
    <button onClick={() => { if (ecoute) { try { recRef.current?.stop(); } catch {} setEcoute(false); } else demarrer(); }}
      title={erreur ? "Micro refusé : vérifie l'autorisation du navigateur (icône cadenas → Micro). En preview le micro est bloqué par l'iframe — en production ça marche." : "Dicter au micro : le texte reconnu s'ajoute à la fin du champ"}
      className={"flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-[10.5px] font-black transition-colors " + (ecoute ? "bg-rose-100 text-rose-600" : "bg-slate-100 text-slate-500 hover:bg-slate-200")}
      style={ecoute ? { boxShadow: "0 0 0 2px #fda4af55" } : undefined}>
      <span className={ecoute ? "animate-pulse" : ""}>{ecoute ? "⏺" : "🎤"}</span>
      {ecoute ? "En écoute — recliquer pour arrêter" : "Dicter"}
      {erreur ? <span className="text-rose-500">· {erreur}</span> : null}
    </button>
  );
}


// ── Modale « tâche » PARTAGÉE : le même panneau s'ouvre depuis l'agenda
// (pastille d'un jour) ET depuis les badges « À faire / Réalisée » de la
// timeline d'une fiche entreprise — modifier, clôturer, rouvrir, ouvrir la
// fiche, clôturer & créer la tâche suivante. Montée conditionnellement :
// ses champs repartent des props à chaque ouverture. ──
function ModaleTache({ kind, titre, contexte, dateFr, heure, fait, lien, onOuvre, onFermer, onModifier, onCloturer, onRouvrir, onCloturerEtSuivante }: {
  kind: "tache" | "reunion"; titre: string; contexte: string; dateFr: string; heure?: string; fait: boolean;
  lien: Cible; onOuvre: (c: Cible) => void; onFermer: () => void;
  onModifier: (titre: string, echeance: string, heure?: string) => void;
  onCloturer: () => void; onRouvrir: () => void;
  onCloturerEtSuivante: (texte: string, echeance: string) => void;
}) {
  const CH_FORM = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12.5px] outline-none focus:border-cyan-500";
  const COULEUR_KIND: Record<string, string> = { tache: "#8b5cf6", reunion: "#ef8f3c", deal: "#4f9ee8" };
  const ICONES_KIND: Record<string, string> = { tache: "📌", reunion: "📅", deal: "🎯" };
  const [modTitre, setModTitre] = useState(titre);
  const [modDate, setModDate] = useState(dateFr);
  const [modHeure, setModHeure] = useState(heure || "");
  const [modCalOuvert, setModCalOuvert] = useState(false);
  const [suivTexte, setSuivTexte] = useState("");
  const [suivDate, setSuivDate] = useState(dateFr);
  const [suivCalOuvert, setSuivCalOuvert] = useState(false);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      {...fermerAuClicFond(onFermer)}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <motion.div onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 12, opacity: 0 }}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-1 flex items-center gap-2 text-[15px] font-black text-slate-800">
          <span>{fait ? "✓" : ICONES_KIND[kind]}</span>
          <span style={{ color: fait ? "#059669" : COULEUR_KIND[kind] }}>{fait ? "Tâche clôturée" : kind === "reunion" ? "Réunion planifiée" : "Tâche à faire"}</span>
        </div>
        <div className="mb-4 text-[11.5px] text-slate-400">{contexte} · échéance {dateFr}{heure ? " · " + heure : ""}</div>

        {/* ── 1. Modifier ── */}
        <div className="text-[11px] font-black uppercase tracking-wider text-slate-500">✏️ Modifier</div>
        <input value={modTitre} onChange={(e) => setModTitre(e.target.value)}
          placeholder="Titre de la tâche…"
          className={CH_FORM + " mt-1.5"} />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <button onClick={() => setModCalOuvert((v) => !v)}
              className={CH_FORM + " bg-white text-left " + (modDate ? "font-bold text-slate-800" : "text-slate-400")}>
              📅 {modDate || "Choisir la date…"}
            </button>
            {modCalOuvert && (
              <MiniCalendrier valeur={modDate}
                onChoisit={(v) => { setModDate(v); setModCalOuvert(false); }} />
            )}
          </div>
          <input type="time" value={modHeure} onChange={(e) => setModHeure(e.target.value)}
            title="Heure (optionnelle)"
            className={CH_FORM} />
        </div>
        <button onClick={() => onModifier(modTitre.trim(), modDate.trim(), modHeure.trim() || undefined)} disabled={!modTitre.trim() || !modDate}
          className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 py-2 text-[12px] font-black text-slate-600 hover:bg-slate-100 disabled:opacity-40">
          💾 Enregistrer la modification
        </button>

        {/* ── 2. Clôturer / rouvrir ── */}
        <div className="mt-4 flex gap-2">
          {fait ? (
            <button onClick={onRouvrir}
              className="flex-1 rounded-xl border border-amber-200 bg-amber-50 py-2 text-[12px] font-black text-amber-700 hover:bg-amber-100">
              ↩️ Rouvrir cette tâche
            </button>
          ) : (
            <button onClick={onCloturer}
              className="flex-1 rounded-xl border border-emerald-200 bg-emerald-50 py-2 text-[12px] font-black text-emerald-700 hover:bg-emerald-100">
              ✓ Clôturer (réalisée)
            </button>
          )}
          <button onClick={() => { onOuvre(lien); onFermer(); }}
            className="rounded-xl border border-slate-200 px-3 py-2 text-[12px] font-bold text-slate-500 hover:bg-slate-50">
            Ouvrir la fiche ↗
          </button>
        </div>

        {/* ── 3. Clôturer & créer la tâche suivante ── */}
        {!fait && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="text-[10.5px] font-black uppercase tracking-wider text-violet-600">➕ Clôturer & créer la tâche suivante</div>
            <input value={suivTexte} onChange={(e) => setSuivTexte(e.target.value)}
              placeholder="Que doit-on faire ensuite ?"
              className={CH_FORM + " mt-1.5"} />
            <div className="mt-2">
              <button onClick={() => setSuivCalOuvert((v) => !v)}
                className={CH_FORM + " bg-white text-left " + (suivDate ? "font-bold text-slate-800" : "text-slate-400")}>
                📅 {suivDate || "Choisir la date…"}
              </button>
              {suivCalOuvert && (
                <MiniCalendrier valeur={suivDate}
                  onChoisit={(v) => { setSuivDate(v); setSuivCalOuvert(false); }} />
              )}
            </div>
            <button onClick={() => onCloturerEtSuivante(suivTexte.trim(), suivDate.trim())} disabled={!suivTexte.trim() || !suivDate.trim()}
              className="mt-2 w-full rounded-xl py-2 text-[12px] font-black text-white disabled:opacity-40"
              style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>
              ✓ Clôturer & planifier la suivante
            </button>
            <p className="mt-1 text-[10.5px] text-slate-400">La tâche courante passe en « réalisée » et la nouvelle apparaît dans l'agenda à la date choisie.</p>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
function VueAgenda({ etat, onOuvre, onAjouter, onMajActivite }: { etat: Etat; onOuvre: (c: Cible) => void; onAjouter: (id: string, activite: Activite) => void; onMajActivite: (id: string, ev: Activite, patch: Partial<Activite>) => void }) {
  const auj = new Date();
  const [mode, setMode] = useState<"mois" | "semaine">("mois");
  const [curseur, setCurseur] = useState({ a: auj.getFullYear(), m: auj.getMonth() }); // mois affiché
  // Semaine affichée (mode semaine) : on garde une date de référence dans la semaine.
  const [refSem, setRefSem] = useState(new Date(auj.getFullYear(), auj.getMonth(), auj.getDate()));
  const [jourSel, setJourSel] = useState<{ j: number; m: number; a: number } | null>({ j: auj.getDate(), m: auj.getMonth(), a: auj.getFullYear() }); // jour sélectionné

  // ── Formulaire « ➕ Consigner » : ce qui a été fait (compte-rendu horodaté,
  //    relié à une entreprise + contact/deal optionnels), puis l'action
  //    suivante (tâche/réunion avec échéance) qui atterrit dans l'agenda. ──
  const [formOuvert, setFormOuvert] = useState(false);
  const [entId, setEntId] = useState("");
  const [ctId, setCtId] = useState("");
  const [dlId, setDlId] = useState("");
  const [typeFait, setTypeFait] = useState<"note" | "email" | "appel" | "tache" | "reunion">("appel");
  const [texteFait, setTexteFait] = useState("");
  const aujourdhui = dateParis();
  const [dateFait, setDateFait] = useState(aujourdhui);
  const [avecSuivante, setAvecSuivante] = useState(true);
  const [typeSuivante, setTypeSuivante] = useState<"tache" | "reunion">("tache");
  const [texteSuivante, setTexteSuivante] = useState("");
  const [echeanceSuivante, setEcheanceSuivante] = useState("");
  // Barre de recherche d'entreprise + mini-calendriers (date de réalisation
  // et échéance de l'action suivante).
  const [rechercheEnt, setRechercheEnt] = useState("");
  const [calFaitOuvert, setCalFaitOuvert] = useState(false);
  const [calOuvert, setCalOuvert] = useState(false);
  // ── Panneau « tâche » : ouvrir une pastille de l'agenda pour MODIFIER,
  //    CLÔTURER ou créer la tâche suivante — sans quitter l'agenda. ──
  const [tacheOuverte, setTacheOuverte] = useState<EvenementAgenda | null>(null);
  const [modTitre, setModTitre] = useState("");
  const [modDate, setModDate] = useState("");
  const [modHeure, setModHeure] = useState("");
  const [modCalOuvert, setModCalOuvert] = useState(false);
  const [suivTexte, setSuivTexte] = useState("");
  const [suivDate, setSuivDate] = useState("");
  const [suivCalOuvert, setSuivCalOuvert] = useState(false);
  const [bandeau, setBandeau] = useState("");
  // ── Création rapide d'une tâche sur le jour sélectionné ──
  const [nouvelleOuverte, setNouvelleOuverte] = useState(false);
  const [nvEnt, setNvEnt] = useState("");
  const [nvRech, setNvRech] = useState("");
  const [nvTitre, setNvTitre] = useState("");
  const [nvHeure, setNvHeure] = useState("");
  // Entreprise choisie (pour l'affichage en « chip ») + résultats de recherche
  // (nom, enseigne, ville — et TÉLÉPHONE en saisie souple).
  const entChoisie = etat.entreprises.find((x) => x.id === entId);
  const qEnt = rechercheEnt.toLowerCase().trim();
  const resultatsEnt = etat.entreprises.filter((x) => !qEnt
    || [x.nom, x.nomCommercial, x.ville].join(" ").toLowerCase().includes(qEnt)
    || telCorrespond(qEnt, x.tel));
  const fermerForm = () => {
    setFormOuvert(false); setEntId(""); setCtId(""); setDlId("");
    setTypeFait("appel"); setTexteFait(""); setDateFait(aujourdhui);
    setAvecSuivante(true); setTypeSuivante("tache"); setTexteSuivante(""); setEcheanceSuivante("");
    setRechercheEnt(""); setCalOuvert(false); setCalFaitOuvert(false);
  };
  // Listes de rattachement : contacts & deals de l'entreprise choisie.
  const contactsEnt = entId ? etat.contacts.filter((c) => c.entrepriseIds.includes(entId)) : [];
  const dealsEnt = entId ? etat.deals.filter((d) => d.entrepriseId === entId) : [];
  // L'échéance de l'action suivante est pré-remplie avec le jour sélectionné
  // dans le calendrier (pratique : « je consigne ce que j'ai fait pour X, la
  // suite est pour le jour que je regarde »).
  const ouvrirForm = () => {
    setEcheanceSuivante(jourSel ? `${jourSel.j}/${jourSel.m + 1}/${jourSel.a}` : "");
    setFormOuvert(true);
  };
  const validerForm = () => {
    if (!entId || !texteFait.trim()) return;
    const estAuj = dateFait === dateParis();
    const base = { date: estAuj ? "auj." : (dateFait.slice(0, 5) || "auj."), dateISO: dateFait || aujourdhui, heure: heureParis(), contactId: ctId || undefined, dealId: dlId || undefined };
    // 1. L'activité réalisée (compte-rendu horodaté sur l'entreprise).
    onAjouter(entId, { ...base, texte: texteFait.trim(), type: typeFait });
    // 2. L'action suivante : tâche/réunion datée → visible dans l'agenda
    //    dès l'enregistrement (mêmes liens contact/deal).
    if (avecSuivante && texteSuivante.trim() && echeanceSuivante.trim()) {
      onAjouter(entId, { ...base, texte: texteSuivante.trim(), type: typeSuivante, echeance: echeanceSuivante.trim() });
    }
    fermerForm();
  };
  const CH_FORM = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12.5px] outline-none focus:border-cyan-500";

  // Collecte MÉMOÏSÉE de tous les « à faire » datés : tâches/réunions des
  // activités (portées par les entreprises, liens contact/deal résolus) +
  // prochaines actions des deals. Index par
  // date « j/m/a » → un seul calcul par changement de `etat` (perf).
  type EvenementAgenda = { date: { j: number; m: number; a: number }; kind: "tache" | "reunion" | "deal"; titre: string; contexte: string; lien: Cible; entId: string; act?: Activite; fait?: boolean; heure?: string };
  const parJour = useMemo(() => {
    const evts: EvenementAgenda[] = [];
    const nomEntreprise = new Map(etat.entreprises.map((e) => [e.id, e.nom]));
    const nomContact = new Map(etat.contacts.map((c) => [c.id, c.prenom + " " + c.nom]));
    // Les activités ne vivent QUE sur les entreprises : la collecte parcourt
    // uniquement leurs listes, et chaque événement résout ses liens
    // `contactId`/`dealId` pour ouvrir directement la bonne fiche.
    for (const e of etat.entreprises) for (const ac of e.activites) {
      const d = parseEcheance(ac.echeance || "");
      if (d && (ac.type === "tache" || ac.type === "reunion")) {
        const ct = ac.contactId ? nomContact.get(ac.contactId) : null;
        evts.push({
          date: d, kind: ac.type, titre: ac.texte,
          contexte: e.nom + (ct ? " · " + ct : ""),
          lien: ac.dealId ? ({ type: "deal", id: ac.dealId, preset: "" } as Cible)
            : ac.contactId ? ({ type: "contact", id: ac.contactId } as Cible)
            : ({ type: "entreprise", id: e.id } as Cible),
          entId: e.id, act: ac, fait: !!ac.fait, heure: ac.heure,
        });
      }
    }
    for (const d of etat.deals) {
      // Contexte = entreprise liée au deal (repli sur le nom du deal).
      const soc = nomEntreprise.get(d.entrepriseId) || ("Deal « " + d.nom + " »");
      const ed = parseEcheance(d.echeance);
      if (d.action && !d.fait && ed) evts.push({ date: ed, kind: "deal", titre: d.action, contexte: soc, lien: { type: "deal", id: d.id, preset: "" } as Cible, entId: d.entrepriseId });
    }
    const idx = new Map<string, EvenementAgenda[]>();
    for (const ev of evts) {
      const cle = ev.date.j + "/" + ev.date.m + "/" + ev.date.a;
      if (!idx.has(cle)) idx.set(cle, []);
      idx.get(cle)!.push(ev);
    }
    return idx;
  }, [etat]);
  const duJour = (d: { j: number; m: number; a: number }) => parJour.get(d.j + "/" + d.m + "/" + d.a) || [];

  const estAuj = (d: { j: number; m: number; a: number }) => d.j === auj.getDate() && d.m === auj.getMonth() && d.a === auj.getFullYear();
  const estSel = (d: { j: number; m: number; a: number }) => jourSel && d.j === jourSel.j && d.m === jourSel.m && d.a === jourSel.a;
  const COULEUR_KIND: Record<string, string> = { tache: "#8b5cf6", reunion: "#ef8f3c", deal: "#4f9ee8" };
  const ICONES_KIND: Record<string, string> = { tache: "📌", reunion: "📅", deal: "🎯" };

  // Rendu d’une puce d’événement (fonction simple, PAS un composant :
  // évite le remontage de toutes les puces à chaque interaction).
  const puce = (ev: EvenementAgenda) => (
    <button key={ev.titre + ev.contexte + (ev.act ? "a" : "d")} onClick={(e) => { e.stopPropagation(); ouvrirTache(ev); }}
      title="Cliquer pour modifier, clôturer ou créer la tâche suivante"
      className="flex w-full items-start gap-1 rounded-md px-1 py-0.5 text-left text-[9.5px] font-bold hover:bg-white/70"
      style={{ background: ev.fait ? "#10b98118" : COULEUR_KIND[ev.kind] + "18", color: ev.fait ? "#059669" : COULEUR_KIND[ev.kind] }}>
      <span className="shrink-0 text-[8px] leading-3">{ev.fait ? "✓" : ICONES_KIND[ev.kind]}</span>
      {/* Titre de l'événement + 2e ligne grise : qui / quelle entreprise.
          Les tâches clôturées RESTENT visibles (vert, barrées). */}
      <span className="min-w-0 flex-1">
        <span className={"block truncate leading-tight" + (ev.fait ? " line-through opacity-70" : "")}>{ev.titre}</span>
        <span className="block truncate text-[7.5px] font-semibold leading-tight text-slate-400">{ev.contexte}</span>
      </span>
    </button>
  );

  const selEvenements = jourSel ? duJour(jourSel) : [];
  // Ouvre le panneau « tâche » (modifier / clôturer / créer la suivante).
  // Les événements « deal » n'ont pas d'activité modifiable : fiche directe.
  const ouvrirTache = (ev: EvenementAgenda) => {
    if (!ev.act) { onOuvre(ev.lien); return; }
    setTacheOuverte(ev);
    setModTitre(ev.titre);
    setModDate(ev.date.j + "/" + (ev.date.m + 1) + "/" + ev.date.a);
    setModHeure(ev.heure || "");
    setModCalOuvert(false);
    setSuivTexte("");
    setSuivDate(ev.date.j + "/" + (ev.date.m + 1) + "/" + ev.date.a);
    setSuivCalOuvert(false);
  };
  // Enregistre la modification (titre / date / heure) de la tâche ouverte.
  const validerModif = () => {
    if (!tacheOuverte?.act || !modTitre.trim() || !modDate.trim()) return;
    onMajActivite(tacheOuverte.entId, tacheOuverte.act, { texte: modTitre.trim(), echeance: modDate.trim(), heure: modHeure.trim() || undefined });
    setBandeau("✅ Tâche modifiée (le calendrier suit la nouvelle date).");
    setTacheOuverte(null);
  };
  // Clôture la tâche ouverte (elle reste visible, barrée en vert).
  const cloturerTache = () => {
    if (!tacheOuverte?.act) return;
    onMajActivite(tacheOuverte.entId, tacheOuverte.act, { fait: true, clotureLe: dateParis() });
    setBandeau("✅ Tâche clôturée — elle reste visible dans le calendrier (barrée).");
    setTacheOuverte(null);
  };
  // Rouvre une tâche clôturée par erreur.
  const rouvrirTache = () => {
    if (!tacheOuverte?.act) return;
    onMajActivite(tacheOuverte.entId, tacheOuverte.act, { fait: false, clotureLe: undefined });
    setBandeau("↩️ Tâche rouverte — elle redevient « à faire ».");
    setTacheOuverte(null);
  };
  // Clôture la tâche courante ET crée la tâche suivante (nouvelle date + commentaire).
  const cloturerEtSuivante = () => {
    if (!tacheOuverte?.act || !suivTexte.trim() || !suivDate.trim()) return;
    onMajActivite(tacheOuverte.entId, tacheOuverte.act, { fait: true, clotureLe: dateParis() });
    onAjouter(tacheOuverte.entId, { date: "auj.", texte: suivTexte.trim(), type: "tache", echeance: suivDate.trim(), dateISO: dateParis(), heure: heureParis(), contactId: tacheOuverte.act.contactId, dealId: tacheOuverte.act.dealId });
    setBandeau("✅ Tâche clôturée + tâche suivante créée pour le " + suivDate.trim() + ".");
    setTacheOuverte(null);
  };
  // ── Création rapide d'une tâche sur le jour sélectionné ──
  const resultatNvEnt = etat.entreprises.filter((x) => {
    const q2 = nvRech.toLowerCase().trim();
    if (!q2) return true;
    return [x.nom, x.nomCommercial, x.ville].join(" ").toLowerCase().includes(q2) || telCorrespond(q2, x.tel);
  });
  const creerNouvelleTache = () => {
    if (!nvEnt || !nvTitre.trim()) return;
    const d = jourSel ? jourSel.j + "/" + (jourSel.m + 1) + "/" + jourSel.a : "";
    onAjouter(nvEnt, { date: "auj.", texte: nvTitre.trim(), type: "tache", echeance: d, dateISO: dateParis(), heure: nvHeure.trim() || heureParis() });
    setBandeau("📌 Tâche créée" + (d ? " pour le " + d : "") + ".");
    setNouvelleOuverte(false); setNvEnt(""); setNvRech(""); setNvTitre(""); setNvHeure("");
  };


  // ── Grille du mois (mode « mois ») ──
  const nbJours = new Date(curseur.a, curseur.m + 1, 0).getDate();
  const decal = (new Date(curseur.a, curseur.m, 1).getDay() + 6) % 7;
  const cases: ({ j: number } | null)[] = Array(decal).fill(null).concat(
    Array.from({ length: nbJours }, (_, i) => ({ j: i + 1 }))
  );
  while (cases.length % 7 !== 0) cases.push(null);

  // ── Jours de la semaine affichée (mode « semaine ») : lundi → dimanche ──
  const lundi = new Date(refSem.getFullYear(), refSem.getMonth(), refSem.getDate() - ((refSem.getDay() + 6) % 7));
  const joursSemaine = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lundi.getFullYear(), lundi.getMonth(), lundi.getDate() + i);
    return { j: d.getDate(), m: d.getMonth(), a: d.getFullYear() };
  });

  const titrePeriode = mode === "mois"
    ? MOIS_FR[curseur.m] + " " + curseur.a
    : joursSemaine[0].j + " " + MOIS_FR[joursSemaine[0].m] + " – " + joursSemaine[6].j + " " + MOIS_FR[joursSemaine[6].m] + " " + joursSemaine[6].a;
  const periodePrecedente = () => mode === "mois"
    ? setCurseur(curseur.m === 0 ? { a: curseur.a - 1, m: 11 } : { a: curseur.a, m: curseur.m - 1 })
    : setRefSem(new Date(refSem.getFullYear(), refSem.getMonth(), refSem.getDate() - 7));
  const periodeSuivante = () => mode === "mois"
    ? setCurseur(curseur.m === 11 ? { a: curseur.a + 1, m: 0 } : { a: curseur.a, m: curseur.m + 1 })
    : setRefSem(new Date(refSem.getFullYear(), refSem.getMonth(), refSem.getDate() + 7));

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        {/* En-tête : navigation période + bascule Mois/Semaine + Aujourd’hui */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button onClick={periodePrecedente}
              className="rounded-xl px-2.5 py-1 text-[13px] font-black text-slate-400 hover:bg-slate-100">←</button>
            <div className="text-[14px] font-black capitalize text-slate-800">{titrePeriode}</div>
            <button onClick={periodeSuivante}
              className="rounded-xl px-2.5 py-1 text-[13px] font-black text-slate-400 hover:bg-slate-100">→</button>
            <button onClick={() => { setCurseur({ a: auj.getFullYear(), m: auj.getMonth() }); setRefSem(new Date(auj.getFullYear(), auj.getMonth(), auj.getDate())); setJourSel({ j: auj.getDate(), m: auj.getMonth(), a: auj.getFullYear() }); }}
              className="rounded-xl border border-slate-200 px-2 py-1 text-[10.5px] font-black text-slate-500 hover:bg-slate-50">Aujourd’hui</button>
          </div>
          {/* Bouton « Consigner » (ce qui a été fait + action suivante) et
              bascule Mois/Semaine. */}
          <div className="flex items-center gap-2">
            <button onClick={ouvrirForm}
              className="rounded-xl px-3 py-1.5 text-[11.5px] font-black text-white"
              style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>➕ Consigner</button>
            <div className="flex gap-1 rounded-xl bg-slate-100 p-0.5">
              {(["mois", "semaine"] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)}
                  className={"rounded-lg px-3 py-1 text-[11.5px] font-black capitalize " + (mode === m ? "bg-white text-cyan-700 shadow-sm" : "text-slate-400 hover:text-slate-600")}>{m}</button>
              ))}
            </div>
          </div>
        </div>

        {mode === "mois" ? (
          <>
            <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] font-black uppercase text-slate-400">
              {JOURS_FR.map((j, i) => <div key={i}>{j}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cases.map((c, i) => c === null ? <div key={i} /> : (() => { const evs = duJour({ j: c.j, m: curseur.m, a: curseur.a }); return (
                <div key={i} onClick={() => setJourSel({ j: c.j, m: curseur.m, a: curseur.a })}
                  className={"flex h-20 cursor-pointer flex-col rounded-xl border p-1 text-left transition-colors " + (estSel({ j: c.j, m: curseur.m, a: curseur.a }) ? "border-cyan-400 bg-cyan-50" : estAuj({ j: c.j, m: curseur.m, a: curseur.a }) ? "border-slate-300 bg-slate-50" : "border-slate-100 hover:bg-slate-50")}>
                  <span className={"text-[10.5px] font-bold " + (estAuj({ j: c.j, m: curseur.m, a: curseur.a }) ? "text-cyan-600" : "text-slate-500")}>{c.j}</span>
                  {/* Événements visibles directement dans la case (2 max, puis +n) */}
                  <div className="mt-0.5 flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
                    {evs.slice(0, 2).map(puce)}
                    {evs.length > 2 && (
                      <span className="pl-1 text-[9px] font-black text-slate-400">+{evs.length - 2} autre{evs.length - 2 > 1 ? "s" : ""}</span>
                    )}
                  </div>
                </div>
              ); })())}
            </div>
          </>
        ) : (
          <>
            {/* ── Vue semaine : 7 colonnes cliquables en entier, événements listés ── */}
            <div className="grid grid-cols-7 gap-1">
              {joursSemaine.map((d, i) => (
                <div key={i} onClick={() => setJourSel(d)}
                  className={"flex min-h-64 cursor-pointer flex-col rounded-xl border p-1.5 transition-colors " + (estSel(d) ? "border-cyan-400 bg-cyan-50 ring-2 ring-cyan-200" : estAuj(d) ? "border-slate-300 bg-slate-50 hover:border-cyan-300" : "border-slate-100 hover:border-cyan-300")}>
                  <div className="mb-1 text-left">
                    <span className="text-[9px] font-black uppercase text-slate-400">{JOURS_FR[i]}</span>
                    <span className={"ml-1 text-[12px] font-black " + (estAuj(d) ? "text-cyan-600" : "text-slate-700")}>{d.j}</span>
                  </div>
                  <div className="flex flex-1 flex-col gap-1 overflow-y-auto">
                    {duJour(d).map(puce)}
                    {duJour(d).length === 0 && <span className="text-[9.5px] italic text-slate-300">—</span>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      {/* ── Panneau du jour sélectionné ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-slate-400">À faire</div>
        <div className="mb-3 text-[14px] font-black capitalize text-slate-800">
          {jourSel ? jourSel.j + " " + MOIS_FR[jourSel.m] + " " + jourSel.a : "—"}
          {jourSel && estAuj(jourSel) && <span className="ml-1.5 rounded-full bg-cyan-100 px-1.5 py-0.5 text-[9px] font-black text-cyan-700">aujourd’hui</span>}
        </div>
        {bandeau && (
          <div className="mb-2 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-bold text-emerald-700">{bandeau}</div>
        )}
        <div className="mb-2">
          <button onClick={() => { setNouvelleOuverte(true); setNvEnt(""); setNvRech(""); setNvTitre(""); setNvHeure(""); }}
            className="rounded-xl border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-[11px] font-black text-cyan-700 hover:bg-cyan-100">
            ➕ Nouvelle tâche {jourSel ? "le " + jourSel.j + "/" + (jourSel.m + 1) : ""}
          </button>
        </div>
        {jourSel && duJour(jourSel).length === 0 && (
          <div className="text-[12px] text-slate-400">Rien à faire ce jour-là. 🎉</div>
        )}
        <div className="space-y-1.5">
          {selEvenements.map((ev, i) => (
            <button key={i} onClick={() => ouvrirTache(ev)}
              className="w-full rounded-xl border border-slate-100 p-2 text-left hover:bg-slate-50">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px]">{ev.fait ? "✓" : ICONES_KIND[ev.kind]}</span>
                <span className="truncate text-[11.5px] font-bold" style={{ color: ev.fait ? "#059669" : COULEUR_KIND[ev.kind] }}>{ev.contexte}</span>
              </div>
              <div className={"text-[12px] leading-snug " + (ev.fait ? "text-slate-400 line-through" : "text-slate-700")}>{ev.titre}</div>
              {ev.act && <div className="mt-0.5 text-[10px] font-bold text-slate-300">cliquer pour modifier · clôturer · créer la suivante</div>}
            </button>
          ))}
        </div>
        {/* Légende des couleurs. */}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-2 text-[10px] font-bold text-slate-400">
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: "#8b5cf6" }} />Tâche</span>
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: "#ef8f3c" }} />Réunion</span>
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: "#4f9ee8" }} />Action deal</span>
        </div>
      </div>

      {/* ── Overlay « Consigner une activité » : ce qui a été fait (+ liens
      {/* ── Panneau « tâche » : la modale partagée ModaleTache — le MÊME
          panneau que depuis les badges de la timeline d'une fiche entreprise. ── */}
      <AnimatePresence>
        {tacheOuverte && tacheOuverte.act && (() => {
          const ev = tacheOuverte;
          return (
            <ModaleTache kind={ev.kind} titre={ev.titre} contexte={ev.contexte}
              dateFr={ev.date.j + "/" + (ev.date.m + 1) + "/" + ev.date.a}
              heure={ev.heure} fait={!!ev.fait} lien={ev.lien}
              onOuvre={onOuvre} onFermer={() => setTacheOuverte(null)}
              onModifier={(t, d, h) => {
                onMajActivite(ev.entId, ev.act, { texte: t, echeance: d, heure: h });
                setBandeau("✅ Tâche modifiée (le calendrier suit la nouvelle date).");
                setTacheOuverte(null);
              }}
              onCloturer={() => {
                onMajActivite(ev.entId, ev.act, { fait: true, clotureLe: dateParis() });
                setBandeau("✅ Tâche clôturée — elle reste visible dans le calendrier (barrée).");
                setTacheOuverte(null);
              }}
              onRouvrir={() => {
                onMajActivite(ev.entId, ev.act, { fait: false, clotureLe: undefined });
                setBandeau("↩️ Tâche rouverte — elle redevient « à faire ».");
                setTacheOuverte(null);
              }}
              onCloturerEtSuivante={(txt, d) => {
                onMajActivite(ev.entId, ev.act, { fait: true, clotureLe: dateParis() });
                onAjouter(ev.entId, { date: "auj.", texte: txt, type: "tache", echeance: d, dateISO: dateParis(), heure: heureParis(), contactId: ev.act.contactId, dealId: ev.act.dealId });
                setBandeau("✅ Tâche clôturée + tâche suivante créée pour le " + d + ".");
                setTacheOuverte(null);
              }} />
          );
        })()}
      </AnimatePresence>

      {/* ── Création rapide d'une tâche (bouton « ➕ Nouvelle tâche ») ── */}
      <AnimatePresence>
        {nouvelleOuverte && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            {...fermerAuClicFond(() => setNouvelleOuverte(false))}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
            <motion.div onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 12, opacity: 0 }}
              className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
              <div className="mb-1 text-[15px] font-black text-slate-800">📌 Nouvelle tâche{jourSel ? " — " + jourSel.j + " " + MOIS_FR[jourSel.m] + " " + jourSel.a : ""}</div>
              <div className="mb-4 text-[11.5px] text-slate-400">Rattachée à une entreprise : elle apparaît dans l'agenda et sur sa fiche.</div>
              {nvEnt ? (
                <div className="flex items-center justify-between rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2">
                  <span className="truncate text-[12.5px] font-bold text-cyan-800">🏢 {etat.entreprises.find((x) => x.id === nvEnt)?.nom}</span>
                  <button onClick={() => setNvEnt("")} className="ml-2 shrink-0 text-[12px] font-black text-cyan-400 hover:text-cyan-600">✕</button>
                </div>
              ) : (
                <div>
                  <input value={nvRech} onChange={(e) => setNvRech(e.target.value)}
                    placeholder="🔎 Entreprise…"
                    className={CH_FORM} />
                  <div className="mt-1.5 max-h-36 overflow-y-auto rounded-xl border border-slate-100">
                    {resultatNvEnt.slice(0, 20).map((x) => (
                      <button key={x.id} onClick={() => setNvEnt(x.id)}
                        className="flex w-full items-center justify-between gap-2 border-b border-slate-50 px-3 py-1.5 text-left last:border-0 hover:bg-slate-50">
                        <span className="truncate text-[12px] font-bold text-slate-700">{x.nom}</span>
                        <span className="shrink-0 text-[10px] font-medium text-slate-400">{x.ville}</span>
                      </button>
                    ))}
                    {resultatNvEnt.length === 0 && <div className="px-3 py-2 text-[11.5px] text-slate-400">Aucune entreprise trouvée.</div>}
                  </div>
                </div>
              )}
              <input value={nvTitre} onChange={(e) => setNvTitre(e.target.value)}
                placeholder="Que doit-on faire ?"
                className={CH_FORM + " mt-2"} />
              <input type="time" value={nvHeure} onChange={(e) => setNvHeure(e.target.value)}
                title="Heure (optionnelle)"
                className={CH_FORM + " mt-2"} />
              <div className="mt-4 flex gap-2">
                <button onClick={() => setNouvelleOuverte(false)}
                  className="flex-1 rounded-xl border border-slate-200 py-2.5 text-[13px] font-bold text-slate-400 hover:bg-slate-50">Annuler</button>
                <button onClick={creerNouvelleTache} disabled={!nvEnt || !nvTitre.trim()}
                  className="flex-1 rounded-xl py-2.5 text-[13px] font-black text-white disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>Créer</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Formulaire « action suivante » : ouverte depuis une tâche clôturée,
          l'action suivante atterrit dans l'agenda. */}
      <AnimatePresence>
        {formOuvert && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            {...fermerAuClicFond(fermerForm)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
            <motion.div onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 12, opacity: 0 }}
              className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
              <div className="mb-1 text-[15px] font-black text-slate-800">➕ Consigner une activité</div>
              <div className="mb-4 text-[11.5px] text-slate-400">Ce qui a été fait, relié à un client / contact / deal — puis l'action suivante, planifiée dans l'agenda.</div>

              {/* Rattachement : l'entreprise est la source unique des activités.
                  Sélection par BARRE DE RECHERCHE (nom, enseigne, ville) puis
                  « chip » une fois choisie. */}
              <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-slate-400">Entreprise *</div>
              {entChoisie ? (
                <div className="flex items-center justify-between rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2">
                  <span className="truncate text-[12.5px] font-bold text-cyan-800">🏢 {entChoisie.nom}{entChoisie.ville ? <span className="font-medium text-cyan-500"> — {entChoisie.ville}</span> : ""}</span>
                  <button onClick={() => { setEntId(""); setCtId(""); setDlId(""); }}
                    className="ml-2 shrink-0 text-[12px] font-black text-cyan-400 hover:text-cyan-600">✕</button>
                </div>
              ) : (
                <div>
                  <input value={rechercheEnt} onChange={(e) => setRechercheEnt(e.target.value)}
                    placeholder="🔎 Rechercher une entreprise (nom, ville)…"
                    className={CH_FORM} />
                  <div className="mt-1.5 max-h-36 overflow-y-auto rounded-xl border border-slate-100">
                    {resultatsEnt.map((x) => (
                      <button key={x.id} onClick={() => { setEntId(x.id); setCtId(""); setDlId(""); }}
                        className="flex w-full items-center justify-between gap-2 border-b border-slate-50 px-3 py-1.5 text-left last:border-0 hover:bg-slate-50">
                        <span className="truncate text-[12px] font-bold text-slate-700">{x.nom}</span>
                        <span className="shrink-0 text-[10px] font-medium text-slate-400">{x.ville}</span>
                      </button>
                    ))}
                    {resultatsEnt.length === 0 && <div className="px-3 py-2 text-[11.5px] text-slate-400">Aucune entreprise trouvée.</div>}
                  </div>
                </div>
              )}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <select value={ctId} onChange={(e) => setCtId(e.target.value)} disabled={!entId}
                  className={CH_FORM + " bg-white disabled:bg-slate-50 disabled:text-slate-300"}>
                  <option value="">👤 Contact lié (optionnel)</option>
                  {contactsEnt.map((c) => <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>)}
                </select>
                <div className="flex items-center gap-1">
                  <select value={dlId} onChange={(e) => setDlId(e.target.value)} disabled={!entId}
                    className={"min-w-0 flex-1 " + CH_FORM + " bg-white disabled:bg-slate-50 disabled:text-slate-300"}>
                    <option value="">🎯 Deal lié (optionnel)</option>
                    {dealsEnt.map((d) => <option key={d.id} value={d.id}>{d.nom}</option>)}
                  </select>
                  <button onClick={() => onOuvre({ type: "deal", id: null, preset: entId })} disabled={!entId}
                    title="Créer un nouveau deal pour cette entreprise — sans quitter l’agenda"
                    className="shrink-0 rounded-xl border border-cyan-200 bg-cyan-50 px-2.5 py-[7px] font-black text-cyan-600 hover:bg-cyan-100 disabled:opacity-40 disabled:cursor-not-allowed">+</button>
                </div>
              </div>

              {/* Section 1 : ce qui a été fait. */}
              <div className="mt-4 mb-1.5 flex items-center justify-between gap-2">
                <div className="text-[11px] font-black uppercase tracking-wider text-slate-500">Ce qui a été fait</div>
                <Dictee valeur={texteFait} onTexte={setTexteFait} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {TYPES_COMPOSER.map((b) => (
                  <button key={b.type} onClick={() => setTypeFait(b.type)}
                    className="rounded-xl border px-2.5 py-1 text-[11.5px] font-bold transition-colors"
                    style={typeFait === b.type
                      ? { borderColor: META_ACT[b.type].couleur, background: META_ACT[b.type].couleur + "14", color: META_ACT[b.type].couleur }
                      : { borderColor: "#e2e8f0", background: "#ffffff", color: "#475569" }}>
                    {b.icone} {b.libelle}
                  </button>
                ))}
              </div>
              <textarea rows={2} value={texteFait} onChange={(e) => setTexteFait(e.target.value)}
                placeholder="Compte-rendu de ce qui a été fait…"
                className={"mt-2 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12.5px] outline-none focus:border-cyan-500"} />
              {/* Date de réalisation : saisie via mini-calendrier, pré-remplie
                  avec aujourd'hui (modifiable pour rattraper une action passée). */}
              <div className="mt-2">
                <button onClick={() => setCalFaitOuvert((v) => !v)}
                  className={CH_FORM + " bg-white text-left font-bold text-slate-800"}>
                  📅 Réalisé le {dateFait}
                </button>
                {calFaitOuvert && (
                  <MiniCalendrier valeur={dateFait}
                    onChoisit={(v) => { setDateFait(v); setCalFaitOuvert(false); }} />
                )}
              </div>

              {/* Section 2 : l'action suivante, planifiée dans l'agenda. */}
              <div className="mt-4 flex items-center justify-between">
                <div className="text-[11px] font-black uppercase tracking-wider text-slate-500">Action suivante → agenda</div>
                <button onClick={() => setAvecSuivante(!avecSuivante)}
                  className={"rounded-full px-2.5 py-1 text-[10.5px] font-black transition-colors " + (avecSuivante ? "bg-cyan-100 text-cyan-700" : "bg-slate-100 text-slate-400")}>
                  {avecSuivante ? "✓ Planifiée" : "＋ Planifier"}
                </button>
              </div>
              {avecSuivante && (
                <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <div className="text-[10.5px] font-black uppercase tracking-wider" style={{ color: META_ACT[typeSuivante].couleur }}>
                      {META_ACT[typeSuivante].icone} {typeSuivante === "tache" ? "Tâche à faire" : "Réunion planifiée"}
                    </div>
                    <Dictee valeur={texteSuivante} onTexte={setTexteSuivante} />
                  </div>
                  <div className="mb-2 flex gap-1.5">
                    {(["tache", "reunion"] as const).map((t) => (
                      <button key={t} onClick={() => setTypeSuivante(t)}
                        className="rounded-lg border px-2.5 py-1 text-[11px] font-bold capitalize transition-colors"
                        style={typeSuivante === t
                          ? { borderColor: META_ACT[t].couleur, background: META_ACT[t].couleur + "14", color: META_ACT[t].couleur }
                          : { borderColor: "#e2e8f0", background: "#ffffff", color: "#94a3b8" }}>
                        {META_ACT[t].icone} {t === "tache" ? "Tâche" : "Réunion"}
                      </button>
                    ))}
                  </div>
                  <input value={texteSuivante} onChange={(e) => setTexteSuivante(e.target.value)}
                    placeholder="Que doit-on faire ensuite ?"
                    className={CH_FORM} />
                  {/* Échéance : saisie via mini-calendrier (clic sur un jour),
                      le bouton affiche la date choisie. */}
                  <div className="mt-2">
                    <button onClick={() => setCalOuvert((v) => !v)}
                      className={CH_FORM + " bg-white text-left " + (echeanceSuivante ? "font-bold text-slate-800" : "text-slate-400")}>
                      📅 {echeanceSuivante || "Choisir la date…"}
                    </button>
                    {calOuvert && (
                      <MiniCalendrier valeur={echeanceSuivante}
                        onChoisit={(v) => { setEcheanceSuivante(v); setCalOuvert(false); }} />
                    )}
                  </div>
                </div>
              )}

              {/* Validation : entreprise + compte-rendu obligatoires. */}
              <div className="mt-5 flex gap-2">
                <button onClick={fermerForm}
                  className="flex-1 rounded-xl border border-slate-200 py-2.5 text-[13px] font-bold text-slate-400 hover:bg-slate-50">Annuler</button>
                <button onClick={validerForm} disabled={!entId || !texteFait.trim()}
                  className="flex-1 rounded-xl py-2.5 text-[13px] font-black text-white disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>Enregistrer</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---- Tableau de bord : 6 KPIs + répartition du pipeline + actions à venir. ---- */
function VueDashboard({ etat, onOuvre }: { etat: Etat; onOuvre: (c: Cible) => void }) {
  // « Actif » = ni gagné ni perdu (tout ce qui est encore en jeu).
  const actifs = etat.deals.filter((d) => d.etape !== "Gagné" && d.etape !== "Perdu");
  const pipeline = actifs.reduce((s, d) => s + d.montant, 0);
  const gagnes = etat.deals.filter((d) => d.etape === "Gagné").reduce((s, d) => s + d.montant, 0);
  const fermes = etat.deals.filter((d) => d.etape === "Gagné" || d.etape === "Perdu").length;
  // Taux de closing = gagnés / deals fermés (gagnés + perdus). 0 si rien de fermé.
  const closing = fermes ? Math.round((etat.deals.filter((d) => d.etape === "Gagné").length / fermes) * 100) : 0;

  const kpis = [
    { label: "Pipeline actif", valeur: `${pipeline} k€`, couleur: "#4f9ee8" },
    { label: "Signés", valeur: `${gagnes} k€`, couleur: "#57c26b" },
    { label: "Taux de closing", valeur: `${closing} %`, couleur: "#8b5cf6" },
    { label: "Deals actifs", valeur: actifs.length, couleur: "#ef8f3c" },
    { label: "Entreprises", valeur: etat.entreprises.length, couleur: "#0ea5e9" },
    { label: "Contacts", valeur: etat.contacts.length, couleur: "#14b8a6" },
  ];

  // Deals avec une prochaine action non faite : c'est la liste « À surveiller ».
  const aSurveiller = etat.deals.filter((d) => d.action && !d.fait && d.etape !== "Gagné" && d.etape !== "Perdu");

  return (
    <div className="space-y-4">
      {/* Rangée de KPIs : 2 colonnes de base, jusqu'à 6 sur grand écran. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{k.label}</div>
            <div className="text-[22px] font-black" style={{ color: k.couleur }}>{k.valeur}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Répartition : barre horizontale par étape (hors « Perdu », moins parlant),
            normalisée par l'étape la plus lourde pour que 100% = max. */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 text-[13px] font-black text-slate-700">Répartition du pipeline</div>
          <div className="space-y-2.5">
            {ETAPES.filter((x) => x.nom !== "Perdu").map((x) => {
              const ds = etat.deals.filter((d) => d.etape === x.nom);
              const total = ds.reduce((s, d) => s + d.montant, 0);
              const max = Math.max(...ETAPES.map((y) => etat.deals.filter((d) => d.etape === y.nom).reduce((s, d) => s + d.montant, 0)), 1);
              return (
                <div key={x.nom}>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-slate-600">{x.nom}</span>
                    <span className="font-black text-slate-500">{ds.length} · {total} k€</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full" style={{ width: `${(total / max) * 100}%`, background: x.couleur }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {/* À surveiller : chaque ligne ouvre le deal concerné en modale. */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 text-[13px] font-black text-slate-700">Actions à venir ({aSurveiller.length})</div>
          <div className="space-y-2">
            {aSurveiller.length === 0 && <div className="text-[12px] text-slate-400">Rien en attente. 🎉</div>}
            {aSurveiller.map((d) => {
              const e = etat.entreprises.find((x) => x.id === d.entrepriseId);
              return (
                <button key={d.id} onClick={() => onOuvre({ type: "deal", id: d.id })}
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2 text-left hover:bg-slate-100">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: couleurEtape(d.etape) }} />
                  <span className="flex-1">
                    <span className="block text-[12px] font-bold text-slate-700">{d.action}</span>
                    <span className="block text-[10.5px] text-slate-400">{e?.nom} · {d.nom}</span>
                  </span>
                  <Badge texte={d.echeance || "—"} couleur={couleurEtape(d.etape)} />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Liste des entreprises : tableau à colonnes façon page index HubSpot. ----
   La recherche filtre sur nom + NOM COMMERCIAL + secteur + ville, insensible
   à la casse. */
function VueEntreprises({ etat, recherche, onOuvre }: { etat: Etat; recherche: string; onOuvre: (c: Cible) => void }) {
  const q = recherche.toLowerCase().trim();
  const liste = etat.entreprises.filter((e) =>
    !q || [e.nom, e.nomCommercial, e.statut, e.secteur, e.ville].join(" ").toLowerCase().includes(q) || telCorrespond(q, e.tel));
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Défilement horizontal si le panneau est étroit : les colonnes gardent
          une largeur lisible (min-w + whitespace-nowrap) au lieu de s'écraser. */}
      <div className="overflow-x-auto">
      <table className="w-full min-w-[700px] text-left">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            <th className="px-4 py-2.5">Entreprise</th>
            <th className="px-4 py-2.5">Statut</th>
            <th className="px-4 py-2.5">Ville</th>
            <th className="px-4 py-2.5">Téléphone</th>
            <th className="px-4 py-2.5">Contacts</th>
            <th className="px-4 py-2.5">Deals actifs</th>
            <th className="px-4 py-2.5 text-right">Pipeline</th>
          </tr>
        </thead>
        <tbody>
          {/* Compteurs (contacts, deals actifs, pipeline) recalculés par ligne :
              acceptable pour quelques centaines de lignes, sans dénormalisation. */}
          {liste.map((e) => {
            const nbC = etat.contacts.filter((c) => c.entrepriseIds.includes(e.id)).length;
            const actifs = etat.deals.filter((d) => d.entrepriseId === e.id && d.etape !== "Gagné" && d.etape !== "Perdu");
            return (
              /* Toute la ligne est cliquable → ouvre la page record de l'entreprise. */
              <tr key={e.id} onClick={() => onOuvre({ type: "entreprise", id: e.id })}
                className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2">
                    {/* Avatar carré arrondi avec initiales. */}
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
                {/* Badge coloré du statut : gris = Suspect, bleu = Prospect,
                    vert = Client (comme le cycle de vie HubSpot). */}
                <td className="whitespace-nowrap px-4 py-2.5">
                  <Badge texte={e.statut} couleur={COULEUR_STATUT[e.statut]} />
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-[12.5px] text-slate-500">{e.ville || "—"}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-[12.5px] text-slate-500">{e.tel || "—"}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-[12.5px] font-bold text-slate-600">{nbC}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-[12.5px] font-bold text-slate-600">{actifs.length}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right text-[12.5px] font-black text-slate-700">{actifs.reduce((s, d) => s + d.montant, 0)} k€</td>
              </tr>
            );
          })}
          {liste.length === 0 && (
            <tr><td colSpan={7} className="px-4 py-6 text-center text-[12px] text-slate-400">Aucune entreprise trouvée.</td></tr>
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

/* ---- Liste des contacts : même principe, tableau à colonnes. ----
   La recherche inclut le nom de l'entreprise du contact (recherche croisée). */
function VueContacts({ etat, recherche, onOuvre }: { etat: Etat; recherche: string; onOuvre: (c: Cible) => void }) {
  const q = recherche.toLowerCase().trim();
  const liste = etat.contacts.filter((c) => {
    // Recherche croisée : on matche aussi le nom de CHAQUE entreprise liée.
    const es = etat.entreprises.filter((x) => c.entrepriseIds.includes(x.id));
    return !q || [c.prenom, c.nom, c.role, c.email, ...es.map((x) => x.nom)].join(" ").toLowerCase().includes(q) || telCorrespond(q, c.tel);
  });
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Même principe que la liste entreprises : largeur minimale garantie,
          défilement horizontal si le panneau est étroit. */}
      <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            <th className="px-4 py-2.5">Contact</th>
            <th className="px-4 py-2.5">Entreprise</th>
            <th className="px-4 py-2.5">Email</th>
            <th className="px-4 py-2.5">Téléphone</th>
            <th className="px-4 py-2.5 text-right">Deals</th>
          </tr>
        </thead>
        <tbody>
          {liste.map((c) => {
            const es = etat.entreprises.filter((x) => c.entrepriseIds.includes(x.id));
            const ds = etat.deals.filter((d) => d.contactId === c.id);
            return (
              /* La ligne ouvre la fiche du contact… */
              <tr key={c.id} onClick={() => onOuvre({ type: "contact", id: c.id })}
                className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-2.5">
                  <span className="text-[12.5px] font-bold text-slate-800">{c.prenom} {c.nom}</span>
                  <span className="block text-[10.5px] text-slate-400">{c.role}</span>
                </td>
                <td className="px-4 py-2.5">
                  {/* …mais chaque entreprise liée est un bouton séparé :
                      stopPropagation évite de déclencher le clic de la ligne.
                      Un contact multi-comptes affiche tous ses liens. */}
                  {es.length > 0 ? es.map((en) => (
                    <button key={en.id} onClick={(ev) => { ev.stopPropagation(); onOuvre({ type: "entreprise", id: en.id }); }}
                      className="mr-1.5 text-[12px] font-semibold text-cyan-600 hover:underline">{en.nom}</button>
                  )) : <span className="text-[12px] text-slate-400">—</span>}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-[12.5px] text-slate-500">{c.email || "—"}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-[12.5px] text-slate-500">{c.tel || "—"}</td>
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

/* ---- Pipeline kanban : une colonne par étape, drag & drop des cartes deal. ----
   NB : les cartes sont des <div> NATIVES et non des <motion.div> : framer-motion
   intercepte onDragStart/onDrop, ce qui casserait le glisser-déposé. */
/* ---- Vue DEALS : liste de consultation de toutes les opportunités —
       même style que les listes Entreprises/Contacts. Chaque ligne ouvre la
       modale du deal ; l'entreprise et le contact ont leurs propres liens.
       Tri : montant décroissant (les plus gros enjeux d'abord). ---- */
function VueDeals({ etat, recherche, onOuvre }: { etat: Etat; recherche: string; onOuvre: (c: Cible) => void }) {
  const q = recherche.toLowerCase().trim();
  // Une prochaine action est « en retard » si son échéance est passée et
  // qu'elle n'est pas marquée faite (même logique que l'agenda).
  const maintenant = new Date();
  const enRetard = (d: Deal) => {
    if (d.fait || !d.action || !d.echeance) return false;
    const p = parseEcheance(d.echeance);
    if (!p) return false;
    return p.a < maintenant.getFullYear() || (p.a === maintenant.getFullYear() && (p.m < maintenant.getMonth() || (p.m === maintenant.getMonth() && p.j < maintenant.getDate())));
  };
  // La recherche porte sur le deal + son entreprise + son contact.
  const liste = etat.deals.filter((d) => {
    const e = etat.entreprises.find((x) => x.id === d.entrepriseId);
    const c = etat.contacts.find((x) => x.id === d.contactId);
    return !q || [d.nom, d.etape, d.action, e?.nom || "", c ? c.prenom + " " + c.nom : ""].join(" ").toLowerCase().includes(q)
      || telCorrespond(q, e?.tel || "") || telCorrespond(q, c?.tel || "");
  }).sort((a, b) => b.montant - a.montant);
  // Petits compteurs affichés au-dessus du tableau (vue d'ensemble rapide).
  const actifs = liste.filter((d) => d.etape !== "Gagné" && d.etape !== "Perdu");
  const totalActif = actifs.reduce((s, d) => s + d.montant, 0);
  const nbRetard = liste.filter(enRetard).length;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-left">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            <th className="px-4 py-2.5">Deal</th>
            <th className="px-4 py-2.5">Entreprise</th>
            <th className="px-4 py-2.5">Contact</th>
            <th className="px-4 py-2.5">Étape</th>
            <th className="px-4 py-2.5">Prochaine action</th>
            <th className="px-4 py-2.5 text-right">Montant</th>
          </tr>
        </thead>
        <tbody>
          {liste.map((d) => {
            const e = etat.entreprises.find((x) => x.id === d.entrepriseId);
            const c = etat.contacts.find((x) => x.id === d.contactId);
            return (
              /* La ligne ouvre la modale du deal… */
              <tr key={d.id} onClick={() => onOuvre({ type: "deal", id: d.id })}
                className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-2.5">
                  <span className="text-[12.5px] font-bold text-slate-800">{d.nom}</span>
                  {/* Étape affichée aussi dans la cellule deal pour lisibilité mobile. */}
                </td>
                {/* …mais l'entreprise est un bouton séparé (stopPropagation). */}
                <td className="px-4 py-2.5">
                  {e ? (
                    <button onClick={(ev) => { ev.stopPropagation(); onOuvre({ type: "entreprise", id: e.id }); }}
                      className="text-[12px] font-semibold text-cyan-600 hover:underline">{e.nom}</button>
                  ) : <span className="text-[12px] text-slate-400">—</span>}
                </td>
                <td className="px-4 py-2.5">
                  {c ? (
                    <button onClick={(ev) => { ev.stopPropagation(); onOuvre({ type: "contact", id: c.id }); }}
                      className="text-[12px] font-semibold text-cyan-600 hover:underline">{c.prenom} {c.nom}</button>
                  ) : <span className="text-[12px] text-slate-400">—</span>}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5"><Badge texte={d.etape} couleur={couleurEtape(d.etape)} /></td>
                <td className="px-4 py-2.5">
                  {d.action ? (
                    <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-slate-600">
                      {d.fait ? <span className="text-[11px] font-bold text-emerald-600">✓ faite</span> : (
                        <>
                          <span className="min-w-0 max-w-[220px] truncate">{d.action}</span>
                          {d.echeance && <span className="text-[10.5px] font-bold text-slate-400">· {d.echeance}</span>}
                          {enRetard(d) && <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-red-600">en retard</span>}
                        </>
                      )}
                    </span>
                  ) : <span className="text-[12px] text-slate-400">—</span>}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right text-[13px] font-black text-slate-700">{d.montant} k€</td>
              </tr>
            );
          })}
          {liste.length === 0 && (
            <tr><td colSpan={6} className="px-4 py-8 text-center text-[12.5px] text-slate-400">Aucun deal ne correspond à ta recherche.</td></tr>
          )}
        </tbody>
      </table>
      </div>
      <button onClick={() => onOuvre({ type: "deal", id: null, preset: "" })}
        className="w-full border-t border-slate-100 py-2.5 text-[12px] font-bold text-cyan-600 hover:bg-slate-50">
        + Nouveau deal
      </button>
      {/* Bandeau de synthèse : deals affichés, actifs, enjeu total, retards. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 bg-slate-50/60 px-4 py-2 text-[11px] font-bold text-slate-500">
        <span>{liste.length} deal{liste.length > 1 ? "s" : ""}</span>
        <span>· {actifs.length} actif{actifs.length > 1 ? "s" : ""}</span>
        <span>· {totalActif} k€ en jeu</span>
        {nbRetard > 0 && <span className="text-red-500">· ⚠️ {nbRetard} en retard</span>}
      </div>
    </div>
  );
}

function VuePipeline({ etat, recherche, onOuvre, onMove }: {
  etat: Etat; recherche: string; onOuvre: (c: Cible) => void;
  onMove: (id: string, etape: Etape) => void;
}) {
  // État du glisser en cours : id de la carte saisie + colonne survolée (pour le surlignage).
  const [dragId, setDragId] = useState<string | null>(null);
  const [survol, setSurvol] = useState<Etape | null>(null);
  const q = recherche.toLowerCase().trim();
  // La recherche porte sur le deal + son entreprise + son contact + son action.
  const visibles = etat.deals.filter((d) => {
    const e = etat.entreprises.find((x) => x.id === d.entrepriseId);
    const c = etat.contacts.find((x) => x.id === d.contactId);
    return !q || [d.nom, e?.nom || "", c?.nom || "", d.action].join(" ").toLowerCase().includes(q)
      || telCorrespond(q, e?.tel || "") || telCorrespond(q, c?.tel || "");
  });

  return (
    // Les 5 colonnes gardent TOUJOURS une largeur lisible (min-w) : si le panneau
    // est trop étroit, on défile horizontalement plutôt que d'écraser les cartes.
    <div className="overflow-x-auto pb-2">
    <div className="grid min-w-[880px] grid-cols-5 gap-3">
      {ETAPES.map((col) => {
        const cartes = visibles.filter((d) => d.etape === col.nom);
        const total = cartes.reduce((s, d) => s + d.montant, 0);
        return (
          /* Zone de dépôt : preventDefault est OBLIGATOIRE dans onDragOver,
             sinon le navigateur refuse le drop. */
          <div key={col.nom}
            onDragOver={(e) => { e.preventDefault(); setSurvol(col.nom); }}
            onDragLeave={() => setSurvol((s) => (s === col.nom ? null : s))}
            onDrop={(e) => { e.preventDefault(); setSurvol(null); if (dragId) onMove(dragId, col.nom); setDragId(null); }}
            className="flex min-h-[300px] flex-col rounded-2xl border p-3 transition-colors"
            style={{ background: survol === col.nom ? `${col.couleur}0f` : "#f8fafc", borderColor: survol === col.nom ? col.couleur : "#e2e8f0" }}
          >
            {/* En-tête de colonne : étape + compteur (nombre de deals · total k€). */}
            <div className="mb-3 flex items-center justify-between">
              <span className="flex items-center gap-2 text-[12px] font-black text-slate-700">
                <span className="h-2 w-2 rounded-full" style={{ background: col.couleur }} />
                {col.nom}
              </span>
              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500 shadow-sm">
                {cartes.length} · {total} k€
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-2.5">
              {cartes.map((d) => {
                const e = etat.entreprises.find((x) => x.id === d.entrepriseId);
                const c = etat.contacts.find((x) => x.id === d.contactId);
                return (
                  /* Carte draggable : on mémorise l'id au moment de la prise.
                     Un simple clic (sans drag) ouvre la page record du deal
                     (l'édition rapide reste possible via ✎ Modifier). */
                  <div key={d.id}
                    draggable
                    onDragStart={() => setDragId(d.id)}
                    onClick={() => onOuvre({ type: "deal", id: d.id })}
                    className="cursor-pointer rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[12.5px] font-bold text-slate-800">{d.nom}</span>
                      <span className="text-[12px] font-black" style={{ color: col.couleur }}>{d.montant} k€</span>
                    </div>
                    <div className="mt-1 text-[10.5px] text-slate-500">{e?.nom}{c ? ` · ${c.prenom} ${c.nom}` : ""}</div>
                    {/* Prochaine action du deal, avec pastille verte si « fait ». */}
                    {d.action && (
                      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-500">
                        <span className="h-1 w-1 rounded-full" style={{ background: d.fait ? "#57c26b" : col.couleur }} />
                        {d.fait ? "Fait" : `${d.action} — ${d.echeance}`}
                      </div>
                    )}
                  </div>
                );
              })}
              {/* Bouton « + Deal » ancré en bas de colonne grâce à mt-auto. */}
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

type VueCRM = "dashboard" | "entreprises" | "contacts" | "deals" | "pipeline" | "agenda" | "devis" | "console";
// Clé localStorage de la dernière page visitée (vue + fiche ouverte) : un
// refresh (F5 / Ctrl+F5) doit REVENIR sur la page où l'on était, pas sur l'accueil.
const CLE_NAV = "umob-crm-nav";
// Vue « Console manager » : réservée au manager (emails autorisés) — invisible
// et inaccessible pour tout autre compte connecté.
const EMAILS_CONSOLE = new Set(["corentin.surand@umob.fr"]);

/* Composant racine : détient l'ÉTAT GLOBAL unique (`etat` = toute la base),
   le routeur interne (vue active, fiche ouverte, modale ouverte) et les
   mutations (sauver / supprimer / déplacer / journaliser une activité). */
export default function App() {
  const [etat, setEtat] = useState<Etat>(ETAT_VIDE); // la « base de données »
  const [chargement, setChargement] = useState(true);        // chargement initial Supabase
  const [baseVide, setBaseVide] = useState(false);          // 1re ouverture → écran d'initialisation
  const [erreurChargement, setErreurChargement] = useState<string | null>(null);
  const [sync, setSync] = useState<"ok" | "ecriture" | "erreur">("ok"); // état de synchronisation
  const charge = useRef(false);                              // vrai dès que l'état initial est arrivé
  const [vue, setVue] = useState<VueCRM>("dashboard"); // liste affichée
  const [recherche, setRecherche] = useState("");     // recherche globale du header
  const [cible, setCible] = useState<Cible | null>(null); // modale ouverte (null = fermée)
  const [fiche, setFiche] = useState<FicheRef | null>(null); // page record ouverte (null = liste)
  // Vrai uniquement après « 🚀 Rouvrir » d'un devis archivé : le module Devis
  // s'ouvre alors directement sur l'assistant. Un clic sur l'onglet 🧾 Devis
  // de la navigation remet à false → ouverture sur la LISTE à chaque fois.
  const [assistantDirect, setAssistantDirect] = useState(false);
  // Fiche entreprise pré-remplie dans le module Devis après un clic « 📄 Devis »
  // (effacée juste après le montage pour ne pas polluer les ouvertures suivantes).
  const [devisPresetEnt, setDevisPresetEnt] = useState("");
  useEffect(() => { if (devisPresetEnt) setDevisPresetEnt(""); }, [devisPresetEnt]);
  // Remonte le module Devis à neuf (clé de rendu) : « ➕ Nouveau devis »
  // repart de zéro — tous les états internes sont réinitialisés au montage.
  const [devisKey, setDevisKey] = useState(0);
  // ── Vue DocuSign (PowerForms pré-remplis) ouverte depuis le module Devis
  // via le bouton « ✍️ Envoyer en signature DocuSign » (étape 5). ──
  const [docusignResume, setDocusignResume] = useState<DevisResume | null>(null);
  const [dsEnt, setDsEnt] = useState<any>(null); // entreprise CRM liée au devis
  const [dsContacts, setDsContacts] = useState<any[]>([]); // contacts de cette entreprise
  const [dsLocam, setDsLocam] = useState("");
  const [dsRenouv, setDsRenouv] = useState(false);
  const [dsKm, setDsKm] = useState("");
  const [monEmail, setMonEmail] = useState(""); // email du compte connecté (réserve la Console manager)
  useEffect(() => { supabase.auth.getSession().then(({ data }) => setMonEmail((data.session?.user?.email || "").toLowerCase())); }, []);
  const estManager = EMAILS_CONSOLE.has(monEmail);
  // Sécurité : Console non permise pour ce compte → retour au tableau de bord.
  useEffect(() => { if (vue === "console" && monEmail !== "" && !estManager) setVue("dashboard"); }, [vue, monEmail, estManager]);

  // ── ROULETTE PAR COLONNE (fiches Entreprise/Contact/Deal) : là où est la
  // souris, la colonne défile ; la page ne bouve JAMAIS au-dessus d'une colonne.
  // Listener non-passif obligatoire : React onWheel est passif → preventDefault y est ignoré.
  useEffect(() => {
    const surRoulette = (e: WheelEvent) => {
      const cible = e.target as HTMLElement | null;
      const el = cible && cible.closest ? cible.closest(".col-roulette") as HTMLElement | null : null;
      if (!el) return; // hors des colonnes : comportement normal
      e.preventDefault();
      const reste = e.deltaY > 0
        ? el.scrollHeight - el.scrollTop - el.clientHeight
        : el.scrollTop;
      if (reste > 0) el.scrollTop += e.deltaY;
    };
    window.addEventListener("wheel", surRoulette, { passive: false });
    return () => window.removeEventListener("wheel", surRoulette);
  }, []);

  // Routeur des listes : une entreprise / un contact EXISTANT ouvre sa page
  // record ; tout le reste (id null = création, deals = pas de page record)
  // tombe dans la modale.
  const ouvrir = (c: Cible) => {
    // Entreprises, contacts et deals existants → PAGE RECORD ; le reste
    // (créations, deals sans id…) → modale d'édition.
    if ((c.type === "entreprise" || c.type === "contact" || c.type === "deal") && c.id) setFiche({ type: c.type, id: c.id });
    else setCible(c);
  };
  // Navigation entre pages record (associations cliquables) : la modale se ferme
  // pour laisser place à la fiche (comme HubSpot qui navigue d'une fiche à l'autre).
  const ouvrirFiche = (f: FicheRef) => { setFiche(f); setCible(null); };

  // « 📄 Devis » d'une fiche entreprise : ouvre le module Devis DIRECTEMENT
  // sur l'assistant, avec le compte de la fiche pré-rempli (société + entId).
  // Le brouillon en cours est écarté (même logique que « ➕ Nouveau devis »).
  const ouvrirDevisPour = (entId: string) => {
    setEtat((s) => ({ ...s, devis: null }));
    setDevisPresetEnt(entId);
    setAssistantDirect(true);
    setDevisKey((k) => k + 1);
    setFiche(null);
    setVue("devis");
  };

  // ── Persistance de la NAVIGATION : un refresh (F5 / Ctrl+F5) ne doit PAS
  // renvoyer sur la page d'accueil. La vue et la fiche ouvertes sont mémorisées
  // dans localStorage à chaque changement. On n'écrit PAS pendant le chargement
  // initial : il faut d'abord RESTAURER la dernière page (voir ci-dessous),
  // sinon les valeurs par défaut écraseraient la mémoire avant la restauration.
  useEffect(() => {
    if (chargement) return;
    try { localStorage.setItem(CLE_NAV, JSON.stringify({ vue, fiche })); } catch { /* stockage indisponible : sans blocage */ }
  }, [vue, fiche, chargement]);

  // Chargement initial : l'état complet vient de Supabase. Première ouverture
  // (aucune ligne en base) → écran d'initialisation — on ne pré-remplit
  // JAMAIS les données sans décision explicite.
  useEffect(() => {
    chargerEtat()
      .then((d) => {
        if (d) {
          const etatCharge = normaliser(d as Etat);
          setEtat(etatCharge);
          // ── Restauration de la dernière page visitée : APRÈS le chargement de
          // la base, quand les ids existent vraiment. Une fiche supprimée depuis
          // → retour accueil, jamais un écran vide. localStorage corrompu ou
          // indisponible → accueil, sans blocage.
          try {
            const raw = localStorage.getItem(CLE_NAV);
            if (raw) {
              const nav = JSON.parse(raw) as { vue?: VueCRM; fiche?: FicheRef | null };
              if (nav.vue) setVue(nav.vue);
              if (nav.fiche) {
                const f = nav.fiche;
                const existe =
                  (f.type === "entreprise" && etatCharge.entreprises.some((x) => x.id === f.id)) ||
                  (f.type === "contact" && etatCharge.contacts.some((x) => x.id === f.id)) ||
                  (f.type === "deal" && etatCharge.deals.some((x) => x.id === f.id));
                if (existe) setFiche(f);
              }
            }
          } catch { /* localStorage indisponible ou corrompu : accueil, sans blocage */ }
        } else setBaseVide(true);
      })
      .catch((err: unknown) => setErreurChargement(err instanceof Error ? err.message : String(err)))
      .finally(() => { setChargement(false); charge.current = true; });
  }, []);

  // Sauvegarde automatique : chaque modification part vers Supabase après
  // 800 ms de calme (debounce) — les éditions inline rapides ne déclenchent
  // pas 50 requêtes. L'indicateur de la barre latérale reflète le sync.
  useEffect(() => {
    if (!charge.current) return; // rien à sauvegarder tant que l'état initial n'est pas chargé
    setSync("ecriture");
    const minuteur = setTimeout(async () => {
      try { await sauverEtat(etat); setSync("ok"); }
      catch { setSync("erreur"); }
    }, 800);
    return () => clearTimeout(minuteur);
  }, [etat]);

  // Écran d'entrée : chargement ou erreur de connexion à la base.
  if (chargement) return <Splash texte="Chargement du CRM…" />;
  if (erreurChargement) return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-100 px-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl text-[20px] font-black text-white"
        style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>U'</div>
      <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow">
        <div className="mb-2 text-[15px] font-black text-slate-800">Impossible de charger le CRM</div>
        <p className="text-[13px] leading-relaxed text-slate-500">{erreurChargement}</p>
        <button onClick={() => window.location.reload()}
          className="mt-4 rounded-xl px-4 py-2 text-[12px] font-black text-white"
          style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>Réessayer</button>
      </div>
    </div>
  );

  // Écran d'initialisation (base vide) : importer les vraies données ou partir
  // de zéro — au choix, jamais automatiquement.
  if (baseVide) return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-slate-100 px-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl text-[20px] font-black text-white"
        style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>U'</div>
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-7 shadow">
        <div className="mb-1 text-center text-[16px] font-black text-slate-800">Bienvenue dans ton CRM 🎉</div>
        <p className="mb-5 text-center text-[13px] leading-relaxed text-slate-500">
          La base est vide pour l'instant. Tu peux importer les <b>50 clients réels</b> du
          Sheet « Infos Service Client » (contrats, flotte, risques SAV, 51 contacts),
          ou partir de zéro. Aucune décision n'est irréversible.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button onClick={() => { setEtat(normaliser(SEED)); setBaseVide(false); }}
            className="flex-1 rounded-xl px-4 py-2.5 text-[13px] font-black text-white"
            style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>
            📥 Importer les 50 clients réels
          </button>
          <button onClick={() => { setEtat(ETAT_VIDE); setBaseVide(false); }}
            className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-[13px] font-black text-slate-600 hover:bg-slate-50">
            🆕 Partir de zéro
          </button>
        </div>
      </div>
    </div>
  );

  // Journalise une activité (note, e-mail, appel…) sur une ENTREPRISE —
  // seule source d'activités du modèle — de façon immuable : on recrée le
  // tableau plutôt que le muter. L'activité peut porter des liens optionnels
  // `contactId`/`dealId` (rattachement à un contact / un deal de l'entreprise).
  const ajouterActivite = (id: string, activite: Activite) => {
    setEtat((s) => ({ ...s, entreprises: s.entreprises.map((x) => (x.id === id ? { ...x, activites: [...x.activites, activite] } : x)) }));
  };

  // Suppression d'une activité en cas d'erreur de saisie (poubelle de la
  // timeline). Identification par RÉFÉRENCE d'objet : l'événement affiché EST
  // l'objet stocké dans `entreprises[].activites` (même après tri), donc le
  // filtrage par référence retire exactement la bonne ligne — fiable même si
  // deux activités ont un contenu identique (pas d'identifiant dédié).
  const supprimerActivite = (id: string, ev: Activite) => {
    setEtat((s) => ({ ...s, entreprises: s.entreprises.map((x) => (x.id === id ? { ...x, activites: x.activites.filter((a) => a !== ev) } : x)) }));
  };

  // Mise à jour d'une activité existante (modification, clôture, réouverture)
  // depuis l'agenda ou la timeline : remplacement par RÉFÉRENCE d'objet,
  // même mécanisme immuable que la suppression.
  const majActivite = (id: string, ev: Activite, patch: Partial<Activite>) => {
    setEtat((s) => ({ ...s, entreprises: s.entreprises.map((x) => (x.id === id ? { ...x, activites: x.activites.map((a) => (a === ev ? { ...a, ...patch } : a)) } : x)) }));
  };

  // Édition directe depuis le panneau « À propos » de la fiche entreprise :
  // on n'applique que le PATCH (champs modifiés) sur l'objet existant, de façon
  // immuable. La sauvegarde Supabase suit toute seule via le useEffect.
  const modifierEntreprise = (id: string, patch: Partial<Entreprise>) => {
    setEtat((s) => ({ ...s, entreprises: s.entreprises.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
    // Sync temps réel Ringover : le tél de l'entreprise vient d'être édité
    // inline → on pousse la fiche « société » vers l'annuaire (upsert par numéro).
    if (patch.tel !== undefined) {
      const e = etat.entreprises.find((x) => x.id === id);
      if (e) {
        // Carte société (seulement utile si aucun contact ne porte le fixe)
        syncRingover("", "", e.nomCommercial || e.nom, patch.tel, "", undefined, [e.tel]);
        // Chaque contact de l'entreprise reçoit le nouveau fixe sur SA carte
        etat.contacts.filter((ct) => ct.entrepriseIds && ct.entrepriseIds.includes(id)).forEach((ct) =>
          syncRingover(ct.prenom, ct.nom, e.nomCommercial || e.nom, ct.tel, ct.email, patch.tel, [e.tel]));
      }
    }
  };

  // ── Module Devis : archivage sur la fiche entreprise ──
  // Le module transmet le brouillon complet + un résumé figé + le texte du
  // mail ; on rattache tout à la fiche (recherche par nom / nom commercial)
  // et on journalise une note dans la timeline pour la traçabilité.
  const trouverEntrepriseParNom = (nom: string) => {
    const cible = (nom || "").trim().toLowerCase();
    return cible ? etat.entreprises.find((x) => (x.nomCommercial || x.nom).trim().toLowerCase() === cible) : undefined;
  };
  // Résolution de la fiche entreprise d'un devis : l'ID (posé par le sélecteur
  // « Chercher un compte » du module Devis) est PRIORITAIRE sur le nom —
  // deux sociétés distinctes peuvent porter le MÊME nom commercial
  // (ex. NB2 / Nour Breizh) : le nom seul désignerait la PREMIÈRE fiche
  // trouvée, donc la MAUVAISE société. ID absent (anciens brouillons,
  // saisie libre) → repli sur le nom, comme avant.
  const trouverEntrepriseDevis = (nom: string, entId?: string) =>
    (entId ? etat.entreprises.find((x) => x.id === entId) : undefined) ?? trouverEntrepriseParNom(nom);
  const sauvegarderDevisSurFiche = (s: SauvegardeDevis): string | boolean => {
    const ent = trouverEntrepriseDevis(s.societe, s.entId);
    if (!ent) return false;
    const maintenant = new Date();
    // MÊME devis (même n° d'offre déjà archivé) → MET À JOUR l'original :
    // même id, même n°, même date de création, statut d'envoi conservé —
    // seul le contenu (brouillon, résumé, mail, commentaire) est rafraîchi.
    const existant = (ent.devisHistorique ?? []).find((dv) => dv.resume?.numOffre === s.resume.numOffre);
    if (existant) {
      const archive: DevisArchive = { ...existant, societe: s.societe, commentaire: s.commentaire, brouillon: s.brouillon, resume: s.resume, mail: s.mail };
      const texte = `Devis n° ${s.resume.numOffre} mis à jour — ${s.resume.nbChassis} scooter(s), ${s.resume.loyerMensuelHT.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €/mois HT${s.commentaire ? ` — « ${s.commentaire} »` : ""}`;
      setEtat((s2) => ({
        ...s2,
        entreprises: s2.entreprises.map((x) => x.id === ent.id ? {
          ...x,
          devisHistorique: (x.devisHistorique ?? []).map((dv) => dv.id === archive.id ? archive : dv),
          activites: [...x.activites, { date: "auj.", texte, type: "devis", dateISO: dateParis(maintenant), heure: heureParis(maintenant) } as Activite],
        } : x),
      }));
      return archive.id;
    }
    const archive: DevisArchive = { ...s, id: `dv-${maintenant.getTime()}`, dateISO: maintenant.toISOString(), dateFr: dateParis(maintenant), statut: "enregistre" };
    const texte = `Devis n° ${s.resume.numOffre} sauvegardé — ${s.resume.nbChassis} scooter(s), ${s.resume.loyerMensuelHT.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €/mois HT${s.commentaire ? ` — « ${s.commentaire} »` : ""}`;
    setEtat((s2) => ({
      ...s2,
      entreprises: s2.entreprises.map((x) => x.id === ent.id ? {
        ...x,
        devisHistorique: [archive, ...(x.devisHistorique ?? [])].slice(0, 30),
        activites: [...x.activites, { date: "auj.", texte, type: "devis", dateISO: dateParis(maintenant), heure: heureParis(maintenant) } as Activite],
      } : x),
    }));
    return archive.id;
  };
  // ── Notion « envoyé au client » vs « simplement enregistré » : passe
  // l'archive au statut « envoye » (badge ✅ sur la fiche entreprise) et
  // journalise l'envoi dans la timeline. Appelé (1) par le module Devis quand
  // Corentin clique « Envoyer par mail + PDF » (matching société + n° d'offre)
  // et (2) par le bouton « ✉️ Mail + PDF » de la fiche (matching par id).
  // Un devis déjà « envoye » n'est pas retouché (le plus ancien envoi prime).
  // Supprime un devis archivé de la fiche (bouton 🗑️ — nettoie les doublons).
  const supprimerDevisArchived = (entId: string, devisId: string) => {
    const dv = (etat.entreprises.find((x) => x.id === entId)?.devisHistorique ?? []).find((d) => d.id === devisId);
    if (!dv) return;
    const maintenant = new Date();
    const texte = `Devis n° ${dv.resume?.numOffre || ""} supprimé de la fiche`;
    setEtat((s2) => ({
      ...s2,
      entreprises: s2.entreprises.map((x) => x.id === entId ? {
        ...x,
        devisHistorique: (x.devisHistorique ?? []).filter((d) => d.id !== devisId),
        activites: [...x.activites, { date: "auj.", texte, type: "devis", dateISO: dateParis(maintenant), heure: heureParis(maintenant) } as Activite],
      } : x),
    }));
  };
  const marquerDevisEnvoyeParId = (entId: string, devisId: string, dateRelanceFr: string) => {
    if (!dateRelanceFr) return; // pas d'envoi sans date de relance choisie par le commercial
    const maintenant = new Date();
    setEtat((s2) => ({
      ...s2,
      entreprises: s2.entreprises.map((x) => {
        if (x.id !== entId) return x;
        const dv = (x.devisHistorique ?? []).find((d) => d.id === devisId);
        const transition = !!dv && dv.statut !== "envoye" && dv.statut !== "accepte"; // tâche créée UNE seule fois par devis
        return {
          ...x,
          devisHistorique: (x.devisHistorique ?? []).map((d) => d.id === devisId && d.statut !== "envoye" && d.statut !== "accepte" ? { ...d, statut: "envoye" as const, dateEnvoiFr: dateHeureParis(maintenant), dateRelanceFr } : d),
          activites: transition ? [...x.activites,
            { date: "auj.", texte: `Relancer le devis n° ${dv!.resume?.numOffre || ""} (envoyé le ${dateHeureParis(maintenant)})`, type: "tache" as const, echeance: dateRelanceFr, dateISO: dateParis(maintenant), heure: heureParis(maintenant) } as Activite] : x.activites,
        };
      }),
    }));
  };
  // Devis ACCEPTÉ par le client : la relance n'a plus de raison d'être → la
  // tâche de relance est SUPPRIMÉE des activités, et l'acceptation est
  // consignée dans la Chronologie de l'entreprise.
  const marquerDevisAccepte = (entId: string, devisId: string) => {
    const dv = (etat.entreprises.find((x) => x.id === entId)?.devisHistorique ?? []).find((d) => d.id === devisId);
    if (!dv || dv.statut === "accepte") return;
    const num = dv.resume?.numOffre || "";
    const maintenant = new Date();
    const prefixeTache = `Relancer le devis n° ${num}`;
    setEtat((s2) => ({
      ...s2,
      entreprises: s2.entreprises.map((x) => x.id === entId ? {
        ...x,
        devisHistorique: (x.devisHistorique ?? []).map((d) => d.id === devisId ? { ...d, statut: "accepte" as const, dateAcceptationFr: dateHeureParis(maintenant) } : d),
        activites: [
          ...x.activites.filter((a) => !(a.type === "tache" && (a.texte || "").startsWith(prefixeTache))),
          { date: "auj.", texte: `🎉 Devis n° ${num} accepté par le client`, type: "devis" as const, dateISO: dateParis(maintenant), heure: heureParis(maintenant) } as Activite,
        ],
      } : x),
    }));
  };
  // Annule une acceptation faite par ERREUR : le devis redevient « envoyé »
  // (ou « enregistré » s'il n'avait jamais été envoyé), la note 🎉 est retirée
  // de la Chronologie et la tâche de relance est RECRÉÉE à la date choisie
  // initialement (anti-doublon : pas de tâche en double).
  const annulerDevisAccepte = (entId: string, devisId: string) => {
    const dv = (etat.entreprises.find((x) => x.id === entId)?.devisHistorique ?? []).find((d) => d.id === devisId);
    if (!dv || dv.statut !== "accepte") return;
    const num = dv.resume?.numOffre || "";
    const noteAccept = `🎉 Devis n° ${num} accepté par le client`;
    const prefixeTache = `Relancer le devis n° ${num}`;
    setEtat((s2) => ({ ...s2, entreprises: s2.entreprises.map((x) => x.id === entId ? {
      ...x,
      devisHistorique: (x.devisHistorique ?? []).map((d) => d.id === devisId ? { ...d, statut: (d.dateEnvoiFr ? "envoye" : "enregistre") as "envoye" | "enregistre", dateAcceptationFr: undefined } : d),
      activites: (() => {
        const sansNote = x.activites.filter((a) => !(a.type === "devis" && a.texte === noteAccept));
        const dejaRelance = sansNote.some((a) => a.type === "tache" && (a.texte || "").startsWith(prefixeTache));
        if (dejaRelance || !dv.dateRelanceFr) return sansNote;
        const maintenant = new Date();
        return [{ date: "auj.", texte: `Relancer le devis n° ${num} (acceptation annulée)`, type: "tache" as const, echeance: dv.dateRelanceFr, dateISO: dateParis(maintenant), heure: heureParis(maintenant) } as Activite, ...sansNote];
      })(),
    } : x) }));
  };
  const marquerDevisEnvoye = (societe: string, numOffre: string, dateRelanceFr: string, entId?: string) => {
    const ent = trouverEntrepriseDevis(societe, entId);
    if (!ent || !numOffre) return;
    if (!dateRelanceFr) return; // pas d'envoi sans date de relance choisie par le commercial
    const cible = (etat.entreprises.find((x) => x.id === ent.id)?.devisHistorique ?? []).find((dv) => dv.resume?.numOffre === numOffre && dv.statut !== "envoye" && dv.statut !== "accepte");
    if (!cible) return; // déjà envoyé ou accepté : rien à faire
    const maintenant = new Date();
    const texte = `Devis n° ${numOffre} envoyé au client (mail + PDF)`;
    setEtat((s2) => ({
      ...s2,
      entreprises: s2.entreprises.map((x) => x.id === ent.id ? {
        ...x,
        devisHistorique: (x.devisHistorique ?? []).map((dv) => dv.id === cible.id ? { ...dv, statut: "envoye" as const, dateEnvoiFr: dateHeureParis(maintenant), dateRelanceFr } : dv),
        activites: [...x.activites,
          { date: "auj.", texte, type: "devis", dateISO: dateParis(maintenant), heure: heureParis(maintenant) } as Activite,
          { date: "auj.", texte: `Relancer le devis n° ${numOffre} (envoyé le ${dateHeureParis(maintenant)})`, type: "tache" as const, echeance: dateRelanceFr, dateISO: dateParis(maintenant), heure: heureParis(maintenant) } as Activite],
      } : x),
    }));
  };
    // E-mail de contact du compte (premier contact de l'entreprise avec e-mail).
  const emailDuCompte = (nom: string, entId?: string) => {
    const ent = trouverEntrepriseDevis(nom, entId);
    if (!ent) return "";
    const ct = etat.contacts.find((c) => c.entrepriseIds.includes(ent.id) && (c.email || "").trim());
    return ct ? ct.email.trim() : "";
  };
  // Rouvrir un devis archivé : on le recharge comme brouillon courant du
  // module Devis (qui se monte frais et relit ses champs) et on y navigue.
  const rouvrirDevis = (dv: DevisArchive) => {
    // Le brouillon rechargé porte la liaison vers l'archive d'origine : la
    // sauvegarde METTRA À JOUR ce devis (même n°) au lieu d'en créer un autre.
    setEtat((e) => ({ ...e, devis: { ...dv.brouillon, idOrigine: dv.id, numOffreOrigine: dv.resume?.numOffre || "" } }));
    setAssistantDirect(true);
    setFiche(null);
    setVue("devis");
  };

  // RATTRAPAGE Sheet des contacts : complète tel/email/fonction MANQUANTS de
  // contacts existants (reconnus par id) — appelé à l'ouverture des fiches
  // entreprises par SyncSheetOuverture. Jamais d'écrasement d'une valeur déjà saisie.
  const majContacts = (mods: { id: string; tel?: string; email?: string; role?: string }[]) => {
    setEtat((s) => ({ ...s, contacts: s.contacts.map((c) => { const m = mods.find((x) => x.id === c.id); return m ? { ...c, ...m } : c; }) }));
    // Sync temps réel Ringover : un tél/email vient d'être complété (rattrapage
    // Sheet à l'ouverture d'une fiche) → on pousse la fiche vers l'annuaire.
    mods.forEach((m) => {
      const ct = etat.contacts.find((x) => x.id === m.id);
      if (!ct) return;
      const tel = m.tel || ct.tel;
      if (!tel) return;
      const e0 = ct.entrepriseIds && ct.entrepriseIds[0];
      const ent0 = e0 ? etat.entreprises.find((x) => x.id === e0) : undefined;
      syncRingover(ct.prenom, ct.nom, ent0 ? (ent0.nomCommercial || ent0.nom) : "", tel, m.email || ct.email, ent0 ? ent0.tel : "", tel !== ct.tel ? [ct.tel] : []);
    });
  };

  // ── Sync TEMPS RÉEL vers l'annuaire Ringover (affichage du nom sur
  //    les appels) : POST /api/sync-contacts avec le contact unitaire.
  //    Fire-and-forget : jamais de blocage de l'UI, échec silencieux (la
  //    sync complète GET ?run=1 rattrape ce qui aurait raté). Un numéro
  //    de moins de 9 chiffres n'est pas poussé. ──
  const syncRingover = (prenom: string, nom: string, societe: string, tel: string, email: string, telEntreprise?: string, anciens?: string[]) => {
    // Fusion contact + entreprise : une SEULE carte Ringover portant le mobile
    // du contact ET le fixe de son entreprise (les deux sonneront sous son nom).
    const okTel = (t: string) => (t || "").replace(/\D/g, "").length >= 9;
    const tels = [tel, telEntreprise].filter(okTel);
    if (!tels.length) return;
    fetch("/api/sync-contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact: { prenom, nom, societe, tel: tels[0], tels, email, anciens: (anciens || []).filter(okTel) } }),
    }).catch(() => { /* silencieux : jamais bloquer la sauvegarde CRM */ });
  };

  // Édition directe depuis la page record DEAL (panneau « À propos ») :
  // même logique de patch immuable. Si l'ÉTAPE change, le mouvement est tracé
  // dans l'historique comme via la modale ou le kanban (activité « Étape »
  // journalisée sur l'entreprise du deal, avec lien `dealId`).
  const modifierDeal = (id: string, patch: Partial<Deal>) => {
    setEtat((s) => {
      const ancien = s.deals.find((x) => x.id === id);
      const etapeChange = ancien && patch.etape && patch.etape !== ancien.etape;
      return {
        ...s,
        deals: s.deals.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        entreprises: etapeChange
          ? s.entreprises.map((x) => x.id === ancien!.entrepriseId
            ? { ...x, activites: [...x.activites, { date: "auj.", texte: `Étape : ${ancien!.etape} → ${patch.etape}`, type: "etape", dateISO: dateParis(), heure: heureParis(), dealId: id }] }
            : x)
          : s.entreprises,
      };
    });
  };

  // Enregistrement depuis la modale : fait tout en une seule passe d'état.
  const sauver = (c: Cible, donnees: Entreprise | Contact | Deal, contactsAuto?: ContactSimple[], societesAuto?: SocieteSimple[]) => {
    // Les ids sont générés HORS du updater React (qui doit rester pur, donc sans
    // Date.now() interne). Un petit compteur évite les collisions si plusieurs
    // objets sont créés dans la même milliseconde (ex. entreprise + 2 contacts).
    const base = Date.now();
    const idSuivantLocal = (prefixe: string, i: number) => `${prefixe}${base + i}`;
    // L'id final de l'entreprise : connu AVANT l'update pour rattacher les contacts.
    const ent = c.type === "entreprise" ? (donnees as Entreprise) : null;
    const idEnt = ent ? (ent.id || idSuivantLocal("e", 0)) : "";
    setEtat((s) => {
      if (c.type === "entreprise") {
        // Si l'id existe déjà → modification (on remplace) ; sinon → création
        // avec l'id généré ci-dessus. En création, on intègre aussi les contacts
        // cochés, avec l'ANTI-DOUBLONS : une personne déjà en base (même email,
        // même téléphone, ou même prénom+nom) n'est JAMAIS recréée — on ajoute
        // juste l'entreprise à ses liens existants (cas Pierre Piron : 1 contact,
        // 15 Domino's). Seule une personne inconnue devient un nouveau contact.
        const e = donnees as Entreprise;
        const existe = s.entreprises.some((x) => x.id === e.id);
        if (existe) {
          return { ...s, entreprises: s.entreprises.map((x) => (x.id === e.id ? e : x)) };
        }
        const contactsFinaux = [...s.contacts];
        // Rattache les contacts cochés à une entreprise `eid`, avec le même
        // anti-doublons partout : le contact n'est créé qu'une seule fois puis
        // lié à chaque société (principale + sociétés suggérées cochées).
        let n = 0;
        const rattacher = (eid: string) => {
          (contactsAuto || []).forEach((ct) => {
            const connu = contactsFinaux.find((x) => memePersonne(ct, x));
            if (connu) {
              // Personne déjà en base → RATTACHEMENT au contact existant.
              const idx = contactsFinaux.indexOf(connu);
              if (!connu.entrepriseIds.includes(eid)) {
                contactsFinaux[idx] = { ...connu, entrepriseIds: [...connu.entrepriseIds, eid] };
              }
            } else {
              // Vraie nouvelle personne → création, rattachée à cette société.
              contactsFinaux.push({
                id: idSuivantLocal("c", ++n),
                prenom: ct.prenom.trim(), nom: ct.nom.trim(), role: ct.role,
                email: ct.email, tel: ct.tel,
                entrepriseIds: [eid],
              });
            }
          });
        };
        rattacher(idEnt);
        // AUTRES sociétés du dirigeant (cochées dans le panneau cyan) : chacune
        // est créée comme une entreprise complète (champs de la source, jamais
        // d'invention), statut par défaut « Suspect » (le statut reste piloté
        // 100 % humain), et le dirigeant est rattaché à chacune via `rattacher`.
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
      // Cas deal : on compare l'étape avant/après pour tracer le mouvement
      // dans l'historique. L'activité « Étape : X → Y » est journalisée sur
      // l'ENTREPRISE du deal, avec un lien `dealId` (le deal ne porte plus
      // sa propre liste d'activités).
      const d = donnees as Deal;
      const ancien = s.deals.find((x) => x.id === d.id);
      const existe = s.deals.some((x) => x.id === d.id);
      const entreprises =
        ancien && ancien.etape !== d.etape
          ? s.entreprises.map((x) => x.id === d.entrepriseId
            ? { ...x, activites: [...x.activites, { date: "auj.", texte: `Étape : ${ancien.etape} → ${d.etape}`, type: "etape", dateISO: dateParis(), heure: heureParis(), dealId: d.id }] }
            : x)
          : s.entreprises;
      return { ...s, entreprises, deals: existe ? s.deals.map((x) => (x.id === d.id ? d : x)) : [...s.deals, { ...d, id: idSuivantLocal("d", 1) }] };
    });
    // Sync temps réel Ringover : le contact (ou la société + ses contacts cochés)
    // vient d'être enregistré → upsert unitaire vers l'annuaire (fire-and-forget).
    if (c.type === "contact") {
      const ct = donnees as Contact;
      const e0 = ct.entrepriseIds && ct.entrepriseIds[0];
      const ent0 = e0 ? etat.entreprises.find((x) => x.id === e0) : undefined;
      syncRingover(ct.prenom, ct.nom, ent0 ? (ent0.nomCommercial || ent0.nom) : "", ct.tel, ct.email, ent0 ? ent0.tel : "");
    }
    if (c.type === "entreprise") {
      const e2 = donnees as Entreprise;
      syncRingover("", "", e2.nomCommercial || e2.nom, e2.tel, "");
      (contactsAuto || []).forEach((ct) => { syncRingover(ct.prenom, ct.nom, e2.nomCommercial || e2.nom, ct.tel, ct.email, e2.tel); });
    }
    setCible(null); // la modale se ferme après enregistrement
  };

  // Suppression avec cascades cohérentes :
  //  - entreprise supprimée → ses deals sont supprimés, ses contacts DÉTACHÉS
  //  - contact supprimé → ses deals sont DÉTACHÉS (pas supprimés)
  // (on privilégie la perte minimale d'information)
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
    // Si l'objet supprimé était affiché en page record, on retourne à la liste
    // (sinon la fiche pointerait vers un objet inexistant → écran vide).
    setFiche((f) => (f && f.type === c.type && f.id === c.id ? null : f));
  };

  // Déplacement kanban (drag & drop) : change l'étape et trace le mouvement
  // dans l'historique — l'activité « Étape » est journalisée sur l'entreprise
  // du deal, avec un lien `dealId`.
  const deplacer = (id: string, etape: Etape) => {
    setEtat((s) => {
      const d = s.deals.find((x) => x.id === id);
      if (!d || d.etape === etape) return s;
      return {
        ...s,
        deals: s.deals.map((x) => (x.id === id ? { ...x, etape } : x)),
        entreprises: s.entreprises.map((x) => x.id === d.entrepriseId
          ? { ...x, activites: [...x.activites, { date: "auj.", texte: `Étape : ${d.etape} → ${etape}`, type: "etape", dateISO: dateParis(), heure: heureParis(), dealId: d.id }] }
          : x),
      };
    });
  };

  // Icônes de la navigation (barre latérale + version mobile).
  const ICONES_NAV: Record<string, string> = { dashboard: "📊", entreprises: "🏢", contacts: "👥", deals: "🎯", pipeline: "📈", agenda: "📅", devis: "🧾", console: "🎧" };

  // Les vues principales, dans l'ordre de la barre latérale.
  const onglets = [
    ["dashboard", "Tableau de bord"],
    ["entreprises", "Entreprises"],
    ["contacts", "Contacts"],
    ["deals", "Deals"],
    ["pipeline", "Pipeline"],
    ["agenda", "Agenda"],
    ["devis", "Devis"],
    ...(estManager ? [["console", "Console"],] : []),
  ] as const;

  // Le bouton « + » du header crée l'objet cohérent avec la vue affichée.
  const boutonAjout: Record<string, Cible> = {
    dashboard: { type: "deal", id: null, preset: "" },
    entreprises: { type: "entreprise", id: null },
    contacts: { type: "contact", id: null },
    deals: { type: "deal", id: null, preset: "" },
    pipeline: { type: "deal", id: null, preset: "" },
    agenda: { type: "deal", id: null, preset: "" },
  };

  return (
    // Racine en flex : barre latérale (sticky, pleine hauteur) + zone de contenu.
    <div className="flex min-h-screen bg-slate-100 font-sans">
      {/* Barre latérale façon HubSpot — visible dès 640px (sm:flex), cachée
          sur mobile où la navigation prend la forme de chips dans le header. */}
      <aside className="sticky top-0 hidden h-screen w-48 shrink-0 flex-col border-r border-slate-200 bg-white p-3 sm:flex">
        <div className="mb-5 flex items-center gap-2.5 px-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl text-[13px] font-black text-white"
            style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>U'</div>
          <div>
            <div className="text-[13px] font-black leading-tight text-slate-800">CRM U'mob</div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Entreprises · Contacts · Deals</div>
          </div>
        </div>
        {/* Navigation : changer de vue ferme automatiquement la page record. */}
        {onglets.map(([cle, label]) => (
          <button key={cle} onClick={() => { if (cle === "devis") setAssistantDirect(false); setFiche(null); setVue(cle as typeof vue); }}
            className={"mb-0.5 flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[12.5px] font-bold transition-colors " + (vue === cle ? "bg-slate-100 text-cyan-700" : "text-slate-500 hover:bg-slate-50")}>
            <span className="text-[14px]">{ICONES_NAV[cle]}</span> {label}
          </button>
        ))}
        {/* Synchronisation + déconnexion, ancrées en bas (mt-auto pousse tout
            le reste vers le haut). L'indicateur reflète l'état de la base. */}
        <div className="mt-auto px-1">
          <div className="mb-1.5 text-[9.5px] font-bold leading-relaxed text-slate-400">
            {sync === "ecriture" && "💾 Sauvegarde en cours…"}
            {sync === "ok" && "✅ Base synchronisée"}
            {sync === "erreur" && "⚠️ Échec de sauvegarde — vérifie ta connexion"}
          </div>
          <button onClick={seDeconnecter}
            className="w-full rounded-xl px-3 py-1.5 text-left text-[11px] font-bold text-slate-400 transition-colors hover:bg-slate-50 hover:text-red-500">
            Se déconnecter
          </button>
        </div>
      </aside>

      {/* Zone de contenu principale (min-w-0 évite les débordements du flex). */}
      <div className="min-w-0 flex-1">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          {/* Logo compact : masqué — la sidebar est toujours visible (canvas). */}
          <div className="flex items-center gap-2.5 sm:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl text-[13px] font-black text-white"
              style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>U'</div>
            <div className="text-[13px] font-black text-slate-800">CRM U'mob</div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="relative">
              <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="🔍 Rechercher partout…"
                className="w-56 rounded-xl border border-slate-200 px-3 py-1.5 text-[12px] outline-none focus:border-cyan-500" />
              {recherche.trim() !== "" && (
                <VoletRecherche q={recherche} etat={etat} onOuvre={(c) => { ouvrir(c); setRecherche(""); }} />
              )}
            </div>
            {vue !== "devis" && vue !== "console" && (
            <button onClick={() => setCible(boutonAjout[vue])}
              className="rounded-xl px-3 py-1.5 text-[12px] font-black text-white"
              style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>
              + {vue === "entreprises" ? "Entreprise" : vue === "contacts" ? "Contact" : "Deal"}
            </button>
            )}
          </div>
        </div>
        {/* Navigation mobile : chips défilables (équivalent de la sidebar). */}
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-2 sm:hidden">
          {onglets.map(([cle, label]) => (
            <button key={cle} onClick={() => { if (cle === "devis") setAssistantDirect(false); setFiche(null); setVue(cle as typeof vue); }}
              className="whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-bold transition-colors"
              style={{ background: vue === cle ? "#e2e8f0" : "transparent", color: vue === cle ? "#0f766e" : "#94a3b8" }}>
              {ICONES_NAV[cle]} {label}
            </button>
          ))}
        </div>
      </header>

      {/* Rendu principal : la page record ÉCRASE la liste quand elle est ouverte.
          `onOuvre={setCible}` dans les fiches : leurs boutons ouvrent des modales.
          Les listes utilisent `ouvrir` (le routeur modale/fiche) et le pipeline
          reçoit aussi `deplacer` pour le drag & drop. */}
      <main className="mx-auto max-w-7xl px-4 py-4">
        {fiche?.type === "entreprise" ? (
          <FicheEntreprise etat={etat} id={fiche.id} onRetour={() => setFiche(null)}
            onOuvre={setCible} onOuvreFiche={ouvrirFiche} onActivite={ajouterActivite}
            onModifie={(patch) => modifierEntreprise(fiche.id, patch)}
            onMajContacts={majContacts}
            onRouvrirDevis={rouvrirDevis}
            onMarquerDevisEnvoye={(devisId, dateRelanceFr) => marquerDevisEnvoyeParId(fiche.id, devisId, dateRelanceFr)}
            onMarquerDevisAccepte={(devisId) => marquerDevisAccepte(fiche.id, devisId)}
            onAnnulerDevisAccepte={(devisId) => annulerDevisAccepte(fiche.id, devisId)}
            onSupprimerDevis={(devisId) => supprimerDevisArchived(fiche.id, devisId)}
            onSupprimerActivite={(ev) => supprimerActivite(fiche.id, ev)}
            onMajActivite={(ev, patch) => majActivite(fiche.id, ev, patch)}
            onOuvrirDevis={() => ouvrirDevisPour(fiche.id)} />
        ) : fiche?.type === "contact" ? (
          <FicheContact etat={etat} id={fiche.id} onRetour={() => setFiche(null)}
            onOuvre={setCible} onOuvreFiche={ouvrirFiche} />
        ) : fiche?.type === "deal" ? (
          <FicheDeal etat={etat} id={fiche.id} onRetour={() => setFiche(null)}
            onOuvre={setCible} onOuvreFiche={ouvrirFiche}
            onModifie={(patch) => modifierDeal(fiche.id, patch)} />
        ) : (
          <>
            {vue === "dashboard" && <VueDashboard etat={etat} onOuvre={ouvrir} />}
            {vue === "entreprises" && <VueEntreprises etat={etat} recherche={recherche} onOuvre={ouvrir} />}
            {vue === "contacts" && <VueContacts etat={etat} recherche={recherche} onOuvre={ouvrir} />}
            {vue === "deals" && <VueDeals etat={etat} recherche={recherche} onOuvre={ouvrir} />}
            {vue === "pipeline" && <VuePipeline etat={etat} recherche={recherche} onOuvre={ouvrir} onMove={deplacer} />}
            {vue === "agenda" && <VueAgenda etat={etat} onOuvre={ouvrir} onAjouter={ajouterActivite} onMajActivite={majActivite} />}
            {vue === "devis" && <DevisModule key={devisKey} brouillon={etat.devis ?? null} onBrouillon={(d) => setEtat((e) => ({ ...e, devis: d }))} entreprisesNom={etat.entreprises.map((x) => x.nomCommercial || x.nom)}
              comptesCRM={etat.entreprises.map((x) => ({ affiche: x.nomCommercial || x.nom, nom: x.nom, tel: x.tel, entId: x.id }))}
              tousDevis={etat.entreprises.flatMap((x) => (x.devisHistorique ?? []).map((dv) => ({ id: dv.id, num: dv.resume?.numOffre || "—", societe: x.nomCommercial || x.nom, entId: x.id, dateFr: dv.dateFr, statut: dv.statut, dateEnvoiFr: dv.dateEnvoiFr, dateRelanceFr: dv.dateRelanceFr, dateAcceptationFr: dv.dateAcceptationFr, loyer: dv.resume?.loyerMensuelHT || 0, nbChassis: dv.resume?.nbChassis || 0, commercial: dv.resume?.commercial || "" })))}
              onOuvrirFiche={(id) => { setFiche({ type: "entreprise", id }); setCible(null); }}
              onSupprimerBrouillon={() => setEtat((e) => ({ ...e, devis: null }))}
              ouvertureDirecte={assistantDirect}
              compteInitial={devisPresetEnt || undefined}
              onDemarrerNouveau={() => { setAssistantDirect(true); setDevisKey((k) => k + 1); }}
              onSauvegarder={sauvegarderDevisSurFiche} onDevisEnvoye={marquerDevisEnvoye} numerosExistants={etat.entreprises.flatMap((x) => (x.devisHistorique ?? []).map((dv) => dv.resume?.numOffre || ""))} emailSociete={emailDuCompte} modelesMail={etat.modelesMailDevis ?? []} onModelesMail={(m) => setEtat((e) => ({ ...e, modelesMailDevis: m }))} signatureMail={etat.signatureMail} onSignatureMail={(s) => setEtat((e) => ({ ...e, signatureMail: s }))} documentsDevis={etat.documentsDevis ?? []} onDocumentsDevis={(ds) => setEtat((e) => ({ ...e, documentsDevis: ds }))}
              onEnvoyerDocusign={(r, locamContrat, kmContrat) => {
                const entDs = trouverEntrepriseDevis(r.societe, etat.devis?.entId);
                setDsEnt(entDs ?? null);
                setDsContacts(entDs ? etat.contacts.filter((c) => c.entrepriseIds.includes(entDs.id)) : []);
                setDocusignResume(r);
                setDsLocam(locamContrat || "");
                setDsRenouv(!!locamContrat);
                setDsKm(kmContrat || "");
              }} />}
            {vue === "console" && estManager && <ConsoleManager etat={etat} />}
          </>
        )}
      </main>
      </div>

      {/* Vue DocuSign plein écran (PowerForms pré-remplis depuis le devis) : */}
      {docusignResume && (
        <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-50">
          <DocusignVue resume={docusignResume} onRetour={() => setDocusignResume(null)} renouvellement={dsRenouv} setRenouvellement={setDsRenouv} numContratLocam={dsLocam} setNumContratLocam={setDsLocam} kmDevis={dsKm} entreprise={dsEnt} contacts={dsContacts} />
        </div>
      )}

      {/* Modale en overlay : la key force le remontage du state interne quand
          on change de cible (création ↔ modification d'un autre objet). */}
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


