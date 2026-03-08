import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Bindings, Variables } from '../types';
import { generateId } from '../lib/id';
import { todayUTC } from '../lib/date';
import { MAX_STAMINA } from '../lib/stamina';

const subtaskSchema = z.object({
  text: z.string(),
  done: z.boolean(),
});

const createTodoSchema = z.object({
  title: z.string().min(1).max(200),
  memo: z.string().max(1000).nullable().optional(),
  dueDate: z.string().nullable().optional(),
  groupId: z.string().nullable().optional(),
  recurrenceRule: z.string().nullable().optional(),
  subtasks: z.array(subtaskSchema).optional(),
});

const updateTodoSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  memo: z.string().max(1000).nullable().optional(),
  dueDate: z.string().nullable().optional(),
  groupId: z.string().nullable().optional(),
  recurrenceRule: z.string().nullable().optional(),
  subtasks: z.array(subtaskSchema).optional(),
});

export const todoRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// GET /api/todos
todoRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const status = c.req.query('status') ?? 'active';

  const todos = await c.env.DB.prepare(
    'SELECT id, group_id, title, memo, due_date, recurrence_rule, status, subtasks, completed_at, created_at FROM todos WHERE user_id = ? AND status = ? ORDER BY created_at DESC'
  ).bind(userId, status).all<{
    id: string; group_id: string | null; title: string; memo: string | null;
    due_date: string | null; recurrence_rule: string | null; status: string;
    subtasks: string; completed_at: string | null; created_at: string;
  }>();

  return c.json({
    todos: (todos.results ?? []).map((t) => ({
      id: t.id,
      groupId: t.group_id,
      title: t.title,
      memo: t.memo,
      dueDate: t.due_date,
      recurrenceRule: t.recurrence_rule,
      status: t.status,
      subtasks: JSON.parse(t.subtasks),
      completedAt: t.completed_at,
      createdAt: t.created_at,
    })),
  });
});

// POST /api/todos
todoRoutes.post('/', zValidator('json', createTodoSchema), async (c) => {
  const userId = c.get('userId');
  const data = c.req.valid('json');
  const id = generateId();

  await c.env.DB.prepare(
    `INSERT INTO todos (id, user_id, group_id, title, memo, due_date, recurrence_rule, subtasks)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, userId, data.groupId ?? null, data.title, data.memo ?? null,
    data.dueDate ?? null, data.recurrenceRule ?? null,
    JSON.stringify(data.subtasks ?? [])
  ).run();

  return c.json({ id }, 201);
});

// PATCH /api/todos/:id
todoRoutes.patch('/:id', zValidator('json', updateTodoSchema), async (c) => {
  const userId = c.get('userId');
  const todoId = c.req.param('id');
  const updates = c.req.valid('json');

  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.title !== undefined) { sets.push('title = ?'); values.push(updates.title); }
  if (updates.memo !== undefined) { sets.push('memo = ?'); values.push(updates.memo); }
  if (updates.dueDate !== undefined) { sets.push('due_date = ?'); values.push(updates.dueDate); }
  if (updates.groupId !== undefined) { sets.push('group_id = ?'); values.push(updates.groupId); }
  if (updates.recurrenceRule !== undefined) { sets.push('recurrence_rule = ?'); values.push(updates.recurrenceRule); }
  if (updates.subtasks !== undefined) { sets.push('subtasks = ?'); values.push(JSON.stringify(updates.subtasks)); }
  if (sets.length === 0) return c.json({ success: true });

  sets.push("updated_at = datetime('now')");
  values.push(userId, todoId);

  await c.env.DB.prepare(
    `UPDATE todos SET ${sets.join(', ')} WHERE user_id = ? AND id = ?`
  ).bind(...values).run();

  return c.json({ success: true });
});

// POST /api/todos/:id/complete - Complete a TODO with game rewards
todoRoutes.post('/:id/complete', async (c) => {
  const userId = c.get('userId');
  const todoId = c.req.param('id');
  const today = todayUTC();

  // Verify todo exists and is active
  const todo = await c.env.DB.prepare(
    'SELECT id, recurrence_rule, title, memo, due_date, group_id, subtasks FROM todos WHERE id = ? AND user_id = ? AND status = \'active\''
  ).bind(todoId, userId).first<{
    id: string; recurrence_rule: string | null; title: string; memo: string | null;
    due_date: string | null; group_id: string | null; subtasks: string;
  }>();
  if (!todo) return c.json({ error: 'Todo not found or already completed' }, 404);

  // Batch: mark done + fetch all needed state in parallel
  const [, progressResult, recoveryResult, userResult] = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE todos SET status = 'done', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).bind(todoId),
    c.env.DB.prepare(
      'SELECT id, completed_count, item_claimed, undo_claimed FROM daily_todo_progress WHERE user_id = ? AND target_date = ?'
    ).bind(userId, today),
    c.env.DB.prepare(
      'SELECT id, recovered_count FROM stamina_recovery_logs WHERE user_id = ? AND target_date = ?'
    ).bind(userId, today),
    c.env.DB.prepare(
      'SELECT stamina, undo_stock FROM users WHERE id = ?'
    ).bind(userId),
  ]);

  // Daily progress
  let progress = (progressResult.results?.[0] ?? null) as {
    id: string; completed_count: number; item_claimed: number; undo_claimed: number;
  } | null;

  if (!progress) {
    const progressId = generateId();
    await c.env.DB.prepare(
      'INSERT INTO daily_todo_progress (id, user_id, target_date, completed_count) VALUES (?, ?, ?, 1)'
    ).bind(progressId, userId, today).run();
    progress = { id: progressId, completed_count: 1, item_claimed: 0, undo_claimed: 0 };
  } else {
    await c.env.DB.prepare(
      "UPDATE daily_todo_progress SET completed_count = completed_count + 1, updated_at = datetime('now') WHERE id = ?"
    ).bind(progress.id).run();
    progress.completed_count += 1;
  }

  const recoveryLog = (recoveryResult.results?.[0] ?? null) as { id: string; recovered_count: number } | null;
  const user = (userResult.results?.[0] ?? null) as { stamina: number; undo_stock: number } | null;

  // Collect writes to batch at the end
  const writes: D1PreparedStatement[] = [];

  // Stamina recovery (max 5 per day)
  let staminaRecovered = false;
  const currentRecoveryCount = recoveryLog?.recovered_count ?? 0;
  if (currentRecoveryCount < 5) {
    if (user && user.stamina < MAX_STAMINA) {
      writes.push(c.env.DB.prepare(
        "UPDATE users SET stamina = stamina + 1, updated_at = datetime('now') WHERE id = ?"
      ).bind(userId));
      staminaRecovered = true;
    }

    if (recoveryLog) {
      writes.push(c.env.DB.prepare(
        'UPDATE stamina_recovery_logs SET recovered_count = recovered_count + 1 WHERE id = ?'
      ).bind(recoveryLog.id));
    } else {
      writes.push(c.env.DB.prepare(
        'INSERT INTO stamina_recovery_logs (id, user_id, target_date, recovered_count) VALUES (?, ?, ?, 1)'
      ).bind(generateId(), userId, today));
    }
  }

  // Undo ticket (max 1 per day, stock max 10)
  let undoGranted = false;
  if (!progress.undo_claimed) {
    if (user && user.undo_stock < 10) {
      // If stamina write already queued for users table, combine; otherwise add separate
      if (staminaRecovered) {
        // Replace the stamina-only update with a combined one
        writes[0] = c.env.DB.prepare(
          "UPDATE users SET stamina = stamina + 1, undo_stock = undo_stock + 1, updated_at = datetime('now') WHERE id = ?"
        ).bind(userId);
      } else {
        writes.push(c.env.DB.prepare(
          "UPDATE users SET undo_stock = undo_stock + 1, updated_at = datetime('now') WHERE id = ?"
        ).bind(userId));
      }
      undoGranted = true;
    }
    writes.push(c.env.DB.prepare(
      "UPDATE daily_todo_progress SET undo_claimed = 1, updated_at = datetime('now') WHERE id = ?"
    ).bind(progress.id));
  }

  // Execute all accumulated writes in a single batch
  if (writes.length > 0) {
    await c.env.DB.batch(writes);
  }

  // Note: Recurrence (next occurrence) is handled by the frontend,
  // which creates the new todo via POST /api/todos after completion.

  return c.json({
    completedCount: progress.completed_count,
    staminaRecovered,
    undoGranted,
  });
});

// DELETE /api/todos/:id
todoRoutes.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const todoId = c.req.param('id');

  await c.env.DB.prepare(
    'DELETE FROM todos WHERE id = ? AND user_id = ?'
  ).bind(todoId, userId).run();

  return c.json({ success: true });
});

