import { createMiddleware } from 'hono/factory';
import type { Bindings, Variables } from '../types';
import { authenticate } from '../lib/id-auth';
import { getAllowedOrigins } from '../lib/env';

/**
 * Requires the kan-game.app ID cookie and sets `userId` to the ID.
 *
 * The cookie goes with any request to kan-game.app, so a request that writes must name an allowed
 * origin; browsers always send Origin with those. A same-origin GET may omit it, so GETs cannot
 * require it, and no GET writes.
 */
export const authMiddleware = createMiddleware<{
  Bindings: Bindings;
  Variables: Variables;
}>(async (c, next) => {
  const origin = c.req.header('Origin');
  const allowed = getAllowedOrigins(c.env);
  if (origin ? !allowed.includes(origin) : c.req.method !== 'GET') {
    return c.json({ error: 'forbidden_origin' }, 403);
  }

  const auth = await authenticate(c.req.raw, c.env);
  if (auth.status === 'unauthorized') return c.json({ error: 'unauthorized' }, 401);
  // The client asks the ID platform for a new ID after this
  if (auth.status === 'deleted') return c.json({ error: 'id_deleted' }, 410);

  c.set('userId', auth.accountId);
  await next();
});
