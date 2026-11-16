import { getItemSync, setLocalItem } from '@/lib/storage';

/**
 * The old URL's side of the move (docs/SPEC.md §5.4). The old screen kept its account's tokens in
 * this origin's storage; they let it ask for a handoff URL, which opens the new URL with a one-time
 * token that moves the account's records to the device's kan-game.app ID there.
 */

/** The host the game moved from; its screen is only the moving notice */
export const LEGACY_HOST = 'vegtab.app';
export const NEW_ORIGIN = 'https://vegtab.kan-game.app';

// The keys the old screen stored its tokens under
const TOKEN_KEY = 'vegtab_access_token';
const REFRESH_KEY = 'vegtab_refresh_token';

export function isLegacyHost(host = window.location.hostname): boolean {
  return host === LEGACY_HOST;
}

/** Whether this device has an old account to bring over */
export function hasLegacyAccount(): boolean {
  return !!getItemSync(REFRESH_KEY) || !!getItemSync(TOKEN_KEY);
}

export type HandoffUrl =
  | { ok: true; url: string }
  /** claimed: handed over already. failed: offline, or the tokens are no longer accepted */
  | { ok: false; reason: 'claimed' | 'failed' };

function postHandoff(accessToken: string | null): Promise<Response> {
  return fetch('/api/legacy/handoff', {
    method: 'POST',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
}

/** Renews the access token (it lasts an hour; the refresh token 90 days) */
async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getItemSync(REFRESH_KEY);
  if (!refreshToken) return null;
  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) return null;
  const tokens = await res.json() as { accessToken: string; refreshToken: string };
  setLocalItem(TOKEN_KEY, tokens.accessToken);
  setLocalItem(REFRESH_KEY, tokens.refreshToken);
  return tokens.accessToken;
}

export async function requestHandoffUrl(): Promise<HandoffUrl> {
  try {
    let res = await postHandoff(getItemSync(TOKEN_KEY));
    if (res.status === 401) {
      const renewed = await refreshAccessToken();
      if (!renewed) return { ok: false, reason: 'failed' };
      res = await postHandoff(renewed);
    }
    if (res.status === 409) return { ok: false, reason: 'claimed' };
    if (!res.ok) return { ok: false, reason: 'failed' };
    const { url } = await res.json() as { url: string };
    return { ok: true, url };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
