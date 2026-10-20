import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Bindings, Variables } from '../types';
import { ACHIEVEMENT_DEFS } from '@vegtab/engine';

const unlockSchema = z.object({
  /** Client-unlockable achievement types (not tied to score submission) */
  type: z.enum(['tutorial_complete']),
});

export const achievementRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// POST /api/achievements/unlock - Unlock a client-triggered achievement
achievementRoutes.post('/unlock', zValidator('json', unlockSchema), async (c) => {
  const userId = c.get('userId');
  const { type } = c.req.valid('json');

  // Defense-in-depth: ensure type exists in defs even if CLIENT_UNLOCKABLE drifts
  const def = ACHIEVEMENT_DEFS.find(d => d.type === type);
  if (!def) return c.json({ error: 'Unknown achievement' }, 400);

  await c.env.DB.prepare(`
    INSERT INTO achievements (id, user_id, achievement_type, current_value, is_unlocked, unlocked_at)
    VALUES (?, ?, ?, ?, 1, datetime('now'))
    ON CONFLICT (user_id, achievement_type) DO UPDATE SET
      is_unlocked = 1,
      unlocked_at = COALESCE(achievements.unlocked_at, datetime('now'))
  `).bind(crypto.randomUUID(), userId, type, def.threshold).run();

  return c.json({ ok: true });
});

// GET /api/achievements - Get user's achievements
achievementRoutes.get('/', async (c) => {
  const userId = c.get('userId');

  const rows = await c.env.DB.prepare(
    'SELECT achievement_type, current_value, is_unlocked, unlocked_at FROM achievements WHERE user_id = ?'
  ).bind(userId).all<{
    achievement_type: string;
    current_value: number;
    is_unlocked: number;
    unlocked_at: string | null;
  }>();

  const rowMap = new Map(
    (rows.results ?? []).map(r => [r.achievement_type, r])
  );

  // Return all defined achievements, filling in defaults for missing ones
  const achievements = ACHIEVEMENT_DEFS.map(def => {
    const row = rowMap.get(def.type);
    return {
      type: def.type,
      currentValue: row?.current_value ?? 0,
      isUnlocked: row?.is_unlocked === 1,
      unlockedAt: row?.unlocked_at ?? null,
    };
  });

  return c.json({ achievements });
});
