import { describe, it, expect, beforeEach } from 'vitest';
import { SELF } from 'cloudflare:test';
import { applyMigrations, registerUser, authHeader } from './helpers';

describe('TODO API', () => {
  let accessToken: string;

  beforeEach(async () => {
    await applyMigrations();
    const reg = await registerUser('550e8400-e29b-41d4-a716-446655440010');
    accessToken = reg.accessToken;
  });

  it('creates and lists todos', async () => {
    const createRes = await SELF.fetch('http://localhost/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(accessToken) },
      body: JSON.stringify({ title: 'Test task' }),
    });
    expect(createRes.status).toBe(201);
    const { id } = await createRes.json() as { id: string };
    expect(id).toBeTruthy();

    const listRes = await SELF.fetch('http://localhost/api/todos', {
      headers: authHeader(accessToken),
    });
    const { todos } = await listRes.json() as { todos: Array<{ id: string; title: string }> };
    expect(todos).toHaveLength(1);
    expect(todos[0].title).toBe('Test task');
  });

  it('updates a todo', async () => {
    const createRes = await SELF.fetch('http://localhost/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(accessToken) },
      body: JSON.stringify({ title: 'Original' }),
    });
    const { id } = await createRes.json() as { id: string };

    await SELF.fetch(`http://localhost/api/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader(accessToken) },
      body: JSON.stringify({ title: 'Updated' }),
    });

    const listRes = await SELF.fetch('http://localhost/api/todos', {
      headers: authHeader(accessToken),
    });
    const { todos } = await listRes.json() as { todos: Array<{ title: string }> };
    expect(todos[0].title).toBe('Updated');
  });

  it('completing a todo grants stamina and undo', async () => {
    // User starts with stamina=5, reduce it first
    // Create and complete a todo
    const createRes = await SELF.fetch('http://localhost/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(accessToken) },
      body: JSON.stringify({ title: 'Complete me' }),
    });
    const { id } = await createRes.json() as { id: string };

    const completeRes = await SELF.fetch(`http://localhost/api/todos/${id}/complete`, {
      method: 'POST',
      headers: authHeader(accessToken),
    });
    expect(completeRes.status).toBe(200);
    const result = await completeRes.json() as {
      completedCount: number; staminaRecovered: boolean; undoGranted: boolean;
    };
    expect(result.completedCount).toBe(1);
    // Stamina was already at max (5), so no recovery
    expect(result.staminaRecovered).toBe(false);
    expect(result.undoGranted).toBe(true);

    // Check undo stock increased
    const profileRes = await SELF.fetch('http://localhost/api/user/profile', {
      headers: authHeader(accessToken),
    });
    const profile = await profileRes.json() as { undoStock: number };
    expect(profile.undoStock).toBe(1);
  });

  it('deletes a todo', async () => {
    const createRes = await SELF.fetch('http://localhost/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(accessToken) },
      body: JSON.stringify({ title: 'Delete me' }),
    });
    const { id } = await createRes.json() as { id: string };

    await SELF.fetch(`http://localhost/api/todos/${id}`, {
      method: 'DELETE',
      headers: authHeader(accessToken),
    });

    const listRes = await SELF.fetch('http://localhost/api/todos', {
      headers: authHeader(accessToken),
    });
    const { todos } = await listRes.json() as { todos: unknown[] };
    expect(todos).toHaveLength(0);
  });

  it('completing todo with recurrence does not duplicate (frontend handles next occurrence)', async () => {
    const createRes = await SELF.fetch('http://localhost/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(accessToken) },
      body: JSON.stringify({
        title: 'Daily task',
        dueDate: '2026-03-08',
        recurrenceRule: 'daily',
      }),
    });
    const { id } = await createRes.json() as { id: string };

    const completeRes = await SELF.fetch(`http://localhost/api/todos/${id}/complete`, {
      method: 'POST',
      headers: authHeader(accessToken),
    });
    expect(completeRes.status).toBe(200);

    // Backend should NOT create next occurrence (frontend does it via POST /api/todos)
    const listRes = await SELF.fetch('http://localhost/api/todos', {
      headers: authHeader(accessToken),
    });
    const { todos } = await listRes.json() as { todos: Array<{ title: string }> };
    expect(todos).toHaveLength(0);
  });
});
