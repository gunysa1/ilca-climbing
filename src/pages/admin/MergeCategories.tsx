import { useEffect, useState } from 'react';
import { Sheet } from '../../components/Sheet';
import { errorText } from '../../lib/errors';
import { localized, useI18n } from '../../lib/i18n';
import { categoryConflictText, type CategoryMergeReport } from '../../lib/mergeCategories';
import { supabase } from '../../lib/supabase';
import type { Category } from '../../lib/types';
import { ErrorLine } from './AdminHome';
import { fill } from './ifscSync';

/** Merge two categories of the competition (merge_categories, migration 051): pick the one to keep and the one
 *  to merge into it, see who moves and what stands in the way, confirm in a sheet, then reload the page. */
export function MergeCategories({ cats, onDone }: { cats: Category[]; onDone: () => Promise<void> }) {
  const { t, lang } = useI18n();
  const [keepId, setKeepId] = useState('');
  const [dropId, setDropId] = useState('');
  const [report, setReport] = useState<CategoryMergeReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stamp, setStamp] = useState(0);  // re-run the preview after a refused merge

  const name = (c: { name: string; name_he: string | null } | null | undefined) => (c ? localized(lang, c.name, c.name_he) : '');
  const keep = cats.find((c) => c.id === keepId);
  const drop = cats.find((c) => c.id === dropId);

  useEffect(() => {
    setReport(null);
    if (!keepId || !dropId || keepId === dropId) return;
    let live = true;
    void supabase.rpc('merge_categories', { p_keep: keepId, p_drop: dropId }).then(({ data, error }) => {
      if (!live) return;
      if (error) setError(errorText(error, t));
      setReport((data as CategoryMergeReport | null) ?? null);
    });
    return () => { live = false; };
  }, [keepId, dropId, stamp, t]);

  async function merge() {
    if (!report?.keep || !report.drop) return;
    setConfirming(false); setBusy(true); setError(null); setDone(null);
    const { error } = await supabase.rpc('merge_categories', { p_keep: report.keep.id, p_drop: report.drop.id, p_apply: true });
    setBusy(false);
    if (error) { setError(`${t('mergeRefused')} ${errorText(error, t)}`); setStamp((s) => s + 1); return; }
    setDone(fill(t('mergeCatsDone'), { n: report.moving.length, keep: name(report.keep) }));
    setKeepId(''); setDropId('');
    await onDone();
  }

  const picker = (label: string, value: string, set: (v: string) => void, other: string) => (
    <label>{label}
      <select value={value} onChange={(e) => { setError(null); setDone(null); set(e.target.value); }}>
        <option value="">{t('mergeCatsChoose')}</option>
        {cats.filter((c) => c.id !== other).map((c) => <option key={c.id} value={c.id}>{name(c)} ({t(c.gender)})</option>)}
      </select>
    </label>
  );

  const canMerge = report && !report.applied && report.conflicts.length === 0 && report.keep && report.drop && !busy;

  return (
    <div className="panel merge-categories">
      <h2>{t('mergeCats')}</h2>
      <p className="muted">{t('mergeCatsIntro')}</p>
      <ErrorLine error={error} />
      {done && <p className="notice" role="status">✓ {done}</p>}
      <div className="form grid-form">
        {picker(t('mergeCatsKeep'), keepId, setKeepId, dropId)}
        {picker(t('mergeCatsDrop'), dropId, setDropId, keepId)}
      </div>

      {report && keep && drop && (
        <>
          {report.moving.length === 0 ? <p className="muted">{t('mergeCatsNobody')}</p> : (
            <>
              <p>{fill(t('mergeCatsMoving'), { n: report.moving.length, keep: name(keep) })}</p>
              <ul className="admin-rows">
                {report.moving.map((m) => (
                  <li key={m.climber_id} className="admin-row">
                    <span className="muted">{m.bib ?? '—'}</span>
                    <span>{localized(lang, m.full_name, m.full_name_he)}</span>
                    {m.age_class && <span className="muted small">{m.age_class}</span>}
                  </li>
                ))}
              </ul>
              {report.moving.some((m) => m.age_class === (drop.name_he || drop.name)) && (
                <p className="muted small">{fill(t('mergeCatsAgeClass'), { name: drop.name_he || drop.name })}</p>
              )}
            </>
          )}
          {(report.drop?.rounds ?? 0) > 0 && <p className="muted small">{fill(t('mergeCatsRounds'), { drop: name(drop), n: report.drop!.rounds })}</p>}
          {keep.gender !== drop.gender && (
            <p className="notice">{fill(t('mergeCatsGender'), { keep: name(keep), gender: t(keep.gender) })}</p>
          )}
          {report.conflicts.length > 0 && (
            <div role="alert">
              <p className="error">{t('mergeConflicts')}</p>
              <ul>{report.conflicts.map((c, i) => <li key={i}>{categoryConflictText(c, t, lang)}</li>)}</ul>
            </div>
          )}
          <button className="danger" disabled={!canMerge} onClick={() => setConfirming(true)}>{t('mergeButton')}</button>
        </>
      )}

      {confirming && keep && drop && report && (
        <Sheet title={t('mergeCatsConfirmTitle')} confirm={t('mergeButton')} danger
          onConfirm={() => void merge()} onCancel={() => setConfirming(false)}>
          <p className="sheet-result">{fill(t('mergeCatsConfirmText'), { keep: name(keep), drop: name(drop) })}</p>
          <p>{fill(t('mergeCatsMoving'), { n: report.moving.length, keep: name(keep) }).replace(/:$/, '')}</p>
        </Sheet>
      )}
    </div>
  );
}
