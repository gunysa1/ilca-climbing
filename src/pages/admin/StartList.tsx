import { useState } from 'react';
import { Sheet } from '../../components/Sheet';
import { errorText } from '../../lib/errors';
import { localized, useI18n } from '../../lib/i18n';
import type { Starter } from '../../lib/roundData';
import { moveStarter } from '../../lib/startOrder';
import { supabase } from '../../lib/supabase';
import { StarterStatus } from './StarterStatus';

const LABELS = ['A', 'B'];

/** Start order and qualification groups of a round: a place number per climber (moves the others), a group,
 *  the status, and split / clear buttons. Changing groups of a round with results asks first: the ranking changes.
 *  `onOptimistic(starters)` shows a new order at once; `onDone(error)` after each save (the page reloads). */
export function StartList({ roundId, starters, hasResults, onOptimistic, onDone }: {
  roundId: string; starters: Starter[]; hasResults: boolean;
  onOptimistic: (starters: Starter[]) => void; onDone: (error: string | null) => void;
}) {
  const { t, lang } = useI18n();
  const [pending, setPending] = useState<null | (() => Promise<void>)>(null);
  const [busy, setBusy] = useState(false);
  const groups = [...new Set([...LABELS, ...starters.map((s) => s.group_label).filter((g): g is string => !!g)])].sort();

  async function finish(p: PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    const { error } = await p;
    setBusy(false);
    onDone(errorText(error, t));
  }
  /** Group changes ask first when there are results. */
  const changeGroups = (act: () => Promise<void>) => { if (hasResults) setPending(() => act); else void act(); };

  async function move(s: Starter, input: HTMLInputElement) {
    const pos = Number.parseInt(input.value, 10);
    if (!Number.isFinite(pos) || pos === s.start_order) { input.value = String(s.start_order ?? ''); return; } // a bad entry goes back
    onOptimistic(moveStarter(starters, s.climber_id, pos));
    await finish(supabase.rpc('move_starter', { p_round: roundId, p_climber: s.climber_id, p_position: pos }));
  }
  const setGroup = (s: Starter, label: string) => changeGroups(() =>
    finish(supabase.from('round_starters').update({ group_label: label || null }).eq('round_id', roundId).eq('climber_id', s.climber_id)));
  const split = (labels: string[]) => changeGroups(() => finish(supabase.rpc('split_groups', { p_round: roundId, p_labels: labels })));

  return (
    <div className="panel">
      <h2>{t('startOrder')}</h2>
      {starters.length === 0 && <p className="muted">{t('empty')}</p>}
      <div className="inline-form">
        <button className="secondary" disabled={busy || starters.length === 0} onClick={() => split(LABELS)}>{t('splitAB')}</button>
        <button className="secondary" disabled={busy || !starters.some((s) => s.group_label)} onClick={() => split([])}>{t('clearGroups')}</button>
      </div>
      <ul className="admin-rows">
        {starters.map((s, i) => {
          const name = localized(lang, s.profile.full_name, s.profile.full_name_he);
          return (
            <li key={`${s.climber_id}:${s.start_order}`} className="admin-row start-row">
              <input className="start-pos" type="number" inputMode="numeric" min={1} max={starters.length} defaultValue={s.start_order ?? i + 1}
                aria-label={`${t('startPlace')}: ${name}`} disabled={busy}
                onBlur={(e) => void move(s, e.currentTarget)}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
              <strong className="start-name">{s.bib ? `${s.bib} · ` : ''}{name}</strong>
              <select value={s.group_label ?? ''} disabled={busy} aria-label={`${t('group')}: ${name}`}
                onChange={(e) => setGroup(s, e.target.value)}>
                <option value="">{t('noGroup')}</option>
                {groups.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <StarterStatus roundId={roundId} starter={s} onDone={onDone} />
            </li>
          );
        })}
      </ul>
      {pending && (
        <Sheet title={t('groupsWarnTitle')} confirm={t('groupsWarnConfirm')} danger
          onConfirm={() => { const act = pending; setPending(null); void act(); }} onCancel={() => setPending(null)}>
          <p>{t('groupsWarnText')}</p>
        </Sheet>
      )}
    </div>
  );
}
