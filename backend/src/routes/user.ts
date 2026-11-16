import { Hono } from 'hono';
import { z } from 'zod';
import { jsonBody } from '../lib/validate';
import type { Bindings, Variables } from '../types';
import { idPlatform } from '../lib/id-auth';
import { registerProfile, getProfileName, nameOutcome } from '../lib/profile';
import { takeRateLimitSlot } from '../lib/rate-limit';

const registerProfileSchema = z.object({
  // The rules are the ID platform's (kan/game src/names.ts); this only bounds the input
  displayName: z.string().min(1).max(256),
  // Publishing the name in vegtab's rankings is agreed to per game (ID_DESIGN.md「名前」)
  consent: z.literal(true),
});

export const userRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// GET /api/user/profile — the name published in vegtab's rankings, or null before consent.
// A name chosen in another kan-game.app game comes with POST /api/id/session instead
userRoutes.get('/profile', async (c) => {
  return c.json({ displayName: await getProfileName(c.env.DB, c.get('userId')) });
});

// POST /api/user/profile — registers the kan-game.app name and consents to publishing it.
// An ID already named (here or in another game) keeps its name: names cannot change
userRoutes.post('/profile', jsonBody(registerProfileSchema), async (c) => {
  const userId = c.get('userId');
  const { displayName } = c.req.valid('json');

  const limited = await takeRateLimitSlot(c.env.DB, userId, 'profile');
  if (limited) {
    c.header('Retry-After', String(limited.retryAfterSeconds));
    return c.json({ error: 'rate_limited' }, 429);
  }

  const outcome = nameOutcome(await idPlatform(c.env).registerName(userId, displayName));
  switch (outcome.status) {
    case 'name_taken':
      return c.json({ error: 'name_taken' }, 409);
    case 'invalid':
      return c.json({ error: 'invalid_name' }, 400);
    case 'no_id':
      return c.json({ error: 'id_deleted' }, 410);
    case 'registered':
    case 'kept':
      await registerProfile(c.env, userId, outcome.name);
      return c.json({ displayName: outcome.name });
    default: {
      // An outcome added to nameOutcome (lib/profile.ts) fails to compile here
      const unexpected: never = outcome;
      throw new Error(`Unexpected name outcome: ${JSON.stringify(unexpected)}`);
    }
  }
});
