/** Bindings and vars come from wrangler.jsonc (`npm run cf-typegen`); secrets are not in it, so they are added here */
export type Bindings = Env & {
  /** Signs the old vegtab.app accounts' tokens (routes/auth.ts, routes/legacy.ts) */
  JWT_SECRET: string;
  /** 日ごとの seed の HMAC の鍵（lib/seed.ts）。漏れると、まだ配っていない日の盤面を計算できる */
  DAILY_SEED_SECRET: string;
  VAPID_PRIVATE_KEY: string;
};
