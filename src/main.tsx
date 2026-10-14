import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import "./index.css";
import { supabase, configOk } from "./lib/supabase";
import Connexion, { Splash, EcranConfig } from "./connexion";
import App from "./App";

// Racine de l'application : écran d'attente le temps de récupérer la session,
// puis écran de connexion si nécessaire, puis le CRM lui-même.
function Racine() {
  const [session, setSession] = useState<Session | null>(null);
  const [pret, setPret] = useState(false);

  useEffect(() => {
    if (!configOk) { setPret(true); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setPret(true);
    });
    const { data: abonnement } = supabase.auth.onAuthStateChange((_evenement, s) => setSession(s));
    return () => abonnement.subscription.unsubscribe();
  }, []);

  if (!pret) return <Splash texte="Chargement du CRM…" />;
  if (!configOk) return <EcranConfig />;
  if (!session) return <Connexion />;
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Racine />
  </React.StrictMode>
);
