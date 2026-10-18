import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RoundStatus } from '../../components/RoundStatus';
import { climbsRoutes, DISC_LABEL, DISCIPLINES, problemsWord, roundFormatsFor, type Discipline } from '../../lib/discipline';
import { errorText } from '../../lib/errors';
import { localized, useI18n } from '../../lib/i18n';
import { isRankedCompetition, uncountedCategories } from '../../lib/mixedCategories';
import { supabase } from '../../lib/supabase';
import type { Category, Competition, Profile, Round, RoundFormat } from '../../lib/types';
import { AdminNav, ErrorLine } from './AdminHome';
import { AdminLog } from './AdminLog';
import { ClimberPicker } from './ClimberPicker';
import { RosterImport } from './RosterImport';

const KINDS: Round['kind'][] = ['qualification', 'semifinal', 'final'];
const SERIES: Competition['series'][] = ['premier_league', 'premier_league_u17', 'israeli_championship', 'youth_championship', 'other'];
const SERIES_KEY = { premier_league: 'seriesPremier', premier_league_u17: 'seriesPremierU17', israeli_championship: 'seriesChamp',
  youth_championship: 'seriesYouthChamp', other: 'seriesOther' } as const;
type RoundRow = Round & { advance_quota: number | null; boulders: { id: string; number: number }[]; round_starters: { count: number }[] };
interface Registration { category_id: string; climber_id: string; bib: number | null; age_class: string | null; profile: Profile }
export type CategoryRow = Category & { rounds: RoundRow[]; registrations: Registration[] };

export function AdminCompetition() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [comp, setComp] = useState<Competition | null>(null);
  const [cats, setCats] = useState<CategoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newCat, setNewCat] = useState({ name: '', name_he: '', gender: 'female' as Category['gender'] });

  const reload = useCallback(async () => {
    if (!id) return;
    const [{ data: c, error: e1 }, { data: cs, error: e2 }] = await Promise.all([
      supabase.from('competitions').select('*').eq('id', id).single(),
      supabase.from('categories')
        .select('*, rounds(*, boulders(id, number), round_starters(count)), registrations(category_id, climber_id, bib, age_class, profile:profiles(id, full_name, full_name_he, club, country))')
        .eq('competition_id', id).order('name'),
    ]);
    setComp(c as Competition);
    setCats((cs as CategoryRow[]) ?? []);
    setError(errorText(e1 ?? e2, t));
  }, [id, t]);
  useEffect(() => { void reload(); }, [reload]);

  /** Run a mutation, show its error, reload on success. */
  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    setError(errorText(error, t));
    if (!error) await reload();
  };

  if (!comp) return <section><AdminNav /><ErrorLine error={error} /><p className="muted">{t('loading')}</p></section>;

  async function saveComp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? '').trim();
    await run(supabase.from('competitions').update({
      name: v('name'), name_he: v('name_he') || null, venue: v('venue') || null,
      starts_on: v('starts_on'), ends_on: v('ends_on') || v('starts_on'), status: v('status'),
      season: v('season') || null, series: v('series'), discipline: v('discipline') || null,
    }).eq('id', comp!.id));
  }

  async function deleteComp() {
    if (!window.confirm(t('confirmDelete'))) return;
    const { error } = await supabase.from('competitions').delete().eq('id', comp!.id);
    if (error) setError(errorText(error, t)); else navigate('/admin');
  }

  async function addCategory(e: FormEvent) {
    e.preventDefault();
    await run(supabase.from('categories').insert({
      competition_id: comp!.id, name: newCat.name.trim(), name_he: newCat.name_he.trim() || null, gender: newCat.gender,
    }));
    setNewCat({ ...newCat, name: '', name_he: '' });
  }

  return (
    <section>
      <h1>{comp.name_he || comp.name}</h1>
      <AdminNav />
      <ErrorLine error={error} />
      <p><Link to={`/admin/competition/${comp.id}/checklist`}>{t('eventChecklist')}</Link></p>

      <form className="panel form grid-form" onSubmit={saveComp} key={comp.id + comp.status + (comp.discipline ?? '')}>
        <label>{t('nameEn')}<input name="name" required defaultValue={comp.name} /></label>
        <label>{t('nameHe')}<input name="name_he" defaultValue={comp.name_he ?? ''} dir="rtl" /></label>
        <label>{t('venue')}<input name="venue" defaultValue={comp.venue ?? ''} /></label>
        <label>{t('discipline')}
          <select name="discipline" defaultValue={comp.discipline ?? ''}>
            {!comp.discipline && <option value="">{t('disciplineNotSet')}</option>}
            {DISCIPLINES.map((d) => <option key={d} value={d}>{t(DISC_LABEL[d])}</option>)}
          </select>
        </label>
        <label>{t('startsOn')}<input name="starts_on" type="date" required defaultValue={comp.starts_on} /></label>
        <label>{t('endsOn')}<input name="ends_on" type="date" defaultValue={comp.ends_on} /></label>
        <label>{t('status')}
          <select name="status" defaultValue={comp.status}>
            {(['draft', 'published', 'finished'] as const).map((s) => <option key={s} value={s}>{t(s)}</option>)}
          </select>
        </label>
        <label>{t('season')}<input name="season" placeholder="2025-26" pattern="\d{4}-\d{2}" defaultValue={comp.season ?? ''} /></label>
        <label>{t('series')}
          <select name="series" defaultValue={comp.series}>
            {SERIES.map((s) => <option key={s} value={s}>{t(SERIES_KEY[s])}</option>)}
          </select>
        </label>
        <div className="form-actions">
          <button className="primary">{t('save')}</button>
          <button type="button" className="danger" onClick={deleteComp}>{t('delete')}</button>
        </div>
      </form>

      <h2>{t('categories')}</h2>
      {comp.discipline === 'speed' && <p className="notice">{t('speedScoringSoon')}</p>}
      <MixedWarning comp={comp} cats={cats} run={run} />
      {cats.map((c) => <CategoryPanel key={c.id} cat={c} discipline={comp.discipline} run={run} />)}

      <form className="panel form grid-form" onSubmit={addCategory}>
        <h2 className="span-all">{t('newCategory')}</h2>
        <label>{t('nameEn')}<input required value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} /></label>
        <label>{t('nameHe')}<input dir="rtl" value={newCat.name_he} onChange={(e) => setNewCat({ ...newCat, name_he: e.target.value })} /></label>
        <label>{t('gender')}
          <select value={newCat.gender} onChange={(e) => setNewCat({ ...newCat, gender: e.target.value as Category['gender'] })}>
            {(['female', 'male', 'mixed'] as const).map((g) => <option key={g} value={g}>{t(g)}</option>)}
          </select>
        </label>
        <button className="primary">{t('add')}</button>
      </form>

      <RosterImport competitionId={comp.id} categories={cats} ranked={isRankedCompetition(comp)} onDone={reload} />

      <AdminLog by="competition_id" id={comp.id} stamp={cats} roundLabel={new Map(cats.flatMap((c) =>
        c.rounds.map((r) => [r.id, `${localized(lang, c.name, c.name_he)} · ${t(r.kind)}`] as const)))} />
    </section>
  );
}

type Run = (p: PromiseLike<{ error: { message: string } | null }>) => Promise<void>;

/** A ranked competition's mixed-gender categories never count in the national rankings (they rank men and
 * women): warn, and let the admin set the gender right here. */
function MixedWarning({ comp, cats, run }: { comp: Competition; cats: CategoryRow[]; run: Run }) {
  const { t, lang } = useI18n();
  const mixed = uncountedCategories(comp, cats);
  if (mixed.length === 0) return null;
  return (
    <div className="notice mixed-warning" role="status">
      <p>{t('mixedNotRanked')}</p>
      <ul>
        {mixed.map((c) => (
          <li key={c.id}>
            <strong>{localized(lang, c.name, c.name_he)}</strong>{' '}
            <select aria-label={t('gender')} value={c.gender}
              onChange={(e) => void run(supabase.from('categories').update({ gender: e.target.value }).eq('id', c.id))}>
              {(['mixed', 'female', 'male'] as const).map((g) => <option key={g} value={g}>{t(g)}</option>)}
            </select>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CategoryPanel({ cat, discipline, run }: { cat: CategoryRow; discipline: Discipline | null; run: Run }) {
  const { t, lang } = useI18n();
  const rounds = [...cat.rounds].sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
  const missing = KINDS.filter((k) => !rounds.some((r) => r.kind === k));
  const regs = [...cat.registrations].sort((a, b) => (a.bib ?? 1e9) - (b.bib ?? 1e9));

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{localized(lang, cat.name, cat.name_he)} <span className="muted small">{t(cat.gender)}</span></h2>
        <button className="link danger-text" onClick={() => window.confirm(t('confirmDelete')) &&
          run(supabase.from('categories').delete().eq('id', cat.id))}>{t('delete')}</button>
      </div>

      <h3>{t('rounds')}</h3>
      <ul className="admin-rows">
        {rounds.map((r, i) => <RoundRowEditor key={r.id} round={r} first={i === 0} discipline={discipline} run={run} />)}
      </ul>
      {missing.length > 0 && <NewRoundForm key={discipline ?? ''} categoryId={cat.id} missing={missing} discipline={discipline} run={run} />}

      <h3>{t('registrations')} ({regs.length})</h3>
      <table className="admin-table">
        <thead><tr><th>{t('bib')}</th><th>{t('athlete')}</th><th>{t('ageClass')}</th><th>{t('club')}</th><th /></tr></thead>
        <tbody>
          {regs.map((g) => (
            <tr key={g.climber_id}>
              <td>
                <input className="bib-input" type="number" min={1} defaultValue={g.bib ?? ''} onBlur={(e) => {
                  const bib = e.target.value ? Number(e.target.value) : null;
                  if (bib !== g.bib) void run(supabase.from('registrations').update({ bib })
                    .eq('category_id', cat.id).eq('climber_id', g.climber_id));
                }} />
              </td>
              <td>{localized(lang, g.profile.full_name, g.profile.full_name_he)}</td>
              <td>
                <input className="bib-input" aria-label={t('ageClass')} defaultValue={g.age_class ?? ''} onBlur={(e) => {
                  const ageClass = e.target.value.trim() || null;
                  if (ageClass !== g.age_class) void run(supabase.from('registrations').update({ age_class: ageClass })
                    .eq('category_id', cat.id).eq('climber_id', g.climber_id));
                }} />
              </td>
              <td className="muted">{g.profile.club}</td>
              <td><button className="link danger-text" onClick={() =>
                run(supabase.from('registrations').delete().eq('category_id', cat.id).eq('climber_id', g.climber_id))}>
                {t('remove')}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <ClimberPicker
        exclude={new Set(regs.map((g) => g.climber_id))}
        actionLabel={t('register')}
        defaultGender={cat.gender === 'mixed' ? null : cat.gender}
        onPick={(climberId) => run(supabase.from('registrations').insert({
          category_id: cat.id, climber_id: climberId,
          bib: Math.max(0, ...regs.map((g) => g.bib ?? 0)) + 1,
        }))}
      />
    </div>
  );
}

/** Adds a round with its boulders / routes. The scoring defaults from the competition's discipline: lead only
 *  for lead, IFSC 2025 (or classic) for boulder; speed has no scoring yet (the round takes the table default). */
function NewRoundForm({ categoryId, missing, discipline, run }: {
  categoryId: string; missing: Round['kind'][]; discipline: Discipline | null; run: Run;
}) {
  const { t } = useI18n();
  const formats = roundFormatsFor(discipline);
  const [scoring, setScoring] = useState<RoundFormat | null>(formats[0] ?? null);
  const routes = climbsRoutes(discipline, scoring);

  function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const n = Math.min(30, Math.max(0, Number(f.get('count')) || 0));
    void run((async () => {
      const { data, error } = await supabase.from('rounds')
        .insert({ category_id: categoryId, kind: f.get('kind'), ...(scoring ? { scoring } : {}) }).select('id').single();
      if (error) return { error };
      form.reset();
      if (n === 0) return { error: null };
      return supabase.from('boulders').insert(Array.from({ length: n }, (_, i) => ({ round_id: data.id, number: i + 1 })));
    })());
  }

  return (
    <form className="inline-form" onSubmit={add}>
      <select name="kind" aria-label={t('round')}>{missing.map((k) => <option key={k} value={k}>{t(k)}</option>)}</select>
      {formats.length > 1 && (
        <select name="scoring" aria-label={t('scoring')} value={scoring ?? ''} onChange={(e) => setScoring(e.target.value as RoundFormat)}>
          {formats.map((s) => <option key={s} value={s}>{t(s)}</option>)}
        </select>
      )}
      {formats.length === 1 && <span className="muted">{t(formats[0])}</span>}
      <label className="inline">{t(problemsWord(routes))}
        <input name="count" className="bib-input" type="number" min={0} max={30} />
      </label>
      <button className="secondary">{t('addRound')}</button>
    </form>
  );
}

function RoundRowEditor({ round, first, discipline, run }: { round: RoundRow; first: boolean; discipline: Discipline | null; run: Run }) {
  const { t } = useI18n();
  const count = round.boulders.length;
  const routes = climbsRoutes(discipline, round.scoring);
  // The formats this competition offers, plus the round's own if it differs (an older round, a changed discipline).
  const formats = roundFormatsFor(discipline);
  const shownFormats = discipline === 'speed' ? [] : formats.includes(round.scoring) ? formats : [...formats, round.scoring];

  async function setBoulderCount(n: number) {
    if (n === count || n < 0 || n > 30) return;
    if (n > count) {
      const have = new Set(round.boulders.map((b) => b.number));
      const add = Array.from({ length: n }, (_, i) => i + 1).filter((k) => !have.has(k))
        .slice(0, n - count).map((number) => ({ round_id: round.id, number }));
      await run(supabase.from('boulders').insert(add));
    } else {
      // Deleting a boulder deletes its results (cascade): only allow if none were entered.
      const drop = round.boulders.filter((b) => b.number > n).map((b) => b.id);
      const { count: scored } = await supabase.from(round.scoring === 'lead' ? 'lead_results' : 'boulder_results').select('boulder_id', { count: 'exact', head: true })
        .in('boulder_id', drop);
      if (scored) { await run(Promise.resolve({ error: { message: `${t(problemsWord(routes))}: results exist` } })); return; }
      await run(supabase.from('boulders').delete().in('id', drop));
    }
  }

  const status = (s: Round['status']) => run(supabase.from('rounds').update({ status: s }).eq('id', round.id));

  return (
    <li className="admin-row">
      <strong>{t(round.kind)}</strong>
      <RoundStatus status={round.status} />
      <label className="inline">{t(problemsWord(routes))}
        <input className="bib-input" type="number" min={0} max={30} defaultValue={count} key={count}
          onBlur={(e) => void setBoulderCount(Number(e.target.value))} />
      </label>
      {shownFormats.length > 0 && (
        <select aria-label={t('scoring')} value={round.scoring} onChange={(e) => void run(supabase.from('rounds').update({ scoring: e.target.value }).eq('id', round.id))}>
          {shownFormats.map((s) => <option key={s} value={s}>{t(s)}</option>)}
        </select>
      )}
      {round.status === 'planned' && <button className="secondary" onClick={() => void status('live')}>{t('goLive')}</button>}
      {round.status === 'live' && <button className="secondary" onClick={() => void status('closed')}>{t('closeRound')}</button>}
      {/* Reopen a closed round: live again (planned would hide it from the public and the rankings). */}
      {round.status === 'closed' && <button className="link" onClick={() => window.confirm(t('confirmReopen')) && void status('live')}>{t('reopen')}</button>}
      {round.status === 'live' && <button className="link" onClick={() => window.confirm(t('confirmBackToPlanned')) && void status('planned')}>{t('backToPlanned')}</button>}
      <span className="muted">{t('starters')}: {round.round_starters[0]?.count ?? 0}</span>
      {!first && (
        <>
          <label className="inline">{t('advanceQuota')}
            <input className="bib-input" type="number" min={1} defaultValue={round.advance_quota ?? ''} key={round.advance_quota ?? 'all'}
              onBlur={(e) => {
                const q = e.target.value ? Number(e.target.value) : null;
                if (q !== round.advance_quota) void run(supabase.from('rounds').update({ advance_quota: q }).eq('id', round.id));
              }} />
          </label>
          <button className="secondary" onClick={() => void run(supabase.rpc('generate_start_list', { p_round: round.id }))}>
            {t('generateStartList')}
          </button>
        </>
      )}
      <Link to={`/admin/round/${round.id}`}>{t('manageRound')}</Link>
      <button className="link danger-text" onClick={() => window.confirm(t('confirmDelete')) &&
        run(supabase.from('rounds').delete().eq('id', round.id))}>{t('delete')}</button>
    </li>
  );
}
