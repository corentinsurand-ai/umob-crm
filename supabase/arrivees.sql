-- ── Quarantaine des demandes entrantes (e-mails poussés par Make) ──
-- Table SÉPARÉE de crm_etat : les e-mails arrivent même pendant que
-- quelqu'un modifie le CRM (aucune écriture concurrente). La validation
-- humaine se fait dans la vue « 📥 Entrantes » du CRM.
create table if not exists public.crm_arrivees (
  id      text primary key,           -- messageId de l'e-mail (dédoublonnage)
  data    jsonb not null,             -- expéditeur, sujet, message, extraction IA
  recu_le timestamptz not null default now()
);

alter table public.crm_arrivees enable row level security;

-- Lecture : uniquement les utilisateurs connectés (la route serveur utilise
-- la service role key, qui contourne la RLS — Make n'a pas de session).
drop policy if exists "arrivees_lecture_utilisateurs" on public.crm_arrivees;
create policy "arrivees_lecture_utilisateurs" on public.crm_arrivees
  for select to authenticated using (true);

-- Suppression (valider / ignorer depuis le CRM) : utilisateurs connectés.
drop policy if exists "arrivees_suppression_utilisateurs" on public.crm_arrivees;
create policy "arrivees_suppression_utilisateurs" on public.crm_arrivees
  for delete to authenticated using (true);
