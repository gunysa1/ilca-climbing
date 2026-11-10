import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { RoundStatus } from '../components/RoundStatus';
import { localized, useI18n } from '../lib/i18n';
import { saveLastViewed } from '../lib/lastViewed';
import { loadRoundData } from '../lib/roundData';
import { csvFileName, csvLabels, downloadCsv, resultsCsvText, roundTable } from '../lib/resultsCsv';
import { scoreHeader } from '../lib/roundRows';
import { supabase } from '../lib/supabase';
import type { Category, Competition, Round } from '../lib/types';

type CategoryWithRounds = Category & { rounds: Round[] };
const ORDER: Round['kind'][] = ['qualification', 'semifinal', 'final'];

/** `bigScreen`: offer the venue screen (/screen/:id), which only the viewer app has. */
export function CompetitionPage({ bigScreen = false }: { bigScreen?: boolean }) {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const [comp, setComp] = useState<Competition | null>(null);
  const [cats, setCats] = useState<CategoryWithRounds[] | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);

  // One file: a block per round the page lists (not the planned ones), each with its title row.
  const exportAll = async () => {
    if (!comp || !cats) return;
    setExporting(true); setExportFailed(false);
    try {
      const wanted = cats.flatMap((c) => [...c.rounds].filter((r) => r.status !== 'planned')
        .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)).map((r) => ({ c, r })));
      const pages = await Promise.all(wanted.map(({ r }) => loadRoundData(r.id)));
      const tables = wanted.flatMap(({ c, r }, i) => {
        const d = pages[i];
        if (!d?.round) return [];
        return [roundTable({ round: d.round, boulders: d.boulders, starters: d.starters, results: d.results, leadResults: d.leadResults,
          totals: d.totals, lang, labels: csvLabels(t, scoreHeader(d.round, d.boulders.length, t)),
          title: `${localized(lang, c.name, c.name_he)} - ${t(r.kind)}` })];
      });
      if (tables.length < wanted.length) throw new Error('round not loaded');
      downloadCsv(csvFileName([localized(lang, comp.name, comp.name_he)]), resultsCsvText(tables));
    } catch { setExportFailed(true); } finally { setExporting(false); }
  };

  useEffect(() => {
    if (!id) return;
    supabase.from('competitions').select('*').eq('id', id).single().then(({ data }) => {
      const c = data as Competition | null;
      setComp(c);
      if (c) saveLastViewed({ competition_id: c.id, competition: c.name, competition_he: c.name_he,
        round_id: null, round_kind: null, category: null, category_he: null });
    });
    supabase.from('categories').select('*, rounds(*)').eq('competition_id', id).order('name')
      .then(({ data }) => setCats((data as CategoryWithRounds[]) ?? []));
  }, [id]);

  return (
    <section>
      <h1>{comp ? localized(lang, comp.name, comp.name_he) : t('loading')}</h1>
      {bigScreen && comp && <p className="home-more"><Link to={`/screen/${comp.id}`}>📺 {t('bigScreen')} ›</Link></p>}
      {cats?.some((c) => c.rounds.some((r) => r.status !== 'planned')) && (
        <p>
          <button className="chip" disabled={exporting} onClick={() => void exportAll()}>CSV ⤓ {t('exportAllCsv')}</button>
          {exportFailed && <span className="muted small"> {t('loadFailed')}</span>}
        </p>
      )}
      {cats?.length === 0 && <p className="muted">{t('empty')}</p>}
      {cats?.map((c) => (
        <div key={c.id} className="panel">
          <h2>{localized(lang, c.name, c.name_he)}</h2>
          <ul className="round-list">
            {[...c.rounds].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)).map((r) => (
              <li key={r.id}>
                {r.status === 'planned'
                  ? <span className="muted">{t(r.kind)}</span>
                  : <Link to={`/round/${r.id}`}>{t(r.kind)}</Link>}
                <RoundStatus status={r.status} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
