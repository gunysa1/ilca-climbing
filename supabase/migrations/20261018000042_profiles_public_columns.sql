-- profiles: the public reads only the public columns. profiles_read is `using (true)` and the table kept the
-- default full select grant, so anyone could read user_id (the auth account id of a linked profile) and
-- created_at. No public screen needs them: the apps find the caller's own profile with my_profile_id()
-- (definer), admins see which account a profile has through admin_accounts() (definer, admins only).
-- Column grants: `select *` and to_jsonb(p) of a whole row would now fail for anon/authenticated; every
-- client select and every invoker function (round_page, home_page, climber_page, favorites_page,
-- favorites_live, season_rankings_build as anon, ...) names its columns. Definer functions (link_account,
-- merge_profiles, delete_account_profile, event_checklist, admin_accounts, my_profile_id) read as the owner,
-- service_role (edge functions) keeps its grants.
revoke select on public.profiles from anon, authenticated;
grant select (id, full_name, full_name_he, gender, club, country, ifsc_id) on public.profiles to anon, authenticated;
