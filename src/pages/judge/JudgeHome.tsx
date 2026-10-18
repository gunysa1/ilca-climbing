import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { israelToday } from '../../lib/calendar';
import { climbsRoutes, problemWord } from '../../lib/discipline';
import { localized, useI18n } from '../../lib/i18n';
import { judgeAssignmentsShown, roundsToKeep, type JudgeAssignment } from '../../lib/judgeHome';
import { judgeAssignmentsKey, judgeRoundsKey } from '../../lib/judgeOutbox';
import { keepRoundOffline, OFFLINE_KEEP } from '../../lib/roundData';
import { supabase } from '../../lib/supabase';
import { OutboxNotices } from './OutboxNotices';

/** The judge's assignments in live rounds, and in planned rounds of competitions starting within two
 *  days (greyed, "not live yet"); RLS returns only the caller's own. Their round pages are kept on the
 *  phone, so a pad opened the evening before opens without signal on the day. */
export function JudgeHome() {
  const { t, lang } = useI18n();
  const { profileId } = useAuth();
  const [items, setItems] = useState<JudgeAssignment[] | null>(null);
  const [kept, setKept] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    // Kept on the device: without signal the judge still finds their boulders.
    const key = judgeAssignmentsKey(profileId);
    const today = israelToday();
    supabase.from('judge_assignments')
      .select('id, round_id, boulder_id, round:rounds!inner(kind, status, scoring, boulders(id, round_id, number), category:categories(name, name_he, competition:competitions(name, name_he, starts_on, ends_on, discipline)))')
      .eq('judge_id', profileId).in('round.status', ['live', 'planned'])
      .then(async ({ data, error }) => {
        if (cancelled) return;
        if (error) {
          let stored: JudgeAssignment[] = [];
          try { stored = JSON.parse(localStorage.getItem(key) ?? '[]') as JudgeAssignment[]; } catch { /* nothing kept */ }
          setItems(Array.isArray(stored) ? judgeAssignmentsShown(stored, today) : []);
          return;
        }
        const shown = judgeAssignmentsShown((data as unknown as JudgeAssignment[]) ?? [], today);
        try { localStorage.setItem(key, JSON.stringify(shown)); } catch { /* storage unavailable */ }
        setItems(shown);
        // Least needed first: the device keeps the last OFFLINE_KEEP pages stored.
        for (const roundId of roundsToKeep(shown, OFFLINE_KEEP).reverse()) {
          if (cancelled) return;
          if (await keepRoundOffline(judgeRoundsKey(profileId), roundId)) setKept((s) => new Set(s).add(roundId));
        }
      });
    return () => { cancelled = true; };
  }, [profileId]);

  return (
    <section>
      <h1>{t('myAssignments')}</h1>
      <OutboxNotices />
      {items === null && <p className="muted">{t('loading')}</p>}
      {items?.length === 0 && <p className="muted">{t('noAssignments')}</p>}
      {items?.map((a) => {
        const boulders = a.boulder_id ? a.round.boulders.filter((b) => b.id === a.boulder_id) : a.round.boulders;
        const planned = a.round.status !== 'live';
        return (
          <div key={a.id} className={`panel${planned ? ' judge-planned' : ''}`}>
            <h2>
              {localized(lang, a.round.category.competition.name, a.round.category.competition.name_he)} ·{' '}
              {localized(lang, a.round.category.name, a.round.category.name_he)} · {t(a.round.kind)}
            </h2>
            {(planned || kept.has(a.round_id)) && (
              <p className="muted small">
                {planned && <span className="badge">{t('notLiveYet')}</span>}{' '}
                {kept.has(a.round_id) && `✓ ${t('keptOffline')}`}
              </p>
            )}
            <div className="chips">
              {[...boulders].sort((x, y) => x.number - y.number).map((b) => (
                <Link key={b.id} className="chip" to={`/judge/${a.round_id}/${b.id}`}>{t(problemWord(climbsRoutes(a.round.category.competition.discipline, a.round.scoring)))} {b.number}</Link>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
