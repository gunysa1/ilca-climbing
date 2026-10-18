import { useState } from 'react';
import { ALERT_KINDS, type AlertKind } from '../lib/favoriteAlerts';
import { useFavorites } from '../lib/favorites';
import { useI18n, type MsgKey } from '../lib/i18n';
import { notificationPermission, useAlertSettings } from '../lib/useFavoriteAlerts';

const KIND_LABEL: Record<AlertKind, MsgKey> = { wall: 'notifyEvWall', result: 'notifyEvResult', advance: 'notifyEvAdvance', podium: 'notifyEvPodium' };

/** Favorites page: switch the in-app alerts for starred climbers on or off and choose the events. */
export function NotifySettings() {
  const { t } = useI18n();
  const { ids } = useFavorites();
  const [settings, setSettings] = useAlertSettings();
  const [permission, setPermission] = useState(notificationPermission);
  const on = settings.enabled && permission === 'granted';

  const turnOn = async () => {
    let p = notificationPermission();
    if (p === 'default') {
      try { p = await Notification.requestPermission(); } catch { p = notificationPermission(); }
    }
    setPermission(p);
    if (p === 'granted') setSettings({ ...settings, enabled: true });
  };

  return (
    <section className="panel notify">
      <h2>🔔 {t('notifyTitle')}</h2>
      <p className="small muted">{t('notifyExplain')}</p>
      {permission === 'unsupported' && <p className="small">{t('notifyUnsupported')}</p>}
      {permission === 'denied' && <p className="small error">{t('notifyDenied')}</p>}
      {permission !== 'unsupported' && permission !== 'denied' && !on && (
        <button className="primary" onClick={() => void turnOn()}>{t('notifyOn')}</button>
      )}
      {on && (
        <>
          <p><strong>{t('notifyEnabled')}</strong>{ids.length === 0 && <span className="muted small"> · {t('notifyNoFavorites')}</span>}</p>
          <fieldset className="notify-kinds">
            <legend className="small">{t('notifyWhich')}</legend>
            {ALERT_KINDS.map((k) => (
              <label key={k} className="inline">
                <input type="checkbox" checked={settings.kinds[k]}
                  onChange={(e) => setSettings({ ...settings, kinds: { ...settings.kinds, [k]: e.target.checked } })} /> {t(KIND_LABEL[k])}
              </label>
            ))}
          </fieldset>
          <button className="secondary" onClick={() => setSettings({ ...settings, enabled: false })}>{t('notifyOff')}</button>
        </>
      )}
    </section>
  );
}
