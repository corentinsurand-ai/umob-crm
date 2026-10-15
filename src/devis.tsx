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
export type DevisArchive = SauvegardeDevis & { id: string; dateISO: string; dateFr: string };

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
const LOGO_UMOB_PDF = { w: 600, h: 218, b64: "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" };
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
  const VERT = [0.643, 0.816, 0.239];
  const GRIS = [0.42, 0.45, 0.50];
  const FILET = [0.87, 0.89, 0.91];
  const FOND_VERT = [0.93, 0.99, 0.96];
  const FOND_GRISE = [0.965, 0.97, 0.975];
  const NOIR = [0.11, 0.15, 0.19];
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

// ==================== MODULE ====================
export function DevisModule({ brouillon, onBrouillon, entreprisesNom, onSauvegarder, emailSociete, modelesMail, onModelesMail }: {
  brouillon: DevisBrouillon | null;
  onBrouillon?: (d: DevisBrouillon) => void;
  entreprisesNom?: string[];
  // Sauvegarde du devis sur la fiche entreprise du CRM. Retourne false si la
  // société saisie n'existe pas dans le CRM (le module l'affiche à l'utilisateur).
  onSauvegarder?: (s: SauvegardeDevis) => boolean;
  // E-mail de contact du compte (premier contact avec e-mail), "" si inconnu.
  emailSociete?: (nom: string) => string;
  // Modèles de corps de mail pour l'envoi du devis (persistés dans le CRM).
  modelesMail?: ModeleMailDevis[];
  onModelesMail?: (m: ModeleMailDevis[]) => void;
}) {
  const b: Partial<DevisBrouillon> = brouillon ?? {};

  const [step, setStep] = useState<number>(b.step ?? 0);

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
  // Mode renouvellement (interne, jamais sur le devis client)
  const [locamRenouvellement, setLocamRenouvellement] = useState<{ contrat: string; montant: string; date: string }>(
    b.locamRenouvellement ?? { contrat: "", montant: "", date: "" }
  );

  // ── Archivage & envoi (étape « Devis client ») ──
  const [commentaire, setCommentaire] = useState("");
  const [retourAction, setRetourAction] = useState("");
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
    });
  }, [step, societe, anciennete, mode, duree, grille, renouvellement, qtes, remises, packsCoches, coupDePoing, remiseLibre, commercial, miseADispoStr, fraisDossierStr, flotteReprise, dureeAmort, locamRenouvellement]);

  // N° d'offre dynamique : L + initiales du commercial + aaaammjj + position du jour
  const aujourdhui = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const aaaammjj = `${aujourdhui.getFullYear()}${pad(aujourdhui.getMonth() + 1)}${pad(aujourdhui.getDate())}`;
  const initiales = (commercial || "CS").split(/\s+/).map((m) => m[0]).join("").toUpperCase();
  const numOffre = `L${initiales}${aaaammjj}-1`;
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
  });

  // ── Actions d'archivage & d'envoi ──
  const sauvegarder = () => {
    const resume = construireResume();
    const mail = construireMail(resume);
    const ok = onSauvegarder?.({ societe, commentaire: commentaire.trim(), brouillon: brouillonCourant(), resume, mail });
    if (ok === undefined) setRetourAction("⚠️ Sauvegarde indisponible hors CRM.");
    else if (ok) { setRetourAction(`✅ Devis ${resume.numOffre} sauvegardé sur la fiche « ${societe} » — visible dans la section 🧾 Devis et la timeline de l'entreprise.`); setCommentaire(""); }
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
    const resume = construireResume();
    const nomPdf = telechargerPdfDevis(resume);
    const mail = construireMail(resume);
    const objetFinal = objetMail ?? mail.objet;
    const corpsFinal = corpsMail ?? corpsCourtMail(resume);
    window.location.href = `mailto:${mail.destinataire}?subject=${encodeURIComponent(objetFinal)}&body=${encodeURIComponent(corpsFinal)}`;
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

        <Stepper step={step} onGoTo={setStep} />

        {/* ============ ÉTAPE 1 : CONFIGURATION ============ */}
        {step === 0 && (
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">1 · Destinataire</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Field label="Société" hint="Recherche parmi les comptes du CRM — ou saisie libre">
                  <Input value={societe} onChange={(e) => setSociete(e.target.value)} placeholder="Nom de la société cliente…" />
                  <Button variant="outline" className="w-full justify-between font-normal bg-white mt-1.5" onClick={() => { setComptePanelOuvert(!comptePanelOuvert); setRechercheCompte(""); }}>
                    <span className="text-slate-500 truncate">🔍 Chercher un compte du CRM…</span>
                    <span className="text-slate-400">{comptePanelOuvert ? "▲" : "▼"}</span>
                  </Button>
                  {comptePanelOuvert && (
                    <div className="mt-1 border border-slate-300 rounded-lg bg-white shadow-xl overflow-hidden z-50">
                      <div className="p-2 border-b bg-white">
                        <Input autoFocus placeholder="Nom du compte…" value={rechercheCompte} onChange={(e) => setRechercheCompte(e.target.value)} className="bg-white text-black" />
                      </div>
                      <div className="max-h-64 overflow-y-auto bg-white">
                        {(() => {
                          const q = rechercheCompte.trim().toLowerCase();
                          const res = nomsSocietes.filter((n) => !q || n.toLowerCase().includes(q));
                          if (res.length === 0) return <p className="px-3 py-3 text-sm text-black bg-white">Aucun compte trouvé — saisie libre possible.</p>;
                          return res.slice(0, 50).map((n) => (
                            <button
                              key={n}
                              type="button"
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-black bg-white hover:bg-emerald-50 text-left border-t border-slate-100 cursor-pointer"
                              onClick={() => { setSociete(n); setComptePanelOuvert(false); setRechercheCompte(""); }}
                            >
                              <span className="flex-1 truncate font-medium">{n}</span>
                              {n === societe && <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">sélectionné</Badge>}
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
                      {Object.keys(MODELES_REPRISE).map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
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
                </div>
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700"
                  disabled={!nouvVehicule.mec || !nouvVehicule.dateReleve || nouvVehicule.km === ""}
                  onClick={() => {
                    const id = (flotteReprise.length ? Math.max(...flotteReprise.map((v) => v.id)) : 0) + 1;
                    setFlotteReprise([...flotteReprise, { id, modele: nouvVehicule.modele, immat: nouvVehicule.immat, mec: nouvVehicule.mec, dateReleve: nouvVehicule.dateReleve, km: nouvVehicule.km, remiseEtat: "", repriseManuelle: "", reprendre: true }]);
                    setNouvVehicule({ modele: nouvVehicule.modele, immat: "", mec: "", dateReleve: "", km: "" });
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
                              <p className="font-medium">{v.modele}</p>
                              <p className="text-xs text-slate-400">{v.immat || "immat. à saisir"}{c.vnc > 0 ? ` · VNC ${eurM(c.vnc)}` : ""}{c.kmAnnuel > 0 ? ` · ${c.kmAnnuel.toLocaleString("fr-FR")} km/an` : ""}</p>
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
              <p className="text-xs text-slate-400">🔒 Coefs : ×1,3 (&lt; 1 an) · ×1,2 · ×1,1 (2-4 ans). Les U'mob S5 Delivery ne sont pas valorisés (0 €).</p>
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
