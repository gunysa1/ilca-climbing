-- Climber profiles no longer require a login account.
-- Admins create/import profiles (CSV roster, LogLig history); an account is attached later with
-- link_account(). Self-signups keep profile.id = auth user id, so existing rows stay valid.
-- Every "is this me" check now goes through my_profile_id() instead of comparing with auth.uid().

alter table public.profiles drop constraint profiles_id_fkey;
alter table public.profiles alter column id set default gen_random_uuid();
alter table public.profiles add column user_id uuid unique references auth.users (id) on delete set null;
update public.profiles set user_id = id;

alter table public.profile_private add column email text;

-- The caller's profile, or null.
create function public.my_profile_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select id from profiles where user_id = auth.uid();
$$;
revoke all on function public.my_profile_id() from public;
grant execute on function public.my_profile_id() to anon, authenticated;

-- New account -> its own profile (id = account id) + private row + default climber role.
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, user_id, full_name)
  values (new.id, new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)));
  insert into profile_private (id, email) values (new.id, new.email);
  insert into user_roles (user_id, role) values (new.id, 'climber');
  return new;
end $$;

create or replace function public.is_coach_of(climber uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from coach_athletes where coach_id = public.my_profile_id() and climber_id = climber)
     and public.has_role('coach');
$$;

create or replace function public.can_judge(r_id uuid, b_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.has_role('judge')
     and exists (select 1 from rounds where id = r_id and status = 'live')
     and exists (select 1 from boulders where id = b_id and round_id = r_id)
     and exists (
       select 1 from judge_assignments ja
       where ja.judge_id = public.my_profile_id() and ja.round_id = r_id
         and (ja.boulder_id is null or ja.boulder_id = b_id));
$$;

-- updated_by / audit judge_id are profile ids.
create or replace function public.boulder_results_stamp() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  select round_id into new.round_id from boulders where id = new.boulder_id;
  new.updated_by := public.my_profile_id();
  new.updated_at := now();
  insert into score_events (boulder_id, climber_id, round_id, attempts, zone_attempt, top_attempt, judge_id)
  values (new.boulder_id, new.climber_id, new.round_id, new.attempts, new.zone_attempt, new.top_attempt,
          public.my_profile_id());
  return new;
end $$;

-- Admin: attach an account to a profile. The account's own auto-created profile is dropped if it
-- holds no data; otherwise the link is refused (merge by hand).
create function public.link_account(p_profile uuid, p_user uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare own uuid;
begin
  if not public.has_role('admin') then
    raise exception 'only admins can link accounts' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'unknown account %', p_user;
  end if;
  select id into own from profiles where user_id = p_user;
  if own = p_profile then return; end if;
  if own is not null then
    if exists (select 1 from registrations where climber_id = own)
       or exists (select 1 from boulder_results where climber_id = own or updated_by = own)
       or exists (select 1 from coach_athletes where coach_id = own or climber_id = own)
       or exists (select 1 from coach_notes where coach_id = own or climber_id = own)
       or exists (select 1 from judge_assignments where judge_id = own) then
      raise exception 'account % already has a profile with data', p_user;
    end if;
    delete from profiles where id = own;
  end if;
  update profiles set user_id = p_user where id = p_profile;
  if not found then raise exception 'unknown profile %', p_profile; end if;
end $$;

-- Admin: detach an account from a profile (the profile and its history stay).
create function public.unlink_account(p_profile uuid) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('admin') then
    raise exception 'only admins can unlink accounts' using errcode = 'insufficient_privilege';
  end if;
  update profiles set user_id = null where id = p_profile;
end $$;

-- Admin: accounts with email, linked profile and roles.
create function public.admin_accounts()
  returns table (user_id uuid, email text, profile_id uuid, full_name text, roles public.app_role[])
  language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('admin') then
    raise exception 'only admins can list accounts' using errcode = 'insufficient_privilege';
  end if;
  return query
    select u.id, u.email, p.id, p.full_name,
           coalesce(array_agg(r.role order by r.role) filter (where r.role is not null), '{}')
    from auth.users u
    left join profiles p on p.user_id = u.id
    left join user_roles r on r.user_id = u.id
    group by u.id, u.email, p.id, p.full_name
    order by u.email;
end $$;

revoke all on function public.link_account(uuid, uuid), public.unlink_account(uuid), public.admin_accounts()
  from public;
grant execute on function public.link_account(uuid, uuid), public.unlink_account(uuid), public.admin_accounts()
  to authenticated;

-- user_id is only changed through link_account/unlink_account.
revoke insert, update on public.profiles from anon, authenticated;
grant insert (id, full_name, full_name_he, gender, club, country, ifsc_id) on public.profiles to authenticated;
grant update (full_name, full_name_he, gender, club, country, ifsc_id) on public.profiles to authenticated;

-- Policies that compared with auth.uid() now compare with the caller's profile.
drop policy profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update
  using (id = public.my_profile_id()) with check (id = public.my_profile_id());

drop policy private_self_read on public.profile_private;
create policy private_self_read on public.profile_private for select
  using (id = public.my_profile_id() or public.is_coach_of(id) or public.has_role('admin'));
drop policy private_self_update on public.profile_private;
create policy private_self_update on public.profile_private for update
  using (id = public.my_profile_id()) with check (id = public.my_profile_id());

drop policy coach_links_read on public.coach_athletes;
create policy coach_links_read on public.coach_athletes for select
  using (coach_id = public.my_profile_id() or climber_id = public.my_profile_id() or public.has_role('admin'));

drop policy notes_coach on public.coach_notes;
create policy notes_coach on public.coach_notes for all
  using (coach_id = public.my_profile_id() and public.is_coach_of(climber_id))
  with check (coach_id = public.my_profile_id() and public.is_coach_of(climber_id));
drop policy notes_climber_read on public.coach_notes;
create policy notes_climber_read on public.coach_notes for select
  using (climber_id = public.my_profile_id() and shared_with_climber);

drop policy assignments_read on public.judge_assignments;
create policy assignments_read on public.judge_assignments for select
  using (judge_id = public.my_profile_id() or public.has_role('admin'));

-- Admins correct results after a round and read the audit trail.
create index on public.score_events (climber_id);
