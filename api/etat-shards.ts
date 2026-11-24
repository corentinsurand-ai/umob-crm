// ── Accès shardé à l'état du CRM (table crm_etat) ────────────────────────────
// La ligne `main` contient tout l'état SAUF le tableau `entreprises`, qui est
// réparti dans des lignes `ent-0000`, `ent-0001`, ... d'environ 1 Mo de JSON
// chacune. Raison : un PATCH de la ligne complète (~10 Mo de jsonb) dépasse
// le statement_timeout de Postgres (erreur 57014) ; des écritures de ~1 Mo
// passent en quelques centaines de ms.

export const SHARD_TAILLE = 1_000_000;

export function decouperShards(etat: any): { base: any; shards: { id: string; data: any }[] } {
  const ents: any[] = Array.isArray(etat?.entreprises) ? etat.entreprises : [];
  const base = { ...etat, entreprises: [] as any[] };
  const shards: { id: string; data: any }[] = [];
  let cur: any[] = [], t = 0, n = 0;
  for (const e of ents) {
    const s = JSON.stringify(e).length;
    if (cur.length && t + s > SHARD_TAILLE) {
      shards.push({ id: "ent-" + String(n).padStart(4, "0"), data: { entreprises: cur } });
      n++; cur = []; t = 0;
    }
    cur.push(e); t += s;
  }
  if (cur.length) shards.push({ id: "ent-" + String(n).padStart(4, "0"), data: { entreprises: cur } });
  return { base, shards };
}

function baseRest(sup: string): string {
  return sup.replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
}

/** Lit main + tous les shards et renvoie l'état fusionné (dédupliqué par id). */
export async function lireEtat(sup: string, cle: string): Promise<{ etat: any; maj: string | null; nbShards: number }> {
  const base = baseRest(sup);
  const h = { apikey: cle, Authorization: `Bearer ${cle}`, "Content-Type": "application/json" };
  const r = await fetch(base + "/rest/v1/crm_etat?select=id,data,maj&or=(id.eq.main,id.like.ent-%25)", { headers: h });
  if (!r.ok) throw new Error("lecture crm_etat " + r.status + " " + (await r.text()).slice(0, 200));
  const rows: any[] = await r.json();
  const main = rows.find((x) => x.id === "main") || rows[0];
  if (!main || !main.data) throw new Error("ligne main introuvable");
  const etat: any = main.data;
  const vus = new Set<string>();
  const ents: any[] = [];
  const ajouter = (liste: any[]) => {
    for (const e of liste || []) if (e && e.id && !vus.has(e.id)) { vus.add(e.id); ents.push(e); }
  };
  ajouter(Array.isArray(etat.entreprises) ? etat.entreprises : []);
  const shards = rows.filter((x) => x.id !== "main" && String(x.id).startsWith("ent-")).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const s of shards) ajouter((s.data || {}).entreprises);
  etat.entreprises = ents;
  return { etat, maj: main.maj || null, nbShards: shards.length };
}

/** Écrit l'état en shards : PATCH de main (petit) + upsert de chaque shard + ménage. */
export async function ecrireEtat(sup: string, cle: string, etat: any): Promise<{ nbShards: number; staleSupprimes: number }> {
  const base = baseRest(sup);
  const h = { apikey: cle, Authorization: `Bearer ${cle}`, "Content-Type": "application/json" };
  const { base: baseData, shards } = decouperShards(etat);
  const maj = new Date().toISOString();
  const r = await fetch(base + "/rest/v1/crm_etat?id=eq.main", {
    method: "PATCH", headers: { ...h, Prefer: "return=minimal" },
    body: JSON.stringify({ data: baseData, maj }),
  });
  if (!r.ok) throw new Error("ecriture main " + r.status + " " + (await r.text()).slice(0, 200));
  for (const s of shards) {
    const rr = await fetch(base + "/rest/v1/crm_etat", {
      method: "POST", headers: { ...h, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id: s.id, data: s.data, maj }),
    });
    if (!rr.ok) throw new Error("ecriture shard " + s.id + " " + rr.status + " " + (await rr.text()).slice(0, 200));
  }
  const rl = await fetch(base + "/rest/v1/crm_etat?select=id&id=like.ent-%25", { headers: h });
  const exist: any[] = rl.ok ? await rl.json() : [];
  const gards = new Set(shards.map((s) => s.id));
  const stale = exist.map((x) => x.id).filter((id) => !gards.has(id));
  if (stale.length) {
    const rd = await fetch(base + '/rest/v1/crm_etat?id=in.("' + stale.join('","') + '")', { method: "DELETE", headers: h });
    if (!rd.ok) throw new Error("cleanup shards " + rd.status);
  }
  return { nbShards: shards.length, staleSupprimes: stale.length };
}
