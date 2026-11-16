const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** Get today's date as YYYY-MM-DD in JST (UTC+9) */
export function todayJST(now = Date.now()): string {
  const jst = new Date(now + JST_OFFSET_MS);
  return jst.toISOString().slice(0, 10);
}

/**
 * 0 時を過ぎてからこの時間内は、前日分のスコアもランキングに記録する（23:55 に始めて 0:05 に終えたプレイの救済）。
 * クライアントが送る開始時刻はごまかせるので、サーバーの時刻だけで判定する
 */
const PREVIOUS_DAY_GRACE_MS = 30 * 60 * 1000;

/**
 * その日のランキングが締め切られたか。締め切り後はスコアを記録せず、リプレイを全員に公開する。
 * 猶予の間はまだ締め切らない（公開したリプレイを写して前日分として送れないように）
 */
export function isRankingClosed(dateStr: string, now = Date.now()): boolean {
  return dateStr < todayJST(now) && dateStr !== todayJST(now - PREVIOUS_DAY_GRACE_MS);
}

/** Every day of `month` ('YYYY-MM') as 'YYYY-MM-DD', first to last (the same as src/ui/utils/date.ts) */
export function daysOfMonth(month: string): string[] {
  const [year, mon] = month.split('-').map(Number);
  const count = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
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
