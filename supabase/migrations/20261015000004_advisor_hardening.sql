-- Fixes from `supabase db advisors` on the live project (2026-10-15).

-- Supabase grants EXECUTE on new public functions to anon/authenticated directly, so the earlier
-- "revoke ... from public" left them reachable via /rest/v1/rpc. They refuse non-admins internally;
-- remove the access anyway.
revoke execute on function public.admin_accounts(), public.link_account(uuid, uuid),
  public.unlink_account(uuid), public.import_roster(jsonb, jsonb, jsonb, jsonb) from anon;
revoke execute on function public.handle_new_user(), public.boulder_results_stamp(),
  public.boulder_results_check_registration() from public, anon, authenticated;

-- function_search_path_mutable
alter function public.boulder_points(int, int) set search_path = '';

-- auth_rls_initplan: evaluate auth.uid() once per query, not per row.
drop policy roles_self_read on public.user_roles;
create policy roles_self_read on public.user_roles for select
  using (user_id = (select auth.uid()) or public.has_role('admin'));
