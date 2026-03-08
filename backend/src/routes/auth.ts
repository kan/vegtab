import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Bindings, Variables } from '../types';
import { createAccessToken, createRefreshToken, verifyToken } from '../lib/jwt';
import { generateId } from '../lib/id';

const registerSchema = z.object({
  deviceId: z.string().uuid(),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

export const authRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// POST /api/auth/register - Anonymous guest registration
authRoutes.post('/register', zValidator('json', registerSchema), async (c) => {
  const { deviceId } = c.req.valid('json');

  // Check if device already registered
  const existing = await c.env.DB.prepare(
    'SELECT id FROM users WHERE device_id = ?'
  ).bind(deviceId).first<{ id: string }>();

  let userId: string;
  if (existing) {
    userId = existing.id;
  } else {
    userId = generateId();
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `INSERT INTO users (id, device_id, stamina, last_stamina_recover_at, undo_stock)
       VALUES (?, ?, 5, ?, 0)`
    ).bind(userId, deviceId, now).run();
  }

  const [accessToken, refreshToken] = await Promise.all([
    createAccessToken(userId, c.env.JWT_SECRET),
    createRefreshToken(userId, c.env.JWT_SECRET),
  ]);

  return c.json({ userId, accessToken, refreshToken });
});

// POST /api/auth/refresh - Refresh access token
authRoutes.post('/refresh', zValidator('json', refreshSchema), async (c) => {
  const { refreshToken } = c.req.valid('json');

  const userId = await verifyToken(refreshToken, c.env.JWT_SECRET, 'refresh');
  if (!userId) {
    return c.json({ error: 'Invalid refresh token' }, 401);
  }

  // Verify user still exists
  const user = await c.env.DB.prepare(
    'SELECT id FROM users WHERE id = ?'
  ).bind(userId).first();
  if (!user) {
    return c.json({ error: 'User not found' }, 401);
  }

  const [accessToken, newRefreshToken] = await Promise.all([
    createAccessToken(userId, c.env.JWT_SECRET),
    createRefreshToken(userId, c.env.JWT_SECRET),
  ]);

  return c.json({ accessToken, refreshToken: newRefreshToken });
});
