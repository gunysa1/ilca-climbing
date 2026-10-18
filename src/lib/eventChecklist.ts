// The event-day checklist (admin): result of the `event_checklist` RPC and the manual ticks kept on the device.
import type { MsgKey } from './i18n';

export type CheckId = 'published' | 'category_rounds' | 'round_boulders' | 'first_starters' | 'starter_bibs'
  | 'advance_quota' | 'boulder_judges' | 'judges_signed_in' | 'old_appeals';

export interface CheckItem {
  label?: string;
  label_he?: string | null;
  round_id?: string;
  category_id?: string;
  profile_id?: string;
  kind?: 'qualification' | 'semifinal' | 'final';
  number?: number;
  /** judges_signed_in only */
  has_login?: boolean;
  signed_in?: boolean;
  last_sign_in_at?: string | null;
}
export interface Check { id: CheckId; ok: boolean; items: CheckItem[] }
export interface ChecklistResult {
  competition: { id: string; name: string; name_he: string | null; status: string; starts_on: string; ends_on: string };
  checks: Check[];
}

export const CHECK_TEXT: Record<CheckId, MsgKey> = {
  published: 'checkPublished',
  category_rounds: 'checkCategoryRounds',
  round_boulders: 'checkRoundBoulders',
  first_starters: 'checkFirstStarters',
  starter_bibs: 'checkStarterBibs',
  advance_quota: 'checkAdvanceQuota',
  boulder_judges: 'checkBoulderJudges',
  judges_signed_in: 'checkJudgesSignedIn',
  old_appeals: 'checkOldAppeals',
};

/** Where an admin fixes a failing check: judges and appeals on the round page, accounts under people,
 *  everything else (boulders, bibs, quota, start lists, status) on the competition page. */
export function fixPath(competitionId: string, id: CheckId, item?: CheckItem): string {
  if (id === 'judges_signed_in') return '/admin/people';
  if ((id === 'boulder_judges' || id === 'old_appeals') && item?.round_id) return `/admin/round/${item.round_id}`;
  return `/admin/competition/${competitionId}`;
}

export const MANUAL_ITEMS = [
  { id: 'no_deploys', text: 'manualNoDeploys' },
  { id: 'judges_opened', text: 'manualJudgesOpened' },
  { id: 'venue_signal', text: 'manualVenueSignal' },
  { id: 'fallback_app', text: 'manualFallbackApp' },
  { id: 'score_sheets', text: 'manualScoreSheets' },
  { id: 'power', text: 'manualPower' },
  { id: 'pdf', text: 'manualPdf' },
] as const satisfies readonly { id: string; text: MsgKey }[];

const storageKey = (competitionId: string) => `ilca.checklist.${competitionId}`;

/** The ticked manual item ids (per competition, per device). Storage may be missing or full: nothing is ticked then. */
export function readTicks(competitionId: string, storage: Pick<Storage, 'getItem'> | null = browserStorage()): string[] {
  try {
    const v: unknown = JSON.parse(storage?.getItem(storageKey(competitionId)) ?? 'null');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function writeTicks(competitionId: string, ticks: string[], storage: Pick<Storage, 'setItem'> | null = browserStorage()) {
  try { storage?.setItem(storageKey(competitionId), JSON.stringify(ticks)); } catch { /* kept in the page only */ }
}

function browserStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
