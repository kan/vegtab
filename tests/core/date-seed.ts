/**
 * Derive a seed number from a YYYY-MM-DD date string (the old daily seed, before #116).
 * Tests only: they use it for a spread of fixed seeds. The real daily seeds come from the backend
 * (src/worker/lib/seed.ts), and the frontend gets them from the API
 */
export function generateDailySeed(dateStr: string): number {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = ((hash << 5) - hash + dateStr.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}
