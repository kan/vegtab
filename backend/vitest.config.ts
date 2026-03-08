import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          kvNamespaces: ['KV'],
          r2Buckets: ['R2'],
          d1Databases: ['DB'],
          bindings: {
            JWT_SECRET: 'test-secret-key-for-vitest',
            ENVIRONMENT: 'test',
          },
        },
      },
    },
  },
});
