import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Bindings, Variables } from '../types';
import { calculateCurrentStamina } from '../lib/stamina';

const updateProfileSchema = z.object({
  displayName: z.string().max(20).nullable(),
});

export const userRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// GET /api/user/profile
userRoutes.get('/profile', async (c) => {
  const userId = c.get('userId');

  const user = await c.env.DB.prepare(
    'SELECT id, display_name, is_premium, stamina, last_stamina_recover_at, undo_stock FROM users WHERE id = ?'
  ).bind(userId).first<{
    id: string;
    display_name: string | null;
    is_premium: number;
    stamina: number;
    last_stamina_recover_at: string;
    undo_stock: number;
  }>();

  if (!user) return c.json({ error: 'User not found' }, 404);

  // Calculate time-based stamina recovery
  const { stamina, lastRecoverAt } = calculateCurrentStamina({
    stamina: user.stamina,
    lastStaminaRecoverAt: user.last_stamina_recover_at,
  });

  // Persist recovered stamina
  if (stamina !== user.stamina) {
    await c.env.DB.prepare(
      'UPDATE users SET stamina = ?, last_stamina_recover_at = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).bind(stamina, lastRecoverAt, userId).run();
  }

  // Fetch items
  const items = await c.env.DB.prepare(
    'SELECT item_type, quantity FROM user_items WHERE user_id = ? AND quantity > 0'
  ).bind(userId).all<{ item_type: string; quantity: number }>();

  return c.json({
    id: user.id,
    displayName: user.display_name,
    isPremium: !!user.is_premium,
    stamina,
    undoStock: user.undo_stock,
    items: Object.fromEntries(
      (items.results ?? []).map((i) => [i.item_type, i.quantity])
    ),
  });
});

// PATCH /api/user/profile
userRoutes.patch('/profile', zValidator('json', updateProfileSchema), async (c) => {
  const userId = c.get('userId');
  const { displayName } = c.req.valid('json');

  await c.env.DB.prepare(
    'UPDATE users SET display_name = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(displayName, userId).run();

  return c.json({ success: true });
});
