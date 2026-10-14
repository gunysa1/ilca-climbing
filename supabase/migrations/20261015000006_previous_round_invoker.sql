-- Advisor follow-up: previous_round() does not need to bypass RLS. Callers are the start-list
-- triggers (security definer) and generate_start_list() (admins), so run it with the caller's rights
-- and keep it away from anon.
alter function public.previous_round(uuid) security invoker;
revoke execute on function public.previous_round(uuid) from public, anon;
grant execute on function public.previous_round(uuid) to authenticated;
