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
// L'état complet du CRM (entreprises, contacts, deals + activités) vit dans la
// table `crm_etat`, mais SHARDÉ : la ligne `main` contient tout SAUF le tableau
// `entreprises`, réparti dans des lignes `ent-0000`, `ent-0001`, ... d'environ
// 1 Mo de JSON chacune. Raison : écrire la ligne complète (~10 Mo de jsonb)
// dépasse le statement_timeout de Postgres (erreur 57014) ; ~1 Mo passe en
// quelques centaines de ms. La lecture fusionne main + shards (dédup par id).

export interface LigneEtat {
  id: string;
  data: unknown;
  maj?: string;
}

const TAILLE_SHARD = 1_000_000; // ~1 Mo de JSON par ligne shard

function idShard(n: number): string {
  return "ent-" + String(n).padStart(4, "0");
}

function decouperShards(etat: any): { base: any; shards: { id: string; data: any }[] } {
  const ents: any[] = Array.isArray(etat?.entreprises) ? etat.entreprises : [];
  const base = { ...etat, entreprises: [] as any[] };
  const shards: { id: string; data: any }[] = [];
  let cur: any[] = [], t = 0, n = 0;
  for (const e of ents) {
    const s = JSON.stringify(e).length;
    if (cur.length && t + s > TAILLE_SHARD) {
      shards.push({ id: idShard(n), data: { entreprises: cur } });
      n++; cur = []; t = 0;
    }
    cur.push(e); t += s;
  }
  if (cur.length) shards.push({ id: idShard(n), data: { entreprises: cur } });
  return { base, shards };
}

/** Charge l'état complet du CRM (main + shards fusionnés). Retourne null si la base est encore vide. */
export async function chargerEtat(): Promise<unknown | null> {
  const { data, error } = await supabase
    .from("crm_etat")
    .select("id,data")
    .or("id.eq.main,id.like.ent-%");
  if (error) throw new Error(error.message);
  const rows = (data || []) as LigneEtat[];
  const main = rows.find((r) => r.id === "main");
  if (!main) return null;
  const etat: any = (main.data || {}) as any;
  const vus = new Set<string>();
  const ents: any[] = [];
  const ajouter = (liste: any[]) => {
    for (const e of liste || []) {
      if (e && e.id && !vus.has(e.id)) { vus.add(e.id); ents.push(e); }
    }
  };
  ajouter(Array.isArray(etat.entreprises) ? etat.entreprises : []);
  const shards = rows
    .filter((r) => r.id.startsWith("ent-"))
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const s of shards) ajouter(((s.data as any) || {}).entreprises);
  etat.entreprises = ents;
  return etat;
}

/** Sauvegarde l'état complet en shards (main + ent-NNNN), puis supprime les shards obsolètes. */
export async function sauverEtat(etat: unknown): Promise<void> {
  const { base, shards } = decouperShards(etat);
  const maj = new Date().toISOString();
  const { error: e1 } = await supabase
    .from("crm_etat")
    .upsert({ id: "main", data: base, maj });
  if (e1) throw new Error(e1.message);
  if (shards.length) {
    const res = await Promise.all(
      shards.map((s) => supabase.from("crm_etat").upsert({ id: s.id, data: s.data, maj }))
    );
    const err = res.find((r) => r.error);
    if (err && err.error) throw new Error(err.error.message);
  }
  // Ménage : supprime les shards qui ne sont plus dans la nouvelle découpe
  const { data: exist, error: e2 } = await supabase
    .from("crm_etat")
    .select("id")
    .like("id", "ent-%");
  if (!e2 && exist && exist.length) {
    const gards = new Set(shards.map((s) => s.id));
    const stale = (exist as { id: string }[]).map((x) => x.id).filter((id) => !gards.has(id));
    if (stale.length) await supabase.from("crm_etat").delete().in("id", stale);
  }
}
