-- link_account: "the account's own profile holds data" now comes from the profile-id inventory
-- (private.profile_refs(), migration 040: every foreign key to profiles plus the profile-id columns without
-- one), not a hand-written list. The list of migration 002 missed the newer tables (lead_results, lead_events,
-- international_results, ranking_adjustments, world_rankings, appeals, client_errors, ...), so linking could
-- delete a profile with such rows (cascading them away). A new table referencing profiles counts by itself.
-- Not data: the private row (it goes with the profile) unless it holds more than the account's email, the
-- judge pad's 30-second claims, the climber page cache, IFSC match suggestions and "not the same person"
-- marks (as delete_account_profile, migration 040, which also lets judge assignments go; here they count).
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
  if own is not null then
    if exists (select 1 from profile_private where id = own
               and coalesce(birth_date::text, phone, emergency_contact, medical_notes) is not null) then
      raise exception 'account % already has a profile with data', p_user;
    end if;
    for ref in
      select r.tbl, r.col from private.profile_refs() r
      where r.tbl not in ('public.profile_private'::regclass, 'public.judge_claims'::regclass,
                          'public.climber_cache_entries'::regclass, 'public.ifsc_pending'::regclass,
                          'public.profile_not_duplicates'::regclass)
    loop
      execute format('select exists (select 1 from %s where %I = $1)', ref.tbl, ref.col) into used using own;
      if used then
        raise exception 'account % already has a profile with data (%.%)', p_user, ref.tbl, ref.col;
      end if;
    end loop;
    delete from profiles where id = own;
  end if;
  update profiles set user_id = p_user where id = p_profile;
end $$;
