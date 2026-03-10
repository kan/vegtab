import { generateId, generateShareCode } from './id';
import { generateDailySeed } from './date';

export interface SeedRecord {
  id: string;
  seed_value: string;
  share_code: string;
}

/**
 * Find or create the daily seed for a given date.
 * Uses INSERT OR IGNORE to handle concurrent requests safely.
 */
export async function findOrCreateDailySeed(db: D1Database, date: string): Promise<SeedRecord> {
  const existing = await db.prepare(
    'SELECT id, seed_value, share_code FROM puzzle_seeds WHERE is_daily = 1 AND daily_date = ?'
  ).bind(date).first<SeedRecord>();

  if (existing) return existing;

  const seedId = generateId();
  const seedValue = String(generateDailySeed(date));
  const shareCode = generateShareCode();

  try {
    await db.prepare(
      'INSERT INTO puzzle_seeds (id, seed_value, share_code, is_daily, daily_date) VALUES (?, ?, ?, 1, ?)'
    ).bind(seedId, seedValue, shareCode, date).run();
    return { id: seedId, seed_value: seedValue, share_code: shareCode };
  } catch {
    // Concurrent insert — re-fetch the winner's row
    const seed = await db.prepare(
      'SELECT id, seed_value, share_code FROM puzzle_seeds WHERE is_daily = 1 AND daily_date = ?'
    ).bind(date).first<SeedRecord>();
    if (!seed) throw new Error(`Failed to create or find daily seed for ${date}`);
    return seed;
  }
}
