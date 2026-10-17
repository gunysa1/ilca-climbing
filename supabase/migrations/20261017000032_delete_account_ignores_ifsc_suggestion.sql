-- An IFSC sync suggestion (ifsc_pending.suggested_profile, on delete set null) is only a guess for an admin:
-- it does not keep a profile when its account is deleted. Same function as migration 024 otherwise.
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
                             'public.judge_claims'::regclass, 'public.ifsc_pending'::regclass)
  loop
    execute format('select exists (select 1 from %s where %I = $1)', fk.tbl, fk.col) into used using p_profile;
    if used then return false; end if;
  end loop;
  delete from profiles where id = p_profile;
  return found;
exception when foreign_key_violation then
  return false;
end $$;
