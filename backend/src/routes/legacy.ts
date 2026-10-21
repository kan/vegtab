import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Bindings, Variables } from '../types';
import { verifyAccessToken } from '../lib/jwt';
import { getBaseUrl } from '../lib/env';
import { claimLegacy, issueHandoff } from '../lib/legacy';

/**
 * POST /api/legacy/handoff — for the old screen on vegtab.app, with its Bearer access token.
 * Returns the URL that opens vegtab.kan-game.app with a handoff token (lib/legacy.ts)
 */
export const legacyHandoffRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

legacyHandoffRoutes.post('/handoff', async (c) => {
  const authHeader = c.req.header('Authorization');
  const userId = authHeader?.startsWith('Bearer ')
    ? await verifyAccessToken(authHeader.slice(7), c.env.JWT_SECRET)
    : null;
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  const legacy = await c.env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(userId).first();
  // Handed over already (from this or another device)
  if (!legacy) return c.json({ error: 'claimed' }, 409);

  const token = await issueHandoff(c.env.DB, userId);
  return c.json({ url: `${getBaseUrl(c.env)}/#handoff=${token}` });
});

const claimSchema = z.object({ token: z.string().min(1).max(64) });

/** POST /api/legacy/claim — on vegtab.kan-game.app, with the ID cookie (behind authMiddleware) */
export const legacyClaimRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

legacyClaimRoutes.post('/claim', zValidator('json', claimSchema), async (c) => {
  const result = await claimLegacy(c.env, c.get('userId'), c.req.valid('json').token);
  if (!result.ok) return c.json({ error: 'invalid_token' }, 400);
  return c.json({ name: result.name });
});
