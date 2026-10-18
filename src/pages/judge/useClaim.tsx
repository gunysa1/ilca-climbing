import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { trackOpenPad } from '../../lib/judgeOutbox';
import { isTransient } from '../../lib/saveQueue';
import { supabase } from '../../lib/supabase';

/** Claims refresh every 10 s; another judge's claim older than 30 s is stale (claim_climber). */
export const CLAIM_BEAT_MS = 10_000;
export const CLAIM_STALE_MS = 30_000;

/** Who holds a climber on a boulder: the calling judge claims them while the pad is open (re-claimed
 * every 10 s, released on close); another judge's fresh claim keeps the pad read-only. Without
 * signal the last answer stands (no answer yet: the pad stays editable); only an explicit "held by
 * another judge" makes it read-only. */
export function useClaim(roundId: string, boulderId: string, climberId: string, enabled: boolean) {
  const { profileId } = useAuth();
  const [holder, setHolder] = useState<{ judge_id: string; judge_name: string } | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const claim = useCallback(async () => {
    const { data, error, status } = await supabase.rpc('claim_climber', { p_round: roundId, p_boulder: boulderId, p_climber: climberId });
    if (error && (isTransient(status) || status === 401)) { setUnreachable(true); return; } // no signal / session: keep what we knew
    setUnreachable(false);
    setHolder(((data ?? []) as { judge_id: string; judge_name: string }[])[0] ?? null);
  }, [roundId, boulderId, climberId]);
  useEffect(() => {
    if (!enabled) return;
    const closed = trackOpenPad(boulderId, climberId); // the outbox keeps its hands off this claim
    void claim();
    const beat = setInterval(() => void claim(), CLAIM_BEAT_MS);
    return () => { closed(); clearInterval(beat); void supabase.rpc('release_claim', { p_boulder: boulderId, p_climber: climberId }); };
  }, [claim, boulderId, climberId, enabled]);
  // On the wall (public "climbing now"): only when the judge marks it (set_on_wall), never by opening.
  const [onWall, setOnWall] = useState(false);
  const markWall = useCallback(async (on: boolean) => {
    const { error } = await supabase.rpc('set_on_wall', { p_boulder: boulderId, p_climber: climberId, p_on: on });
    if (!error) setOnWall(on);
  }, [boulderId, climberId]);
  return { holder, mine: !enabled || (holder ? holder.judge_id === profileId : unreachable), onWall, markWall };
}

/** "▶ On the wall" / "■ Off the wall": what the public sees as climbing now on this boulder. */
export function WallToggle({ onWall, markWall, disabled }: { onWall: boolean; markWall: (on: boolean) => Promise<void>; disabled: boolean }) {
  const { t } = useI18n();
  if (disabled) return null;
  return (
    <div className={`wall-toggle${onWall ? ' on' : ''}`}>
      <span className="small">{onWall ? <><span className="live-dot" aria-hidden /> {t('onWallShown')}</> : t('onWallHint')}</span>
      <button className={onWall ? 'secondary' : 'primary'} onClick={() => void markWall(!onWall)} aria-pressed={onWall}>
        {onWall ? `■ ${t('offWall')}` : `▶ ${t('putOnWall')}`}
      </button>
    </div>
  );
}

/** Fresh claims on a boulder by other judges, live (climber id -> judge name). */
export function useBoulderClaims(boulderId: string | undefined) {
  const { profileId } = useAuth();
  const [claims, setClaims] = useState(new Map<string, string>());
  useEffect(() => {
    if (!boulderId) return;
    const load = () => supabase.from('judge_claims').select('climber_id, judge_id, claimed_at, judge:profiles!judge_claims_judge_id_fkey(full_name)')
      .eq('boulder_id', boulderId)
      .then(({ data, error }) => !error && setClaims(new Map(((data ?? []) as unknown as { climber_id: string; judge_id: string; claimed_at: string; judge: { full_name: string } | null }[])
        .filter((c) => c.judge_id !== profileId && Date.now() - Date.parse(c.claimed_at) < CLAIM_STALE_MS)
        .map((c) => [c.climber_id, c.judge?.full_name ?? '?']))));
    void load();
    const channel = supabase.channel(`claims:${boulderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'judge_claims', filter: `boulder_id=eq.${boulderId}` }, () => void load())
      .subscribe();
    const poll = setInterval(() => void load(), CLAIM_BEAT_MS);
    return () => { clearInterval(poll); supabase.removeChannel(channel); };
  }, [boulderId, profileId]);
  return claims;
}
