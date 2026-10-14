import { createClient } from "@supabase/supabase-js";

// ── Client Supabase (base de données + connexion) ──────────────────────────
// Les 2 valeurs viennent du fichier .env (voir .env.example + README).
// Ce sont des valeurs PUBLIQUES par design : la sécurité des données repose
// sur les Row Level Security de Supabase (voir supabase/schema.sql), jamais
// sur le secret de ces clés.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || "";
const cle = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || "";

// Vrai uniquement si le .env est bien rempli. Sinon, l'application affiche
// un écran « configuration manquante » au lieu de planter en silence.
export const configOk = url.startsWith("http") && cle.length > 20;

export const supabase = createClient(url || "http://localhost", cle || "cle-manquante", {
  auth: { persistSession: true, autoRefreshToken: true },
});

// ── Couche de données du CRM ───────────────────────────────────────────────
// Toute la base (entreprises, contacts, deals + activités) vit dans UNE
// ligne de la table `crm_etat` (colonne data jsonb). C'est le même format
// que la démo : chaque modification est renvoyée vers Supabase après un
// court délai, et l'état est rechargé à chaque ouverture du CRM.

export interface LigneEtat {
  id: string;
  data: unknown;
  maj?: string;
}

/** Charge l'état complet du CRM. Retourne null si la base est encore vide. */
export async function chargerEtat(): Promise<unknown | null> {
  const { data, error } = await supabase
    .from("crm_etat")
    .select("data")
    .eq("id", "main")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? (data as LigneEtat).data : null;
}

/** Sauvegarde l'état complet (upsert : crée la ligne si absente). */
export async function sauverEtat(etat: unknown): Promise<void> {
  const { error } = await supabase
    .from("crm_etat")
    .upsert({ id: "main", data: etat, maj: new Date().toISOString() });
  if (error) throw new Error(error.message);
}
