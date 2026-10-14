import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import type { AppRole } from '../lib/types';

// UX gate only. Real isolation is enforced by row level security in the database:
// a user who bypasses this component still cannot read or write other roles' data.
export function RequireRole({ role, children }: { role?: AppRole; children: ReactNode }) {
  const { session, loading, hasRole } = useAuth();
  const { t } = useI18n();
  const location = useLocation();
  if (loading) return <p className="muted">{t('loading')}</p>;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (role && !hasRole(role)) return <p className="notice">{t('noAccess')}</p>;
  return <>{children}</>;
}
