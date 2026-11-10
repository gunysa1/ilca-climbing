-- Merging two categories of one competition (start-list tools): a category with too few climbers is merged into
-- another before the event. An admin picks the category to keep and the one to merge into it; merge_categories()
-- previews the merge (who moves, what stands in the way) and, when asked to apply and nothing stands in the way,
-- moves every registration of the dropped category to the kept one and deletes the dropped category, in one
-- transaction. Shaped like merge_profiles (migration 040): report {keep, drop, moving, conflicts, applied};
-- conflicts are [{kind, text, ...}] with the names for the app's own he/en text and an English `text`.
--
-- What refuses (a "conflict"): the same category twice; an unknown category; categories of different
-- competitions; any result (boulder_results, lead_results, round_totals) in a round of either category - merge
-- before the event; a climber registered in both; a bib used in both.
--
-- What moves: each registration of drop is deleted and inserted into keep with every column (copied whole).
-- The registrations trigger (registrations_sync_starters, migration 008) takes the climber off drop's first
-- round and puts them on keep's first round (start_order = bib, else after the last), one at a time in drop's
-- start order, so climbers without a bib keep their relative order. An empty age_class gets drop's name
-- (Hebrew, else English), so the merged climbers can still be told apart on the round page (its age-class
-- chips); registrations.age_class is display only: the national rankings take age classes from birth dates
-- (season_age_classes, migration 015) and categories from the category name, never from registrations.
-- Then drop is deleted: its rounds, boulders, start lists and judge assignments go with it (cascade); the
-- admin_log keeps one "categories delete" row (cascaded rounds are not logged, migration 049).
--
-- Caches: the statement triggers of migrations 033/036 on registrations / round_starters / categories queue
-- the rankings and climber page rebuilds.

create function public.merge_categories(p_keep uuid, p_drop uuid, p_apply boolean default false) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  k categories;
  d categories;
  conflicts jsonb := '[]';
  moving jsonb;
  report jsonb;
  mv record;
  fill text;
begin
  if not public.has_role('admin') then
    raise exception 'only admins merge categories' using errcode = 'insufficient_privilege';
  end if;
  if p_apply then
    -- Serialize with result entry and registration changes: results and registrations take key-share locks
    -- on their round / boulder / category rows, which these row locks block until the merge commits.
    perform 1 from categories where id in (p_keep, p_drop) order by id for update;
    perform 1 from rounds where category_id in (p_keep, p_drop) order by id for update;
    perform 1 from boulders b join rounds r on r.id = b.round_id where r.category_id in (p_keep, p_drop) order by b.id for update of b;
  end if;
  select * into k from categories where id = p_keep;
  select * into d from categories where id = p_drop;
  fill := coalesce(d.name_he, d.name);

  if p_keep is null or p_drop is null or p_keep = p_drop then
    conflicts := conflicts || jsonb_build_object('kind', 'same', 'text', 'pick two different categories');
  elsif k.id is null or d.id is null then
    conflicts := conflicts || jsonb_build_object('kind', 'unknown', 'text', 'unknown category');
  else
    if k.competition_id <> d.competition_id then
      conflicts := conflicts || jsonb_build_object('kind', 'other_competition', 'text', 'the categories belong to different competitions');
    end if;
    conflicts := conflicts || coalesce((
      select jsonb_agg(jsonb_build_object('kind', 'results', 'text', format('%s already has results', c.name),
               'category', c.name, 'category_he', c.name_he) order by c.id = p_drop, c.name)
      from categories c
      where c.id in (p_keep, p_drop) and exists (
        select 1 from rounds r where r.category_id = c.id and (
          exists (select 1 from boulder_results x where x.round_id = r.id)
          or exists (select 1 from lead_results x where x.round_id = r.id)
          or exists (select 1 from round_totals x where x.round_id = r.id)))), '[]');
    conflicts := conflicts || coalesce((
      select jsonb_agg(jsonb_build_object('kind', 'both_registered', 'text', format('%s is registered in both categories', p.full_name),
               'name', p.full_name, 'name_he', p.full_name_he) order by p.full_name)
      from registrations a join registrations b using (climber_id) join profiles p on p.id = a.climber_id
      where a.category_id = p_keep and b.category_id = p_drop), '[]');
    conflicts := conflicts || coalesce((
      select jsonb_agg(jsonb_build_object('kind', 'same_bib', 'text', format('bib %s is used in both categories (%s, %s)', a.bib, pa.full_name, pb.full_name),
               'bib', a.bib, 'keep_name', pa.full_name, 'keep_name_he', pa.full_name_he, 'drop_name', pb.full_name, 'drop_name_he', pb.full_name_he)
               order by a.bib)
      from registrations a join registrations b using (bib)
      join profiles pa on pa.id = a.climber_id join profiles pb on pb.id = b.climber_id
      where a.category_id = p_keep and b.category_id = p_drop and a.climber_id <> b.climber_id), '[]');
  end if;

  -- Who moves, in drop's first-round start order (then bib), with the age class each will have.
  select coalesce(jsonb_agg(jsonb_build_object('climber_id', x.climber_id, 'full_name', x.full_name, 'full_name_he', x.full_name_he,
           'bib', x.bib, 'age_class', x.age_class) order by x.o), '[]')
  into moving
  from (
    select g.climber_id, p.full_name, p.full_name_he, g.bib, coalesce(g.age_class, fill) as age_class,
           row_number() over (order by s.start_order nulls last, g.bib nulls last, p.full_name, g.climber_id) as o
    from registrations g join profiles p on p.id = g.climber_id
    left join round_starters s on s.climber_id = g.climber_id
      and s.round_id = (select r.id from rounds r where r.category_id = p_drop and public.previous_round(r.id) is null limit 1)
    where g.category_id = p_drop and p_keep is distinct from p_drop) x;

  report := jsonb_build_object(
    'keep', case when k.id is not null then jsonb_build_object('id', k.id, 'name', k.name, 'name_he', k.name_he, 'gender', k.gender) end,
    'drop', case when d.id is not null then jsonb_build_object('id', d.id, 'name', d.name, 'name_he', d.name_he, 'gender', d.gender,
              'rounds', (select count(*) from rounds where category_id = p_drop)) end,
    'moving', moving, 'conflicts', conflicts, 'applied', false);
  if not p_apply then return report; end if;
  if jsonb_array_length(conflicts) > 0 then
    raise exception 'cannot merge: %', (select string_agg(x ->> 'text', '; ') from jsonb_array_elements(conflicts) x)
      using detail = conflicts::text;
  end if;

  -- One at a time, so each climber without a bib starts after the ones moved before.
  -- The row is copied whole (a registrations column added later moves too); only category and age class change.
  for mv in
    select to_jsonb(r) as j
    from registrations r cross join jsonb_array_elements(moving) with ordinality m (x, o)
    where r.category_id = p_drop and r.climber_id = (m.x ->> 'climber_id')::uuid
    order by m.o
  loop
    delete from registrations where category_id = p_drop and climber_id = (mv.j ->> 'climber_id')::uuid;
    insert into registrations
    select (jsonb_populate_record(null::registrations, mv.j || jsonb_build_object('category_id', p_keep,
      'age_class', coalesce(mv.j ->> 'age_class', fill)))).*;
  end loop;
  delete from categories where id = p_drop;

  return jsonb_set(report, '{applied}', 'true');
end $$;
revoke all on function public.merge_categories(uuid, uuid, boolean) from public, anon;
grant execute on function public.merge_categories(uuid, uuid, boolean) to authenticated;
