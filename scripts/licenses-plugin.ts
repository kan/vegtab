import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import type { LicenseEntry, LicenseUse } from '../src/ui/lib/licenses.ts';

/**
 * Writes licenses.json for the licenses page (/licenses): the open source packages Vege-Table ships,
 * with their licence texts. TAKO-SEN's scripts/licenses-plugin.ts started from this file; its
 * improvements are brought back here (#124, kan/tako-sen#22).
 *
 * The screen's packages are the ones the build actually bundled, not package.json. The service
 * worker's and the Worker's are named below and taken with everything they depend on.
 */

/**
 * What generateSW inlines into the service worker: the names marked in dist/workbox-*.js
 * ("workbox:<name>:"). scripts/check-sw-licenses.ts fails the build when the workbox options
 * change them
 */
export const SERVICE_WORKER_PACKAGES = [
  'workbox-core',
  'workbox-precaching',
  'workbox-routing',
  'workbox-strategies',
];

/**
 * What src/worker imports from node_modules, taken with their dependencies.
 * tests/ui/licenses-plugin.test.ts checks it against the imports
 */
export const SERVER_PACKAGES = ['@block65/webcrypto-web-push', '@hono/zod-validator', 'hono', 'jose', 'zod'];

/**
 * What wrangler adds to the Worker's bundle itself (its templates, the nodejs_compat polyfills), as
 * seen in `wrangler deploy --dry-run --metafile`. Listed without their dependencies, which are not
 * bundled
 */
export const SERVER_BUNDLED_BY_WRANGLER = ['wrangler', 'unenv', '@cloudflare/unenv-preset'];

/**
 * Virtual modules that bring a package's code into the bundle with no node_modules path: Vite's
 * runtime (the preload helper, the modulepreload polyfill) and @vitejs/plugin-vue's export helper
 */
const VIRTUAL_MODULE_PACKAGES: [prefix: string, name: string][] = [
  ['\0vite/', 'vite'],
  ['\0plugin-vue:', '@vitejs/plugin-vue'],
];

/**
 * The syntax helpers the build adds for older browsers ("\0@oxc-project+runtime@<version>/helpers/...").
 * They come from the bundler's own binary, not from node_modules, so there is no package to read
 */
const OXC_RUNTIME = /^\0@oxc-project\+runtime@([^/]+)\//;
function oxcRuntimeEntry(version: string): Omit<LicenseEntry, 'usedIn'> {
  return { name: '@oxc-project/runtime', version, license: 'MIT', url: 'https://github.com/oxc-project/oxc', text: null };
}

const NODE_MODULES = '/node_modules/';
/** LICENSE, LICENCE.md, LICENSE-MIT, COPYING.txt and the like */
const LICENSE_FILE = /^(licen[cs]e|copying)([.-].*)?$/i;

/** The package directory a bundled module comes from, or null for our own code */
export function packageDirOf(id: string): string | null {
  const file = id.replace(/^\0/, '').split('?')[0].replaceAll('\\', '/');
  const at = file.lastIndexOf(NODE_MODULES);
  if (at < 0) return null;
  const parts = file.slice(at + NODE_MODULES.length).split('/');
  const name = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
  return file.slice(0, at + NODE_MODULES.length) + name;
}

/** Finds a package the way Node does: node_modules in this directory or any above it */
function resolvePackageDir(name: string, fromDir: string): string | null {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (path.dirname(dir) === dir) return null;
  }
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
}

/** The packages' directories, with everything they depend on */
function withDependencies(roots: string[], fromDir: string): Set<string> {
  const found = new Set<string>();
  const queue = roots.map(name => ({ name, from: fromDir }));
  while (queue.length > 0) {
    const { name, from } = queue.shift()!;
    const dir = resolvePackageDir(name, from);
    if (!dir) throw new Error(`licenses: ${name} is not installed`);
    if (found.has(dir)) continue;
    found.add(dir);
    const deps = readJson(path.join(dir, 'package.json')).dependencies as Record<string, string> | undefined;
    for (const dep of Object.keys(deps ?? {})) queue.push({ name: dep, from: dir });
  }
  return found;
}

/** A web URL for the repository field's forms (https, git+https, git+ssh, git@host:o/r, github:, gitlab:, o/r) */
export function repositoryUrl(pkg: Record<string, unknown>): string | null {
  const repo = pkg.repository as string | { url?: string } | undefined;
  const raw = typeof repo === 'string' ? repo : repo?.url;
  if (raw) {
    const url = raw.replace(/^git\+/, '').replace(/\.git$/, '')
      .replace(/^(git|ssh):\/\/(git@)?/, 'https://')
      .replace(/^git@([^:/]+):/, 'https://$1/')
      .replace(/^github:/, 'https://github.com/')
      .replace(/^gitlab:/, 'https://gitlab.com/')
      .replace(/^bitbucket:/, 'https://bitbucket.org/');
    if (/^https?:\/\//.test(url)) return url;
    if (/^[\w.-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url}`;
  }
  // Only a web page: the licenses page links to it as it is
  const homepage = pkg.homepage;
  return typeof homepage === 'string' && /^https?:\/\//.test(homepage) ? homepage : null;
}

/**
 * Vite and Rollup append the licences of what their Node side bundles, under this heading. None of
 * that reaches the screen, only their own runtime does, and it was most of licenses.json. Other
 * packages keep the section: one that inlines its dependencies into the browser code must show
 * their notices too
 */
const NODE_SIDE_BUNDLERS = new Set(['vite', 'rollup']);
const BUNDLED_DEPENDENCIES = /^#+ Licenses of bundled dependencies/m;

/** The licence text to show: Vite's and Rollup's without their bundled dependencies */
export function ownLicense(name: string, text: string): string {
  const at = NODE_SIDE_BUNDLERS.has(name) ? text.search(BUNDLED_DEPENDENCIES) : -1;
  return (at < 0 ? text : text.slice(0, at)).trim();
}

/**
 * Every licence file of the package, in name order, joined: a dual-licensed package ships both
 * (LICENSE-APACHE and LICENSE-MIT). Files only (a symlink is followed): a "licenses/" directory or
 * the like is not one. Null without any
 */
export function licenseText(dir: string, name: string): string | null {
  const files = fs.readdirSync(dir)
    .filter(file => LICENSE_FILE.test(file) && fs.statSync(path.join(dir, file)).isFile())
    .sort();
  // The same text in two formats (LICENSE and LICENSE.md) shows once; an empty file shows nothing
  const texts = new Set(files
    .map(file => ownLicense(name, fs.readFileSync(path.join(dir, file), 'utf8')))
    .filter(text => text !== ''));
  return texts.size > 0 ? [...texts].join('\n\n----\n\n') : null;
}

function readEntry(dir: string): Omit<LicenseEntry, 'usedIn'> {
  const pkg = readJson(path.join(dir, 'package.json'));
  const name = pkg.name as string;
  const license = pkg.license as string | { type?: string } | undefined;
  return {
    name,
    version: pkg.version as string,
    license: (typeof license === 'string' ? license : license?.type) ?? 'UNKNOWN',
    url: repositoryUrl(pkg),
    text: licenseText(dir, name),
  };
}

const USE_ORDER: readonly LicenseUse[] = ['app', 'sw', 'server'];

/**
 * One entry per name@version, with the uses of every copy: npm can leave the same version in two
 * node_modules paths, and the licenses page keys its rows by name@version
 */
export function mergeCopies(
  copies: Iterable<readonly [entry: Omit<LicenseEntry, 'usedIn'>, used: Set<LicenseUse>]>,
): LicenseEntry[] {
  const byPackage = new Map<string, { entry: Omit<LicenseEntry, 'usedIn'>; used: Set<LicenseUse> }>();
  for (const [entry, used] of copies) {
    const key = `${entry.name}@${entry.version}`;
    const seen = byPackage.get(key);
    if (seen) for (const use of used) seen.used.add(use);
    else byPackage.set(key, { entry, used: new Set(used) });
  }
  return [...byPackage.values()].map(({ entry, used }) => ({ ...entry, usedIn: USE_ORDER.filter(u => used.has(u)) }));
}

export function licensesPlugin(options: {
  /** The service worker's packages (workbox), which vite-plugin-pwa builds after this bundle */
  serviceWorker: string[];
  /** The packages the Worker (src/worker) imports, taken with their dependencies */
  server: string[];
  /** Packages wrangler adds to the Worker's bundle itself, without their dependencies */
  serverBundledByWrangler: string[];
}): Plugin {
  let root = process.cwd();
  return {
    name: 'vegtab-licenses',
    apply: 'build',
    configResolved(config) {
      root = config.root;
    },
    generateBundle(_, bundle) {
      const uses = new Map<string, Set<LicenseUse>>();
      const add = (dirs: Iterable<string>, use: LicenseUse) => {
        for (const dir of dirs) {
          if (!uses.has(dir)) uses.set(dir, new Set());
          uses.get(dir)!.add(use);
        }
      };

      const appDirs = new Set<string>();
      // A package that only re-exports another (vue, over @vue/runtime-dom) leaves no module in the
      // chunks; it is found as the importer of what does, following importers while they are in
      // node_modules
      const visited = new Set<string>();
      const addWithImporters = (id: string): void => {
        if (visited.has(id)) return;
        visited.add(id);
        const dir = packageDirOf(id);
        if (!dir) return;
        appDirs.add(dir);
        const info = this.getModuleInfo(id);
        for (const importer of [...(info?.importers ?? []), ...(info?.dynamicImporters ?? [])]) addWithImporters(importer);
      };
      const oxcVersions = new Set<string>();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const id of chunk.moduleIds) {
          addWithImporters(id);
          const oxc = OXC_RUNTIME.exec(id);
          if (oxc) oxcVersions.add(oxc[1]);
          const virtual = VIRTUAL_MODULE_PACKAGES.find(([prefix]) => id.startsWith(prefix));
          const dir = virtual && resolvePackageDir(virtual[1], root);
          if (dir) appDirs.add(dir);
        }
      }
      add(appDirs, 'app');
      add(withDependencies(options.serviceWorker, root), 'sw');
      add(withDependencies(options.server, root), 'server');
      add(options.serverBundledByWrangler.map(name => {
        const dir = resolvePackageDir(name, root);
        if (!dir) throw new Error(`licenses: ${name} is not installed`);
        return dir;
      }), 'server');

      // The oxc helpers go through the merge too, should the same version also be installed as a package
      const entries = mergeCopies([
        ...[...uses].map(([dir, used]) => [readEntry(dir), used] as const),
        ...[...oxcVersions].map(version => [oxcRuntimeEntry(version), new Set(['app' as const])] as const),
      ]);
      entries.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
      for (const e of entries) {
        // The oxc helpers are known to have no package to read
        if (!e.text && e.name !== '@oxc-project/runtime') {
          this.warn(`${e.name}@${e.version}: no licence file in the package; the licences page points to ${e.url ?? '(no repository)'}`);
        }
      }
      this.emitFile({ type: 'asset', fileName: 'licenses.json', source: JSON.stringify(entries) });
    },
  };
}
