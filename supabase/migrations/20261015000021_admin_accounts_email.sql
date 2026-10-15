-- auth.users.email is varchar(255) in Supabase, so admin_accounts() (email text) failed live with
-- "structure of query does not match function result type": no accounts in People, no judges to assign.
create or replace function public.admin_accounts()
  returns table (user_id uuid, email text, profile_id uuid, full_name text, roles public.app_role[])
  language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('admin') then
    raise exception 'only admins can list accounts' using errcode = 'insufficient_privilege';
  end if;
  return query
    select u.id, u.email::text, p.id, p.full_name,
           coalesce(array_agg(r.role order by r.role) filter (where r.role is not null), '{}')
    from auth.users u
    left join profiles p on p.user_id = u.id
    left join user_roles r on r.user_id = u.id
    group by u.id, u.email, p.id, p.full_name
    order by u.email;
end $$;
