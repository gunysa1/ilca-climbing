-- Daily IFSC sync (edge function, service role): event ids on international_results, athletes waiting for
-- an admin to confirm a match, IFSC results an admin deleted (never imported again), and a run log. The three
-- new tables are admin-only.
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

create table public.ifsc_dismissed (
  climber_id    uuid not null references public.profiles (id) on delete cascade,
  ifsc_event_id int not null,
  ifsc_dcat_id  int not null,
  dismissed_at  timestamptz not null default now(),
  primary key (climber_id, ifsc_event_id, ifsc_dcat_id)
);

alter table public.ifsc_pending enable row level security;
alter table public.ifsc_sync_runs enable row level security;
alter table public.ifsc_dismissed enable row level security;
create policy ifsc_pending_admin on public.ifsc_pending for all
  using (public.has_role('admin')) with check (public.has_role('admin'));
create policy ifsc_sync_runs_admin on public.ifsc_sync_runs for all
  using (public.has_role('admin')) with check (public.has_role('admin'));
create policy ifsc_dismissed_admin on public.ifsc_dismissed for all
  using (public.has_role('admin')) with check (public.has_role('admin'));
revoke all on public.ifsc_pending, public.ifsc_sync_runs, public.ifsc_dismissed from anon, authenticated;
grant select, insert, update, delete on public.ifsc_pending, public.ifsc_sync_runs, public.ifsc_dismissed to authenticated;

-- profiles.ifsc_id now decides whose IFSC results the sync imports: only admins (or the sync's service
-- role) set it, and one IFSC athlete is one profile.
create function public.profiles_ifsc_id_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.ifsc_id is distinct from (case when tg_op = 'UPDATE' then old.ifsc_id end)
     and current_user in ('anon', 'authenticated') and not public.has_role('admin') then
    raise exception 'only admins set ifsc_id' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
revoke execute on function public.profiles_ifsc_id_guard() from public, anon, authenticated;
create trigger profiles_ifsc_id_guard before insert or update of ifsc_id on public.profiles
  for each row execute function public.profiles_ifsc_id_guard();
create unique index profiles_ifsc_id_key on public.profiles (ifsc_id) where ifsc_id is not null;
