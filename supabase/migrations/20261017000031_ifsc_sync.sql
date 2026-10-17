-- Daily IFSC sync (edge function, service role): event ids on international_results, athletes waiting for
-- an admin to confirm a match, and a run log. The two new tables are admin-only.
alter table public.international_results
  add column ifsc_event_id int,
  add column ifsc_dcat_id  int;

create table public.ifsc_pending (
  ifsc_athlete_id   int primary key,
  firstname         text not null,
  lastname          text not null,
  gender            text,
  birthday          date,
  suggested_profile uuid references public.profiles (id) on delete set null,
  score             numeric(4,2),
  status            text not null default 'pending' check (status in ('pending', 'ignored')),
  results           jsonb not null default '[]',  -- international_results insert shape minus climber_id
  first_seen        timestamptz not null default now(),
  last_seen         timestamptz not null default now()
);

create table public.ifsc_sync_runs (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null check (status in ('running', 'ok', 'failed')),
  added       int not null default 0,
  linked      int not null default 0,
  pending     int not null default 0,
  world       int not null default 0,
  error       text
);

alter table public.ifsc_pending enable row level security;
alter table public.ifsc_sync_runs enable row level security;
create policy ifsc_pending_admin on public.ifsc_pending for all
  using (public.has_role('admin')) with check (public.has_role('admin'));
create policy ifsc_sync_runs_admin on public.ifsc_sync_runs for all
  using (public.has_role('admin')) with check (public.has_role('admin'));
revoke all on public.ifsc_pending, public.ifsc_sync_runs from anon, authenticated;
grant select, insert, update, delete on public.ifsc_pending, public.ifsc_sync_runs to authenticated;
