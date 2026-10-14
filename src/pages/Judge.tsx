import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { localized, useI18n } from '../lib/i18n';
import { formatHeight } from '../lib/lead';
import { resultKey, useRoundData, type LeadRow, type Starter } from '../lib/roundData';
import { applyAction, EMPTY_RESULT, type BoulderResult, type JudgeAction } from '../lib/scoring';
import { supabase } from '../lib/supabase';
import { LEAD_COLUMNS, RESULT_COLUMNS, type Boulder, type RoundFormat } from '../lib/types';

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
    supabase.from('judge_assignments')
      .select('id, round_id, boulder_id, round:rounds!inner(kind, status, scoring, boulders(id, round_id, number), category:categories(name, name_he, competition:competitions(name, name_he)))')
      .eq('judge_id', profileId).eq('round.status', 'live')
      .then(({ data }) => setItems((data as unknown as Assignment[]) ?? []));
  }, [profileId]);

  return (
    <section>
      <h1>{t('myAssignments')}</h1>
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

/** Scoring pad for one boulder: pick a climber, record attempts / zone / top. */
export function JudgeBoulder() {
  const { roundId, boulderId } = useParams();
  const { t, lang } = useI18n();
  const { round, boulders, starters, results, leadResults, loading } = useRoundData(roundId);
  const [current, setCurrent] = useState<Starter | null>(null);
  const boulder = boulders.find((b) => b.id === boulderId);

  if (loading) return <p className="muted">{t('loading')}</p>;
  if (!boulder) return <p className="notice">{t('noAccess')}</p>;

  return (
    <section>
      <h1>{t(round?.scoring === 'lead' ? 'route' : 'boulder')} {boulder.number}</h1>
      <div className="judge-layout">
        <ul className="starter-list">
          {starters.map((s) => {
            const r = results.get(resultKey(boulder.id, s.climber_id));
            const l = leadResults.get(resultKey(boulder.id, s.climber_id));
            return (
              <li key={s.climber_id}>
                <button className={current?.climber_id === s.climber_id ? 'selected' : ''} onClick={() => setCurrent(s)}>
                  <span className="bib">{s.bib ?? '–'}</span>
                  <span>{localized(lang, s.profile.full_name, s.profile.full_name_he)}</span>
                  <span className="muted small">{l ? formatHeight(l) : r ? `${r.top_attempt ? 'T' + r.top_attempt : ''} ${r.zone_attempt ? 'Z' + r.zone_attempt : ''} · ${r.attempts}` : ''}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {current && round?.scoring === 'lead' && (
          <LeadPad
            key={current.climber_id}
            roundId={roundId!}
            routeId={boulder.id}
            starter={current}
            initial={leadResults.get(resultKey(boulder.id, current.climber_id))}
          />
        )}
        {current && round?.scoring !== 'lead' && (
          <ScorePad
            key={current.climber_id}
            roundId={roundId!}
            boulderId={boulder.id}
            starter={current}
            initial={results.get(resultKey(boulder.id, current.climber_id)) ?? EMPTY_RESULT}
          />
        )}
      </div>
    </section>
  );
}

function ScorePad({ roundId, boulderId, starter, initial }:
  { roundId: string; boulderId: string; starter: Starter; initial: BoulderResult }) {
  const { t, lang } = useI18n();
  const [history, setHistory] = useState<BoulderResult[]>([]);
  const [state, setState] = useState<BoulderResult>({
    attempts: initial.attempts, zone_attempt: initial.zone_attempt, top_attempt: initial.top_attempt,
  });
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function save(next: BoulderResult, prev: BoulderResult) {
    setStatus('saving');
    const { error } = await supabase.from('boulder_results').upsert(
      { boulder_id: boulderId, climber_id: starter.climber_id, round_id: roundId, ...next },
      { onConflict: 'boulder_id,climber_id' },
    ).select(RESULT_COLUMNS);
    if (error) { setState(prev); setStatus('error'); } else setStatus('saved');
  }

  function act(action: JudgeAction) {
    const next = applyAction(state, action);
    if (next === state) return;
    setHistory((h) => [...h, state]);
    setState(next);
    void save(next, state);
  }

  function undo() {
    const prev = history.at(-1);
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    const before = state;
    setState(prev);
    void save(prev, before);
  }

  return (
    <div className="pad">
      <h2>{localized(lang, starter.profile.full_name, starter.profile.full_name_he)}</h2>
      <div className="pad-readout">
        <div><span className="muted">{t('attempt')}</span><strong>{state.attempts}</strong></div>
        <div><span className="muted">{t('zone')}</span><strong>{state.zone_attempt ?? '–'}</strong></div>
        <div><span className="muted">{t('top')}</span><strong>{state.top_attempt ?? '–'}</strong></div>
      </div>
      <div className="pad-buttons">
        <button className="pad-attempt" onClick={() => act('attempt')} disabled={state.top_attempt != null}>+1 {t('attempt')}</button>
        <button className="pad-zone" onClick={() => act('zone')} disabled={state.zone_attempt != null}>{t('zone')}</button>
        <button className="pad-top" onClick={() => act('top')} disabled={state.top_attempt != null}>{t('top')}</button>
        <button className="pad-undo" onClick={undo} disabled={history.length === 0}>{t('undo')}</button>
      </div>
      <p className={`pad-status ${status}`} aria-live="polite">
        {status === 'saved' ? t('saved') : status === 'error' ? t('saveFailed') : status === 'saving' ? '…' : ''}
      </p>
    </div>
  );
}

/** Lead pad for one route: the judge records the final height (hold, + or TOP) and saves it. */
function LeadPad({ roundId, routeId, starter, initial }:
  { roundId: string; routeId: string; starter: Starter; initial: LeadRow | undefined }) {
  const { t, lang } = useI18n();
  const [hold, setHold] = useState(initial?.hold ?? 0);
  const [plus, setPlus] = useState(initial?.plus ?? false);
  const [top, setTop] = useState(initial?.top ?? false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const changed = () => setStatus('idle');

  async function save() {
    setStatus('saving');
    const { error } = await supabase.from('lead_results').upsert(
      { boulder_id: routeId, climber_id: starter.climber_id, round_id: roundId, hold, plus: top ? false : plus, top },
      { onConflict: 'boulder_id,climber_id' },
    ).select(LEAD_COLUMNS);
    setStatus(error ? 'error' : 'saved');
  }

  return (
    <div className="pad">
      <h2>{localized(lang, starter.profile.full_name, starter.profile.full_name_he)}</h2>
      <div className="pad-readout lead-readout">
        <div><span className="muted">{t('hold')}</span><strong dir="ltr">{formatHeight({ hold, plus, top })}</strong></div>
      </div>
      <div className="pad-buttons">
        <button className="pad-undo" onClick={() => { setHold((h) => Math.max(0, h - 1)); changed(); }} disabled={top || hold === 0}>−1</button>
        <button className="pad-attempt" onClick={() => { setHold((h) => h + 1); changed(); }} disabled={top}>+1 {t('hold')}</button>
        <button className="pad-zone" aria-pressed={plus} onClick={() => { setPlus((p) => !p); changed(); }} disabled={top}>{t('plusMove')}</button>
        <button className="pad-top" aria-pressed={top} onClick={() => { setTop((v) => !v); setPlus(false); changed(); }}>TOP</button>
      </div>
      <button className="primary pad-save" onClick={() => void save()} disabled={status === 'saving'}>{t('save')}</button>
      <p className={`pad-status ${status}`} aria-live="polite">
        {status === 'saved' ? t('saved') : status === 'error' ? t('saveFailed') : status === 'saving' ? '…' : ''}
      </p>
    </div>
  );
}
