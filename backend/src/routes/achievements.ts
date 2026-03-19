import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { ACHIEVEMENT_DEFS } from '../lib/achievement-defs';

/** Client-unlockable achievement types (not tied to score submission) */
const CLIENT_UNLOCKABLE: ReadonlySet<string> = new Set(['tutorial_complete']);

export const achievementRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// POST /api/achievements/unlock - Unlock a client-triggered achievement
achievementRoutes.post('/unlock', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ type: string }>();

  if (!body.type || !CLIENT_UNLOCKABLE.has(body.type)) {
    return c.json({ error: 'Invalid achievement type' }, 400);
  }

  // Defense-in-depth: ensure type exists in defs even if CLIENT_UNLOCKABLE drifts
  const def = ACHIEVEMENT_DEFS.find(d => d.type === body.type);
  if (!def) return c.json({ error: 'Unknown achievement' }, 400);

  await c.env.DB.prepare(`
    INSERT INTO achievements (id, user_id, achievement_type, current_value, is_unlocked, unlocked_at)
    VALUES (?, ?, ?, ?, 1, datetime('now'))
    ON CONFLICT (user_id, achievement_type) DO UPDATE SET
      is_unlocked = 1,
      unlocked_at = COALESCE(achievements.unlocked_at, datetime('now'))
  `).bind(crypto.randomUUID(), userId, body.type, def.threshold).run();

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
