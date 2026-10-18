import { Link, useParams } from 'react-router-dom';
import { isTimedRound } from '../../lib/climbTime';
import { localized, useI18n } from '../../lib/i18n';
import { useRoundData } from '../../lib/roundData';

/** Paper fallback for a lead round (no signal, phones down): one page per route with the start list,
 *  blank height (and, in a final, time) boxes and the judge's signature. Printed from the browser. */
export function ScoreSheets() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const { round, category, boulders, starters, loading } = useRoundData(id);

  if (loading) return <p className="muted">{t('loading')}</p>;
  if (!round || !category) return <p className="notice">{t('noAccess')}</p>;
  const timed = isTimedRound(round);
  const lead = round.scoring === 'lead';
  const title = [localized(lang, category.competition.name, category.competition.name_he), localized(lang, category.name, category.name_he), t(round.kind)].join(' · ');

  return (
    <section className="score-sheets">
      <div className="no-print">
        <p><Link to={`/admin/round/${round.id}`}>{lang === 'he' ? '→' : '←'} {t('manageRound')}</Link></p>
        <h1>{t('scoreSheets')}</h1>
        <p className="muted">{t('scoreSheetsHint')}</p>
        {starters.length === 0 && <p className="notice">{t('scoreSheetsNoStarters')}</p>}
        <button className="primary" onClick={() => window.print()} disabled={boulders.length === 0}>{t('printPdf')}</button>
      </div>
      {boulders.map((b) => (
        <article key={b.id} className="score-sheet">
          <div className="score-sheet-head">
            <h2>{title}</h2>
            <strong className="score-sheet-route">{t(lead ? 'route' : 'boulder')} {b.number}</strong>
          </div>
          <table className="score-sheet-table">
            <thead>
              <tr>
                <th>#</th><th>{t('bib')}</th><th>{t('athlete')}</th>
                <th className="box">{t('sheetHeight')}</th>
                {timed && <th className="box">{t('climbTime')}</th>}
                <th className="box small-box">{t('sheetInitials')}</th>
              </tr>
            </thead>
            <tbody>
              {starters.map((s, i) => (
                <tr key={s.climber_id}>
                  <td>{i + 1}</td>
                  <td>{s.bib ?? ''}</td>
                  <td>
                    {localized(lang, s.profile.full_name, s.profile.full_name_he)}
                    <span className="muted small">{[s.group_label && `${t('group')} ${s.group_label}`, s.age_class, s.profile.club].filter(Boolean).map((x) => ` · ${x}`).join('')}</span>
                  </td>
                  <td className="box" />
                  {timed && <td className="box" />}
                  <td className="box small-box" />
                </tr>
              ))}
            </tbody>
          </table>
          <p className="score-sheet-legend small">{t('sheetLegend')}</p>
          <div className="score-sheet-sign">
            <span>{t('sheetJudgeName')}: ____________________</span>
            <span>{t('sheetSignature')}: ____________________</span>
            <span>{t('sheetDate')}: __________</span>
          </div>
        </article>
      ))}
    </section>
  );
}
