import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Bindings, Variables } from '../types';
import { todayUTC } from '../lib/date';
import { generateId } from '../lib/id';

const claimItemSchema = z.object({
  itemType: z.enum(['magnifying_glass', 'scissors', 'cutter', 'clip', 'coffee']),
});

export const dailyProgressRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// GET /api/daily-progress
dailyProgressRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const today = todayUTC();

  const progress = await c.env.DB.prepare(
    'SELECT completed_count, item_claimed, undo_claimed FROM daily_todo_progress WHERE user_id = ? AND target_date = ?'
  ).bind(userId, today).first<{
    completed_count: number; item_claimed: number; undo_claimed: number;
  }>();

  const completedCount = progress?.completed_count ?? 0;
  const itemClaimed = !!(progress?.item_claimed);
  const availableItems = getAvailableItems(completedCount);

  return c.json({
    completedCount,
    itemClaimed,
    undoClaimed: !!(progress?.undo_claimed),
    availableItems: itemClaimed ? [] : availableItems,
  });
});

// POST /api/daily-progress/claim-item
dailyProgressRoutes.post('/claim-item', zValidator('json', claimItemSchema), async (c) => {
  const userId = c.get('userId');
  const today = todayUTC();
  const { itemType } = c.req.valid('json');

  const progress = await c.env.DB.prepare(
    'SELECT id, completed_count, item_claimed FROM daily_todo_progress WHERE user_id = ? AND target_date = ?'
  ).bind(userId, today).first<{
    id: string; completed_count: number; item_claimed: number;
  }>();

  if (!progress || progress.completed_count < 2) {
    return c.json({ error: 'Not enough completed todos (need at least 2)' }, 400);
  }
  if (progress.item_claimed) {
    return c.json({ error: 'Item already claimed today' }, 400);
  }

  const available = getAvailableItems(progress.completed_count);
  if (!available.includes(itemType)) {
    return c.json({ error: 'Item not available at current completion level' }, 400);
  }

  // Upsert user_items
  await c.env.DB.prepare(
    `INSERT INTO user_items (id, user_id, item_type, quantity) VALUES (?, ?, ?, 1)
     ON CONFLICT (user_id, item_type) DO UPDATE SET quantity = quantity + 1`
  ).bind(generateId(), userId, itemType).run();

  // Mark as claimed
  await c.env.DB.prepare(
    "UPDATE daily_todo_progress SET item_claimed = 1, updated_at = datetime('now') WHERE id = ?"
  ).bind(progress.id).run();

  return c.json({ success: true, itemType });
});

function getAvailableItems(completedCount: number): string[] {
  if (completedCount >= 5) return ['magnifying_glass', 'scissors', 'cutter', 'clip', 'coffee'];
  if (completedCount >= 4) return ['magnifying_glass', 'scissors', 'cutter', 'clip'];
  if (completedCount >= 3) return ['magnifying_glass', 'scissors', 'cutter'];
  if (completedCount >= 2) return ['magnifying_glass'];
  return [];
}
