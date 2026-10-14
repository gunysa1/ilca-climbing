-- Lead (IFSC). Routes reuse public.boulders (a numbered problem of a round). Scoring mirrors
-- src/lib/lead.ts: per route the highest hold controlled, "+" for a controlled move past it, or TOP.
-- One route: rank by height. Several routes: per route tied climbers share the average of their
-- positions; the round score is the geometric mean of those rank points (lower is better).
-- Then countback to the start-list seed; remaining ties share. Starters without any result: unranked.

create table public.lead_results (
  boulder_id uuid not null references public.boulders (id) on delete cascade,  -- the route
  climber_id uuid not null references public.profiles (id) on delete cascade,
  round_id   uuid not null references public.rounds (id) on delete cascade,
  hold       int not null default 0 check (hold >= 0),
  plus       boolean not null default false,
  top        boolean not null default false,
  time_ms    int check (time_ms > 0),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  primary key (boulder_id, climber_id),
  check (not (top and plus))
);
create index on public.lead_results (round_id);
create index on public.lead_results (climber_id);

create table public.lead_events (
  id         bigint generated always as identity primary key,
  boulder_id uuid not null,
  climber_id uuid not null,
  round_id   uuid not null,
  hold       int not null,
  plus       boolean not null,
  top        boolean not null,
  time_ms    int,
  judge_id   uuid,
  created_at timestamptz not null default now()
);
create index on public.lead_events (round_id, created_at);

create function public.lead_results_stamp() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  select round_id into new.round_id from boulders where id = new.boulder_id;
  new.updated_by := public.my_profile_id();
  new.updated_at := now();
  insert into lead_events (boulder_id, climber_id, round_id, hold, plus, top, time_ms, judge_id)
  values (new.boulder_id, new.climber_id, new.round_id, new.hold, new.plus, new.top, new.time_ms, public.my_profile_id());
  return new;
end $$;
create trigger lead_results_stamp before insert or update on public.lead_results
  for each row execute function public.lead_results_stamp();
-- Same rule as boulder results: only climbers on the round's start list.
create trigger lead_results_check_starter after insert or update on public.lead_results
  for each row execute function public.boulder_results_check_registration();

alter table public.lead_results enable row level security;
alter table public.lead_events  enable row level security;
create policy lead_read on public.lead_results for select
  using (public.round_is_public(round_id) or public.can_judge(round_id, boulder_id) or public.has_role('admin'));
create policy lead_judge_insert on public.lead_results for insert
  with check (public.can_judge(round_id, boulder_id));
create policy lead_judge_update on public.lead_results for update
  using (public.can_judge(round_id, boulder_id)) with check (public.can_judge(round_id, boulder_id));
create policy lead_admin on public.lead_results for all
  using (public.has_role('admin')) with check (public.has_role('admin'));
create policy lead_events_admin_read on public.lead_events for select using (public.has_role('admin'));

revoke select on public.lead_results from anon, authenticated;
grant select (boulder_id, climber_id, round_id, hold, plus, top, time_ms, updated_at)
  on public.lead_results to anon, authenticated;
grant insert, update on public.lead_results to authenticated;
revoke all on public.lead_events from anon, authenticated;
grant select on public.lead_events to authenticated;
revoke execute on function public.lead_results_stamp() from public, anon, authenticated;

-- Boulder ranking only for boulder formats (lead rounds have their own view).
create or replace view public.round_scores with (security_invoker = true) as
with totals as (
  select s.climber_id, r.id as round_id, r.scoring,
         count(br.top_attempt)                              as tops,
         count(br.zone_attempt)                             as zones,
         coalesce(sum(br.top_attempt), 0)                   as top_attempts,
         coalesce(sum(br.zone_attempt), 0)                  as zone_attempts,
         coalesce(sum(public.boulder_points(br.zone_attempt, br.top_attempt)), 0)::numeric(6,1) as points,
         s.prev_place::bigint                               as prev_rank
  from public.rounds r
  join public.round_starters s on s.round_id = r.id
  left join public.boulder_results br on br.round_id = r.id and br.climber_id = s.climber_id
  where r.scoring::text in ('ifsc2025', 'classic')
  group by s.climber_id, r.id, r.scoring, s.prev_place
)
select climber_id, round_id, scoring, tops, zones, top_attempts, zone_attempts, points,
       case scoring
         when 'ifsc2025' then rank() over (partition by round_id
           order by points desc, prev_rank asc nulls last, top_attempts asc, zone_attempts asc)
         else rank() over (partition by round_id
           order by tops desc, zones desc, top_attempts asc, zone_attempts asc)
       end as rank,
       prev_rank
from totals;

create view public.lead_scores with (security_invoker = true) as
with rounds_l as (
  select r.id as round_id, (select count(*) from public.boulders b where b.round_id = r.id) as n_routes
  from public.rounds r where r.scoring::text = 'lead'
),
climbed as (  -- starters with at least one result
  select s.round_id, s.climber_id, s.prev_place
  from public.round_starters s join rounds_l rl on rl.round_id = s.round_id
  where exists (select 1 from public.lead_results x where x.round_id = s.round_id and x.climber_id = s.climber_id)
),
heights as (  -- every climbed starter on every route; no result = lowest height
  select c.round_id, c.climber_id, b.id as route_id,
         coalesce(case when lr.top then 1000000 else lr.hold * 2 + (case when lr.plus then 1 else 0 end) end, 0) as hv
  from climbed c
  join public.boulders b on b.round_id = c.round_id
  left join public.lead_results lr on lr.boulder_id = b.id and lr.climber_id = c.climber_id
),
route_points as (
  select h.*, rank() over (partition by route_id order by hv desc)
              + (count(*) over (partition by route_id, hv) - 1) / 2.0 as pts
  from heights h
),
scored as (
  select c.round_id, c.climber_id, c.prev_place, rl.n_routes,
         case when rl.n_routes = 1 then max(rp.hv)::numeric
              else round(exp(avg(ln(rp.pts)))::numeric, 9) end as points
  from climbed c
  join rounds_l rl on rl.round_id = c.round_id
  join route_points rp on rp.round_id = c.round_id and rp.climber_id = c.climber_id
  group by c.round_id, c.climber_id, c.prev_place, rl.n_routes
)
select s.climber_id, rl.round_id, rl.n_routes,
       sc.points,
       case when sc.climber_id is null then null else
         rank() over (partition by rl.round_id, sc.climber_id is null
           order by case when rl.n_routes = 1 then -sc.points else sc.points end, sc.prev_place asc nulls last)
       end as rank,
       s.prev_place::bigint as prev_rank
from rounds_l rl
join public.round_starters s on s.round_id = rl.round_id
left join scored sc on sc.round_id = s.round_id and sc.climber_id = s.climber_id;

-- One ranking per round for every discipline (start lists, history).
create view public.round_ranks with (security_invoker = true) as
select round_id, climber_id, rank from public.round_scores
union all
select round_id, climber_id, rank from public.lead_scores;

grant select on public.lead_scores, public.round_ranks to anon, authenticated;

-- History across disciplines: boulder rows as before, plus lead (result columns null except rank).
create or replace view public.climber_history with (security_invoker = true) as
select x.climber_id, co.id as competition_id, co.name as competition, co.name_he as competition_he,
       co.starts_on, c.name as category, c.name_he as category_he, r.kind as round, r.status as round_status,
       x.tops, x.zones, x.top_attempts, x.zone_attempts, x.points::numeric(6,1) as points, x.rank,
       (select count(*) from public.round_starters s2 where s2.round_id = r.id) as starters,
       r.scoring::text as discipline
from (
  select climber_id, round_id, tops, zones, top_attempts, zone_attempts, points, rank from public.round_scores
  union all
  select climber_id, round_id, null, null, null, null, null, rank from public.lead_scores
) x
join public.rounds r       on r.id = x.round_id
join public.categories c   on c.id = r.category_id
join public.competitions co on co.id = c.competition_id;

-- Start lists advance from any discipline's ranking.
create or replace function public.generate_start_list(p_round uuid) returns int
  language plpgsql security invoker set search_path = public as $$
declare prev uuid; quota int; cat uuid; n int;
begin
  select category_id, advance_quota into cat, quota from rounds where id = p_round;
  if cat is null then raise exception 'unknown round %', p_round; end if;
  if exists (select 1 from boulder_results where round_id = p_round)
     or exists (select 1 from lead_results where round_id = p_round) then
    raise exception 'round already has results; correct them instead of regenerating the start list';
  end if;
  prev := public.previous_round(p_round);
  delete from round_starters where round_id = p_round;
  if prev is null then
    insert into round_starters (round_id, climber_id, start_order)
    select p_round, climber_id, row_number() over (order by bib nulls last, climber_id)
    from registrations where category_id = cat;
  else
    insert into round_starters (round_id, climber_id, start_order, prev_place)
    select p_round, climber_id, row_number() over (order by rank desc, climber_id), rank
    from round_ranks where round_id = prev and rank is not null and (quota is null or rank <= quota);
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

-- Unregistering also respects lead results.
create or replace function public.registrations_sync_starters() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into round_starters (round_id, climber_id, start_order)
    select r.id, new.climber_id,
           coalesce(new.bib, (select coalesce(max(start_order), 0) + 1 from round_starters s where s.round_id = r.id))
    from rounds r where r.category_id = new.category_id and public.previous_round(r.id) is null
    on conflict do nothing;
    return new;
  end if;
  delete from round_starters s using rounds r
  where s.round_id = r.id and r.category_id = old.category_id and s.climber_id = old.climber_id
    and not exists (select 1 from boulder_results b where b.round_id = r.id and b.climber_id = old.climber_id)
    and not exists (select 1 from lead_results l where l.round_id = r.id and l.climber_id = old.climber_id);
  return old;
end $$;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.lead_results;
  end if;
end $$;
