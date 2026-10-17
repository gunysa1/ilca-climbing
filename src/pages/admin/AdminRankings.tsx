import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { localized, useI18n } from '../../lib/i18n';
import {
  RANK_CLASSES, seniorIntlPoints, youthBonusPoints, type Adjustment, type IntlEventType, type IntlResult,
} from '../../lib/rankings';
import { seasonOf } from '../../lib/season';
import { supabase } from '../../lib/supabase';
import type { Profile } from '../../lib/types';
import { AdminNav, ErrorLine } from './AdminHome';
import { ClimberPicker } from './ClimberPicker';

const EVENT_TYPES: IntlEventType[] = ['world_cup', 'world_championship', 'european_cup', 'european_championship',
  'european_youth_cup', 'european_youth_championship', 'world_youth_championship', 'manual'];
const KINDS = ['qualification', 'semifinal', 'final'] as const;

type IntlRow = IntlResult & { id: string; season: string };
type AdjustmentRow = Adjustment & { id: string; season: string };

/** Season ranking inputs that aren't ILCA competitions: international results and adjustments. */
export function AdminRankings() {
  const { t, lang } = useI18n();
  const [season, setSeason] = useState(() => seasonOf(new Date()));
  const [intl, setIntl] = useState<IntlRow[]>([]);
  const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([]);
  const [names, setNames] = useState(new Map<string, Profile>());
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [{ data: i, error: e1 }, { data: a, error: e2 }] = await Promise.all([
      supabase.from('international_results').select('*').eq('season', season).order('starts_on'),
      supabase.from('ranking_adjustments').select('*').eq('season', season).order('created_at'),
    ]);
    setIntl(((i ?? []) as IntlRow[]).map((r) => ({ ...r, points: r.points == null ? null : Number(r.points) })));
    setAdjustments(((a ?? []) as AdjustmentRow[]).map((r) => ({ ...r, points: Number(r.points) })));
    setError(e1?.message ?? e2?.message ?? null);
    const ids = [...new Set([...(i ?? []), ...(a ?? [])].map((r) => r.climber_id as string))];
    if (ids.length) {
      const { data: ps } = await supabase.from('profiles').select('id, full_name, full_name_he, club, country').in('id', ids);
      setNames(new Map(((ps ?? []) as Profile[]).map((p) => [p.id, p])));
    }
  }, [season]);
  useEffect(() => { void reload(); }, [reload]);

  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    setError(error?.message ?? null);
    if (!error) await reload();
    return !error;
  };
  const name = (id: string) => { const p = names.get(id); return p ? localized(lang, p.full_name, p.full_name_he) : id.slice(0, 8); };

  return (
    <section>
      <h1>{t('rankings')}</h1>
      <AdminNav />
      <ErrorLine error={error} />
      <label className="inline-form">{t('season')}
        <input value={season} pattern="\d{4}-\d{2}" onChange={(e) => setSeason(e.target.value)} placeholder="2025-26" />
      </label>

      <h2>{t('intlResults')}</h2>
      <div className="table-wrap">
        <table className="results">
          <tbody>
            {intl.map((r) => (
              <tr key={r.id}>
                <td className="name">
                  <strong>{name(r.climber_id)}</strong>
                  <span className="athlete-meta">
                    {t(r.discipline === 'boulder' ? 'discBoulder' : 'discLead')} · {t(r.event_type)} · {r.event_name} · {r.starts_on}
                    {r.event_type === 'manual' ? ` · ${t(r.for_class === 'senior' ? 'seniors' : 'youthRanking')}`
                      : ` · ${r.place}/${r.field_size} · ${t(r.reached)}`}
                  </span>
                </td>
                <td className="score">{r.event_type === 'manual' ? r.points : Math.max(seniorIntlPoints(r), youthBonusPoints(r))}</td>
                <td><button className="link danger" onClick={() => run(supabase.from('international_results').delete().eq('id', r.id))}>{t('delete')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <IntlForm season={season} onAdd={(row) => run(supabase.from('international_results').insert(row))} />

      <h2>{t('adjustments')}</h2>
      <ul className="event-list">
        {adjustments.map((a) => (
          <li key={a.id} className="event">
            <span className="event-main">
              <span className="event-title">{name(a.climber_id)} · {a.points > 0 ? '+' : ''}{a.points}</span>
              <span className="muted small">{t(a.discipline === 'boulder' ? 'discBoulder' : 'discLead')} · {a.rank_class ?? t('allClasses')} · {a.note}</span>
            </span>
            <button className="link danger" onClick={() => run(supabase.from('ranking_adjustments').delete().eq('id', a.id))}>{t('delete')}</button>
          </li>
        ))}
      </ul>
      <AdjustmentForm season={season} onAdd={(row) => run(supabase.from('ranking_adjustments').insert(row))} />
    </section>
  );
}


function PickedClimber({ id, onPick }: { id: string | null; onPick: (id: string) => void }) {
  const { t, lang } = useI18n();
  const [p, setP] = useState<Profile | null>(null);
  useEffect(() => {
    if (!id) { setP(null); return; }
    supabase.from('profiles').select('id, full_name, full_name_he, club, country').eq('id', id).single().then(({ data }) => setP(data as Profile));
  }, [id]);
  const none = useMemo(() => new Set<string>(), []);
  return (
    <div className="span-all">
      {p ? <p><strong>{localized(lang, p.full_name, p.full_name_he)}</strong> <span className="muted small">{p.club}</span></p>
        : <p className="muted">{t('selectClimber')}</p>}
      <ClimberPicker exclude={none} actionLabel={t('selectClimber')} defaultGender={null} onPick={onPick} />
    </div>
  );
}

function IntlForm({ season, onAdd }: { season: string; onAdd: (row: Record<string, unknown>) => Promise<boolean> }) {
  const { t } = useI18n();
  const [climber, setClimber] = useState<string | null>(null);
  const [type, setType] = useState<IntlEventType>('world_cup');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!climber) return;
    const form = e.currentTarget;
    const f = new FormData(form);
    const v = (k: string) => String(f.get(k) ?? '').trim();
    const manual = type === 'manual';
    const ok = await onAdd({
      climber_id: climber, season, discipline: v('discipline'), event_type: type, event_name: v('event_name'), starts_on: v('starts_on'),
      place: manual ? null : Number(v('place')), field_size: manual ? null : Number(v('field_size')),
      reached: manual ? 'qualification' : v('reached'),
      points: manual ? Number(v('points')) : null, for_class: manual ? v('for_class') : null,
    });
    if (ok) form.reset();
  }
  return (
    <form className="panel form grid-form" onSubmit={submit}>
      <PickedClimber id={climber} onPick={setClimber} />
      <label>{t('discipline')}
        <select name="discipline"><option value="boulder">{t('discBoulder')}</option><option value="lead">{t('discLead')}</option></select>
      </label>
      <label>{t('eventType')}
        <select value={type} onChange={(e) => setType(e.target.value as IntlEventType)}>
          {EVENT_TYPES.map((k) => <option key={k} value={k}>{t(k)}</option>)}
        </select>
      </label>
      <label>{t('eventName')}<input name="event_name" required /></label>
      <label>{t('startsOn')}<input name="starts_on" type="date" required /></label>
      {type === 'manual' ? <>
        <label>{t('points')}<input name="points" type="number" step="0.01" required /></label>
        <label>{t('forClass')}
          <select name="for_class"><option value="youth">{t('youthRanking')}</option><option value="senior">{t('seniors')}</option></select>
        </label>
      </> : <>
        <label>{t('place')}<input name="place" type="number" min={1} required /></label>
        <label>{t('fieldSize')}<input name="field_size" type="number" min={1} required /></label>
        <label>{t('reached')}
          <select name="reached">{KINDS.map((k) => <option key={k} value={k}>{t(k)}</option>)}</select>
        </label>
      </>}
      <div className="form-actions"><button className="primary" disabled={!climber}>{t('add')}</button></div>
    </form>
  );
}

function AdjustmentForm({ season, onAdd }: { season: string; onAdd: (row: Record<string, unknown>) => Promise<boolean> }) {
  const { t } = useI18n();
  const [climber, setClimber] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!climber) return;
    const form = e.currentTarget;
    const f = new FormData(form);
    const v = (k: string) => String(f.get(k) ?? '').trim();
    const ok = await onAdd({ climber_id: climber, season, discipline: v('discipline'), rank_class: v('rank_class') || null,
      points: Number(v('points')), note: v('note') });
    if (ok) form.reset();
  }
  return (
    <form className="panel form grid-form" onSubmit={submit}>
      <PickedClimber id={climber} onPick={setClimber} />
      <label>{t('discipline')}
        <select name="discipline"><option value="boulder">{t('discBoulder')}</option><option value="lead">{t('discLead')}</option></select>
      </label>
      <label>{t('ageClass')}
        <select name="rank_class">
          <option value="">{t('allClasses')}</option>
          {RANK_CLASSES.map((c) => <option key={c} value={c}>{c === 'senior' ? t('seniors') : c}</option>)}
        </select>
      </label>
      <label>{t('points')}<input name="points" type="number" step="0.01" required /></label>
      <label>{t('note')}<input name="note" required /></label>
      <div className="form-actions"><button className="primary" disabled={!climber}>{t('add')}</button></div>
    </form>
  );
}
