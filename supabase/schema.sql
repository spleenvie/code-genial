-- Genzy Dashboard — schéma Supabase
-- Exécuter dans : Supabase → SQL Editor → New query

create table if not exists dashboard_state (
  id text primary key default 'main',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into dashboard_state (id, data)
values ('main', '{"clients":[],"agencyTasks":{}}'::jsonb)
on conflict (id) do nothing;

alter table dashboard_state enable row level security;

drop policy if exists "genzy_select" on dashboard_state;
drop policy if exists "genzy_update" on dashboard_state;
drop policy if exists "genzy_insert" on dashboard_state;

create policy "genzy_select" on dashboard_state for select using (true);
create policy "genzy_update" on dashboard_state for update using (true);
create policy "genzy_insert" on dashboard_state for insert with check (true);

alter publication supabase_realtime add table dashboard_state;
