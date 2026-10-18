import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { localized, useI18n } from '../../lib/i18n';
import { judgeAssignmentsKey } from '../../lib/judgeOutbox';
import { supabase } from '../../lib/supabase';
import { type Boulder, type RoundFormat } from '../../lib/types';
import { OutboxNotices } from './OutboxNotices';

interface Assignment {
  id: string;
  round_id: string;
  boulder_id: string | null;
  round: {
    kind: 'qualification' | 'semifinal' | 'final';
    status: string;
    scoring: RoundFormat;
    boulders: Boulder[];
    category: { name: string; name_he: string | null; competition: { name: string; name_he: string | null } };
  };
}

/** List of the judge's assignments in live rounds (RLS returns only the caller's own). */
export function JudgeHome() {
  const { t, lang } = useI18n();
  const { profileId } = useAuth();
  const [items, setItems] = useState<Assignment[] | null>(null);

  useEffect(() => {
    if (!profileId) return;
    // Kept on the device: without signal the judge still finds their boulders.
    const key = judgeAssignmentsKey(profileId);
    supabase.from('judge_assignments')
      .select('id, round_id, boulder_id, round:rounds!inner(kind, status, scoring, boulders(id, round_id, number), category:categories(name, name_he, competition:competitions(name, name_he)))')
      .eq('judge_id', profileId).eq('round.status', 'live')
      .then(({ data, error }) => {
        if (error) {
          let kept: Assignment[] = [];
          try { kept = JSON.parse(localStorage.getItem(key) ?? '[]') as Assignment[]; } catch { /* nothing kept */ }
          setItems(Array.isArray(kept) ? kept : []);
          return;
        }
        try { localStorage.setItem(key, JSON.stringify(data ?? [])); } catch { /* storage unavailable */ }
        setItems((data as unknown as Assignment[]) ?? []);
      });
  }, [profileId]);

  return (
    <section>
      <h1>{t('myAssignments')}</h1>
      <OutboxNotices />
      {items === null && <p className="muted">{t('loading')}</p>}
      {items?.length === 0 && <p className="muted">{t('noAssignments')}</p>}
      {items?.map((a) => {
        const boulders = a.boulder_id ? a.round.boulders.filter((b) => b.id === a.boulder_id) : a.round.boulders;
        return (
          <div key={a.id} className="panel">
            <h2>
              {localized(lang, a.round.category.competition.name, a.round.category.competition.name_he)} ·{' '}
              {localized(lang, a.round.category.name, a.round.category.name_he)} · {t(a.round.kind)}
            </h2>
            <div className="chips">
              {[...boulders].sort((x, y) => x.number - y.number).map((b) => (
                <Link key={b.id} className="chip" to={`/judge/${a.round_id}/${b.id}`}>{t(a.round.scoring === 'lead' ? 'route' : 'boulder')} {b.number}</Link>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
