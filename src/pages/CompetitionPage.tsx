import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { RoundStatus } from '../components/RoundStatus';
import { localized, useI18n } from '../lib/i18n';
import { saveLastViewed } from '../lib/lastViewed';
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
