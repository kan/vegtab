import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        kvNamespaces: ['KV'],
        r2Buckets: ['R2', 'DOWNLOADS'],
        d1Databases: ['DB'],
        bindings: {
          JWT_SECRET: 'test-secret-key-for-vitest',
          ENVIRONMENT: 'test',
          VAPID_PUBLIC_KEY: 'BDd3_hVL9fZi9Ybo2UUzA284WG5FZR30_95YeZJsiApwXKpNcF1rRPF3foIiBHXRdJI2Qhumhf6_LFTeZaNndIo',
          VAPID_PRIVATE_KEY: 'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgDZUgF-TF6MBMjRb8bkOhGTIzsElDAKfqHLuP6qJaxTyhRANCAAREN_f9VfX2YvWG6NlFMwNvOFhuRWUd9P_eWXmSbIgKcFyqTXBda0Txd36CoAR0nXSSNkIbpoX-vyxU3mWjZ3SK',
          VAPID_SUBJECT: 'mailto:test@vegtab.app',
        },
      },
    }),
  ],
});
