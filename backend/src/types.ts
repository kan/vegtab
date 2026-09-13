import type { Context } from 'hono';

export type Bindings = {
  DB: D1Database;
  KV: KVNamespace;
  R2: R2Bucket;
  DOWNLOADS: R2Bucket;
  ENVIRONMENT: string;
  JWT_SECRET: string;
  FRONTEND_URL: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
  TRANSFER_RATE_LIMITER: RateLimit;
};

export type Variables = {
  userId: string;
};

export type AppContext = Context<{ Bindings: Bindings; Variables: Variables }>;
