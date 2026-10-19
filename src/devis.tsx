// ==================== MODULE DEVIS — matrice tarifaire V20260624 ====================
// Transposé depuis la maquette validée « umob-module-devis-maquette ».
// Composants UI locaux (l'app n'utilise pas shadcn) : mêmes usages que la maquette.
// AUCUNE commission ici (R10) — le flag « Renouvellement » est enregistré sans incidence prix.
import React, { useEffect, useMemo, useRef, useState } from "react";

// ---------- Helpers de fusion de classes (évite les conflits Tailwind) ----------
const sansHover = (cls: string) => cls.replace(/(hover|focus|group-hover)[:?]bg-[\w/.-]+/g, "");
const aBg = (cls: string) => sansHover(cls).includes("bg-");

// ---------- Shims UI natifs (Card, Button, Input, Label, Badge, Separator, Checkbox) ----------
function Card({ className = "", children }: any) {
  const bord = /\bborder/.test(className) ? "" : "border border-slate-200 ";
  const fond = aBg(className) ? "" : "bg-white ";
  return <div className={"rounded-2xl shadow-sm " + bord + fond + className}>{children}</div>;
}
function CardHeader({ className = "", children }: any) {
  return <div className={"px-5 pt-4 pb-1 " + className}>{children}</div>;
}
function CardContent({ className = "", children }: any) {
  return <div className={"px-5 pb-5 " + className}>{children}</div>;
}
function CardTitle({ className = "", children }: any) {
  return <h3 className={"text-base font-semibold " + className}>{children}</h3>;
}
function Button({ variant = "default", size = "default", className = "", ...props }: any) {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ";
  const sizes: Record<string, string> = { default: "px-3.5 py-1.5 text-sm ", sm: "px-2.5 py-1 text-xs ", lg: "px-5 py-2.5 text-base " };
  let v: string;
  if (variant === "outline") v = "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 ";
  else if (variant === "ghost") v = "text-slate-600 hover:bg-slate-100 ";
  else v = (aBg(className) ? "" : "bg-slate-800 hover:bg-slate-700 ") + (className.includes("text-") ? "" : "text-white ") + "border border-transparent ";
  return <button type="button" className={base + v + sizes[size] + className} {...props} />;
}
function Input({ className = "", ...props }: any) {
  return <input className={"w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 " + className} {...props} />;
}
function Label({ className = "", ...props }: any) {
  return <label className={"block text-[13px] font-medium text-slate-700 " + className} {...props} />;
}
function Badge({ variant = "default", className = "", children }: any) {
  const base = "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ";
  const fond = aBg(className) ? "" : variant === "outline" ? "bg-white " : "bg-slate-100 ";
  const col = className.includes("text-") ? "" : variant === "outline" ? "border border-slate-300 text-slate-600 " : "text-slate-700 ";
  const bord = variant === "outline" && !/\bborder/.test(className) ? "border border-slate-300 " : variant === "outline" ? "border " : "";
  return <span className={base + fond + bord + col + className}>{children}</span>;
}
function Separator() {
  return <div className="my-2.5 border-t border-slate-200" />;
}
function Checkbox({ checked, onCheckedChange, className = "" }: any) {
  return <input type="checkbox" checked={!!checked} onChange={(e) => onCheckedChange && onCheckedChange(e.target.checked)} className={"h-4 w-4 cursor-pointer accent-emerald-600 " + className} />;
}
const SEL = "w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30";

// ==================== DONNÉES (matrice V20260624) ====================
const TAUX: Record<number, number> = { 14: 0.08875, 20: 0.0612, 26: 0.04832, 32: 0.0397, 38: 0.03378, 44: 0.03025, 50: 0.02701 };

type Famille = "INFINITY" | "DAILY" | "COMPACT" | "FLEXCITY" | "AUCUNE";
interface Article { nom: string; cat: string; pvu: number; famille: Famille; }
const ARTICLES: Article[] = [
  { nom: "Châssis INFINITY PRO 50cc", cat: "Châssis", pvu: 4108.56, famille: "INFINITY" },
  { nom: "Châssis INFINITY PRO 125cc", cat: "Châssis", pvu: 4368.66, famille: "INFINITY" },
  { nom: "Châssis DAILY PRO 50cc", cat: "Châssis", pvu: 3029.40, famille: "DAILY" },
  { nom: "Châssis COMPACT PRO 50cc", cat: "Châssis", pvu: 2603.04, famille: "COMPACT" },
  { nom: "Châssis COMPACT PRO GC (sans batt., sans chargeur)", cat: "Châssis", pvu: 2314, famille: "COMPACT" },
  { nom: "Batterie B60V45Ah 2700Wh", cat: "Batteries", pvu: 1560.60, famille: "AUCUNE" },
  { nom: "Batterie B60V45Ah 2700Wh SOH 100%", cat: "Batteries", pvu: 1366.80, famille: "AUCUNE" },
  { nom: "Super Chargeur 60V15A", cat: "Chargeurs", pvu: 396.78, famille: "AUCUNE" },
  { nom: "Chargeur Standard 60V8A", cat: "Chargeurs", pvu: 260.10, famille: "AUCUNE" },
  { nom: "Châssis INFINITY PRO 50cc Reconditionné", cat: "Reconditionné", pvu: 2128.91, famille: "INFINITY" },
  { nom: "Châssis INFINITY PRO 125cc Reconditionné", cat: "Reconditionné", pvu: 2128.91, famille: "INFINITY" },
  { nom: "Châssis COMPACT PRO 50cc Reconditionné", cat: "Reconditionné", pvu: 1422.56, famille: "COMPACT" },
  { nom: "Batterie B60V45Ah 2700Wh Recond. SOH >80%", cat: "Reconditionné", pvu: 725, famille: "AUCUNE" },
  { nom: "Super Chargeur 60V15A Reconditionné", cat: "Reconditionné", pvu: 230, famille: "AUCUNE" },
  { nom: "Chargeur Standard 60V8A Reconditionné", cat: "Reconditionné", pvu: 150, famille: "AUCUNE" },
  { nom: "Châssis FLEXCITY 50cc", cat: "Châssis", pvu: 1933, famille: "FLEXCITY" },
  { nom: "Batterie 1560Wh FLEXCITY", cat: "Batteries", pvu: 916, famille: "AUCUNE" },
  { nom: "Chargeur FLEXCITY", cat: "Chargeurs", pvu: 255, famille: "AUCUNE" },
  { nom: "Caisse 100L noir ENG", cat: "Caisses", pvu: 199, famille: "AUCUNE" },
  { nom: "Caisse 100L rouge ENG", cat: "Caisses", pvu: 199, famille: "AUCUNE" },
  { nom: "Caisse 120L noir ENG", cat: "Caisses", pvu: 219, famille: "AUCUNE" },
  { nom: "Caisse 90L noir ARW (arrondie)", cat: "Caisses", pvu: 149, famille: "AUCUNE" },
  { nom: "Caisse 140L noir ARW (arrondie)", cat: "Caisses", pvu: 199, famille: "AUCUNE" },
  { nom: "Caisse 90L noir Isotherme ENG", cat: "Caisses", pvu: 215, famille: "AUCUNE" },
  { nom: "Caisse 135L noir Isotherme", cat: "Caisses", pvu: 230, famille: "AUCUNE" },
  { nom: "Caisse 209L ISO", cat: "Caisses", pvu: 350, famille: "AUCUNE" },
  { nom: "Top case FLEXCITY", cat: "Caisses", pvu: 75, famille: "AUCUNE" },
  { nom: "Serrure caisson", cat: "Caisses", pvu: 25, famille: "AUCUNE" },
  { nom: "Bulle / Saut-vent Infinity Pro", cat: "Accessoires", pvu: 89, famille: "AUCUNE" },
  { nom: "Panier avant Infinity Pro", cat: "Accessoires", pvu: 89, famille: "AUCUNE" },
  { nom: "Antivol U Xtrem Mini (SRA)", cat: "Accessoires", pvu: 48.90, famille: "AUCUNE" },
  { nom: "Casque Street Uni Noir Mat (M)", cat: "Accessoires", pvu: 49, famille: "AUCUNE" },
  { nom: "Casque Street Uni Noir Mat (L)", cat: "Accessoires", pvu: 49, famille: "AUCUNE" },
  { nom: "Casque Jet Le Mans Outlander (L)", cat: "Accessoires", pvu: 89.90, famille: "AUCUNE" },
  { nom: "Casque Intégral modulable ADX M3 (M)", cat: "Accessoires", pvu: 109.90, famille: "AUCUNE" },
  { nom: "Casque Intégral modulable ADX M3 (L)", cat: "Accessoires", pvu: 109.90, famille: "AUCUNE" },
  { nom: "Gants Printemps/Eté ADX Vista (L)", cat: "Accessoires", pvu: 29.90, famille: "AUCUNE" },
  { nom: "Gants Automne/Hiver ADX Hunza (L)", cat: "Accessoires", pvu: 37.90, famille: "AUCUNE" },
  { nom: "Vêtement de pluie ADX Noir (L)", cat: "Accessoires", pvu: 34.90, famille: "AUCUNE" },
  { nom: "Gilet réfléchissant ADX velcro jaune", cat: "Accessoires", pvu: 8.50, famille: "AUCUNE" },
  { nom: "Support téléphone avec USB étanche", cat: "Accessoires", pvu: 24.90, famille: "AUCUNE" },
  { nom: "Sac thermique", cat: "Accessoires", pvu: 60, famille: "AUCUNE" },
  { nom: "Balise GPS", cat: "Accessoires", pvu: 181, famille: "AUCUNE" },
  { nom: "Pack Protections Moto-Ecole FLEXCITY", cat: "Accessoires", pvu: 159, famille: "AUCUNE" },
  { nom: "Pack Formation 3h \"Entretenir un FLEXCITY\"", cat: "Accessoires", pvu: 280, famille: "AUCUNE" },
  { nom: "Starter Pack -30% (2 casques Jet + gants + support)", cat: "Accessoires", pvu: 185.15, famille: "AUCUNE" },
  { nom: "Forfait covering caisse 2 faces", cat: "Personnalisation", pvu: 149, famille: "AUCUNE" },
  { nom: "Forfait 1 (1 couleur : avant + arrière)", cat: "Personnalisation", pvu: 269, famille: "AUCUNE" },
  { nom: "Forfait 1C (2 couleurs : avant + arrière)", cat: "Personnalisation", pvu: 340, famille: "AUCUNE" },
  { nom: "Forfait 2 (Total look bandes)", cat: "Personnalisation", pvu: 69, famille: "AUCUNE" },
  { nom: "Forfait 3 logos carrosseries", cat: "Personnalisation", pvu: 99, famille: "AUCUNE" },
  { nom: "Scooter S5 DELIVERY (inc. 1 Batterie 2800Wh & 1 Chargeur)", cat: "Ensembles complets", pvu: 5349, famille: "AUCUNE" },
  { nom: "Scooter S5 DELIVERY GC (inc. 1 Batterie & 1 Chargeur)", cat: "Ensembles complets", pvu: 4359, famille: "AUCUNE" },
  { nom: "Scooter S5 DELIVERY 125 (inc. 2 Batteries & 1 Chargeur)", cat: "Ensembles complets", pvu: 6989, famille: "AUCUNE" },
];

// Remises max par famille × grille (extraits Tarifs B98:D136)
const REMISES: Record<string, Record<string, number>> = {
  INFINITY: { IND: 0.20, "GC 0": 0.1768, "GC 1": 0.2180, "GC 2 à 3": 0.2592, "GC 4 à 19": 0.3003, "GC + de 20": 0.3415, "SGC 1 à 4": 0.2418, "SGC 5 à 9": 0.2797, "SGC 10 à 29": 0.3176, "SGC 30 à 99": 0.3555, "SGC + de 100": 0.3934 },
  DAILY: { IND: 0.20, "GC 0": 0.1549, "GC 1": 0.1972, "GC 2 à 3": 0.2394, "GC 4 à 19": 0.2817, "GC + de 20": 0.3239, "SGC 1 à 4": 0.2222, "SGC 5 à 9": 0.2611, "SGC 10 à 29": 0.30, "SGC 30 à 99": 0.3389, "SGC + de 100": 0.3778 },
  COMPACT: { IND: 0.20, "GC 0": 0.1408, "GC 1": 0.1837, "GC 2 à 3": 0.2267, "GC 4 à 19": 0.2696, "GC + de 20": 0.3126, "SGC 1 à 4": 0.2149, "SGC 5 à 9": 0.2542, "SGC 10 à 29": 0.2934, "SGC 30 à 99": 0.3327, "SGC + de 100": 0.3719 },
};
const GRILLES = ["IND", "GC 0", "GC 1", "GC 2 à 3", "GC 4 à 19", "GC + de 20", "SGC 1 à 4", "SGC 5 à 9", "SGC 10 à 29", "SGC 30 à 99", "SGC + de 100"];

// ==================== REPRISE (Thermique Q3:T7 + Reprise) ====================
// Valeur marché € HT : 4 tranches km × 4 tranches âge
const MATRICE_REPRISE: Record<string, Record<string, number>> = {
  "< 5 000": { "< 1 an": 550, "1 - 2 ans": 500, "2 - 4 ans": 400, "> 4 ans": 300 },
  "5 000-10 000": { "< 1 an": 500, "1 - 2 ans": 400, "2 - 4 ans": 300, "> 4 ans": 250 },
  "10 000-15 000": { "< 1 an": 400, "1 - 2 ans": 300, "2 - 4 ans": 250, "> 4 ans": 200 },
  "> 15 000": { "< 1 an": 300, "1 - 2 ans": 250, "2 - 4 ans": 200, "> 4 ans": 100 },
};
// Coefficient de reprise selon l'âge (spec R8 : <1 an ×1,3 · 2-4 ans ×1,1 · sinon ×1,2)
const COEFS_REPRISE: Record<string, number> = { "< 1 an": 1.3, "1 - 2 ans": 1.2, "2 - 4 ans": 1.1, "> 4 ans": 1.2 };
// Valeur neuf HT des modèles repris (Thermique C3:I4) — U'mob S5 Delivery non valorisé
const MODELES_REPRISE: Record<string, number> = {
  "Piaggio Liberty": 1580, "Kymco Agility": 1290, "Peugeot Ludix Pro": 1290.83, "Peugeot Tweet": 1658.33,
  "Sym": 1290.83, "Kymco Agility 125": 1832.50, "Sym XPro 125": 1707.50, "U'mob S5 Delivery": 0,
};
// Ligne « remise déguisée » : une ligne de reprise SANS véhicule réel — le
// montant saisi en dur est lissé dans le loyer exactement comme une reprise.
const MODELE_REMISE_DEGUISEE = "🎁 Remise déguisée (hors reprise véhicule)";
export interface VehiculeReprise { id: number; modele: string; immat: string; mec: string; dateReleve: string; km: string; remiseEtat: string; repriseManuelle: string; reprendre: boolean; }

const PACKS_BASE: Record<string, number> = { "ZEN+": 12, "CONFORT+": 25, "INTEGRAL+": 39, "SMART": 10, "PREMIUM": 15, "EXPERT": 29, "TRANQUILITE": 5.9, "PILOTE": 3.9, "U'TRACK": 11.99 };
const TVA = 0.20;

const eur = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
const eurM = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

// ==================== COMPOSANTS ====================
function Stepper({ step, onGoTo }: { step: number; onGoTo?: (i: number) => void }) {
  const steps = ["Configuration", "Reprise", "Calcul & remises", "Packs & extras", "Devis client"];
  return (
    <div className="flex items-center gap-1 mb-5 text-sm flex-wrap">
      {steps.map((s, i) => {
        const clickable = !!onGoTo && i < step;
        return (
          <React.Fragment key={s}>
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full font-medium ${i === step ? "bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow" : i < step ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-slate-400"} ${clickable ? "cursor-pointer hover:bg-emerald-100 hover:border-emerald-300 transition-colors" : ""}`}
              onClick={clickable ? () => onGoTo!(i) : undefined}
              title={clickable ? `Revenir à : ${s}` : undefined}
            >
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${i === step ? "bg-white/20" : i < step ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-500"}`}>{i < step ? "✓" : i + 1}</span>
              {s}
            </div>
            {i < steps.length - 1 && <div className={`w-6 h-0.5 rounded ${i < step ? "bg-emerald-400" : "bg-slate-200"}`} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function LogoUmob({ width = 230 }: { width?: number }) {
  const font = "'Arial Rounded MT Bold','Segoe UI',system-ui,sans-serif";
  return (
    <svg width={width} viewBox="0 0 310 92" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="U'mob — Électrisez vos déplacements">
      {/* U' */}
      <text x="0" y="62" fontFamily={font} fontSize="52" fontWeight="800" fill="#9B9B9B">U&apos;</text>
      {/* cercle vert englobant le m */}
      <circle cx="92" cy="44" r="34" fill="#A4D03D" />
      <text x="76" y="58" fontFamily={font} fontSize="46" fontWeight="800" fill="#FFFFFF" textAnchor="middle">m</text>
      {/* éclair blanc au centre du cercle */}
      <path d="M108 20 L92 44 L102 44 L96 60 L114 38 L104 38 Z" fill="#FFFFFF" />
      {/* flèche en arc blanche, bas-droite, sens antihoraire */}
      <path d="M118 52 A17 17 0 0 0 100 66" stroke="#FFFFFF" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M100 66 L93 66 L99 72 Z" fill="#FFFFFF" />
      {/* ob */}
      <text x="138" y="62" fontFamily={font} fontSize="52" fontWeight="800" fill="#9B9B9B">ob</text>
      {/* slogan */}
      <text x="2" y="86" fontFamily={font} fontSize="13" fontWeight="700" fill="#9B9B9B" letterSpacing="1.4">ÉLECTRISEZ VOS DÉPLACEMENTS</text>
    </svg>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{label}</Label>
      {children}
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

// ==================== BROUILLON PERSISTÉ (etat.devis dans Supabase) ====================
export interface DevisBrouillon {
  step: number;
  societe: string;
  anciennete: string;
  mode: string;
  duree: number;
  grille: string;
  renouvellement: boolean;
  qtes: Record<string, string>;
  remises: Record<string, string>;
  // Les remises par article sont stockées en MONTANTS € (ex. "30,50"), pas en %.
  remisesEnEuros?: boolean;
  packsCoches: Record<string, boolean>;
  coupDePoing: number;
  remiseLibre: number;
  // Choix du commercial : afficher ou non la remise totale sur le devis client.
  afficherRemise?: boolean;
  commercial: string;
  miseADispoStr: string;
  fraisDossierStr: string;
  flotteReprise: VehiculeReprise[];
  dureeAmort: string;
  locamRenouvellement: { contrat: string; montant: string; date: string };
  // Liaison avec un devis DÉJÀ ARCHIVÉ (posée par App.tsx à l'ouverture d'une
  // archive « Rouvrir », et par le module après une sauvegarde réussie) :
  // présent + même société → la sauvegarde MET À JOUR l'archive d'origine
  // (même n° d'offre) au lieu d'en créer une nouvelle.
  idOrigine?: string;
  numOffreOrigine?: string;
  // Fiche entreprise CIBLÉE (ID interne du CRM), posée quand le compte est
  // choisi via « 🔍 Chercher un compte ». C'est elle qui départage deux
  // sociétés partageant le MÊME nom commercial (ex. NB2 / Nour Breizh) :
  // le nom commercial seul ne suffit plus à identifier la fiche.
  entId?: string;
}

// ==================== ARCHIVAGE SUR FICHE ENTREPRISE ====================
// Résumé figé au moment de la sauvegarde — calculs CLIENT uniquement :
// jamais de commission, ni grille, ni détail de reprise/empilage (R10).
export interface DevisResume {
  numOffre: string; societe: string; commercial: string; duree: number; nbChassis: number;
  loyerMensuelHT: number; loyerMensuelTTC: number; miseService: number;
  // Champs pour le PDF joint à l'e-mail. Optionnels : les archives créées avant
  // leur ajout ne les portent pas (le PDF retombe alors sur le total).
  dateEmission?: string; dateValiditeFr?: string; miseADispoTot?: number; fraisDossierTot?: number;
  articles: { nom: string; q: number; loyerU: number }[];
  packs: { nom: string; qte: number; loyer: number; total: number }[];
  // Remise totale CLIENT (uniquement si le commercial a choisi de l'afficher).
  remisePct?: number; remiseEco?: number; afficherRemise?: boolean;
}
// Texte du devis prêt à partir par e-mail (version client, sans données internes).
export interface MailDevis { destinataire: string; objet: string; corps: string; }
// Ce que le module transmet au CRM au moment de la sauvegarde.
export interface SauvegardeDevis { entId?: string; societe: string; commentaire: string; brouillon: DevisBrouillon; resume: DevisResume; mail: MailDevis; }
// Ce qui est archivé sur la fiche entreprise (id + horodatage ajoutés par App.tsx).
// statut : "enregistre" = simplement archivé sur la fiche ; "envoye" = le
// devis est parti au client (mail + PDF). Les archives créées avant ce champ
// n'en portent pas → affichées « Enregistré » par défaut.
export type DevisArchive = SauvegardeDevis & { id: string; dateISO: string; dateFr: string; statut?: "enregistre" | "envoye" | "accepte"; dateEnvoiFr?: string; dateRelanceFr?: string; dateAcceptationFr?: string };

// Modèle de corps de mail pour l'envoi du devis (persisté dans l'état du CRM
// via etat.modelesMailDevis → Supabase). Les variables {{...}} sont remplacées
// au moment de l'envoi par les valeurs du devis en cours.
export interface ModeleMailDevis { id: string; nom: string; objet: string; corps: string; }
// Variables insérables dans un modèle (chips cliquables du volet).
export const VARIABLES_MAIL: { code: string; label: string }[] = [
  { code: "{{societe}}", label: "Société" },
  { code: "{{numero}}", label: "N° d'offre" },
  { code: "{{commercial}}", label: "Commercial" },
  { code: "{{date_emission}}", label: "Date du devis" },
  { code: "{{date_validite}}", label: "Validité" },
  { code: "{{nb_scooters}}", label: "Nb scooters" },
  { code: "{{duree}}", label: "Durée (mois)" },
  { code: "{{loyer_ht}}", label: "Loyer HT/mois" },
  { code: "{{loyer_ttc}}", label: "Loyer TTC/mois" },
  { code: "{{mise_service}}", label: "Mise en service" },
];
// Remplace les variables d'un modèle par les valeurs du devis en cours.
export function rendreModeleMail(texte: string, r: DevisResume): string {
  return texte
    .replace(/\{\{societe\}\}/g, r.societe || "votre société")
    .replace(/\{\{numero\}\}/g, r.numOffre)
    .replace(/\{\{commercial\}\}/g, r.commercial || "L'équipe U'mob")
    .replace(/\{\{date_emission\}\}/g, r.dateEmission ?? "")
    .replace(/\{\{date_validite\}\}/g, r.dateValiditeFr ?? "")
    .replace(/\{\{nb_scooters\}\}/g, String(r.nbChassis))
    .replace(/\{\{duree\}\}/g, String(r.duree))
    .replace(/\{\{loyer_ht\}\}/g, eurM(r.loyerMensuelHT))
    .replace(/\{\{loyer_ttc\}\}/g, eurM(r.loyerMensuelTTC))
    .replace(/\{\{mise_service\}\}/g, eurM(r.miseService));
}

// ==================== PDF DU DEVIS (génération native, zéro dépendance) ====================
// Logo U'mob OFFICIEL (https://umob.fr/.../Logo-umob.png), décodé une fois pour toutes
// en RGB sur fond blanc, réduit à 600×218 et compressé (FlateDecode) — embarqué
// en base64 pour éviter tout appel réseau au moment de générer le PDF.
const LOGO_UMOB_PDF = { w: 620, h: 177, b64: "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" };
// Mise en page fidèle à l'écran « Devis client » du module : logo U'mob
// officiel (image embarquée), palette U'mob du site umob.fr (vert lime
// #B0C300, vert lime foncé #7D9000, gris #9B9B9B), en-têtes de tableaux
// teintés, filets fins, ligne de TOTAL par tableau (matériel & prestations),
// bandeau TTC en lime foncé, cadre « Bon pour accord ».
// Toujours construit octet par octet dans le navigateur (Helvetica/WinAnsi,
// zéro dépendance, pas d'appel réseau). Version CLIENT uniquement — jamais
// de grille, reprise ou commission (R10).
export function genererPdfDevis(r: DevisResume): Blob {
  const W = 595.28, H = 841.89, M = 54; // A4 portrait, marge 54 pt
  // Format € : espaces de milliers « normales » (les séparateurs insécables
  // de toLocaleString ne passent pas en WinAnsi et deviendraient des « ? »).
  const fr = (n: number) => {
    const v = Math.round((n || 0) * 100) / 100;
    const parties = Math.abs(v).toFixed(2).split(".");
    const entier = parties[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return (v < 0 ? "-" : "") + entier + "," + parties[1] + " €";
  };
  const WIN: Record<string, string> = { "\u20AC": "\u0080", "\u2019": "\u0092", "\u2018": "\u0091", "\u2013": "\u0096", "\u2014": "\u0097", "\u2022": "\u0095", "\u2026": "\u0085", "\u00A0": " ", "\u202F": " " };
  const esc = (s: string) => {
    let o = "";
    for (const ch of String(s ?? "")) {
      const m = WIN[ch];
      if (m !== undefined) { o += m; continue; }
      const c = ch.codePointAt(0) ?? 63;
      o += c >= 32 && c <= 255 ? String.fromCharCode(c) : "?";
    }
    return o.split("\\").join("\\\\").split("(").join("\\(").split(")").join("\\)");
  };

  // ── Palette & primitives de dessin vectoriel ──
  // Palette U'mob — couleurs EXACTES du logo officiel (umob.fr) :
  // vert lime #B0C300, vert lime foncé #7D9000, gris #9B9B9B (texte du logo).
  const LIME = [0.69, 0.765, 0.0];          // #B0C300 — bandeaux, filets
  const LIME_FONCE = [0.49, 0.565, 0.0];    // #7D9000 — titres, bandeau TTC
  const TEXTE_LIME = [0.24, 0.26, 0.0];     // #3D4200 — lisible sur fond lime
  const GRIS = [0.42, 0.45, 0.50];
  const GRIS_LOGO = [0.608, 0.608, 0.608];  // #9B9B9B — thead « Mise en service »
  const FILET = [0.87, 0.89, 0.91];
  const FOND_GRISE = [0.965, 0.97, 0.975];
  const FOND_VERT = [0.961, 0.976, 0.867];   // #F5F9DD — lime pâle (badge, récap)
  const LIME_DOUX = [0.72, 0.79, 0.42];      // #B8CA6B — cadre du récap
  const LIME_ENCRE = [0.29, 0.33, 0.0];      // #4B5400 — texte du récap
  const NOIR = [0.23, 0.25, 0.26];          // #3B3F42
  const BLANC = [1, 1, 1];
  const c3 = (c: number[]) => c[0] + " " + c[1] + " " + c[2];
  const cmds: string[] = [];
  const Y = (yTop: number) => (H - yTop).toFixed(2);
  const T = (x: number, yTop: number, s: string, size?: number, bold?: boolean, c?: number[], it?: boolean) => {
    const taille = size ?? 9;
    const f = bold ? "F2" : it ? "F3" : "F1";
    cmds.push("BT /" + f + " " + taille + " Tf " + c3(c ?? NOIR) + " rg " + x.toFixed(2) + " " + Y(yTop) + " Td (" + esc(s) + ") Tj ET");
  };
  // Largeur approximative Helvetica (~0,50 em ; ~0,56 em en gras).
  const lgeur = (s: string, size: number, bold: boolean) => String(s).length * size * (bold ? 0.56 : 0.5);
  const R = (right: number, yTop: number, s: string, size?: number, bold?: boolean, c?: number[], it?: boolean) =>
    T(right - lgeur(s, size ?? 9, !!bold), yTop, s, size, bold, c, it);
  const CT = (cx: number, yTop: number, s: string, size?: number, bold?: boolean, c?: number[], it?: boolean) =>
    T(cx - lgeur(s, size ?? 9, !!bold) / 2, yTop, s, size, bold, c, it);
  const ligne = (x1: number, y1: number, x2: number, y2: number, c?: number[], ep?: number) =>
    cmds.push(c3(c ?? FILET) + " RG " + (ep ?? 0.7) + " w " + x1.toFixed(2) + " " + Y(y1) + " m " + x2.toFixed(2) + " " + Y(y2) + " l S");
  const rect = (x: number, yTop: number, w: number, h: number, c: number[]) =>
    cmds.push(c3(c) + " rg " + x.toFixed(2) + " " + (H - yTop - h).toFixed(2) + " " + w.toFixed(2) + " " + h.toFixed(2) + " re f");
  const cadre = (x: number, yTop: number, w: number, h: number, c?: number[], ep?: number) =>
    cmds.push(c3(c ?? FILET) + " RG " + (ep ?? 0.8) + " w " + x.toFixed(2) + " " + (H - yTop - h).toFixed(2) + " " + w.toFixed(2) + " " + h.toFixed(2) + " re S");


  // ── En-tête : logo U'mob OFFICIEL (image embarquée) + bloc « offre » ──
  // ── En-tête : logo U'mob OFFICIEL (wordmark sans slogan, image embarquée)
  // + bloc « offre » à droite avec badge — fidèle à la maquette validée. ──
  const lg = 178, lh = lg * LOGO_UMOB_PDF.h / LOGO_UMOB_PDF.w; // ratio wordmark
  cmds.push("q " + lg.toFixed(2) + " 0 0 " + lh.toFixed(2) + " " + M.toFixed(2) + " " + (H - 52 - lh).toFixed(2) + " cm /Im1 Do Q");
  R(W - M, 60, "OFFRE À LA LOCATION", 13, true, LIME_FONCE, false);
  R(W - M, 76, "N° " + (r.numOffre || "-"), 10, false, GRIS, false);
  R(W - M, 90, "Émis le " + (r.dateEmission || "-") + " · Valable jusqu'au " + (r.dateValiditeFr || "-"), 9, false, GRIS, false);
  const badgeTxt = "Étude personnalisée de votre flotte";
  const badgeW = lgeur(badgeTxt, 8, true) + 22;
  rect(W - M - badgeW, 99, badgeW, 16, FOND_VERT);
  CT(W - M - badgeW / 2, 99 + 11.5, badgeTxt, 8, true, LIME_FONCE, false);
  T(M, 52 + lh + 7, "53 avenue Carnot · 69250 Neuville-sur-Saône · 04 82 29 96 78 · www.umob.fr", 8, false, GRIS, false);
  ligne(M, 122, W - M, 122, LIME, 1.5);

  // ── 3 cartes info : Destinataire / Votre commercial / Modalités ──
  let y = 134;
  const cardW = (W - 2 * M - 20) / 3;
  const carte = (i: number, titre: string, l1: string, l2: string, taille2?: number) => {
    const x = M + i * (cardW + 10);
    rect(x, y, cardW, 52, FOND_GRISE);
    cadre(x, y, cardW, 52, FILET, 0.8);
    T(x + 10, y + 12.5, titre, 6.5, true, GRIS, false);
    T(x + 10, y + 29, l1, 10, true, NOIR, false);
    T(x + 10, y + 43.5, l2, taille2 ?? 7, false, GRIS, false);
  };
  const contactCom = (r.commercial || "") === "Corentin Surand" ? "corentin.surand@umob.fr · 04 82 29 96 78" : "";
  carte(0, "DESTINATAIRE", r.societe || "-", "Offre de location longue durée");
  carte(1, "VOTRE COMMERCIAL", r.commercial || "-", contactCom, 6.5);
  carte(2, "MODALITÉS", "Mensuel à échoir", "Durée " + r.duree + " mois · Loyers HT");
  y = 134 + 52 + 14; // 200 — les tableaux reprennent le flux à partir de là

  // ── Tableaux Matériel / Prestations ──
  // Chaque tableau se termine par sa ligne de TOTAL (fond grisé, filet lime
  // au-dessus) : « TOTAL MATÉRIEL / MOIS HT » et « TOTAL PRESTATIONS / MOIS HT ».
  const table = (titre: string, lignes: any[], libTotal: string) => {
    y += 24; T(M, y, titre, 10.5, true, LIME_FONCE, false);
    if (!lignes.length) return;
    y += 8;
    rect(M, y, W - 2 * M, 17, LIME);
    T(M + 7, y + 12, "DÉSIGNATION", 7, true, TEXTE_LIME, false);
    CT(392, y + 12, "QTÉ", 7, true, TEXTE_LIME, false);
    R(456, y + 12, "LOYER U. HT", 7, true, TEXTE_LIME, false);
    R(W - M - 7, y + 12, "LOYER TOTAL HT", 7, true, TEXTE_LIME, false);
    y += 17;
    lignes.forEach((l) => {
      T(M + 7, y + 10.5, l.nom.length > 58 ? l.nom.slice(0, 57) + "…" : l.nom, 9, false, NOIR, false);
      CT(392, y + 10.5, String(l.qte), 9, false, NOIR, false);
      R(456, y + 10.5, fr(l.u), 9, false, NOIR, false);
      R(W - M - 7, y + 10.5, fr(l.tot), 9, true, NOIR, false);
      y += 16.5;
      ligne(M + 7, y, W - M - 7, y, FILET, 0.5);
    });
    const tTot = lignes.reduce((s: number, l: any) => s + l.tot, 0);
    rect(M, y, W - 2 * M, 18, FOND_GRISE);
    ligne(M, y, W - M, y, LIME, 1.5);
    T(M + 7, y + 12.5, libTotal, 7.5, true, LIME_FONCE, false);
    R(W - M - 7, y + 12.5, fr(tTot), 9.5, true, NOIR, false);
    y += 18;
  };
  table("LE MATÉRIEL — LOYERS MENSUELS HT", (r.articles || []).map((a: any) => ({ nom: a.nom, qte: a.q, u: a.loyerU, tot: a.loyerU * a.q })), "TOTAL MATÉRIEL / MOIS HT");
  if ((r.packs || []).length) table("LES PRESTATIONS — LOYERS MENSUELS HT", r.packs.map((p: any) => ({ nom: p.nom, qte: p.qte, u: p.loyer, tot: p.total })), "TOTAL PRESTATIONS / MOIS HT");

  // ── Mise en service (comptant) ──
  y += 18; T(M, y, "MISE EN SERVICE (COMPTANT)", 10.5, true, LIME_FONCE, false);
  y += 8;
  rect(M, y, W - 2 * M, 17, GRIS_LOGO);
  T(M + 7, y + 12, "DÉSIGNATION", 7, true, BLANC, false);
  R(W - M - 7, y + 12, "MONTANT HT", 7, true, BLANC, false);
  y += 17;
  const ligneMes = (lib: string, val: number, gras: boolean) => {
    T(M + 7, y + 10.5, lib, 9, gras, NOIR, false);
    R(W - M - 7, y + 10.5, fr(val), 9, gras, NOIR, false);
    y += 16.5;
    ligne(M + 7, y, W - M - 7, y, FILET, 0.5);
  };
  if (typeof r.miseADispoTot === "number") ligneMes("Mise à disposition (immatriculation & livraison) × " + r.nbChassis, r.miseADispoTot, false);
  if (typeof r.fraisDossierTot === "number") ligneMes("Frais de dossier × " + r.nbChassis, r.fraisDossierTot, false);
  ligneMes("TOTAL MISE EN SERVICE", r.miseService, true);

  // ── Totaux ──
  y += 22;
  // Remise totale — affichée uniquement sur choix du commercial.
  if (r.afficherRemise && typeof r.remisePct === "number" && r.remisePct > 0) {
    R(W - M, y, "Remise totale appliquée : -" + r.remisePct.toFixed(1).replace(".", ",") + " % (soit -" + fr(r.remiseEco ?? 0) + " HT/mois)", 10, true, LIME_FONCE, false);
    y += 15;
  }
  R(W - M, y, "Total mensuel HT :  " + fr(r.loyerMensuelHT), 10, false, NOIR, false);
  y += 15;
  R(W - M, y, "TVA 20 % :  " + fr((r.loyerMensuelTTC || 0) - (r.loyerMensuelHT || 0)), 10, false, NOIR, false);
  y += 20;
  rect(288, y - 7, W - M - 288, 26, LIME_FONCE);
  R(W - M - 8, y + 11.5, "TOTAL TTC / MOIS :  " + fr(r.loyerMensuelTTC), 12, true, BLANC, false);
  y += 27;

  // ── Bon pour accord (carte blanche) + récap clé en main (fond vert) ──
  y += 23;
  rect(M, y, 250, 66, BLANC);
  cadre(M, y, 250, 66, FILET, 1);
  T(M + 10, y + 15, "BON POUR ACCORD", 9, true, NOIR, false);
  T(M + 10, y + 33, "Le :        /        / 2026", 8.5, false, NOIR, false);
  ligne(M + 10, y + 52, M + 170, y + 52, GRIS, 0.7);
  T(M + 10, y + 61, "Signature", 7, false, GRIS, false);
  const xRec = 318, wRec = W - M - 318;
  rect(xRec, y, wRec, 66, FOND_VERT);
  cadre(xRec, y, wRec, 66, LIME_DOUX, 1);
  T(xRec + 10, y + 14, "Votre flotte électrique livrée clé en main", 8.5, true, LIME_FONCE, false);
  const recapTxt = [
    "Scooters U'mob à batterie amovible · maintenance",
    "assurée par le réseau SAV U'mob (intervention sous",
    "48 h) · assurance flotte via notre courtier partenaire,",
    "en option. Merci de votre confiance.",
  ];
  recapTxt.forEach((t, i) => T(xRec + 10, y + 28 + i * 10, t, 7, false, LIME_ENCRE, false));

  // ── Pied de page ──
  const yFin = H - 58;
  ligne(M, yFin, W - M, yFin, FILET, 0.7);
  T(M, yFin + 13, "Sous réserve de validation par U'MOB après analyse financière du dossier du locataire.", 8, false, GRIS, true);
  T(M, yFin + 26, "U'MOB · 53 avenue Carnot, 69250 Neuville-sur-Saône · 04 82 29 96 78 · www.umob.fr", 7.5, false, GRIS, false);

  // ── Assemblage du fichier PDF (objets + xref calculés au fil de l'eau) ──
  const contenu = cmds.join("\n");
  // Décode la base64 du logo en chaîne binaire (1 char = 1 octet 0-255,
  // compatible avec l'assemblage octet par octet du PDF plus bas).
  let logoOctets = "";
  try { logoOctets = atob(LOGO_UMOB_PDF.b64); } catch { logoOctets = ""; }
  const objets = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + W + " " + H + "] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> /XObject << /Im1 8 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>",
    "<< /Length " + contenu.length + " >>\nstream\n" + contenu + "\nendstream",
    "<< /Type /XObject /Subtype /Image /Width " + LOGO_UMOB_PDF.w + " /Height " + LOGO_UMOB_PDF.h + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length " + logoOctets.length + " >>\nstream\n" + logoOctets + "\nendstream",
  ];
  const morceaux: string[] = []; let pos = 0; const offsets: number[] = [];
  const push = (s: string) => { morceaux.push(s); pos += s.length; };
  push("%PDF-1.4\n");
  objets.forEach((o, i) => { offsets.push(pos); push((i + 1) + " 0 obj\n" + o + "\nendobj\n"); });
  const xrefPos = pos;
  let xref = "xref\n0 " + (objets.length + 1) + "\n0000000000 65535 f \n";
  offsets.forEach((o) => { xref += String(o).padStart(10, "0") + " 00000 n \n"; });
  push(xref + "trailer\n<< /Size " + (objets.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xrefPos + "\n%%EOF");
  const binaire = morceaux.join("");
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i) & 0xff;
  return new Blob([octets], { type: "application/pdf" });
}

// Télécharge le PDF du devis dans le navigateur (déclenché par un clic) et
// renvoie le nom du fichier — utilisé par l'envoi mail (pièce à joindre) et
// par la fiche entreprise.
// Blob -> base64 par tranches (btoa n'avale pas un gros buffer d'un coup) -
// passe le PDF a l'API d'envoi reel (/api/devis-email, serverless Vercel ->
// Resend, cle API uniquement cote serveur).
export function blobVersBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      const binaire = String(fr.result || "");
      let out = "";
      const T = 8192;
      for (let i = 0; i < binaire.length; i += T) {
        const tranche = Array.from(binaire.slice(i, i + T)).map((c) => c.charCodeAt(0));
        out += String.fromCharCode.apply(null, tranche);
      }
      res(btoa(out));
    };
    fr.onerror = () => rej(new Error("Lecture du PDF impossible"));
    fr.readAsBinaryString(blob);
  });
}
// Envoi REEL du devis par mail (Resend, PDF en piece jointe) : construit le
// PDF cote navigateur, le convertit en base64 et le POST a /api/devis-email.
// Retour : { ok: true, nomPdf } en cas de succes, sinon { ok: false, erreur }.
export async function envoyerDevisParMail(r: DevisResume, objet: string, corps: string, dest: string): Promise<{ ok: boolean; erreur?: string; nomPdf?: string }> {
  const destTrim = (dest || "").trim();
  if (!destTrim) return { ok: false, erreur: "Aucune adresse e-mail connue pour ce compte - renseigne l'e-mail de la societe ou d'un contact, puis reessaie." };
  const nomPdf = "Devis-Umob-" + (r.numOffre || "offre").replace(/[^\w.-]/g, "") + ".pdf";
  try {
    const pdfBase64 = await blobVersBase64(genererPdfDevis(r));
    const rep = await fetch("/api/devis-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dest: destTrim, objet, corps, pdfBase64, nomPdf }),
    });
    const data: any = await rep.json().catch(() => ({}));
    if (!rep.ok || !data.ok) return { ok: false, erreur: data.erreur || ("L'envoi a echoue (HTTP " + rep.status + ").") };
    return { ok: true, nomPdf };
  } catch (e: any) {
    return { ok: false, erreur: (e && e.message) || "Echec reseau pendant l'envoi." };
  }
}
export function telechargerPdfDevis(r: DevisResume): string {
  const nom = `Devis-Umob-${(r.numOffre || "offre").replace(/[^\w.-]/g, "")}.pdf`;
  try {
    const url = URL.createObjectURL(genererPdfDevis(r));
    const a = document.createElement("a");
    a.href = url; a.download = nom;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch { /* échec du téléchargement : sans bloquer l'ouverture du mail */ }
  return nom;
}
// Blob → base64 par tranches (btoa n'avale pas un gros buffer d'un coup) —
// utilisé pour passer le PDF à l'API d'envoi réel.

// Ligne de la vue « liste des devis » : un devis archivé aplati, avec le
// lien vers sa fiche entreprise (consolidé par App.tsx depuis toutes les fiches).
export interface DevisListeItem { id: string; num: string; societe: string; entId: string; dateFr: string; statut?: "enregistre" | "envoye" | "accepte"; dateEnvoiFr?: string; dateRelanceFr?: string; dateAcceptationFr?: string; loyer: number; nbChassis: number; commercial: string; }

// ── Vue « liste de tous les devis » : DÉFAUT du module. Le bouton « ➕ Nouveau
//    devis » ouvre l'assistant 5 étapes (inchangé) ; un brouillon en cours
//    n'est jamais perdu (bandeau « Reprendre le brouillon »). ──
function ListeDevis({ items, brouillonExiste, onReprendre, onNouveau, onOuvrirFiche, onSupprimerBrouillon }: { items: DevisListeItem[]; brouillonExiste: boolean; onReprendre: () => void; onNouveau: () => void; onOuvrirFiche?: (id: string) => void; onSupprimerBrouillon?: () => void }) {
  const [q, setQ] = useState("");
  const [filtre, setFiltre] = useState<"tous" | "envoye" | "accepte" | "enregistre" | "retard">("tous");
  // « aujourd'hui » en heure de Paris (comme le reste du CRM)
  const auj = (() => { const m = new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) : 0; })();
  const cle = (s?: string) => { const m = (s || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) : 0; };
  const st = (d: DevisListeItem) => d.statut || "enregistre";
  const envoyes = items.filter((d) => st(d) === "envoye");
  const acceptes = items.filter((d) => st(d) === "accepte");
  const brouillons = items.filter((d) => st(d) === "enregistre");
  const enRetard = envoyes.filter((d) => d.dateRelanceFr && cle(d.dateRelanceFr) <= auj);
  const t = (q || "").trim().toLowerCase();
  const liste = items
    .filter((d) => (filtre === "tous" ? true : filtre === "retard" ? enRetard.includes(d) : st(d) === filtre))
    .filter((d) => !t || d.societe.toLowerCase().includes(t) || d.num.toLowerCase().includes(t) || (d.commercial || "").toLowerCase().includes(t))
    .sort((a, b) => cle(b.dateFr) - cle(a.dateFr));
  const BADGE_L: Record<string, { txt: string; cls: string }> = { enregistre: { txt: "💾 Enregistré", cls: "bg-amber-100 text-amber-700" }, envoye: { txt: "✅ Envoyé", cls: "bg-sky-100 text-sky-700" }, accepte: { txt: "🎉 Accepté", cls: "bg-emerald-100 text-emerald-700" } };
  const eurL = (n: number) => (n || 0).toLocaleString("fr-FR") + " € HT/mois";
  const FILTRES: [typeof filtre, string, number][] = [["tous", "Tous", items.length], ["retard", "🔴 À relancer", enRetard.length], ["envoye", "✅ Envoyés", envoyes.length], ["accepte", "🎉 Acceptés", acceptes.length], ["enregistre", "💾 Brouillons", brouillons.length]];
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {brouillonExiste && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-bold text-emerald-800">📝 Brouillon en cours</span>
          <span className="text-emerald-700">Un devis est en préparation — il n'est pas perdu.</span>
          <button onClick={onReprendre} className="ml-auto rounded-lg bg-emerald-600 px-2.5 py-1 font-bold text-white cursor-pointer">↩️ Reprendre le brouillon</button>
          {onSupprimerBrouillon && (
            <button onClick={() => { if (window.confirm("Supprimer le brouillon en cours ? Cette action est définitive.")) onSupprimerBrouillon(); }}
              className="rounded-lg border border-emerald-300 bg-white px-2.5 py-1 font-bold text-emerald-700 hover:bg-red-50 hover:border-red-300 hover:text-red-600 cursor-pointer">🗑️ Supprimer</button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onNouveau} className="rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 cursor-pointer">➕ Nouveau devis</button>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Société, n° d'offre, commercial…"
          className="flex-1 min-w-[200px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-500" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs text-slate-500">Devis au total</div><div className="text-xl font-bold text-slate-800">{items.length}</div><div className="text-[10px] text-slate-400">toutes fiches confondues</div></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs text-slate-500">En cours chez le client</div><div className="text-xl font-bold text-sky-700">{envoyes.length}</div><div className="text-[10px] text-slate-400">{eurL(envoyes.reduce((x, d) => x + d.loyer, 0))}</div></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs text-slate-500">À relancer</div><div className="text-xl font-bold text-rose-600">{enRetard.length}</div><div className="text-[10px] text-slate-400">échéance due</div></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs text-slate-500">Acceptés 🎉</div><div className="text-xl font-bold text-emerald-700">{acceptes.length}</div><div className="text-[10px] text-slate-400">{eurL(acceptes.reduce((x, d) => x + d.loyer, 0))}</div></div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex gap-1.5 flex-wrap mb-3">
          {FILTRES.map(([k, l, c]) => (
            <button key={k} onClick={() => setFiltre(k)} className={"rounded-full px-3 py-1 text-[11px] font-bold transition-colors cursor-pointer " + (filtre === k ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>{l} <span className="opacity-60">{c}</span></button>
          ))}
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-slate-400 py-6 text-center">Aucun devis pour l'instant — clique sur « ➕ Nouveau devis » pour créer la première offre.</p>
        ) : (
          <div className="space-y-1.5">
            {liste.length === 0 && <p className="text-xs text-slate-400 py-4 text-center">Aucun devis ne correspond.</p>}
            {liste.map((d) => {
              const retard = st(d) === "envoye" && d.dateRelanceFr && cle(d.dateRelanceFr) <= auj;
              const b = BADGE_L[st(d)];
              return (
                <div key={d.id} className={"flex flex-wrap items-center gap-2 rounded-xl border p-2.5 text-xs " + (retard ? "border-rose-200 bg-rose-50" : "border-slate-200")}>
                  <div className="min-w-[160px] flex-1">
                    <div className="font-bold text-slate-800">{d.societe}</div>
                    <div className="text-[10px] font-semibold text-slate-400">créé le {d.dateFr} · {d.commercial || "—"}</div>
                  </div>
                  <span className="font-bold text-slate-500">{d.num}</span>
                  <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold " + b.cls}>{b.txt}</span>
                  <span className="font-semibold text-slate-700">{d.nbChassis} scoot. · <span className="text-emerald-600 font-bold">{(d.loyer || 0).toLocaleString("fr-FR")} €</span>/mois</span>
                  {st(d) === "envoye" && d.dateRelanceFr && (
                    <span className={"rounded-lg px-2 py-0.5 text-[10.5px] font-bold " + (retard ? "bg-rose-600 text-white" : "bg-violet-100 text-violet-700")}>{retard ? "🔴 Relancer !" : "🗓️"} {d.dateRelanceFr}</span>
                  )}
                  {st(d) === "accepte" && d.dateAcceptationFr && <span className="text-[10.5px] font-bold text-emerald-600">accepté le {d.dateAcceptationFr}</span>}
                  {onOuvrirFiche && (
                    <button onClick={() => onOuvrirFiche(d.entId)} className="rounded-lg border border-slate-200 px-2 py-1 text-[10.5px] font-semibold text-slate-500 hover:bg-slate-100 cursor-pointer">Ouvrir ↗</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {onOuvrirFiche && <div className="mt-2 text-[10.5px] text-slate-400">« Ouvrir ↗ » mène à la fiche entreprise, section 🧾 Devis.</div>}
      </div>
    </div>
  );
}

// ==================== MODULE ====================
export function DevisModule({ brouillon, onBrouillon, entreprisesNom, tousDevis, onOuvrirFiche, onSupprimerBrouillon, onDemarrerNouveau, ouvertureDirecte, comptesCRM, onSauvegarder, emailSociete, modelesMail, onModelesMail, onDevisEnvoye, numerosExistants }: {
  brouillon: DevisBrouillon | null;
  onBrouillon?: (d: DevisBrouillon) => void;
  entreprisesNom?: string[];
  // Liste de TOUS les devis archivés (toutes fiches confondues) pour la vue
  // « liste » par défaut du module ; onOuvrirFiche ouvre la fiche entreprise.
  tousDevis?: DevisListeItem[];
  onOuvrirFiche?: (entId: string) => void;
  // Supprime le brouillon en cours (bandeau 🗑️ de la vue liste).
  onSupprimerBrouillon?: () => void;
  // « ➕ Nouveau devis » : REPART DE ZÉRO. App remonte le module à neuf
  // (key++) APRÈS suppression de l'ancien brouillon — aucun champ de
  // l'ancien devis (société, articles, remises, reprise) n'est conservé.
  onDemarrerNouveau?: () => void;
  // Vrai UNIQUEMENT pour le flux « 🚀 Rouvrir » d'une fiche entreprise :
  // le module s'ouvre alors directement sur l'assistant. Par défaut (clic
  // sur l'onglet 🧾 Devis), on ouvre TOUJOURS la liste des devis.
  ouvertureDirecte?: boolean;
  // Comptes du CRM avec nom légal + téléphone pour le volet de recherche
  // de compte (match nom commercial + nom légal + téléphone).
  comptesCRM?: { affiche: string; nom: string; tel: string; entId?: string }[];
  // Sauvegarde du devis sur la fiche entreprise du CRM. Retourne l'ID de
  // l'archive (nouvelle ou mise à jour) pour lier les sauvegardes suivantes
  // au même devis, ou false si la société n'existe pas dans le CRM.
  onSauvegarder?: (s: SauvegardeDevis) => string | boolean;
  // E-mail de contact du compte (premier contact avec e-mail), "" si inconnu.
  // entId prioritaire : deux sociétés peuvent partager le nom commercial.
  emailSociete?: (nom: string, entId?: string) => string;
  // Modèles de corps de mail pour l'envoi du devis (persistés dans le CRM).
  modelesMail?: ModeleMailDevis[];
  onModelesMail?: (m: ModeleMailDevis[]) => void;
  // Signale au CRM qu'un devis vient d'être envoyé au client (mail + PDF) :
  // le CRM marque « Envoyé » l'archive correspondante sur la fiche entreprise.
  onDevisEnvoye?: (societe: string, numOffre: string, dateRelanceFr: string, entId?: string) => void;
  // N° d'offre déjà archivés dans tout le CRM (toutes fiches) — sert à
  // attribuer un numéro UNIQUE (suffixe -1, -2, -3…) par jour et commercial.
  numerosExistants?: string[];
}) {
  const b: Partial<DevisBrouillon> = brouillon ?? {};

  // Devis archivé lié au brouillon courant (rouvert depuis une fiche ou déjà
  // sauvegardé dans cette session) : conserve son n° d'offre et fait que la
  // sauvegarde MET À JOUR l'original au lieu de créer un doublon.
  const [offreLiee, setOffreLiee] = useState<{ id: string; num: string; societe: string } | null>(
    b.idOrigine && b.numOffreOrigine ? { id: b.idOrigine, num: b.numOffreOrigine, societe: (b.societe ?? "").trim() } : null
  );

  const [step, setStep] = useState<number>(b.step ?? 0);
  // Vue « liste de tous les devis » PAR DÉFAUT ; l'assistant s'ouvre via le
  // bouton « ➕ Nouveau devis » — ou directement si un brouillon est en cours
  // (le flux « 🚀 Rouvrir » d'une fiche entreprise reste identique).
  const [vueListe, setVueListe] = useState<boolean>(!ouvertureDirecte);

  // Config
  const [societe, setSociete] = useState<string>(b.societe ?? "");
  // Fiche entreprise ciblée (ID) — prioritaire sur le nom pour l'archivage.
  const [entId, setEntId] = useState<string | undefined>(b.entId);
  const [anciennete, setAnciennete] = useState<string>(b.anciennete ?? "Plus de 2 bilans");
  const [mode, setMode] = useState<string>(b.mode ?? "LOCATION");
  const [duree, setDuree] = useState<number>(b.duree ?? 50);
  const [grille, setGrille] = useState<string>(b.grille ?? "SGC 5 à 9");
  const [renouvellement, setRenouvellement] = useState<boolean>(b.renouvellement ?? false);

  // Lignes — quantités & remises stockées en texte libre pour une édition fluide
  // (champ vidé = 0 pour le calcul, mais la ligne reste affichée)
  const [qtes, setQtes] = useState<Record<string, string>>(b.qtes ?? {});
  const [remises, setRemises] = useState<Record<string, string>>(b.remises ?? {});
  // Migration une seule fois au montage : les anciens brouillons stockaient des
  // POURCENTAGES (ex. "20") → on les convertit en montants € (loyerU x %/100).
  const migrationRemisesFaite = useRef(false);
  useEffect(() => {
    if (migrationRemisesFaite.current || b.remisesEnEuros) return;
    migrationRemisesFaite.current = true;
    const t = TAUX[b.duree ?? 50] ?? 0.02701;
    const cree = (b.anciennete ?? "") === "Moins de 2 bilans";
    const conv: Record<string, string> = {};
    Object.entries(b.remises ?? {}).forEach(([nom, raw]) => {
      if (raw === "" || raw === undefined) return;
      const pct = parseFloat(String(raw).replace(",", "."));
      if (isNaN(pct) || pct <= 0) return;
      const art = ARTICLES.find((a) => a.nom === nom);
      if (!art) return;
      const pvu = cree ? art.pvu * 1.25 : art.pvu;
      conv[nom] = (pvu * t * (Math.min(pct, 100) / 100)).toFixed(2).replace(".", ",");
    });
    if (Object.keys(conv).length > 0) setRemises((r) => ({ ...r, ...conv }));
  }, []);
  const [catalogueOuvert, setCatalogueOuvert] = useState(false);
  const [rechercheArticle, setRechercheArticle] = useState("");
  const [comptePanelOuvert, setComptePanelOuvert] = useState(false);
  const [rechercheCompte, setRechercheCompte] = useState("");

  // Extras
  const [packsCoches, setPacksCoches] = useState<Record<string, boolean>>(b.packsCoches ?? { "CONFORT+": true, "U'TRACK": true });
  const [coupDePoing, setCoupDePoing] = useState<number>(b.coupDePoing ?? 0);
  const [remiseLibre, setRemiseLibre] = useState<number>(b.remiseLibre ?? 0);
  // Affichage de la remise totale sur le devis client (PDF, écran & mail).
  const [afficherRemise, setAfficherRemise] = useState<boolean>(b.afficherRemise ?? false);
  const [commercial, setCommercial] = useState<string>(b.commercial ?? "Corentin Surand");
  const [miseADispoStr, setMiseADispoStr] = useState<string>(b.miseADispoStr ?? "270");
  const [fraisDossierStr, setFraisDossierStr] = useState<string>(b.fraisDossierStr ?? "100");

  // Reprise de la flotte actuelle
  const [flotteReprise, setFlotteReprise] = useState<VehiculeReprise[]>(
    (b.flotteReprise ?? []).map((v: any) => ({
      id: v.id, modele: v.modele ?? "Piaggio Liberty", immat: v.immat ?? "", mec: v.mec ?? "",
      dateReleve: v.dateReleve ?? "", km: v.km ?? "", remiseEtat: v.remiseEtat ?? "",
      repriseManuelle: v.repriseManuelle ?? "", reprendre: v.reprendre !== false,
    }))
  );
  const [dureeAmort, setDureeAmort] = useState<string>(b.dureeAmort ?? "5");
  const [nouvVehicule, setNouvVehicule] = useState({ modele: "Piaggio Liberty", immat: "", mec: "", dateReleve: "", km: "" });
  // Montant de la ligne « remise déguisée » (saisi dans le formulaire d'ajout).
  const [montantDeguisee, setMontantDeguisee] = useState("");
  // Mode renouvellement (interne, jamais sur le devis client)
  const [locamRenouvellement, setLocamRenouvellement] = useState<{ contrat: string; montant: string; date: string }>(
    b.locamRenouvellement ?? { contrat: "", montant: "", date: "" }
  );

  // ── Archivage & envoi (étape « Devis client ») ──
  const [commentaire, setCommentaire] = useState("");
  const [retourAction, setRetourAction] = useState("");
  // Date de relance du devis choisie par le commercial (OBLIGATOIRE pour
  // l'envoi, pré-remplie à J+7 mais modifiable) : le CRM crée la tâche
  // « Relancer le devis » sur la fiche entreprise à cette date.
  const [dateRelance, setDateRelance] = useState<string>(() => new Date(Date.now() + 7 * 86400000).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }));
  // ── Volet « modèles de mail » (envoi du devis) ──
  const [voletMailOuvert, setVoletMailOuvert] = useState(false);
  const [apercuMailOuvert, setApercuMailOuvert] = useState(false);
  const [mailSelection, setMailSelection] = useState<string | null>(null);
  const [mailEdition, setMailEdition] = useState(false);
  const [mailEditId, setMailEditId] = useState<string | null>(null);
  const [fNom, setFNom] = useState("");
  const [fObjet, setFObjet] = useState("");
  const [fCorps, setFCorps] = useState("");
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const corpsMailRef = useRef<any>(null);
  const [microActif, setMicroActif] = useState(false);
  const microRef = useRef<any>(null);
  const microDispo = typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  // Dictée du commentaire : Web Speech API (Chrome/Edge), langue fr-FR.
  // Arrêt propre au démontage du module pour ne pas laisser un micro ouvert.
  const basculerMicro = () => {
    if (microActif) { microRef.current?.stop?.(); return; }
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "fr-FR"; rec.continuous = true; rec.interimResults = false;
    rec.onresult = (ev: any) => {
      let morceau = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) morceau += ev.results[i][0].transcript;
      if (morceau.trim()) setCommentaire((c) => (c ? c.trim() + " " : "") + morceau.trim());
    };
    rec.onend = () => setMicroActif(false);
    rec.onerror = () => setMicroActif(false);
    microRef.current = rec;
    rec.start();
    setMicroActif(true);
  };
  useEffect(() => () => { microRef.current?.stop?.(); }, []);

  // Sauvegarde du brouillon dans l'état global du CRM (une seule fois par modification)
  const premier = useRef(true);
  const onBrouillonRef = useRef(onBrouillon);
  onBrouillonRef.current = onBrouillon;
  useEffect(() => {
    if (premier.current) { premier.current = false; return; }
    onBrouillonRef.current?.({
      step, societe, entId, anciennete, mode, duree, grille, renouvellement,
      qtes, remises, packsCoches, coupDePoing, remiseLibre, afficherRemise, commercial,
      remisesEnEuros: true,
      miseADispoStr, fraisDossierStr, flotteReprise, dureeAmort, locamRenouvellement,
      ...(offreLiee && offreLiee.societe === (societe || "").trim() ? { idOrigine: offreLiee.id, numOffreOrigine: offreLiee.num } : {}),
    });
  }, [step, societe, entId, anciennete, mode, duree, grille, renouvellement, qtes, remises, packsCoches, coupDePoing, remiseLibre, afficherRemise, commercial, miseADispoStr, fraisDossierStr, flotteReprise, dureeAmort, locamRenouvellement, offreLiee]);

  // N° d'offre dynamique : L + initiales du commercial + aaaammjj + position du jour
  const aujourdhui = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const aaaammjj = aujourdhui.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }).split("-").join(""); // n° d'offre sur l'heure de Paris
  const initiales = (commercial || "CS").split(/\s+/).map((m) => m[0]).join("").toUpperCase();
  // N° UNIQUE : L + initiales + date + premier suffixe libre (-1, -2, -3…)
  // parmi TOUS les devis déjà archivés du CRM. Si le brouillon est lié à un
  // devis archivé pour la MÊME société, on conserve son n° : la sauvegarde
  // mettra à jour l'original (jamais deux devis avec le même numéro).
  const baseOffre = `L${initiales}${aaaammjj}`;
  const numOffre = offreLiee && offreLiee.societe === (societe || "").trim()
    ? offreLiee.num
    : (() => {
        const pris = new Set((numerosExistants ?? []).filter(Boolean));
        let i = 1;
        while (pris.has(`${baseOffre}-${i}`)) i++;
        return `${baseOffre}-${i}`;
      })();
  const dateEmission = `${pad(aujourdhui.getDate())}/${pad(aujourdhui.getMonth() + 1)}/${aujourdhui.getFullYear()}`;
  const dateValidite = new Date(aujourdhui.getTime() + 30 * 86400000);
  const dateValiditeFr = `${pad(dateValidite.getDate())}/${pad(dateValidite.getMonth() + 1)}/${dateValidite.getFullYear()}`;
  const nomsSocietes = useMemo(() => Array.from(new Set((entreprisesNom ?? []).filter(Boolean))), [entreprisesNom]);

  const taux = TAUX[duree] ?? 0.02701;
  const creation = anciennete === "Moins de 2 bilans";

  // Parse robuste : champ vide = 0, jamais de négatif, remise plafonnée à 100 %
  const parseQte = (raw: string | undefined) => Math.max(0, Math.round(parseFloat((raw ?? "").replace(",", ".")) || 0));
  // Remise saisie en MONTANT € par unité (virgule acceptée) : vide = 0 €, jamais négatif.
  const parseRemise = (raw: string | undefined) => {
    const v = parseFloat((raw ?? "").replace(",", "."));
    return isNaN(v) ? 0 : Math.max(0, v);
  };
  // Montant € au format français (virgule décimale) pour l'affichage et le stockage.
  const eurTxt = (n: number) => n.toFixed(2).replace(".", ",");
  const parsePrix = (raw: string | undefined) => {
    const v = parseFloat((raw ?? "").replace(",", "."));
    return isNaN(v) ? 0 : Math.max(0, v);
  };

  // Une ligne existe dès qu'elle a été ajoutée au devis ; elle reste affichée
  // même à qté 0 ou champ vidé — seul le bouton ✕ la retire.
  const lignes = useMemo(() => {
    return ARTICLES.filter((a) => Object.prototype.hasOwnProperty.call(qtes, a.nom)).map((a) => {
      const q = parseQte(qtes[a.nom]);
      const qOf = (nom: string) => parseQte(qtes[nom]);
      const pvu = creation ? a.pvu * 1.25 : a.pvu;
      const loyerU = pvu * taux;
      // remise : héritage châssis pour batteries/chargeurs/caisses/accessoires
      let famEff: Famille = a.famille;
      if (a.famille === "AUCUNE") {
        famEff = (qOf("Châssis INFINITY PRO 50cc") > 0 || qOf("Châssis INFINITY PRO 125cc") > 0 || qOf("Châssis INFINITY PRO 50cc Reconditionné") > 0 || qOf("Châssis INFINITY PRO 125cc Reconditionné") > 0) ? "INFINITY"
          : (qOf("Châssis COMPACT PRO 50cc") > 0 || qOf("Châssis COMPACT PRO 50cc Reconditionné") > 0 || qOf("Châssis COMPACT PRO GC (sans batt., sans chargeur)") > 0) ? "COMPACT"
          : qOf("Châssis DAILY PRO 50cc") > 0 ? "DAILY" : "AUCUNE";
      }
      const remiseMax = a.famille === "FLEXCITY" ? 0.35 : famEff !== "AUCUNE" ? (REMISES[famEff]?.[grille] ?? 0) : (REMISES.INFINITY[grille] ?? 0.20);
      const remiseEuros = parseRemise(remises[a.nom]);
      const remiseSaisie = loyerU > 0 ? Math.min(remiseEuros / loyerU, 1) : 0;
      const loyerUNet = Math.max(loyerU - remiseEuros, 0);
      return { ...a, q, pvu, loyerU, remiseMax, remiseEuros, remiseSaisie, loyerUNet, total: loyerUNet * q, famEff };
    });
  }, [qtes, remises, taux, creation, grille]);

  const loyerBrut = lignes.reduce((s, l) => s + l.loyerU * l.q, 0);
  const loyerNet = lignes.reduce((s, l) => s + l.total, 0);
  const remiseSuppMensuelle = ((coupDePoing / 3.8 + remiseLibre) * 1.28) / duree;
  const nbChassis = lignes.filter((l) => l.cat === "Châssis" || l.nom.startsWith("Châssis") || l.nom.startsWith("Scooter S5")).reduce((s, l) => s + l.q, 0);

  // ---- Reprise : calcul par véhicule (fidèle aux onglets Reprise & Thermique) ----
  const dureeAmortN = Math.max(1, parseFloat(dureeAmort.replace(",", ".")) || 5);
  const calcReprise = (v: VehiculeReprise) => {
    const km = parsePrix(v.km);
    const remiseEtat = parsePrix(v.remiseEtat);
    const jours = v.mec && v.dateReleve ? Math.max(1, Math.round((new Date(v.dateReleve).getTime() - new Date(v.mec).getTime()) / 86400000)) : 0;
    const ageAn = jours / 365;
    const kmAnnuel = jours > 0 ? Math.round((km / jours) * 365) : 0;
    const trancheAge = !jours ? "" : ageAn <= 1 ? "< 1 an" : ageAn <= 2 ? "1 - 2 ans" : ageAn <= 4 ? "2 - 4 ans" : "> 4 ans";
    const trancheKm = km <= 5000 ? "< 5 000" : km <= 10000 ? "5 000-10 000" : km <= 15000 ? "10 000-15 000" : "> 15 000";
    const valeurMarche = v.modele === "U'mob S5 Delivery" || !trancheAge ? 0 : (MATRICE_REPRISE[trancheKm]?.[trancheAge] ?? 0);
    const coef = COEFS_REPRISE[trancheAge] ?? 1.2;
    // Montant de reprise : saisissable en dur — vide = auto (valeur marché × coef)
    const saisieManuelle = v.repriseManuelle !== "" ? parsePrix(v.repriseManuelle) : null;
    const valeurReprise = saisieManuelle !== null ? saisieManuelle : valeurMarche * coef;
    const valeurNeuf = MODELES_REPRISE[v.modele] ?? 0;
    const vnc = valeurNeuf > 0 && jours > 0 ? Math.max(0, valeurNeuf - (valeurNeuf * ageAn) / dureeAmortN) : 0;
    const prixRevient = remiseEtat + valeurReprise;
    // Empilage : montant saisi en dur = empilage final TEL QUEL ; vide = logique Excel ((remise état + reprise) − marché)
    const empilage = !v.reprendre ? 0 : saisieManuelle !== null ? saisieManuelle : prixRevient - valeurMarche;
    return { jours, ageAn, kmAnnuel, trancheAge, trancheKm, valeurMarche, coef, valeurReprise, saisieManuelle: saisieManuelle !== null, remiseEtat, vnc, empilage };
  };
  const reprisesCalc = flotteReprise.map(calcReprise);
  const totalEmpile = reprisesCalc.reduce((s, r) => s + r.empilage, 0);
  const nbReprises = flotteReprise.filter((v) => v.reprendre).length;
  // Montant HT du contrat Locam (mode renouvellement) — lissé AUSSI dans le loyer, jamais visible client
  const montantLocam = renouvellement ? parsePrix(locamRenouvellement.montant) : 0;
  const totalEmpileGlobal = totalEmpile + montantLocam;
  // Empilage lissé (Reprise!V25) : valeur empilée × taux de la durée ÷ nb scooters neufs — ajouté au loyer châssis après remise
  const empilageParScooter = nbChassis > 0 && totalEmpileGlobal !== 0 ? (totalEmpileGlobal * taux) / nbChassis : 0;
  const empilageMensuelTotal = empilageParScooter * nbChassis;

  const packsLignes = useMemo(() => {
    const isSGC = grille.startsWith("SGC");
    return Object.entries(packsCoches).filter(([, v]) => v).map(([nom, _]) => {
      const loyer = nom === "CONFORT+" && isSGC ? 20 : PACKS_BASE[nom];
      const qte = nbChassis;
      return { nom, loyer, qte, total: loyer * qte };
    });
  }, [packsCoches, grille, nbChassis]);

  const packsTotal = packsLignes.reduce((s, p) => s + p.total, 0);
  const miseADispo = parsePrix(miseADispoStr);
  const fraisDossier = parsePrix(fraisDossierStr);
  const miseService = (miseADispo + fraisDossier) * nbChassis;
  const loyerMensuelHT = loyerNet + packsTotal - remiseSuppMensuelle + empilageMensuelTotal;
  const tvaMens = loyerMensuelHT * TVA;

  // ── Snapshot du devis : résumé figé + texte e-mail. Version CLIENT
  // uniquement — jamais de commission, ni grille, ni détail d'empilage (R10). ──
  const estChassisLigne = (l: { cat: string; nom: string }) => l.cat === "Châssis" || l.nom.startsWith("Châssis") || l.nom.startsWith("Scooter S5");
  const rnd2 = (n: number) => Math.round(n * 100) / 100;
  const construireResume = (): DevisResume => ({
    numOffre, societe, commercial, duree, nbChassis,
    dateEmission, dateValiditeFr,
    loyerMensuelHT: rnd2(loyerMensuelHT),
    loyerMensuelTTC: rnd2(loyerMensuelHT + tvaMens),
    miseService: rnd2(miseService),
    miseADispoTot: rnd2(miseADispo * nbChassis),
    fraisDossierTot: rnd2(fraisDossier * nbChassis),
    articles: lignes.filter((l) => l.q > 0).map((l) => ({ nom: l.nom, q: l.q, loyerU: rnd2(estChassisLigne(l) ? l.loyerUNet + empilageParScooter : l.loyerUNet) })),
    packs: packsLignes.map((p) => ({ nom: p.nom, qte: p.qte, loyer: rnd2(p.loyer), total: rnd2(p.total) })),
    // Remise totale : % et € d'économie vs loyer brut (articles) — uniquement
    // si le commercial a choisi de l'afficher sur le devis client.
    ...(afficherRemise && loyerBrut > 0 ? (() => {
      const eco = loyerBrut - (loyerNet - remiseSuppMensuelle);
      return { afficherRemise: true, remisePct: rnd2((eco / loyerBrut) * 100), remiseEco: rnd2(eco) };
    })() : {}),
  });
  const construireMail = (resume: DevisResume): MailDevis => ({
    destinataire: emailSociete?.(societe, entId) ?? "",
    objet: `Offre de location U'mob — ${societe || "proposition"} (n° ${resume.numOffre})`,
    corps: [
      "Bonjour,",
      "",
      `Suite à notre échange, veuillez trouver notre offre de location pour ${societe || "votre société"}.`,
      "",
      `Offre n° ${resume.numOffre} — valable jusqu'au ${dateValiditeFr}`,
      "",
      "── LE MATÉRIEL (loyers mensuels HT) ──",
      ...(resume.articles.length ? resume.articles.map((a) => `• ${a.nom} × ${a.q} — ${eurM(a.loyerU)}/mois/u — ${eurM(rnd2(a.loyerU * a.q))}/mois`) : ["(aucun matériel)"]),
      "",
      ...(resume.packs.length ? ["── LES PRESTATIONS (loyers mensuels HT) ──", ...resume.packs.map((p) => `• ${p.nom} × ${p.qte} — ${eurM(p.loyer)}/mois/u — ${eurM(p.total)}/mois`), ""] : []),
      ...(resume.afficherRemise && resume.remisePct ? [`Remise totale appliquée : -${resume.remisePct.toFixed(1).replace(".", ",")} % (soit -${eurM(resume.remiseEco ?? 0)} HT/mois)`, ""] : []),
      "── MISE EN SERVICE (comptant) ──",
      `• Mise à disposition (immatriculation & livraison) × ${nbChassis} — ${eurM(rnd2(miseADispo * nbChassis))}`,
      `• Frais de dossier × ${nbChassis} — ${eurM(rnd2(fraisDossier * nbChassis))}`,
      `• Total mise en service — ${eurM(resume.miseService)}`,
      "",
      `Total mensuel HT : ${eurM(resume.loyerMensuelHT)}`,
      `TVA 20 % : ${eurM(rnd2(resume.loyerMensuelTTC - resume.loyerMensuelHT))}`,
      `Total TTC/mois : ${eurM(resume.loyerMensuelTTC)}`,
      "",
      "Cette offre est émise sous réserve de validation par U'MOB après analyse financière du dossier du locataire.",
      "",
      "Bien cordialement,",
      commercial || "L'équipe U'mob",
      "U'MOB — 53 avenue Carnot, 69250 Neuville-sur-Saône — 04 82 29 96 78 — www.umob.fr",
    ].join("\n"),
  });
  // Brouillon complet au moment T (même contenu que celui remonté via onBrouillon).
  const brouillonCourant = (): DevisBrouillon => ({
    step, societe, entId, anciennete, mode, duree, grille, renouvellement,
    qtes, remises, packsCoches, coupDePoing, remiseLibre, afficherRemise, commercial,
    remisesEnEuros: true,
    miseADispoStr, fraisDossierStr, flotteReprise, dureeAmort, locamRenouvellement,
    ...(offreLiee && offreLiee.societe === (societe || "").trim() ? { idOrigine: offreLiee.id, numOffreOrigine: offreLiee.num } : {}),
  });

  // ── Actions d'archivage & d'envoi ──
  const sauvegarder = () => {
    const resume = construireResume();
    const mail = construireMail(resume);
    const ok = onSauvegarder?.({ entId, societe, commentaire: commentaire.trim(), brouillon: brouillonCourant(), resume, mail });
    if (ok === undefined) setRetourAction("⚠️ Sauvegarde indisponible hors CRM.");
    else if (ok) {
      // Liaison avec l'archive (nouvelle ou mise à jour) : les sauvegardes
      // suivantes de CE devis mettront à jour la même archive, même n°.
      if (typeof ok === "string" && ok) setOffreLiee({ id: ok, num: resume.numOffre, societe: societe.trim() });
      const maj = !!offreLiee && offreLiee.num === resume.numOffre && offreLiee.societe === societe.trim();
      setRetourAction(`✅ Devis ${resume.numOffre} ${maj ? "mis à jour" : "sauvegardé"} sur la fiche « ${societe} » — visible dans la section 🧾 Devis et la timeline de l'entreprise.`);
      setCommentaire("");
    }
    else setRetourAction(`❌ « ${societe || "—"} » n'existe pas dans le CRM. Utilise 🔍 Chercher un compte (étape 1) ou crée la fiche d'abord.`);
  };
  const corpsCourtMail = (resume: DevisResume): string =>
    `Bonjour,\n\nVeuillez trouver ci-joint notre offre de location pour ${societe || "votre société"} (n° ${resume.numOffre}), valable jusqu'au ${resume.dateValiditeFr}.\n\nJe reste à votre disposition pour en discuter.\n\nBien cordialement,\n${commercial || "L'équipe U'mob"}`;
  // Envoi REEL du devis par mail (Resend) : le PDF est genere cote navigateur
// puis envoye par /api/devis-email (serverless Vercel -> Resend) en piece
// jointe, depuis corentin.surand@umob.fr. En cas d'echec : message d'erreur
// affiche et le devis n'est PAS marque envoye (le mail n'est pas parti).
  const envoyerMail = async (objetMail?: string, corpsMail?: string) => {
    if (!dateRelance) { setRetourAction("⚠️ Choisis d'abord la date de relance du devis (obligatoire)."); return; }
    if (envoiEnCours) return;
    const resume = construireResume();
    const mail = construireMail(resume);
    const objetFinal = objetMail ?? mail.objet;
    const corpsFinal = corpsMail ?? corpsCourtMail(resume);
    const pRel = dateRelance.split("-"); const dateRelanceFr = pRel.length === 3 ? `${pRel[2]}/${pRel[1]}/${pRel[0]}` : dateRelance;
    setEnvoiEnCours(true);
    setRetourAction("⏳ Envoi du devis en cours…");
    const rep = await envoyerDevisParMail(resume, objetFinal, corpsFinal, mail.destinataire);
    setEnvoiEnCours(false);
    if (!rep.ok) {
      setRetourAction(`❌ L'envoi a échoué : ${rep.erreur || "erreur inconnue"}. Le mail n'est PAS parti et le devis n'est PAS marqué envoyé — vérifie et réessaie.`);
      return;
    }
    // Le devis est reellement parti : la fiche entreprise le marque envoye.
    onDevisEnvoye?.(societe, resume.numOffre, dateRelanceFr, entId);
    setRetourAction(`✅ Devis ${resume.numOffre} envoyé par mail à ${mail.destinataire} — PDF « ${rep.nomPdf} » joint, expéditeur corentin.surand@umob.fr. Tâche de relance créée pour le ${dateRelanceFr}.`);
    setVoletMailOuvert(false);
  };
  // ── Volet « modèles de mail » ──
  const ouvrirVoletMail = () => {
    const liste = modelesMail ?? [];
    setMailSelection((prev) => (prev && liste.some((m) => m.id === prev) ? prev : liste.length ? liste[0].id : null));
    setMailEdition(false);
    setVoletMailOuvert(true);
  };
  const demarrerCreationModeleMail = () => {
    setMailEditId(null);
    setFNom("");
    setFObjet("Votre offre U'mob n° {{numero}}");
    setFCorps("");
    setMailEdition(true);
  };
  const demarrerEditionModeleMail = (m: ModeleMailDevis) => {
    setMailEditId(m.id);
    setFNom(m.nom);
    setFObjet(m.objet);
    setFCorps(m.corps);
    setMailEdition(true);
  };
  const enregistrerModeleMail = () => {
    if (!fNom.trim() || !fObjet.trim()) { setRetourAction("⚠️ Le modèle a besoin d'un nom et d'un objet."); return; }
    const liste = modelesMail ?? [];
    if (mailEditId) {
      onModelesMail?.(liste.map((m) => (m.id === mailEditId ? { ...m, nom: fNom.trim(), objet: fObjet.trim(), corps: fCorps } : m)));
      setMailSelection(mailEditId);
    } else {
      const nouveau: ModeleMailDevis = { id: `mm${Date.now()}`, nom: fNom.trim(), objet: fObjet.trim(), corps: fCorps };
      onModelesMail?.([...liste, nouveau]);
      setMailSelection(nouveau.id);
    }
    setMailEdition(false);
  };
  const supprimerModeleMail = (id: string) => {
    const reste = (modelesMail ?? []).filter((m) => m.id !== id);
    onModelesMail?.(reste);
    if (mailSelection === id) setMailSelection(reste.length ? reste[0].id : null);
    if (mailEditId === id) setMailEdition(false);
  };
  const insererVariableMail = (code: string) => {
    const el = corpsMailRef.current as any;
    if (el && typeof el.selectionStart === "number" && typeof el.selectionEnd === "number") {
      const debut = el.selectionStart, fin = el.selectionEnd;
      setFCorps(fCorps.slice(0, debut) + code + fCorps.slice(fin));
    } else setFCorps(fCorps + code);
  };
  const copierTexte = async () => {
    try { await navigator.clipboard.writeText(construireMail(construireResume()).corps); setRetourAction("📋 Texte du devis copié — prêt à coller dans un e-mail ou un message."); }
    catch { setRetourAction("⚠️ Copie impossible sur ce navigateur — utilise ✉️ Envoyer par mail."); }
  };

  const ajouterArticle = (nom: string) => {
    if (!nom) return;
    if (Object.prototype.hasOwnProperty.call(qtes, nom)) return; // déjà présent : on garde sa qté
    setQtes({ ...qtes, [nom]: "1" });
  };
  const retirerArticle = (nom: string) => {
    const q2 = { ...qtes }; delete q2[nom];
    const r2 = { ...remises }; delete r2[nom];
    setQtes(q2); setRemises(r2);
  };
  const setQteArticle = (nom: string, raw: string) => {
    if (raw === "") { setQtes({ ...qtes, [nom]: "" }); return; } // champ vidé : ligne conservée, qté = 0
    const n = Math.round(parseFloat(raw.replace(",", ".")));
    setQtes({ ...qtes, [nom]: String(isNaN(n) ? "" : Math.max(0, n)) });
  };
  const setRemiseArticle = (nom: string, raw: string) => {
    if (raw === "") { setRemises({ ...remises, [nom]: "" }); return; }
    const n = parseFloat(raw.replace(",", "."));
    setRemises({ ...remises, [nom]: isNaN(n) ? "" : eurTxt(Math.max(0, n)) });
  };
  const appliquerRemiseMax = (nom: string, loyerU: number, max: number) => setRemises({ ...remises, [nom]: eurTxt(loyerU * max) });
  const toutRemiseMax = () => {
    const r: Record<string, string> = {};
    lignes.forEach((l) => { r[l.nom] = eurTxt(l.loyerU * l.remiseMax); });
    setRemises(r);
  };
  const viderRemises = () => setRemises({});

  const depassement = lignes.some((l) => l.remiseSaisie > l.remiseMax + 0.0001);

  // Vue liste : tous les devis du CRM + bouton « ➕ Nouveau devis ».
  if (vueListe) return (
    <ListeDevis
      items={tousDevis ?? []}
      brouillonExiste={!!brouillon}
      onReprendre={() => setVueListe(false)}
      onNouveau={() => {
        if (brouillon && !window.confirm("Un devis est en préparation (« " + (brouillon.societe || "sans société") + " »). Démarrer un NOUVEAU devis ?\n\nL'ancien brouillon sera supprimé et tout repartira de zéro.")) return;
        onSupprimerBrouillon?.();
        onDemarrerNouveau?.();
        setVueListe(false);
      }}
      onOuvrirFiche={onOuvrirFiche}
      onSupprimerBrouillon={onSupprimerBrouillon}
    />
  );

  return (
    <div className="font-sans text-slate-800 pb-10">
      <div className="max-w-6xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-500 flex items-center justify-center text-white font-black text-lg">U</div>
            <div>
              <h1 className="text-xl font-bold leading-tight">Module Devis</h1>
              <p className="text-xs text-slate-500">Matrice tarifaire V20260624 · {mode}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Badge variant="outline" className="bg-white">Offre n° <span className="font-mono font-bold ml-1">{numOffre}</span></Badge>
            <Badge className="bg-amber-100 text-amber-800 border-amber-200 border" variant="outline">🔒 Interne : remises autorisées</Badge>
          </div>
        </div>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" className="bg-white" onClick={() => setVueListe(true)}>← Retour à la liste des devis</Button>
        </div>
        <Stepper step={step} onGoTo={setStep} />

        {/* ============ ÉTAPE 1 : CONFIGURATION ============ */}
        {step === 0 && (
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">1 · Destinataire</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Field label="Société" hint="Recherche par nom commercial, nom légal ou téléphone — ou saisie libre">
                  <Input value={societe} onChange={(e) => { setSociete(e.target.value); setEntId(undefined); }} placeholder="Nom de la société cliente…" />
                  <Button variant="outline" className="w-full justify-between font-normal bg-white mt-1.5" onClick={() => { setComptePanelOuvert(!comptePanelOuvert); setRechercheCompte(""); }}>
                    <span className="text-slate-500 truncate">🔍 Chercher un compte du CRM…</span>
                    <span className="text-slate-400">{comptePanelOuvert ? "▲" : "▼"}</span>
                  </Button>
                  {comptePanelOuvert && (
                    <div className="mt-1 border border-slate-300 rounded-lg bg-white shadow-xl overflow-hidden z-50">
                      <div className="p-2 border-b bg-white">
                        <Input autoFocus placeholder="Nom commercial, nom légal ou téléphone…" value={rechercheCompte} onChange={(e) => setRechercheCompte(e.target.value)} className="bg-white text-black" />
                      </div>
                      <div className="max-h-64 overflow-y-auto bg-white">
                        {(() => {
                          // Recherche à 3 champs : nom commercial + nom LÉGAL +
                          // TÉLÉPHONE (tolérant espaces/points, 33 ↔ 0, partiel).
                          const q = rechercheCompte.trim().toLowerCase();
                          const fiches = comptesCRM ?? nomsSocietes.map((n) => ({ affiche: n, nom: "", tel: "" }));
                          const qc = q.replace(/\D/g, "").replace(/^330/, "0");
                          const res = fiches.filter((f) => {
                            if (!q) return true;
                            return (f.affiche || "").toLowerCase().includes(q) || (f.nom || "").toLowerCase().includes(q)
                              || (qc.length >= 2 && !!f.tel && f.tel.replace(/\D/g, "").replace(/^330/, "0").includes(qc));
                          });
                          if (res.length === 0) return <p className="px-3 py-3 text-sm text-black bg-white">Aucun compte trouvé — saisie libre possible.</p>;
                          return res.slice(0, 50).map((f) => (
                            <button
                              key={f.entId ?? f.affiche + "-" + f.tel}
                              type="button"
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-black bg-white hover:bg-emerald-50 text-left border-t border-slate-100 cursor-pointer"
                              onClick={() => { setSociete(f.affiche); setEntId(f.entId); setComptePanelOuvert(false); setRechercheCompte(""); }}
                            >
                              <span className="flex-1 truncate font-medium">{f.affiche}</span>
                              {f.nom && f.nom !== f.affiche && <span className="truncate text-[11px] text-slate-400">{f.nom}</span>}
                              {f.tel && <span className="text-[11px] text-slate-500">{f.tel}</span>}
                              {!!f.entId && f.entId === entId && <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">sélectionné</Badge>}
                            </button>
                          ));
                        })()}
                      </div>
                    </div>
                  )}
                </Field>
                <Field label="Ancienneté société" hint="« Moins de 2 bilans » = création → prix × 1,25 (R2)">
                  <select value={anciennete} onChange={(e) => setAnciennete(e.target.value)} className={SEL}>
                    <option value="Plus de 2 bilans">Plus de 2 bilans (+ de 3 ans)</option>
                    <option value="Moins de 2 bilans">Moins de 2 bilans (Création)</option>
                  </select>
                </Field>
                <Field label="Commercial en charge">
                  <select value={commercial} onChange={(e) => setCommercial(e.target.value)} className={SEL}>
                    <option value="Corentin Surand">Corentin Surand</option>
                    <option value="Commercial 2">Commercial 2 (à recruter)</option>
                    <option value="Commercial 3">Commercial 3 (à recruter)</option>
                  </select>
                </Field>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">2 · Financement & grille client</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Mode">
                    <select value={mode} onChange={(e) => setMode(e.target.value)} className={SEL}>
                      <option value="LOCATION">Location</option>
                      <option value="VENTE">Vente</option>
                    </select>
                  </Field>
                  <Field label="Durée (mois)" hint={`Taux appliqué : ${(taux * 100).toFixed(3)} %`}>
                    <select value={String(duree)} onChange={(e) => setDuree(+e.target.value)} className={SEL}>
                      {Object.keys(TAUX).map((d) => <option key={d} value={d}>{d} mois</option>)}
                    </select>
                  </Field>
                </div>
                <Field label="Grille tarifaire" hint="Détermine la remise max PAR FAMILLE d'article (R3) + exception CONFORT+ SGC">
                  <select value={grille} onChange={(e) => setGrille(e.target.value)} className={SEL}>
                    {GRILLES.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </Field>
                <div className="rounded-lg border bg-slate-50 p-3">
                  <p className="text-sm font-medium">Renouvellement</p>
                  <p className="text-xs text-slate-500 mb-2">Simple flag enregistré — aucune incidence prix client</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setRenouvellement(true)} className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold border transition-colors ${renouvellement ? "bg-emerald-600 text-white border-emerald-600 shadow" : "bg-white text-slate-600 border-slate-300 hover:bg-slate-100 cursor-pointer"}`}>✓ Oui</button>
                    <button type="button" onClick={() => setRenouvellement(false)} className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold border transition-colors ${!renouvellement ? "bg-slate-700 text-white border-slate-700 shadow" : "bg-white text-slate-600 border-slate-300 hover:bg-slate-100 cursor-pointer"}`}>✗ Non</button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="md:col-span-2 bg-gradient-to-r from-emerald-600 to-teal-500 text-white border-0">
              <CardContent className="pt-5 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="text-sm opacity-80">Loyer brut estimé (avant packs & remises)</p>
                  <p className="text-3xl font-black">{eurM(loyerBrut)}<span className="text-sm font-normal opacity-80"> HT/mois</span></p>
                </div>
                <Button size="lg" className="bg-white text-emerald-700 hover:bg-emerald-50 font-semibold" onClick={() => setStep(1)}>
                  Reprise & calcul →
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ============ ÉTAPE 3 : LIGNES & REMISES (après la Reprise — l'empilage est intégré au total) ============ */}
        {step === 2 && (
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">4 · Matériel — loyers & remises par article</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setStep(1)}>← Retour</Button>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setStep(3)}>Packs & extras →</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {depassement && (
                <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm font-medium">
                  ⛔ Remise au-delà du plafond autorisé pour cette grille.
                </div>
              )}
              <div className="flex gap-2 items-end flex-wrap">
                <div className="flex-1 min-w-64">
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">➕ Ajouter un article du catalogue</p>
                  <Button variant="outline" role="combobox" className="w-full justify-between font-normal bg-white" onClick={() => setCatalogueOuvert(!catalogueOuvert)}>
                    <span className="text-slate-500 truncate">🔍 {catalogueOuvert ? "Fermer le catalogue" : "Rechercher / ajouter un article…"}</span>
                    <span className="text-slate-400">{catalogueOuvert ? "▲" : "▼"}</span>
                  </Button>
                  {catalogueOuvert && (
                    <div className="mt-2 border border-slate-300 rounded-lg bg-white shadow-xl overflow-hidden z-50">
                      <div className="p-2 border-b bg-white">
                        <Input
                          autoFocus
                          placeholder="Taper : châssis, batterie, caisse, casque…"
                          value={rechercheArticle}
                          onChange={(e) => setRechercheArticle(e.target.value)}
                          className="bg-white text-black"
                        />
                      </div>
                      <div className="max-h-80 overflow-y-auto bg-white">
                        {(() => {
                          const q = rechercheArticle.trim().toLowerCase();
                          const cats = ["Châssis", "Batteries", "Chargeurs", "Reconditionné", "Caisses", "Accessoires", "Personnalisation", "Ensembles complets"];
                          let total = 0;
                          const res = cats.map((cat) => {
                            const items = ARTICLES.filter((a) => a.cat === cat && (!q || a.nom.toLowerCase().includes(q) || cat.toLowerCase().includes(q)));
                            total += items.length;
                            return { cat, items };
                          });
                          if (total === 0) return <p className="px-3 py-3 text-sm text-black bg-white">Aucun article trouvé.</p>;
                          return res.filter((r) => r.items.length > 0).map(({ cat, items }) => (
                            <div key={cat} className="bg-white">
                              <p className="px-3 py-1.5 text-xs font-bold text-black uppercase bg-slate-100">{cat}</p>
                              {items.map((a) => (
                                <button
                                  key={a.nom}
                                  type="button"
                                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-black bg-white hover:bg-emerald-50 text-left border-t border-slate-100 cursor-pointer"
                                  onClick={() => { ajouterArticle(a.nom); setRechercheArticle(""); setCatalogueOuvert(false); }}
                                >
                                  <span className="flex-1 truncate">{a.nom}</span>
                                  <span className="font-mono text-xs text-slate-600">{eurM(a.pvu)}</span>
                                  {qtes[a.nom] !== undefined ? <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">dans le devis</Badge> : null}
                                </button>
                              ))}
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 pb-1">
                  <Button variant="outline" size="sm" onClick={toutRemiseMax}>Remise max partout</Button>
                  <Button variant="outline" size="sm" onClick={viderRemises}>Remettre à 0</Button>
                </div>
              </div>
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100 text-slate-600 text-xs uppercase">
                    <tr>
                      <th className="text-left px-3 py-2">Article</th>
                      <th className="text-center px-2 py-2 w-24">Qté</th>
                      <th className="text-right px-2 py-2 w-32">Loyer U. HT/mois</th>
                      <th className="text-center px-2 py-2 w-32">Remise max 🔒</th>
                      <th className="text-center px-2 py-2 w-48">Remise € / unité</th>
                      <th className="text-right px-2 py-2 w-40">Loyer total HT/mois<br /><span className="normal-case font-normal text-[10px] text-slate-400">(qté × loyer U.)</span></th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lignes.length === 0 && (
                      <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-400">Aucun article pour l'instant — ajoute le matériel depuis le catalogue ci-dessus 🛵</td></tr>
                    )}
                    {lignes.map((l) => {
                      const dep = l.remiseSaisie > l.remiseMax + 0.0001;
                      return (
                        <tr key={l.nom} className="border-t">
                          <td className="px-3 py-2">
                            <p className="font-medium">{l.nom}</p>
                            <p className="text-xs text-slate-400">{l.cat} {l.famEff !== "AUCUNE" && <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0">{l.famEff}</Badge>}</p>
                          </td>
                          <td className="text-center px-2">
                            <div className="flex items-center justify-center gap-1">
                              <span className="font-bold text-black bg-slate-100 rounded px-2 py-1 text-sm">{l.q}</span>
                              <Input className="h-8 text-center w-16" type="number" min={0} value={qtes[l.nom] ?? ""} placeholder="0" onChange={(e) => setQteArticle(l.nom, e.target.value)} />
                            </div>
                          </td>
                          <td className="text-right px-2 font-mono">
                            <p className={l.remiseSaisie > 0 ? "text-slate-400 line-through" : ""}>{eurM(l.loyerU)}</p>
                            {l.remiseSaisie > 0 && <p className="text-[11px] text-emerald-700 font-semibold">{eurM(l.loyerUNet)} <span className="font-normal text-slate-400">net</span></p>}
                          </td>
                          <td className="text-center px-2">
                            <Badge className={grille === "IND" ? "bg-blue-100 text-blue-700" : "bg-slate-800 text-white"}>{(l.remiseMax * 100).toFixed(1)} %</Badge>
                            <p className="text-[10px] text-slate-400 font-mono">max {eurTxt(l.loyerU * l.remiseMax)} €</p>
                          </td>
                          <td className="text-center px-2">
                            <div className="flex items-center justify-center gap-1">
                              <span className={`font-bold rounded px-2 py-1 text-sm ${dep ? "text-red-700 bg-red-50" : "text-emerald-700 bg-emerald-50"}`}>{(l.remiseSaisie * 100).toFixed(1)} %</span>
                              <div className="relative">
                                <Input className={`h-9 w-28 pr-7 text-right font-mono ${dep ? "bg-red-50 border-red-300 text-red-700 font-bold" : ""}`} type="text" inputMode="decimal" value={remises[l.nom] ?? ""} placeholder="0,00" onChange={(e) => setRemiseArticle(l.nom, e.target.value)} />
                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">€</span>
                              </div>
                              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" title="Appliquer la remise max (montant €)" onClick={() => appliquerRemiseMax(l.nom, l.loyerU, l.remiseMax)}>max</Button>
                            </div>
                          </td>
                          <td className="text-right px-2">
                            <p className="font-mono font-semibold">{eurM(l.total)}</p>
                            {l.q > 1 && <p className="text-[10px] text-slate-400 font-mono">{l.q} × {eurM(l.loyerUNet)}</p>}
                          </td>
                          <td className="text-center">
                            <button onClick={() => retirerArticle(l.nom)} className="text-slate-300 hover:text-red-500 font-bold cursor-pointer" title="Retirer la ligne">✕</button>
                          </td>
                        </tr>
                      );
                    })}
{(() => {
                      const ch = lignes.find((l) => l.cat === "Châssis" && l.q > 0);
                      const bat = lignes.find((l) => l.cat === "Batteries" && l.q > 0);
                      const cha = lignes.find((l) => l.cat === "Chargeurs" && l.q > 0);
                      if (!ch) return null;
                      const comps = [ch, bat, cha].filter(Boolean);
                      const neufScoot = comps.reduce((s2, l) => s2 + l.pvu, 0);
                      const loyerScootBrut = comps.reduce((s2, l) => s2 + l.loyerU, 0);
                      const loyerScootNet = comps.reduce((s2, l) => s2 + l.loyerUNet, 0);
                      return (
                        <tr className="border-t-2 border-slate-300 bg-cyan-50">
                          <td className="px-3 py-2 font-bold text-cyan-800" colSpan={2}>
                            🛵 Prix par scooter <span className="font-normal text-cyan-600">(1 châssis + 1 batterie + 1 chargeur) — neuf : {eurM(neufScoot)}</span>
                          </td>
                          <td className="text-right px-2 font-mono font-bold text-cyan-800">
                            {eurM(loyerScootBrut)}
                            {loyerScootNet < loyerScootBrut - 0.0001 && <span className="block text-[11px] text-emerald-700 font-semibold">{eurM(loyerScootNet)} net</span>}
                          </td>
                          <td className="text-right px-2 text-[10px] text-cyan-600" colSpan={3}>{comps.map((l) => l.nom).join(" + ")}</td>
                          <td></td>
                        </tr>
                      );
                    })()}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t-2 border-slate-200 font-semibold">
                    <tr>
                      <td className="px-3 py-2 text-right" colSpan={5}>Loyer HT mensuel net (articles après remises)</td>
                      <td className="text-right px-2 font-mono">{eurM(loyerNet)}</td>
                      <td></td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-right font-normal" colSpan={5}>🛞 Reprise &amp; empilage lissé <span className="text-slate-400">(étape 2)</span></td>
                      <td className="text-right px-2 font-mono text-emerald-700">+{eurM(empilageMensuelTotal)}</td>
                      <td></td>
                    </tr>
                    <tr className="border-t-2 border-slate-300">
                      <td className="px-3 py-2 text-right font-bold" colSpan={5}>Loyer mensuel HT final du devis</td>
                      <td className="text-right px-2 font-mono font-bold text-emerald-700">{eurM(loyerMensuelHT)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {(() => {
                if (lignes.length === 0) return null;
                const apresRemises = loyerNet - remiseSuppMensuelle;
                const eco = loyerBrut - apresRemises;
                const pct = loyerBrut > 0 ? (eco / loyerBrut) * 100 : 0;
                return (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs text-slate-500">
                      🏷️ Remise totale du devis : <span className="font-bold text-slate-800">{pct.toFixed(1).replace(".", ",")} %</span>
                      <span className="text-slate-400"> (soit −{eurM(eco)} HT/mois sur {eurM(loyerBrut)})</span>
                    </div>
                    <span className="text-[10px] text-slate-400">indication — lecture seule, calculée depuis les remises appliquées</span>
                  </div>
                );
              })()}
              <p className="text-xs text-slate-400">🔒 Les colonnes « Remise max » sont internes (jamais sur le devis client). La remise se saisit en MONTANT € par unité (virgule acceptée, ex. 30,50) — le % affiché est recalculé automatiquement. Les batteries/chargeurs héritent de la remise du châssis présent dans le devis (R4).</p>
            </CardContent>
          </Card>
        )}

        {/* ============ ÉTAPE 2 : REPRISE DE LA FLOTTE ACTUELLE (AVANT le calcul — le montant empilé alimente le loyer final) ============ */}
        {step === 1 && (
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">3 · Reprise de la flotte actuelle</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setStep(0)}>← Retour</Button>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setStep(2)}>Calcul & remises →</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-slate-500">Chaque véhicule repris est valorisé (matrice km × âge), remis en état, puis <strong>empilé</strong> : la valeur empilée est lissée dans le loyer des scooters neufs — <strong>jamais détaillée au client</strong>.</p>

              {/* Mode renouvellement (interne uniquement) */}
              {renouvellement && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-3">
                  <p className="text-sm font-semibold text-amber-800 flex items-center flex-wrap gap-2">🔁 Mode renouvellement — reprise dans le cadre du contrat Locam <Badge variant="outline" className="text-[10px] bg-amber-100">🔒 Jamais sur le devis client</Badge></p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-amber-700 font-semibold uppercase tracking-wide">N° contrat Locam</Label>
                      <Input className="bg-white" placeholder="ex. 1234567" value={locamRenouvellement.contrat} onChange={(e) => setLocamRenouvellement({ ...locamRenouvellement, contrat: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-amber-700 font-semibold uppercase tracking-wide">Montant HT (lissé dans le loyer 🔒)</Label>
                      <Input className="bg-white" type="number" min={0} value={locamRenouvellement.montant} onChange={(e) => setLocamRenouvellement({ ...locamRenouvellement, montant: e.target.value === "" ? "" : String(Math.max(0, +e.target.value || 0)) })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-amber-700 font-semibold uppercase tracking-wide">Date</Label>
                      <Input className="bg-white" type="date" value={locamRenouvellement.date} onChange={(e) => setLocamRenouvellement({ ...locamRenouvellement, date: e.target.value })} />
                    </div>
                  </div>
                </div>
              )}

              {/* Formulaire d'ajout */}
              <div className="rounded-lg border p-3 bg-slate-50 space-y-3">
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">➕ Ajouter un véhicule de la flotte actuelle</p>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                  <div className="md:col-span-2 space-y-1">
                    <Label className="text-[11px] text-slate-500">Modèle</Label>
                    <select value={nouvVehicule.modele} onChange={(e) => setNouvVehicule({ ...nouvVehicule, modele: e.target.value })} className={SEL}>
                      {[...Object.keys(MODELES_REPRISE), MODELE_REMISE_DEGUISEE].map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  {nouvVehicule.modele !== MODELE_REMISE_DEGUISEE ? (<>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-500">Immat.</Label>
                    <Input className="bg-white" placeholder="AB-123-CD" value={nouvVehicule.immat} onChange={(e) => setNouvVehicule({ ...nouvVehicule, immat: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-500">Date MEC</Label>
                    <Input className="bg-white" type="date" value={nouvVehicule.mec} onChange={(e) => setNouvVehicule({ ...nouvVehicule, mec: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-500">Date relevé km</Label>
                    <Input className="bg-white" type="date" value={nouvVehicule.dateReleve} onChange={(e) => setNouvVehicule({ ...nouvVehicule, dateReleve: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-500">Km relevé</Label>
                    <Input className="bg-white" type="number" min={0} value={nouvVehicule.km} onChange={(e) => setNouvVehicule({ ...nouvVehicule, km: e.target.value === "" ? "" : String(Math.max(0, +e.target.value || 0)) })} />
                  </div>
                  </>) : (
                    <div className="space-y-1 md:col-span-4">
                      <Label className="text-[11px] text-violet-600">Montant de la remise déguisée (€ HT)</Label>
                      <Input className="bg-violet-50 border-violet-300 font-bold" type="number" min={0} placeholder="ex. 400" value={montantDeguisee} onChange={(e) => setMontantDeguisee(e.target.value === "" ? "" : String(Math.max(0, +e.target.value || 0)))} />
                      <p className="text-[10px] text-violet-500">Ligne de reprise sans véhicule — le montant est lissé dans le loyer comme une reprise.</p>
                    </div>
                  )}
                </div>
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700"
                  disabled={nouvVehicule.modele === MODELE_REMISE_DEGUISEE ? montantDeguisee === "" : (!nouvVehicule.mec || !nouvVehicule.dateReleve || nouvVehicule.km === "")}
                  onClick={() => {
                    const id = (flotteReprise.length ? Math.max(...flotteReprise.map((v) => v.id)) : 0) + 1;
                    const deg = nouvVehicule.modele === MODELE_REMISE_DEGUISEE;
                    setFlotteReprise([...flotteReprise, { id, modele: nouvVehicule.modele, immat: deg ? "" : nouvVehicule.immat, mec: deg ? "" : nouvVehicule.mec, dateReleve: deg ? "" : nouvVehicule.dateReleve, km: deg ? "" : nouvVehicule.km, remiseEtat: "", repriseManuelle: deg ? montantDeguisee : "", reprendre: true }]);
                    setNouvVehicule({ modele: nouvVehicule.modele, immat: "", mec: "", dateReleve: "", km: "" });
                    setMontantDeguisee("");
                  }}
                >Ajouter le véhicule</Button>
              </div>

              {/* Tableau flotte */}
              {flotteReprise.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-slate-400 border rounded-lg">Aucun véhicule repris pour l'instant — ajoute la flotte actuelle du client ci-dessus 🛵</p>
              ) : (
                <div className="rounded-lg border overflow-x-auto">
                  <table className="w-full text-sm min-w-[900px]">
                    <thead className="bg-slate-100 text-slate-600 text-xs uppercase">
                      <tr>
                        <th className="text-left px-3 py-2">Véhicule</th>
                        <th className="text-center px-2 py-2 w-32">MEC / relevé</th>
                        <th className="text-center px-2 py-2 w-20">Km relevé</th>
                        <th className="text-center px-2 py-2 w-24">Âge</th>
                        <th className="text-center px-2 py-2 w-32">Tranche</th>
                        <th className="text-right px-2 py-2 w-24">Valeur marché</th>
                        <th className="text-center px-2 py-2 w-14">Coef</th>
                        <th className="text-right px-2 py-2 w-24">Valeur reprise ✏️</th>
                        <th className="text-center px-2 py-2 w-28">Remise en état</th>
                        <th className="text-right px-2 py-2 w-24">Empilé</th>
                        <th className="text-center px-2 py-2 w-16">Reprendre</th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {flotteReprise.map((v, i) => {
                        const c = reprisesCalc[i];
                        const majVehicule = (patch: Partial<VehiculeReprise>) => setFlotteReprise(flotteReprise.map((x) => x.id === v.id ? { ...x, ...patch } : x));
                        return (
                          <tr key={v.id} className={`border-t ${v.reprendre ? "" : "opacity-50"}`}>
                            <td className="px-3 py-2">
                              <p className="font-medium">{v.modele === MODELE_REMISE_DEGUISEE ? <span className="text-violet-700">🎁 Remise déguisée</span> : v.modele}</p>
                              <p className="text-xs text-slate-400">{v.modele === MODELE_REMISE_DEGUISEE ? <span className="text-violet-500">remise sans véhicule — lissée comme une reprise</span> : <>{v.immat || "immat. à saisir"}{c.vnc > 0 ? ` · VNC ${eurM(c.vnc)}` : ""}{c.kmAnnuel > 0 ? ` · ${c.kmAnnuel.toLocaleString("fr-FR")} km/an` : ""}</>}</p>
                            </td>
                            <td className="text-center px-2 text-xs text-slate-500">
                              <input type="date" value={v.mec} onChange={(e) => majVehicule({ mec: e.target.value })} className="bg-transparent text-xs w-28" />
                              → <input type="date" value={v.dateReleve} onChange={(e) => majVehicule({ dateReleve: e.target.value })} className="bg-transparent text-xs w-28" />
                            </td>
                            <td className="text-center px-2">
                              <Input className="h-8 text-center w-20" type="number" min={0} value={v.km} onChange={(e) => majVehicule({ km: e.target.value === "" ? "" : String(Math.max(0, +e.target.value || 0)) })} />
                            </td>
                            <td className="text-center px-2 text-sm">{c.jours ? `${c.ageAn.toFixed(1)} an${c.ageAn >= 2 ? "s" : ""}` : "—"}</td>
                            <td className="text-center px-2"><Badge variant="outline" className="text-[10px]">{c.trancheKm} km<br />{c.trancheAge || "—"}</Badge></td>
                            <td className="text-right px-2 font-mono">{c.valeurMarche ? eurM(c.valeurMarche) : "—"}</td>
                            <td className="text-center px-2 font-mono text-xs">{c.saisieManuelle ? <span className="font-bold text-amber-700">saisi</span> : `×${c.coef.toFixed(1)}`}</td>
                            <td className="text-center px-2">
                              <Input
                                className={`h-8 text-center w-24 font-mono ${c.saisieManuelle ? "bg-amber-50 border-amber-300 font-bold" : ""}`}
                                type="number" min={0}
                                placeholder={c.valeurMarche ? String(Math.round(c.valeurMarche * c.coef)) : "auto"}
                                value={v.repriseManuelle}
                                title="Montant auquel tu reprends le véhicule — laisse vide pour la valeur auto (marché × coef)"
                                onChange={(e) => majVehicule({ repriseManuelle: e.target.value === "" ? "" : String(Math.max(0, +e.target.value || 0)) })}
                              />
                            </td>
                            <td className="text-center px-2">
                              <Input className="h-8 text-center w-24" type="number" min={0} placeholder="0" value={v.remiseEtat} onChange={(e) => majVehicule({ remiseEtat: e.target.value === "" ? "" : String(Math.max(0, +e.target.value || 0)) })} />
                            </td>
                            <td className={`text-right px-2 font-mono font-semibold ${c.empilage > 0 ? "text-emerald-700" : "text-slate-400"}`}>{c.empilage ? eurM(c.empilage) : "—"}</td>
                            <td className="text-center px-2"><Checkbox checked={v.reprendre} onCheckedChange={(b2) => majVehicule({ reprendre: !!b2 })} /></td>
                            <td className="text-center">
                              <button onClick={() => setFlotteReprise(flotteReprise.filter((x) => x.id !== v.id))} className="text-slate-300 hover:text-red-500 font-bold cursor-pointer" title="Retirer le véhicule">✕</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-slate-50 border-t-2 border-slate-200 font-semibold">
                      <tr>
                        <td className="px-3 py-2 text-right" colSpan={9}>Valeur empilée totale HT ({nbReprises} véhicule{nbReprises > 1 ? "s" : ""} repris)</td>
                        <td className="text-right px-2 font-mono">{eurM(totalEmpile)}</td>
                        <td></td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {/* Lissage */}
              <div className="grid md:grid-cols-3 gap-3">
                <Field label="Durée d'amortissement (ans)" hint="Pour la VNC (valeur nette comptable)">
                  <Input type="number" min={1} value={dureeAmort} onChange={(e) => setDureeAmort(e.target.value === "" ? "" : String(Math.max(1, +e.target.value || 1)))} />
                </Field>
                <div className="md:col-span-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="font-semibold text-emerald-800">Empilage lissé dans le loyer châssis</p>
                    <p className="text-xs text-emerald-700">
                      {totalEmpileGlobal !== 0 ? (
                        <>
                          {totalEmpile > 0 && <span>Véhicules {eurM(totalEmpile)}</span>}
                          {totalEmpile > 0 && montantLocam > 0 ? " + " : ""}
                          {montantLocam > 0 && <span>Locam {eurM(montantLocam)}</span>}
                          {" × " + (taux * 100).toFixed(3) + " % ÷ " + nbChassis + (nbChassis > 1 ? " scooters" : " scooter")}
                        </>
                      ) : ("Aucune reprise active")}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono font-black text-emerald-700">{totalEmpileGlobal !== 0 ? `+${eurM(empilageParScooter)}` : "—"}</p>
                    <p className="text-[10px] text-emerald-600 uppercase">HT/mois/scooter neuf</p>
                  </div>
                </div>
              </div>
              {totalEmpileGlobal !== 0 && nbChassis === 0 && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 text-sm font-medium">⚠️ Ajoute d'abord les scooters neufs (étape Matériel) pour lisser l'empilage dans les loyers.</div>
              )}
              <p className="text-xs text-slate-400">🔒 Coefs : ×1,3 (&lt; 1 an) · ×1,2 · ×1,1 (2-4 ans). Les U'mob S5 Delivery ne sont pas valorisés (0 €). 💡 Colonne « Valeur reprise ✏️ » : vide = valeur auto (marché × coef) ; un montant saisi = reprise forcée en dur. 🎁 « Remise déguisée » = ligne de reprise sans véhicule, montant lissé dans le loyer.</p>
            </CardContent>
          </Card>
        )}

        {/* ============ ÉTAPE 4 : PACKS & EXTRAS ============ */}
        {step === 3 && (
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">5 · Packs & prestations</CardTitle>
                <Button variant="outline" size="sm" onClick={() => setStep(2)}>← Retour</Button>
              </CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(PACKS_BASE).map(([nom, loyerBase]) => {
                  const isSGC = grille.startsWith("SGC");
                  const loyer = nom === "CONFORT+" && isSGC ? 20 : loyerBase;
                  const promo = nom === "CONFORT+" && isSGC;
                  return (
                    <label key={nom} className="flex items-center gap-3 rounded-lg border p-2.5 hover:bg-slate-50 cursor-pointer">
                      <Checkbox checked={!!packsCoches[nom]} onCheckedChange={(v) => setPacksCoches({ ...packsCoches, [nom]: !!v })} />
                      <div className="flex-1">
                        <p className="text-sm font-medium flex items-center gap-2">
                          {nom}
                          {promo && <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200" variant="outline">SGC : 20 € (R7)</Badge>}
                        </p>
                        <p className="text-xs text-slate-400">{nom === "U'TRACK" ? "11,99 € HT/mois et par scooter" : "Loyer fixe HT/mois/scooter"}</p>
                      </div>
                      <span className="font-mono text-sm">{eurM(loyer)}</span>
                    </label>
                  );
                })}
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Remises supplémentaires (lissées R6)</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <Field label="Opération coup de poing (€)" hint="÷ 3,8 puis × 1,28 / durée">
                    <Input type="number" value={coupDePoing} onChange={(e) => setCoupDePoing(+e.target.value || 0)} />
                  </Field>
                  <Field label="Autre remise (€ HT)" hint="× 1,28 / durée">
                    <Input type="number" value={remiseLibre} onChange={(e) => setRemiseLibre(+e.target.value || 0)} />
                  </Field>
                  <div className="rounded-lg bg-slate-100 p-3 text-sm">
                    Déduction mensuelle lissée : <span className="font-mono font-bold">−{eurM(remiseSuppMensuelle)}</span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Frais de mise en service (comptant)</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Mise à disposition (€/scooter)" hint="Défaut : 270 € — remisable">
                      <Input type="number" min={0} value={miseADispoStr} onChange={(e) => setMiseADispoStr(e.target.value === "" ? "" : String(Math.max(0, parseFloat(e.target.value.replace(",", ".")) || 0)))} />
                    </Field>
                    <Field label="Frais de dossier (€/scooter)" hint="Défaut : 100 € — remisable">
                      <Input type="number" min={0} value={fraisDossierStr} onChange={(e) => setFraisDossierStr(e.target.value === "" ? "" : String(Math.max(0, parseFloat(e.target.value.replace(",", ".")) || 0)))} />
                    </Field>
                  </div>
                  <div className="rounded-lg bg-slate-100 p-3 text-sm flex items-center justify-between">
                    <span>Montant comptant <span className="text-xs text-slate-500">({nbChassis} scooter{nbChassis > 1 ? "s" : ""})</span></span>
                    <span className="font-mono font-bold">{eurM(miseService)}</span>
                  </div>
                  <p className="text-xs text-slate-400">Ajustez librement les montants pour remiser ces frais (0 € = offert) — ils n'entrent pas dans le loyer mensuel.</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5 flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-500">Loyer HT mensuel total</p>
                    <p className="text-2xl font-black">{eurM(loyerMensuelHT)}</p>
                  </div>
                  <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setStep(4)}>Voir le devis client →</Button>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* ============ ÉTAPE 5 : DEVIS CLIENT ============ */}
        {step === 4 && (
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-4">
              <Card className="border-slate-300 shadow-lg">
                <CardContent className="p-6 space-y-4">
                  <div className="flex justify-between items-start border-b-2 border-slate-100 pb-4 gap-4">
                    <div>
                      <LogoUmob />
                      <p className="text-xs text-slate-500 mt-2">53 avenue Carnot · 69250 Neuville-sur-Saône<br />04 82 29 96 78 · www.umob.fr</p>
                    </div>
                    <div className="text-right text-sm">
                      <p className="font-bold text-lg bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent uppercase tracking-wide">Offre à la location</p>
                      <p className="text-slate-500">N° {numOffre}</p>
                      <p className="text-slate-500">Valable jusqu'au {dateValiditeFr}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm border-b pb-4">
                    <div><p className="text-xs text-slate-400 uppercase">Destinataire</p><p className="font-semibold">{societe || "—"}</p></div>
                    <div className="text-right"><p className="text-xs text-slate-400 uppercase">Modalité</p><p className="font-semibold">Mensuel à échoir · {duree} mois</p></div>
                    <div>
                      <p className="text-xs text-slate-400 uppercase">Votre commercial</p>
                      <p className="font-semibold">{commercial}{commercial === "Corentin Surand" && <span className="block text-xs font-normal text-slate-500">corentin.surand@umob.fr · 04 82 29 96 78</span>}</p>
                    </div>
                    <div className="text-right"><p className="text-xs text-slate-400 uppercase">Émis le</p><p className="font-semibold">{dateEmission}</p></div>
                  </div>

                  <div>
                    <p className="text-sm font-bold text-slate-500 uppercase mb-2">Le Matériel</p>
                    <table className="w-full text-sm">
                      <thead className="text-xs text-slate-400 uppercase border-b"><tr><th className="text-left py-1">Désignation</th><th className="text-center">Qté</th><th className="text-right">Loyer U. HT</th><th className="text-right">Loyer total HT (qté × U.)</th></tr></thead>
                      <tbody>
                        {lignes.filter((l) => l.q > 0).map((l) => {
                          const estChassis = l.cat === "Châssis" || l.nom.startsWith("Châssis") || l.nom.startsWith("Scooter S5");
                          const loyerUClient = estChassis ? l.loyerUNet + empilageParScooter : l.loyerUNet;
                          return (
                          <tr key={l.nom} className="border-b last:border-0">
                            <td className="py-1.5">{l.nom}</td>
                            <td className="text-center">{l.q}</td>
                            <td className="text-right font-mono">{eurM(loyerUClient)}</td>
                            <td className="text-right font-mono font-semibold">{eurM(loyerUClient * l.q)}</td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <p className="text-sm font-bold text-slate-500 uppercase mb-2">Les Prestations</p>
                    <table className="w-full text-sm">
                      <tbody>
                        {packsLignes.map((p) => (
                          <tr key={p.nom} className="border-b last:border-0">
                            <td className="py-1.5">{p.nom}</td>
                            <td className="text-center">{p.qte}</td>
                            <td className="text-right font-mono">{eurM(p.loyer)}</td>
                            <td className="text-right font-mono font-semibold">{eurM(p.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <p className="text-sm font-bold text-slate-500 uppercase mb-2">Mise en service</p>
                    <div className="text-sm space-y-1">
                      <div className="flex justify-between"><span>Mise à disposition (immat. & livraison) × {nbChassis}</span><span className="font-mono">{eurM(miseADispo * nbChassis)}</span></div>
                      <div className="flex justify-between"><span>Frais de dossier × {nbChassis}</span><span className="font-mono">{eurM(fraisDossier * nbChassis)}</span></div>
                      <div className="flex justify-between font-semibold border-t pt-1"><span>Total mise en service (comptant)</span><span className="font-mono">{eurM(miseService)}</span></div>
                    </div>
                  </div>

                  <p className="text-xs text-slate-400 italic border-t pt-3">Sous réserve de validation par U'MOB après analyse financière du dossier du locataire.</p>
                  {afficherRemise && loyerBrut > 0 && (() => {
                    const eco = loyerBrut - (loyerNet - remiseSuppMensuelle);
                    return <p className="text-sm font-semibold text-emerald-700 text-right">Remise totale appliquée : -{(((eco / loyerBrut) * 100)).toFixed(1).replace(".", ",")} % (soit -{eurM(eco)} HT/mois)</p>;
                  })()}
                  <div className="flex justify-end gap-8 border-t pt-3">
                    <div className="text-right">
                      <p className="text-sm text-slate-500">Total mensuel HT</p>
                      <p className="text-2xl font-black">{eurM(loyerMensuelHT)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-slate-500">TVA 20 %</p>
                      <p className="text-2xl font-black">{eurM(tvaMens)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-slate-500">Total TTC/mois</p>
                      <p className="text-2xl font-black text-emerald-700">{eurM(loyerMensuelHT + tvaMens)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-6 pt-4 border-t">
                    <div><p className="text-sm font-semibold">BON POUR ACCORD</p><p className="text-xs text-slate-400 mt-4">Le : ……………………</p><p className="text-xs text-slate-400 mt-4">Signature :</p></div>
                  </div>
                </CardContent>
              </Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button variant="outline" onClick={() => setStep(3)}>← Modifier le devis</Button>
                <button
                  type="button"
                  onClick={() => setAfficherRemise(!afficherRemise)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors ${afficherRemise ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50"}`}
                  title="Affiche ou masque la remise totale sur le devis client (PDF, écran et mail)"
                >
                  🏷️ Remise totale sur le devis : {afficherRemise ? "affichée ✓" : "masquée"}
                </button>
              </div>
            </div>

            {/* Colonne interne */}
            <Card className="border-amber-200 bg-amber-50/50 h-fit">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">🔒 Volet interne <Badge variant="outline" className="text-[10px] bg-amber-100">jamais sur le devis client</Badge></CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="space-y-1.5">
                  <div className="flex justify-between"><span className="text-slate-500">Loyer brut HT</span><span className="font-mono font-semibold">{eurM(loyerBrut)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Loyer net HT</span><span className="font-mono font-semibold">{eurM(loyerNet)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Packs</span><span className="font-mono font-semibold">{eurM(packsTotal)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Remise supp. lissée</span><span className="font-mono font-semibold text-red-600">−{eurM(remiseSuppMensuelle)}</span></div>
                  {totalEmpileGlobal !== 0 && (
                    <div className="flex justify-between"><span className="text-slate-500">Reprise lissée dans le loyer{totalEmpile > 0 ? ` · flotte ${eurM(totalEmpile)}` : ""}{montantLocam > 0 ? ` · Locam ${eurM(montantLocam)}` : ""}</span><span className="font-mono font-semibold text-emerald-700">+{eurM(empilageMensuelTotal)}</span></div>
                  )}
                  <Separator />
                  <div className="flex justify-between"><span className="text-slate-500">% remise global</span><span className="font-mono font-bold">{loyerBrut ? (((loyerBrut - loyerNet) / loyerBrut) * 100).toFixed(1) : "0"} %</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Grille client</span><span className="font-semibold">{grille}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Commercial</span><span className="font-semibold">{commercial}</span></div>
                  {renouvellement && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Renouvellement 🔒</span>
                      <span className="font-semibold text-right">
                        Contrat Locam n° {locamRenouvellement.contrat || "—"}
                        {locamRenouvellement.montant ? ` · ${eurM(parsePrix(locamRenouvellement.montant))} HT` : ""}
                        {locamRenouvellement.date ? ` · le ${locamRenouvellement.date.split("-").reverse().join("/")}` : ""}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between"><span className="text-slate-500">Renouvellement (flag)</span><span className="font-semibold">{renouvellement ? "Oui" : "Non"}</span></div>
                </div>
                <Separator />
                <p className="text-xs text-slate-500">Mise en service comptant : <span className="font-mono">{eurM(miseService)}</span> ({nbChassis} scooters)</p>
                {totalEmpileGlobal !== 0 && <p className="text-xs text-slate-500">Reprise : <span className="font-mono">{eurM(totalEmpileGlobal)}</span> empilés HT{montantLocam > 0 && totalEmpile > 0 ? " (flotte + Locam)" : montantLocam > 0 ? " (contrat Locam)" : ""} → +<span className="font-mono">{eurM(empilageParScooter)}</span>/mois/scooter lissé dans les loyers châssis (invisible client).</p>}
                <p className="text-xs text-slate-400">Commission non affichée (R10) — calcul géré hors module. Audit : outil séparé.</p>
              </CardContent>
            </Card>

            {/* ============ ARCHIVAGE & ENVOI : fiche entreprise + e-mail ============ */}
            <Card className="border-emerald-200 lg:col-span-3">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">💾 Archiver & envoyer
                  <Badge variant="outline" className="text-[10px] bg-white">fiche entreprise du CRM</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Field label="Commentaire (interne — conservé avec le devis sur la fiche)" hint="Contexte de la négo, points d'attention… au clavier ou en dictée.">
                  <div className="flex gap-1.5 items-start">
                    <textarea
                      value={commentaire}
                      onChange={(e) => setCommentaire(e.target.value)}
                      rows={2}
                      placeholder="Ex. : client sensible au prix, demande une reprise de ses 2 anciens scooters…"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
                    />
                    {microDispo ? (
                      <Button variant={microActif ? "default" : "outline"} onClick={basculerMicro} className="shrink-0" title="Dicter le commentaire">
                        {microActif ? "⏹ Stop" : "🎤 Dicter"}
                      </Button>
                    ) : (
                      <Button variant="outline" disabled className="shrink-0" title="Dictée non supportée par ce navigateur">🎤 Dicter</Button>
                    )}
                  </div>
                </Field>
                <Field label="📅 Relancer ce devis le (obligatoire)" hint="Une tâche de relance sera créée sur la fiche entreprise à cette date. Pré-remplie à J+7, modifiable.">
                  <input type="date" value={dateRelance} onChange={(ev) => setDateRelance(ev.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30" />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => { try { const nom = telechargerPdfDevis(construireResume()); setRetourAction("⬇ PDF téléchargé (" + nom + ") — mise en page U'mob, logo officiel et totaux par tableau."); } catch { setRetourAction("⚠️ Le téléchargement du PDF a échoué sur ce navigateur."); } }}
                    disabled={!societe.trim()}
                    style={{ background: "#b0c300", color: "#3d4200", border: "1px solid #b0c300" }}
                    title="Génère le devis en PDF (logo officiel U'mob, couleurs du site, totaux matériel & prestations) et le télécharge — sans ouvrir de mail"
                  >⬇ Télécharger PDF</Button>
                  <Button onClick={sauvegarder} disabled={!societe.trim()}>💾 Sauvegarder sur la fiche entreprise</Button>
                  <Button variant="outline" onClick={ouvrirVoletMail}>✉️ Envoyer par mail + PDF</Button>
                  <Button variant="outline" onClick={copierTexte}>📋 Copier le texte du devis</Button>
                </div>
                {retourAction && <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">{retourAction}</p>}
                <p className="text-xs text-slate-400">
                  Le devis complet (brouillon ré-ouvrable) est archivé avec le commentaire — on le relance depuis la fiche entreprise → « 🚀 Rouvrir ».
                  « ⬇ Télécharger PDF » génère le devis en PDF (logo officiel + couleurs U'mob) et le télécharge directement, sans ouvrir de mail.
                  « ✉️ Envoyer par mail » ouvre le volet des modèles de corps de mail : tu choisis un modèle (ou le message court par défaut) puis le devis part RÉELLEMENT par mail (expéditeur corentin.surand@umob.fr) avec le PDF joint automatiquement — la date de relance reste obligatoire avant l'envoi.
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      {/* ============ VOLET MODÈLES DE MAIL (envoi du devis) ============ */}
      {voletMailOuvert && (() => {
        const listeModeles = modelesMail ?? [];
        const modeleChoisi = listeModeles.find((m) => m.id === mailSelection) ?? null;
        const apercuResume = construireResume();
        return (
          <div className="fixed inset-0 z-[60] flex justify-end bg-slate-900/40" onClick={() => { setVoletMailOuvert(false); setMailEdition(false); }}>
            <div className="h-full w-full max-w-md bg-white shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3 border-b bg-white shrink-0">
                <p className="font-semibold text-slate-800 text-sm">
                  {mailEdition ? (mailEditId ? "✏️ Modifier le modèle" : "✨ Nouveau modèle de mail") : "✉️ Envoyer le devis par mail"}
                </p>
                <button type="button" className="text-slate-400 hover:text-slate-700 text-xl leading-none cursor-pointer" title="Fermer" onClick={() => { setVoletMailOuvert(false); setMailEdition(false); }}>×</button>
              </div>
              {mailEdition ? (
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-white">
                  <Field label="Nom du modèle" hint="Ex. : Envoi standard, Relance courte…">
                    <Input value={fNom} onChange={(e) => setFNom(e.target.value)} placeholder="Nom du modèle" className="bg-white text-black" />
                  </Field>
                  <Field label="Objet du mail">
                    <Input value={fObjet} onChange={(e) => setFObjet(e.target.value)} placeholder={"Votre offre U'mob n° {{numero}}"} className="bg-white text-black" />
                  </Field>
                  <Field label="Corps du mail">
                    <textarea
                      ref={corpsMailRef}
                      value={fCorps}
                      onChange={(e) => setFCorps(e.target.value)}
                      rows={8}
                      placeholder={"Bonjour,\n\nVeuillez trouver ci-joint notre offre n° {{numero}} pour {{nb_scooters}} scooters…"}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
                    />
                  </Field>
                  <div>
                    <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Variables (remplacées à l'envoi)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {VARIABLES_MAIL.map((v) => (
                        <button key={v.code} type="button" title={v.label} onClick={() => insererVariableMail(v.code)} className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-mono text-emerald-800 hover:bg-emerald-100 cursor-pointer">{v.code}</button>
                      ))}
                    </div>
                  </div>
                  {(fObjet.trim() || fCorps.trim()) && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Aperçu (données du devis en cours)</p>
                      <p className="text-xs font-semibold text-slate-700 mb-1">{rendreModeleMail(fObjet, apercuResume) || "(objet vide)"}</p>
                      <pre className="text-xs text-slate-600 whitespace-pre-wrap font-sans">{rendreModeleMail(fCorps, apercuResume) || "(corps vide)"}</pre>
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <Button onClick={enregistrerModeleMail}>💾 Enregistrer</Button>
                    <Button variant="outline" className="bg-white" onClick={() => setMailEdition(false)}>Annuler</Button>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col bg-white min-h-0">
                  <div className="px-4 pt-3 pb-3 border-b bg-white shrink-0">
                    <Button variant="outline" className="w-full bg-white" onClick={demarrerCreationModeleMail}>✨ Créer un modèle de mail</Button>
                  </div>
                  <div className="flex-1 overflow-y-auto bg-white">
                    {listeModeles.length === 0 ? (
                      <div className="px-4 py-10 text-center">
                        <p className="text-4xl mb-2">✉️</p>
                        <p className="text-sm text-slate-500">Aucun modèle pour l'instant.</p>
                        <p className="text-xs text-slate-400 mt-1">Crée ton premier modèle avec « ✨ Créer un modèle de mail », ou envoie directement avec le message court par défaut.</p>
                      </div>
                    ) : listeModeles.map((m) => (
                      <div key={m.id} className={`px-4 py-3 border-b border-slate-100 cursor-pointer ${mailSelection === m.id ? "bg-emerald-50" : "bg-white hover:bg-slate-50"}`} onClick={() => setMailSelection(m.id)}>
                        <div className="flex items-center gap-2">
                          <span>{mailSelection === m.id ? "🔘" : "⚪️"}</span>
                          <p className="text-sm font-semibold text-slate-800 flex-1 truncate">{m.nom}</p>
                          <button type="button" title="Modifier" className="text-slate-400 hover:text-emerald-600 cursor-pointer px-1" onClick={(e) => { e.stopPropagation(); demarrerEditionModeleMail(m); }}>✏️</button>
                          <button type="button" title="Supprimer" className="text-slate-400 hover:text-red-600 cursor-pointer px-1" onClick={(e) => { e.stopPropagation(); supprimerModeleMail(m.id); }}>🗑️</button>
                        </div>
                        <p className="text-xs text-slate-500 truncate mt-0.5 ml-6">{m.objet}</p>
                      </div>
                    ))}
                  </div>
                  {modeleChoisi && (
                    <div className="border-t border-slate-200 bg-slate-50 p-4 shrink-0 max-h-56 overflow-y-auto">
                      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Aperçu — {modeleChoisi.nom}</p>
                      <p className="text-xs font-semibold text-slate-700 mb-1">{rendreModeleMail(modeleChoisi.objet, apercuResume)}</p>
                      <pre className="text-xs text-slate-600 whitespace-pre-wrap font-sans">{rendreModeleMail(modeleChoisi.corps, apercuResume)}</pre>
                    </div>
                  )}
                  <div className="border-t bg-white p-4 space-y-2 shrink-0">
                    <Button variant="outline" className="w-full bg-white" onClick={() => setApercuMailOuvert(true)}>👁 À quoi ressemblera le mail ?</Button>
                    <Button
                      className="w-full"
                      disabled={envoiEnCours}
                      onClick={() => {
                          const mail = construireMail(apercuResume);
                          const objet = modeleChoisi ? rendreModeleMail(modeleChoisi.objet, apercuResume) : mail.objet;
                          const corps = modeleChoisi ? rendreModeleMail(modeleChoisi.corps, apercuResume) : corpsCourtMail(apercuResume);
                          if (!mail.destinataire) { setRetourAction("⚠️ Aucun e-mail connu sur ce compte — renseigne l'e-mail de la société ou d'un contact, puis réessaie."); return; }
                          envoyerMail(objet, corps);
                        }}
                    >
                      {envoiEnCours ? "⏳ Envoi en cours…" : modeleChoisi ? `✉️ Envoyer le mail avec « ${modeleChoisi.nom} »` : "✉️ Envoyer le mail (message court)"}
                    </Button>
                    <Button variant="outline" className="w-full bg-white" onClick={() => { setVoletMailOuvert(false); setMailEdition(false); }}>Annuler</Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}
      {apercuMailOuvert && (() => {
        const resumeApercu = construireResume();
        const mailApercu = construireMail(resumeApercu);
        const modeleApercu = (modelesMail ?? []).find((m) => m.id === mailSelection) ?? null;
        const objetApercu = modeleApercu ? rendreModeleMail(modeleApercu.objet, resumeApercu) : mailApercu.objet;
        const corpsApercu = modeleApercu ? rendreModeleMail(modeleApercu.corps, resumeApercu) : corpsCourtMail(resumeApercu);
        return (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setApercuMailOuvert(false)}>
            <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-2.5 border-b bg-slate-50">
                <p className="font-semibold text-sm text-slate-700">✉️ À quoi ressemblera le mail</p>
                <button type="button" className="text-slate-400 hover:text-slate-700 text-xl leading-none cursor-pointer" onClick={() => setApercuMailOuvert(false)}>×</button>
              </div>
              <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
                <p className="text-xs text-slate-500"><span className="font-semibold text-slate-600">À :</span> {mailApercu.destinataire || "(aucun e-mail connu sur ce compte)"}</p>
                <p className="text-xs text-slate-500"><span className="font-semibold text-slate-600">De :</span> Corentin Surand — U'mob &lt;corentin.surand@umob.fr&gt; (envoi réel via Resend, PDF joint)</p>
                <p className="text-xs text-slate-500"><span className="font-semibold text-slate-600">Objet :</span> {objetApercu}</p>
                <div className="border-t border-slate-200 pt-3">
                  <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700">{corpsApercu}</pre>
                  <div className="mt-3 border-t border-dashed border-slate-300 pt-3">
                    <p className="text-xs italic text-slate-400">— La signature U'mob (adresse, téléphone, site) figure en fin de corps de mail —</p>
                  </div>
                </div>
                <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">📎 À l'envoi, le PDF « Devis-Umob-{(resumeApercu.numOffre || "offre").replace(/[^\w.-]/g, "")}.pdf » est joint AUTOMATIQUEMENT — le mail part dès le clic, rien à joindre à la main.</p>
              </div>
            </div>
          </div>
        );
      })()}
      </div>
    </div>
  );
}


