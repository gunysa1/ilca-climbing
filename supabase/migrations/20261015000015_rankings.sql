-- National rankings (ILCA criteria 2025; computed in src/lib/rankings.ts):
--  * competitions.season ('2024-25') and series (which ranking an event feeds).
--  * ranking_rounds: every ranked round result with its competition's season/series and discipline.
--  * season_age_classes(): U21/U19/U17 per climber for a season, from the private birth date. Only
--    the class is exposed (the same information as the public youth categories), never the date,
--    and only for climbers with a public result that season.
--  * international_results: Israeli climbers' results abroad, entered by admins (no IFSC import).
--  * ranking_adjustments: disciplinary deductions and other published corrections.

create type public.competition_series as enum
  ('premier_league', 'premier_league_u17', 'israeli_championship', 'youth_championship', 'other');
alter table public.competitions
  add column season text check (season ~ '^\d{4}-\d{2}$'),
  add column series public.competition_series not null default 'other';

create or replace view public.ranking_rounds with (security_invoker = true) as
select co.id as competition_id, coalesce(co.name_he, co.name) as competition, co.starts_on, co.season, co.series,
       case when r.scoring::text = 'lead' then 'lead' else 'boulder' end as discipline,
       c.id as category_id, coalesce(c.name_he, c.name) as category, c.gender, r.kind as round,
       rr.climber_id, rr.rank
from public.round_ranks rr
join public.rounds r        on r.id = rr.round_id
join public.categories c    on c.id = r.category_id
join public.competitions co on co.id = c.competition_id
where co.season is not null and co.series <> 'other' and r.status <> 'planned';

create function public.season_age_classes(p_season text)
returns table (climber_id uuid, age_class text)
  language sql stable security definer set search_path = public as $$
  select p.id,
         case (left(p_season, 4)::int + 1) - extract(year from p.birth_date)::int
           when 19 then 'U21' when 20 then 'U21'
           when 17 then 'U19' when 18 then 'U19'
           when 15 then 'U17' when 16 then 'U17'
         end
  from profile_private p
  where p_season ~ '^\d{4}-\d{2}$' and p.birth_date is not null
    and (left(p_season, 4)::int + 1) - extract(year from p.birth_date)::int between 15 and 20
    -- only climbers with a public result that season
    and exists (select 1 from round_starters s
                 join rounds r on r.id = s.round_id
                 join categories c on c.id = r.category_id
                 join competitions co on co.id = c.competition_id
                 where s.climber_id = p.id and co.season = p_season and public.round_is_public(r.id));
$$;
revoke execute on function public.season_age_classes(text) from public;
grant execute on function public.season_age_classes(text) to anon, authenticated;

create type public.intl_event_type as enum ('world_cup', 'european_cup', 'european_championship',
  'european_youth_cup', 'european_youth_championship', 'world_youth_championship', 'manual');

create table public.international_results (
  id          uuid primary key default gen_random_uuid(),
  climber_id  uuid not null references public.profiles (id) on delete cascade,
  season      text not null check (season ~ '^\d{4}-\d{2}$'),
  discipline  text not null check (discipline in ('boulder', 'lead')),
  event_type  public.intl_event_type not null,
  event_name  text not null,
  starts_on   date not null,
  place       int check (place > 0),
  field_size  int check (field_size > 0),
  reached     public.round_kind not null default 'qualification',
  -- 'manual': points as published by ILCA, counted for the senior or youth ranking
  points      numeric(7,2),
  for_class   text check (for_class in ('senior', 'youth')),
  created_at  timestamptz not null default now(),
  check (event_type = 'manual' and points is not null and for_class is not null
         or event_type <> 'manual' and place is not null and field_size is not null and place <= field_size)
);
create index on public.international_results (season, discipline);

create table public.ranking_adjustments (
  id          uuid primary key default gen_random_uuid(),
  climber_id  uuid not null references public.profiles (id) on delete cascade,
  season      text not null check (season ~ '^\d{4}-\d{2}$'),
  discipline  text not null check (discipline in ('boulder', 'lead')),
  rank_class  text check (rank_class in ('senior', 'U21', 'U19', 'U17')),  -- null: every class
  points      numeric(7,2) not null,
  note        text not null,
  created_at  timestamptz not null default now()
);
create index on public.ranking_adjustments (season, discipline);

alter table public.international_results enable row level security;
alter table public.ranking_adjustments enable row level security;
create policy intl_read on public.international_results for select using (true);
create policy intl_admin on public.international_results for all
  using (public.has_role('admin')) with check (public.has_role('admin'));
create policy adjustments_read on public.ranking_adjustments for select using (true);
create policy adjustments_admin on public.ranking_adjustments for all
  using (public.has_role('admin')) with check (public.has_role('admin'));
revoke all on public.international_results, public.ranking_adjustments from anon, authenticated;
grant select on public.international_results, public.ranking_adjustments to anon, authenticated;
grant insert, update, delete on public.international_results, public.ranking_adjustments to authenticated;
