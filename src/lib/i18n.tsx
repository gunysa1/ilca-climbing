import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'he' | 'en';

const dict = {
  appName: { he: 'איגוד הטיפוס הישראלי', en: 'Israel Climbing' },
  live: { he: 'תוצאות חיות', en: 'Live results' },
  competitions: { he: 'תחרויות', en: 'Competitions' },
  judge: { he: 'שיפוט', en: 'Judge' },
  coach: { he: 'מאמן', en: 'Coach' },
  myHistory: { he: 'ההיסטוריה שלי', en: 'My history' },
  login: { he: 'כניסה', en: 'Sign in' },
  logout: { he: 'יציאה', en: 'Sign out' },
  email: { he: 'אימייל', en: 'Email' },
  password: { he: 'סיסמה', en: 'Password' },
  noAccess: { he: 'אין לך הרשאה לעמוד זה', en: "You don't have access to this page" },
  notConfigured: { he: 'Supabase לא מוגדר (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)', en: 'Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)' },
  loading: { he: 'טוען…', en: 'Loading…' },
  empty: { he: 'אין נתונים עדיין', en: 'Nothing here yet' },
  rank: { he: 'מקום', en: 'Rank' },
  athlete: { he: 'מטפס/ת', en: 'Athlete' },
  points: { he: 'נקודות', en: 'Points' },
  tops: { he: 'טופים', en: 'Tops' },
  zones: { he: 'זונות', en: 'Zones' },
  boulder: { he: 'בולדר', en: 'Boulder' },
  attempt: { he: 'ניסיון', en: 'Attempt' },
  zone: { he: 'זון', en: 'Zone' },
  top: { he: 'טופ', en: 'Top' },
  undo: { he: 'בטל', en: 'Undo' },
  saved: { he: 'נשמר', en: 'Saved' },
  saveFailed: { he: 'השמירה נכשלה', en: 'Save failed' },
  myAssignments: { he: 'המשימות שלי', en: 'My assignments' },
  noAssignments: { he: 'אין משימות שיפוט פעילות', en: 'No live judging assignments' },
  myAthletes: { he: 'המטפסים שלי', en: 'My athletes' },
  notes: { he: 'הערות מאמן', en: 'Coach notes' },
  addNote: { he: 'הוסף הערה', en: 'Add note' },
  shareWithAthlete: { he: 'שתף עם המטפס/ת', en: 'Share with athlete' },
  date: { he: 'תאריך', en: 'Date' },
  competition: { he: 'תחרות', en: 'Competition' },
  category: { he: 'קטגוריה', en: 'Category' },
  round: { he: 'סבב', en: 'Round' },
  qualification: { he: 'מוקדמות', en: 'Qualification' },
  semifinal: { he: 'חצי גמר', en: 'Semi-final' },
  final: { he: 'גמר', en: 'Final' },
  liveNow: { he: 'בשידור חי', en: 'Live' },
  closed: { he: 'הסתיים', en: 'Closed' },
  planned: { he: 'מתוכנן', en: 'Planned' },
  bestRank: { he: 'מקום הכי טוב', en: 'Best rank' },
  rounds: { he: 'סבבים', en: 'Rounds' },
} satisfies Record<string, Record<Lang, string>>;

export type MsgKey = keyof typeof dict;

interface I18n { lang: Lang; setLang: (l: Lang) => void; t: (k: MsgKey) => string }

const Ctx = createContext<I18n | null>(null);

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('lang');
    if (saved === 'he' || saved === 'en') return saved;
  } catch { /* storage unavailable */ }
  return 'he';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  }, [lang]);
  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem('lang', l); } catch { /* ignore */ }
  };
  return <Ctx.Provider value={{ lang, setLang, t: (k) => dict[k][lang] }}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}

/** Pick the Hebrew variant of a bilingual field when available. */
export function localized(lang: Lang, en: string, he: string | null | undefined): string {
  return lang === 'he' && he ? he : en;
}
