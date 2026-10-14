-- Per-round start lists, advancement and age classes (parity with the temporary ILCA app).
--  * round_starters: who climbs in a round, in which order, with their previous-round place (seed).
--    First rounds of a category follow registrations automatically; later rounds are built with
--    generate_start_list() from the previous round's ranking (top advance_quota, ties at the cutoff
--    included, worst-ranked climber starts first).
--  * Countback reads the stored seed, so imported rounds can carry seeds and the ranking no longer
--    depends on recomputing earlier rounds.
--  * registrations.age_class: sub-category (U19, U21, ...) of a climber competing in a combined
--    category, like the temporary app's category groups.

alter table public.registrations add column age_class text;
alter table public.rounds add column advance_quota int check (advance_quota > 0);

create table public.round_starters (
  round_id    uuid not null references public.rounds (id) on delete cascade,
  climber_id  uuid not null references public.profiles (id) on delete cascade,
  start_order int,
  prev_place  int check (prev_place > 0),
  primary key (round_id, climber_id)
);
create index on public.round_starters (climber_id);

alter table public.round_starters enable row level security;
create policy starters_read on public.round_starters for select
  using (exists (select 1 from public.rounds r where r.id = round_id));
create policy starters_admin on public.round_starters for all
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- The previous round of a round (latest earlier kind in the same category), or null.
create function public.previous_round(r_id uuid) returns uuid
  language sql stable security definer set search_path = public as $$
  select p.id from rounds r join rounds p on p.category_id = r.category_id and p.kind < r.kind
  where r.id = r_id order by p.kind desc limit 1;
$$;

-- Existing rounds: everyone registered starts (that was the previous behavior).
insert into public.round_starters (round_id, climber_id, start_order)
select r.id, g.climber_id, row_number() over (partition by r.id order by g.bib nulls last, g.climber_id)
from public.rounds r join public.registrations g on g.category_id = r.category_id;

-- Registrations keep first rounds in sync. Unregistering removes the climber from rounds of the
-- category where they have no results yet.
create function public.registrations_sync_starters() returns trigger
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
    and not exists (select 1 from boulder_results b where b.round_id = r.id and b.climber_id = old.climber_id);
  return old;
end $$;
create trigger registrations_sync_starters
  after insert or delete on public.registrations
  for each row execute function public.registrations_sync_starters();

-- A new first round picks up the category's registrations.
create function public.rounds_seed_starters() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if public.previous_round(new.id) is null then
    insert into round_starters (round_id, climber_id, start_order)
    select new.id, g.climber_id, row_number() over (order by g.bib nulls last, g.climber_id)
    from registrations g where g.category_id = new.category_id
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger rounds_seed_starters
  after insert on public.rounds
  for each row execute function public.rounds_seed_starters();

-- Results only for climbers on the round's start list.
create or replace function public.boulder_results_check_registration() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from round_starters s where s.round_id = new.round_id and s.climber_id = new.climber_id) then
    raise exception 'climber % is not on the start list of this round', new.climber_id;
  end if;
  return new;
end $$;

-- Ranking from the start list; countback uses the stored seed.
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

-- Field size = starters of the round (was: registrations of the category).
create or replace view public.climber_history with (security_invoker = true) as
select rs.climber_id, co.id as competition_id, co.name as competition, co.name_he as competition_he,
       co.starts_on, c.name as category, c.name_he as category_he, r.kind as round, r.status as round_status,
       rs.tops, rs.zones, rs.top_attempts, rs.zone_attempts, rs.points, rs.rank,
       (select count(*) from public.round_starters s2 where s2.round_id = r.id) as starters
from public.round_scores rs
join public.rounds r       on r.id = rs.round_id
join public.categories c   on c.id = r.category_id
join public.competitions co on co.id = c.competition_id;

-- Admin: build a round's start list. First round: all registrations by bib. Later rounds: the top
-- advance_quota of the previous round (all if null; ties at the cutoff advance), seeded with their
-- place, worst-ranked first. Refused once the round has results. security invoker: admin RLS applies.
create function public.generate_start_list(p_round uuid) returns int
  language plpgsql security invoker set search_path = public as $$
declare prev uuid; quota int; cat uuid; n int;
begin
  select category_id, advance_quota into cat, quota from rounds where id = p_round;
  if cat is null then raise exception 'unknown round %', p_round; end if;
  if exists (select 1 from boulder_results where round_id = p_round) then
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
    from round_scores where round_id = prev and (quota is null or rank <= quota);
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.generate_start_list(uuid), public.registrations_sync_starters(),
  public.rounds_seed_starters() from public, anon;
revoke execute on function public.registrations_sync_starters(), public.rounds_seed_starters() from authenticated;
grant execute on function public.generate_start_list(uuid) to authenticated;
grant execute on function public.previous_round(uuid) to anon, authenticated;

-- Roster import also carries the age class.
create or replace function public.import_roster(
  p_categories jsonb, p_profiles jsonb, p_private jsonb, p_registrations jsonb
) returns void
  language plpgsql security invoker set search_path = public as $$
begin
  insert into categories (id, competition_id, name, name_he, gender)
  select id, competition_id, name, name_he, gender from jsonb_populate_recordset(null::categories, p_categories);

  insert into profiles (id, full_name, full_name_he, club, gender)
  select id, full_name, full_name_he, club, gender from jsonb_populate_recordset(null::profiles, p_profiles);

  insert into profile_private (id, birth_date, email)
  select id, birth_date, email from jsonb_populate_recordset(null::profile_private, p_private);

  insert into registrations (category_id, climber_id, bib, age_class)
  select category_id, climber_id, bib, age_class from jsonb_populate_recordset(null::registrations, p_registrations);
end $$;
