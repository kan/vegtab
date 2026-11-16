import type { AccountRequest, Route } from '../router';
import { json, readJsonBody } from '../lib/http';
import { isRecord, isStringOfLength } from '../lib/validate';
import { idPlatform } from '../lib/id-auth';
import { registerProfile, getProfileName, nameOutcome } from '../lib/profile';
import { rateLimited, takeRateLimitSlot } from '../lib/rate-limit';

/**
 * The body of POST /api/user/profile. The name's rules are the ID platform's (kan/game
 * src/names.ts); this only bounds the input. Publishing the name in vegtab's rankings is agreed to
 * per game (ID_DESIGN.md「名前」), so `consent` must be true
 */
function parseProfile(body: unknown): { displayName: string } | undefined {
  if (!isRecord(body) || body.consent !== true || !isStringOfLength(body.displayName, 1, 256)) return undefined;
  return { displayName: body.displayName };
}

export const userRoutes: Route<AccountRequest>[] = [
  // GET /api/user/profile — the name published in vegtab's rankings, or null before consent.
  // A name chosen in another kan-game.app game comes with POST /api/id/session instead
  {
    method: 'GET',
    path: '/api/user/profile',
    handler: async ({ env, accountId }) => json({ displayName: await getProfileName(env.DB, accountId) }),
  },

  // POST /api/user/profile — registers the kan-game.app name and consents to publishing it.
  // An ID already named (here or in another game) keeps its name: names cannot change
  {
    method: 'POST',
    path: '/api/user/profile',
    async handler({ request, env, accountId }) {
      const profile = await readJsonBody(request, parseProfile);
      if (profile instanceof Response) return profile;

      const limited = await takeRateLimitSlot(env.DB, accountId, 'profile');
      if (limited) return rateLimited(limited);

      const outcome = nameOutcome(await idPlatform(env).registerName(accountId, profile.displayName));
      switch (outcome.status) {
        case 'name_taken':
          return json({ error: 'name_taken' }, 409);
        case 'invalid':
          return json({ error: 'invalid_name' }, 400);
        case 'no_id':
          return json({ error: 'id_deleted' }, 410);
        case 'registered':
        case 'kept':
          await registerProfile(env, accountId, outcome.name);
          return json({ displayName: outcome.name });
        default: {
          // An outcome added to nameOutcome (lib/profile.ts) fails to compile here
          const unexpected: never = outcome;
          throw new Error(`Unexpected name outcome: ${JSON.stringify(unexpected)}`);
        }
      }
    },
  },
];
