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

  // Mark as done
  await c.env.DB.prepare(
    "UPDATE todos SET status = 'done', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).bind(todoId).run();

  // Get or create daily progress
  let progress = await c.env.DB.prepare(
    'SELECT id, completed_count, item_claimed, undo_claimed FROM daily_todo_progress WHERE user_id = ? AND target_date = ?'
  ).bind(userId, today).first<{
    id: string; completed_count: number; item_claimed: number; undo_claimed: number;
  }>();

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

  // Stamina recovery (max 5 per day)
  let staminaRecovered = false;
  const recoveryLog = await c.env.DB.prepare(
    'SELECT id, recovered_count FROM stamina_recovery_logs WHERE user_id = ? AND target_date = ?'
  ).bind(userId, today).first<{ id: string; recovered_count: number }>();

  const currentRecoveryCount = recoveryLog?.recovered_count ?? 0;
  if (currentRecoveryCount < 5) {
    const user = await c.env.DB.prepare(
      'SELECT stamina FROM users WHERE id = ?'
    ).bind(userId).first<{ stamina: number }>();

    if (user && user.stamina < MAX_STAMINA) {
      await c.env.DB.prepare(
        "UPDATE users SET stamina = stamina + 1, updated_at = datetime('now') WHERE id = ?"
      ).bind(userId).run();
      staminaRecovered = true;
    }

    if (recoveryLog) {
      await c.env.DB.prepare(
        'UPDATE stamina_recovery_logs SET recovered_count = recovered_count + 1 WHERE id = ?'
      ).bind(recoveryLog.id).run();
    } else {
      await c.env.DB.prepare(
        'INSERT INTO stamina_recovery_logs (id, user_id, target_date, recovered_count) VALUES (?, ?, ?, 1)'
      ).bind(generateId(), userId, today).run();
    }
  }

  // Undo ticket (max 1 per day, stock max 10)
  let undoGranted = false;
  if (!progress.undo_claimed) {
    const user = await c.env.DB.prepare(
      'SELECT undo_stock FROM users WHERE id = ?'
    ).bind(userId).first<{ undo_stock: number }>();

    if (user && user.undo_stock < 10) {
      await c.env.DB.prepare(
        "UPDATE users SET undo_stock = undo_stock + 1, updated_at = datetime('now') WHERE id = ?"
      ).bind(userId).run();
      undoGranted = true;
    }
    await c.env.DB.prepare(
      "UPDATE daily_todo_progress SET undo_claimed = 1, updated_at = datetime('now') WHERE id = ?"
    ).bind(progress.id).run();
  }

  // Handle recurrence: create next occurrence
  if (todo.recurrence_rule) {
    const nextDate = calculateNextOccurrence(todo.recurrence_rule, todo.due_date);
    const newId = generateId();
    await c.env.DB.prepare(
      `INSERT INTO todos (id, user_id, group_id, title, memo, due_date, recurrence_rule, subtasks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      newId, userId, todo.group_id, todo.title, todo.memo,
      nextDate, todo.recurrence_rule,
      // Reset subtask completion for next occurrence
      JSON.stringify(JSON.parse(todo.subtasks).map((s: { text: string }) => ({ text: s.text, done: false })))
    ).run();
  }

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

function calculateNextOccurrence(rule: string, currentDueDate: string | null): string {
  const base = currentDueDate ? new Date(currentDueDate + 'T00:00:00Z') : new Date();

  if (rule === 'daily') {
    base.setUTCDate(base.getUTCDate() + 1);
  } else if (rule.startsWith('weekly:')) {
    // weekly:1 (Monday=1, Sunday=0)
    const targetDay = parseInt(rule.split(':')[1], 10);
    do {
      base.setUTCDate(base.getUTCDate() + 1);
    } while (base.getUTCDay() !== targetDay);
  } else if (rule.startsWith('monthly:')) {
    // monthly:15 (15th of each month)
    const targetDate = parseInt(rule.split(':')[1], 10);
    base.setUTCMonth(base.getUTCMonth() + 1);
    base.setUTCDate(Math.min(targetDate, daysInMonth(base.getUTCFullYear(), base.getUTCMonth())));
  }

  return base.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}
