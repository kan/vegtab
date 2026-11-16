/** Where a package runs: the screen, the service worker, the Worker */
export type LicenseUse = 'app' | 'sw' | 'server';

/** One package in licenses.json, which scripts/licenses-plugin.ts writes */
export interface LicenseEntry {
  name: string;
  version: string;
  license: string;
  url: string | null;
  text: string | null;
  usedIn: LicenseUse[];
}
