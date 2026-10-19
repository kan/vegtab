import type { Context } from 'hono';

/** Bindings and vars come from wrangler.jsonc (`npm run cf-typegen`); secrets are not in it, so they are added here */
export type Bindings = Env & {
  JWT_SECRET: string;
  VAPID_PRIVATE_KEY: string;
};

export type Variables = {
  userId: string;
};

export type AppContext = Context<{ Bindings: Bindings; Variables: Variables }>;
