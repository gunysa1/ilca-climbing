-- Who is on the wall right now, for the live results (like the IFSC app's "climbing now").
-- A safety against showing a climber by accident: opening a climber on the pad (a claim) is not
-- enough; the judge marks them on the wall ("▶ on the wall", or by counting an attempt). It ends when
-- the result is locked, the judge leaves the climber (claim released), the claim goes stale (30 s
-- without the pad's 10 s beat), another judge takes the climber over, or the judge marks them off.
-- One climber per boulder: marking one takes the previous one off that boulder.
alter table public.judge_claims add column on_wall_since timestamptz;

/** Claim as before (019); a takeover by another judge clears the on-the-wall mark. */
create or replace function public.claim_climber(p_round uuid, p_boulder uuid, p_climber uuid)
returns table (judge_id uuid, judge_name text, claimed_at timestamptz)
  language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_profile_id();
begin
  if not public.can_judge(p_round, p_boulder) then
    raise exception 'not a judge of this boulder' using errcode = '42501';
  end if;
  insert into judge_claims as c (boulder_id, climber_id, round_id, judge_id, claimed_at)
  values (p_boulder, p_climber, p_round, me, now())
  on conflict (boulder_id, climber_id) do update set judge_id = me, claimed_at = now(),
    on_wall_since = case when c.judge_id = me then c.on_wall_since end
    where c.judge_id = me or c.claimed_at < now() - interval '30 seconds';
  return query
  select c.judge_id, p.full_name, c.claimed_at from judge_claims c join profiles p on p.id = c.judge_id
  where c.boulder_id = p_boulder and c.climber_id = p_climber;
end $$;

/** The calling judge marks the climber they hold on a boulder as on the wall (or off it). */
create function public.set_on_wall(p_boulder uuid, p_climber uuid, p_on boolean) returns void
  language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_profile_id();
begin
  if not exists (select 1 from judge_claims c where c.boulder_id = p_boulder and c.climber_id = p_climber
                 and c.judge_id = me and c.claimed_at > now() - interval '30 seconds'
                 and public.can_judge(c.round_id, p_boulder)) then
    raise exception 'climber not held by this judge' using errcode = '42501';
  end if;
  if p_on then
    update judge_claims set on_wall_since = null where boulder_id = p_boulder and climber_id <> p_climber;
  end if;
  update judge_claims set on_wall_since = case when p_on then coalesce(on_wall_since, now()) end
  where boulder_id = p_boulder and climber_id = p_climber;
end $$;
revoke all on function public.set_on_wall(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_on_wall(uuid, uuid, boolean) to authenticated;

/** Public: boulder -> climber on the wall in a live round of a published competition (no judge). */
create function public.on_wall(p_round uuid)
returns table (boulder_id uuid, climber_id uuid)
  language sql stable security definer set search_path = public as $$
  select c.boulder_id, c.climber_id
  from judge_claims c
  join rounds r on r.id = c.round_id
  where c.round_id = p_round and r.status = 'live' and public.round_is_public(p_round)
    and c.on_wall_since is not null
    and c.claimed_at > now() - interval '30 seconds'
    and not exists (select 1 from boulder_results b
                    where b.boulder_id = c.boulder_id and b.climber_id = c.climber_id and b.locked)
    and not exists (select 1 from lead_results l
                    where l.boulder_id = c.boulder_id and l.climber_id = c.climber_id and l.locked);
$$;
revoke all on function public.on_wall(uuid) from public;
grant execute on function public.on_wall(uuid) to anon, authenticated;
