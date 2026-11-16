import type { MiddlewareHandler } from 'hono';
import type { Bindings, Variables } from '../types';

/**
 * Headers for the responses of the Worker's code (/api/*, /s/*). The SPA from Static Assets gets the
 * same ones from frontend/public/_headers, which does not apply to responses the Worker makes.
 *
 * - The screen may not be framed by other sites (clickjacking), and nosniff / Referrer-Policy as the
 *   other kan-game.app games
 * - The API is per ID (the cookie), so no cache on the way may keep a response
 * - Environments other than production are kept out of search engines
 */
export const responseHeaders: MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> = async (c, next) => {
  await next();
  // A response passed on from a fetch (the ID platform's, /api/id/*) has immutable headers
  const res = new Response(c.res.body, c.res);
  const headers = res.headers;
  if (!headers.has('Content-Security-Policy')) {
    headers.set('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  }
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (new URL(c.req.url).pathname.startsWith('/api/')) headers.set('Cache-Control', 'no-store');
  if (c.env.ENVIRONMENT !== 'production') headers.set('X-Robots-Tag', 'noindex');
  c.res = res;
};
