// Favorite climbers ("watch who you want", like the IFSC app). Stored on the device (localStorage),
// so it works without an account and nothing is sent to the server.
import { useCallback, useEffect, useState } from 'react';

const KEY = 'favorites';

export function parseFavorites(raw: string | null): string[] {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Add or remove an id, keeping the order of first starring. */
export function toggleFavorite(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function read(): string[] {
  try { return parseFavorites(localStorage.getItem(KEY)); } catch { return []; }
}

/** Favorites shared by every component and tab (storage + custom event keep them in sync). */
export function useFavorites(): { ids: string[]; has: (id: string) => boolean; toggle: (id: string) => void } {
  const [ids, setIds] = useState<string[]>(read);
  useEffect(() => {
    const sync = () => setIds(read());
    window.addEventListener('storage', sync);
    window.addEventListener('favorites-changed', sync);
    return () => { window.removeEventListener('storage', sync); window.removeEventListener('favorites-changed', sync); };
  }, []);
  const toggle = useCallback((id: string) => {
    const next = toggleFavorite(read(), id);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable: keep in memory */ }
    setIds(next);
    window.dispatchEvent(new Event('favorites-changed'));
  }, []);
  return { ids, has: (id) => ids.includes(id), toggle };
}
