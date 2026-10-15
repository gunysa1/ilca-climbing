-- Inviting judges from the staff app (edge function invite-judge, which runs with the service role):
-- look up an account by email, so an existing account gets the judge role instead of an invite.
create function public.account_by_email(p_email text)
returns table (user_id uuid, confirmed boolean)
  language sql stable security definer set search_path = public as $$
  select u.id, u.email_confirmed_at is not null from auth.users u where lower(u.email) = lower(trim(p_email));
$$;
revoke all on function public.account_by_email(text) from public, anon, authenticated;
grant execute on function public.account_by_email(text) to service_role;
