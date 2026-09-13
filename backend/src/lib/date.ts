const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** Get today's date as YYYY-MM-DD in JST (UTC+9) */
export function todayJST(): string {
  const jst = new Date(Date.now() + JST_OFFSET_MS);
  return jst.toISOString().slice(0, 10);
}

/** Derive a deterministic engine seed number from a YYYY-MM-DD date string.
 *  Canonical implementation in engine/src/seed.ts — keep in sync. */
export function generateDailySeed(dateStr: string): number {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = ((hash << 5) - hash + dateStr.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Parse a YYYY-MM-DD string as UTC midnight.
 *  Returns null for impossible dates, which `Date` would otherwise roll over (2026-09-31 → 2026-10-01). */
export function parseDateString(dateStr: string): Date | null {
  const date = new Date(dateStr + 'T00:00:00Z');
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === dateStr ? date : null;
}

/** Check if a date string is valid for score submission: today (JST) or up to 60 days in the past (calendar plays).
 *  Scores for a day that has not started yet are rejected. */
export function isDateNearToday(dateStr: string): boolean {
  const target = parseDateString(dateStr);
  if (!target) return false;
  const today = parseDateString(todayJST())!;
  const diffDays = (today.getTime() - target.getTime()) / (24 * 60 * 60 * 1000);
  return diffDays >= 0 && diffDays <= 60;
}
