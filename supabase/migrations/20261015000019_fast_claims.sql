-- Claims like the temporary app: the judge pad re-claims every 10 seconds, so a claim older than
-- 30 seconds means the judge left (phone asleep, app closed) and another judge may take the climber.
-- Was 10 minutes, which could block a climber on a boulder for that long.

/** Claim a climber on a boulder for the calling judge. Returns the holder: the caller when the claim
    succeeded, another judge when they hold a claim younger than 30 seconds. */
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
  on conflict (boulder_id, climber_id) do update set judge_id = me, claimed_at = now()
    where c.judge_id = me or c.claimed_at < now() - interval '30 seconds';
  return query
  select c.judge_id, p.full_name, c.claimed_at from judge_claims c join profiles p on p.id = c.judge_id
  where c.boulder_id = p_boulder and c.climber_id = p_climber;
end $$;

