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

// Legacy aliases — kept for calendar UI that only needs local formatting
export const formatDateLocal = formatDateJST;
export const todayLocal = todayJST;
