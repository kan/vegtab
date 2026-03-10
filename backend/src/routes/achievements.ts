import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { ACHIEVEMENT_DEFS } from '../lib/achievement-defs';

export const achievementRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

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
