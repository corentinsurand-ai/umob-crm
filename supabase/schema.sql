-- ═══════════════════════════════════════════════════════════════════════════
-- CRM U'mob — schéma de la base de données Supabase
--
-- Mode d'emploi (une seule fois, 2 minutes) :
--   1. Ouvre https://supabase.com → ton projet → bouton « SQL Editor »
--   2. « New query » → colle TOUT ce fichier → bouton « Run »
--
-- Sécurité : seuls les comptes créés dans Authentication → Users peuvent
-- lire et écrire les données (Row Level Security). Personne d'autre n'a accès.
-- ═══════════════════════════════════════════════════════════════════════════

-- La table unique du CRM : l'état complet (entreprises + contacts + deals +
-- activités) est stocké en une ligne, colonne jsonb. C'est volontairement
-- simple : le format est identique à la démo, et l'application sauvegarde
-- automatiquement à chaque modification.
create table if not exists public.crm_etat (
  id   text primary key,            -- toujours 'main' (une seule ligne)
  data jsonb not null,              -- l'état complet du CRM
  maj  timestamptz not null default now()  -- date de dernière sauvegarde
);

-- Active la sécurité au niveau des lignes : par défaut, tout est interdit.
alter table public.crm_etat enable row level security;

-- Lecture : uniquement les utilisateurs connectés (authentifiés).
drop policy if exists "crm_lecture_utilisateurs" on public.crm_etat;
create policy "crm_lecture_utilisateurs" on public.crm_etat
  for select to authenticated using (true);

-- Écriture (insert / update / delete) : uniquement les utilisateurs connectés.
drop policy if exists "crm_ecriture_utilisateurs" on public.crm_etat;
create policy "crm_ecriture_utilisateurs" on public.crm_etat
  for all to authenticated using (true) with check (true);
