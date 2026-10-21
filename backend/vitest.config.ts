import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig(async () => {
  // The tests run on the real migrations, applied by test/apply-migrations.ts
  const migrations = await readD1Migrations(fileURLToPath(new URL('./migrations', import.meta.url)));

  return {
    // Resolve setupFiles and the test files from backend/, wherever vitest is started
    root: fileURLToPath(new URL('.', import.meta.url)),
    resolve: {
      // Use the engine source like `wrangler deploy` does (via tsconfig paths),
      // instead of the package's possibly stale dist build
      alias: {
        '@vegtab/engine': fileURLToPath(new URL('../engine/src/index.ts', import.meta.url)),
      },
    },
    plugins: [
      cloudflareTest({
        wrangler: { configPath: fileURLToPath(new URL('./wrangler.jsonc', import.meta.url)) },
        miniflare: {
          kvNamespaces: ['KV'],
          r2Buckets: ['R2'],
          d1Databases: ['DB'],
          // wrangler.jsonc binds ID to kan/game's local Worker, which the tests do not run. The tests
          // call the Worker with the fake ID platform instead (test/helpers.ts `call`)
          serviceBindings: { ID: () => new Response('ID platform not in tests', { status: 500 }) },
          bindings: {
            JWT_SECRET: 'test-secret-key-for-vitest',
            ENVIRONMENT: 'test',
            VAPID_PUBLIC_KEY: 'BDd3_hVL9fZi9Ybo2UUzA284WG5FZR30_95YeZJsiApwXKpNcF1rRPF3foIiBHXRdJI2Qhumhf6_LFTeZaNndIo',
            VAPID_PRIVATE_KEY: 'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgDZUgF-TF6MBMjRb8bkOhGTIzsElDAKfqHLuP6qJaxTyhRANCAAREN_f9VfX2YvWG6NlFMwNvOFhuRWUd9P_eWXmSbIgKcFyqTXBda0Txd36CoAR0nXSSNkIbpoX-vyxU3mWjZ3SK',
            VAPID_SUBJECT: 'mailto:test@vegtab.app',
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
    },
  };
});
