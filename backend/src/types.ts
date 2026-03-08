import type { Context } from 'hono';

export type Bindings = {
  DB: D1Database;
  KV: KVNamespace;
  R2: R2Bucket;
  ENVIRONMENT: string;
  JWT_SECRET: string;
  FRONTEND_URL: string;
};

export type Variables = {
  userId: string;
};

export type AppContext = Context<{ Bindings: Bindings; Variables: Variables }>;
