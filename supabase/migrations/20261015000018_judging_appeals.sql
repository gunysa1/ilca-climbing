-- What the temporary scoring app has and this app lacked (to retire it):
--  * Locked results: a judge finishes ("סיום") a climber's boulder; after that only admins change it.
--  * Claims: a judge claims a climber on a boulder while scoring, so two judges never score the same
--    attempt; another judge sees who holds it. A claim older than 10 minutes can be taken over.
--  * Appeals: admins open an appeal on a climber's result (a boulder or the whole round) and resolve
--    it. The public sees that an appeal is open (like the temporary app's "ערעור פתוח"); the reason
--    stays with admins.

alter table public.boulder_results add column locked boolean not null default false;
alter table public.lead_results add column locked boolean not null default false;
grant select (locked) on public.boulder_results, public.lead_results to anon, authenticated;

-- Judges change only unlocked results (they may lock them); admins keep full access (results_admin, lead_admin).
drop policy results_judge_update on public.boulder_results;
create policy results_judge_update on public.boulder_results for update
  using (public.can_judge(round_id, boulder_id) and not locked)
  with check (public.can_judge(round_id, boulder_id));
drop policy lead_judge_update on public.lead_results;
create policy lead_judge_update on public.lead_results for update
  using (public.can_judge(round_id, boulder_id) and not locked)
  with check (public.can_judge(round_id, boulder_id));

create table public.judge_claims (
  boulder_id  uuid not null references public.boulders (id) on delete cascade,
  climber_id  uuid not null references public.profiles (id) on delete cascade,
  round_id    uuid not null references public.rounds (id) on delete cascade,
  judge_id    uuid not null references public.profiles (id) on delete cascade,
  claimed_at  timestamptz not null default now(),
  primary key (boulder_id, climber_id)
);
alter table public.judge_claims enable row level security;
-- Judges of the boulder see its claims; admins see all. Writes only through claim_climber / release_claim.
create policy claims_read on public.judge_claims for select
  using (public.can_judge(round_id, boulder_id) or public.has_role('admin'));
revoke all on public.judge_claims from anon, authenticated;
grant select on public.judge_claims to authenticated;

/** Claim a climber on a boulder for the calling judge. Returns the holder: the caller when the claim
    succeeded, another judge when they hold a claim younger than 10 minutes. */
create function public.claim_climber(p_round uuid, p_boulder uuid, p_climber uuid)
returns table (judge_id uuid, judge_name text, claimed_at timestamptz)
  language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_profile_id();
begin
  if not public.can_judge(p_round, p_boulder) then
    raise exception 'not a judge of this boulder' using errcode = '42501';
  end if;
  insert into judge_claims as c (boulder_id, climber_id, round_id, judge_id, claimed_at)
  values (p_boulder, p_climber, p_round, me, now())
  on conflict (boulder_id, climber_id) do update set judge_id = me, claimed_at = now()
    where c.judge_id = me or c.claimed_at < now() - interval '10 minutes';
  return query
  select c.judge_id, p.full_name, c.claimed_at from judge_claims c join profiles p on p.id = c.judge_id
  where c.boulder_id = p_boulder and c.climber_id = p_climber;
end $$;

create function public.release_claim(p_boulder uuid, p_climber uuid) returns void
  language sql security definer set search_path = public as $$
  delete from judge_claims where boulder_id = p_boulder and climber_id = p_climber
    and (judge_id = public.my_profile_id() or public.has_role('admin'));
$$;
revoke all on function public.claim_climber(uuid, uuid, uuid), public.release_claim(uuid, uuid) from public, anon;
grant execute on function public.claim_climber(uuid, uuid, uuid), public.release_claim(uuid, uuid) to authenticated;

create type public.appeal_status as enum ('open', 'upheld', 'rejected');
create table public.appeals (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid not null references public.rounds (id) on delete cascade,
  boulder_id  uuid references public.boulders (id) on delete cascade,  -- null: the whole round
  climber_id  uuid not null references public.profiles (id) on delete cascade,
  status      public.appeal_status not null default 'open',
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  check ((status = 'open') = (resolved_at is null))
);
create index on public.appeals (round_id);
-- The reason and who decided: admins only.
create table public.appeal_details (
  appeal_id  uuid primary key references public.appeals (id) on delete cascade,
  reason     text not null,
  decision   text,
  created_by uuid references public.profiles (id),
  resolved_by uuid references public.profiles (id)
);
alter table public.appeals enable row level security;
alter table public.appeal_details enable row level security;
create policy appeals_read on public.appeals for select
  using (public.round_is_public(round_id) or public.has_role('admin'));
create policy appeals_admin on public.appeals for all
  using (public.has_role('admin')) with check (public.has_role('admin'));
create policy appeal_details_admin on public.appeal_details for all
  using (public.has_role('admin')) with check (public.has_role('admin'));
revoke all on public.appeals, public.appeal_details from anon, authenticated;
grant select on public.appeals to anon, authenticated;
grant insert, update, delete on public.appeals to authenticated;
grant select, insert, update, delete on public.appeal_details to authenticated;

-- Live updates: the results page shows appeals as they open; judges see claims as they change.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.appeals;
    alter publication supabase_realtime add table public.judge_claims;
  end if;
end $$;
