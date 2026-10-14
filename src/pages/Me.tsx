import { CoachNotes } from '../components/CoachNotes';
import { History } from '../components/History';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';

export function Me() {
  const { t } = useI18n();
  const { session } = useAuth();
  if (!session) return null;
  return (
    <section>
      <h1>{t('myHistory')}</h1>
      <History climberId={session.user.id} />
      <CoachNotes climberId={session.user.id} canWrite={false} />
    </section>
  );
}
