import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Bindings, Variables } from '../types';
import { rotateRefreshToken } from '../lib/refresh-tokens';

/**
 * The old accounts' tokens (vegtab.app). New accounts are kan-game.app IDs (lib/id-auth.ts); these
 * stay only so that the old screen can renew its access token to hand the account over
 * (routes/legacy.ts). Removed when vegtab.app closes (docs/SPEC.md §5.4)
 */
const refreshSchema = z.object({
  refreshToken: z.string(),
});

export const authRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// POST /api/auth/refresh - Rotate the refresh token and issue a new access token
authRoutes.post('/refresh', zValidator('json', refreshSchema), async (c) => {
  const { refreshToken } = c.req.valid('json');

  const tokens = await rotateRefreshToken(c.env.DB, c.env.JWT_SECRET, refreshToken);
  if (!tokens) {
    return c.json({ error: 'Invalid refresh token' }, 401);
  }

  return c.json(tokens);
});
