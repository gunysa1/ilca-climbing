import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RoundStatus } from '../../components/RoundStatus';
import { localized, useI18n } from '../../lib/i18n';
import { isRankedCompetition, uncountedCategories } from '../../lib/mixedCategories';
import { supabase } from '../../lib/supabase';
import type { Category, Competition, Profile, Round } from '../../lib/types';
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
    setError(e1?.message ?? e2?.message ?? null);
  }, [id]);
  useEffect(() => { void reload(); }, [reload]);

  /** Run a mutation, show its error, reload on success. */
  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    setError(error?.message ?? null);
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
      season: v('season') || null, series: v('series'),
    }).eq('id', comp!.id));
  }

  async function deleteComp() {
    if (!window.confirm(t('confirmDelete'))) return;
    const { error } = await supabase.from('competitions').delete().eq('id', comp!.id);
    if (error) setError(error.message); else navigate('/admin');
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

      <form className="panel form grid-form" onSubmit={saveComp} key={comp.id + comp.status}>
        <label>{t('nameEn')}<input name="name" required defaultValue={comp.name} /></label>
        <label>{t('nameHe')}<input name="name_he" defaultValue={comp.name_he ?? ''} dir="rtl" /></label>
        <label>{t('venue')}<input name="venue" defaultValue={comp.venue ?? ''} /></label>
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
      <MixedWarning comp={comp} cats={cats} run={run} />
      {cats.map((c) => <CategoryPanel key={c.id} cat={c} run={run} />)}

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

function CategoryPanel({ cat, run }: { cat: CategoryRow; run: Run }) {
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
        {rounds.map((r, i) => <RoundRowEditor key={r.id} round={r} first={i === 0} run={run} />)}
      </ul>
      {missing.length > 0 && (
        <form className="inline-form" onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void run(supabase.from('rounds').insert({ category_id: cat.id, kind: f.get('kind'), scoring: f.get('scoring') }));
        }}>
          <select name="kind">{missing.map((k) => <option key={k} value={k}>{t(k)}</option>)}</select>
          <select name="scoring"><option value="ifsc2025">{t('ifsc2025')}</option><option value="classic">{t('classic')}</option><option value="lead">{t('lead')}</option></select>
          <button className="secondary">{t('addRound')}</button>
        </form>
      )}

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

function RoundRowEditor({ round, first, run }: { round: RoundRow; first: boolean; run: Run }) {
  const { t } = useI18n();
  const count = round.boulders.length;

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
      if (scored) { await run(Promise.resolve({ error: { message: `${t('boulders')}: results exist` } })); return; }
      await run(supabase.from('boulders').delete().in('id', drop));
    }
  }

  const status = (s: Round['status']) => run(supabase.from('rounds').update({ status: s }).eq('id', round.id));

  return (
    <li className="admin-row">
      <strong>{t(round.kind)}</strong>
      <RoundStatus status={round.status} />
      <label className="inline">{t(round.scoring === 'lead' ? 'routes' : 'boulders')}
        <input className="bib-input" type="number" min={0} max={30} defaultValue={count} key={count}
          onBlur={(e) => void setBoulderCount(Number(e.target.value))} />
      </label>
      <select value={round.scoring} onChange={(e) => void run(supabase.from('rounds').update({ scoring: e.target.value }).eq('id', round.id))}>
        <option value="ifsc2025">{t('ifsc2025')}</option>
        <option value="classic">{t('classic')}</option>
        <option value="lead">{t('lead')}</option>
      </select>
      {round.status === 'planned' && <button className="secondary" onClick={() => void status('live')}>{t('goLive')}</button>}
      {round.status === 'live' && <button className="secondary" onClick={() => void status('closed')}>{t('closeRound')}</button>}
      {round.status !== 'planned' && <button className="link" onClick={() => void status('planned')}>{t('reopen')}</button>}
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
