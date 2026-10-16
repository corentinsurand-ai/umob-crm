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
  const steps = ["Configuration", "Calcul & remises", "Reprise", "Packs & extras", "Devis client"];
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
  packsCoches: Record<string, boolean>;
  coupDePoing: number;
  remiseLibre: number;
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
}
// Texte du devis prêt à partir par e-mail (version client, sans données internes).
export interface MailDevis { destinataire: string; objet: string; corps: string; }
// Ce que le module transmet au CRM au moment de la sauvegarde.
export interface SauvegardeDevis { societe: string; commentaire: string; brouillon: DevisBrouillon; resume: DevisResume; mail: MailDevis; }
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
const LOGO_UMOB_PDF = { w: 600, h: 218, b64: "eNrtfXtsa11WX5nRaKqBdlTQAKIdjaAFqhZp1FIoolQjCpRq2moEpS2aVhqpVJ2KgkagUamAagRFQKdCo/m+m/f7nTg3N2/n/bKdOC/HduL4kcRJ/IgdJ3YSO37EsZ103evv2/fEj+Nzjs8+59heP60/vu/GPt57n7XXb+29117r+ZkNqVTKarPNzs339vXXNTR+98NXbe0do+PjO7u7N7e3z9WF0M2Nbn1D9fp1a1s79LShqRl6vbyyenZ+nk6nnxEIBKIyEQgENvT6kTejWeMGxhyMGxh2MO9g5HF8isF/ebmwuNTU0gqDVkxGRkcPrdZUqrI54vHxcddg6BsYYOlpc0srUGQ8HkfFQCAQlYKHhwejyTwwpGIxbmDk5xcWfD4/DhcT8UQCGJBl3HKko6vL4/FWYk8zmYzl8LCto5NjTxubW7a3d4A3UUkQCITCYXc42BcyOQLLw1gMXf23CIVuWtrauA9dVj6sq4cxr7jOLq+s8u0pyOj4OBAoqgoCgVAwCR4JMG4NTc3BYLDGh+7+/r6zu0fA6GXFsGesoM7uGgyCezq/sIgTDYGgjcfU7UMywBT4FxyWkji0WrPhHAKktb09HA7X7NAlk0n2MzIucuJ0VkRn1zc2yuzp1LS60g9GEQh5kU7Hb+8NvuDoifc7+87f27b9e93+Ly7t/gO1/nOT658Z0/61YjKu+xR8Bj6pMf38lvXfmU9+58j9l96roZvIVvIxVOOjarEclmncenr7Hh4eanP0xicmyxy9d75Eh/Kjj87Oz8vvKYjJvI+mDIHgx32ZROBmznT89WXDF8e0n2AhO8GysPP39o5+y3XZVYOLx8fHx8bmlvKNG9BBDSqn8/RUFGrIHrYqvLODKpUoPQXSx5gZBKIkonGnO9C77/zG8t4XYSlHg/sKLxu1n4Q14479q+f+lnDU8vRU/cf6hr09sSw5rBdqTVHZA2v5ipLDR8VaDGbFaDKV05h4PH5otS6trIyNT0xMTsF/uFwuNJuIKkAqHfFc9RuPv76w8+OSER+7TOt/YNf+n1yXHbHEWXWutdPplnfXA0UR1euRmtLYcDgsIjWALK+sKraz8wuLIvZ0uAxV8fn9DU3N+c8cVA1j9DKicnEXNe8d/dbUxt9QCP0VlG3rbwTvtFU28ja7XVxLHk8kakdvyz9XzZGunl7Fdpb7bUGOF0aEHShbbbb6xqZij+0fGEzUkgYiqgDxB/fpxSvd/i+Oab9HyQz48iTxxx3uP7+PO6rjFUxOTYtryY9PTmpHgecXF8UdvbeOhCJTr4RCN6L39NBq5dsMu8NReqU5MoL5jhCVsBcXv7h+vWX9tXHtJyuF/vJlZe8fuS47UuloRW+KvqpvENe46dY3akeTX4+8EZ0dAoGAEvcNbHbRe7qm0fBtRk9vX3VEHCFqHNe3K3PbX6hc+suRyfXvPfF+5+mpIu9DRSIR0Y3bzNxc7ShzT1+/6AOozFCZnd1d0Xs6rZ7h1YbLQKD67mMiagpPTxnv1ZDW/KUK2gLlLkuGn3JevKq4OxfBYEh04zY+WUO3JzguT3jJ0fGxAnu6ubUlek9hNc2rDbzy2LR3duFtfYRykEpHT30NwBTVR385MrXxWbv7zyqIDWnwIF/jhjyIPMgRK6tr/Eby6BjNL0IJuI87lHMJQjI29FwNIA8iDyIPiqsqWp2O1/MnJqfQAiPkRSxxbj75ncn176spEiSyY/vNSMyGPIg8iDwolqpYbTa+P3F9fY2mGCELMpnksef/1SwDvmBD+1cfkgHFvinkQeTBCuLB+/v76ktVh6jWjdDF3Z9EBiQyu/UjobAeeRB5EHmwfFUZGR3j9ROv6htqNv07Qi64A73T+r+F3JcnnzCf/I90WnH3o5EHkQcriwdPnE6+v1KJZY4RFYqHZGDH9ptIeSyyuPv3AzfKuluHPIg8WFk8mE6nC2YWZZFV/rf1EQgBuIlsTW18FpmOi9hdf4I8iDyIPChYVfSb/FpSa7nfEbLAFxyd2vibZWXs3P0Jy+k3r24X1w/+ZS1Q4b7z9zKZJPIg8iDyoICWJJPJuoZGXkeEmUwGDTWC5l7ofxSWH2ZC9+n1g18+8zUy6xmpN3+wRlaFWvOXYg/yl0tDHkQerDgefH4bLTPK64fC4TCaawQNpDOJ5b0vCqCAue0vnPmb4Os5D4w/eGpqg3Ry/XtvI7vIg8iDyIO8t0b1m7x+yO3xoMVGiI74g/ddplAeZn/V+DNHnm/fRLYyT4VLopz7W2vtrFCt/1wosok8iDyIPMgLHo+X1w9ZDq1otBHiwhcc4xgVM63//h3bb3qu+pOPwZKP3bB8uQbDZibXP/OuXIU85xfIg8iDlciDyWSS1w9tbm2j3UaIiNvI7oTu0yXN+/LeF33BUV5Pnlz/3poNInW4/wJ5EHkQeZA7Wts7uP+QRqtD040QC6GwfnbrR4oZ83HtJ3X7v5QT+lIM4XA4Gn1fwTYSs9b2fYrvOfe3IQ8iDyIPcsTo2Dj3H1peWUXrjRAFYKjHtJ8oeMhlPP5vF9evHx5LpLRNpVJut1u7vt7V0wvKecmou+267Kr5q4Xfc3D6TYnvUyAPIg9WKA8uLi0jDyKkXwnmk+Dm4Vd8wVEuphuWfls7O43NLUzlBFokH7CcfhOv2INYTv8AeRB5EHmwJHjdpkceRJSPSMw2v/2jH8d1fN+W9ddOfQ0lNz+fnp6ur693DYaBIVW+Zg6/TPJQIzfoS8q47lN8z1WRB5EHa5AHzfsHyIMIyXB9uzKh+/Tc9heyKV9KJot+eHg4Pj5ZWl5ubm1j0UzgR+a3pvU/gCT4UYaB9b/uDnQhDyIPIg+yAEaJ+w9t6DfRkiMEI5NJ2s6/dRPZ4fLhcDgMfter+gYumnl1dUW+GEu4kP5y5PJmBnkQeRB5UBQeNOwZ0ZgjqOIyENjQ6weGVB+8quOolg1NzcyMf5chNRJfXtXCvxN/8CIPIg8iD5bPg6enp2ioEaLj7ebnyYl6djYn9IWjjLx5cQRmc/2J6HlamDKu+1QlUuGq8WdT6SjyIPIg8mCZPHh9fY1GGyEirq6uJqemy9R/jVbLfOaW9dcFk8W0/gc2LF+2u/7Uez18d298TBVOqJvOJCIxm+961OH+ix3bV1luQSpK1g9+9ekpjTyIPIg8KJgHP6yrT6XSaLoRZSKdTrvc7pXVte539/7KF4vlkPn8hd2f4JWIbOPgX9nOv3VxPVLOzuFDMnB1u+Rw/9nm4VdmNn9Ywalm/hx5EHkQeTAHZvM+x18ZGFKhDUcIRjgcthxaxyYmOYa+8NimCL5PN5pI+jkWc7e5/uT6bi2/UIUouInsHHm+rdv/pXHtJ5V1k0L7yes7WlHfyIPIgxXKg5tb23hpAkEV5y7X0PBr0dWebFMwg2TcgR52ItBb/g3HgFVREInZDI6vKepIccnwU8WKdCAPIg/WJg+urq1x/BWb3S7KCMTjiVgsLm5J31QqBc8EAShf2x8eHrKtTSaT1TqjoWvZ0JeWtjZKDJiVnr5+5u8C6RSLddl3fuMmsiXLaCSSPuvZH81ufV4hVAijRKMmhWJ5MJVKZ2cciJIPd5AH5VKV8YlJjsXowXoLNfvJA4tlZm6uu7cXvHfyzJbWtuGRka3t7UAg8PT0xOVRoVDo6OgYvgJPG3490tnd09DYVHCN0Nre3j84NKVWa3W6/YMD+Il0WlL9f5v/JBh0OI70m1vqmVnV8OvOru76Qq1taGru6OqGD8wvLG7v7BwfH0cikUrkPpLyBfrC/dZDmbK4tMxoQGZa//35hXqPPP+XdqgkR/hDU6vGf6IEKjz2/lWV8eD9/b3TeWrYM66uacYnJ2H6t3d2FZxxIM0trfDXIdXw1LQaPg8mwu32RGMx5MHa5EGOIz87Ny/s+YdWa0trG5fQ93ii6EkNsNiaRgN6W84ogWUem5h00r/64fP7l5ZXgIjLaS10FhgcpnZFMCCsx602m1hxL7zEaDKTZkTjJy+t/Sfsrj9T4HC5Ljvy+Vpimdr4G8WiYSuLB2G6LSwucTEyXKS3r1+3vh5g5GxHHqx6HsxkMhyDFgTcmAAbDuzGvRet7R2Ww0PmfqnP5wcu6O0fEHe4wEUEJ/D45ISZmbl8eC8uoLVdonIBcPfAkGpzazscDitQmaPRKPg5NEJfuIvb4yHtubgeIdUW1g9+ORhWbpmwRNK3a/9Pcmfh/maF8iD4zHaHY0qtbmpppaRXnd094M2KbiWQBxXIg9fBIJfnj41P8H3y6dmZsAXR6Nj43d3drsHQNzBA24SC9VbPzvovL8t5oZHIPbSWhgLniGr49YHFIvvpRjqdBsbf0Ou75Fj95fsJzDPWw7M/BPM+v/2jV7dLFbGODkctesu/ljF2NHAzV0E8+Pj4CPQH/yLZrnv22EI9MwtsIm5IA/KgcnjQarNxeT58jNdj3W637BaSl7wZHbu5vRU2gHUNjVI2FWaKx+OVkQR7+/qV8+IGBoeYzdNbvqzb/6XkY7CyzlWNx1+Xb3f0syLujtLjQeCgPaMRKElGZQPNPzs/Rx6sPh5c1Wi4uEO8whrj8XhbR2dl8SAI0Jl+c5N7LJDTeTqoGpartSOjY1cy5fYJBK6UsBLMim59g9m2i+uR5wrE01PGezU0J1M0qd31p0rmwUGVan//oEcx3tfAkIoeGyIPysKDXLRLv8kv1Fw9O1txJMhkw82tbfbIUlg5TkxOKWFLcFo9A5ZHlqiYufkFJbwvn9//XC14SAa05i9Jz4OT658RKwU3DR5UpgBhWW02jlHuyINK5sHI/T0XYxuN8gg4v7q6qgIlH5uYLHY4Dsov5dkEF+KWZZs0k8mMTUzI3vfn6kI6k9g8/Ir0VGg9/2PkQQEyMzcnbhQN8qD0PLi1s8MrKJ0L6KUNkVjaO7tcbneO5YelsQKb+qq+QavTPTxIfSU/mUwuLC7Ju0P1XHV4ekofOH9fYh5U6z/3mLpFHhQgre0dNpsdebBCeRDcmJI1bkbHxnk90395WWVKvmc0kkMxCSJCy5Hu3t5QSIY9UjACzNwIUsrK6tpzleLI822JqRDWociDgmVKrea1b4Y8qBAe5BLSyffwZddgqD4NX9Vo7u7u5A1U4+6ahm5upFdpE+dU7eLK/sHBc/XixPsdiamw/KRzNcuDb28lNzRe+HzIg5XFg2ulIkUnJqf4PnN+cbEqNVzimxFl3nVyOmWolWx3HAkroVuOlG92FA7RCwqXTDqKPFjW7GtsKnP2IQ9KyYOpVJo9DwOsLARk9OKVPQaFXv2FkxOn9IrdPzgkcTdroRqm6fi3pbxWH39wIw+Wn/BW8GE98qCUPOhyudhjRIWFo0uQAQaFY+TMxcWFlFrtkjxzQldP73MN4OkprTH9M8mo8MjzbeTB8mV0fFxY8hnkQSl5kD3uUbu+rhxnBkVwDlWvVFT49PQkfUoB9czsc23gMXW7svfTkpUmRB4UReYXFgVQIfKglDy4ptEWe9TQ8GvB9YmQBxUljc0td3d3Eqj02fm59L0z7BmfawaxxNnUxmeloULXZQfyoEiZcIb5ni4hD0rJg+YiAX4fvKoLBoXnZkQeVJqMvBmVQKVluUVIO9NjzYaPzm1/AXlQRCrktSpEHpSSB6PRaP5FgLqGxtOzM6UFO6GUKbD2p6rP6XSaXu0bFpG9ZKrESGcSGwe/Kg0VBu80yINiyfLKKvKgMnkQ4PV6O7t7yBOaW9vOz11ldg15UJliMu/T0+fjkxPpe9Tb1y/ZhL2JbG1Yvjyu+xRLmOWR+y+locLlvS9KwIPGo/+KPCjmWfbsLMf0a8iDsuTZdjiO1jQak9nMvc4C8mAlHhQ+Pj5S0uf5hUU5FrkayUgQaK4kcQA9SdMef3BcAh6c2fwh5EFxZUO/iTyoWB4UF8iDihX95iaNN57JZFrbO6TvTpkb+NyxfvDLXIhDb/k30rTn6SmzavxZCajwLmpCHhTzKlNdPZd638iDyIMoVKdhIBAQ/Y3b7HZZbkeKm+S/GOIPXo6sceL9jmSzLBTeGNN+gn4Fij9CHhRX2jo6S+YgRR5EHkShKp1d3cLu9rJA9VqG8iL9L2vQ08NlaEayzJy8YHB8jTYPrhn/KfKg6NI3MMA+B5EHkQdRaMvRkZgzApxbWUoxzs0vSKPPJ97vcqxjm84kpJxoiaSf9nXCcd2nHpIB5EHRZXtnF3kQeRBFRunp6xexgrbl0CpT+KtZGn3eO/otLpSxfvAvpZ9rtvNv0V4S2l1/hjxI44TipnhRGORB5EEUCcTrFS3Z2uLScqV3gR0a089z4QugJOnnGiwJ6edY+4fIgzRkZm4OeRB5EEVGWVhcqvTXnUhItAmp1n+OC18EbuZkmW4cY1nLkfiDF3lQdPmwrr6YL4c8iDxYjjQ0NcOvg7R3dslVHp2jfPCqrqW1Ldva1vZ2iVtb19AYi8XLf9fwEHmifbp7pFHm+5iD6+FgOi7LdLu4HqHNg56r/urgweaW1uyM6+7tbZYj/VH+ld5YoYRIyIPIg8Lirw6t1nj8hSFKpVIej2dldU1phAittTuOcq60Q2tPnM7ZuflX9Q1S3SUUIbiRvXQXPZmaVkujzO5ADxem2LH9R7mmWyaTpB0tYzn9ZoXyIMym0fHxPaOpYMJkmIOXl4Gd3V0ZS8VtbW0jDyIPlrmxsLyyWvJCXDQW0+p0+ZlUpd8GgdZeXV2VbK1+c1OC1ra0tQkuKUKwazDIlBBAohsKpuOvc2EK79WQjDPOev7HVHlw/eBXKosH6xoap9UzdoeDe4Ks+/t7i+VQNSz1DaC29o78QtLIg8iDHGVicgqmG/dWge8HxlOWCH+QyanpUIhHa2F5uL29Q3slW36xhim1WpbxlCyTzPz2j5WkCViOwaJMxhn3mApPrn8fPR6EDlYKDzY2t8A0Lyc/5O3dHbjNryTcRDq0WpEHkQcFyPrGhrC27e8fSD83NwttfXABTBCqDdOtb1SEz5MvkUhEGn6hsVyiAdpFKHiFysjFg+qZWbFSDF1dXbV3dknT7Hy7jTyIPFhS5hcWy7n+duJ01jc2STY3wbcsp7Ww8KG3R1qmwqTT6VdynL22trdLo8k3kS1uycf+t+yT7sj9l1R58Pp2Rck8CDPaZDaLeCs2q97gwUqwg/Su3msIeRB5kLssr6yWnxbs/Nwl2Uqw/LlJLxYFWCz/bII7vN4LWdz+peUVaTT53N/CqU5fWCf7pLu7N1LlwdOLV4rlwcmp6Ti1SzQej7eto1PiJSHyIPIgiwyqhsVq5Oz8vAQnmMpv7fX1teBW7RlNVAew2MbUyYlTGk22nH6TS+YxidOpFcTTU3pC92l6PHjg/H1l8iDfUu8CkEwmu3p6aXfk5vYWeRB5kIuAbyaa/3x3V9fQSHWv47pQqLbSWltOrtGFxSXah4Cw9Mv/97hUN+g3D79SkiBWjT+rEJOyZvo5ejy4Zf13CuRBIMH7+3spdshvb1vb26n2xWgyIQ8iD5aUsfEJkY9Ujo5oHmKKnAWaUsyM4BgeQG9fP70B7O7tzf6K3eFgxs32SFiDfn77R0W/W0cP+85v0OPBlb2fVhoPTk5N014JvuxUsKWtXZqtUeRB5MFiYrM7RG9qN7XtDrfbLXprO7q6FZVgjeqVf+ZN+QOLhUtWRnGRziS4EITG/AuxxFmOpNJR6efdub9VIbXpJeDB+sYmybYFCK6DQXo6D84euc+LPIg8WCwvRDl3gopBq9Mp9op6gY0vjVb0po5PTAprTCKRkPJOx/bOzscFa3akUeNw1FJOuSLpb9Zf365QLMCk/aSieHD/4EAW47a9vUOvUxc+H/Ig8iDbzaDZWRpN9Xi8NPR5Q79Jo7U0AkcFV7MF35iqobPabDm/6PP72zu73B6PNGrsueovhzikT7tNu/ZENH6iEB6cW1iQy7hlMpmBIRWlfhEfD3kQefC7Ehabi8ViyszTUhD39/eiNxVelqJcCPaySqHQjWS7YeWU9lva/QeyTD1YhyrhCiFVHmxpbZPyWDAfztNTeieeyIPIgyxy7nJRai2NDX96MWyi3+ptbm0TaA2cp1R58Pb2Tl413rH9pmDKcLj/XJY2z219nh4Pct/ppcqDO7sGeRUDWHjkzSjVKirIg8iDha3iHS2rSKP8Cr2xFb218EBhLbHbHVR5MKceh/SANZ0wvphc/8zD47UsbV41/izFq/S+Btl5sKGpWXbFAESjUUr3mLJREMiDyIMFJRwOIw8qigfN5n2qty9lV2PB19K3rL8uV5vXD36FHg/aXN+SnQfn5TsZzMHM3ByNDmar5yAPIg8iDyIPtnd2yavDt5FdwXzhC47K1ext27+vbh50Ok8VYsCBVmh08PgdWyEPIg8iD1YEDxr2jPR4UHD0jlhwuP9C6H3zf/z0JFsUx679P9PjwcOzP5CXB5taWmlcRxKGVCpFY2t012BAHkQeRB6sFB7Ub27R40HZNZlLRrWCchmakbHZpuPfpseDBsfX5OVByfKrcwRoqeh91Gi1yIPIg8iDyINK0GS1/nMCmGJ574vyNru6eVCy/OocsarRiN7H2bl55EHkQeRB3BcF6ZUwiWg+YokzYUxx7m+Rd+pR3hf9Qxl58INXdUqIFGXCarNRyqKMPIg8iDxYETxYxXEyl6EZYbnUZEkrykQVx8lIVnyZO2ikksjacORB5EHkQeTBhqZmGRX4zN8sgCa2bf9B9qmnt3y5Wnmwf2BQaTY8dHMj/k5I/wDyIPIg8mCl8CDte/SpVEouBb66XRBAE6HwhvwnVsafoceDZ74mGXlQIcbtxf55LE4pUhp5EHkQebAieJDS/SlmEV65FDiTSc5u/W1+1yWMP62EqTe//WP0eNAd6EEeRB4UFxqt+DV0ZmbnkAeRB6XhQdp5tv2XlzLqcPzBazn9n6bj3/5Y/rvG/M9FyUFNFRO6v16tebZrigeHVMNU690rB5NT0xSSDi0iDyIPSsODtOsuOY6OlDZn9Yf/tiBBrB/8shKaB9xNte5SLOGSkQcHVSql6cPt7R0lHqRxMzGnoKdC0NPXX609RR6sBR6k4Qy/LCuwq7Q5W+x2njvQpYTmBcM6qjzIvSUwW0XXh46ubqXpg8/vF72bw69H4MlT02rRnzytnlHaAKZSKdEL6IAY9vaQB5EHpeHBTCZDQ4eJLCwuKW3ablt/o1B1ie97TN0poXnn/hZ6JKje/EF5faRXdfXylh3Mx9GR+EfkI6Nj8OSl5WXRn9zW0am0CeW9uKjifAvIg7XAg4BeCnsaRPoGBpQ2bQtWYtp3fkPhy1VRZNX4M9xb8vT0JFlpZjn3yTc3Re+jemb2mVqyptvbW0UN4J7RRKObodAN8iDyoGQ8OKWeoceDHyrP/y9YiekmsqWQ5mlMP0+PBzcPv8KrMe2dXRTOfdYVpQ/jE5Oi93F5ZRWevH9wQGNOrW/olTWhJqdo2A2FJGNHHqwRHtza2qZ6RHh1daWcOXsfc+Szg8b8C1JWl/AFR4td4ss8paY2/iY9HuS77KUR6dHZ3QMrTYXoA7SkiYLp2Nrehoe73G4aE6q+sSlb51cJSCQSwFmi97Grp1chHUQerBEepH11wrBnVA4Pnvmb8hOp3ccdUrbBcvo/4Xd37F9NPoZy/hQKb1ANkjnzNfJq6hqFHNQgPp9fKWdbXirKb7XZnukEGjGfrwQcWq00OghrTORB5EEpeTCZTFLlwalptXJ40HT89Rxq2LB8WeoDqY/TpmnNX3p6erH5I7hgIkcJ3MwpwcopZ2t0lQ7RX/h8z++C0F7VN1RlJReC4dcj1b33izxYIzxI6RiI2TblHBGuGv9J3nUJqXdgZrd+hJnONJ1JkD9t0MwsChJ/8PJqaih0Q0MlOrq6lKASj4+Pre0dNDoYjX6Uql01/JrStPJ4vLIP4MGBhVLvTpxO5EHkQYl5kMZFJ6bY7HYlqHQ6HR/TfoLJC0BJmUxS0gPKeO4B5ezW57NROomkf1z3KYVcmiCgcXwGAitN2fVheWWViuPX2kb7J96WdpqYlHf0YrE4pdWuvPkYkQdrlgc39JtUebCvXxG3JyIxWw41HDh/X+I2OC8+zGeoqY3Pxh5ctvNvUV0M6vb/hYAGj4yO0lCJgSGZE8tQqjL87vLgKO2N5Y+SNTnkTNZEj+Jhka6ckxTkwdrhQRpXiXPkOhiUXaX9oakcari9N0jchs3DrxQkqYWdH5/Z/CGqPLjv/D0BDV7TaCmphMm8L6MyqGdmKfULRoz8SjgSoTenPnhV5/XKsztKKRT2o8yii4vIg8iD0vNgNBqlzYOra2uyq/SR59tMXtCa/7nUG7OZxOT6Z6iSHYv4gqNCFrDOU3pm3O3xyKIJxycn9FQdRuzFgvrNKL3fgqUTOYuUcCkdbKazW15wAJEHkQel4UFAZ3cPVR5saGp+fHyUV6X3jn6rfF4oB6GwXi4SHNN+Iv+aBhckk0kaF8Q+yhLW3hGLxSV+C1dXV03UzDiMVc7lPpvdTnVmjUt7xeD+/h7mMtVFLqgc8iDyoCw8ODc/T3tJaLM75FVprflLhBdmNn9I4giZ57e5Q1vl4kGN6Z8Jbja9oMe3Zebm5qrJjA+qhnN+MZVKUf3FdyWKFqRxMhOJRP/AINW+LChpUxR5sNZ4kFIOKEVdeprb+ryAsuwiwnzyu3LxoPPiu4KbvaHXU1UMrU4nTRItIIvhkRGqfYGxyv/dpZUV2pNrUKWivbK+u7ujTYKv6urBUUEeRB6UiwepHugr4dJTKh0lpLBk+ClZ2rBm+jlZSHBy/TOPKeFTj15oJZHJqWlYN1Ed/Gg0SiNNHJd4sLPzcwkmV1//AL18a17vRX1DI+0ujI6PPysMyIM1xYOAgcEh2nouY/W0u3sj4YUjz7dlaYNcQTLCbkwwMUihtLqUuhEK3bS0tdHuAsygwj5YKt3c2iYBFYIdsFrFT7lmsRzWNzZJ0H4l3CpFHqxxHqSXHYJ5CJ5NOSU9fMHRjxKKaj8ZS5xL34Bo3CnXpqjD/edlNv707EwCM9g/OOj3i5961OVySUNDztOigY6UajAVu8Do8XjLT2YOT7A7HN09vdI0G94ROAzIg8iD8vJgOp2mGg6dlcbmFlmOAIALPkplZv0NWSaU92pQLh4UJZE41WgZpqek1eniiYQoY+6/vByjUFap2Akd27kDtZzbRdnwzWg5Vypub2+p3vgoeEz8rDwgD9YaDz7TvFz84i6hRiO9Pu85/kuWFPxBec4gDs/+UBYSXNz9SVHaf2CxSGYSX9U37BnLKlOSyWRgCQasKlmbS6YFoJTTm71CE8xoWNNxv4kA1Gm12SglEWK/b3J7e4c8iDyoBB602R3SWLm7O6l1Xrf/i0AKc9tfYOa1lhKbh/9WFh48EJRGJh8PDw+04//ztkmHDHt7fFUlGAxptLoWSTZCidQ1NMbj8ZL7LV1S7THms8zAkGphcWnPaDo9PfV4vDBKIFdXV263x2az7+zuzs7Nd3Z1y9I8kDLdHuRB5EEReTCVSklzIK56PSJxxYGZzR8GUri6le12knrzB2XhwXBUtPRlUh5yMaW3f2B5ZdW8f+Dz+SORCPMUCTQW1hEul8tkNsPap7W9XZYW6tY3uAzg/v6BXESjZOlWTNVd5EHkQSm3RkHAaZdMmR9Tt8AIy3tflGs2xRJnspDgmvGfitmLWJxebhkBKcUU0pIPXtVxPIl7fHxs6+hE4ssRy+Eh8iDyoKJ4kGrqRbmqjMEyEEjh2PtXcs0muTLJ8C28WxJLy8tot3PEaDIrc35VhAyqVOWHtiIPIg+Ky4OZTKa3r1+aKdDQ2BQKhSRQZtv5t97dJb+VazZtHPyq9CRII5F4PB5XzkJMCTLBP73n5NQ0jhsRt9v9rGAgD9YmDwJgmSbZLJCmDh3woPSlBgmentKT698rPQ+e+ankjvP5/Wi9iQT5FxSLJxK009pXioyOjT8rG8iDNcuDsCSk8fZZEubTzhJ8H3ek0lG5plIkZpUplxqt9e/C4hLacJC5+QVhA+j3+5Vz0iqXtHV0Sl80CnkQeZA7qNbRLnjnV5pMy7LAddkhPQ9aTr9Jr0fJZFLGGHuFyLt8nsJLltCr514R8qq+QQm1uZEHkQdZAKwk8WUxZWaTEAVASRWaQ0Yhm+cKFJgdZa5l3tYwGhys2QHcNRgqYvIiD9YyDwKAmCSeGvCLstfqpYH1g1+RmASNR/9Vin5tbNSsGRclnXUqlZImW53SRD0zWymTF3mwxnkwFotJvCT87rsahYlEosp4cFr/t6QkwfmdvytZiWGNVleDZnxNoxXt7DgSeVXfUFOj19ndQ68+FPIg8qDokPiUkFChxKlmqCKWcFVQyV2+kDikSgkCKzhx9dPucEiZB1Ve6enrV1qlXeRB5MGSVq6fflHCApOlt49G/R1Z4A9NVVOETD6ur69r50YhOGk0tu59fn8T/VIvSlgJVhYJIg8iD2bhvbiQJ5ysrr5kAv+KgO38WzKkUzP9vJQ1FsG49Q9Uf8gH9JHepr00FR5llPqGxlDopuLmL/Ig8mAWEpche3G1cGKSe8kYJQBW0DmFhresvy5XuSUpr0wCFUp/miyltLS10V7LGE2mat0ghZVgJZIg8iDy4Pslodcr4/SEGQRr0oqYMj6/XzX8Oidp8MLOj8tVfldr/lL8wStZ9z0eb7VSIawEpdnQAxVq7+yqstEbGFKVLEqlWNDY6EAerEQeBJjM+/JOpbGJSSWfGN7d3Y1/XPc8GHyfMRVoSC4SzMrUxmf9wQkpV4XDIyNVZsZH3oxKuSkB66ZqcicGVcMVFB2aj9cjb0QfE3pZdERfvdY1NNIb2w6xc3HAoqkS9YGXwJp0Z3dXadMknU7vGvZAW7KN/LCunhlM6A70yMuDIBO6T4fCeskGBChDrmqzVEhwdDSVSkmsVODyVccYarS6Ss8TNTM3V0HMIvoZVmdXN73Wql6L7DPDA6nPzctLJRxegAthNu8r4bo98N3R0XGOA9bbP8D8zK79P8vOgyBq/ef8QekSGkcikYnJqSow47r1Dbmu8MDvrm/oK3fomltaYXY8Vz4Me3vijszwCEVbvabRitvaafUMvdaurK6J29pVjUYClZCrHHnBWQZdBmqWaxcU9K3g5tXS8vJ7U/aUmtZ/vxJ4MCuHZ/9LylGyWm1kmVyRZvxYfjNeofXrX4+8qazwNrboCLED5sG5otfa42ORq1vyqq3JFw7HkbithQdKswfYI1VpQs61KiZ9Ep4bAvNOqdUs62Km2kTjJwphwMXdnzzxfif5KHVaY4/HU1+BVKioI61AICBjwDZf+bCuXqvTSb+TTNXoiXuMRTXqD/RW3MPl21uKNVtjsZiIrvKr+gbJcpFFIpG2jk6lzb6unt4NvR4UjMYEzF6F2Nze5pIK0uN5H595cT0iK/19j8b8C3bXn4bC+qcn2fLzRKPR2bn5SjHj4OEsr6wqbS3z9PS0f3DQ0tqm8KFbWllRfh0lIUtC74VYR0KDKurlVkVMAjY5PU27tbBwEKu1MHOl1AogBcWWTgOX4M3Y2PqG/vj4OByJlEP35+cu/ebW6PhEY3MLd2eYaUIPz/6XLAGiBsfX3IFeKW9MlMTp2VnfwIDykz/f0PR+ywT4eItLy4q9XHnucj1XLyanpkUZqOPjEwlaOyRS8nZpttp6xdhjBEfl7u5OYq1Y1WgqpTjOm9GxDf2m3eHwX17GYoUvMcXj8evr66Oj482tLVB47sSXe09qcOjFcarly1IyIKz+3IGedEa5Wcp3DQZl3hMH9ynn1qdiAR7F2MSkcoaxrb3DvH9QxcVDswiFQuXv4C0sLsHSvlKWKptb29KMrcvlKp8ErTab9Frx8JCU/RqFcHJsbGpuac1Kk1DKKyiwDmWO0tzW52lz37juUxuWLzsvPojEbBVhTy4DgfmFBeXEz4CnBKv+Yg6SYnF7ewdGtb6xScZd0Gn1DJByNaXEZ4fTeVqO+wFreSlba94v68b3hl4vZWsNe8ZyWmsym+XSCvAAx8Ynarb8XMlthETST4/+Zrd+xHzyu/7Q1GPqrhJNSiwW062vy3vgNahSmcz7FX3FO5VKbe3sSOxUwEJjdm6+QpOklb1ycQsrkjWoGpbeYdjfPxBG3OOTU9KP7Z7RWBEORoHtxESiulNKlnM99jI0Q4EBP7Fj/2rgZuHpqUq2oQ6tVunrLPT09UtzTCMNEomEw3EEq+xGUTc3crNkNzaNTUwaTaZoLPZcw/B4vC1t7bzcBjDUctVUPXE6eWkFsPz6hl6u29lWq43XFkdDY9OuwaCEPfnTs7NaqyLKMRLs2PtXIoa+AP25LjsUFfoi4qIGtGh1bY128abe/n6tThcIBKrVRMOK4+rqyrx/MK2e6ezuKf8MEVyUyanp7Z0dl9td9SeAfE6FHsD8dnK4TDE2MXEdDMrb2mg0CtRWkruzG923tzLvL4XD4ZXVtZK+MZDO/OKiooKT/ZeXre3tyIPw+pjDsm37D2Vf+vv71vM/ur5bk6y4vOwI3dzAChGWNsBZ5R/0v6qrV70eWdVobHZ75eZ5FoxkMgnLXt36BqzjOCY0Bm98YHBoYXEJ3sKtgkNnlQBwDEzm/YFC5VnrGhpX1zT0kmkL8zZ3dncLJusD0gGiVBSngOpu6DcLJpwHrtna2VHmcYbXe4E8eGCxMMdkcfcnBacD3Xd+4z5+XON25vHxEdaJ+s23Ebyt3HaigDphpsPn94wmn99fTbe5RbGE9/f3sDzxeLw5Aq5sMBiSa++uCpaHMIDZkfReXNzc3ip57QwOod/vz7b2wucDslZypFM0FvP5Pmot/EckEpEm4FYwdg2GWg+S8b0Pkkmlo+O6T/ENfTE4vua67HpMoR9e2P0GMw7mOt+Mw8jDv4NDq/A5gkAgqh7gvTcrO+UF1SC6VOq9E+i5GuCe8sV6/sfBO42MKV8QCAQCIRZ8fn+1FtQuEYLY28ccB9Px19kZcFr//fvOb1TKpT8EAoFAcIfd4ajBCFL1zCxzEOa3f6wg/S3s/oT55Hf8oamSWV+yUZQrq2te7wUqFQKBQFQWwuHwoEpVUzy4ZzSR7scSZwVTvoSj+yWH7v7+3mQ2j4yOfVhX39reHghcoTohEAhEJeLh4aGaipKXFBcjyTAs90i1I7vr/ySSnHLVnjidQH9kV7mhqTko980jBAKBQJQDWNpMTatrhAeZSTYurkc4hr4kk0m7wzG/sJhzhXx0bBxGD1UIgUAgqgBg5yu3KDnXRCV9/bzG5ObmZmt7e/j1SMGDVO36Osb/IxAIRDWhQouSc5c1jYbLOKRSKaPJ3NfPVobPsLeHCoNAIBDVh/v7+8np6WrlwbPzc5a+R6PR/YODqWk1e07yvoEBDA1FIBCI6obl8LBBvopp9Eq4Fszf5b+81Op0vf2lSy1/8KoOPsm8ho9AIBCIakUwGCyYPbVypf9lDfp4IrG+oedeS6ijq/vqCi9HIBAIRA3hXeZzQ9XctZ9fWHx+F/qyvbM7MjrKvV+wDITvYnJjBAKBqE2Ew+Gl5ZUqCCXt6e0TsMIFBry7u0M1QCAQiBpHMBiqsm3S0jWUm5pPnE589QgEAoHIIplMmsz73b3Vn3ymuaXVsLf3+PiILx2BQCAQOchkModWq2r4dVUy4MCQCnqHDIhAIBCIknC73dW0U9rQ1AyrXXytCAQCgeAOWDcdH59MTqsrupThkGrYZrcXvFqIQCAQCAQXRCL3RpN55M1oZYWPGvb2IpEIvj4EAoFAiIVgMLSwtFSv4Fw0sHSdmZvDG/EIBAKBoIdkMuk4OlpaXlFOZcPm1rb5xUWb3Y5lkhAIBAIhJcLhMLDPqkbTPzD4YV29ZMQHv9U3MDC/sGC12W5ub/FFIBAIBEJ2ZDIZt9sNnDgwOESJE3v7+ldW1+yOI7z7gEAgEAglI5VKX11fO09PTWazRqubmZt7MzbW2z/Q2t7OXvaorqERPtPT2zc8MgLfAlbdNRhOnM5AIPDw8IADi0AgEIiqWTzGYnGmYMEjBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBCCkUgkFhaXenr7dg0GHA0EonZwf38/Na3u7R+w2ew4GohaJsH+gUFSvDKZTOKYIBA1QoKd3T3Zud/a3o4DgqhZjE1MkBzvDU3NOCAIRC0gk8kMqobJ3O/p7cMxQdQgHh4emCT4YV39yYkThwWBqAUSnF9YZBY58ni8OCyIGsTm1jaZCK/qG5AEEYgawYHFwtwFQhJE1C4Pbm8TEry4uMABQSBqBPv7B4QEQzc3OCCImkU0Gp2ZmxsZHTs9O8PRQCBqB6lUaml5ZXRs/MLnw9FAIBAIBAKBQCAQCAQCUcU4P3eZzfvc5cBiiUajOQ8JhW7gLzdCTxMymYzd4eDVDPh8Op0u+eRkMulyuTa3tmfn5kfHJ16PvJmemVlZXTOZzeFwWJQBIXJ0dPz09MR81PHJScFPOhxHl4FAzofzcXZ+brXZSl7bTKVSTufp9s7O/OIi9A4EOgtddrvd8CeWL8IAQkt49XH/4CAWizMfcuHzCRuuQOCKi248Pj7CIFgOrfAffPUKRhj0BBodiURYPgaaAFqt0Wph4N6MjY28GYUx1Gh1lsNDYSoNvwvDYtgzgqZl34h6Zla7vg6jHY/HBU9VeJswFAUH89BqBT2/v7/n9cBi+llMCmqjz+8v9nno79X1NftAnTidMPgPD6LdTSbPLGeowSK5PZ6d3d35hcXxiUmwG1PT6uWV1T2jCWZuSZXjN6f2D8J5+hkMhmCugV0V3AWY3fC+QApOnFSK99wvOKQ+nx/+/fb2jpcawxCB7pU5bkw1K8gFDw8PoAlb29tz8wvZaQhvc3N72+V259hek3mfxIZxl8bmFubYgqp/8Kru7cF6Y1MsFhPwyianpgU0AzrI8kywCVqdrr6xieUJA0Mqx9HRC8twfCKgJUTAHJFHra5p2D/c1t6hW9/Idyqy2DMasx/r6OqGWVnwMze3t/MLCyx9bG5ptdmLJgPRra8L6CPQBHmC//JS8Fi9qqsPs9JTFusb+uznoad89QqMQPa7qtcjBU0BuEN9AwPs7ewfHIJpwjGJRCKR2Nrabu/sYuk1vHR2/6QYwM8pOardvb3wWrnYJdBVAW+ts7snx1Ur/ZWubnDSCjLdrsGQ/cz45KRYPGjY28s+E1waAV8HnQS70dLWzm43QLUK2l6DYU/AqPb09TMfAjYhO6nBrrLTLgtW19Y+mjiLi/l/BTdPQDtzhhTsT9byQ2u5e4zgVGSfBlOb/COQfjmGV7+5xfyJu7s76DXMNRY1hjdI2JB5UYiXMK330fEx+XdhUdYsdoNFwNlmcXSzL4iLgN0oU42JMLPPkdfNLtB38FsKGD3Gq8lZghElbGhq5vITqxpNwVECB0lAH3sZc5b56gXINetiIQswSuQiG9+MRjBtP+Lu0dH8jQKOL4jcJS/4FnIc3b7+AS5P6+7pLfjSORqQkvJhXT04yexPA9Mh4JXBtGI+xMzZkYaRyWd/WGGJflUf9JP8KN/1FCgkOPkcezQ6Pp5PhaRHvKSltY35ELCi5E8C3L/sLgrMl+wTQG3EmvvgNBZrZ8FfKYiCXwFPqRxLwuQCl8vF0fiDbck3tl09vaCNJQWGAjwuZr9E5EGYv1zaAAIefjErarXaPnzpCYBHurC4BBMfBByhickpWCgxP6CenSVLaVicFvxF4l3AsrfgB2ChxNx/Y1ot5segMTnNGxkdy59Q7DwIJqWHMd/hgarh1+ACbWxugpc1N7/Q2t7B/IkNvZ5lLrziPOzw9pkLTGg26BL0lKMwHR54VMmd4bda7XYzerHJXamIswqSo7GgpTnjAw4tNG9pZSWrJLCWHx4ZeVXfkLPUYifuHK8SyG5mbg5Wf/DApeXl3pcUWfClc+RB8H9yBhYGk9g9IotLy7A+5cKDHN/+oEplf0mvTB4EH5tdz8kso8eD18Eg8xenptXcvwtda3ppFkBdZ2ZnYe7AWMF7hKc1FbEb+T0C3eM4qkDcMIzF+AVeq4BNNvP+ATtDCZv7ObtnzHaCrGm0XGZ0wYbBCg5mXMHfbfh4v6tYU4cZXAAWmPmO4C0MqYaz8xreoHpmtqWtjdlmu8PBZdHBBSLyIPxHmUcDoLTMbkIHC9quVCq9ZzQxfb+Spwkw4NlPggrx9d7zt+5Pz846ut6TwrR6hhcPks0fkLGJiUjkPv+A48TpZP4EEEqxuSBN4qyrqyuygIUXXex8lmUkwa5yPwKD2UFYg7n4ugwEmJQBhGg0mYqcobw9j2tjMCYwY7GbRLD+YtJKwdPPYDBElqggm1vbwniwmO/t9/vBBWI6w/2DQ8XOVZk8KPidMnkw/4WCnh+fnDD3GJl7LzR4ECxejjPAcV9xZ9eQs/kfKPJFmFZEJUCRivEgeNqCe5HDL2TZwv1kEJwQjjxYzsjntDNnQ4wXD7KAV1PB82Tug8UL+YFAWMTygwMMeltlPAiTjvlSStqZaDSaZbfZufmSDxeRB4nrUs8wyEAT3HmQGHkYMZbDplDohljFfN9VSh4EXiYbVlnd4/7dS8YpJHgvXL4CRox8ZWd3l/mn/sFB5kwseVQHg888QwSrXvArzIScOa8yh1uJtrd1dIrLg8TfYFIP8xRGYh4kgTRMamZ6MuLyIOhY/kmBRqst+UVYjDBbCCNT7ESezNxsEvKFxSUJeBA6xetAmYQWSM+D4ChGSh36U+VBogBDw685MkU2GqpqeBCWeF09vWThYDLvc1mkg4LBLODyfNF5EHDucpHPGPaM3Hmwtf0jQ3dgsbA3g6TIyz9okJIHmVbXarXx/bpq+HX2u4MqFZfPk1PFppZW5qkiM2EgsBvLtmGOkoxPTBYj1izIHuBwoZicFzu9Lld2xxXUlQYPvvN/QmR3CLwOWIfKyIPPjBw1IBbLISUeBB+JecpDotHYSQ0wpVaTL27v7HLk3Jvb2/wn0+BBliP+Qm5bLMcZkJIH34Y8TUyyDzg9HgQXizzcaCrhMJOdQ1CbauJB5pY4R2XmBRo8CCDHRnPzC9x5kJxvckn44724cBwd5QfsScaDOzu7DP9cJ0THjo6573Q9Pj6SfQ/magjogLj98AFea1IgU7LJnLPRmjO71TOzJZ8GJtTucHAJlxXGg8/vzlVJZzu6usFLlJEHAWSnjrmGEpEH4/E4CZx+ty/9fkMgJ0Q/f5+T5XiCLyjxIIj/8pKbw7mZ80VpeJCpTjAFWM6+6fEgaOD7gz+7o+STL3w+ePvQ1GriQbJkADPFNwJBRh6cmlYXfCz7qyE7dSurq4J7JA0PMrcgBgaHhL0a+BaxciV3upiXX5gRgxv69yZCQG1Z5iWj/CUh0WFYiJVcgAgDLx4EzC0skAbn+0sS8+DE5FT2Y/AfNHjQcnjICH54G85B6ieyR8uQlSMI+CeK5UEugaOgeC2tbWRPTEoeBCeTeVPM9DLyRxoehO4T34/XoWrV8CCsiMkICFtxyMWDJHCCFw+SeADQdr/fr1gejMViJKigp69fwGUBgsWlZXKsxk6mZJtrYEhV0FPq7u0VQFXQeMLFsMLK+SvzMuae0agEHoxGoyTkdU2jlZcHibKNjI7R4MGRN6PEhmTVg2x81TU0FrulGwhckfYvFLpnJzsPkpfOJXCUbJvA6lv1cQiBZDwIc2p0bJx4g8W2O6ieDw59PMdh/LnH1FUND4J/TtrAMVGJEniQXJh9F0q3wf3V3N7eERMHT9g1GIrNdBl5MJVKDX0cPdLY3MLxHLYYYKKxn9Blcf1xVoecRR/YRuIh6/ncv2CCHDu+XWm+vDj8+PhIFiAgYA+vrq64nFDT40HmKqx/cEheHiT7/8yYNLF4MBQKMc5Edsgu2fsgsSKb1YY9IwmwFzCDJOBB0GHiSZZc4/QPfBQDtn9wwK4tNHjwnd8bJzeSgJIKhvdQ5cHTszNmKPie0cSFDauGB0lGmvqGRkq7UqLzILRT9fo1+cyJ08nr1eTfg+4bGAAyhYlzGQhwGQTaPMiMLbEcHor4QJYIOrIYzPnM7d0daYzz9FRYA7wXF+QhZ+fnOX91M646fjwT28EwHlgsHo9HQF648nmQFFCD0ZCRB29vb99HcTPSQInFg8wd71uGu8UMgCkYx7i0vFIwT45yeBCsK3lT7IGj5KATPgbKJgsPAmx2B/nHuUJ7uVR58Jlx0sT8ITCMdocjGAyW5MESyRPGxouZVsnyyYDPVswjIjH5OVthiuXBcCTCpInunt4cDS/Jg7DAWVldKzZWsEgcGR0Fd4jF/HLPKQHLOr7neswEEatrGlFWRsy1Xs6V3ixY7s77/f7ydwweHh7YD+KB8oqluYPVaNZRyb/sSY8HLYfvk6flvALu+WRAFcvhwXg8zszxwiznJAoPgl0iK/GcZS8sydlj58gUAPsmLg+WFHiJxbKq5vAgKAy58VoscBSmObGi2eyOHHmwpKhejxSz/AV5ENSMOQjMVJPS8GAikQD35sMiSdVgJN+MjcFigWnQeOVVK3YxRMq8ai1t7exP4G4ipOTBbJbXrMCMYx7NZ1fB+Yt3jkt1sPxrGm1OepycEQPjXJCGeOVW4lWSlbk7sbq2JuJbmFbPsKQMXdNoiHufM3kLzlkBIA8xF4kEAIsEFJzzinNSjIIDU05eNe5KzpybOVrEnQdzcqlx50F4BS6Xi7ldnLM/KQoPMuOX8rcdxsYnyCzLt+dkSDlOahF5EMTr9XLhweeXyWALBo6SDV6iG2Lx4NsldpF0tSxzitxnB97JWYXR5kGyVT43v8CSJQ/+RLSFOw8ODA1JsC9aUhaXliuRB9nSTdc3FFRsXlvW4Nt4PB6wbOOTUwUtcM7iiO9cgGdy321OJpPkHjf7NX8BcJ6esjhm5NJcTt7dt1ua3ovyeRAGgcXRzZuJN0aTGYh7YHAoJ0UbyOTUtAQ8aGdsUuW8Qe48yNJUJg8OqoaZqd7AUcm5yPbu+kZKXB4EzSeZsmCQ870LZhxpfmVhsofGjGKVhge7e3qL7dXk8yDT/hQMHCV/PTo6FpcHWeY+Cw/GEwmyMZLTAGl4kNlIrU43PjHJ9MfeZ9lyuXKM7cmJE75SULwXFywpjkXkwZbWtmJtAAG+KPZGRsfHy9+Wl54HR96MFrsWVM7RLXx+/+CANLhYCheiYDD+LMMOr59XWRxww4hdKubxCkYqlW7+ODI8J4mTi5GUID8A/oZxRJV/tMcRzH02p5PHISNYPPh8zslFzokwDR4kBR3gXbCcD7K8feCO/LuHBXmQXeCt5W9Hl8+DMKrsqWPi8ThxQpZWVorNspwM0uXzIPgALKPq8/lZDhoK8iAZ6vzAUfJ5GGTysjjyYDlzn32P5cBiKZh6VGIefHEa9a7CGjPTb0fXW0e9auJkthh5Qq6vg0rjQZgdRMYmJsi/gwNdzMiI8mqY1VXgp+kpGHHOyZ01sAM+oRc62EEMOOgw0y8qeEONSaDv40XzVoscwYzHCIWELCrB2yQnmHxtrwAeJIEi+b8lepwMy858sfpi5fMguXaUkziooGNW/7YwXLygnwC6IaxmXLEeiRgnQxS4WOAouTNSsN6NxHEyTDDD+Mn5rIw8SMwUsRXZlFxVw4NMR73gHqC8PPjSIKeYxQ6KBVKK8mqAJto6OotpkegKxsz+vb9/QGlhzoz8JFYCzOz7EJoiJYfIG1Sx5h5kGUyyBVdOWDI54nyb3Z1bYjdhPAgtJOcj+ZkwRefBKfXbOqdMWdNojo6OWRY+ZfIgzAvy0vM7WHAvPed2EjPEl+UyjhJ4kPnKmIGjxPTlbAsrgQefGZH84Glkt6Rk58Ecc6Gena2mfDIkcVNPX7+497bE5cHnd5mHSRWn7MKcEg8CSExp/s6YuAoWDAbJicDo2DiNV0CgnpklLc/yEQmABx+j2LELqUwKU4BjlqoXSzlGAq78xTWP+cLIEcerGXx5kOmW5OfPkfj+IA0eNJnNzDhAoJ6CwgyWABVlVpaBqUf+CuRS/pKQKg/mB46C8g8MqQpmb1AID4JWkGPirFlQAg++M7AL5IpBNfEgc9aXTLIqLw++3cjd3mavCMDyakC14OsFLw6w2wp6CnZ/f0/Sb4JDkuCzzBG2ECCce3xywrxGzXI3kJlzEsxUhE96T+Y1+XcG8+UbiUS2d3aK1W9i2bvgNV948aD34oJ4vDCt8htWBTzY3dtbZrFsgNVmI3/iUndGRh58zgscJf+bf19MITyY40Ayr1OJzoMXPt/G5ibHOUVyv8Njq4kHHx4eiLMEax9ecf7S8yAzF/TbYiV87k2Q5KJc7oNrtNpitdLE4kFwqrsZQaoej+eZPubm50luZHJs112qggPzYjWviE1mJpn8xSBpTE59vZJmIcCtOh5fHoQ3wgwbPj09y/9MpfPgKWO3k5f0Dw7mPIp5vTEbQKhYHnx+GThK6q/lH68ohwef32Yd3MjJeio6D4L9zzp+8BOXl6WnFdkoG1QNV1n9QebUBqe9ZC0GMBewsHozNsYlck/0fDLMBSy4c9zv0TOP/NiTQSWTSTK2+RWLxOLBhcUlouQl60CJhfNzF+H3jo+3xElOLZaFJLOuLkzPksd84LEwSbBg5O345CT5q9d7wf5A5okJSxi2YB6EPjJTNAD1l5wsFceDT09PzDqSsPiFXrML2RV/G0780klmBp22tLWXtAbw1ra2tkdGx/L3ZCTgQTLmJA62YAEURfEgM/UoJR4MRyLMG9nsxVzu7u7IognMV5XxIIw2OSf6uBzD2m2htJagyTu7BnL9HCyS9DwIrWXGjubsjrK8GrfbTdwqmAJ7RlPBoFOf3z/EKA5rzgtcEWUuMG8xU8ovzXFbDMwC8+iHZfOE6ZSCylkshwUHEF4QmETmtSNwOAsG4bg9HmZLllZWCp40gdMyv/j+tc7MzfHqb0keBPMOdph5VxHebLEL+xXNg8xEDezlJJiDwzQLLOv9bBG960I5uNLptNVmI45ovr2SgAeZgaMs8c+K4sGPXNCPx43SvigznLu5tQ28lIJeLlgAcoiTzWbANLbqmdmccK+CAkSToyFMHuQoOZXiCQ/WNzRyaQOIRqstdkF7nlFuhlzTA+0FXoCXdXR0DF3IyTPQmVc+QAIezK7lSUvAP2FGD7K7KDkZ1WAAYS4AP4ItgrdjdxyRvOssNRqIggGZchx2eP3MdNlXV1fMdN+bW1vc5fr6ukweZEZlc7eHOStxEl2jW193np6G3+Hc5QLD2PQySw+QYL5RKkgr2dFYWFo6Pj4BNwweCHZbPTub87Ri2Q5LahS87pzBBJ3Pz5/Q0tbGwk3MBnN8+6B1OfsPYvEgR+kbGMjSOtmIfntPivMwkgOF/NpY8L8k+IppqI0mM9iNUOgG3iDYjfqPFxHFAo9Jj2BecBxVsKkwj7jzYM67K5YhnCMPCp77z/xzNDEjxCjFyeTc2oZ5DeQIb/CtYby+3t8/YKZ0zlLDM8+8asw5znQyBfBgzo4Q93wyL8l0q8huZ5rs1HGRkdExLlOYUt0lcoMp5wSfnQcfHx+ZV2BKXGFuaS14n51XbqWC2svcm+IrMAG5LN/YdkLCYebKjte1dJiSTJ+wpIC7UvLiPLPYfclMZQJCuThmKCK7PeyXMrjnk8nJCSMjD5KMUsRFKZherxiYwWngohScjMXyUhZMtJJPwQJ6lG/hS/IgM3C02GVYEfOqMU1lOTz49PTE3LGnwYP39/cDg0McuwO8k2X2PaNJwGjAK2Dy4CUjDI+7DWSu5kg2GF6i32SrngPsD04yu1YPDKlsNjvHCH9yBpRfyq0gyA7tEOttNXBEiZu6vb2Tv9gpmBcxC2g8iZou9qbWN/TFghhJNk5ewrQ85KhLmHAvEFaSemAc+F7oA08MbEjOXk2+dHZ1w8c4UrbP5wf/5FVxrQMGhHWHsHqv5D44i4ADDEzB5TrG/sGBgFcGw1XwZA38BAEJ9MCV5duAjXc1s4jnzF5rPn9fmhyFFIsxA3sOdqNYsvSPIm0GBi2HhffSt3d2BYxq18v4rkgkQrZZLou8SliiarQ6837RcrekRGnB7XeWFP3s+a9etiFE1jVRbldOmEnX83eni5ipjyL9wAJz+Xx275oY1WLZjcAwMsPaHUdHMM25y86uIb+Q3IXPB74WxyeA7crZB4AZZN4/4NUMk9nMJUY9Fos5HEegMOCHZNMejo6Ng6sMDgBf9xUWZfAtjrHxWYKDyQLtLBkLAdMTHFH4ZM7Wpd3hMOwZS57b3tzcwNfn5ufBW8v2ERRmQ6+H9RH7T0NHDiwWXsO+vbPDPIAW8OKIuNxuUU4JYZTgpZRT4ffq+tqwtwcLcNCN7ADCSM4vLsKogmILuAgJWmexHIIjNDY+QbQOZj1MT8HFJt7toieNJnPBwQTNhBXuNZ+NVugX6CevVwbamL8Fd3Z+DnNf2C43KDyvNsC7JjoPqiggPx60Hyba+bmrpI8EhlGr04Gn95FKvBkFlYBxvmQN8YUe8Z0R0JGbvOB2v98Po1pORqZ3+d6NoDAFE6MJmvu7+VeNYCThT+D+cW8YGA34aXjvHB1XaCpMcBh5vhEs4A2+M4wLJOftlFoN9AcuUI6l/f/bA6ZW" };
// Mise en page fidèle à l'écran « Devis client » du module : logo U'mob
// vectoriel (cercle vert + éclair), accents émeraude, en-têtes de tableaux
// teintés, filets fins, totaux en évidence, cadre « Bon pour accord ».
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
  const EMERAUDE = [0.024, 0.588, 0.412];
  const GRIS = [0.42, 0.45, 0.50];
  const FILET = [0.87, 0.89, 0.91];
  const FOND_VERT = [0.93, 0.99, 0.96];
  const FOND_GRISE = [0.965, 0.97, 0.975];
  const NOIR = [0.11, 0.15, 0.19];
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
  const lg = 176, lh = lg * LOGO_UMOB_PDF.h / LOGO_UMOB_PDF.w; // ratio officiel
  cmds.push("q " + lg.toFixed(2) + " 0 0 " + lh.toFixed(2) + " " + M.toFixed(2) + " " + (H - 58 - lh).toFixed(2) + " cm /Im1 Do Q");
  R(W - M, 64, "OFFRE À LA LOCATION", 13, true, EMERAUDE, false);
  R(W - M, 82, "N° " + (r.numOffre || "-"), 10, false, GRIS, false);
  R(W - M, 96, "Valable jusqu'au " + (r.dateValiditeFr || "-"), 9.5, false, GRIS, false);
  T(M, 124, "53 avenue Carnot · 69250 Neuville-sur-Saône · 04 82 29 96 78 · www.umob.fr", 8, false, GRIS, false);
  ligne(M, 134, W - M, 134, FILET, 1.2);

  // ── Bloc destinataire / modalités (2 colonnes, comme à l'écran) ──
  let y = 158;
  T(M, y, "DESTINATAIRE", 7, true, GRIS, false); T(W / 2 + 20, y, "MODALITÉ", 7, true, GRIS, false);
  y += 14;
  T(M, y, r.societe || "-", 10.5, true, NOIR, false);
  T(W / 2 + 20, y, "Mensuel à échoir · " + r.duree + " mois", 10.5, false, NOIR, false);
  y += 16;
  T(M, y, "VOTRE COMMERCIAL", 7, true, GRIS, false); T(W / 2 + 20, y, "ÉMIS LE", 7, true, GRIS, false);
  y += 14;
  T(M, y, r.commercial || "-", 10.5, true, NOIR, false);
  T(W / 2 + 20, y, r.dateEmission || "-", 10.5, false, NOIR, false);
  if ((r.commercial || "") === "Corentin Surand") T(M, y + 11, "corentin.surand@umob.fr · 04 82 29 96 78", 8, false, GRIS, false);
  y += 24;
  ligne(M, y, W - M, y, FILET, 0.7);

  // ── Tableaux Matériel / Prestations ──
  const table = (titre: string, lignes: any[]) => {
    y += 24; T(M, y, titre, 10.5, true, EMERAUDE, false);
    if (!lignes.length) return;
    y += 8;
    rect(M, y, W - 2 * M, 17, FOND_VERT);
    T(M + 7, y + 12, "DÉSIGNATION", 7, true, GRIS, false);
    CT(392, y + 12, "QTÉ", 7, true, GRIS, false);
    R(456, y + 12, "LOYER U. HT", 7, true, GRIS, false);
    R(W - M - 7, y + 12, "LOYER TOTAL HT", 7, true, GRIS, false);
    y += 17;
    lignes.forEach((l) => {
      T(M + 7, y + 10.5, l.nom.length > 58 ? l.nom.slice(0, 57) + "…" : l.nom, 9, false, NOIR, false);
      CT(392, y + 10.5, String(l.qte), 9, false, NOIR, false);
      R(456, y + 10.5, fr(l.u), 9, false, NOIR, false);
      R(W - M - 7, y + 10.5, fr(l.tot), 9, true, NOIR, false);
      y += 16.5;
      ligne(M + 7, y, W - M - 7, y, FILET, 0.5);
    });
  };
  table("LE MATÉRIEL — LOYERS MENSUELS HT", (r.articles || []).map((a: any) => ({ nom: a.nom, qte: a.q, u: a.loyerU, tot: a.loyerU * a.q })));
  if ((r.packs || []).length) table("LES PRESTATIONS — LOYERS MENSUELS HT", r.packs.map((p: any) => ({ nom: p.nom, qte: p.qte, u: p.loyer, tot: p.total })));

  // ── Mise en service (comptant) ──
  y += 24; T(M, y, "MISE EN SERVICE (COMPTANT)", 10.5, true, EMERAUDE, false);
  y += 8;
  rect(M, y, W - 2 * M, 17, FOND_VERT);
  T(M + 7, y + 12, "DÉSIGNATION", 7, true, GRIS, false);
  R(W - M - 7, y + 12, "MONTANT HT", 7, true, GRIS, false);
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
  R(W - M, y, "Total mensuel HT :  " + fr(r.loyerMensuelHT), 10, false, NOIR, false);
  y += 15;
  R(W - M, y, "TVA 20 % :  " + fr((r.loyerMensuelTTC || 0) - (r.loyerMensuelHT || 0)), 10, false, NOIR, false);
  y += 20;
  rect(300, y - 7, W - M - 300, 23, FOND_VERT);
  R(W - M - 8, y + 9, "TOTAL TTC / MOIS :  " + fr(r.loyerMensuelTTC), 11.5, true, EMERAUDE, false);
  y += 27;

  // ── Bon pour accord ──
  y += 26;
  rect(M, y, 250, 62, FOND_GRISE);
  cadre(M, y, 250, 62, FILET, 0.8);
  T(M + 9, y + 15, "BON POUR ACCORD", 9, true, NOIR, false);
  T(M + 9, y + 36, "Le : ……………………………", 8.5, false, NOIR, false);
  T(M + 9, y + 54, "Signature :", 8.5, false, NOIR, false);

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
export function DevisModule({ brouillon, onBrouillon, entreprisesNom, tousDevis, onOuvrirFiche, onSupprimerBrouillon, ouvertureDirecte, comptesCRM, onSauvegarder, emailSociete, modelesMail, onModelesMail, onDevisEnvoye, numerosExistants }: {
  brouillon: DevisBrouillon | null;
  onBrouillon?: (d: DevisBrouillon) => void;
  entreprisesNom?: string[];
  // Liste de TOUS les devis archivés (toutes fiches confondues) pour la vue
  // « liste » par défaut du module ; onOuvrirFiche ouvre la fiche entreprise.
  tousDevis?: DevisListeItem[];
  onOuvrirFiche?: (entId: string) => void;
  // Supprime le brouillon en cours (bandeau 🗑️ de la vue liste).
  onSupprimerBrouillon?: () => void;
  // Vrai UNIQUEMENT pour le flux « 🚀 Rouvrir » d'une fiche entreprise :
  // le module s'ouvre alors directement sur l'assistant. Par défaut (clic
  // sur l'onglet 🧾 Devis), on ouvre TOUJOURS la liste des devis.
  ouvertureDirecte?: boolean;
  // Comptes du CRM avec nom légal + téléphone pour le volet de recherche
  // de compte (match nom commercial + nom légal + téléphone).
  comptesCRM?: { affiche: string; nom: string; tel: string }[];
  // Sauvegarde du devis sur la fiche entreprise du CRM. Retourne l'ID de
  // l'archive (nouvelle ou mise à jour) pour lier les sauvegardes suivantes
  // au même devis, ou false si la société n'existe pas dans le CRM.
  onSauvegarder?: (s: SauvegardeDevis) => string | boolean;
  // E-mail de contact du compte (premier contact avec e-mail), "" si inconnu.
  emailSociete?: (nom: string) => string;
  // Modèles de corps de mail pour l'envoi du devis (persistés dans le CRM).
  modelesMail?: ModeleMailDevis[];
  onModelesMail?: (m: ModeleMailDevis[]) => void;
  // Signale au CRM qu'un devis vient d'être envoyé au client (mail + PDF) :
  // le CRM marque « Envoyé » l'archive correspondante sur la fiche entreprise.
  onDevisEnvoye?: (societe: string, numOffre: string, dateRelanceFr: string) => void;
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
  const [anciennete, setAnciennete] = useState<string>(b.anciennete ?? "Plus de 2 bilans");
  const [mode, setMode] = useState<string>(b.mode ?? "LOCATION");
  const [duree, setDuree] = useState<number>(b.duree ?? 50);
  const [grille, setGrille] = useState<string>(b.grille ?? "SGC 5 à 9");
  const [renouvellement, setRenouvellement] = useState<boolean>(b.renouvellement ?? false);

  // Lignes — quantités & remises stockées en texte libre pour une édition fluide
  // (champ vidé = 0 pour le calcul, mais la ligne reste affichée)
  const [qtes, setQtes] = useState<Record<string, string>>(b.qtes ?? {});
  const [remises, setRemises] = useState<Record<string, string>>(b.remises ?? {});
  const [catalogueOuvert, setCatalogueOuvert] = useState(false);
  const [rechercheArticle, setRechercheArticle] = useState("");
  const [comptePanelOuvert, setComptePanelOuvert] = useState(false);
  const [rechercheCompte, setRechercheCompte] = useState("");

  // Extras
  const [packsCoches, setPacksCoches] = useState<Record<string, boolean>>(b.packsCoches ?? { "CONFORT+": true, "U'TRACK": true });
  const [coupDePoing, setCoupDePoing] = useState<number>(b.coupDePoing ?? 0);
  const [remiseLibre, setRemiseLibre] = useState<number>(b.remiseLibre ?? 0);
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
      step, societe, anciennete, mode, duree, grille, renouvellement,
      qtes, remises, packsCoches, coupDePoing, remiseLibre, commercial,
      miseADispoStr, fraisDossierStr, flotteReprise, dureeAmort, locamRenouvellement,
      ...(offreLiee && offreLiee.societe === (societe || "").trim() ? { idOrigine: offreLiee.id, numOffreOrigine: offreLiee.num } : {}),
    });
  }, [step, societe, anciennete, mode, duree, grille, renouvellement, qtes, remises, packsCoches, coupDePoing, remiseLibre, commercial, miseADispoStr, fraisDossierStr, flotteReprise, dureeAmort, locamRenouvellement, offreLiee]);

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
  const parseRemise = (raw: string | undefined) => {
    const v = parseFloat((raw ?? "").replace(",", "."));
    return isNaN(v) ? 0 : Math.min(100, Math.max(0, v)) / 100;
  };
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
      const remiseSaisie = parseRemise(remises[a.nom]);
      const loyerUNet = loyerU * (1 - remiseSaisie);
      return { ...a, q, pvu, loyerU, remiseMax, remiseSaisie, loyerUNet, total: loyerUNet * q, famEff };
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
  });
  const construireMail = (resume: DevisResume): MailDevis => ({
    destinataire: emailSociete?.(societe) ?? "",
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
    step, societe, anciennete, mode, duree, grille, renouvellement,
    qtes, remises, packsCoches, coupDePoing, remiseLibre, commercial,
    miseADispoStr, fraisDossierStr, flotteReprise, dureeAmort, locamRenouvellement,
    ...(offreLiee && offreLiee.societe === (societe || "").trim() ? { idOrigine: offreLiee.id, numOffreOrigine: offreLiee.num } : {}),
  });

  // ── Actions d'archivage & d'envoi ──
  const sauvegarder = () => {
    const resume = construireResume();
    const mail = construireMail(resume);
    const ok = onSauvegarder?.({ societe, commentaire: commentaire.trim(), brouillon: brouillonCourant(), resume, mail });
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
  // Envoi : mailto → ouvre un brouillon dans le client mail PAR DÉFAUT du PC
  // (Outlook desktop, compte SMTP de Corentin). Outlook insère la signature
  // par défaut (logo inclus) sur les nouveaux messages ; sinon Insertion →
  // Signature (1 clic). Le PDF est téléchargé au préalable, il ne reste
  // qu'à le joindre (1 clic) et à envoyer soi-même.
  const envoyerMail = (objetMail?: string, corpsMail?: string) => {
    if (!dateRelance) { setRetourAction("⚠️ Choisis d'abord la date de relance du devis (obligatoire)."); return; }
    const resume = construireResume();
    const nomPdf = telechargerPdfDevis(resume);
    const mail = construireMail(resume);
    const objetFinal = objetMail ?? mail.objet;
    const corpsFinal = corpsMail ?? corpsCourtMail(resume);
    window.location.href = `mailto:${mail.destinataire}?subject=${encodeURIComponent(objetFinal)}&body=${encodeURIComponent(corpsFinal)}`;
    // Le devis part au client : la fiche entreprise le marque « Envoyé ».
    const pRel = dateRelance.split("-"); const dateRelanceFr = pRel.length === 3 ? `${pRel[2]}/${pRel[1]}/${pRel[0]}` : dateRelance;
    onDevisEnvoye?.(societe, resume.numOffre, dateRelanceFr);
    setRetourAction(`✉️ Brouillon ouvert dans ton Outlook — ta signature par défaut (logo inclus) s'insère normalement ; sinon un clic dans Insertion → Signature. Joins le PDF « ${nomPdf} » (déjà téléchargé), relis, et envoie !`);
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
    setRemises({ ...remises, [nom]: String(isNaN(n) ? "" : Math.min(100, Math.max(0, n))) });
  };
  const appliquerRemiseMax = (nom: string, max: number) => setRemises({ ...remises, [nom]: (max * 100).toFixed(1) });
  const toutRemiseMax = () => {
    const r: Record<string, string> = {};
    lignes.forEach((l) => { r[l.nom] = (l.remiseMax * 100).toFixed(1); });
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
      onNouveau={() => setVueListe(false)}
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
                  <Input value={societe} onChange={(e) => setSociete(e.target.value)} placeholder="Nom de la société cliente…" />
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
                              key={f.affiche + "|" + f.tel}
                              type="button"
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-black bg-white hover:bg-emerald-50 text-left border-t border-slate-100 cursor-pointer"
                              onClick={() => { setSociete(f.affiche); setComptePanelOuvert(false); setRechercheCompte(""); }}
                            >
                              <span className="flex-1 truncate font-medium">{f.affiche}</span>
                              {f.nom && f.nom !== f.affiche && <span className="truncate text-[11px] text-slate-400">{f.nom}</span>}
                              {f.tel && <span className="text-[11px] text-slate-500">{f.tel}</span>}
                              {f.affiche === societe && <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">sélectionné</Badge>}
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
                  Configurer le matériel →
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ============ ÉTAPE 2 : LIGNES & REMISES ============ */}
        {step === 1 && (
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">3 · Matériel — loyers & remises par article</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setStep(0)}>← Retour</Button>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setStep(2)}>Reprise & packs →</Button>
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
                      <th className="text-center px-2 py-2 w-28">Remise %</th>
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
                          <td className="text-center px-2"><Badge className={grille === "IND" ? "bg-blue-100 text-blue-700" : "bg-slate-800 text-white"}>{(l.remiseMax * 100).toFixed(1)} %</Badge></td>
                          <td className="text-center px-2">
                            <div className="flex items-center justify-center gap-1">
                              <span className={`font-bold text-black bg-slate-100 rounded px-2 py-1 text-sm ${dep ? "text-red-700" : ""}`}>{(l.remiseSaisie * 100).toFixed(1)} %</span>
                              <Input className={`h-8 text-center w-16 ${dep ? "bg-red-50 border-red-300 text-red-700 font-bold" : ""}`} type="number" step="0.1" min={0} max={100} value={remises[l.nom] ?? ""} placeholder="0" onChange={(e) => setRemiseArticle(l.nom, e.target.value)} />
                              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" title="Appliquer la remise max" onClick={() => appliquerRemiseMax(l.nom, l.remiseMax)}>max</Button>
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
                      if (!ch) return null; // ligne scooter seulement si un châssis est présent
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
                      <td className="px-3 py-2 text-right" colSpan={5}>Loyer HT mensuel net</td>
                      <td className="text-right px-2 font-mono">{eurM(loyerNet)}</td>
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
                    <span className="text-[10px] text-slate-400">indication — lecture seule, calculée depuis les remises appliquées (lignes + remise supp. lissée)</span>
                  </div>
                );
              })()}
              <p className="text-xs text-slate-400">🔒 Les colonnes « Remise max » sont internes (jamais sur le devis client). Les batteries/chargeurs héritent de la remise du châssis présent dans le devis (R4).</p>
            </CardContent>
          </Card>
        )}

        {/* ============ ÉTAPE 3 : REPRISE DE LA FLOTTE ACTUELLE ============ */}
        {step === 2 && (
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">4 · Reprise de la flotte actuelle</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setStep(1)}>← Retour</Button>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setStep(3)}>Packs & extras →</Button>
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
              <Button variant="outline" onClick={() => setStep(3)}>← Modifier le devis</Button>
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
                  <Button onClick={sauvegarder} disabled={!societe.trim()}>💾 Sauvegarder sur la fiche entreprise</Button>
                  <Button variant="outline" onClick={ouvrirVoletMail}>✉️ Envoyer par mail + PDF</Button>
                  <Button variant="outline" onClick={copierTexte}>📋 Copier le texte du devis</Button>
                </div>
                {retourAction && <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">{retourAction}</p>}
                <p className="text-xs text-slate-400">
                  Le devis complet (brouillon ré-ouvrable) est archivé avec le commentaire — on le relance depuis la fiche entreprise → « 🚀 Rouvrir ».
                  « ✉️ Envoyer par mail » ouvre le volet des modèles de corps de mail : tu choisis un modèle (ou le message court par défaut) et un brouillon s'ouvre dans ton Outlook — ta signature par défaut (logo inclus) s'insère normalement, le PDF est déjà téléchargé (à joindre en 1 clic), tu relis et tu envoies toi-même.
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
                        setEnvoiEnCours(true);
                        try {
                          const mail = construireMail(apercuResume);
                          const objet = modeleChoisi ? rendreModeleMail(modeleChoisi.objet, apercuResume) : mail.objet;
                          const corps = modeleChoisi ? rendreModeleMail(modeleChoisi.corps, apercuResume) : corpsCourtMail(apercuResume);
                          if (!mail.destinataire) { setRetourAction("⚠️ Aucun e-mail connu sur ce compte — renseigne l'e-mail de la société ou d'un contact, puis réessaie."); return; }
                          envoyerMail(objet, corps);
                        } finally { setEnvoiEnCours(false); }
                      }}
                    >
                      {envoiEnCours ? "⏳ Ouverture…" : modeleChoisi ? `✉️ Ouvrir le brouillon avec « ${modeleChoisi.nom} »` : "✉️ Ouvrir le brouillon (message court)"}
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
                <p className="text-xs text-slate-500"><span className="font-semibold text-slate-600">De :</span> toi — depuis ton Outlook (signature par défaut, logo inclus)</p>
                <p className="text-xs text-slate-500"><span className="font-semibold text-slate-600">Objet :</span> {objetApercu}</p>
                <div className="border-t border-slate-200 pt-3">
                  <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700">{corpsApercu}</pre>
                  <div className="mt-3 border-t border-dashed border-slate-300 pt-3">
                    <p className="text-xs italic text-slate-400">— Ta signature par défaut Outlook (logo inclus) s'insère ici (sinon : Insertion → Signature) —</p>
                  </div>
                </div>
                <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">📎 À l'envoi, le PDF « Devis-Umob-{(resumeApercu.numOffre || "offre").replace(/[^\w.-]/g, "")}.pdf » est téléchargé — tu n'as plus qu'à le joindre (1 clic) puis à envoyer.</p>
              </div>
            </div>
          </div>
        );
      })()}
      </div>
    </div>
  );
}


