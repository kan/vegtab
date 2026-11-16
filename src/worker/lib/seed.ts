import { generateId, generateShareCode } from './id';

export interface SeedRecord {
  id: string;
  seed_value: string;
  share_code: string;
}

/**
 * この日から、日ごとの seed を `DAILY_SEED_SECRET` の HMAC で作る（#116）。
 * それより前の日は、日付のハッシュだけで決まる旧方式の値のまま（既に誰でも計算できるので、秘密にする意味が無い。
 * 行の無い過去の日も、端末に残る記録と同じ盤になる）
 */
export const KEYED_SEED_START = '2026-11-16';

/** 旧方式の seed（日付の文字列のハッシュ）。KEYED_SEED_START より前の日だけに使う */
function legacyDailySeed(dateStr: string): number {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = ((hash << 5) - hash + dateStr.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

const encoder = new TextEncoder();

/** The imported key, kept for the isolate's lifetime (the calendar derives up to 31 seeds a request). Keyed by the secret, which the tests vary */
const hmacKeys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = hmacKeys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      .catch((e: unknown) => { hmacKeys.delete(secret); throw e; }); // a failed import is tried again next time
    hmacKeys.set(secret, key);
  }
  return key;
}

/**
 * その日の seed の値。secret を知らないと、まだ配っていない日の値は計算できない。
 * 旧方式と同じく 0 以上 2^31 未満の整数にする
 */
export async function deriveDailySeed(secret: string | undefined, dateStr: string): Promise<number> {
  if (dateStr < KEYED_SEED_START) return legacyDailySeed(dateStr);
  if (!secret) throw new Error('DAILY_SEED_SECRET is not set');
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(`vegtab-daily:${dateStr}`));
  return new DataView(mac).getUint32(0) & 0x7fffffff;
}

const SELECT_DAILY = 'SELECT id, seed_value, share_code FROM puzzle_seeds WHERE is_daily = 1 AND daily_date = ?';

/**
 * Find or create the daily seed for a given date.
 * An existing row always wins, so only the days without a row get a value from deriveDailySeed.
 * Uses INSERT OR IGNORE to handle concurrent requests safely.
 * Callers must not pass a day after today (JST): its seed would be handed out early
 */
export async function findOrCreateDailySeed(
  db: D1Database, secret: string | undefined, date: string,
): Promise<SeedRecord> {
  const existing = await db.prepare(SELECT_DAILY).bind(date).first<SeedRecord>();
  if (existing) return existing;

  const seedId = generateId();
  const seedValue = String(await deriveDailySeed(secret, date));
  const shareCode = generateShareCode();

  try {
    await db.prepare(
      'INSERT INTO puzzle_seeds (id, seed_value, share_code, is_daily, daily_date) VALUES (?, ?, ?, 1, ?)'
    ).bind(seedId, seedValue, shareCode, date).run();
    return { id: seedId, seed_value: seedValue, share_code: shareCode };
  } catch {
    // Concurrent insert — re-fetch the winner's row
    const seed = await db.prepare(SELECT_DAILY).bind(date).first<SeedRecord>();
    if (!seed) throw new Error(`Failed to create or find daily seed for ${date}`);
    return seed;
  }
}
