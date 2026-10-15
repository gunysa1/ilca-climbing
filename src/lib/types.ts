import type { ScoringFormat } from './scoring';

/** Boulder formats (scoring.ts) plus lead (lead.ts). */
export type RoundFormat = ScoringFormat | 'lead';
export const isLead = (r: { scoring: RoundFormat }) => r.scoring === 'lead';

export type AppRole = 'climber' | 'coach' | 'judge' | 'admin';

export interface Profile {
  id: string;
  full_name: string;
  full_name_he: string | null;
  club: string | null;
  country: string;
  gender?: 'female' | 'male' | 'mixed' | null;
}

/** Row of public.admin_accounts() (admins only). */
export interface AdminAccount {
  user_id: string;
  email: string | null;
  profile_id: string | null;
  full_name: string | null;
  roles: AppRole[];
}

export interface Competition {
  id: string;
  name: string;
  name_he: string | null;
  venue: string | null;
  starts_on: string;
  ends_on: string;
  status: 'draft' | 'published' | 'finished';
}

export interface Category {
  id: string;
  competition_id: string;
  name: string;
  name_he: string | null;
  gender: 'female' | 'male' | 'mixed';
}

export interface Round {
  id: string;
  category_id: string;
  kind: 'qualification' | 'semifinal' | 'final';
  status: 'planned' | 'live' | 'closed';
  scoring: RoundFormat;
}

export interface Boulder {
  id: string;
  round_id: string;
  number: number;
}

export interface HistoryRow {
  climber_id: string;
  competition_id: string;
  competition: string;
  competition_he: string | null;
  starts_on: string;
  category: string;
  category_he: string | null;
  round: Round['kind'];
  round_status: Round['status'];
  /** Boulder rounds only (null for lead). */
  tops: number | null;
  zones: number | null;
  top_attempts: number | null;
  zone_attempts: number | null;
  points: number | null;
  /** Null when the climber didn't climb in that round. */
  rank: number | null;
  starters: number;
  /** Scoring format of the round: 'ifsc2025' | 'classic' | 'lead'. */
  discipline: RoundFormat;
  round_id: string;
}

/** Columns of boulder_results readable by clients (updated_by is admin-only). */
export const RESULT_COLUMNS = 'boulder_id, climber_id, round_id, attempts, zone_attempt, top_attempt, updated_at';
/** Columns of lead_results readable by clients (updated_by is admin-only). */
export const LEAD_COLUMNS = 'boulder_id, climber_id, round_id, hold, plus, top, time_ms, updated_at';
