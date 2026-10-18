// The signed-in judge's outbox (src/lib/saveQueue.ts) wired to Supabase and the browser: one queue
// per profile, persisted in localStorage, retried at once when the browser comes back online or the
// app is shown again. Only the signed-in profile's queue runs, and in one tab only (Web Locks); the
// other tabs queue into the same storage and pick up changes from the `storage` event.
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { useEffect, useSyncExternalStore } from 'react';
import { useAuth } from './auth';
import { conflict, landed, outboxStorageKey, SaveQueue, type AuthRefresh, type OutboxEntry, type OutboxSnapshot, type SendResult } from './saveQueue';
import { reportClientError } from './errorReport';
import { supabase } from './supabase';
import { LEAD_COLUMNS, RESULT_COLUMNS } from './types';

/** A request that hangs (weak signal) is given up after this and retried. */
const SEND_TIMEOUT_MS = 15_000;
const timeout = () => AbortSignal.timeout(SEND_TIMEOUT_MS);
const columns = (e: OutboxEntry) => (e.table === 'boulder_results' ? RESULT_COLUMNS : LEAD_COLUMNS);
type Failure = { message: string; code?: string } | null;
const failed = (error: NonNullable<Failure>, status: number): SendResult => ({ ok: false, status, message: error.message, code: error.code });

/** Climbers open on a pad in this tab (boulder:climber -> pads open): the pad holds their claim. */
const openPads = new Map<string, number>();
const padKey = (boulderId: string, climberId: string) => `${boulderId}:${climberId}`;
/** The pad of a climber opened; call the result when it closes. */
export function trackOpenPad(boulderId: string, climberId: string): () => void {
  const k = padKey(boulderId, climberId);
  openPads.set(k, (openPads.get(k) ?? 0) + 1);
  return () => { const n = (openPads.get(k) ?? 1) - 1; if (n > 0) openPads.set(k, n); else openPads.delete(k); };
}
/** Claims the verify step took for climbers the judge may have moved on from (outbox key -> ids). */
const verifyClaims = new Map<string, { boulderId: string; climberId: string }>();
function releaseVerifyClaim(key: string) {
  const c = verifyClaims.get(key);
  if (!c) return;
  verifyClaims.delete(key);
  if (!openPads.has(padKey(c.boulderId, c.climberId))) void supabase.rpc('release_claim', { p_boulder: c.boulderId, p_climber: c.climberId });
}

async function send(entry: OutboxEntry): Promise<SendResult> {
  try { return await sendRow(entry); } finally { releaseVerifyClaim(entry.key); }
}

async function sendRow(entry: OutboxEntry): Promise<SendResult> {
  const { data, error, status } = await supabase.from(entry.table)
    .upsert({ ...entry.row, ...(entry.lock ? { locked: true } : {}) }, { onConflict: 'boulder_id,climber_id' })
    .select(columns(entry))
    .abortSignal(timeout());
  if (error) return failed(error, status);
  return { ok: true, row: ((data ?? []) as unknown as Record<string, unknown>[])[0] };
}

/** A row that waited: still this judge's climber (claim again), and the server row unchanged since
 *  the row the judge built on? Never silently overwrite an admin's or another judge's change. */
function verifier(profileId: string) {
  return async (entry: OutboxEntry): Promise<SendResult> => {
    const r = entry.row as { boulder_id: string; climber_id: string; round_id: string };
    const claim = await supabase.rpc('claim_climber', { p_round: r.round_id, p_boulder: r.boulder_id, p_climber: r.climber_id }).abortSignal(timeout());
    if (claim.error) return failed(claim.error, claim.status);
    const holder = ((claim.data ?? []) as { judge_id: string; judge_name: string }[])[0];
    if (holder && holder.judge_id !== profileId) return { ok: false, status: 409, code: 'held', message: holder.judge_name };
    verifyClaims.set(entry.key, { boulderId: r.boulder_id, climberId: r.climber_id }); // ours now: released after the send
    const { data, error, status } = await supabase.from(entry.table).select(columns(entry))
      .eq('boulder_id', r.boulder_id).eq('climber_id', r.climber_id).abortSignal(timeout()).maybeSingle();
    if (error) { releaseVerifyClaim(entry.key); return failed(error, status); }
    const server = data as Record<string, unknown> | null;
    // Already there (a save whose answer was lost; a lock would now be refused by RLS): saved.
    if (server && landed(entry, server)) { releaseVerifyClaim(entry.key); return { ok: true, done: true, row: server }; }
    if (conflict(entry, server)) { releaseVerifyClaim(entry.key); return { ok: false, status: 409, code: 'changed', message: 'changed on the server', row: server ?? undefined }; }
    return { ok: true }; // the send follows (and releases)
  };
}

async function refreshAuth(): Promise<AuthRefresh> {
  const { data, error } = await supabase.auth.refreshSession();
  if (data.session) return 'ok';
  return error && isAuthRetryableFetchError(error) ? 'offline' : 'signed-out';
}

function storage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

interface Running { queue: SaveQueue; dispose: () => void }
const queues = new Map<string, Running>();
/** The signed-in profile (useOutboxOwner): only its queue sends. */
let currentProfile: string | null = null;

export function outboxFor(profileId: string): SaveQueue {
  const running = queues.get(profileId);
  if (running) return running.queue;
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const key = outboxStorageKey(profileId);
  const queue = new SaveQueue({
    storageKey: key, storage: storage(), send, verify: verifier(profileId), refreshAuth,
    isCurrent: () => currentProfile === profileId, leader: !locks,
    // Permanent failures (not the retries) go to the admins' error list; no names, just where.
    onFailed: (f) => reportClientError(`Result not saved: ${f.error}`, {
      context: { table: f.table, boulder: f.meta?.boulder, code: f.code ?? null, tries: f.tries, boulderId: f.key.split('|')[1] },
    }),
  });
  const online = () => queue.kick();
  const visible = () => {
    if (document.visibilityState !== 'visible') return;
    if (locks && !queue.leading()) void take(true);
    queue.kick();
  };
  const stored = (e: StorageEvent) => { if (e.key === key) queue.adopt(); };
  window.addEventListener('online', online);
  document.addEventListener('visibilitychange', visible);
  window.addEventListener('storage', stored);
  // One tab per profile sends: the one holding the lock (until the tab closes or the queue stops). The
  // tab the judge looks at takes it over (steal); the tab that lost it queues for it again.
  const abort = new AbortController();
  let release = () => {};
  let disposed = false;
  const hold = () => new Promise<void>((resolve) => { release = resolve; queue.setLeader(true); });
  const take = (steal: boolean) => locks?.request(key, steal ? { steal: true } : { signal: abort.signal }, hold)
    .catch(() => { queue.setLeader(false); if (!disposed) void take(false); }); // stolen (or stopped)
  void take(false);
  queues.set(profileId, { queue, dispose: () => {
    disposed = true;
    queue.stop();
    window.removeEventListener('online', online);
    document.removeEventListener('visibilitychange', visible);
    window.removeEventListener('storage', stored);
    abort.abort();
    release();
  } });
  queue.kick(); // rows left from before a reload
  return queue;
}

let watchingAuth = false;
/** The signed-in profile changed (sign-in, sign-out, another account): stop the other profiles'
 *  queues (their rows stay stored until that judge signs in again) and run this one. */
function setOutboxProfile(profileId: string | null) {
  currentProfile = profileId;
  for (const [id, running] of queues) if (id !== profileId) { running.dispose(); queues.delete(id); }
  if (profileId) outboxFor(profileId).kick();
  if (!watchingAuth) {
    watchingAuth = true;
    // Outside the callback: Supabase calls inside onAuthStateChange can deadlock.
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') setTimeout(() => { for (const r of queues.values()) r.queue.resume(); }, 0);
    });
  }
}

/** Mount once in the staff app: binds the outbox to the signed-in profile. */
export function useOutboxOwner() {
  const { profileId } = useAuth();
  useEffect(() => { setOutboxProfile(profileId); }, [profileId]);
}

/** What the judge pad keeps on the device besides the outbox. */
export const judgeRoundsKey = (profileId: string) => `ilca.judgeRounds.${profileId}`;
export const judgeAssignmentsKey = (profileId: string) => `ilca.judgeAssignments.${profileId}`;

/** Sign-out: forget the pad's copies (rounds, assignments, roles); never an outbox with unsent rows. */
export function forgetJudgeDevice(profileId: string | null, userId: string) {
  try {
    if (profileId) { localStorage.removeItem(judgeRoundsKey(profileId)); localStorage.removeItem(judgeAssignmentsKey(profileId)); }
    localStorage.removeItem(`ilca.auth.${userId}`);
  } catch { /* storage unavailable */ }
}

const EMPTY: OutboxSnapshot = { pending: [], failed: [], acked: {}, recheck: [], needsSignIn: false, storageFailed: false };
const noSubscribe = () => () => {};
const emptySnapshot = () => EMPTY;

/** The signed-in judge's outbox and its live state (null queue before the profile is known). */
export function useOutbox(): { queue: SaveQueue | null; snap: OutboxSnapshot } {
  const { profileId } = useAuth();
  const queue = profileId ? outboxFor(profileId) : null;
  const snap = useSyncExternalStore(queue?.subscribe ?? noSubscribe, queue?.snapshot ?? emptySnapshot);
  return { queue, snap };
}
