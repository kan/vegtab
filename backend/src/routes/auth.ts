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

const TRANSFER_CODE_TTL_SECONDS = 600;

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

  // One active 8-char code per user: issuing a new code invalidates the previous one.
  // Expired codes of any user are purged at the same time.
  const code = generateShareCode(8);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM transfer_codes WHERE user_id = ? OR expires_at <= datetime('now')"
    ).bind(userId),
    c.env.DB.prepare(
      "INSERT INTO transfer_codes (code, user_id, expires_at) VALUES (?, ?, datetime('now', ?))"
    ).bind(code, userId, `+${TRANSFER_CODE_TTL_SECONDS} seconds`),
  ]);

  return c.json({ code, expiresIn: TRANSFER_CODE_TTL_SECONDS });
});

// POST /api/auth/redeem-transfer - Redeem a transfer code (public)
authRoutes.post('/redeem-transfer', zValidator('json', redeemSchema), async (c) => {
  const { code, deviceId } = c.req.valid('json');

  // Throttle guessing: codes are short-lived but the endpoint is public
  const clientIp = c.req.header('cf-connecting-ip') ?? 'unknown';
  const { success } = await c.env.TRANSFER_RATE_LIMITER.limit({ key: clientIp });
  if (!success) {
    return c.json({ error: 'Too many attempts' }, 429);
  }

  // Link the device and consume the code in one transaction: the code can be redeemed only once,
  // and a failed link can't leave it used up. Both statements use the same clock reading,
  // formatted like SQLite's datetime('now').
  const normalizedCode = code.toUpperCase();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const [, consumed] = await c.env.DB.batch<{ user_id: string }>([
    c.env.DB.prepare(`
      INSERT INTO user_devices (id, user_id, device_id)
      SELECT ?, user_id, ? FROM transfer_codes WHERE code = ? AND expires_at > ?
      ON CONFLICT (device_id) DO UPDATE SET user_id = excluded.user_id
    `).bind(generateId(), deviceId, normalizedCode, now),
    c.env.DB.prepare(
      'DELETE FROM transfer_codes WHERE code = ? AND expires_at > ? RETURNING user_id'
    ).bind(normalizedCode, now),
  ]);
  const userId = consumed.results[0]?.user_id;
  if (!userId) {
    return c.json({ error: 'Invalid or expired transfer code' }, 400);
  }

  const [user, accessToken, refreshToken] = await Promise.all([
    c.env.DB.prepare('SELECT display_name FROM users WHERE id = ?')
      .bind(userId).first<{ display_name: string | null }>(),
    createAccessToken(userId, c.env.JWT_SECRET),
    createRefreshToken(userId, c.env.JWT_SECRET),
  ]);

  return c.json({
    userId,
    displayName: user?.display_name ?? null,
    accessToken,
    refreshToken,
  });
});
