// ==================== VUE DOCUSIGN — signature pré-remplie depuis le devis ====================
// (tabLabels validés par test réel le 19/10/2026)
// Pré-remplissage des PowerForms U'MOB par URL (pas d'API DocuSign).
import { useState } from "react";
import type { DevisResume } from "./devis";

const PF_LISTE = [
  { id: "bdc",  nom: "Bon de commande",        pf: "b960ff62-6dc7-4ddf-a463-071f705a60c0", icone: "🧾", couleur: "cyan",    complet: true },
  { id: "achat", nom: "Bon de commande Achat", pf: "04f6ce1e-b527-4b9b-a1d3-340a2d773c19", icone: "📦", couleur: "amber",   complet: false },
  { id: "loc",  nom: "Contrat de location",    pf: "71e124ca-d4b9-412a-bbd1-ce20eec368d1", icone: "🛵", couleur: "emerald", complet: false },
];

const PF_ROLES = { commercial: "Remplissage et signature du commercial UMOB", client: "Signature du client" };
const PF_COMMERCIAL = { prenom: "Corentin", nom: "Surand", email: "corentin.surand@umob.fr" };
const PF_LOYER_TAB = "Texte 76b617d7-990a-4ef7-a1da-f36e75dbb95f";

export function DocusignVue({ resume, onRetour, renouvellement, setRenouvellement, numContratLocam, setNumContratLocam, kmDevis, entreprise, contacts }: { resume: DevisResume | null; onRetour: () => void; renouvellement: boolean; setRenouvellement: (v: boolean) => void; numContratLocam: string; setNumContratLocam: (v: string) => void; kmDevis?: string; entreprise?: any; contacts?: { prenom: string; nom: string; role: string; email: string; tel: string }[] | null }) {
  const [ent, setEnt] = useState(() => ({
    // Données du locataire : venues du CRM (entreprise liée au devis) si
    // disponibles, sinon du résumé du devis — champs vides et modifiables.
    nom: entreprise?.nomCommercial || entreprise?.nom || resume?.societe || "",
    adresse1: entreprise?.adresse || "",
    cp: entreprise?.cp || "",
    ville: entreprise?.ville || "",
    siren: entreprise?.siren || "",
    telFixe: entreprise?.tel || "",
    telPortable: "",
    contacts: ((contacts && contacts.length ? contacts : [{ prenom: "", nom: "", role: "", email: "", tel: "" }])).map((c) => ({ prenom: c.prenom, nom: c.nom, role: c.role, email: c.email, tel: c.tel })),
  }));
  const [contactIdx, setContactIdx] = useState(0);
  const [roleCommercial, setRoleCommercial] = useState(PF_ROLES.commercial);
  const [roleClient, setRoleClient] = useState(PF_ROLES.client);
  const [livraisonAuSiege, setLivraisonAuSiege] = useState(true);
  const [interlocuteurEstSignataire, setInterlocuteurEstSignataire] = useState(true);
  const [livraison, setLivraison] = useState({ raisonSociale: "", adresse1: "", cp: "", ville: "" });
  const [interloc, setInterloc] = useState({ raisonSociale: "", adresse1: "", cp: "", ville: "" });
  const [delaiLivraison, setDelaiLivraison] = useState("2 semaines");
  const [kmContrat, setKmContrat] = useState(kmDevis || "Illimité");
  const [depotGarantie, setDepotGarantie] = useState("0");
  const [observations, setObservations] = useState("");
  const [copie, setCopie] = useState("");
  const [lienAffiche, setLienAffiche] = useState("");

  const ct = ent.contacts[contactIdx] || ent.contacts[0];
  const pfEnc = (s: string) => encodeURIComponent(String(s));

  // Matériel & conditions : IMPORTÉS DU DEVIS, en lecture seule
  const produits = (resume?.articles || []).filter((a) => a.q > 0).slice(0, 8);
  const pfContrat = {
    duree: String(resume?.duree ?? 24),
    loyerMensuel: String(resume?.loyerMensuelHT ?? 0),
    frais: String(resume?.miseADispoTot ?? resume?.fraisDossierTot ?? 0),
    miseService: String(resume?.miseService ?? 0),
  };

  const livrRaison = livraisonAuSiege ? ent.nom : livraison.raisonSociale;
  const livrAdresse1 = livraisonAuSiege ? ent.adresse1 : livraison.adresse1;
  const livrCp = livraisonAuSiege ? ent.cp : livraison.cp;
  const livrVille = livraisonAuSiege ? ent.ville : livraison.ville;
  // Interlocuteur du site : même structure que le locataire (RS + adresse + CP/ville)
  const livrRaisonInter = interlocuteurEstSignataire ? ent.nom : interloc.raisonSociale;
  const interAdresse = interlocuteurEstSignataire ? ent.adresse1 : interloc.adresse1;
  const interCpVille = interlocuteurEstSignataire ? (ent.cp + " " + ent.ville).trim() : ((interloc.cp || "") + " " + (interloc.ville || "")).trim();
  const interNom = ""; // (plus utilisé : l'interlocuteur est identifié par sa raison sociale)
  const sirenNet = String(ent.siren || "").replace(/\s/g, "");
  const sirenBoxes = sirenNet.length === 9 ? [sirenNet.slice(0, 3), sirenNet.slice(3, 6), sirenNet.slice(6, 9)] : ["", "", ""];

  // Observations : si renouvellement, texte imposé avec le n° de contrat Locam
  const obsEffective = renouvellement
    ? "Renouvellement du contrat " + (numContratLocam || "à renseigner")
    : observations;

  // « Dont » : tarif remisé de chaque article du devis, format « X,XX €HT/mois par {article} »
  const texteDont = produits
    .map((a) => Number(a.loyerU).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €HT/mois par " + a.nom)
    .join("  ·  ");
  const pfEur = (v: string | number) => {
    const n = Number(String(v).replace(",", "."));
    if (!isFinite(n) || n === 0) return "";
    return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " € HT";
  };

  const pfConstruireLien = (pf: { pf: string; complet: boolean }) => {
    const base = "https://eu.docusign.net/Member/PowerFormSigning.aspx?PowerFormId=" + pf.pf + "&env=eu&acct=a0bbec2d-9e0b-4dae-b3a6-afe0fb06f14b&v=2";
    const p: string[] = [];
    p.push(pfEnc(roleCommercial + "_UserName") + "=" + pfEnc(PF_COMMERCIAL.prenom + " " + PF_COMMERCIAL.nom));
    p.push(pfEnc(roleCommercial + "_Email") + "=" + pfEnc(PF_COMMERCIAL.email));
    if (ct) {
      p.push(pfEnc(roleClient + "_UserName") + "=" + pfEnc(ct.prenom + " " + ct.nom));
      if (ct.email) p.push(pfEnc(roleClient + "_Email") + "=" + pfEnc(ct.email));
    }
    if (pf.complet) {
      const add = (label: string, val: string | number) => { if (String(val ?? "").trim() !== "") p.push(pfEnc(label) + "=" + pfEnc(val)); };
      add("nom_locataire", ent.nom);
      add("adresse_locataire_1", ent.adresse1);
      add("code_postal_locataire", ent.cp);
      add("ville_locataire", ent.ville);
      add("siren_locataire", sirenNet.replace(/(\d{3})(?=\d)/g, "$1 "));
      add("fixe_locataire", ent.telFixe);
      add("portable_locataire", ent.telPortable);
      add("mail_locataire", ct ? ct.email : "");
      add("siren_locataire_1", sirenBoxes[0]); add("siren_locataire_2", sirenBoxes[1]); add("siren_locataire_3", sirenBoxes[2]);
      // Interlocuteur du site : RAISON SOCIALE + adresse + CP/ville (même structure que le locataire)
      add("nom_interlocuteur_site", livrRaisonInter);
      add("coordonnees_interlocuteur_site_1", interAdresse);
      add("coordonnees_interlocuteur_site_2", interCpVille);
      // Livraison : RAISON SOCIALE en 1re ligne, puis adresse, CP, ville
      add("adresse_livraison_1", livrRaison);
      add("adresse_livraison_2", livrAdresse1);
      add("code_postal_livraison", livrCp);
      add("ville_livraison", livrVille);
      add("delai_livraison", delaiLivraison);
      produits.forEach((a, i) => {
        add("ref_materiel_" + (i + 1), "");
        add("designation_materiel_" + (i + 1), a.nom);
        add("qte_" + (i + 1), a.q);
      });
      add("duree_contrat", pfContrat.duree);
      add("km_annuel_produit", kmContrat);
      add("depot_garantie", pfEur(depotGarantie));
      add("montant_loyer_mensuel", pfEur(pfContrat.frais)); // ⚠️ = frais de mise à disposition
      add(PF_LOYER_TAB, pfEur(pfContrat.loyerMensuel));      // = loyer mensuel HT
      add("montant_loyer_dont", texteDont);
      add("observations", obsEffective);
      add("lieu_signature", "LYON");
      add("nom_signataire", ct ? ct.prenom + " " + ct.nom : "");
      add("qualite_signataire", ct ? ct.role : "");
    }
    return base + "&" + p.join("&");
  };

  const pfCopier = async (pfId: string, lien: string) => {
    try { await navigator.clipboard.writeText(lien); setCopie(pfId); setTimeout(() => setCopie(""), 1500); }
    catch { window.prompt("Copiez le lien :", lien); }
  };

  const PF_COULEURS: Record<string, string> = {
    cyan: "bg-cyan-50 border-cyan-200 text-cyan-800",
    amber: "bg-amber-50 border-amber-200 text-amber-800",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-800",
  };
  const champPF = "w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm";
  const lblPF = "text-[11px] font-semibold text-slate-600 mb-1 block";
  const roPF = "px-2 py-1.5 bg-slate-50 border border-slate-100 rounded-lg text-sm";

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-bold text-slate-900">✍️ Envoi en signature — DocuSign</h2>
          {resume ? (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full inline-block px-3 py-1 mt-1">
              ✓ Devis n° {resume.numOffre} importé — matériel, loyers et durée repris automatiquement
            </p>
          ) : (
            <p className="text-xs text-amber-700 mt-1">Aucun devis importé — données de démo</p>
          )}
        </div>
        <button onClick={onRetour} className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-sm hover:bg-slate-50">← Retour au devis</button>
      </div>

      {/* Signataire client */}
      <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5">
        <div className="text-xs font-semibold text-slate-600 mb-2">Signataire client</div>
        <div className="flex flex-wrap gap-2">
          {ent.contacts.map((c, i) => (
            <button key={i} onClick={() => setContactIdx(i)}
              className={"px-3 py-2 rounded-xl border text-sm transition " + (i === contactIdx ? "bg-slate-800 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-700 hover:border-slate-400")}>
              <div className="font-semibold">{c.prenom} {c.nom}</div>
              <div className={"text-[10px] " + (i === contactIdx ? "text-slate-300" : "text-slate-400")}>{c.role} · {c.email || "⚠️ pas d'email"}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Siège */}
      <details className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5" open>
        <summary className="text-sm font-semibold cursor-pointer">🏢 Coordonnées du siège (repris dans le contrat)</summary>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label><span className={lblPF}>Raison sociale</span>
            <input className={champPF} value={ent.nom} onChange={(e) => setEnt({ ...ent, nom: e.target.value })} /></label>
          <label><span className={lblPF}>Adresse du siège</span>
            <input className={champPF} value={ent.adresse1} onChange={(e) => setEnt({ ...ent, adresse1: e.target.value })} /></label>
          <label><span className={lblPF}>Code postal</span>
            <input className={champPF} value={ent.cp} onChange={(e) => setEnt({ ...ent, cp: e.target.value })} /></label>
          <label><span className={lblPF}>Ville</span>
            <input className={champPF} value={ent.ville} onChange={(e) => setEnt({ ...ent, ville: e.target.value })} /></label>
          <label><span className={lblPF}>N° SIREN (9 chiffres)</span>
            <input className={champPF} value={ent.siren} onChange={(e) => setEnt({ ...ent, siren: e.target.value.replace(/\D/g, "").slice(0, 9) })} /></label>
          <label><span className={lblPF}>Email (mandat SEPA)</span>
            <input className={champPF} value={ct ? ct.email : ""} onChange={(e) => { const cs = ent.contacts.map((c, i) => i === contactIdx ? { ...c, email: e.target.value } : c); setEnt({ ...ent, contacts: cs }); }} /></label>
          <label><span className={lblPF}>Téléphone fixe</span>
            <input className={champPF} value={ent.telFixe} onChange={(e) => setEnt({ ...ent, telFixe: e.target.value })} /></label>
          <label><span className={lblPF}>Portable</span>
            <input className={champPF} value={ent.telPortable} onChange={(e) => setEnt({ ...ent, telPortable: e.target.value })} /></label>
        </div>
        <div className="text-[10px] text-slate-400 mt-2">IBAN et BIC du mandat SEPA : non pré-remplis — le client les saisit sur DocuSign (avec son relevé IBAN).</div>
      </details>

      {/* Livraison & interlocuteur */}
      <details className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5">
        <summary className="text-sm font-semibold cursor-pointer">🚚 Livraison & interlocuteur du site</summary>
        <div className="mt-3 space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={interlocuteurEstSignataire} onChange={(e) => setInterlocuteurEstSignataire(e.target.checked)} />
            Interlocuteur du site identique au siège du client
          </label>
          {interlocuteurEstSignataire ? (
            <div className="grid grid-cols-2 gap-3 pl-6">
              <div><span className={lblPF}>Raison sociale (recopiée du siège)</span>
                <div className={roPF}>{livrRaisonInter || "—"}</div></div>
              <div><span className={lblPF}>Adresse (recopiée du siège)</span>
                <div className={roPF}>{interAdresse || "—"}</div></div>
              <div><span className={lblPF}>Code postal et ville (recopiés du siège)</span>
                <div className={roPF}>{interCpVille || "—"}</div></div>
              <div><span className={lblPF}>Raison sociale (recopiée du siège)</span>
                <div className={roPF}>{ent.nom || "—"}</div></div>
              <div><span className={lblPF}>Adresse (recopiée du siège)</span>
                <div className={roPF}>{ent.adresse1 || "—"}</div></div>
              <div><span className={lblPF}>Code postal (recopié du siège)</span>
                <div className={roPF}>{ent.cp || "—"}</div></div>
              <div><span className={lblPF}>Ville (recopiée du siège)</span>
                <div className={roPF}>{ent.ville || "—"}</div></div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 pl-6">
              <label><span className={lblPF}>Raison sociale</span>
                <input className={champPF} value={interloc.raisonSociale} onChange={(e) => setInterloc({ ...interloc, raisonSociale: e.target.value })} /></label>
              <label><span className={lblPF}>Adresse</span>
                <input className={champPF} value={interloc.adresse1} onChange={(e) => setInterloc({ ...interloc, adresse1: e.target.value })} /></label>
              <label><span className={lblPF}>Code postal</span>
                <input className={champPF} value={interloc.cp} onChange={(e) => setInterloc({ ...interloc, cp: e.target.value })} /></label>
              <label><span className={lblPF}>Ville</span>
                <input className={champPF} value={interloc.ville} onChange={(e) => setInterloc({ ...interloc, ville: e.target.value })} /></label>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={livraisonAuSiege} onChange={(e) => setLivraisonAuSiege(e.target.checked)} />
            Livraison au siège du client
          </label>
          {livraisonAuSiege ? (
            <div className="grid grid-cols-2 gap-3 pl-6">
              <div><span className={lblPF}>Raison sociale (recopiée du siège)</span>
                <div className={roPF}>{livrRaison || "—"}</div></div>
              <div><span className={lblPF}>Adresse (recopiée du siège)</span>
                <div className={roPF}>{livrAdresse1 || "—"}</div></div>
              <div><span className={lblPF}>Code postal (recopié du siège)</span>
                <div className={roPF}>{livrCp || "—"}</div></div>
              <div><span className={lblPF}>Ville (recopiée du siège)</span>
                <div className={roPF}>{livrVille || "—"}</div></div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 pl-6">
              <label><span className={lblPF}>Raison sociale</span>
                <input className={champPF} value={livraison.raisonSociale} onChange={(e) => setLivraison({ ...livraison, raisonSociale: e.target.value })} /></label>
              <label><span className={lblPF}>Adresse</span>
                <input className={champPF} value={livraison.adresse1} onChange={(e) => setLivraison({ ...livraison, adresse1: e.target.value })} /></label>
              <label><span className={lblPF}>Code postal</span>
                <input className={champPF} value={livraison.cp} onChange={(e) => setLivraison({ ...livraison, cp: e.target.value })} /></label>
              <label><span className={lblPF}>Ville</span>
                <input className={champPF} value={livraison.ville} onChange={(e) => setLivraison({ ...livraison, ville: e.target.value })} /></label>
            </div>
          )}
          <label className="block pl-6 pt-1"><span className={lblPF}>Délai indicatif de livraison</span>
            <input className={champPF} value={delaiLivraison} onChange={(e) => setDelaiLivraison(e.target.value)} /></label>
        </div>
      </details>

      {/* Matériel — lu du devis */}
      <details className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5" open>
        <summary className="text-sm font-semibold cursor-pointer">🛵 Matériel loué — repris du devis n° {resume?.numOffre ?? "—"} (lecture seule)</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-500 border-b border-slate-200"><th className="py-1 pr-2">Désignation</th><th className="py-1">Qté</th></tr></thead>
            <tbody>
              {produits.length === 0 && <tr><td className="py-2 text-slate-400 text-xs" colSpan={2}>Aucun article dans le devis.</td></tr>}
              {produits.map((a, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-1 pr-2">{a.nom}</td>
                  <td className="py-1">{a.q}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[10px] text-slate-400 mt-2">Chaque article alimente une ligne du tableau du contrat DocuSign (jusqu'à 8 lignes). Pour modifier : corrige le devis.</div>
        </div>
      </details>

      {/* Conditions — lues du devis */}
      <details className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5" open>
        <summary className="text-sm font-semibold cursor-pointer">📋 Conditions du contrat — reprises du devis (lecture seule)</summary>
        <div className="mt-3 grid grid-cols-4 gap-3">
          <div><span className={lblPF}>Durée</span><div className={roPF}>{pfContrat.duree} mois</div></div>
          <div><span className={lblPF}>Loyer mensuel HT (devis)</span>
            <div className={roPF}>{Number(pfContrat.loyerMensuel || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} € HT</div>
            {resume?.loyerMensuelTTC ? <div className="text-[10px] text-slate-400 mt-0.5">soit {Number(resume.loyerMensuelTTC).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} € TTC</div> : null}</div>
          <div><span className={lblPF}>Frais de mise à dispo. (devis)</span>
            <div className={roPF}>{Number(pfContrat.frais || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} € HT</div></div>
          <div><span className={lblPF}>Mise en service (devis)</span>
            <div className={roPF}>{Number(pfContrat.miseService || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} € HT</div></div>
          <label><span className={lblPF}>Km annuel / produit</span>
            <input className={champPF} value={kmContrat} onChange={(e) => setKmContrat(e.target.value)} /></label>
          <label><span className={lblPF}>Dépôt de garantie (€ HT)</span>
            <input className={champPF} inputMode="decimal" value={depotGarantie} onChange={(e) => setDepotGarantie(e.target.value)} placeholder="0" /></label>
          <div><span className={lblPF}>Lieu de signature</span><div className={roPF}>LYON</div></div>
          <div className="col-span-4"><span className={lblPF}>Dont (tarif remisé de chaque article du devis)</span>
            <div className={roPF}>{texteDont || "—"}</div></div>
          <label className="col-span-2"><span className={lblPF}>Observations (libres)</span>
            <textarea className={champPF + " min-h-[60px]"} value={observations} onChange={(e) => setObservations(e.target.value)}
              disabled={renouvellement} placeholder={renouvellement ? "⚠️ Renouvellement : texte imposé (voir ci-dessous)" : "Ex. livraison groupée, conditions particulières…"} /></label>
          <div className="col-span-2">
            <label className="flex items-center gap-2 text-sm mb-2">
              <input type="checkbox" checked={renouvellement} onChange={(e) => setRenouvellement(e.target.checked)} />
              Renouvellement de contrat (texte imposé dans Observations)
            </label>
            {renouvellement && (
              <div className="space-y-2">
                <label><span className={lblPF}>N° de contrat Locam (renouvelé)</span>
                  <input className={champPF} value={numContratLocam} onChange={(e) => setNumContratLocam(e.target.value)} placeholder="Ex. 12345678" /></label>
                <div className={roPF + " text-slate-600"}>« {obsEffective} »</div>
                {!numContratLocam.trim() && <div className="text-[10px] text-amber-700">⚠️ Renseigne le n° de contrat Locam du devis.</div>}
              </div>
            )}
          </div>
        </div>
        <div className="text-[10px] text-slate-400 mt-2">Montants repris du devis en € HT (le devis est émis HT). Pour modifier les prix : corrige le devis puis reviens ici. Km annuel et observations sont modifiables ici.</div>
      </details>

      {/* Les 3 documents */}
      <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5 space-y-2">
        <h3 className="font-bold text-slate-900 mb-1">✍️ Signatures électroniques (DocuSign)</h3>
        <p className="text-xs text-slate-500 mb-3">Le Bon de commande sort rempli à 100 % (coordonnées, SIREN, livraison, matériel du devis, loyers). Les autres documents pré-remplissent les signataires.</p>
        {PF_LISTE.map((pf) => {
          const lien = pfConstruireLien(pf);
          return (
            <div key={pf.id} className={"rounded-xl border p-3 " + PF_COULEURS[pf.couleur]}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="font-semibold">
                  {pf.icone} {pf.nom}
                  {pf.complet && <span className="ml-2 text-[10px] bg-white/70 border border-white rounded-full px-2 py-0.5">✅ pré-remplissage complet</span>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setLienAffiche(lienAffiche === pf.id ? "" : pf.id)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 text-white text-sm font-semibold hover:bg-slate-900">
                    {lienAffiche === pf.id ? "✕ Masquer le lien" : "🔗 Afficher le lien"}
                  </button>
                  <button onClick={() => pfCopier(pf.id, lien)}
                    className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-sm hover:bg-slate-50">
                    {copie === pf.id ? "✓ Copié" : "Copier le lien"}
                  </button>
                </div>
              </div>
              {lienAffiche === pf.id && (
                <div className="mt-2">
                  <div className="text-[10px] text-slate-500 mb-1">Sélectionne et copie ce lien, puis ouvre-le dans un nouvel onglet :</div>
                  <input readOnly value={lien} onFocus={(e) => e.target.select()}
                    className="w-full text-[10px] font-mono border border-slate-300 rounded-lg px-2 py-1.5 bg-white" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Réglages */}
      <details className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5 text-xs">
        <summary className="cursor-pointer text-slate-600 font-semibold">⚙️ Réglages (rôles internes DocuSign)</summary>
        <div className="mt-3 grid grid-cols-2 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
          <label className="block">
            <span className="text-slate-600">Rôle commercial (remplissage + signature)</span>
            <input value={roleCommercial} onChange={(e) => setRoleCommercial(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded-lg font-mono" />
          </label>
          <label className="block">
            <span className="text-slate-600">Rôle client (signature)</span>
            <input value={roleClient} onChange={(e) => setRoleClient(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded-lg font-mono" />
          </label>
        </div>
      </details>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// APP — onglet 🧾 Devis (module réel) + onglet ✍️ DocuSign
