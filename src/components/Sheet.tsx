import type { ReactNode } from 'react';
import { useI18n } from '../lib/i18n';

/** A confirm sheet inside the app (instead of the browser's dialog). */
export function Sheet({ title, children, confirm, onConfirm, onCancel, danger }:
  { title: string; children: ReactNode; confirm: string; onConfirm: () => void; onCancel: () => void; danger?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="sheet-backdrop" role="presentation" onClick={onCancel}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
        <div className="sheet-actions">
          <button className="secondary" onClick={onCancel}>{t('cancel')}</button>
          <button className={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirm}</button>
        </div>
      </div>
    </div>
  );
}
