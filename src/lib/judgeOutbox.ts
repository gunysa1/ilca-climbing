// The signed-in judge's outbox (src/lib/saveQueue.ts) wired to Supabase and the browser: one queue
// per profile for the whole app, persisted in localStorage, retried at once when the browser comes
// back online or the app is shown again.
import { useSyncExternalStore } from 'react';
import { useAuth } from './auth';
import { outboxStorageKey, SaveQueue, type OutboxEntry, type OutboxSnapshot, type SendResult } from './saveQueue';
import { supabase } from './supabase';
import { LEAD_COLUMNS, RESULT_COLUMNS } from './types';

/** A request that hangs (weak signal) is given up after this and retried. */
const SEND_TIMEOUT_MS = 15_000;

async function send(entry: OutboxEntry): Promise<SendResult> {
  const { error, status } = await supabase.from(entry.table)
    .upsert({ ...entry.row, ...(entry.lock ? { locked: true } : {}) }, { onConflict: 'boulder_id,climber_id' })
    .select(entry.table === 'boulder_results' ? RESULT_COLUMNS : LEAD_COLUMNS)
    .abortSignal(AbortSignal.timeout(SEND_TIMEOUT_MS));
  return error ? { ok: false, status, message: error.message } : { ok: true };
}

function storage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

const queues = new Map<string, SaveQueue>();

export function outboxFor(profileId: string): SaveQueue {
  let q = queues.get(profileId);
  if (q) return q;
  const queue = new SaveQueue({ storageKey: outboxStorageKey(profileId), storage: storage(), send });
  queues.set(profileId, queue);
  window.addEventListener('online', () => queue.kick());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') queue.kick(); });
  queue.kick(); // rows left from before a reload
  return queue;
}

const EMPTY: OutboxSnapshot = { pending: [], failed: [] };
const noSubscribe = () => () => {};
const emptySnapshot = () => EMPTY;

/** The signed-in judge's outbox and its live state (null queue before the profile is known). */
export function useOutbox(): { queue: SaveQueue | null; snap: OutboxSnapshot } {
  const { profileId } = useAuth();
  const queue = profileId ? outboxFor(profileId) : null;
  const snap = useSyncExternalStore(queue?.subscribe ?? noSubscribe, queue?.snapshot ?? emptySnapshot);
  return { queue, snap };
}
