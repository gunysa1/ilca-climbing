import { formatDate } from '../lib/dates';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { climberEvents, climberStats, type ClimberEvent } from '../lib/climberStats';
import { DISCIPLINES, type Discipline } from '../lib/discipline';
import { localized, useI18n } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import type { HistoryEntry, HistoryRow } from '../lib/types';

const DISC_KEY = { boulder: 'discBoulder', lead: 'discLead', speed: 'discSpeed' } as const;
const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

/** A climber's history rows (all disciplines; RLS returns only public/allowed rounds). */
export function useClimberHistory(climberId: string | undefined): HistoryRow[] | null {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  useEffect(() => {
    if (!climberId) return;
    setRows(null);
    // climber_history_for() computes only this climber's rounds (the climber_history view ranks every round)
    supabase.rpc('climber_history_for', { p_climbers: [climberId] })
      .then(({ data }) => setRows(((data as HistoryRow[]) ?? []).filter((r) => r.round_status !== 'planned')));
  }, [climberId]);
  return rows;
}

/**
 * A climber's results for ONE discipline: stats (events, medals, best, finals) and one line per
 * event with the placing and links to each round. Disciplines are never mixed.
 * Without a `discipline` prop it shows its own tabs (my history, coach view); the public climber
 * page passes the bottom-bar choice instead, and the rows it already loaded (climber_page).
 */
export function History({ climberId, discipline, rows: preloaded, ranked }: { climberId: string; discipline?: Discipline; rows?: HistoryEntry[]; ranked?: ReadonlyMap<string, boolean> }) {
  const { t } = useI18n();
  const loaded = useClimberHistory(preloaded ? undefined : climberId);
  const rows = preloaded ?? loaded;
  const events = useMemo(() => climberEvents(rows ?? []), [rows]);
  const available = DISCIPLINES.filter((d) => events.some((e) => e.discipline === d));
  const [tab, setTab] = useState<Discipline | null>(null);
  const current = discipline ?? tab ?? available[0] ?? 'boulder';

  if (rows === null) return <p className="muted">{t('loading')}</p>;
  return (
    <>
      {!discipline && available.length > 1 && (
        <div className="chips" role="tablist">
          {available.map((d) => (
            <button key={d} role="tab" aria-selected={d === current} className={`chip ${d === current ? 'selected' : ''}`}
              onClick={() => setTab(d)}>{t(DISC_KEY[d])}</button>
          ))}
        </div>
      )}
      <DisciplineResults events={events.filter((e) => e.discipline === current)} ranked={ranked} />
    </>
  );
}

function DisciplineResults({ events, ranked }: { events: ClimberEvent[]; ranked?: ReadonlyMap<string, boolean> }) {
  const { t, lang } = useI18n();
  if (events.length === 0) return <p className="muted">{t('empty')}</p>;
  const s = climberStats(events);
  return (
    <>
      <div className="stats climber-stats">
        <div className="stat"><span className="stat-value">{s.events}</span><span className="muted">{t('competitions')}</span></div>
        <div className="stat"><span className="stat-value">{s.best ?? '–'}</span><span className="muted">{t('bestRank')}</span></div>
        <div className="stat"><span className="stat-value">{s.finals}</span><span className="muted">{t('finals')}</span></div>
        <div className="stat medals"><span className="stat-value">🥇{s.gold} 🥈{s.silver} 🥉{s.bronze}</span><span className="muted">{t('podiums')}</span></div>
      </div>
      <ul className="event-list">
        {events.map((e) => {
          // undefined = unknown (callers without the competitions list): no tag, no muting
          const counts = ranked?.get(e.competition_id);
          return (
          <li key={e.key} className={`event${counts === false ? ' event-unranked' : ''}`}>
            <span className="event-place">{e.placing != null ? (MEDAL[e.placing] ?? e.placing) : '–'}</span>
            <span className="event-main">
              <span className="event-title">
                {localized(lang, e.competition, e.competition_he)}
                {counts != null && <span className={`badge rank-tag${counts ? ' counts' : ''}`}>{t(counts ? 'rankedEvent' : 'unrankedEvent')}</span>}
              </span>
              <span className="muted small">
                {formatDate(e.starts_on, lang)} · {localized(lang, e.category, e.category_he)}
                {e.placing != null && e.field ? ` · ${e.placing}/${e.field}` : ''}
              </span>
              <span className="event-rounds">
                {e.rounds.map((r) => (
                  <Link key={r.round_id} to={`/round/${r.round_id}`} className="round-pill">
                    {t(r.round)} {r.rank ?? '–'}
                  </Link>
                ))}
              </span>
            </span>
          </li>
          );
        })}
      </ul>
    </>
  );
}
