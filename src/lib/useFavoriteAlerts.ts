// Alerts for starred climbers while the viewer is open (also in a background tab). Reads only; the
// browser notification is local. Mounted once in the viewer layout.
import { useCallback, useEffect, useState } from 'react';
import { ALERT_TICK_MS, planFetch } from './alertPolling';
import { diffAlerts, parseSettings, parseState, type Alert, type AlertSettings, type AlertState } from './favoriteAlerts';
import { useFavorites } from './favorites';
import { parseLive, type HomeLiveRound } from './home';
import { localized, useI18n, type Lang, type MsgKey } from './i18n';
import { supabase } from './supabase';
import type { HistoryRow } from './types';

const SETTINGS_KEY = 'alert-settings';
const STATE_KEY = 'alert-state';
/** Across restarts of the effect (settings changes): never closer than one tick, however often it restarts. */
let lastRequestAt = 0;

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage unavailable: alerts still work this visit */ } };

export const notificationsSupported = () => typeof Notification !== 'undefined';
export const notificationPermission = (): NotificationPermission | 'unsupported' => (notificationsSupported() ? Notification.permission : 'unsupported');

/** The on/off switch and the events, kept on the device and shared by every component and tab. */
export function useAlertSettings(): [AlertSettings, (s: AlertSettings) => void] {
  const [settings, setState] = useState(() => parseSettings(read(SETTINGS_KEY)));
  useEffect(() => {
    const sync = () => setState(parseSettings(read(SETTINGS_KEY)));
    window.addEventListener('storage', sync);
    window.addEventListener('alert-settings-changed', sync);
    return () => { window.removeEventListener('storage', sync); window.removeEventListener('alert-settings-changed', sync); };
  }, []);
  const set = useCallback((s: AlertSettings) => {
    write(SETTINGS_KEY, JSON.stringify(s));
    setState(s);
    window.dispatchEvent(new Event('alert-settings-changed'));
  }, []);
  return [settings, set];
}

/** Notification title and text for an alert. */
export function alertText(a: Alert, lang: Lang, t: (k: MsgKey) => string): { title: string; body: string; url: string } {
  const name = localized(lang, a.name, a.name_he);
  const comp = localized(lang, a.competition, a.competition_he);
  const fill = (k: MsgKey) => t(k).replace('{name}', name).replace('{comp}', comp).replace('{n}', String(a.boulder ?? ''))
    .replace('{rank}', String(a.rank ?? '')).replace('{of}', String(a.of ?? '')).replace('{round}', t(a.round_kind));
  const body = a.kind === 'wall' ? fill(a.boulder != null ? 'notifyMsgWall' : 'notifyMsgWallLead')
    : a.kind === 'result' ? fill('notifyMsgResult') : a.kind === 'advance' ? fill('notifyMsgAdvance') : fill('notifyMsgPodium');
  return { title: t('appName'), body: a.kind === 'wall' ? `${body} (${comp})` : body, url: `/round/${a.round_id}` };
}

/** Service worker notification when there is one (Android needs it), else the page's own. */
async function show(a: Alert, text: { title: string; body: string; url: string }, lang: Lang) {
  const options: NotificationOptions & { data?: unknown } = { body: text.body, tag: a.key, icon: '/icon.svg', lang, dir: lang === 'he' ? 'rtl' : 'ltr', data: { url: text.url } };
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg?.showNotification) { await reg.showNotification(text.title, options); return; }
  } catch { /* fall through to the page's notification */ }
  try { new Notification(text.title, options); } catch { /* not allowed here */ }
}

/** Polls (cheaply, see alertPolling.ts) while alerts are on, the browser allows them and someone is starred. */
export function useFavoriteAlerts() {
  const { ids } = useFavorites();
  const [settings] = useAlertSettings();
  const { t, lang } = useI18n();
  const idsKey = ids.join(',');
  const on = settings.enabled && ids.length > 0;
  const wantHistory = settings.kinds.result || settings.kinds.advance || settings.kinds.podium;
  const kindsKey = JSON.stringify(settings.kinds);

  useEffect(() => {
    if (!on || notificationPermission() !== 'granted') return;
    let stop = false;
    let busy = false;
    let lastWall = 0;
    let lastHist = 0;
    let live: HomeLiveRound[] = [];
    let finishedPending = false;
    let hiddenSince: number | null = document.visibilityState === 'hidden' ? Date.now() : null;
    let state: AlertState = parseState(read(STATE_KEY));
    const names = new Map<string, { full_name: string; full_name_he: string | null }>();

    const apply = (input: { live?: HomeLiveRound[]; history?: HistoryRow[] }) => {
      const res = diffAlerts(state, { favorites: ids, names, live: input.live ?? null, history: input.history ?? null }, settings);
      state = res.state;
      write(STATE_KEY, JSON.stringify(state));
      for (const a of res.alerts) void show(a, alertText(a, lang, t), lang);
    };

    const tick = async () => {
      if (busy || stop || notificationPermission() !== 'granted') return;
      const now = Date.now();
      if (now - lastRequestAt < ALERT_TICK_MS - 1000) return;
      const plan = planFetch({
        now, lastWall, lastHist, anyLive: live.length > 0, finishedPending, wantHistory, hiddenSince,
        needBaseline: ids.some((id) => !state.known.includes(id)),
      });
      if (!plan) return;
      busy = true;
      lastRequestAt = now;
      try {
        if (plan === 'wall') {
          const { data, error } = await supabase.rpc('home_page', { p_live_only: true });
          if (stop || error || !data) return;
          lastWall = now;
          const before = live.length;
          live = parseLive(data);
          if (before > 0 && live.length === 0) finishedPending = true; // read the closing results once more
          apply({ live });
        } else {
          const { data, error } = await supabase.rpc('favorites_page', { p_climbers: ids });
          if (stop || error || !data) return;
          lastHist = now;
          finishedPending = false;
          const page = data as { profiles?: { id: string; full_name: string; full_name_he: string | null }[]; history?: HistoryRow[] };
          for (const p of page.profiles ?? []) names.set(p.id, { full_name: p.full_name, full_name_he: p.full_name_he });
          apply({ history: (page.history ?? []) });
        }
      } catch { /* offline: the next tick tries again */ } finally { busy = false; }
    };

    const onVisibility = () => {
      hiddenSince = document.visibilityState === 'hidden' ? Date.now() : null;
      if (hiddenSince === null) void tick(); // back after a pause: catch up at once
    };
    document.addEventListener('visibilitychange', onVisibility);
    const timer = setInterval(() => void tick(), ALERT_TICK_MS);
    void tick();
    return () => { stop = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [on, idsKey, kindsKey, wantHistory, lang]);
}
