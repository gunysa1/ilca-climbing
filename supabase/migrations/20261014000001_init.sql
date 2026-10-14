-- ILCA climbing app: core schema, role isolation (RLS) and climber history.
--
-- Roles
--   climber : sees own private data + own history; never writes scores
--   coach   : sees private data + history of linked athletes; writes coach notes
--   judge   : writes results only for rounds/boulders assigned to them, only while the round is live
--   admin   : manages competitions, roles, assignments
--   anon    : published results only (no private data, no judge identities)

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('climber', 'coach', 'judge', 'admin');
create type public.competition_status as enum ('draft', 'published', 'finished');
create type public.round_kind as enum ('qualification', 'semifinal', 'final');
create type public.round_status as enum ('planned', 'live', 'closed');
create type public.scoring_format as enum ('ifsc2025', 'classic');
create type public.gender as enum ('female', 'male', 'mixed');

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

-- Public profile: what results pages show.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null,
  full_name_he text,
  gender      public.gender,
  club        text,
  country     text not null default 'ISR',
  ifsc_id     text,
  created_at  timestamptz not null default now()
);

-- Private profile: visible to the climber, their linked coaches and admins only.
create table public.profile_private (
  id          uuid primary key references public.profiles (id) on delete cascade,
  birth_date  date,
  phone       text,
  emergency_contact text,
  medical_notes text,
  updated_at  timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role    public.app_role not null,
  primary key (user_id, role)
);

create table public.coach_athletes (
  coach_id   uuid not null references public.profiles (id) on delete cascade,
  climber_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (coach_id, climber_id),
  check (coach_id <> climber_id)
);

create table public.coach_notes (
  id          uuid primary key default gen_random_uuid(),
  coach_id    uuid not null references public.profiles (id) on delete cascade,
  climber_id  uuid not null references public.profiles (id) on delete cascade,
  competition_id uuid,
  body        text not null check (length(body) between 1 and 5000),
  shared_with_climber boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Competitions
-- ---------------------------------------------------------------------------
create table public.competitions (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  name_he    text,
  venue      text,
  starts_on  date not null,
  ends_on    date not null,
  status     public.competition_status not null default 'draft',
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

alter table public.coach_notes
  add constraint coach_notes_competition_fk
  foreign key (competition_id) references public.competitions (id) on delete set null;

create table public.categories (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  name           text not null,          -- e.g. "U16 Women"
  name_he        text,
  gender         public.gender not null
);

create table public.rounds (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id) on delete cascade,
  kind        public.round_kind not null,
  status      public.round_status not null default 'planned',
  scoring     public.scoring_format not null default 'ifsc2025',
  unique (category_id, kind)
);

create table public.boulders (
  id       uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds (id) on delete cascade,
  number   int not null check (number > 0),
  unique (round_id, number)
);

create table public.registrations (
  category_id uuid not null references public.categories (id) on delete cascade,
  climber_id  uuid not null references public.profiles (id) on delete cascade,
  bib         int,
  primary key (category_id, climber_id)
);

-- Judge scope: a whole round (boulder_id null) or one boulder.
create table public.judge_assignments (
  id         uuid primary key default gen_random_uuid(),
  round_id   uuid not null references public.rounds (id) on delete cascade,
  boulder_id uuid references public.boulders (id) on delete cascade,
  judge_id   uuid not null references public.profiles (id) on delete cascade,
  unique nulls not distinct (round_id, boulder_id, judge_id)
);

-- One row per climber per boulder. attempts = attempts made so far;
-- zone_attempt / top_attempt = attempt number on which it was reached.
create table public.boulder_results (
  boulder_id   uuid not null references public.boulders (id) on delete cascade,
  climber_id   uuid not null references public.profiles (id) on delete cascade,
  round_id     uuid not null references public.rounds (id) on delete cascade,
  attempts     int not null default 0 check (attempts >= 0),
  zone_attempt int,
  top_attempt  int,
  updated_by   uuid references public.profiles (id),
  updated_at   timestamptz not null default now(),
  primary key (boulder_id, climber_id),
  check (zone_attempt between 1 and attempts),
  check (top_attempt between 1 and attempts),
  -- a top implies the zone was reached on or before the same attempt
  check (top_attempt is null or (zone_attempt is not null and zone_attempt <= top_attempt))
);

-- Append-only audit trail of every score change (who/when/what).
create table public.score_events (
  id           bigint generated always as identity primary key,
  boulder_id   uuid not null,
  climber_id   uuid not null,
  round_id     uuid not null,
  attempts     int not null,
  zone_attempt int,
  top_attempt  int,
  judge_id     uuid,
  created_at   timestamptz not null default now()
);

create index on public.boulder_results (round_id);
create index on public.boulder_results (climber_id);
create index on public.judge_assignments (judge_id);
create index on public.coach_athletes (climber_id);
create index on public.coach_notes (climber_id);
create index on public.score_events (round_id, created_at);

-- ---------------------------------------------------------------------------
-- Helper predicates (security definer so policies don't recurse through RLS)
-- ---------------------------------------------------------------------------
create function public.has_role(r public.app_role) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = auth.uid() and role = r);
$$;

create function public.is_coach_of(climber uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from coach_athletes where coach_id = auth.uid() and climber_id = climber)
     and public.has_role('coach');
$$;

create function public.can_judge(r_id uuid, b_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.has_role('judge')
     and exists (select 1 from rounds where id = r_id and status = 'live')
     and exists (select 1 from boulders where id = b_id and round_id = r_id)
     and exists (
       select 1 from judge_assignments ja
       where ja.judge_id = auth.uid() and ja.round_id = r_id
         and (ja.boulder_id is null or ja.boulder_id = b_id));
$$;

create function public.round_is_public(r_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from rounds r
    join categories c on c.id = r.category_id
    join competitions co on co.id = c.competition_id
    where r.id = r_id and co.status <> 'draft' and r.status <> 'planned');
$$;

create function public.competition_is_public(c_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from competitions where id = c_id and status <> 'draft');
$$;

revoke all on function public.has_role, public.is_coach_of, public.can_judge,
  public.round_is_public, public.competition_is_public from public;
grant execute on function public.has_role, public.is_coach_of, public.can_judge,
  public.round_is_public, public.competition_is_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Stamp the judge, keep round_id consistent with the boulder, log the change.
create function public.boulder_results_stamp() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  select round_id into new.round_id from boulders where id = new.boulder_id;
  new.updated_by := auth.uid();
  new.updated_at := now();
  insert into score_events (boulder_id, climber_id, round_id, attempts, zone_attempt, top_attempt, judge_id)
  values (new.boulder_id, new.climber_id, new.round_id, new.attempts, new.zone_attempt, new.top_attempt, auth.uid());
  return new;
end $$;

create trigger boulder_results_stamp
  before insert or update on public.boulder_results
  for each row execute function public.boulder_results_stamp();

-- Climbers may only be scored if registered in the round's category.
create function public.boulder_results_check_registration() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from rounds r join registrations g on g.category_id = r.category_id
    where r.id = new.round_id and g.climber_id = new.climber_id) then
    raise exception 'climber % is not registered for this round', new.climber_id;
  end if;
  return new;
end $$;

create trigger boulder_results_check_registration
  after insert or update on public.boulder_results
  for each row execute function public.boulder_results_check_registration();

-- New auth user -> profile + default climber role.
create function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)));
  insert into profile_private (id) values (new.id);
  insert into user_roles (user_id, role) values (new.id, 'climber');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.profile_private   enable row level security;
alter table public.user_roles        enable row level security;
alter table public.coach_athletes    enable row level security;
alter table public.coach_notes       enable row level security;
alter table public.competitions      enable row level security;
alter table public.categories        enable row level security;
alter table public.rounds            enable row level security;
alter table public.boulders          enable row level security;
alter table public.registrations     enable row level security;
alter table public.judge_assignments enable row level security;
alter table public.boulder_results   enable row level security;
alter table public.score_events      enable row level security;

-- profiles: public names; self edit; admin all
create policy profiles_read on public.profiles for select using (true);
create policy profiles_self_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin on public.profiles for all
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- profile_private: self, linked coach (read), admin
create policy private_self_read on public.profile_private for select
  using (id = auth.uid() or public.is_coach_of(id) or public.has_role('admin'));
create policy private_self_update on public.profile_private for update
  using (id = auth.uid()) with check (id = auth.uid());
create policy private_admin on public.profile_private for all
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- user_roles: users see their own roles; only admins change roles
create policy roles_self_read on public.user_roles for select
  using (user_id = auth.uid() or public.has_role('admin'));
create policy roles_admin on public.user_roles for all
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- coach_athletes: the coach, the climber and admins see the link; admins manage it
create policy coach_links_read on public.coach_athletes for select
  using (coach_id = auth.uid() or climber_id = auth.uid() or public.has_role('admin'));
create policy coach_links_admin on public.coach_athletes for all
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- coach_notes: author coach full control on own athletes; climber reads shared notes
create policy notes_coach on public.coach_notes for all
  using (coach_id = auth.uid() and public.is_coach_of(climber_id))
  with check (coach_id = auth.uid() and public.is_coach_of(climber_id));
create policy notes_climber_read on public.coach_notes for select
  using (climber_id = auth.uid() and shared_with_climber);

-- competition structure: public once published; admins manage
create policy competitions_read on public.competitions for select
  using (status <> 'draft' or public.has_role('admin') or public.has_role('judge'));
create policy competitions_admin on public.competitions for all
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy categories_read on public.categories for select
  using (public.competition_is_public(competition_id) or public.has_role('admin') or public.has_role('judge'));
create policy categories_admin on public.categories for all
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy rounds_read on public.rounds for select
  using (exists (select 1 from public.categories c where c.id = category_id));
create policy rounds_admin on public.rounds for all
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy boulders_read on public.boulders for select
  using (exists (select 1 from public.rounds r where r.id = round_id));
create policy boulders_admin on public.boulders for all
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy registrations_read on public.registrations for select
  using (exists (select 1 from public.categories c where c.id = category_id));
create policy registrations_admin on public.registrations for all
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- judge_assignments: the judge sees their own; admins manage
create policy assignments_read on public.judge_assignments for select
  using (judge_id = auth.uid() or public.has_role('admin'));
create policy assignments_admin on public.judge_assignments for all
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- boulder_results: anyone reads public rounds; assigned judges write live rounds
create policy results_read on public.boulder_results for select
  using (public.round_is_public(round_id) or public.can_judge(round_id, boulder_id)
         or public.has_role('admin'));
create policy results_judge_insert on public.boulder_results for insert
  with check (public.can_judge(round_id, boulder_id));
create policy results_judge_update on public.boulder_results for update
  using (public.can_judge(round_id, boulder_id))
  with check (public.can_judge(round_id, boulder_id));
create policy results_admin on public.boulder_results for all
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- score_events: audit visible to admins only; written by trigger (security definer)
create policy events_admin_read on public.score_events for select
  using (public.has_role('admin'));

-- Column-level privacy: hide who scored a result from everyone but admins/judges.
revoke select on public.boulder_results from anon, authenticated;
grant select (boulder_id, climber_id, round_id, attempts, zone_attempt, top_attempt, updated_at)
  on public.boulder_results to anon, authenticated;
grant insert, update on public.boulder_results to authenticated;

-- ---------------------------------------------------------------------------
-- Scoring and history
-- ---------------------------------------------------------------------------

-- IFSC 2025 boulder points: top 25, zone 10, minus 0.1 per failed attempt
-- before the highest hold reached.
create function public.boulder_points(zone_attempt int, top_attempt int) returns numeric
  language sql immutable as $$
  select case
    when top_attempt  is not null then 25 - 0.1 * (top_attempt - 1)
    when zone_attempt is not null then 10 - 0.1 * (zone_attempt - 1)
    else 0 end::numeric(5,1);
$$;

-- Per climber per round totals + rank (ties share a rank).
create view public.round_scores with (security_invoker = true) as
with totals as (
  select g.climber_id, r.id as round_id, r.scoring,
         count(br.top_attempt)                              as tops,
         count(br.zone_attempt)                             as zones,
         coalesce(sum(br.top_attempt), 0)                   as top_attempts,
         coalesce(sum(br.zone_attempt), 0)                  as zone_attempts,
         coalesce(sum(public.boulder_points(br.zone_attempt, br.top_attempt)), 0)::numeric(6,1) as points
  from public.rounds r
  join public.registrations g on g.category_id = r.category_id
  left join public.boulder_results br on br.round_id = r.id and br.climber_id = g.climber_id
  group by g.climber_id, r.id, r.scoring
)
select t.*,
       case t.scoring
         when 'ifsc2025' then rank() over (partition by t.round_id order by t.points desc)
         else rank() over (partition by t.round_id
                           order by t.tops desc, t.zones desc, t.top_attempts asc, t.zone_attempts asc)
       end as rank
from totals t;

-- Climber history across competitions.
create view public.climber_history with (security_invoker = true) as
select rs.climber_id, co.id as competition_id, co.name as competition, co.name_he as competition_he,
       co.starts_on, c.name as category, c.name_he as category_he, r.kind as round, r.status as round_status,
       rs.tops, rs.zones, rs.top_attempts, rs.zone_attempts, rs.points, rs.rank,
       (select count(*) from public.registrations g2 where g2.category_id = c.id) as starters
from public.round_scores rs
join public.rounds r       on r.id = rs.round_id
join public.categories c   on c.id = r.category_id
join public.competitions co on co.id = c.competition_id;

grant select on public.round_scores, public.climber_history to anon, authenticated;

-- Realtime: live results stream
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.boulder_results;
  end if;
end $$;
