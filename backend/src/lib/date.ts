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

/** Check if a date string is within ±1 day of JST today (timezone tolerance). */
export function isDateNearToday(dateStr: string): boolean {
  const today = new Date(todayJST() + 'T00:00:00Z');
  const target = new Date(dateStr + 'T00:00:00Z');
  const diffMs = Math.abs(today.getTime() - target.getTime());
  return diffMs <= 24 * 60 * 60 * 1000; // ±1 day
}

// Legacy alias for imports
export const todayUTC = todayJST;
