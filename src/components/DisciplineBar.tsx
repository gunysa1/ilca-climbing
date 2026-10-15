import { useSearchParams } from 'react-router-dom';
import { DISCIPLINES, type Discipline } from '../lib/discipline';
import { useI18n } from '../lib/i18n';

const KEY = 'discipline';
const ICON: Record<Discipline, string> = { boulder: '▲', lead: '↑', speed: '⚡' };

/** Selected discipline: ?d= in the URL, else the last choice, else boulder. */
export function useDiscipline(): [Discipline, (d: Discipline) => void] {
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('d') as Discipline | null;
  let saved: Discipline | null = null;
  try { saved = localStorage.getItem(KEY) as Discipline | null; } catch { /* storage unavailable */ }
  const current = [fromUrl, saved].find((d): d is Discipline => !!d && DISCIPLINES.includes(d)) ?? 'boulder';
  const set = (d: Discipline) => {
    try { localStorage.setItem(KEY, d); } catch { /* ignore */ }
    setParams((p) => { p.set('d', d); return p; }, { replace: true });
  };
  return [current, set];
}

/** Bottom tab bar (like the IFSC app): Boulder / Lead / Speed. */
export function DisciplineBar({ value, onChange }: { value: Discipline; onChange: (d: Discipline) => void }) {
  const { t } = useI18n();
  return (
    <nav className="discipline-bar" aria-label={t('discipline')}>
      {DISCIPLINES.map((d) => (
        <button key={d} className={d === value ? 'active' : ''} aria-pressed={d === value} onClick={() => onChange(d)}>
          <span className="discipline-icon" aria-hidden>{ICON[d]}</span>
          <span>{t(d === 'boulder' ? 'discBoulder' : d === 'lead' ? 'discLead' : 'discSpeed')}</span>
        </button>
      ))}
    </nav>
  );
}
