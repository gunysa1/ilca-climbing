-- Security fixes from the 2026-11-10 audit (run-1):
-- 1. Ranking identity is admin-curated. A signed-in account linked to a profile could change its own
--    birth date (age class U17/U19/U21, senior minimum age) and gender (which ranking table) through the
--    self-update policies of migration 002, and so move itself between national ranking tables. Like
--    ifsc_id (031), birth_date, gender and the public name now change only by an admin (or the database
--    owner: merge_profiles, imports). Climbers keep editing their club, country and contact details.
-- 2. claim_climber only holds starters: a judge could put any profile id "on the wall" of their boulder.
-- 3. link_account refuses a profile that another login already holds (it silently replaced that link);
--    unlink it first. The admin picker only offers unlinked profiles.

create function public.identity_admin_only_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') and not public.has_role('admin') then
    if tg_table_name = 'profile_private' then
      if new.birth_date is distinct from old.birth_date then
        raise exception 'only admins change a birth date' using errcode = 'insufficient_privilege';
      end if;
    elsif new.gender is distinct from old.gender or new.full_name is distinct from old.full_name
          or new.full_name_he is distinct from old.full_name_he then
      raise exception 'only admins change a name or gender' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.identity_admin_only_guard() from public, anon, authenticated;
create trigger profiles_identity_guard before update of gender, full_name, full_name_he on public.profiles
  for each row execute function public.identity_admin_only_guard();
create trigger profile_private_identity_guard before update of birth_date on public.profile_private
  for each row execute function public.identity_admin_only_guard();

create or replace function public.claim_climber(p_round uuid, p_boulder uuid, p_climber uuid)
returns table (judge_id uuid, judge_name text, claimed_at timestamptz)
  language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_profile_id();
begin
  if not public.can_judge(p_round, p_boulder) then
    raise exception 'not a judge of this boulder' using errcode = '42501';
  end if;
  if not exists (select 1 from round_starters s where s.round_id = p_round and s.climber_id = p_climber) then
    raise exception 'not on the start list of this round' using errcode = '42501';
  end if;
  insert into judge_claims as c (boulder_id, climber_id, round_id, judge_id, claimed_at)
  values (p_boulder, p_climber, p_round, me, now())
  on conflict (boulder_id, climber_id) do update set judge_id = me, claimed_at = now(),
    on_wall_since = case when c.judge_id = me then c.on_wall_since end
    where c.judge_id = me or c.claimed_at < now() - interval '30 seconds';
  return query
  select c.judge_id, p.full_name, c.claimed_at from judge_claims c join profiles p on p.id = c.judge_id
  where c.boulder_id = p_boulder and c.climber_id = p_climber;
end $$;

create or replace function public.link_account(p_profile uuid, p_user uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare
  own uuid;
  ref record;
  used boolean;
begin
  if not public.has_role('admin') then
    raise exception 'only admins can link accounts' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'unknown account %', p_user;
  end if;
  if not exists (select 1 from profiles where id = p_profile) then
    raise exception 'unknown profile %', p_profile;
  end if;
  select id into own from profiles where user_id = p_user;
  if own = p_profile then return; end if;
  if exists (select 1 from profiles where id = p_profile and user_id is not null) then
    raise exception 'profile % is linked to another account: unlink it first', p_profile;
  end if;
  if own is not null then
    if exists (select 1 from profile_private where id = own
               and coalesce(birth_date::text, phone, emergency_contact, medical_notes) is not null) then
      raise exception 'account % already has a profile with data', p_user;
    end if;
    for ref in
      select r.tbl, r.col from private.profile_refs() r
      where r.tbl not in ('public.profile_private'::regclass, 'public.judge_claims'::regclass,
                          'public.climber_cache_entries'::regclass, 'public.ifsc_pending'::regclass,
                          'public.profile_not_duplicates'::regclass, 'public.client_errors'::regclass)
    loop
      execute format('select exists (select 1 from %s where %I = $1)', ref.tbl, ref.col) into used using own;
      if used then
        raise exception 'account % already has a profile with data (%.%)', p_user, ref.tbl, ref.col;
      end if;
    end loop;
    update client_errors set profile_id = p_profile where profile_id = own;
    delete from profiles where id = own;
  end if;
  update profiles set user_id = p_user where id = p_profile;
end $$;
