/**
 * Derive a deterministic engine seed number from a YYYY-MM-DD date string.
 * Used by both frontend and backend for daily seed generation.
 */
export function generateDailySeed(dateStr: string): number {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = ((hash << 5) - hash + dateStr.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}
