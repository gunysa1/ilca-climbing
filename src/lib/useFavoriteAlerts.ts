// Alerts for starred climbers while the viewer is open (also in a background tab). Reads only; the
// browser notification is local. Mounted once in the viewer layout.
import { useCallback, useEffect, useState } from 'react';
import { ALERT_HIDDEN_MAX_MS, ALERT_TICK_MS, mayLead, planFetch, type LeaderStamp } from './alertPolling';
import { israelToday } from './calendar';
import { ALERT_KINDS, diffAlerts, EMPTY_STATE, parseSettings, parseState, type Alert, type AlertSettings } from './favoriteAlerts';
import { useFavorites } from './favorites';
import { parseLive, type HomeLiveRound } from './home';
import { localized, useI18n, type Lang, type MsgKey } from './i18n';
import { supabase } from './supabase';
import type { HistoryRow } from './types';

const SETTINGS_KEY = 'alert-settings';
const STATE_KEY = 'alert-state';
const LAST_REQUEST_KEY = 'alert-last-request';
const LEADER_KEY = 'alert-leader';

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
    // switching alerts on, or an event on, starts from a silent baseline: what happened meanwhile is not news
    const before = parseSettings(read(SETTINGS_KEY));
    if ((s.enabled && !before.enabled) || ALERT_KINDS.some((k) => s.kinds[k] && !before.kinds[k])) write(STATE_KEY, JSON.stringify(EMPTY_STATE));
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
  const options: NotificationOptions & { data?: unknown } = { body: text.body, tag: a.key, icon: '/icon-192.png', lang, dir: lang === 'he' ? 'rtl' : 'ltr', data: { url: text.url } };
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg?.showNotification) { await reg.showNotification(text.title, options); return; }
  } catch { /* fall through to the page's notification */ }
  try { new Notification(text.title, options); } catch { /* not allowed here */ }
}

const tabId = Math.random().toString(36).slice(2);

interface Leader { isLeader: () => boolean }

/** Leader election: only one tab of the device polls. With Web Locks the leader holds the lock; it lets
 * go after 10 minutes hidden (the polling pauses then anyway) and a tab that becomes visible takes the
 * lock over (`steal`), the old leader then queues again. Without Web Locks a timestamp in localStorage
 * does the same (see mayLead). `start` runs when this tab leads and returns its cleanup. */
function asLeader(start: (leader: Leader) => () => void): { stop: () => void } {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    const leader: Leader = {
      isLeader: () => {
        const hidden = document.visibilityState === 'hidden';
        try {
          const stamp = JSON.parse(localStorage.getItem(LEADER_KEY) ?? 'null') as LeaderStamp | null;
          const now = Date.now();
          if (!mayLead(stamp, tabId, now, hidden)) return false;
          localStorage.setItem(LEADER_KEY, JSON.stringify({ id: tabId, t: now, h: hidden } satisfies LeaderStamp));
        } catch { /* storage unavailable: poll anyway */ }
        return true;
      },
    };
    return { stop: start(leader) };
  }

  let cancelled = false;
  let holding = false;
  let release: (() => void) | null = null;
  let stopRun: (() => void) | null = null;
  let pending: AbortController | null = null;
  let pauseTimer: ReturnType<typeof setTimeout> | undefined;
  const leader: Leader = { isLeader: () => holding };

  const drop = () => { // stop leading (lock released or taken over)
    holding = false;
    stopRun?.();
    stopRun = null;
    release?.();
    release = null;
  };
  const request = (steal: boolean) => {
    if (cancelled || holding) return;
    pending?.abort();
    const ac = (pending = new AbortController());
    navigator.locks.request('ilca-alerts', steal ? { steal: true } : { signal: ac.signal }, () => new Promise<void>((resolve) => {
      if (cancelled) { resolve(); return; }
      holding = true;
      release = resolve;
      stopRun = start(leader);
      if (document.visibilityState === 'hidden') { clearTimeout(pauseTimer); pauseTimer = setTimeout(() => { if (holding) drop(); }, ALERT_HIDDEN_MAX_MS); }
    })).then(() => { /* released by this tab */ }, () => {
      // aborted while queued, or taken over by a tab that became visible: queue again as a follower
      const wasLeading = holding;
      drop();
      if (wasLeading && !cancelled) request(false);
    });
  };
  const onVisibility = () => {
    clearTimeout(pauseTimer);
    if (document.visibilityState === 'hidden') {
      pauseTimer = setTimeout(() => { if (holding) { drop(); } }, ALERT_HIDDEN_MAX_MS);
    } else if (!holding) request(true); // visible again: lead (taking over from a hidden tab)
  };
  document.addEventListener('visibilitychange', onVisibility);
  if (document.visibilityState === 'hidden') onVisibility();
  request(false);
  return {
    stop: () => {
      cancelled = true;
      clearTimeout(pauseTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      pending?.abort();
      drop();
    },
  };
}

const lastRequest = () => { try { return Number(localStorage.getItem(LAST_REQUEST_KEY)) || 0; } catch { return 0; } };

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
    let lastDays = 0;
    let live: HomeLiveRound[] = [];
    let liveKey = '';
    let competitionDay = false;
    let histActive = true;
    let wallProbe = false;
    let finishedPending = false;
    let hiddenSince: number | null = document.visibilityState === 'hidden' ? Date.now() : null;
    const names = new Map<string, { full_name: string; full_name_he: string | null }>();
    let leader: Leader | null = null;
    let stopLeader: ReturnType<typeof asLeader> | null = null;

    // the stored state is read right before the comparison and written right after (no other tab can slip in between)
    const apply = (input: { live?: HomeLiveRound[]; history?: HistoryRow[] }) => {
      const res = diffAlerts(parseState(read(STATE_KEY)), { favorites: ids, names, live: input.live ?? null, history: input.history ?? null }, settings);
      write(STATE_KEY, JSON.stringify(res.state));
      for (const a of res.alerts) void show(a, alertText(a, lang, t), lang);
    };

    const tick = async () => {
      if (busy || stop || (leader && !leader.isLeader()) || notificationPermission() !== 'granted') return;
      const now = Date.now();
      if (now - lastRequest() < ALERT_TICK_MS - 1000) return; // one request per 30 s per device
      const known = parseState(read(STATE_KEY)).known;
      const plan = planFetch({
        now, lastWall, lastHist, lastDays, wallProbe, anyLive: live.length > 0, competitionDay, finishedPending, wantHistory, histActive, hiddenSince,
        needBaseline: ids.some((id) => !known.includes(id)),
      });
      if (!plan) return;
      busy = true;
      write(LAST_REQUEST_KEY, String(now));
      try {
        if (plan === 'days') {
          const today = israelToday();
          const { data, error } = await supabase.from('competitions').select('id').neq('status', 'draft')
            .lte('starts_on', today).gte('ends_on', today).limit(1);
          if (stop || error) return;
          lastDays = now;
          const day = !!data && data.length > 0;
          if (day && !competitionDay) histActive = true;
          competitionDay = day;
          wallProbe = !day; // no competition today: still look for a live round once
        } else if (plan === 'wall') {
          const { data, error } = await supabase.rpc('home_page', { p_live_only: true });
          if (stop || error || !data) return;
          lastWall = now;
          wallProbe = false;
          const before = live.length;
          live = parseLive(data);
          const key = live.map((r) => r.round_id).sort().join(',');
          if (key !== liveKey) { liveKey = key; histActive = true; } // another live round: look for starred climbers again
          if (before > 0 && live.length === 0) finishedPending = true; // read the closing results once more
          apply({ live });
        } else {
          const { data, error } = await supabase.rpc('favorites_live', { p_climbers: ids });
          if (stop || error || !Array.isArray(data)) return;
          lastHist = now;
          finishedPending = false;
          const rows = data as HistoryRow[];
          histActive = rows.length > 0;
          for (const r of rows) if (r.full_name) names.set(r.climber_id, { full_name: r.full_name, full_name_he: r.full_name_he ?? null });
          apply({ history: rows });
        }
      } catch { /* offline: the next tick tries again */ } finally { busy = false; }
    };

    // the page's own visibility (pause after 10 minutes hidden), whether or not this tab leads
    const onVisibility = () => { hiddenSince = document.visibilityState === 'hidden' ? Date.now() : null; };
    document.addEventListener('visibilitychange', onVisibility);
    stopLeader = asLeader((l) => {
      leader = l; // set before the first tick
      hiddenSince = document.visibilityState === 'hidden' ? (hiddenSince ?? Date.now()) : null;
      const timer = setInterval(() => void tick(), ALERT_TICK_MS);
      void tick();
      return () => clearInterval(timer);
    });
    return () => { stop = true; document.removeEventListener('visibilitychange', onVisibility); stopLeader?.stop(); };
  }, [on, idsKey, kindsKey, wantHistory, lang]);
}
