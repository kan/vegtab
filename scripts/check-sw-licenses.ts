import fs from 'node:fs';
import path from 'node:path';
import { SERVICE_WORKER_PACKAGES } from './licenses-plugin.ts';

/**
 * Run after `vite build` (npm run build): the workbox packages the service worker was built with
 * must be the ones licenses.json lists (SERVICE_WORKER_PACKAGES). vite-plugin-pwa writes the worker
 * after the bundle the licences plugin sees, so only the output can tell. Each workbox module
 * leaves "workbox:<name>:" in dist/workbox-*.js. From TAKO-SEN's scripts/check-sw-licenses.ts (#124)
 */
const dist = path.resolve(import.meta.dirname, '../dist');
const runtime = fs.readdirSync(dist).filter(f => /^workbox-.*\.js$/.test(f));
if (runtime.length === 0) throw new Error('check-sw-licenses: no workbox-*.js');
const built = new Set<string>();
for (const file of runtime) {
  const source = fs.readFileSync(path.join(dist, file), 'utf8');
  for (const [, name] of source.matchAll(/"workbox:([a-z-]+):/g)) built.add(`workbox-${name}`);
}
const listed = new Set(SERVICE_WORKER_PACKAGES);
const missing = [...built].filter(name => !listed.has(name));
const extra = [...listed].filter(name => !built.has(name));
if (missing.length > 0 || extra.length > 0) {
  console.error('check-sw-licenses: update SERVICE_WORKER_PACKAGES in scripts/licenses-plugin.ts');
  if (missing.length > 0) console.error(`  built but not listed: ${missing.join(', ')}`);
  if (extra.length > 0) console.error(`  listed but not built: ${extra.join(', ')}`);
  process.exit(1);
}
