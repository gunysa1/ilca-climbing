import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { DisciplineBar, useDiscipline } from '../components/DisciplineBar';
import { FavoriteStar } from '../components/FavoriteStar';
import { History } from '../components/History';
import { loadClimberPage, type ClimberPage } from '../lib/climberPage';
import { localized, useI18n } from '../lib/i18n';

/** Public climber page (like the IFSC app): profile, per-discipline stats and results. */
export function Climber() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const [page, setPage] = useState<ClimberPage & { id: string } | null>(null);
  const [discipline, setDiscipline] = useDiscipline();

  useEffect(() => {
    if (!id) return;
    let live = true;
    // One request (often already under way, see lib/climberPage): public profile columns (private data
    // lives in profile_private), the history and its competitions' seasons and series.
    void loadClimberPage(id).then((p) => { if (live) setPage({ ...p, id }); });
    return () => { live = false; };
  }, [id]);

  const profile = page && page.id === id ? page.profile : undefined;
  if (profile === undefined) return <p className="muted">{t('loading')}</p>;
  if (profile === null || !id) return <p className="muted">{t('empty')}</p>;
  return (
    <section className="with-bottom-bar">
      <h1>{localized(lang, profile.full_name, profile.full_name_he)} <FavoriteStar climberId={profile.id} name={profile.full_name} /></h1>
      {profile.club && <p className="muted climber-club">{profile.club}</p>}
      <History climberId={id} discipline={discipline} rows={page!.history} ranked={page!.ranked} />
      <DisciplineBar value={discipline} onChange={setDiscipline} />
    </section>
  );
}
