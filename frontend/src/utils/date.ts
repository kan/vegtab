const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** Get a Date shifted to JST (UTC+9). */
function toJST(d: Date): Date {
  return new Date(d.getTime() + JST_OFFSET_MS);
}

/** Format a Date as 'YYYY-MM-DD' in JST. */
export function formatDateJST(d: Date): string {
  const jst = toJST(d);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}-${String(jst.getUTCDate()).padStart(2, '0')}`;
}

/** Get today's date as 'YYYY-MM-DD' in JST. */
export function todayJST(): string {
  return formatDateJST(new Date());
}

/** Get the next JST midnight as a UTC timestamp (ms). */
export function nextMidnightJST(): number {
  const jst = toJST(new Date());
  const tomorrow = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + 1);
  return tomorrow - JST_OFFSET_MS; // convert back to UTC
}

/** 'YYYY-MM-DD' moved by `days` (calendar days, no time zone involved) */
export function shiftDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Every day of `month` ('YYYY-MM') as 'YYYY-MM-DD', first to last */
export function daysOfMonth(month: string): string[] {
  const [year, mon] = month.split('-').map(Number);
  const count = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/** The month after `month` ('YYYY-MM') */
export function nextMonth(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  return mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, '0')}`;
}

// Legacy aliases — kept for calendar UI that only needs local formatting
export const formatDateLocal = formatDateJST;
export const todayLocal = todayJST;
