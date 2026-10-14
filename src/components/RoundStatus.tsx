import { useI18n } from '../lib/i18n';
import type { Round } from '../lib/types';

export function RoundStatus({ status }: { status: Round['status'] }) {
  const { t } = useI18n();
  const label = status === 'live' ? t('liveNow') : t(status);
  return <span className={`badge badge-${status}`}>{label}</span>;
}
