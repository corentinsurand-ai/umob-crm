-- Point de reprise du poller IMAP (api/poll-emails.ts) — idempotent.
-- Exécuter dans le SQL Editor du projet Supabase "umob-crm".
create table if not exists crm_poll_etat (
  id      text primary key,
  uid_max bigint not null default 0,
  maj_a   timestamptz not null default now()
);
insert into crm_poll_etat (id) values ('imap') on conflict (id) do nothing;
grant all on crm_poll_etat to service_role;
