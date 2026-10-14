import { CoachNotes } from '../components/CoachNotes';
import { History } from '../components/History';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';

export function Me() {
  const { t } = useI18n();
  const { profileId } = useAuth();
  if (!profileId) return null;
  return (
    <section>
      <h1>{t('myHistory')}</h1>
      <History climberId={profileId} />
      <CoachNotes climberId={profileId} canWrite={false} />
    </section>
  );
}
