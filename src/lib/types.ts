import type { ScoringFormat } from './scoring';

export type AppRole = 'climber' | 'coach' | 'judge' | 'admin';

export interface Profile {
  id: string;
  full_name: string;
  full_name_he: string | null;
  club: string | null;
  country: string;
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
  scoring: ScoringFormat;
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
  tops: number;
  zones: number;
  top_attempts: number;
  zone_attempts: number;
  points: number;
  rank: number;
  starters: number;
}

/** Columns of boulder_results readable by clients (updated_by is admin-only). */
export const RESULT_COLUMNS = 'boulder_id, climber_id, round_id, attempts, zone_attempt, top_attempt, updated_at';
