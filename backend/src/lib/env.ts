import type { Bindings } from '../types';

const DEFAULT_BASE_URL = 'https://tomado.app';

/** Return the canonical base URL (first entry if comma-separated). */
export function getBaseUrl(env: Bindings): string {
  const raw = env.FRONTEND_URL;
  if (!raw || raw === '*') return DEFAULT_BASE_URL;
  const first = raw.split(',')[0].trim();
  return first || DEFAULT_BASE_URL;
}

/** Return the list of allowed CORS origins parsed from FRONTEND_URL. */
export function getAllowedOrigins(env: Bindings): string[] | null {
  const raw = env.FRONTEND_URL;
  if (!raw || raw === '*') return null; // null = allow all
  return raw.split(',').map(u => u.trim()).filter(Boolean);
}
