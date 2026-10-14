import React, { useEffect, useState } from "react";
import { supabase, configOk } from "./lib/supabase";

/* ════════════════════════════════════════════════════════════════════════════════
   Écrans d'entrée du CRM :
   - ÉcranConfig   : .env manquant (installation incomplète)
   - Splash        : petit écran d'attente
   - Connexion     : e-mail + mot de passe (Supabase Auth), avec création de
                    compte pour la première utilisation
   ════════════════════════════════════════════════════════════════════════════════ */

const logo = (
  <div className="flex h-12 w-12 items-center justify-center rounded-2xl text-[20px] font-black text-white"
    style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>U'</div>
);

export function Splash({ texte }: { texte: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-100">
      {logo}
      <div className="text-[13px] font-bold text-slate-500">{texte}</div>
    </div>
  );
}

export function EcranConfig() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-100 px-4">
      {logo}
      <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow">
        <div className="mb-2 text-[15px] font-black text-slate-800">Configuration manquante</div>
        <p className="text-[13px] leading-relaxed text-slate-500">
          Les variables <b>Supabase</b> ne sont pas encore définies. Suis le <b>README</b> du
          projet : créer un projet Supabase, exécuter <b>supabase/schema.sql</b>, puis remplir
          le fichier <b>.env</b> (à partir de <b>.env.example</b>).
        </p>
      </div>
    </div>
  );
}

export default function Connexion() {
  const [mode, setMode] = useState<"connexion" | "inscription">("connexion");
  const [email, setEmail] = useState("");
  const [mdp, setMdp] = useState("");
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [occupe, setOccupe] = useState(false);

  // Anti-rebond : si on arrive déjà connecté, on ne reste pas sur cet écran.
  useEffect(() => { setInfo(""); setErreur(""); }, [mode]);

  const envoyer = async (e: React.FormEvent) => {
    e.preventDefault();
    setOccupe(true); setErreur(""); setInfo("");
    const { error } = mode === "connexion"
      ? await supabase.auth.signInWithPassword({ email: email.trim(), password: mdp })
      : await supabase.auth.signUp({ email: email.trim(), password: mdp });
    setOccupe(false);
    if (error) {
      const m = error.message.toLowerCase();
      if (m.includes("invalid login")) setErreur("E-mail ou mot de passe incorrect.");
      else if (m.includes("already registered")) setErreur("Ce compte existe déjà — passe en mode Connexion.");
      else if (m.includes("at least 6")) setErreur("Le mot de passe doit faire au moins 6 caractères.");
      else if (m.includes("signup") && m.includes("disabled")) setErreur("Les inscriptions sont désactivées — demande un accès à l'administrateur.");
      else setErreur(error.message);
    } else if (mode === "inscription") {
      setInfo("Compte créé ! Si un e-mail de confirmation est demandé par Supabase, clique dedans puis connecte-toi.");
    }
  };

  const motDePasseOublie = async () => {
    if (!email.trim()) { setErreur("Saisis d'abord ton e-mail, puis clique ici."); return; }
    setOccupe(true); setErreur(""); setInfo("");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    setOccupe(false);
    if (error) setErreur(error.message);
    else setInfo("E-mail de réinitialisation envoyé — regarde ta boîte (et tes spams).");
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-slate-100 px-4">
      {logo}
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow">
        <div className="mb-1 text-center text-[16px] font-black text-slate-800">CRM U'mob</div>
        <div className="mb-5 text-center text-[11px] font-bold uppercase tracking-wider text-slate-400">
          {mode === "connexion" ? "Connexion" : "Créer mon compte"}
        </div>
        {!configOk && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
            ⚠️ Configuration Supabase manquante (fichier .env) — la connexion ne fonctionnera pas.
          </div>
        )}
        <form onSubmit={envoyer} className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-bold text-slate-500">E-mail</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-cyan-500"
              placeholder="toi@umob.fr" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold text-slate-500">Mot de passe</label>
            <input type="password" required value={mdp} onChange={(e) => setMdp(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-cyan-500"
              placeholder="••••••••" />
          </div>
          {erreur && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-600">{erreur}</div>}
          {info && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-medium text-emerald-700">{info}</div>}
          <button type="submit" disabled={occupe}
            className="w-full rounded-xl py-2.5 text-[13px] font-black text-white transition-opacity disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#57c26b,#4f9ee8)" }}>
            {occupe ? "Un instant…" : mode === "connexion" ? "Se connecter" : "Créer mon compte"}
          </button>
        </form>
        <div className="mt-4 flex items-center justify-between text-[11px] font-bold text-slate-400">
          <button onClick={() => setMode(mode === "connexion" ? "inscription" : "connexion")}
            className="text-cyan-600 hover:underline">
            {mode === "connexion" ? "Première fois ? Créer mon compte" : "J'ai déjà un compte"}
          </button>
          {mode === "connexion" && <button onClick={motDePasseOublie} className="hover:underline">Mot de passe oublié</button>}
        </div>
      </div>
      <div className="max-w-sm text-center text-[10px] leading-relaxed text-slate-400">
        Accès réservé à l'équipe U'mob. Chaque modification est enregistrée dans la base de données (Supabase).
      </div>
    </div>
  );
}
