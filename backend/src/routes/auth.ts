import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Bindings, Variables } from '../types';
import { createAccessToken, createRefreshToken, verifyToken } from '../lib/jwt';
import { generateId, generateShareCode } from '../lib/id';

const registerSchema = z.object({
  deviceId: z.string().uuid(),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

const redeemSchema = z.object({
  code: z.string().min(1).max(10),
  deviceId: z.string().uuid(),
});

export const authRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// POST /api/auth/register - Anonymous guest registration
authRoutes.post('/register', zValidator('json', registerSchema), async (c) => {
  const { deviceId } = c.req.valid('json');

  // Check if device already registered (new table first, fallback to legacy)
  const existingDevice = await c.env.DB.prepare(
    'SELECT user_id FROM user_devices WHERE device_id = ?'
  ).bind(deviceId).first<{ user_id: string }>();

  let userId: string;
  if (existingDevice) {
    userId = existingDevice.user_id;
  } else {
    // Fallback: check legacy users.device_id
    const legacyUser = await c.env.DB.prepare(
      'SELECT id FROM users WHERE device_id = ?'
    ).bind(deviceId).first<{ id: string }>();

    if (legacyUser) {
      userId = legacyUser.id;
      // Migrate to user_devices
      try {
        await c.env.DB.prepare(
          'INSERT INTO user_devices (id, user_id, device_id) VALUES (?, ?, ?)'
        ).bind(generateId(), userId, deviceId).run();
      } catch {
        // Already migrated (unique constraint)
      }
    } else {
      // New user
      userId = generateId();
      await c.env.DB.batch([
        c.env.DB.prepare(
          'INSERT INTO users (id, device_id) VALUES (?, ?)'
        ).bind(userId, deviceId),
        c.env.DB.prepare(
          'INSERT INTO user_devices (id, user_id, device_id) VALUES (?, ?, ?)'
        ).bind(generateId(), userId, deviceId),
      ]);
    }
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

// POST /api/auth/transfer-code - Generate a transfer code (authenticated)
authRoutes.post('/transfer-code', async (c) => {
  // Inline auth: extract userId from Bearer token
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const userId = await verifyToken(authHeader.slice(7), c.env.JWT_SECRET, 'access');
  if (!userId) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  // Generate 8-char code, store in KV with 10-min TTL
  const code = generateShareCode(8);
  await c.env.KV.put(`transfer:${code}`, userId, { expirationTtl: 600 });

  return c.json({ code, expiresIn: 600 });
});

// POST /api/auth/redeem-transfer - Redeem a transfer code (public)
authRoutes.post('/redeem-transfer', zValidator('json', redeemSchema), async (c) => {
  const { code, deviceId } = c.req.valid('json');

  // Look up the transfer code
  const userId = await c.env.KV.get(`transfer:${code.toUpperCase()}`);
  if (!userId) {
    return c.json({ error: 'Invalid or expired transfer code' }, 400);
  }

  // Verify user exists
  const user = await c.env.DB.prepare(
    'SELECT id, display_name FROM users WHERE id = ?'
  ).bind(userId).first<{ id: string; display_name: string | null }>();
  if (!user) {
    return c.json({ error: 'User not found' }, 400);
  }

  // Link new device to user (ignore if already linked)
  try {
    await c.env.DB.prepare(
      'INSERT INTO user_devices (id, user_id, device_id) VALUES (?, ?, ?)'
    ).bind(generateId(), userId, deviceId).run();
  } catch {
    // Device already linked to this user — ok
  }

  // Delete the transfer code (one-time use)
  await c.env.KV.delete(`transfer:${code.toUpperCase()}`);

  // Issue new tokens
  const [accessToken, refreshToken] = await Promise.all([
    createAccessToken(userId, c.env.JWT_SECRET),
    createRefreshToken(userId, c.env.JWT_SECRET),
  ]);

  return c.json({
    userId,
    displayName: user.display_name,
    accessToken,
    refreshToken,
  });
});
