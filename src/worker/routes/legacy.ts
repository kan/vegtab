import type { AccountRequest, Route } from '../router';
import { json, readJsonBody } from '../lib/http';
import { isRecord, isStringOfLength } from '../lib/validate';
import { verifyAccessToken } from '../lib/jwt';
import { getBaseUrl } from '../lib/env';
import { claimLegacy, issueHandoff } from '../lib/legacy';

/**
 * POST /api/legacy/handoff — for the old screen on vegtab.app, with its Bearer access token.
 * Returns the URL that opens vegtab.kan-game.app with a handoff token (lib/legacy.ts)
 */
export const legacyHandoffRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/legacy/handoff',
    async handler({ request, env }) {
      const authHeader = request.headers.get('Authorization');
      const userId = authHeader?.startsWith('Bearer ')
        ? await verifyAccessToken(authHeader.slice(7), env.JWT_SECRET)
        : null;
      if (!userId) return json({ error: 'unauthorized' }, 401);

      const legacy = await env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(userId).first();
      // Handed over already (from this or another device)
      if (!legacy) return json({ error: 'claimed' }, 409);

      const token = await issueHandoff(env.DB, userId);
      return json({ url: `${getBaseUrl(env)}/#handoff=${token}` });
    },
  },
];

/** POST /api/legacy/claim — on vegtab.kan-game.app, with the ID cookie (an account route) */
export const legacyClaimRoutes: Route<AccountRequest>[] = [
  {
    method: 'POST',
    path: '/api/legacy/claim',
    async handler({ request, env, accountId }) {
      const token = await readJsonBody(request, (body) =>
        isRecord(body) && isStringOfLength(body.token, 1, 64) ? body.token : undefined);
      if (token instanceof Response) return token;

      const result = await claimLegacy(env, accountId, token);
      if (!result.ok) return json({ error: 'invalid_token' }, 400);
      return json({ name: result.name });
    },
  },
];
