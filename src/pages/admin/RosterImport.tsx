import { useState } from 'react';
import { errorText } from '../../lib/errors';
import { useI18n } from '../../lib/i18n';
import { parseRoster, planImport, type ImportPlan, type RosterError } from '../../lib/roster';
import { allRows } from '../../lib/allRows';
import { supabase } from '../../lib/supabase';
import type { CategoryRow } from './AdminCompetition';
import { ErrorLine } from './AdminHome';

const HEBREW = /[֐-׿]/;

export function RosterImport({ competitionId, categories, onDone }: {
  competitionId: string; categories: CategoryRow[]; onDone: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [rowErrors, setRowErrors] = useState<RosterError[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function load(file: File) {
    setDone(false); setError(null);
    const { rows, errors } = parseRoster(await file.text());
    setRowErrors(errors);
    // All profiles (over 1000): a climber missing here would be created twice.
    let profiles: { id: string; full_name: string; full_name_he: string | null; club: string | null }[];
    try {
      profiles = await allRows((from, to) => supabase.from('profiles').select('id, full_name, full_name_he, club').order('id').range(from, to));
    } catch (e) { return setError(errorText(e, t)); }
    setPlan(planImport(rows, {
      categories,
      profiles,
      registrations: categories.flatMap((c) => c.registrations.map((r) => ({ category_id: c.id, climber_id: r.climber_id }))),
    }));
  }

  async function apply() {
    if (!plan) return;
    setBusy(true); setError(null);
    try {
      // Client-generated ids let us map plan keys to rows without relying on insert order.
      const ids = new Map<string, string>();
      const newCats = plan.newCategories.map((c) => {
        const id = crypto.randomUUID(); ids.set(c.key, id);
        return { id, competition_id: competitionId, name: c.name, name_he: HEBREW.test(c.name) ? c.name : null, gender: c.gender };
      });
      const newProfiles = plan.newProfiles.map(({ key, row }) => {
        const id = crypto.randomUUID(); ids.set(key, id);
        return { id, full_name: row.name, full_name_he: HEBREW.test(row.name) ? row.name : null, club: row.club || null, gender: row.gender };
      });
      const privates = plan.newProfiles.map(({ key, row }) => ({ id: ids.get(key)!, birth_date: row.birthDate, email: row.email }));
      const regs = plan.registrations.map((r) => ({
        category_id: ids.get(r.category) ?? r.category, climber_id: ids.get(r.climber) ?? r.climber, bib: r.bib, age_class: r.ageClass,
      }));
      // One transaction (public.import_roster): a failing row rolls back the whole import.
      const { error } = await supabase.rpc('import_roster', {
        p_categories: newCats, p_profiles: newProfiles, p_private: privates, p_registrations: regs,
      });
      if (error) throw error;
      setPlan(null); setDone(true);
      await onDone();
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>{t('importRoster')}</h2>
      <p className="muted small">{t('importHint')}</p>
      <input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); }} />
      <ErrorLine error={error} />
      {done && <p className="success">{t('importDone')}</p>}
      {rowErrors.length > 0 && (
        <p className="error">{t('rowErrors')}: {rowErrors.map((e) => `${t('line')} ${e.line}: ${e.message}`).join(' · ')}</p>
      )}
      {plan && (
        <div className="import-preview">
          <h3>{t('importPreview')}</h3>
          <ul>
            <li>{t('willCreateCategories')}: {plan.newCategories.length}
              {plan.newCategories.length > 0 && <span className="muted"> ({plan.newCategories.map((c) => `${c.name} · ${t(c.gender)}`).join(', ')})</span>}
            </li>
            <li>{t('willCreateProfiles')}: {plan.newProfiles.length}</li>
            <li>{t('willRegister')}: {plan.registrations.length}</li>
            {plan.skipped.length > 0 && (
              <li>{t('skippedRows')}: {plan.skipped.map((s) => `${t('line')} ${s.line} (${s.reason})`).join(', ')}</li>
            )}
          </ul>
          <button className="primary" disabled={busy || plan.registrations.length === 0} onClick={() => void apply()}>
            {t('importApply')}
          </button>
        </div>
      )}
    </div>
  );
}
