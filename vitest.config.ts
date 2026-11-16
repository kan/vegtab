import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Three projects: the puzzle core and the screen run in Node, the Worker in the Workers runtime
// (@cloudflare/vitest-plugin, with the bindings of wrangler.jsonc)
export default defineConfig(async () => {
  // The Worker's tests run on the real migrations, applied by tests/worker/apply-migrations.ts
  const migrations = await readD1Migrations(here('./migrations'));

  return {
    test: {
      projects: [
        {
          test: { name: 'core', root: here('.'), include: ['tests/core/**/*.test.ts'] },
        },
        {
          plugins: [vue()],
          resolve: { alias: { '@': here('./src/ui') } },
          test: { name: 'ui', root: here('.'), include: ['tests/ui/**/*.test.ts'] },
        },
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: here('./wrangler.jsonc') },
              miniflare: {
                kvNamespaces: ['KV'],
                r2Buckets: ['R2'],
                d1Databases: ['DB'],
                // wrangler.jsonc binds ID to kan/game's local Worker, which the tests do not run. The tests
                // call the Worker with the fake ID platform instead (tests/worker/helpers.ts `call`)
                serviceBindings: { ID: () => new Response('ID platform not in tests', { status: 500 }) },
                bindings: {
                  JWT_SECRET: 'test-secret-key-for-vitest',
                  DAILY_SEED_SECRET: 'test-daily-seed-secret-for-vitest',
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
            name: 'worker',
            root: here('.'),
            include: ['tests/worker/**/*.test.ts'],
            setupFiles: ['./tests/worker/apply-migrations.ts'],
          },
        },
      ],
    },
  };
});
