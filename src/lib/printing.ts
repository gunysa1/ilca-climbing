import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import type { ResultRow } from './roundData';

/** True while the page is being printed (the PDF button or the browser's own print), so a page can swap
 * its screen layout for a plain table. flushSync: the print snapshot is taken right after beforeprint. */
export function usePrinting(): { printing: boolean; print: () => void } {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const on = () => flushSync(() => setPrinting(true));
    const off = () => setPrinting(false);
    window.addEventListener('beforeprint', on);
    window.addEventListener('afterprint', off);
    return () => { window.removeEventListener('beforeprint', on); window.removeEventListener('afterprint', off); };
  }, []);
  const print = () => { flushSync(() => setPrinting(true)); window.print(); };
  return { printing, print };
}

/** A boulder in the printed table: "T2 Z1" (top on the 2nd attempt, zone on the 1st), "Z3", "–" when tried
 * without a zone, empty when not tried. */
export function boulderCellText(r: Pick<ResultRow, 'attempts' | 'top_attempt' | 'zone_attempt'> | undefined): string {
  if (!r || r.attempts <= 0) return '';
  if (r.top_attempt != null) return `T${r.top_attempt} Z${r.zone_attempt ?? r.top_attempt}`;
  if (r.zone_attempt != null) return `Z${r.zone_attempt}`;
  return '–';
}
