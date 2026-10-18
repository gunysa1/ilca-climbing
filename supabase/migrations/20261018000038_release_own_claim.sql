-- release_claim (migration 018) also deleted when the caller was an admin, so an admin who judges could free
-- another judge's claim by opening the same climber's pad and leaving it. A claim is released only by the
-- judge holding it; a stale claim is taken over through claim_climber, as before. The clients (Judge.tsx,
-- judgeOutbox.ts) only ever release the caller's own claim.
create or replace function public.release_claim(p_boulder uuid, p_climber uuid) returns void
  language sql security definer set search_path = public as $$
  delete from judge_claims where boulder_id = p_boulder and climber_id = p_climber
    and judge_id = public.my_profile_id();
$$;
revoke all on function public.release_claim(uuid, uuid) from public, anon;
grant execute on function public.release_claim(uuid, uuid) to authenticated;
