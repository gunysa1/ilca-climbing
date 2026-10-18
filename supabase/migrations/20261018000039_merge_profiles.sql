-- Merging two profiles of the same climber. LogLig imports and IFSC matching left some climbers as two
-- profiles (spelling variants), so their history, rankings and climber page were split. An admin picks the
-- profile to keep and the duplicate; merge_profiles() previews the merge (what moves, how the two profiles
-- differ, what stands in the way) and, when asked to apply and nothing stands in the way, moves every row of
-- the duplicate to the kept profile and deletes the duplicate, in one transaction.
--
-- What moves: every column referencing profiles(id) (found from the foreign keys, so the safety net below
-- covers new tables) plus the columns holding profile ids without a foreign key (the score and lead event
-- logs, round_totals through round_starters, the climber page cache). Profile fields and private data: the
-- kept profile's value wins; its empty fields are filled from the duplicate (birth date, gender, club,
-- ifsc_id, the login, ...). Pure link rows that already exist for the kept profile (a coach link, a judge
-- assignment, a dismissed IFSC result, a claim) are dropped instead of moved.
--
-- What refuses (a "conflict"): both profiles climbed the same round, are registered in the same category,
-- have an international result for the same event or a world-ranking row for the same season and discipline;
-- both are linked to a login; they carry different IFSC ids; or any other unique key would collide (checked
-- from the unique indexes, for tables added later).
--
-- Safety net: after moving, no row anywhere may still reference the duplicate (checked from pg_constraint);
-- otherwise the merge raises, so a table added later makes merging fail instead of losing rows to the
-- cascading delete of the profile. Each merge is recorded in profile_merges (admins read it).
--
-- While merging, the results' stamp triggers and the ifsc_id-change trigger stand aside (setting
-- ilca.merging, local to the transaction; clients cannot set settings through the API): moving a result is
-- not a new score (it keeps who entered it and when, and logs no score event), and the ifsc_id moving with
-- the climber is not a new IFSC athlete (keep the world-ranking rows; no "ignored" IFSC entry).
--
-- Caches: the statement triggers of migrations 033/036 on the moved tables queue the rankings and climber
-- page rebuilds (profiles' own triggers queue every season); the duplicate's climber page rows go at once.

create or replace function public.boulder_results_stamp() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and current_setting('ilca.merging', true) = 'on' then return new; end if;
  select round_id into new.round_id from boulders where id = new.boulder_id;
  new.updated_by := public.my_profile_id();
  new.updated_at := now();
  insert into score_events (boulder_id, climber_id, round_id, attempts, zone_attempt, top_attempt, judge_id)
  values (new.boulder_id, new.climber_id, new.round_id, new.attempts, new.zone_attempt, new.top_attempt,
          public.my_profile_id());
  return new;
end $$;

create or replace function public.lead_results_stamp() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and current_setting('ilca.merging', true) = 'on' then return new; end if;
  select round_id into new.round_id from boulders where id = new.boulder_id;
  new.updated_by := public.my_profile_id();
  new.updated_at := now();
  insert into lead_events (boulder_id, climber_id, round_id, hold, plus, top, time_ms, judge_id)
  values (new.boulder_id, new.climber_id, new.round_id, new.hold, new.plus, new.top, new.time_ms, public.my_profile_id());
  return new;
end $$;

-- Same as migration 037, except while merging.
create or replace function public.profiles_ifsc_id_changed() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Jerusalem')::date;
  y int := extract(year from today)::int - case when extract(month from today) < 9 then 1 else 0 end;
begin
  if current_setting('ilca.merging', true) = 'on' then return null; end if;
  delete from public.world_rankings
    where climber_id = new.id and season = y || '-' || lpad(((y + 1) % 100)::text, 2, '0');
  if old.ifsc_id is not null then
    insert into public.ifsc_pending (ifsc_athlete_id, firstname, lastname, status)
      values (old.ifsc_id::int, 'IFSC', '#' || old.ifsc_id, 'ignored')
      on conflict (ifsc_athlete_id) do update set status = 'ignored', suggested_profile = null, score = null;
  end if;
  return null;
end $$;

create table public.profile_merges (
  id         uuid primary key default gen_random_uuid(),
  merged_at  timestamptz not null default now(),
  -- no foreign keys: the record outlives later merges and deleted accounts
  merged_by  uuid,
  keep_id    uuid not null,
  keep_name  text not null,
  drop_id    uuid not null,
  drop_name  text not null,
  report     jsonb not null
);
alter table public.profile_merges enable row level security;
create policy profile_merges_admin_read on public.profile_merges for select using (public.has_role('admin'));
revoke all on public.profile_merges from anon, authenticated;
grant select on public.profile_merges to authenticated;

-- Every column holding a profile id: the foreign keys to profiles, and the columns without one.
create function private.profile_refs() returns table (tbl regclass, col name, fk boolean)
  language sql stable set search_path = public as $$
  select c.conrelid::regclass, a.attname, true
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass
  union all
  select t::regclass, x::name, false
  from (values ('public.score_events', 'climber_id'), ('public.score_events', 'judge_id'),
               ('public.lead_events', 'climber_id'), ('public.lead_events', 'judge_id'),
               ('public.round_totals', 'climber_id'), ('public.climber_cache_entries', 'climber_id')) v (t, x)
$$;
revoke all on function private.profile_refs() from public, anon, authenticated;

-- A name's words as compared for duplicates: lower case, without ' " ׳ ״, split at spaces and hyphens
-- ("Ben-David" = "Ben David"). profile_name_key: the words joined without spaces ("BenDavid" matches too).
create function private.profile_name_words(p text) returns text[]
  language sql immutable set search_path = public as $$
  select coalesce(array_agg(w order by o), '{}')
  from regexp_split_to_table(lower(translate(coalesce(p, ''), '''"׳״', '')), '[\s-]+') with ordinality t (w, o)
  where w <> ''
$$;
create function private.profile_name_key(p text) returns text
  language sql immutable set search_path = public as $$
  select nullif(array_to_string(private.profile_name_words(p), ''), '')
$$;
revoke all on function private.profile_name_words(text), private.profile_name_key(text) from public, anon, authenticated;

/** Merge profile p_drop into p_keep (admins). Returns the report: rows moving per table.column, the profile
    fields that differ, the conflicts and whether it was applied. p_apply = false: preview, nothing changes.
    p_apply = true: raises when there are conflicts (no change), else merges and deletes p_drop. */
create function public.merge_profiles(p_keep uuid, p_drop uuid, p_apply boolean default false) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  k profiles;
  d profiles;
  kp profile_private;
  dp profile_private;
  r record;
  ix record;
  n bigint;
  hit boolean;
  cond text;
  moves jsonb := '{}';
  diffs jsonb := '[]';
  conflicts jsonb := '[]';
  report jsonb;
  me uuid := public.my_profile_id();
begin
  if not public.has_role('admin') then
    raise exception 'only admins merge profiles' using errcode = 'insufficient_privilege';
  end if;
  if p_keep is null or p_drop is null or p_keep = p_drop then
    raise exception 'pick two different profiles';
  end if;
  if p_apply then
    perform 1 from profiles where id in (p_keep, p_drop) order by id for update;
  end if;
  select * into k from profiles where id = p_keep;
  if not found then raise exception 'unknown profile %', p_keep; end if;
  select * into d from profiles where id = p_drop;
  if not found then raise exception 'unknown profile %', p_drop; end if;
  select * into kp from profile_private where id = p_keep;
  select * into dp from profile_private where id = p_drop;

  -- What moves
  for r in select * from private.profile_refs() loop
    execute format('select count(*) from %s where %I = $1', r.tbl, r.col) into n using p_drop;
    if n > 0 then moves := moves || jsonb_build_object(r.tbl::text || '.' || r.col, n); end if;
  end loop;

  -- How the profiles differ: [{field, keep, drop, result}]
  select coalesce(jsonb_agg(jsonb_build_object('field', f, 'keep', kv, 'drop', dv, 'result', coalesce(kv, dv)) order by o), '[]')
  into diffs
  from (values
      (1, 'full_name', k.full_name, d.full_name),
      (2, 'full_name_he', k.full_name_he, d.full_name_he),
      (3, 'gender', k.gender::text, d.gender::text),
      (4, 'club', k.club, d.club),
      (5, 'country', k.country, d.country),
      (6, 'ifsc_id', k.ifsc_id, d.ifsc_id),
      (7, 'login', (select email from auth.users where id = k.user_id), (select email from auth.users where id = d.user_id)),
      (8, 'birth_date', kp.birth_date::text, dp.birth_date::text),
      (9, 'phone', kp.phone, dp.phone),
      (10, 'email', kp.email, dp.email),
      (11, 'emergency_contact', kp.emergency_contact, dp.emergency_contact),
      (12, 'medical_notes', kp.medical_notes, dp.medical_notes)) v (o, f, kv, dv)
  where kv is distinct from dv;

  -- Conflicts: [{kind, text, ...names}]
  if k.user_id is not null and d.user_id is not null then
    conflicts := conflicts || jsonb_build_object('kind', 'two_logins', 'text', 'both profiles are linked to a login');
  end if;
  if k.ifsc_id is not null and d.ifsc_id is not null and k.ifsc_id <> d.ifsc_id then
    conflicts := conflicts || jsonb_build_object('kind', 'different_ifsc', 'text',
      format('different IFSC ids (%s, %s)', k.ifsc_id, d.ifsc_id), 'keep', k.ifsc_id, 'drop', d.ifsc_id);
  end if;
  conflicts := conflicts || coalesce((
    select jsonb_agg(jsonb_build_object('kind', 'round', 'text', format('both climbed %s, %s, %s', co.name, c.name, ro.kind),
             'competition', co.name, 'competition_he', co.name_he, 'category', c.name, 'category_he', c.name_he,
             'round', ro.kind) order by co.starts_on, c.name, ro.kind)
    from rounds ro join categories c on c.id = ro.category_id join competitions co on co.id = c.competition_id
    where ro.id in (
      select a.round_id from round_starters a join round_starters b using (round_id)
        where a.climber_id = p_keep and b.climber_id = p_drop
      union select a.round_id from boulder_results a join boulder_results b using (round_id)
        where a.climber_id = p_keep and b.climber_id = p_drop
      union select a.round_id from lead_results a join lead_results b using (round_id)
        where a.climber_id = p_keep and b.climber_id = p_drop)), '[]');
  conflicts := conflicts || coalesce((
    select jsonb_agg(jsonb_build_object('kind', 'registration', 'text', format('both are registered in %s, %s', co.name, c.name),
             'competition', co.name, 'competition_he', co.name_he, 'category', c.name, 'category_he', c.name_he)
             order by co.starts_on, c.name)
    from registrations a join registrations b using (category_id)
    join categories c on c.id = a.category_id join competitions co on co.id = c.competition_id
    where a.climber_id = p_keep and b.climber_id = p_drop), '[]');
  conflicts := conflicts || coalesce((
    select jsonb_agg(jsonb_build_object('kind', 'international', 'text', format('both have a result for %s (%s)', b.event_name, b.starts_on),
             'event', b.event_name, 'date', b.starts_on, 'season', b.season, 'discipline', b.discipline) order by b.starts_on)
    from international_results a join international_results b
      on (a.ifsc_event_id = b.ifsc_event_id and a.ifsc_dcat_id = b.ifsc_dcat_id)
      or (a.season = b.season and a.discipline = b.discipline and a.starts_on = b.starts_on
          and private.profile_name_key(a.event_name) = private.profile_name_key(b.event_name))
    where a.climber_id = p_keep and b.climber_id = p_drop), '[]');
  conflicts := conflicts || coalesce((
    select jsonb_agg(jsonb_build_object('kind', 'world_ranking', 'text', format('both have a world ranking for %s %s', b.season, b.discipline),
             'season', b.season, 'discipline', b.discipline) order by b.season, b.discipline)
    from world_rankings a join world_rankings b using (season, discipline)
    where a.climber_id = p_keep and b.climber_id = p_drop), '[]');
  -- Any other unique key that would collide (tables handled above or below are left out).
  for r in select * from private.profile_refs() where fk and tbl not in (
      'public.registrations'::regclass, 'public.round_starters'::regclass, 'public.boulder_results'::regclass,
      'public.lead_results'::regclass, 'public.world_rankings'::regclass, 'public.coach_athletes'::regclass,
      'public.judge_assignments'::regclass, 'public.judge_claims'::regclass, 'public.ifsc_dismissed'::regclass,
      'public.profile_private'::regclass) loop
    for ix in
      select i.indexrelid, i.indkey::int2[] as keys, i.indnullsnotdistinct as nnd
      from pg_index i join pg_attribute a on a.attrelid = r.tbl and a.attname = r.col
      where i.indrelid = r.tbl and i.indisunique and i.indpred is null and a.attnum = any(i.indkey::int2[])
        and not 0 = any(i.indkey::int2[])
    loop
      select coalesce(string_agg(format(case when ix.nnd then 'k.%1$I is not distinct from x.%1$I' else 'k.%1$I = x.%1$I' end,
               a.attname), ' and '), 'true')
      into cond
      from unnest(ix.keys) u (attnum) join pg_attribute a on a.attrelid = r.tbl and a.attnum = u.attnum
      where a.attname <> r.col;
      execute format('select exists (select 1 from %1$s x join %1$s k on %2$s where x.%3$I = $1 and k.%3$I = $2)', r.tbl, cond, r.col)
        into hit using p_drop, p_keep;
      if hit then
        conflicts := conflicts || jsonb_build_object('kind', 'unique', 'text',
          format('%s: both have a row with the same %s', r.tbl, ix.indexrelid::regclass), 'table', r.tbl::text);
      end if;
    end loop;
  end loop;

  report := jsonb_build_object('keep', jsonb_build_object('id', k.id, 'full_name', k.full_name),
    'drop', jsonb_build_object('id', d.id, 'full_name', d.full_name),
    'moves', moves, 'differences', diffs, 'conflicts', conflicts, 'applied', false);
  if not p_apply then return report; end if;
  if jsonb_array_length(conflicts) > 0 then
    raise exception 'cannot merge: %', (select string_agg(x ->> 'text', '; ') from jsonb_array_elements(conflicts) x)
      using detail = conflicts::text;
  end if;

  perform set_config('ilca.merging', 'on', true);

  -- The profile: the login and IFSC id leave the duplicate first (both are unique), then keep's empty fields fill.
  update profiles set user_id = null, ifsc_id = null where id = p_drop;
  update profiles set full_name_he = coalesce(k.full_name_he, d.full_name_he), gender = coalesce(k.gender, d.gender),
    club = coalesce(k.club, d.club), ifsc_id = coalesce(k.ifsc_id, d.ifsc_id), user_id = coalesce(k.user_id, d.user_id)
  where id = p_keep;
  if dp.id is not null then
    insert into profile_private (id, birth_date, phone, emergency_contact, medical_notes, email)
    values (p_keep, dp.birth_date, dp.phone, dp.emergency_contact, dp.medical_notes, dp.email)
    on conflict (id) do update set
      birth_date = coalesce(profile_private.birth_date, excluded.birth_date),
      phone = coalesce(profile_private.phone, excluded.phone),
      emergency_contact = coalesce(profile_private.emergency_contact, excluded.emergency_contact),
      medical_notes = coalesce(profile_private.medical_notes, excluded.medical_notes),
      email = coalesce(profile_private.email, excluded.email);
    delete from profile_private where id = p_drop;
  end if;

  -- Competitions. round_totals references round_starters (round_id, climber_id) and results need a starter,
  -- so the kept climber's starter rows come first and the duplicate's go last.
  update registrations set climber_id = p_keep where climber_id = p_drop;
  insert into round_starters (round_id, climber_id, start_order, prev_place, group_label)
  select round_id, p_keep, start_order, prev_place, group_label from round_starters where climber_id = p_drop;
  update round_totals set climber_id = p_keep where climber_id = p_drop;
  update boulder_results set climber_id = p_keep where climber_id = p_drop;
  update lead_results set climber_id = p_keep where climber_id = p_drop;
  delete from round_starters where climber_id = p_drop;
  update boulder_results set updated_by = p_keep where updated_by = p_drop;
  update lead_results set updated_by = p_keep where updated_by = p_drop;
  update score_events set climber_id = p_keep where climber_id = p_drop;
  update score_events set judge_id = p_keep where judge_id = p_drop;
  update lead_events set climber_id = p_keep where climber_id = p_drop;
  update lead_events set judge_id = p_keep where judge_id = p_drop;
  update appeals set climber_id = p_keep where climber_id = p_drop;
  update appeal_details set created_by = p_keep where created_by = p_drop;
  update appeal_details set resolved_by = p_keep where resolved_by = p_drop;

  -- Judging and coaching links (an existing identical link of keep wins).
  delete from judge_assignments x where x.judge_id = p_drop and exists (select 1 from judge_assignments y
    where y.judge_id = p_keep and y.round_id = x.round_id and y.boulder_id is not distinct from x.boulder_id);
  update judge_assignments set judge_id = p_keep where judge_id = p_drop;
  delete from judge_claims x where x.climber_id = p_drop and exists (select 1 from judge_claims y
    where y.climber_id = p_keep and y.boulder_id = x.boulder_id);
  update judge_claims set climber_id = p_keep where climber_id = p_drop;
  update judge_claims set judge_id = p_keep where judge_id = p_drop;
  delete from coach_athletes where (coach_id, climber_id) in ((p_keep, p_drop), (p_drop, p_keep));  -- a link between the two
  delete from coach_athletes x where x.coach_id = p_drop and exists (select 1 from coach_athletes y
    where y.coach_id = p_keep and y.climber_id = x.climber_id);
  update coach_athletes set coach_id = p_keep where coach_id = p_drop;
  delete from coach_athletes x where x.climber_id = p_drop and exists (select 1 from coach_athletes y
    where y.climber_id = p_keep and y.coach_id = x.coach_id);
  update coach_athletes set climber_id = p_keep where climber_id = p_drop;
  update coach_notes set coach_id = p_keep where coach_id = p_drop;
  update coach_notes set climber_id = p_keep where climber_id = p_drop;

  -- Rankings inputs and IFSC
  update international_results set climber_id = p_keep where climber_id = p_drop;
  update ranking_adjustments set climber_id = p_keep where climber_id = p_drop;
  update world_rankings set climber_id = p_keep where climber_id = p_drop;
  update ifsc_pending set suggested_profile = p_keep where suggested_profile = p_drop;
  delete from ifsc_dismissed x where x.climber_id = p_drop and exists (select 1 from ifsc_dismissed y
    where y.climber_id = p_keep and y.ifsc_event_id = x.ifsc_event_id and y.ifsc_dcat_id = x.ifsc_dcat_id);
  update ifsc_dismissed set climber_id = p_keep where climber_id = p_drop;

  -- The duplicate's climber page rows (the moved rounds are queued for rebuilding by the triggers).
  delete from climber_cache_entries where climber_id = p_drop;

  perform set_config('ilca.merging', '', true);

  -- Safety net: nothing may still reference the duplicate.
  for r in select * from private.profile_refs() loop
    execute format('select exists (select 1 from %s where %I = $1)', r.tbl, r.col) into hit using p_drop;
    if hit then
      raise exception 'merge_profiles: %.% still references the duplicate; merging does not handle that table yet', r.tbl, r.col;
    end if;
  end loop;
  delete from profiles where id = p_drop;

  report := jsonb_set(report, '{applied}', 'true');
  insert into profile_merges (merged_by, keep_id, keep_name, drop_id, drop_name, report)
  values (me, p_keep, k.full_name, p_drop, d.full_name, report);
  return report;
end $$;
revoke all on function public.merge_profiles(uuid, uuid, boolean) from public, anon;
grant execute on function public.merge_profiles(uuid, uuid, boolean) to authenticated;

/** Pairs of profiles that may be one climber (admins): the same name after normalising (either name,
    English or Hebrew; case, spaces, hyphens and quote marks ignored), or the same birth date with the first and last word swapped. Pairs that cannot be
    merged because of different IFSC ids are left out. */
create function public.possible_duplicate_profiles()
returns table (a uuid, a_name text, b uuid, b_name text, reason text)
  language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('admin') then
    raise exception 'only admins see possible duplicates' using errcode = 'insufficient_privilege';
  end if;
  return query
  with names as (
    select distinct p.id, p.ifsc_id, pp.birth_date, x.key, x.words
    from profiles p
    left join profile_private pp on pp.id = p.id
    cross join lateral (select private.profile_name_key(n), private.profile_name_words(n)
                        from (values (p.full_name), (p.full_name_he)) v (n)) x (key, words)
    where x.key is not null
  ), pairs as (
    select x.id as a, y.id as b, 'same_name' as reason
    from names x join names y on y.key = x.key and x.id < y.id
    where x.ifsc_id is null or y.ifsc_id is null or x.ifsc_id = y.ifsc_id
    union
    select x.id, y.id, 'swapped_name'
    from names x join names y on y.birth_date = x.birth_date and x.id < y.id
    where cardinality(x.words) >= 2 and cardinality(y.words) >= 2
      and x.words[1] = y.words[cardinality(y.words)] and x.words[cardinality(x.words)] = y.words[1]
      and x.key <> y.key
      and (x.ifsc_id is null or y.ifsc_id is null or x.ifsc_id = y.ifsc_id)
  )
  select distinct on (pa.a, pa.b) pa.a, pa_a.full_name, pa.b, pa_b.full_name, pa.reason
  from pairs pa join profiles pa_a on pa_a.id = pa.a join profiles pa_b on pa_b.id = pa.b
  order by pa.a, pa.b, pa.reason;  -- 'same_name' before 'swapped_name'
end $$;
revoke all on function public.possible_duplicate_profiles() from public, anon;
grant execute on function public.possible_duplicate_profiles() to authenticated;
