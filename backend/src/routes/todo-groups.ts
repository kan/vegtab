import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Bindings, Variables } from '../types';
import { generateId } from '../lib/id';

const createGroupSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string(),
  sortOrder: z.number().int().optional(),
});

const updateGroupSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z.string().optional(),
  sortOrder: z.number().int().optional(),
});

export const todoGroupRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// GET /api/todo-groups
todoGroupRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const groups = await c.env.DB.prepare(
    'SELECT id, name, color, sort_order FROM todo_groups WHERE user_id = ? ORDER BY sort_order'
  ).bind(userId).all<{
    id: string; name: string; color: string; sort_order: number;
  }>();

  return c.json({
    groups: (groups.results ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      color: g.color,
      sortOrder: g.sort_order,
    })),
  });
});

// POST /api/todo-groups
todoGroupRoutes.post('/', zValidator('json', createGroupSchema), async (c) => {
  const userId = c.get('userId');
  const { name, color, sortOrder } = c.req.valid('json');

  // Check 5-group limit
  const count = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM todo_groups WHERE user_id = ?'
  ).bind(userId).first<{ cnt: number }>();
  if (count && count.cnt >= 5) {
    return c.json({ error: 'Maximum 5 groups allowed' }, 400);
  }

  const id = generateId();
  await c.env.DB.prepare(
    'INSERT INTO todo_groups (id, user_id, name, color, sort_order) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, userId, name, color, sortOrder ?? 0).run();

  return c.json({ id }, 201);
});

// PATCH /api/todo-groups/:id
todoGroupRoutes.patch('/:id', zValidator('json', updateGroupSchema), async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('id');
  const updates = c.req.valid('json');

  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.color !== undefined) { sets.push('color = ?'); values.push(updates.color); }
  if (updates.sortOrder !== undefined) { sets.push('sort_order = ?'); values.push(updates.sortOrder); }
  if (sets.length === 0) return c.json({ success: true });

  sets.push("updated_at = datetime('now')");
  values.push(userId, groupId);

  await c.env.DB.prepare(
    `UPDATE todo_groups SET ${sets.join(', ')} WHERE user_id = ? AND id = ?`
  ).bind(...values).run();

  return c.json({ success: true });
});

// DELETE /api/todo-groups/:id
todoGroupRoutes.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('id');

  // Unassign todos from this group
  await c.env.DB.prepare(
    "UPDATE todos SET group_id = NULL, updated_at = datetime('now') WHERE user_id = ? AND group_id = ?"
  ).bind(userId, groupId).run();

  await c.env.DB.prepare(
    'DELETE FROM todo_groups WHERE id = ? AND user_id = ?'
  ).bind(groupId, userId).run();

  return c.json({ success: true });
});
