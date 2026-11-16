import type { AccountRequest, Route } from '../router';
import { json, readJsonBody } from '../lib/http';
import { isRecord } from '../lib/validate';
import { ACHIEVEMENT_DEFS } from '../../core';

/** Client-unlockable achievement types (not tied to score submission) */
const CLIENT_UNLOCKABLE: readonly string[] = ['tutorial_complete'];

export const achievementRoutes: Route<AccountRequest>[] = [
  // POST /api/achievements/unlock - Unlock a client-triggered achievement
  {
    method: 'POST',
    path: '/api/achievements/unlock',
    async handler({ request, env, accountId }) {
      const type = await readJsonBody(request, (body) =>
        isRecord(body) && typeof body.type === 'string' && CLIENT_UNLOCKABLE.includes(body.type) ? body.type : undefined);
      if (type instanceof Response) return type;

      // Defense-in-depth: ensure type exists in defs even if CLIENT_UNLOCKABLE drifts
      const def = ACHIEVEMENT_DEFS.find(d => d.type === type);
      if (!def) return json({ error: 'unknown_achievement' }, 400);

      await env.DB.prepare(`
        INSERT INTO achievements (id, user_id, achievement_type, current_value, is_unlocked, unlocked_at)
        VALUES (?, ?, ?, ?, 1, datetime('now'))
        ON CONFLICT (user_id, achievement_type) DO UPDATE SET
          is_unlocked = 1,
          unlocked_at = COALESCE(achievements.unlocked_at, datetime('now'))
      `).bind(crypto.randomUUID(), accountId, type, def.threshold).run();

      return json({ ok: true });
    },
  },

  // GET /api/achievements - Get user's achievements
  {
    method: 'GET',
    path: '/api/achievements',
    async handler({ env, accountId }) {
      const rows = await env.DB.prepare(
        'SELECT achievement_type, current_value, is_unlocked, unlocked_at FROM achievements WHERE user_id = ?'
      ).bind(accountId).all<{
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

      return json({ achievements });
    },
  },
];
