import type { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

/**
 * Validates the JSON body. A body that does not match is answered `400 { error: "invalid_request" }`,
 * like every other API error (a code, not zod's issue list)
 */
export function jsonBody<T extends z.ZodType>(schema: T) {
  return zValidator('json', schema, (result, c) => {
    if (!result.success) return c.json({ error: 'invalid_request' }, 400);
  });
}
