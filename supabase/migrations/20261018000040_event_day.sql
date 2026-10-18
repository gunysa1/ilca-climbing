-- Event day: the admin checklist (event_checklist) and error reports from the staff app (client_errors).

-- ---------------------------------------------------------------------------
-- Error reports. Written only through report_client_error(); admins read and clear them.
-- ---------------------------------------------------------------------------
create table public.client_errors (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  profile_id uuid default public.my_profile_id() references public.profiles (id) on delete set null,
  app        text not null,
  path       text,
  message    text not null,
  stack      text,
  user_agent text,
  build      text,
  context    jsonb
);
create index on public.client_errors (created_at);
create index on public.client_errors (profile_id, created_at);

alter table public.client_errors enable row level security;
create policy client_errors_admin_read on public.client_errors for select using (public.has_role('admin'));
create policy client_errors_admin_delete on public.client_errors for delete using (public.has_role('admin'));
revoke all on public.client_errors from anon, authenticated;
grant select, delete on public.client_errors to authenticated;

-- Staff app only (signed in). Caps the field sizes, drops calls beyond 30 per profile per 10 minutes
-- (quietly: reporting must never be a reason for another error), ignores accounts without a profile and removes rows older than 30 days.
create function public.report_client_error(
  p_app text, p_path text, p_message text, p_stack text default null,
  p_user_agent text default null, p_build text default null, p_context jsonb default null)
  returns void language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_profile_id();
begin
  if auth.uid() is null then
    raise exception 'sign in to report errors' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_message, '') = '' or me is null then return; end if; -- no profile: nobody to attribute it to
  perform pg_advisory_xact_lock(hashtext('client_errors:' || me::text)); -- parallel calls of one profile count one after another
  if (select count(*) from client_errors
      where profile_id = me and created_at > now() - interval '10 minutes') >= 30 then
    return;
  end if;
  delete from client_errors where created_at < now() - interval '30 days';
  insert into client_errors (profile_id, app, path, message, stack, user_agent, build, context)
  values (me, left(coalesce(nullif(p_app, ''), 'staff'), 20), left(p_path, 300), left(p_message, 500),
          left(p_stack, 4000), left(p_user_agent, 300), left(p_build, 100),
          case when p_context is null or length(p_context::text) <= 2000 then p_context
               else jsonb_build_object('truncated', left(p_context::text, 2000)) end);
end $$;
revoke all on function public.report_client_error(text, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.report_client_error(text, text, text, text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Event-day checklist: one admin-only call, returned as
--   { competition: {id, name, name_he, status, starts_on, ends_on},
--     checks: [{ id, ok, items: [{ label, label_he, round_id, category_id, profile_id, ... }] }] }
-- `items` are the things that are wrong (check 'judges_signed_in' lists every assigned judge).
-- security definer only for auth.users (last_sign_in_at): of an account, only "signed in / when" leaves.
-- ---------------------------------------------------------------------------
create function public.event_checklist(p_competition uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  comp competitions%rowtype;
  today date := (now() at time zone 'Asia/Jerusalem')::date;
  checks jsonb := '[]';
  items jsonb;
begin
  if not public.has_role('admin') then
    raise exception 'only admins can read the event checklist' using errcode = 'insufficient_privilege';
  end if;
  select * into comp from competitions where id = p_competition;
  if not found then
    raise exception 'competition not found' using errcode = 'no_data_found';
  end if;

  -- Published (and dated: starts_on is required by the table).
  checks := checks || jsonb_build_array(jsonb_build_object('id', 'published', 'ok', comp.status = 'published', 'items', '[]'::jsonb));

  -- Categories without rounds (and a competition without categories).
  select coalesce(jsonb_agg(jsonb_build_object('category_id', c.id, 'label', c.name, 'label_he', c.name_he) order by c.name), '[]')
    into items from categories c
    where c.competition_id = comp.id and not exists (select 1 from rounds r where r.category_id = c.id);
  if not exists (select 1 from categories where competition_id = comp.id) then
    items := '[{"label": "-", "label_he": "-"}]';
  end if;
  checks := checks || jsonb_build_array(jsonb_build_object('id', 'category_rounds', 'ok', items = '[]', 'items', items));

  -- Rounds without a boulder / route (the scoring format is never empty: the column is required).
  select coalesce(jsonb_agg(jsonb_build_object('round_id', r.id, 'category_id', c.id, 'kind', r.kind,
           'label', c.name, 'label_he', c.name_he) order by c.name, r.kind), '[]')
    into items from rounds r join categories c on c.id = r.category_id
    where c.competition_id = comp.id and not exists (select 1 from boulders b where b.round_id = r.id);
  checks := checks || jsonb_build_array(jsonb_build_object('id', 'round_boulders', 'ok', items = '[]', 'items', items));

  -- First rounds: starters, and a bib for each (the bib is the registration's).
  select coalesce(jsonb_agg(jsonb_build_object('round_id', r.id, 'category_id', c.id, 'kind', r.kind,
           'label', c.name, 'label_he', c.name_he) order by c.name), '[]')
    into items from rounds r join categories c on c.id = r.category_id
    where c.competition_id = comp.id and public.previous_round(r.id) is null
      and not exists (select 1 from round_starters s where s.round_id = r.id);
  checks := checks || jsonb_build_array(jsonb_build_object('id', 'first_starters', 'ok', items = '[]', 'items', items));

  select coalesce(jsonb_agg(jsonb_build_object('round_id', r.id, 'category_id', c.id, 'kind', r.kind, 'profile_id', p.id,
           'label', p.full_name, 'label_he', p.full_name_he) order by c.name, p.full_name), '[]')
    into items from rounds r
    join categories c on c.id = r.category_id
    join round_starters s on s.round_id = r.id
    join profiles p on p.id = s.climber_id
    left join registrations g on g.category_id = c.id and g.climber_id = s.climber_id
    where c.competition_id = comp.id and public.previous_round(r.id) is null and g.bib is null;
  checks := checks || jsonb_build_array(jsonb_build_object('id', 'starter_bibs', 'ok', items = '[]', 'items', items));

  -- A round someone advances from needs its quota (the last round of a category has none to set).
  select coalesce(jsonb_agg(jsonb_build_object('round_id', r.id, 'category_id', c.id, 'kind', r.kind,
           'label', c.name, 'label_he', c.name_he) order by c.name, r.kind), '[]')
    into items from rounds r join categories c on c.id = r.category_id
    where c.competition_id = comp.id and r.kind <> 'final' and r.advance_quota is null
      and exists (select 1 from rounds n where n.category_id = r.category_id and n.kind > r.kind);
  checks := checks || jsonb_build_array(jsonb_build_object('id', 'advance_quota', 'ok', items = '[]', 'items', items));

  -- Boulders nobody judges (an assignment of the whole round counts).
  select coalesce(jsonb_agg(jsonb_build_object('round_id', r.id, 'category_id', c.id, 'kind', r.kind, 'number', b.number,
           'label', c.name, 'label_he', c.name_he) order by c.name, r.kind, b.number), '[]')
    into items from boulders b join rounds r on r.id = b.round_id join categories c on c.id = r.category_id
    where c.competition_id = comp.id and not exists (
      select 1 from judge_assignments ja
      where ja.round_id = r.id and (ja.boulder_id is null or ja.boulder_id = b.id));
  checks := checks || jsonb_build_array(jsonb_build_object('id', 'boulder_judges', 'ok', items = '[]', 'items', items));

  -- Every assigned judge: has a login, has signed in once. Of auth.users only the sign-in time leaves.
  select coalesce(jsonb_agg(jsonb_build_object('profile_id', j.id, 'label', j.full_name, 'label_he', j.full_name_he,
           'has_login', j.user_id is not null, 'signed_in', u.last_sign_in_at is not null,
           'last_sign_in_at', u.last_sign_in_at) order by j.full_name), '[]')
    into items from (
      select distinct p.id, p.full_name, p.full_name_he, p.user_id
      from judge_assignments ja
      join rounds r on r.id = ja.round_id join categories c on c.id = r.category_id
      join profiles p on p.id = ja.judge_id
      where c.competition_id = comp.id) j
    left join auth.users u on u.id = j.user_id;
  checks := checks || jsonb_build_array(jsonb_build_object('id', 'judges_signed_in',
    'ok', not exists (select 1 from jsonb_array_elements(items) i where not (i->>'signed_in')::boolean), 'items', items));

  -- Appeals still open from an earlier (Israel) day.
  select coalesce(jsonb_agg(jsonb_build_object('round_id', r.id, 'category_id', c.id, 'kind', r.kind, 'profile_id', a.climber_id,
           'label', c.name, 'label_he', c.name_he, 'created_at', a.created_at) order by a.created_at), '[]')
    into items from appeals a join rounds r on r.id = a.round_id join categories c on c.id = r.category_id
    where c.competition_id = comp.id and a.status = 'open'
      and (a.created_at at time zone 'Asia/Jerusalem')::date < today;
  checks := checks || jsonb_build_array(jsonb_build_object('id', 'old_appeals', 'ok', items = '[]', 'items', items));

  return jsonb_build_object(
    'competition', jsonb_build_object('id', comp.id, 'name', comp.name, 'name_he', comp.name_he, 'status', comp.status,
                                      'starts_on', comp.starts_on, 'ends_on', comp.ends_on),
    'checks', checks);
end $$;
revoke all on function public.event_checklist(uuid) from public, anon;
grant execute on function public.event_checklist(uuid) to authenticated;
