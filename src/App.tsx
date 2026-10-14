import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase, chargerEtat, sauverEtat } from "./lib/supabase";
import { Splash } from "./connexion";

/* ============================== MODÈLE (structure HubSpot) ============================== */

// Les 5 étapes du pipeline commercial, dans l'ordre de progression d'un deal.
type Etape = "À qualifier" | "Proposition envoyée" | "Négociation" | "Gagné" | "Perdu";

// ── Les 3 objets du CRM, reliés entre eux par leurs identifiants (comme HubSpot) ──
// Entreprise ←(entrepriseIds)─ Contact : un contact peut appartenir à PLUSIEURS
//   entreprises (ex. Pierre Piron, gérant de 15 Domino's = 1 contact, 15 liens)
// Entreprise ←(entrepriseId)─ Deal    : un deal est rattaché à une entreprise…
// Contact    ←(contactId)─── Deal    : …et à un contact précis de cette entreprise
interface Entreprise { id: string; nom: string; nomCommercial: string; secteur: string; ville: string; site: string; tel: string; franchiseur: string; modeLivraison: string; activite: string; statut: Statut; notes: string; activites: Activite[];
  // ── Contrat & flotte (source : Sheet « Infos Service Client » / Locam) ──
  // Renseignés pour les SOCIÉTÉS CLIENTES : pack choisi, période du contrat,
  // nombre de véhicules, n° de contrat Locam, immatriculations. Comme tous les
  // champs auto-remplis : modifiables, et vides si la source ne sait rien.
  pack: string; dateDebut: string; dateFin: string; nbVehicules: string; contratLocam: string; immatriculations: string;
  // ── Risque SAV (source : colonnes Statut_risque_client / Impayes /
  // Procedure_collective du Sheet « Infos Service Client »). Vide = aucun
  // risque signalé. Comme le statut, il reste corrigeable à la main. ──
  risque: string; }
interface Contact { id: string; prenom: string; nom: string; role: string; email: string; tel: string; entrepriseIds: string[]; activites: Activite[] }

// Reconnaissance d'une personne déjà en base (anti-doublons) : même email,
// même téléphone (chiffres uniquement), ou même prénom+nom → c'est la MÊME
// personne (ex. gérant de plusieurs franchises : on RATTACHE, on ne duplique jamais).
const normTel = (t: string) => t.replace(/\D/g, "");
// (b accepte un Contact OU un ContactSimple de l'annuaire : seuls ces 4 champs comptent)
const memePersonne = (a: { prenom: string; nom: string; email: string; tel: string }, b: { prenom: string; nom: string; email: string; tel: string }) =>
  (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) ||
  (a.tel && b.tel && normTel(a.tel) === normTel(b.tel)) ||
  (a.prenom.trim().toLowerCase() === b.prenom.trim().toLowerCase() &&
    a.nom.trim().toLowerCase() === b.nom.trim().toLowerCase());

// ── Types d'activités façon HubSpot ──
// "etape" est un type interne : il trace les mouvements de deals dans le pipeline
// (généré automatiquement, jamais saisi à la main par l'utilisateur).
// Les autres types sont consignés manuellement depuis le composer des fiches.
type TypeActivite = "note" | "email" | "appel" | "tache" | "reunion" | "etape";
interface Activite { date: string; texte: string; type?: TypeActivite; echeance?: string }

// Source de vérité unique pour l'affichage de chaque type dans la timeline :
// icône, libellé et couleur (utilisés par la timeline ET le composer, donc cohérents partout).
const META_ACT: Record<TypeActivite, { icone: string; libelle: string; couleur: string }> = {
  note: { icone: "📝", libelle: "Note", couleur: "#f59e0b" },
  email: { icone: "✉️", libelle: "E-mail envoyé", couleur: "#0ea5e9" },
  appel: { icone: "📞", libelle: "Appel consigné", couleur: "#57c26b" },
  tache: { icone: "✅", libelle: "Tâche", couleur: "#8b5cf6" },
  reunion: { icone: "📅", libelle: "Réunion", couleur: "#ef8f3c" },
  etape: { icone: "➜", libelle: "Étape du deal", couleur: "#4f9ee8" },
};

interface Deal { id: string; nom: string; entrepriseId: string; contactId: string; montant: number; etape: Etape; action: string; echeance: string; notes: string; fait: boolean; activites: Activite[] }

// L'état global de l'application : la base de données entière tient dans cet objet.
interface Etat { entreprises: Entreprise[]; contacts: Contact[]; deals: Deal[] }

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
    { id: "e1", statut: "Client", nom: "Rotisserie du Rhône", nomCommercial: "Rotisserie du Rhône — Lyon 7e", secteur: "Restauration", ville: "Lyon 7e", site: "rotisserie-du-rhone.fr", tel: "04 72 11 02 44", franchiseur: "Indépendant", modeLivraison: "Scooter électrique", activite: "Restauration traditionnelle", notes: "Contrat annuel signé. 3 scooters livrés le 20/10.", activites: [{ date: "auj.", texte: "Point de livraison confirmé avec Julien — créneau 8h-10h.", type: "note" }] },
    { id: "e2", statut: "Client", nom: "Poké Bowl Express", nomCommercial: "Poké Bowl Express — Lyon 3e", secteur: "Restauration", ville: "Lyon 3e", site: "pokebowl-express.fr", tel: "04 78 22 10 87", franchiseur: "Indépendant", modeLivraison: "Scooter électrique", activite: "Restauration rapide", notes: "2 scooters + abonnement maintenance." },
    { id: "e3", statut: "Prospect", nom: "Bières & Burgers", nomCommercial: "Bières & Burgers — Villeurbanne", secteur: "Restauration", ville: "Villeurbanne", site: "bieres-et-burgers.fr", tel: "04 72 55 71 03", franchiseur: "Burger King", modeLivraison: "Mixte", activite: "Restauration rapide", notes: "Chaîne en expansion, levier flotte 4 scooters.", activites: [{ date: "12/10", texte: "Visite du 2e restaurant — très intéressé par le levier flotte.", type: "reunion" }] },
    { id: "e4", statut: "Prospect", nom: "Fleurs Martin & Fils", nomCommercial: "Fleurs Martin & Fils — Lyon 6e", secteur: "Commerce floral", ville: "Lyon 6e", site: "martin-fleurs.fr", tel: "04 72 39 18 66", franchiseur: "Indépendant", modeLivraison: "Vélo électrique", activite: "Commerce floral", notes: "Livraisons matinales, besoin de 2 scooters." },
    { id: "e5", statut: "Prospect", nom: "L'Atelier Pizzeria", nomCommercial: "Domino's Pizza — Lyon 1er", secteur: "Restauration", ville: "Lyon 1er", site: "atelier-pizzeria.fr", tel: "04 37 45 09 12", franchiseur: "Domino's Pizza", modeLivraison: "Scooter électrique", activite: "Restauration rapide", notes: "" },
    { id: "e6", statut: "Prospect", nom: "Café des Jacobins", nomCommercial: "Café des Jacobins — Lyon 2e", secteur: "Café / brunch", ville: "Lyon 2e", site: "jacquou.fr", tel: "04 72 60 34 21", franchiseur: "Indépendant", modeLivraison: "À pied", activite: "Restauration traditionnelle", notes: "Budget serré, périmètre à réduire.", activites: [{ date: "09/10", texte: "Préparer une proposition à périmètre réduit", type: "tache", echeance: "16/10" }] },
    { id: "e7", statut: "Suspect", nom: "Marché Bio Villeurbanne", nomCommercial: "Marché Bio — Villeurbanne", secteur: "Alimentation bio", ville: "Villeurbanne", site: "marche-bio-69.fr", tel: "—", franchiseur: "Indépendant", modeLivraison: "Cargo bike", activite: "Alimentation bio", notes: "Contact entrant via le site." },
    { id: "e8", statut: "Suspect", nom: "Wok City", nomCommercial: "Wok City — Lyon 8e", secteur: "Restauration", ville: "Lyon 8e", site: "wok-city.fr", tel: "04 78 00 55 71", franchiseur: "Indépendant", modeLivraison: "Scooter électrique", activite: "Restauration rapide", notes: "" },
    { id: "e9", statut: "Suspect", nom: "S.A.R.L DP Lyon 3", nomCommercial: "Domino's Pizza — Lyon 3e", secteur: "Restauration", ville: "Lyon 3e", site: "dominos.fr", tel: "04 78 55 21 09", franchiseur: "Domino's Pizza", modeLivraison: "Scooter électrique", activite: "Restauration rapide", notes: "" },
    /* ════ CLIENTS RÉELS — importés du Sheet « Infos Service Client » (14/10/2026) ════
       Chaque ligne = un code client du Sheet (contrats Locam) : pack choisi,
       période (min début → max fin des contrats du client), nombre de véhicules
       uniques, n° de contrat(s) Locam, immatriculations. Mode de livraison
       « Scooter électrique » pour tous : c'est le produit réellement loué
       (COMPACT PRO / INFINITY PRO / S4-S5 Delivery = scooters U'mob, colonne
       Libellé Produit du Sheet). Activité renseignée d'après l'enseigne
       réelle (vérifiée sur le web pour les cas ambigus). Champ `risque`
       alimenté par les colonnes Statut_risque_client / Impayes /
       Procedure_collective du Sheet. Franchiseur laissé VIDE : le Sheet ne
       le connaît pas (règle anti-fausses-infos). Contacts réels rattachés. */
    { id: "e10", statut: "Client", nom: "GAF", nomCommercial: "Boîte à Pizza Annemasse", secteur: "Restauration", ville: "Annemasse", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Intégral + 48", dateDebut: "15/03/2024", dateFin: "05/04/2028", nbVehicules: "2", contratLocam: "CO01559", immatriculations: "GQ-591-NL, GQ-692-NL", risque: "Impayé", notes: "Code client C0010 — importé du Sheet « Infos Service Client » (14/10/2026). ⚠️ Impayé (source Sheet SAV)." },
    { id: "e11", statut: "Client", nom: "LA GROTTA AZZURA", nomCommercial: "La Grotte", secteur: "Restauration", ville: "Saint-Étienne", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration traditionnelle", pack: "Modèle Intégral + 48", dateDebut: "26/06/2024", dateFin: "10/08/2028", nbVehicules: "3", contratLocam: "CO01677", immatriculations: "GX-881-RL, GX-801-RL, GX-742-RL", notes: "Code client C0033 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e12", statut: "Client", nom: "JMBS", nomCommercial: "Cosmo Sushi", secteur: "Restauration", ville: "Mandelieu-la-Napoule", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Intégral 48 · Modèle Intégral + 48", dateDebut: "26/03/2021", dateFin: "10/09/2027", nbVehicules: "4", contratLocam: "CO01398, CO01397", immatriculations: "FY-042-CC, GH-367-WG, GH-412-WG, GH-441-WG", notes: "Code client C0046 — importé du Sheet « Infos Service Client » (14/10/2026). Autre site : Fréjus (JHE Fréjus Sushi, mêmes gérants)." },
    { id: "e13", statut: "Client", nom: "NKM SARL", nomCommercial: "Dol's Pizza", secteur: "Restauration", ville: "Dole", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48 · Modèle Confort + 50", dateDebut: "13/01/2025", dateFin: "29/08/2030", nbVehicules: "8", contratLocam: "CO01844, CO02220", immatriculations: "HA-008-QX, HA-035-QX, HA-905-QW, HA-945-QW, HA-974-QW, HL-239-NP, HL-209-NP, HL-281-NP", notes: "Code client C0071 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e14", statut: "Client", nom: "H2 ASSOCIÉS", nomCommercial: "Pizza All Over World", secteur: "Restauration", ville: "Nice", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "01/05/2023", dateFin: "30/06/2027", nbVehicules: "2", contratLocam: "CO02104", immatriculations: "GN-036-XF, GN-082-XF", notes: "Code client C0109 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e15", statut: "Client", nom: "ALVAREZ MARC", nomCommercial: "Bella Pizza", secteur: "Restauration", ville: "Thonon-les-Bains", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "23/10/2024", dateFin: "30/11/2028", nbVehicules: "1", contratLocam: "CO01765", immatriculations: "GZ-706-MH", notes: "Code client C0111 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e16", statut: "Client", nom: "SUSHI NOGENT DÉVELOPPEMENT", nomCommercial: "Sushi Shop", secteur: "Restauration", ville: "Nogent-sur-Marne", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort 48", dateDebut: "22/02/2023", dateFin: "10/04/2027", nbVehicules: "4", contratLocam: "CO01206", immatriculations: "GM-463-FL, GM-490-FL, GM-510-FL, GM-526-FL", notes: "Code client C0113 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e17", statut: "Client", nom: "AVENIR PIZZA", nomCommercial: "Pizza Time", secteur: "Restauration", ville: "Le Bourget", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort 48", dateDebut: "23/02/2023", dateFin: "09/04/2027", nbVehicules: "2", contratLocam: "CO00605", immatriculations: "GM-669-FZ, GM-703-FZ", notes: "Code client C0123 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e18", statut: "Client", nom: "STYLE BURGER", nomCommercial: "Delim's Burger", secteur: "Restauration", ville: "Épinay-sur-Seine", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort 48 · Modèle Confort + 48", dateDebut: "10/06/2021", dateFin: "30/08/2027", nbVehicules: "3", contratLocam: "CO00645, CO01159", immatriculations: "FZ-440-WL, GQ-416-AJ, GQ-485-AJ", notes: "Code client C0135 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e19", statut: "Client", nom: "DOCRIVE", nomCommercial: "Class'Croute Paris 19", secteur: "Restauration", ville: "Paris", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Zen 36 · Modèle Confort + 48", dateDebut: "01/01/2018", dateFin: "08/03/2027", nbVehicules: "4", contratLocam: "CO00923, CO00922", immatriculations: "ES-134-WF, ES-138-WF, ES-139-WF, GL-082-XH", risque: "Procédure collective", notes: "Code client C0143 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e20", statut: "Client", nom: "VIGILANTI JEAN CLAUDE", nomCommercial: "Fratelli Pizzas", secteur: "Restauration", ville: "Nice", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "12/11/2025", dateFin: "10/02/2030", nbVehicules: "2", contratLocam: "CO02086", immatriculations: "HG-937-LK, HG-968-LK", notes: "Code client C0152 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e21", statut: "Client", nom: "TTF CORPORATION", nomCommercial: "Pizza Hut", secteur: "Restauration", ville: "Pontault-Combault", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48 · Modèle Confort + 50", dateDebut: "28/09/2023", dateFin: "21/07/2030", nbVehicules: "4", contratLocam: "CO01357, CO01494, CO02192", immatriculations: "GR-862-JA, GR-825-JA, GT-902-JA, HK-231-TS", notes: "Code client C0162 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e22", statut: "Client", nom: "BON PLAN", nomCommercial: "Spidzza Grand Mère", secteur: "Restauration", ville: "Valence", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "VP · Modèle Confort + 48 · Modèle Confort + 50", dateDebut: "01/03/2019", dateFin: "20/04/2030", nbVehicules: "5", contratLocam: "CO00075, CO01162, CO02136", immatriculations: "FD-069-TL, FJ-579-KQ, GA-162-TM, FB-680-XL, HH-138-TT", risque: "Impayé", notes: "Code client C0199 — importé du Sheet « Infos Service Client » (14/10/2026). ⚠️ Impayé (source Sheet SAV)." },
    { id: "e23", statut: "Client", nom: "CCR", nomCommercial: "Mister Pizza", secteur: "Restauration", ville: "Antibes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48 · Modèle Confort + 50", dateDebut: "12/11/2025", dateFin: "12/05/2030", nbVehicules: "5", contratLocam: "CO02085, CO02155", immatriculations: "HG-720-LT, HG-682-LT, HG-640-LT, HJ-902-PJ, HJ-553-PJ", notes: "Code client C0210 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e24", statut: "Client", nom: "AHI (AHIKA) LYON 7", nomCommercial: "", secteur: "Restauration", ville: "Lyon", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Intégral + 48", dateDebut: "16/07/2024", dateFin: "15/08/2028", nbVehicules: "1", contratLocam: "CO01694", immatriculations: "GY-681-EE", notes: "Code client C0212 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e25", statut: "Client", nom: "MAHE.COM", nomCommercial: "Pizza Le 33", secteur: "Restauration", ville: "Grasse", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort 48", dateDebut: "20/09/2021", dateFin: "30/09/2025", nbVehicules: "4", contratLocam: "CO00114", immatriculations: "GB-389-RF, GB-766-RF, GB-156-RG, GB-279-RG", notes: "Code client C0213 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e26", statut: "Client", nom: "RICA", nomCommercial: "Mister Pizza", secteur: "Restauration", ville: "Le Cannet", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48 · Modèle Confort + 50", dateDebut: "11/01/2024", dateFin: "30/05/2030", nbVehicules: "12", contratLocam: "CO01506, CO01943, CO02099, CO02164", immatriculations: "GT-150-NE, HC-881-WP, HC-812-WP, HG-191-SY, HG-230-SY, HG-148-SY, HG-094-SY, HG-025-SY, HG-935-SX, HG-851-SX, HJ-564-XC, HJ-486-XC", notes: "Code client C0229 — importé du Sheet « Infos Service Client » (14/10/2026). Autre site : Cannes." },
    { id: "e27", statut: "Client", nom: "JSD SUSHIS", nomCommercial: "Sushi Or Not Sushi", secteur: "Restauration", ville: "Marseille", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort 48", dateDebut: "20/12/2018", dateFin: "20/10/2023", nbVehicules: "1", contratLocam: "CO01322", immatriculations: "FB-799-SD", risque: "Impayé + Procédure collective", notes: "Code client C0232 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e28", statut: "Client", nom: "TCHIKO", nomCommercial: "Pizza Time Poissy", secteur: "Restauration", ville: "Poissy", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort 48 · Modèle Confort + 48", dateDebut: "07/03/2022", dateFin: "20/12/2028", nbVehicules: "4", contratLocam: "CO00879, CO01775", immatriculations: "GB-027-QV, GZ-604-WC, GZ-578-WC, GZ-552-WC", notes: "Code client C0245 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e29", statut: "Client", nom: "CARNOT", nomCommercial: "Mister Pizza Cannes", secteur: "Restauration", ville: "Cannes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "04/02/2025", dateFin: "28/03/2029", nbVehicules: "15", contratLocam: "CO01875", immatriculations: "HB-023-HJ, HB-051-HJ, HB-091-HJ, HB-130-HJ, HB-171-HJ, HB-223-HJ, HB-676-HH, HB-720-HH, HB-757-HH, HB-798-HH, HB-831-HH, HB-961-HH, HB-297-HJ, HB-450-HJ, HB-928-HH", notes: "Code client C0251 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e30", statut: "Client", nom: "ADG", nomCommercial: "Mister Pizza Cannes", secteur: "Restauration", ville: "Cannes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort 48 · Modèle Confort + 48", dateDebut: "26/04/2023", dateFin: "27/02/2029", nbVehicules: "8", contratLocam: "CO00993, CO01573, CO01861", immatriculations: "GN-245-LJ, GV-228-TW, HB-344-MM, HB-314-MM, HB-276-MM, HB-257-MM, HB-216-MM, HB-162-MM", notes: "Code client C0252 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e31", statut: "Client", nom: "VTN.INC", nomCommercial: "La Boîte à Pizza Muret", secteur: "Restauration", ville: "Muret", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "30/04/2024", dateFin: "20/06/2028", nbVehicules: "3", contratLocam: "CO01611", immatriculations: "GW-563-LK, GW-627-LK, GW-695-LK", notes: "Code client C0256 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e32", statut: "Client", nom: "FRANK", nomCommercial: "Pizza Time Franconville", secteur: "Restauration", ville: "Franconville", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 36", dateDebut: "26/06/2024", dateFin: "31/07/2029", nbVehicules: "2", contratLocam: "CO01671, CO02201", immatriculations: "GX-634-QR, HK-970-ZE", notes: "Code client C0259 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e33", statut: "Client", nom: "DAFNEY", nomCommercial: "Pizza Time St-Ouen-l'Aumône", secteur: "Restauration", ville: "Saint-Ouen-l'Aumône", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort 48", dateDebut: "11/02/2019", dateFin: "30/10/2026", nbVehicules: "3", contratLocam: "CO00904, CO00903", immatriculations: "FD-205-SB, GJ-828-KV, GJ-849-KV", notes: "Code client C0260 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e34", statut: "Client", nom: "LOIRE SUSHI", nomCommercial: "Eat Sushi", secteur: "Restauration", ville: "Saint-Étienne", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Intégral 48 · Modèle Intégral + 48", dateDebut: "18/05/2022", dateFin: "28/02/2028", nbVehicules: "3", contratLocam: "CO00596, CO01522", immatriculations: "GG-700-HQ, GT-109-SW, GT-083-SW", notes: "Code client C0268 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e35", statut: "Client", nom: "CHEZ PINO", nomCommercial: "", secteur: "Restauration", ville: "Valence", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48 · Modèle Confort + 50", dateDebut: "28/03/2024", dateFin: "02/09/2030", nbVehicules: "3", contratLocam: "CO01572, CO02222", immatriculations: "GV-297-YF, HL-892-NN, HL-811-NN", notes: "Code client C0270 — importé du Sheet « Infos Service Client » (14/10/2026). Autre site : Portes-lès-Valence." },
    { id: "e36", statut: "Client", nom: "SEBA", nomCommercial: "Pizza Time Champs-sur-Marne", secteur: "Restauration", ville: "Champs-sur-Marne", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "16/01/2025", dateFin: "15/02/2029", nbVehicules: "2", contratLocam: "CO01854", immatriculations: "HB-693-FB, HB-738-FB", notes: "Code client C0272 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e37", statut: "Client", nom: "ALLO PIZZA KELLY BURGER", nomCommercial: "", secteur: "Restauration", ville: "Antibes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "10/02/2025", dateFin: "09/03/2029", nbVehicules: "4", contratLocam: "CO01889", immatriculations: "HB-423-SK, HB-465-SK, HB-497-SK, HB-532-SK", notes: "Code client C0281 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e38", statut: "Client", nom: "SIMHA 7", nomCommercial: "Zapi Sushi", secteur: "Restauration", ville: "Nogent-sur-Marne", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 50", dateDebut: "15/05/2026", dateFin: "14/07/2030", nbVehicules: "2", contratLocam: "CO02190", immatriculations: "HK-666-SH, HK-773-SH", notes: "Code client C0284 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e39", statut: "Client", nom: "MORENO US", nomCommercial: "Mega Pizza", secteur: "Restauration", ville: "Metz", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "23/06/2023", dateFin: "20/02/2028", nbVehicules: "2", contratLocam: "CO01114, CO01507", immatriculations: "GH-141-LA, GT-807-KQ", notes: "Code client C0297 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e40", statut: "Client", nom: "KEVIN", nomCommercial: "Indian Star", secteur: "Restauration", ville: "Beausoleil", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "04/07/2024", dateFin: "20/12/2029", nbVehicules: "3", contratLocam: "CO01688, CO02065", immatriculations: "GX-192-TC, HG-776-DS, HG-801-DS", notes: "Code client C0306 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e41", statut: "Client", nom: "CHAMEROY", nomCommercial: "L'Antiboise", secteur: "Restauration", ville: "Antibes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Zen + 48 · Modèle Confort + 48", dateDebut: "25/06/2024", dateFin: "30/12/2029", nbVehicules: "3", contratLocam: "CO01659, CO02067", immatriculations: "GX-912-FA, HG-722-EM, HG-635-EM", notes: "Code client C0307 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e42", statut: "Client", nom: "M BAREK", nomCommercial: "Le D'Lys Tacos", secteur: "Restauration", ville: "Antibes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "28/09/2023", dateFin: "20/10/2029", nbVehicules: "3", contratLocam: "CO01356, CO02018", immatriculations: "GR-073-DR, HE-340-SW, HE-385-SW", notes: "Code client C0308 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e43", statut: "Client", nom: "MA-ROSE", nomCommercial: "Pizza Time Taverny", secteur: "Restauration", ville: "Taverny", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 36", dateDebut: "24/10/2024", dateFin: "23/11/2027", nbVehicules: "2", contratLocam: "CO01768", immatriculations: "GZ-020-HH, GZ-936-HG", notes: "Code client C0309 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e44", statut: "Client", nom: "LES 2 FRÈRES", nomCommercial: "Specialitaly", secteur: "Restauration", ville: "Menton", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "27/04/2023", dateFin: "27/05/2027", nbVehicules: "2", contratLocam: "CO01229", immatriculations: "GN-497-LH, GN-532-LH", risque: "À risque", notes: "Code client C0320 — importé du Sheet « Infos Service Client » (14/10/2026). ⚠️ À risque (source Sheet SAV)." },
    { id: "e45", statut: "Client", nom: "GMA", nomCommercial: "La Boîte à Pizza Cugnaux", secteur: "Restauration", ville: "Cugnaux", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort 48", dateDebut: "25/04/2019", dateFin: "30/04/2023", nbVehicules: "4", contratLocam: "CO00209", immatriculations: "FF-967-QV, FF-043-QW, FF-134-QW, FF-223-QW", risque: "Procédure collective", notes: "Code client C0321 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e46", statut: "Client", nom: "SUSHI WAKO", nomCommercial: "Wako", secteur: "Restauration", ville: "Le Vésinet", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Zen 48", dateDebut: "15/09/2020", dateFin: "14/09/2024", nbVehicules: "1", contratLocam: "CO00749", immatriculations: "FS-603-RR", risque: "À risque", notes: "Code client C0336 — importé du Sheet « Infos Service Client » (14/10/2026). Autres sites : Nanterre, Puteaux. ⚠️ À risque (source Sheet SAV)." },
    { id: "e47", statut: "Client", nom: "MER", nomCommercial: "Mister Pizza Nice Californie", secteur: "Restauration", ville: "Nice", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 50", dateDebut: "15/06/2026", dateFin: "14/08/2030", nbVehicules: "10", contratLocam: "CO02209", immatriculations: "HL-992-FA, HL-072-FB, HL-034-FB, HL-949-FA, HL-334-FB, HL-129-FB, HL-491-FB, HL-573-FB, HL-420-FB, HL-199-FB", notes: "Code client C0338 — importé du Sheet « Infos Service Client » (14/10/2026). Autre site : Vence." },
    { id: "e48", statut: "Client", nom: "MEV", nomCommercial: "Allo Japonais", secteur: "Restauration", ville: "Poitiers", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Zen + 48 · Modèle Zen + 50", dateDebut: "28/12/2023", dateFin: "25/10/2030", nbVehicules: "3", contratLocam: "CO01490, CO02249", immatriculations: "GT-511-DN, HM-129-KS, HM-116-KS", risque: "À risque", notes: "Code client C0339 — importé du Sheet « Infos Service Client » (14/10/2026). ⚠️ À risque (source Sheet SAV)." },
    { id: "e49", statut: "Client", nom: "STAR CHICKEN", nomCommercial: "", secteur: "Restauration", ville: "Albi", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "23/06/2023", dateFin: "22/06/2027", nbVehicules: "1", contratLocam: "CO01107", immatriculations: "GH-258-SN", risque: "Impayé", notes: "Code client C0350 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e50", statut: "Client", nom: "COSTES RESTAURATION", nomCommercial: "Tutti Pizza — Montauban Voltaire", secteur: "Restauration", ville: "Montauban", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48 · Modèle Confort + 50", dateDebut: "13/01/2025", dateFin: "02/10/2030", nbVehicules: "2", contratLocam: "CO01845, CO02239", immatriculations: "HA-866-YL, HM-050-CT", notes: "Code client C0359 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e51", statut: "Client", nom: "SYSM", nomCommercial: "Mister Pizza Mandelieu", secteur: "Restauration", ville: "Mandelieu-la-Napoule", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "30/06/2023", dateFin: "20/01/2030", nbVehicules: "9", contratLocam: "CO01361, CO02082", immatriculations: "GQ-937-BF, GQ-892-BF, HG-633-HG, HG-658-HG, HG-686-HG, HG-711-HG, HG-736-HG, HG-765-HG, HG-605-HG", notes: "Code client C0360 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e52", statut: "Client", nom: "JAIVASAVI", nomCommercial: "La Galaxie", secteur: "Restauration", ville: "Saint-Vallier-de-Thiey", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "03/04/2025", dateFin: "20/05/2029", nbVehicules: "1", contratLocam: "CO01924", immatriculations: "HC-338-QQ", notes: "Code client C0361 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e53", statut: "Client", nom: "ALIDA", nomCommercial: "Jassmin Pizza", secteur: "Restauration", ville: "Villecresnes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort 48", dateDebut: "10/10/2019", dateFin: "10/10/2023", nbVehicules: "1", contratLocam: "CO00813", immatriculations: "FK-829-NE", risque: "Impayé", notes: "Code client C0362 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e54", statut: "Client", nom: "BOBUN BOULEVARD", nomCommercial: "", secteur: "Restauration", ville: "Lyon", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort 48", dateDebut: "07/11/2022", dateFin: "20/04/2027", nbVehicules: "1", contratLocam: "CO01438", immatriculations: "GM-279-EZ", risque: "Impayé", notes: "Code client C0368 — importé du Sheet « Infos Service Client » (14/10/2026). ⚠️ Impayé (source Sheet SAV)." },
    { id: "e55", statut: "Client", nom: "ABDELHAFID GAZZAH", nomCommercial: "Stop Pizza 2", secteur: "Restauration", ville: "Antibes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Zen + 48", dateDebut: "16/02/2023", dateFin: "20/03/2027", nbVehicules: "1", contratLocam: "CO01386", immatriculations: "GM-957-CW", notes: "Code client C0376 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e56", statut: "Client", nom: "BING ME", nomCommercial: "Arigato", secteur: "Restauration", ville: "Bruges", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Zen 48 · Modèle Zen + 48", dateDebut: "10/08/2022", dateFin: "10/01/2028", nbVehicules: "2", contratLocam: "CO00839, CO01467", immatriculations: "GH-698-YA, GS-034-RA", risque: "À risque", notes: "Code client C0387 — importé du Sheet « Infos Service Client » (14/10/2026). ⚠️ À risque (source Sheet SAV)." },
    { id: "e57", statut: "Client", nom: "AEW CANNES", nomCommercial: "Asiakeo", secteur: "Restauration", ville: "Cannes", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort 48", dateDebut: "22/07/2022", dateFin: "22/08/2026", nbVehicules: "1", contratLocam: "CO00254", immatriculations: "GH-399-PH", notes: "Code client C0388 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e58", statut: "Client", nom: "NOSANTOKUNOSUSHIS", nomCommercial: "Samouraï Sushi Dijon", secteur: "Restauration", ville: "Dijon", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 48", dateDebut: "04/06/2024", dateFin: "20/07/2028", nbVehicules: "1", contratLocam: "CO01644", immatriculations: "GX-913-FZ", notes: "Code client C0392 — importé du Sheet « Infos Service Client » (14/10/2026)." },
    { id: "e59", statut: "Client", nom: "AU FOURNIL DE STEPH", nomCommercial: "Allo Pizza Sète", secteur: "Restauration", ville: "Sète", site: "", tel: "", franchiseur: "", modeLivraison: "Scooter électrique", activite: "Restauration rapide", pack: "Modèle Confort + 50", dateDebut: "05/02/2026", dateFin: "04/04/2030", nbVehicules: "2", contratLocam: "CO02141", immatriculations: "HH-119-ZQ, HH-179-ZQ", notes: "Code client C0397 — importé du Sheet « Infos Service Client » (14/10/2026)." },
  ],
  contacts: [
    { id: "c1", prenom: "Julien", nom: "Faure", role: "Gérant", email: "j.faure@rotisserie-du-rhone.fr", tel: "06 12 44 87 21", entrepriseIds: ["e1"], activites: [{ date: "auj.", texte: "Appel 6 min : souhaite la maintenance incluse dans le contrat annuel.", type: "appel" }] },
    { id: "c2", prenom: "Amine", nom: "Berrada", role: "Gérant", email: "amine@pokebowl-express.fr", tel: "06 45 21 33 09", entrepriseIds: ["e2"], activites: [{ date: "08/10", texte: "Proposition envoyée : abonnement 2 scooters + maintenance", type: "email" }] },
    { id: "c3", prenom: "Charlotte", nom: "Ly", role: "Directrice exploitation", email: "c.ly@bieres-et-burgers.fr", tel: "06 88 12 54 76", entrepriseIds: ["e3"], activites: [{ date: "11/10", texte: "A demandé une remise sur la 4e année — à creuser en négo.", type: "appel" }] },
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
  ],
  deals: [
    { id: "d1", nom: "Contrat annuel — flotte 3 scooters", entrepriseId: "e1", contactId: "c1", montant: 42, etape: "Gagné", action: "Kick-off maintenance", echeance: "20/10", notes: "", fait: false, activites: [{ date: "12/10", texte: "Étape : Négociation → Gagné" }] },
    { id: "d2", nom: "Abonnement 2 scooters", entrepriseId: "e2", contactId: "c2", montant: 31, etape: "Gagné", action: "Planifier livraison flotte", echeance: "22/10", notes: "", fait: false, activites: [{ date: "08/10", texte: "Étape : Proposition envoyée → Gagné" }] },
    { id: "d3", nom: "Flotte 4 scooters + maintenance", entrepriseId: "e3", contactId: "c3", montant: 58, etape: "Négociation", action: "RDV négo — levier flotte 4 scooters", echeance: "15/10", notes: "Sensible au prix, envisager 10% sur la 4e année.", fait: false, activites: [{ date: "11/10", texte: "Visite effectuée" }] },
    { id: "d4", nom: "2 scooters livraisons matinales", entrepriseId: "e4", contactId: "c4", montant: 24, etape: "Proposition envoyée", action: "Relancer la proposition (J+3)", echeance: "13/10", notes: "", fait: false, activites: [{ date: "10/10", texte: "Proposition envoyée par email" }] },
    { id: "d5", nom: "Abonnement 1 scooter", entrepriseId: "e5", contactId: "c5", montant: 18, etape: "Proposition envoyée", action: "Attente retour devis", echeance: "17/10", notes: "", fait: false, activites: [] },
    { id: "d6", nom: "2 scooters périmètre réduit", entrepriseId: "e6", contactId: "c6", montant: 15, etape: "Négociation", action: "Réduire le périmètre — 2 scooters", echeance: "16/10", notes: "Refuser 3 scooters pour l'instant.", fait: false, activites: [] },
    { id: "d7", nom: "Découverte — livraison bio", entrepriseId: "e7", contactId: "c7", montant: 36, etape: "À qualifier", action: "Appel découverte à programmer", echeance: "15/10", notes: "Contact entrant via le site.", fait: false, activites: [] },
    { id: "d8", nom: "Essai 1 scooter", entrepriseId: "e8", contactId: "c8", montant: 12, etape: "À qualifier", action: "Qualifier périmètre & budget", echeance: "18/10", notes: "", fait: false, activites: [] },
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
  return {
    ...s,
    entreprises: (s.entreprises || []).map((x) => ({
      nomCommercial: "", franchiseur: "", modeLivraison: "", activite: "", statut: "Suspect",
      // Migration « Contrat & flotte » : champs absents des vieilles
      // sauvegardes → vides (jamais d'invention).
      pack: "", dateDebut: "", dateFin: "", nbVehicules: "", contratLocam: "", immatriculations: "",
      // Migration « Risque » : champ absent des vieilles sauvegardes → vide.
      risque: "",
      ...x,
      activites: x.activites || [],
    })),
    // Migration contacts : l'ancien champ unique `entrepriseId` devient un
    // TABLEAU `entrepriseIds` (un contact peut appartenir à plusieurs
    // entreprises). Les vieux enregistrements sont convertis à la volée.
    contacts: (s.contacts || []).map((x) => ({
      ...x,
      entrepriseIds: x.entrepriseIds || ((x as { entrepriseId?: string }).entrepriseId ? [(x as { entrepriseId: string }).entrepriseId] : []),
      activites: x.activites || [],
    })),
  };
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
const OPTIONS_MODE_LIVRAISON = ["Scooter électrique", "Scooter thermique", "Vélo électrique", "Cargo bike", "Voiture", "À pied", "Mixte"];
const OPTIONS_ACTIVITE = ["Restauration rapide", "Restauration traditionnelle", "Livraison de repas", "Boulangerie / Pâtisserie", "Commerce floral", "Alimentation bio", "Commerce de détail", "Services", "Autre"];
// Valeurs du champ « Risque » (source Sheet SAV : Statut_risque_client,
// Impayes, Procedure_collective). L'option vide « — » de ChampSelect vaut
// « aucun risque signalé ».
const OPTIONS_RISQUE = ["Impayé", "À risque", "Procédure collective", "Impayé + Procédure collective"];

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
type FicheRef = { type: "entreprise" | "contact"; id: string };

// « ContactSimple » = contact identifié par la recherche automatique (SIREN/téléphone).
// Format allégé : on ne crée pas encore un Contact complet, on propose juste
// les infos trouvées, l'utilisateur coche/décoche avant création.
type ContactSimple = { prenom: string; nom: string; role: string; email: string; tel: string };

// « SocieteSimple » = une AUTRE société du même dirigeant, suggérée à la
// création (ex. le 2e Domino's de M. Piron). Même principe que les contacts :
// une case à cocher pour accepter ou refuser chaque création.
type SocieteSimple = { nom: string; nomCommercial: string; ville: string; secteur: string; site: string; tel: string; franchiseur: string; modeLivraison: string; activite: string };

// Modèles vierges servant de point de départ en mode création.
const ENT_VIDE: Entreprise = { id: "", nom: "", nomCommercial: "", secteur: "", ville: "", site: "", tel: "", franchiseur: "", modeLivraison: "", activite: "", statut: "Suspect", notes: "", activites: [], pack: "", dateDebut: "", dateFin: "", nbVehicules: "", contratLocam: "", immatriculations: "", risque: "" };
const CTC_VIDE: Contact = { id: "", prenom: "", nom: "", role: "", email: "", tel: "", entrepriseIds: [], activites: [] };
const DEAL_VIDE: Deal = { id: "", nom: "", entrepriseId: "", contactId: "", montant: 0, etape: "À qualifier", action: "", echeance: "", notes: "", fait: false, activites: [] };

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
  const depuisGouv = async (r: Record<string, unknown>): Promise<(typeof ANNUAIRE_DEMO)[number]> => {
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
    return {
      siren: String(r.siren || ""), tel: "", telAffiche: "",
      nom: String(r.nom_complet || r.nom_raison_sociale || ""),
      nomCommercial: enseigne && ville ? enseigne + " — " + ville : enseigne,
      ville,
      secteur: SECTION_SECTEUR[String(r.section_activite_principale || "")] || "",
      site: "", franchiseur: "", modeLivraison: "",
      activite: NAF_ACTIVITE[naf] || "",
      sources: ["INSEE · API Recherche d’entreprises"],
      contactsTrouves: contacts,
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
  const enrichir = async () => {
    let q = qRecherche.replace(/\D/g, "");
    if (q.length === 11 && q.startsWith("33")) q = "0" + q.slice(2);
    const qt = qRecherche.trim();
    if (q.length >= 10 && q.startsWith("0")) {
      const f = annuaireLocal(q);
      if (f) appliquer(f);
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
        appliquer(await depuisGouv(r));
      } else {
        const f = annuaireLocal(q);
        if (f) appliquer(f);
        else rienTrouve();
      }
    } catch {
      const f = annuaireLocal(q);
      if (f) appliquer(f);
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
      onClick={onClose}
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
                        setContactsProposes(contactsProposes.map((x) => ({ ...x, coche: !toutCoche })));
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
                          onChange={() => setContactsProposes(contactsProposes.map((x, j) => (j === i ? { ...x, coche: !x.coche } : x)))}
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
                    Décochées par défaut : coche uniquement celles que tu veux ajouter au CRM maintenant. Le dirigeant sera rattaché à chacune.
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
                  Sheet « Infos Service Client » / contrats Locam). Éditables
                  à la main, comme tous les champs du CRM. ── */}
              <div className="col-span-2 mt-1 rounded-lg bg-slate-50 px-2 py-1.5 text-[11px] font-black uppercase tracking-wider text-slate-400">Contrat & flotte (Locam)</div>
              <div><label className={label}>Pack choisi</label>
                <input className={champ} value={ent.pack} onChange={(e) => setEnt({ ...ent, pack: e.target.value })} placeholder="ex. Modèle Confort + 48" /></div>
              <div><label className={label}>N° contrat Locam</label>
                <input className={champ} value={ent.contratLocam} onChange={(e) => setEnt({ ...ent, contratLocam: e.target.value })} placeholder="ex. CO01559" /></div>
              <div><label className={label}>Date début contrat</label>
                <input className={champ} value={ent.dateDebut} onChange={(e) => setEnt({ ...ent, dateDebut: e.target.value })} placeholder="ex. 15/03/2024" /></div>
              <div><label className={label}>Date fin contrat</label>
                <input className={champ} value={ent.dateFin} onChange={(e) => setEnt({ ...ent, dateFin: e.target.value })} placeholder="ex. 05/04/2028" /></div>
              <div><label className={label}>Nb véhicules</label>
                <input className={champ} value={ent.nbVehicules} onChange={(e) => setEnt({ ...ent, nbVehicules: e.target.value })} placeholder="ex. 2" /></div>
              <div><label className={label}>Immatriculations</label>
                <input className={champ} value={ent.immatriculations} onChange={(e) => setEnt({ ...ent, immatriculations: e.target.value })} placeholder="ex. GQ-591-NL, GQ-692-NL" /></div>
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
                {/* Cliquer un contact ouvre sa PAGE RECORD (pas son édition). */}
                {contactsEntreprise(ent.id).map((c) => (
                  <button key={c.id} onClick={() => onOuvreFiche({ type: "contact", id: c.id })}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left hover:bg-white">
                    <span className="text-[12px] font-semibold text-slate-700">{c.prenom} {c.nom} <span className="text-slate-400">· {c.role}</span></span>
                    <span className="text-[10px] font-bold text-cyan-600">›</span>
                  </button>
                ))}
                <div className="mb-1.5 mt-3 text-[11px] font-black uppercase tracking-wider text-slate-400">Deals ({dealsEntreprise(ent.id).length})</div>
                {/* Les deals n'ont pas de page record : ils s'éditent en modale. */}
                {dealsEntreprise(ent.id).map((d) => (
                  <button key={d.id} onClick={() => onOuvre({ type: "deal", id: d.id })}
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
              <button onClick={() => onSauver(cible, { ...ent, nom: ent.nom.trim() || "Sans nom" },
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
            {/* Historique compact du deal : les 5 dernières activités, plus récentes d'abord. */}
            {!nouveau && deal.activites.length > 0 && (
              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <div className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-slate-400">Historique</div>
                {deal.activites.slice(-5).reverse().map((a, i) => (
                  <div key={i} className="text-[11px] text-slate-500">
                    <span className="font-bold text-slate-600">{a.date}</span> — {a.texte}
                  </div>
                ))}
              </div>
            )}
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
      <div className="mb-2 flex items-center justify-between">
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
function genererResumeIA(nom: string, events: { date: string; texte: string; type?: TypeActivite }[], prochaine?: { nom: string; action: string; echeance: string } | null) {
  const derniere = events[0];
  // Sentiment estimé sur les 5 activités les plus récentes (comme la ligne
  // « Sentiment » du résumé HubSpot de la capture) : positif si mots-clés
  // enthousiastes, négatif si mots-clés d'insatisfaction, neutre sinon.
  const corpus = events.slice(0, 5).map((x) => x.texte).join(" ").toLowerCase();
  let sentiment = "neutre";
  let couleurSentiment = "#94a3b8";
  if (/(satisfait|content|ravi|parfait|super|enthousiaste|intéressé|interessé|validé|valide|impatient)/.test(corpus)) { sentiment = "positif"; couleurSentiment = "#57c26b"; }
  if (/(mécontent|mecontent|déçu|decu|problème|probleme|panne|trop cher|refus|refuse|annulé|annule|retard|inquiet)/.test(corpus)) { sentiment = "négatif"; couleurSentiment = "#ef4444"; }
  // Paragraphe narratif : dernière activité citée + action de suivi en attente.
  const texte =
    (derniere
      ? `Le ${derniere.date} — ${META_ACT[derniere.type || "note"].libelle.toLowerCase()} : « ${derniere.texte.slice(0, 160)}${derniere.texte.length > 160 ? "…" : ""} ».`
      : `${nom} n'a encore aucune activité enregistrée.`) +
    (prochaine && prochaine.action
      ? ` Une action de suivi est prévue : ${prochaine.action}${prochaine.echeance ? ` (le ${prochaine.echeance})` : ""}${prochaine.nom ? ` sur le deal « ${prochaine.nom} »` : ""}.`
      : " Aucune action de suivi en attente.");
  // « Sources » = nombre d'événements qui alimentent la synthèse (comme HubSpot).
  return { texte, sentiment, couleurSentiment, sources: events.length };
}

/* Carte affichée en bas de la colonne droite des fiches Entreprise/Contact :
   badge IA, date de génération + nombre de sources, paragraphe synthétisé
   et ligne « Sentiment ». */
function ResumeIA({ nom, events, prochaine }: {
  nom: string;
  events: { date: string; texte: string; type?: TypeActivite }[];
  prochaine?: { nom: string; action: string; echeance: string } | null;
}) {
  const r = genererResumeIA(nom, events, prochaine);
  // Date du jour au format long français, comme « Généré le 14 octobre 2026 ».
  const generee = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  return (
    <CarteFiche titre="Résumé de la fiche"
      action={<span className="rounded-full px-2 py-0.5 text-[9.5px] font-black text-white"
        style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>✨ IA</span>}>
      <div className="mb-1.5 text-[10px] text-slate-400">Généré le {generee} · {r.sources} source{r.sources > 1 ? "s" : ""}</div>
      <p className="text-[12.5px] leading-relaxed text-slate-600">{r.texte}</p>
      {/* Ligne sentiment, comme dans le résumé HubSpot de la capture. */}
      <div className="mt-2 flex items-center gap-1.5 rounded-xl bg-slate-50 px-2 py-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.couleurSentiment }} />
        <span className="text-[11px] font-bold text-slate-500">Sentiment : <span style={{ color: r.couleurSentiment }}>{r.sentiment}</span></span>
      </div>
    </CarteFiche>
  );
}

// Transforme une date affichée ("auj.", "15/10", "2/10"…) en nombre triable :
// "auj." est toujours en tête (9999), sinon on garde le jour du mois (int parsé).
// Astuce simple valable parce que toutes les dates de démo sont dans le même mois.
const valDate = (s: string) => (s === "auj." ? 9999 : parseInt(s, 10) || 0);

// Timeline d'activités des fiches. Chaque event peut être :
//  - une activité de la fiche elle-même (note, appel… sans deal rattaché)
//  - une activité d'un deal associé (porte une référence `deal` → lien cliquable)
function Chronologie({ events, onOuvre }: { events: (Activite & { deal?: Deal })[]; onOuvre: (c: Cible) => void }) {
  if (events.length === 0) {
    return (
      <div className="text-[12px] text-slate-400">
        Aucune activité pour le moment. Utilise les boutons ci-dessus pour consigner une note, un e-mail, un appel, une tâche ou une réunion.
      </div>
    );
  }
  return (
    <div className="divide-y divide-slate-50">
      {events.map((ev, i) => {
        // Rétro-compatibilité : les anciennes activités (pré-typage) n'ont pas de
        // `type`. On le déduit : rattachée à un deal → changement d'étape, sinon note.
        const typeEff: TypeActivite = ev.type ?? (ev.deal ? "etape" : "note");
        const meta = META_ACT[typeEff]; // icône/couleur/libellé du type
        return (
          <div key={i} className="flex items-start gap-3 py-2.5">
            {/* Pastille de l'icône : couleur du type à ~9% d'opacité (suffixe "18"). */}
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px]"
              style={{ background: `${meta.couleur}18` }}>{meta.icone}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-black uppercase tracking-wider" style={{ color: meta.couleur }}>{meta.libelle}</div>
              <div className="text-[12.5px] leading-relaxed text-slate-700">{ev.texte}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                <span className="font-bold">{ev.date}</span>
                {/* Badge d'échéance pour les tâches et réunions planifiées. */}
                {ev.echeance && <Badge texte={`échéance ${ev.echeance}`} couleur={meta.couleur} />}
                {/* Lien vers le deal source de l'activité (ouvre la modale deal). */}
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
function ComposerActivites({ onAjouter }: {
  onAjouter: (type: "note" | "email" | "appel" | "tache" | "reunion", texte: string, echeance?: string) => void;
}) {
  const [typeSel, setTypeSel] = useState<(typeof TYPES_COMPOSER)[number]["type"] | null>(null);
  const [texte, setTexte] = useState("");
  const [echeance, setEcheance] = useState("");

  // Fermeture = remise à zéro complète du formulaire.
  const fermer = () => { setTypeSel(null); setTexte(""); setEcheance(""); };
  // Validation : texte obligatoire, échéance transmise seulement si non vide.
  const ajouter = () => {
    const t = texte.trim();
    if (!t || !typeSel) return;
    onAjouter(typeSel, t, echeance.trim() || undefined);
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
      </div>
      {/* Formulaire contextuel : placeholder adapté au type, champ échéance
          supplémentaire pour les tâches et les réunions uniquement. */}
      {typeSel && (
        <div className="mt-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="mb-2 text-[10.5px] font-black uppercase tracking-wider" style={{ color: META_ACT[typeSel].couleur }}>
            {META_ACT[typeSel].icone} {META_ACT[typeSel].libelle}
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
          {(typeSel === "tache" || typeSel === "reunion") && (
            <input value={echeance} onChange={(ev) => setEcheance(ev.target.value)}
              placeholder={typeSel === "tache" ? "Échéance (ex. 15/10)" : "Date de la réunion (ex. 18/10)"}
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

// En-tête des pages record : bandeau dégradé, avatar initiales chevauchant le
// bandeau, nom + infos clés, et boutons d'action passés par le parent.
function EnteteFiche({ initiales, nom, sous, boutons }: { initiales: string; nom: string; sous: string; boutons: React.ReactNode }) {
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
        </div>
        <div className="flex flex-wrap items-center gap-2">{boutons}</div>
      </div>
    </div>
  );
}

/* ---- Page record ENTREPRISE : colonne principale (À propos + Activités),
        colonne droite (Résumé + Contacts + Deals), comme une fiche HubSpot. ---- */
function FicheEntreprise({ etat, id, onRetour, onOuvre, onOuvreFiche, onActivite, onModifie }: {
  etat: Etat; id: string;
  onRetour: () => void;
  onOuvre: (c: Cible) => void;              // ouvre la modale (édition, deals…)
  onOuvreFiche: (f: FicheRef) => void;     // navigue vers une autre page record
  onActivite: (type: "entreprise" | "contact", id: string, activite: Activite) => void; // journalise une activité
  onModifie: (patch: Partial<Entreprise>) => void; // édition directe du panneau « À propos »
}) {
  const e = etat.entreprises.find((x) => x.id === id);
  // Garde-fou : si l'entreprise a été supprimée pendant qu'on était sur sa
  // fiche, on n'affiche que le bouton retour (évite un écran blanc cassé).
  if (!e) {
    return <button onClick={onRetour} className="text-[12px] font-bold text-slate-400 hover:text-slate-600">← Entreprises</button>;
  }
  // ── Agrégats dérivés de l'état (recalculés à chaque rendu, pas besoin de cache) ──
  const contacts = etat.contacts.filter((c) => c.entrepriseIds.includes(e.id));
  const deals = etat.deals.filter((d) => d.entrepriseId === e.id);
  const actifs = deals.filter((d) => d.etape !== "Gagné" && d.etape !== "Perdu");
  const pipeline = actifs.reduce((s, d) => s + d.montant, 0);
  // Timeline = activités de l'entreprise ELLE-MÊME + activités de ses deals
  // (on rattache le deal à chaque événement pour le lien cliquable),
  // triées de la plus récente à la plus ancienne.
  const events = [
    ...e.activites,
    ...deals.flatMap((d) => d.activites.map((a) => ({ ...a, deal: d }))),
  ].sort((x, y) => valDate(y.date) - valDate(x.date));
  // ── Prochaine action en attente (1er deal non fermé avec une action à faire) :
  // elle alimente le résumé « IA » affiché en bas de la colonne droite. ──
  const prochaine = deals.find((d) => d.action && !d.fait && d.etape !== "Gagné" && d.etape !== "Perdu");

  // Le composer remonte son activité au parent avec la date du jour.
  const ajouterActivite = (type: "note" | "email" | "appel" | "tache" | "reunion", texte: string, echeance?: string) => {
    onActivite("entreprise", e.id, { date: "auj.", texte, type, echeance });
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
      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[860px] grid-cols-[minmax(0,240px)_minmax(0,1fr)_minmax(0,270px)] gap-4">
          {/* Colonne gauche : À propos (= panneau « Informations clés » HubSpot). */}
          <div>
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
              <PropTexte label="Secteur" valeur={e.secteur} onChange={(v) => onModifie({ secteur: v })} />
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
              <Prop label="Contacts" valeur={String(contacts.length)} />
              <Prop label="Pipeline actif" valeur={`${pipeline} k€`} />
            </div>
            {/* Les notes libres s'affichent en encart sous les propriétés. */}
              {e.notes && <p className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-2.5 text-[12.5px] leading-relaxed text-slate-600">{e.notes}</p>}
            </CarteFiche>
          </div>

          {/* Colonne centrale : Activités (composer + timeline), comme le
              bandeau central de la fiche HubSpot. */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 text-[13px] font-black text-slate-700">Activités</div>
            <ComposerActivites onAjouter={ajouterActivite} />
            <div className="mt-3">
              <Chronologie events={events} onOuvre={onOuvre} />
            </div>
          </div>

          {/* Colonne droite : associations puis résumé (comme HubSpot). */}
          <div className="space-y-4">
            {/* Carte « Contrat & flotte » : affichée seulement si un champ
                contrat est renseigné (les prospects n'ont pas de contrat).
                Chaque ligne est éditable sur place (même mécanisme inline
                que le panneau À propos). Source des données auto : Sheet
                « Infos Service Client » (packs, dates, véhicules, Locam). */}
            {(e.pack || e.contratLocam || e.nbVehicules || e.immatriculations || e.risque) && (
              <CarteFiche titre="🛵 Contrat & flotte">
                <div className="space-y-2">
                  {e.risque && (
                    <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5">
                      <span className="text-[13px]">⚠️</span>
                      <span className="text-[12px] font-bold text-red-600">{e.risque}</span>
                      <span className="ml-auto text-[10px] font-medium text-red-400">source SAV</span>
                    </div>
                  )}
                  <PropTexte label="Pack choisi" valeur={e.pack} onChange={(v) => onModifie({ pack: v })} />
                  <PropTexte label="N° contrat Locam" valeur={e.contratLocam} onChange={(v) => onModifie({ contratLocam: v })} />
                  <div className="flex gap-3">
                    <div className="min-w-0 flex-1"><PropTexte label="Début" valeur={e.dateDebut} onChange={(v) => onModifie({ dateDebut: v })} /></div>
                    <div className="min-w-0 flex-1"><PropTexte label="Fin" valeur={e.dateFin} onChange={(v) => onModifie({ dateFin: v })} /></div>
                  </div>
                  <div className="flex gap-3">
                    <div className="min-w-0 flex-1"><PropTexte label="Véhicules" valeur={e.nbVehicules} onChange={(v) => onModifie({ nbVehicules: v })} /></div>
                    <div className="min-w-0 flex-1"><PropSelect label="Risque" valeur={e.risque} options={OPTIONS_RISQUE} onChange={(v) => onModifie({ risque: v })} /></div>
                  </div>
                  <PropTexte label="Immatriculations" valeur={e.immatriculations} onChange={(v) => onModifie({ immatriculations: v })} />
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
                <button key={d.id} onClick={() => onOuvre({ type: "deal", id: d.id })}
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

            {/* Résumé auto en bas de la colonne droite (comme HubSpot). */}
            {/* Résumé « IA » en bas de la colonne droite (comme Breeze HubSpot). */}
            <ResumeIA nom={e.nom} events={events} prochaine={prochaine} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Page record CONTACT : même structure que l'entreprise, mais les
        associations sont l'entreprise (unique) + ses deals personnels. ---- */
function FicheContact({ etat, id, onRetour, onOuvre, onOuvreFiche, onActivite }: {
  etat: Etat; id: string;
  onRetour: () => void;
  onOuvre: (c: Cible) => void;
  onOuvreFiche: (f: FicheRef) => void;
  onActivite: (type: "entreprise" | "contact", id: string, activite: Activite) => void;
}) {
  const c = etat.contacts.find((x) => x.id === id);
  // Même garde-fou que la fiche entreprise : contact supprimé → retour simple.
  if (!c) {
    return <button onClick={onRetour} className="text-[12px] font-bold text-slate-400 hover:text-slate-600">← Contacts</button>;
  }
  // Agrégats : TOUTES les entreprises du contact (multi-comptes), deals portés
  // PAR CE CONTACT (contactId), timeline de ses propres activités + deals.
  const entreprises = etat.entreprises.filter((x) => c.entrepriseIds.includes(x.id));
  const deals = etat.deals.filter((d) => d.contactId === c.id);
  const actifs = deals.filter((d) => d.etape !== "Gagné" && d.etape !== "Perdu");
  const events = [
    ...c.activites,
    ...deals.flatMap((d) => d.activites.map((a) => ({ ...a, deal: d }))),
  ].sort((x, y) => valDate(y.date) - valDate(x.date));
  // Prochaine action en attente : alimente le résumé « IA » de la colonne droite.
  const prochaine = deals.find((d) => d.action && !d.fait && d.etape !== "Gagné" && d.etape !== "Perdu");

  const ajouterActivite = (type: "note" | "email" | "appel" | "tache" | "reunion", texte: string, echeance?: string) => {
    onActivite("contact", c.id, { date: "auj.", texte, type, echeance });
  };

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
      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[860px] grid-cols-[minmax(0,240px)_minmax(0,1fr)_minmax(0,270px)] gap-4">
          {/* Colonne gauche : À propos. */}
          <div>
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

          {/* Colonne centrale : Activités (composer + timeline). */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 text-[13px] font-black text-slate-700">Activités</div>
            <ComposerActivites onAjouter={ajouterActivite} />
            <div className="mt-3">
              <Chronologie events={events} onOuvre={onOuvre} />
            </div>
          </div>

          {/* Colonne droite : associations puis résumé. */}
          <div className="space-y-4">
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
                <button key={d.id} onClick={() => onOuvre({ type: "deal", id: d.id })}
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

            {/* Résumé « IA » en bas de la colonne droite (comme Breeze HubSpot). */}
            <ResumeIA nom={`${c.prenom} ${c.nom}`} events={events} prochaine={prochaine} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================== VUES ============================== */

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
    !q || [e.nom, e.nomCommercial, e.statut, e.secteur, e.ville].join(" ").toLowerCase().includes(q));
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
    return !q || [c.prenom, c.nom, c.role, c.email, ...es.map((x) => x.nom)].join(" ").toLowerCase().includes(q);
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
    return !q || [d.nom, e?.nom || "", c?.nom || "", d.action].join(" ").toLowerCase().includes(q);
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
                     Un simple clic (sans drag) ouvre le deal en modale. */
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
  const [vue, setVue] = useState<"dashboard" | "entreprises" | "contacts" | "pipeline">("dashboard"); // liste affichée
  const [recherche, setRecherche] = useState("");     // recherche globale du header
  const [cible, setCible] = useState<Cible | null>(null); // modale ouverte (null = fermée)
  const [fiche, setFiche] = useState<FicheRef | null>(null); // page record ouverte (null = liste)

  // Routeur des listes : une entreprise / un contact EXISTANT ouvre sa page
  // record ; tout le reste (id null = création, deals = pas de page record)
  // tombe dans la modale.
  const ouvrir = (c: Cible) => {
    if ((c.type === "entreprise" || c.type === "contact") && c.id) setFiche({ type: c.type, id: c.id });
    else setCible(c);
  };
  // Navigation entre pages record (associations cliquables) : la modale se ferme
  // pour laisser place à la fiche (comme HubSpot qui navigue d'une fiche à l'autre).
  const ouvrirFiche = (f: FicheRef) => { setFiche(f); setCible(null); };

  // Chargement initial : l'état complet vient de Supabase. Première ouverture
  // (aucune ligne en base) → écran d'initialisation — on ne pré-remplit
  // JAMAIS les données sans décision explicite.
  useEffect(() => {
    chargerEtat()
      .then((d) => {
        if (d) setEtat(normaliser(d as Etat));
        else setBaseVide(true);
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
          Sheet « Infos Service Client » (contrats Locam, flotte, risques SAV, 51 contacts),
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

  // Journalise une activité (note, e-mail, appel…) sur une entreprise ou un
  // contact, de façon immuable : on recrée le tableau plutôt que le muter.
  const ajouterActivite = (type: "entreprise" | "contact", id: string, activite: Activite) => {
    setEtat((s) => type === "entreprise"
      ? { ...s, entreprises: s.entreprises.map((x) => (x.id === id ? { ...x, activites: [...x.activites, activite] } : x)) }
      : { ...s, contacts: s.contacts.map((x) => (x.id === id ? { ...x, activites: [...x.activites, activite] } : x)) }
    );
  };

  // Édition directe depuis le panneau « À propos » de la fiche entreprise :
  // on n'applique que le PATCH (champs modifiés) sur l'objet existant, de façon
  // immuable. La sauvegarde Supabase suit toute seule via le useEffect.
  const modifierEntreprise = (id: string, patch: Partial<Entreprise>) => {
    setEtat((s) => ({ ...s, entreprises: s.entreprises.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
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
                entrepriseIds: [eid], activites: [],
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
          pack: "", dateDebut: "", dateFin: "", nbVehicules: "", contratLocam: "", immatriculations: "", risque: "",
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
      // dans l'historique du deal (visible dans la timeline des fiches).
      const d = donnees as Deal;
      const ancien = s.deals.find((x) => x.id === d.id);
      const activites =
        ancien && ancien.etape !== d.etape
          ? [...d.activites, { date: "auj.", texte: `Étape : ${ancien.etape} → ${d.etape}`, type: "etape" }]
          : d.activites;
      const existe = s.deals.some((x) => x.id === d.id);
      return { ...s, deals: existe ? s.deals.map((x) => (x.id === d.id ? { ...d, activites } : x)) : [...s.deals, { ...d, activites, id: idSuivantLocal("d", 1) }] };
    });
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
  // dans l'historique du deal, comme une modification via la modale.
  const deplacer = (id: string, etape: Etape) => {
    setEtat((s) => ({
      ...s,
      deals: s.deals.map((d) =>
        d.id === id && d.etape !== etape
          ? { ...d, etape, activites: [...d.activites, { date: "auj.", texte: `Étape : ${d.etape} → ${etape}`, type: "etape" }] }
          : d
      ),
    }));
  };

  // Icônes de la navigation (barre latérale + version mobile).
  const ICONES_NAV: Record<string, string> = { dashboard: "📊", entreprises: "🏢", contacts: "👥", pipeline: "📈" };

  // Les 4 vues principales, dans l'ordre de la barre latérale.
  const onglets = [
    ["dashboard", "Tableau de bord"],
    ["entreprises", "Entreprises"],
    ["contacts", "Contacts"],
    ["pipeline", "Pipeline"],
  ] as const;

  // Le bouton « + » du header crée l'objet cohérent avec la vue affichée.
  const boutonAjout: Record<string, Cible> = {
    dashboard: { type: "deal", id: null, preset: "" },
    entreprises: { type: "entreprise", id: null },
    contacts: { type: "contact", id: null },
    pipeline: { type: "deal", id: null, preset: "" },
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
          <button key={cle} onClick={() => { setFiche(null); setVue(cle as typeof vue); }}
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
          {/* Logo compact : seulement sur mobile (la sidebar l'affiche déjà ailleurs). */}
          <div className="flex items-center gap-2.5 sm:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl text-[13px] font-black text-white"
              style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>U'</div>
            <div className="text-[13px] font-black text-slate-800">CRM U'mob</div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher…"
              className="w-44 rounded-xl border border-slate-200 px-3 py-1.5 text-[12px] outline-none focus:border-cyan-500" />
            <button onClick={() => setCible(boutonAjout[vue])}
              className="rounded-xl px-3 py-1.5 text-[12px] font-black text-white"
              style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>
              + {vue === "entreprises" ? "Entreprise" : vue === "contacts" ? "Contact" : "Deal"}
            </button>
          </div>
        </div>
        {/* Navigation mobile : chips défilables (équivalent de la sidebar). */}
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

      {/* Rendu principal : la page record ÉCRASE la liste quand elle est ouverte.
          `onOuvre={setCible}` dans les fiches : leurs boutons ouvrent des modales.
          Les listes utilisent `ouvrir` (le routeur modale/fiche) et le pipeline
          reçoit aussi `deplacer` pour le drag & drop. */}
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
