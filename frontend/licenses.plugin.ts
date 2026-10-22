import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * Writes licenses.json for the licenses page (/licenses): the open source packages Vege-Table ships,
 * with their licence texts. The screen's packages are the ones the build actually bundled (not
 * package.json, where vue and the like sit in devDependencies); the service worker's and the
 * Worker's are their packages and everything those depend on
 */

export type LicenseUse = 'app' | 'sw' | 'server';

export interface LicenseEntry {
  name: string;
  version: string;
  license: string;
  url: string | null;
  text: string | null;
  usedIn: LicenseUse[];
}

const NODE_MODULES = '/node_modules/';
/** LICENSE, LICENCE.md, LICENSE-MIT, COPYING.txt and the like */
const LICENSE_FILE = /^(licen[cs]e|copying)([.-].*)?$/i;

/** The package directory a bundled module comes from, or null for our own code */
function packageDirOf(id: string): string | null {
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
    if (!dir || found.has(dir)) continue;
    found.add(dir);
    const deps = readJson(path.join(dir, 'package.json')).dependencies as Record<string, string> | undefined;
    for (const dep of Object.keys(deps ?? {})) queue.push({ name: dep, from: dir });
  }
  return found;
}

const isWebUrl = (url: string) => /^https?:\/\//.test(url);

/** A web URL for the repository field's forms (https, git+https, git+ssh, git@host:o/r, github:, gitlab:, o/r) */
function repositoryUrl(pkg: Record<string, unknown>): string | null {
  const repo = pkg.repository as string | { url?: string } | undefined;
  const raw = typeof repo === 'string' ? repo : repo?.url;
  if (raw) {
    const url = raw.replace(/^git\+/, '').replace(/\.git$/, '')
      .replace(/^(git|ssh):\/\/(git@)?/, 'https://')
      .replace(/^git@([^:]+):/, 'https://$1/')
      .replace(/^github:/, 'https://github.com/')
      .replace(/^gitlab:/, 'https://gitlab.com/')
      .replace(/^bitbucket:/, 'https://bitbucket.org/');
    if (isWebUrl(url)) return url;
    if (/^[\w.-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url}`;
  }
  return typeof pkg.homepage === 'string' && isWebUrl(pkg.homepage) ? pkg.homepage : null;
}

/**
 * Oxc's syntax helpers come in as virtual modules ("\0@oxc-project+runtime@<version>/helpers/...")
 * from inside the bundler, with no package on disk
 */
const OXC_RUNTIME = /^\0@oxc-project\+runtime@([^/]+)\//;
function oxcRuntimeEntry(version: string): Omit<LicenseEntry, 'usedIn'> {
  return { name: '@oxc-project/runtime', version, license: 'MIT', url: 'https://github.com/oxc-project/oxc', text: null };
}

function readEntry(dir: string): Omit<LicenseEntry, 'usedIn'> {
  const pkg = readJson(path.join(dir, 'package.json'));
  const licenseFile = fs.readdirSync(dir).find(f => LICENSE_FILE.test(f));
  const license = pkg.license as string | { type?: string } | undefined;
  return {
    name: pkg.name as string,
    version: pkg.version as string,
    license: (typeof license === 'string' ? license : license?.type) ?? 'UNKNOWN',
    url: repositoryUrl(pkg),
    text: licenseFile ? fs.readFileSync(path.join(dir, licenseFile), 'utf8').trim() : null,
  };
}

export function licensesPlugin(options: {
  /** The service worker's packages (workbox), which vite-plugin-pwa builds after this bundle */
  serviceWorker: string[];
  /** The Worker's package.json, whose dependencies (and theirs) the Worker bundles */
  serverPackageJson: string;
  /**
   * Packages wrangler adds to the Worker bundle itself (its templates, the nodejs_compat
   * polyfills), listed without their dependencies, which are not bundled
   */
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
      let oxcRuntime: string | null = null;
      // Modules that only re-export (vue's own entry) are dropped from moduleIds, so the packages
      // that import a bundled package module, within node_modules, count too
      const seen = new Set<string>();
      const addWithImporters = (id: string) => {
        if (seen.has(id)) return;
        seen.add(id);
        const dir = packageDirOf(id);
        if (!dir) return;
        appDirs.add(dir);
        const info = this.getModuleInfo(id);
        for (const importer of [...(info?.importers ?? []), ...(info?.dynamicImporters ?? [])]) addWithImporters(importer);
      };
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const id of chunk.moduleIds) {
          if (packageDirOf(id)) addWithImporters(id);
          // Vite's own runtime (preload helper, modulepreload polyfill) comes in as virtual modules
          else if (id.startsWith('\0vite/')) {
            const vite = resolvePackageDir('vite', root);
            if (vite) appDirs.add(vite);
          } else {
            oxcRuntime ??= OXC_RUNTIME.exec(id)?.[1] ?? null;
          }
        }
      }
      add(appDirs, 'app');
      add(withDependencies(options.serviceWorker, root), 'sw');
      const serverDir = path.dirname(options.serverPackageJson);
      const serverDeps = Object.keys((readJson(options.serverPackageJson).dependencies ?? {}) as Record<string, string>);
      add(withDependencies(serverDeps, serverDir), 'server');
      add(options.serverBundledByWrangler.flatMap(name => resolvePackageDir(name, serverDir) ?? []), 'server');

      const entries: LicenseEntry[] = [...uses].map(([dir, used]) => ({
        ...readEntry(dir),
        usedIn: (['app', 'sw', 'server'] as const).filter(u => used.has(u)),
      }));
      if (oxcRuntime) entries.push({ ...oxcRuntimeEntry(oxcRuntime), usedIn: ['app'] });
      entries.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
      for (const e of entries) {
        if (!e.text) this.warn(`${e.name}@${e.version}: no licence file in the package; the licences page points to ${e.url ?? '(no repository)'}`);
      }
      this.emitFile({ type: 'asset', fileName: 'licenses.json', source: JSON.stringify(entries) });
    },
  };
}
