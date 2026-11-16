import type { Bindings } from '../types';

/** The canonical base URL of the game (share URLs, OGP). */
export function getBaseUrl(env: Bindings): string {
  return env.FRONTEND_URL.replace(/\/+$/, '');
}

/** The origins allowed to call the API (comma separated in ALLOWED_ORIGINS). */
export function getAllowedOrigins(env: Bindings): string[] {
  return env.ALLOWED_ORIGINS.split(',').map(u => u.trim()).filter(Boolean);
}

/**
 * Whether a request came to the old host (vegtab.app). It serves only the moving notice and the
 * handover of old accounts (routes/legacy.ts) until it is closed (docs/SPEC.md §5.4).
 */
export function isLegacyHost(env: Bindings, url: string): boolean {
  return !!env.LEGACY_HOST && new URL(url).hostname === env.LEGACY_HOST;
}
