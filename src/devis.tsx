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
  articles: { nom: string; q: number; loyerU: number }[];
  packs: { nom: string; qte: number; loyer: number; total: number }[];
}
// Texte du devis prêt à partir par e-mail (version client, sans données internes).
export interface MailDevis { destinataire: string; objet: string; corps: string; }
// Ce que le module transmet au CRM au moment de la sauvegarde.
export interface SauvegardeDevis { societe: string; commentaire: string; brouillon: DevisBrouillon; resume: DevisResume; mail: MailDevis; }
// Ce qui est archivé sur la fiche entreprise (id + horodatage ajoutés par App.tsx).
export type DevisArchive = SauvegardeDevis & { id: string; dateISO: string; dateFr: string };

// ==================== MODULE ====================
export function DevisModule({ brouillon, onBrouillon, entreprisesNom, onSauvegarder, emailSociete }: {
  brouillon: DevisBrouillon | null;
  onBrouillon?: (d: DevisBrouillon) => void;
  entreprisesNom?: string[];
  // Sauvegarde du devis sur la fiche entreprise du CRM. Retourne false si la
  // société saisie n'existe pas dans le CRM (le module l'affiche à l'utilisateur).
  onSauvegarder?: (s: SauvegardeDevis) => boolean;
  // E-mail de contact du compte (premier contact avec e-mail), "" si inconnu.
  emailSociete?: (nom: string) => string;
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
    loyerMensuelHT: rnd2(loyerMensuelHT),
    loyerMensuelTTC: rnd2(loyerMensuelHT + tvaMens),
    miseService: rnd2(miseService),
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
      `Contrat ${resume.duree} loyers TTC : ${eur(rnd2(resume.loyerMensuelTTC * resume.duree))}`,
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
  const envoyerMail = () => {
    const mail = construireMail(construireResume());
    window.location.href = `mailto:${mail.destinataire}?subject=${encodeURIComponent(mail.objet)}&body=${encodeURIComponent(mail.corps)}`;
    setRetourAction(mail.destinataire ? `✉️ E-mail préparé pour ${mail.destinataire} — vérifie et envoie depuis ta messagerie.` : "✉️ E-mail préparé — aucun e-mail connu pour ce compte, renseigne le destinataire.");
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
                    <div className="text-right text-sm"><p className="text-slate-500">Contrat {duree} loyers TTC</p><p className="font-black">{eur((loyerMensuelHT + tvaMens) * duree)}</p></div>
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
                  <Button variant="outline" onClick={envoyerMail}>✉️ Envoyer par mail</Button>
                  <Button variant="outline" onClick={copierTexte}>📋 Copier le texte du devis</Button>
                </div>
                {retourAction && <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">{retourAction}</p>}
                <p className="text-xs text-slate-400">
                  Le devis complet (brouillon ré-ouvrable) est archivé avec le commentaire — on le relance depuis la fiche entreprise → « 🚀 Rouvrir ».
                  L'e-mail part de ta messagerie : aucune donnée interne (grille, reprise, commission) n'y figure.
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
