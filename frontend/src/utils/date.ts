/** Format a Date as 'YYYY-MM-DD' using local timezone. */
export function formatDateLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Get today's date as 'YYYY-MM-DD' in local timezone. */
export function todayLocal(): string {
  return formatDateLocal(new Date());
}
