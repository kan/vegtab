import { describe, it, expect } from 'vitest';
import { deriveDailySeed, KEYED_SEED_START } from '../../src/worker/lib/seed';

describe('deriveDailySeed', () => {
  it('keeps the old date hash before KEYED_SEED_START (the boards already played)', async () => {
    expect(await deriveDailySeed('any', '2026-04-05')).toBe(await deriveDailySeed('other', '2026-04-05'));
    expect(await deriveDailySeed(undefined, '2026-09-03')).toBe(1161904060);
  });

  it('depends on the secret from KEYED_SEED_START, so the days ahead cannot be computed without it', async () => {
    const a = await deriveDailySeed('secret-a', KEYED_SEED_START);
    const b = await deriveDailySeed('secret-b', KEYED_SEED_START);
    expect(a).not.toBe(b);
    expect(await deriveDailySeed('secret-a', KEYED_SEED_START)).toBe(a);
  });

  it('gives a different seed each day, in the range of the old seeds', async () => {
    const seeds = await Promise.all(
      Array.from({ length: 30 }, (_, i) => deriveDailySeed('secret', `2026-12-${String(i + 1).padStart(2, '0')}`)),
    );
    expect(new Set(seeds).size).toBe(30);
    for (const s of seeds) {
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(2 ** 31);
    }
  });

  it('refuses to derive a keyed seed without the secret', async () => {
    await expect(deriveDailySeed(undefined, KEYED_SEED_START)).rejects.toThrow('DAILY_SEED_SECRET');
    await expect(deriveDailySeed('', KEYED_SEED_START)).rejects.toThrow('DAILY_SEED_SECRET');
  });
});
