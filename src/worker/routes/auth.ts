import type { Route } from '../router';
import { json, readJsonBody } from '../lib/http';
import { isRecord } from '../lib/validate';
import { rotateRefreshToken } from '../lib/refresh-tokens';

/**
 * The old accounts' tokens (vegtab.app). New accounts are kan-game.app IDs (lib/id-auth.ts); these
 * stay only so that the old screen can renew its access token to hand the account over
 * (routes/legacy.ts). Removed when vegtab.app closes (docs/DATA_CONTRACT.md「旧 URL からの引き継ぎ」)
 */
export const authRoutes: Route[] = [
  // POST /api/auth/refresh - Rotate the refresh token and issue a new access token
  {
    method: 'POST',
    path: '/api/auth/refresh',
    async handler({ request, env }) {
      const refreshToken = await readJsonBody(request, (body) =>
        isRecord(body) && typeof body.refreshToken === 'string' ? body.refreshToken : undefined);
      if (refreshToken instanceof Response) return refreshToken;

      const tokens = await rotateRefreshToken(env.DB, env.JWT_SECRET, refreshToken);
      if (!tokens) return json({ error: 'invalid_refresh_token' }, 401);
      return json(tokens);
    },
  },
];
