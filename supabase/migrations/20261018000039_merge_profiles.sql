-- Merging two profiles of the same climber. LogLig imports and IFSC matching left some climbers as two
-- profiles (spelling variants), so their history, rankings and climber page were split. An admin picks the
-- profile to keep and the duplicate; merge_profiles() previews the merge (what moves, how the two profiles
-- differ, what stands in the way) and, when asked to apply and nothing stands in the way, moves every row of
-- the duplicate to the kept profile and deletes the duplicate, in one transaction.
--
-- What moves: every column referencing profiles(id) (found from the foreign keys, so the safety net below
-- covers new tables) plus the columns holding profile ids without a foreign key, listed in
-- private.profile_refs() (the score and lead event logs, round_totals through round_starters, the climber
-- page cache). A NEW PROFILE-ID COLUMN WITHOUT A FOREIGN KEY MUST BE ADDED TO private.profile_refs() (and
-- moved below), or merging leaves it pointing at a deleted profile. Profile fields and private data: the
-- kept profile's value wins; its empty fields are filled from the duplicate (birth date, gender, club,
-- ifsc_id, the login, ...). Pure link rows that already exist for the kept profile (a coach link, a judge
-- assignment, a dismissed IFSC result, a claim, a "not the same person" mark) are dropped instead of moved.
--
-- What refuses (a "conflict"): both profiles climbed the same round, are registered in the same category,
-- have an international result for the same event or a world-ranking row for the same season and discipline;
-- either is on the start list of a live round (judges' phones may still hold the duplicate's id); both are
-- linked to a login; they carry different IFSC ids; or any other unique key would collide (checked from the
-- unique indexes, for tables added later).
--
-- Safety net: after moving, no row anywhere may still reference the duplicate (checked from pg_constraint);
-- otherwise the merge raises, so a table added later makes merging fail instead of losing rows to the
-- cascading delete of the profile. Each merge is recorded in profile_merges (admins read it); the stored
-- report names the private fields that differed (birth date, phone, ..., login) but never their values, and
-- deleting an account (delete_account_profile) deletes the merge records of that person.
--
-- While merging, the results' stamp triggers and the ifsc_id-change trigger stand aside: moving a result is
-- not a new score (it keeps who entered it and when, and logs no score event), and the ifsc_id moving with
-- the climber is not a new IFSC athlete (keep the world-ranking rows; no "ignored" IFSC entry). They stand
-- aside only when both the transaction-local setting ilca.merging is 'on' AND private.merge_marks holds a
-- row for the current transaction. Any SQL session can set a custom setting, but only merge_profiles (as the
-- owner) can write merge_marks, so a session that sets ilca.merging by itself still gets stamped. Never add a
-- function that writes merge_marks or passes a caller-chosen setting name to set_config.
--
-- "Not the same person": profile_not_duplicates (admins) hides a pair from possible_duplicate_profiles(),
-- which also leaves out pairs that both have a login (they cannot be merged).
--
-- Caches: the statement triggers of migrations 033/036 on the moved tables queue the rankings and climber
-- page rebuilds (profiles' own triggers queue every season); the duplicate's climber page rows go at once.

-- One row per merging transaction, written and deleted only by merge_profiles (the owner).
create table private.merge_marks (xact bigint primary key);
alter table private.merge_marks enable row level security;
revoke all on private.merge_marks from public, anon, authenticated, service_role;

-- True only inside merge_profiles: the setting and this transaction's mark. Called by the definer triggers.
create function private.merging() returns boolean
  language sql stable set search_path = '' as $$
  select coalesce(current_setting('ilca.merging', true) = 'on', false)
     and exists (select 1 from private.merge_marks where xact = txid_current())
$$;
revoke all on function private.merging() from public, anon, authenticated, service_role;

create or replace function public.boulder_results_stamp() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and private.merging() then return new; end if;
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
  if tg_op = 'UPDATE' and private.merging() then return new; end if;
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
  if private.merging() then return null; end if;
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
  -- no foreign keys: the record outlives later merges (delete_account_profile deletes it with the person)
  merged_by  uuid,
  keep_id    uuid not null,
  keep_name  text not null,
  drop_id    uuid not null,
  drop_name  text not null,
  report     jsonb not null  -- private fields: names only, no values
);
alter table public.profile_merges enable row level security;
create policy profile_merges_admin_read on public.profile_merges for select using (public.has_role('admin'));
revoke all on public.profile_merges from anon, authenticated;
grant select on public.profile_merges to authenticated;

-- Pairs an admin marked as two different people (a < b): hidden from possible_duplicate_profiles().
create table public.profile_not_duplicates (
  a          uuid not null references public.profiles (id) on delete cascade,
  b          uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (a, b),
  check (a < b)
);
create index on public.profile_not_duplicates (b);
alter table public.profile_not_duplicates enable row level security;
create policy profile_not_duplicates_admin on public.profile_not_duplicates
  using (public.has_role('admin')) with check (public.has_role('admin'));
revoke all on public.profile_not_duplicates from anon, authenticated;
grant select, insert, delete on public.profile_not_duplicates to authenticated;

-- Every column holding a profile id: the foreign keys to profiles, and the columns without one (a new
-- profile-id column without a foreign key must be added here).
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
  total bigint := 0;
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
    if n > 0 then moves := moves || jsonb_build_object(r.tbl::text || '.' || r.col, n); total := total + n; end if;
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
  conflicts := conflicts || coalesce((
    select jsonb_agg(jsonb_build_object('kind', 'live_round', 'text', format('%s is on the start list of a live round: %s, %s, %s',
             p.full_name, co.name, c.name, ro.kind), 'name', p.full_name, 'competition', co.name, 'competition_he', co.name_he,
             'category', c.name, 'category_he', c.name_he, 'round', ro.kind) order by co.starts_on, c.name, ro.kind)
    from round_starters s join profiles p on p.id = s.climber_id
    join rounds ro on ro.id = s.round_id join categories c on c.id = ro.category_id join competitions co on co.id = c.competition_id
    where s.climber_id in (p_keep, p_drop) and ro.status = 'live'), '[]');
  -- Any other unique key that would collide (tables handled above or below are left out).
  for r in select * from private.profile_refs() where fk and tbl not in (
      'public.registrations'::regclass, 'public.round_starters'::regclass, 'public.boulder_results'::regclass,
      'public.lead_results'::regclass, 'public.world_rankings'::regclass, 'public.coach_athletes'::regclass,
      'public.judge_assignments'::regclass, 'public.judge_claims'::regclass, 'public.ifsc_dismissed'::regclass,
      'public.profile_private'::regclass, 'public.profile_not_duplicates'::regclass) loop
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

  report := jsonb_build_object(
    'keep', jsonb_build_object('id', k.id, 'full_name', k.full_name, 'club', k.club, 'birth_year', extract(year from kp.birth_date)),
    'drop', jsonb_build_object('id', d.id, 'full_name', d.full_name, 'club', d.club, 'birth_year', extract(year from dp.birth_date)),
    'moves', moves, 'rows', total, 'differences', diffs, 'conflicts', conflicts, 'applied', false);
  if not p_apply then return report; end if;
  if jsonb_array_length(conflicts) > 0 then
    raise exception 'cannot merge: %', (select string_agg(x ->> 'text', '; ') from jsonb_array_elements(conflicts) x)
      using detail = conflicts::text;
  end if;

  -- The stamp and ifsc_id triggers stand aside only with both the setting and this transaction's mark.
  perform set_config('ilca.merging', 'on', true);
  insert into private.merge_marks values (txid_current());

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
  begin
    update boulder_results set updated_by = p_keep where updated_by = p_drop;
    update lead_results set updated_by = p_keep where updated_by = p_drop;
  exception when raise_exception then
    -- the start-list check of a result the duplicate entered (as a judge) for a climber no longer on that list
    raise exception 'cannot merge: the duplicate entered a result for a climber who is no longer on that round''s start list; fix or delete that result first (%)', sqlerrm;
  end;
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
  -- "Not the same person" marks: the duplicate's carry over to keep (a mark between the two goes).
  delete from profile_not_duplicates where (a, b) in ((least(p_keep, p_drop), greatest(p_keep, p_drop)));
  insert into profile_not_duplicates (a, b, created_at)
  select least(o, p_keep), greatest(o, p_keep), created_at
  from (select case when a = p_drop then b else a end as o, created_at from profile_not_duplicates
        where p_drop in (a, b)) x
  on conflict do nothing;
  delete from profile_not_duplicates where p_drop in (a, b);

  -- The duplicate's climber page rows (the moved rounds are queued for rebuilding by the triggers).
  delete from climber_cache_entries where climber_id = p_drop;

  delete from private.merge_marks where xact = txid_current();
  perform set_config('ilca.merging', '', true);

  -- Safety net: nothing may still reference the duplicate.
  for r in select * from private.profile_refs() loop
    execute format('select exists (select 1 from %s where %I = $1)', r.tbl, r.col) into hit using p_drop;
    if hit then
      raise exception 'cannot merge: %.% still points at the duplicate and merging does not handle that table yet (nothing was changed)', r.tbl, r.col;
    end if;
  end loop;
  delete from profiles where id = p_drop;

  report := jsonb_set(report, '{applied}', 'true');
  -- Stored without private values: those fields only say that they differed; no birth years.
  insert into profile_merges (merged_by, keep_id, keep_name, drop_id, drop_name, report)
  values (me, p_keep, k.full_name, p_drop, d.full_name,
    report #- '{keep,birth_year}' #- '{drop,birth_year}' || jsonb_build_object('differences', (
      select coalesce(jsonb_agg(case when x ->> 'field' in ('login', 'birth_date', 'phone', 'email', 'emergency_contact', 'medical_notes')
                                     then jsonb_build_object('field', x ->> 'field', 'differed', true) else x end order by o), '[]')
      from jsonb_array_elements(report -> 'differences') with ordinality e (x, o))));
  return report;
end $$;
revoke all on function public.merge_profiles(uuid, uuid, boolean) from public, anon;
grant execute on function public.merge_profiles(uuid, uuid, boolean) to authenticated;

/** Pairs of profiles that may be one climber (admins): the same name after normalising (either name,
    English or Hebrew; case, spaces, hyphens and quote marks ignored), or the same birth date with the first and last word swapped. Left out:
    pairs that cannot be merged (different IFSC ids, both with a login) and pairs marked "not the same person". */
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
  where (pa_a.user_id is null or pa_b.user_id is null)
    and not exists (select 1 from profile_not_duplicates nd where nd.a = pa.a and nd.b = pa.b)
  order by pa.a, pa.b, pa.reason;  -- 'same_name' before 'swapped_name'
end $$;
revoke all on function public.possible_duplicate_profiles() from public, anon;
grant execute on function public.possible_duplicate_profiles() to authenticated;

-- Deleting an account (migration 032): the same, plus a "not the same person" mark does not keep a profile
-- (it goes with it), and the merge records of that person go too, following merges into merges (the log
-- names the person and how their profiles differed).
create or replace function public.delete_account_profile(p_profile uuid) returns boolean
  language plpgsql security definer set search_path = public as $$
declare
  fk record;
  used boolean;
begin
  if not exists (select 1 from profiles where id = p_profile and user_id is null) then
    return false; -- missing, or still linked to a login
  end if;
  if exists (select 1 from profile_private where id = p_profile
             and coalesce(birth_date::text, phone, emergency_contact, medical_notes, email) is not null) then
    return false;
  end if;
  for fk in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass and cardinality(c.conkey) = 1
      and c.conrelid not in ('public.profile_private'::regclass, 'public.judge_assignments'::regclass,
                             'public.judge_claims'::regclass, 'public.ifsc_pending'::regclass,
                             'public.profile_not_duplicates'::regclass)
  loop
    execute format('select exists (select 1 from %s where %I = $1)', fk.tbl, fk.col) into used using p_profile;
    if used then return false; end if;
  end loop;
  delete from profiles where id = p_profile;
  if not found then return false; end if;
  with recursive ids (id) as (
    select p_profile
    union
    select m.drop_id from profile_merges m join ids on m.keep_id = ids.id
  )
  delete from profile_merges where keep_id in (select id from ids) or drop_id in (select id from ids);
  return true;
exception when foreign_key_violation then
  return false;
end $$;
