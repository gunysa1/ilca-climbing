-- Deleting an account from the staff app (edge function delete-account, service role). The login is
-- deleted in Supabase Auth: its roles go with it and profiles.user_id is set null, so a climber's
-- profile, results and history always stay. The account's own profile is removed only when it has
-- no climbing data at all (e.g. a judge's), so it doesn't linger in the climber list.
create function public.delete_account_profile(p_profile uuid) returns boolean
  language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from profiles where id = p_profile and user_id is not null)
     or exists (select 1 from registrations where climber_id = p_profile)
     or exists (select 1 from round_starters where climber_id = p_profile)
     or exists (select 1 from boulder_results where climber_id = p_profile)
     or exists (select 1 from lead_results where climber_id = p_profile)
     or exists (select 1 from international_results where climber_id = p_profile)
     or exists (select 1 from ranking_adjustments where climber_id = p_profile)
     or exists (select 1 from appeals where climber_id = p_profile) then
    return false;
  end if;
  delete from profiles where id = p_profile;
  return found;
exception when foreign_key_violation then
  return false; -- still referenced (e.g. as who entered a score): keep it
end $$;
revoke all on function public.delete_account_profile(uuid) from public, anon, authenticated;
grant execute on function public.delete_account_profile(uuid) to service_role;
