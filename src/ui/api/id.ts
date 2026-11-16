import { readonly, ref } from 'vue';
import { setLocalItem, getItemSync, removeLocalItem } from '@/lib/storage';

/**
 * The kan-game.app ID of this device (kan/game docs/ID_DESIGN.md). Every visitor gets an ID from
 * POST /api/id/session, which this origin passes on to the ID platform. The ID lives in an HttpOnly
 * cookie that goes with every /api request, so the screens never send a token; they only need to
 * know which ID it is (the offline queue and "you" in the rankings).
 */

/** The last ID the platform confirmed. Not a credential (the cookie is) */
const ID_KEY = 'vegtab_kan_game_id';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function storedId(): string | null {
  const value = getItemSync(ID_KEY);
  return value && UUID.test(value) ? value : null;
}

const id = ref<string | null>(null);
/** The kan-game.app name, possibly chosen in another game (not yet consented to here) */
const name = ref<string | null>(null);

export const kanGameName = readonly(name);

/** The ID's kan-game.app name, once vegtab registered it (the session tells it only at the next start) */
export function rememberKanGameName(value: string): void {
  name.value = value;
}

/** The current ID (for code outside components) */
export function getUserId(): string | null {
  return id.value;
}

type IdListener = (id: string | null, previous: string | null) => void;
const listeners: IdListener[] = [];

/**
 * Called when the device's ID changes: the first ID of a device that had none (it was offline), a
 * transfer code, or a withdrawal (no ID, then the next one). Stores holding the previous ID's
 * records reset on it
 */
export function onIdChange(listener: IdListener): void {
  listeners.push(listener);
}

function setId(value: string | null, newName: string | null) {
  const previous = id.value;
  id.value = value;
  name.value = newName;
  if (value) setLocalItem(ID_KEY, value);
  else removeLocalItem(ID_KEY);
  if (previous !== value) for (const l of listeners) l(value, previous);
}

/**
 * Each request that can name the device's ID takes a number, and only the latest one's answer
 * counts: a session answer sent with the old cookie must not undo a transfer code redeemed after it
 */
let latestRequest = 0;

function accept(body: unknown, request: number): boolean {
  const value = body as { id?: unknown; name?: unknown } | null;
  if (typeof value?.id !== 'string' || !UUID.test(value.id)) return false;
  if (request !== latestRequest) return true;
  setId(value.id, typeof value.name === 'string' ? value.name : null);
  return true;
}

function postId(path: string, body?: unknown): Promise<Response> {
  return fetch(`/api/id/${path}`, {
    method: 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * Asks for the device's ID. Without a connection, or when the platform refuses (rate limit,
 * outage), the last known ID stays and the platform is asked again later
 */
async function askSession(): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const request = ++latestRequest;
  try {
    let response = await postId('session');
    // A withdrawn ID: that answer cleared its cookie, and asking again issues a new ID
    if (response.status === 410 && request === latestRequest) {
      setId(null, null);
      response = await postId('session');
    }
    if (response.ok) accept(await response.json(), request);
  } catch {
    // Offline: asked again when the connection comes back
  }
}

let pending: Promise<void> | undefined;
/** A redeem in flight: the session waits for it, and it waits for the session (they set the same cookie) */
let redeeming: Promise<unknown> | undefined;
let lastAsked = -Infinity;

/** Asks the ID platform for this device's ID, once at a time */
export function refreshId(): Promise<void> {
  pending ??= (redeeming ?? Promise.resolve())
    .catch(() => {})
    .then(askSession)
    .finally(() => { pending = undefined; });
  lastAsked = Date.now();
  return pending;
}

/** How often a device without an ID asks again (the platform was down) */
const NO_ID_RETRY_MS = 30_000;
let started: Promise<void> | undefined;

/**
 * Starts the ID once per page: the last known ID at once, then the platform's answer, again
 * whenever the connection comes back, and every half minute while the device has no ID.
 * Resolves after the first answer (or failure)
 */
export function startId(): Promise<void> {
  if (started) return started;
  id.value = storedId();
  window.addEventListener('online', () => void refreshId());
  window.setInterval(() => { if (!id.value) void refreshId(); }, NO_ID_RETRY_MS);
  started = refreshId();
  return started;
}

/** A 401 asks again at most this often, so a device whose cookie is not kept does not ask after every request */
const UNAUTHORIZED_RETRY_MS = 60_000;

/**
 * After an answer of vegtab's own API: a 410 means the ID was withdrawn on kan-game.app, so it is
 * dropped and a new one fetched; a 401 means the cookie is missing, so the ID is asked for again.
 * Returns whether the request may be sent again (the ID was renewed)
 */
export async function recoverId(responseStatus: number): Promise<boolean> {
  if (responseStatus === 410) {
    setId(null, null);
    await refreshId();
    return id.value != null;
  }
  if (responseStatus === 401 && Date.now() - lastAsked >= UNAUTHORIZED_RETRY_MS) {
    await refreshId();
    return id.value != null;
  }
  return false;
}

export type TransferCodeIssue =
  | { ok: true; code: string; expiresAt: number }
  | { ok: false; reason: 'offline' | 'failed' };

/** Issues a one-time code that moves this ID to another device (10 minutes) */
export async function issueTransferCode(): Promise<TransferCodeIssue> {
  try {
    const response = await postId('transfer-codes');
    if (!response.ok) return { ok: false, reason: 'failed' };
    const body = await response.json() as { code?: unknown; expiresAt?: unknown };
    return typeof body.code === 'string' && typeof body.expiresAt === 'number'
      ? { ok: true, code: body.code, expiresAt: body.expiresAt }
      : { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'offline' };
  }
}

export type Redeem =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'rate_limited' | 'offline' | 'failed' };

/**
 * Switches this device to the ID that issued a transfer code. The device's previous ID keeps its
 * records; they are not merged
 */
export function redeemTransferCode(code: string): Promise<Redeem> {
  const running = (pending ?? Promise.resolve())
    .then(() => sendRedeem('transfer-codes/redeem', { code }))
    .finally(() => { if (redeeming === running) redeeming = undefined; });
  redeeming = running;
  return running;
}

async function sendRedeem(path: string, body: unknown): Promise<Redeem> {
  const request = ++latestRequest;
  try {
    const response = await postId(path, body);
    if (response.ok && accept(await response.json(), request)) return { ok: true };
    if (response.status === 400) return { ok: false, reason: 'invalid' };
    if (response.status === 429) return { ok: false, reason: 'rate_limited' };
    return { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'offline' };
  }
}

/**
 * A page of the kan-game.app portal: the account screen (recovery codes, withdrawal) and the privacy
 * policy live there, not in each game. The portal follows this page's host
 * (vegtab-dev.kan-game.app → dev.kan-game.app), so a build cannot point at another environment's
 * portal. A local run (scripts/dev.mjs, also under roji's domain) gets kan/game's local portal
 * (VITE_KAN_GAME_PORTAL)
 */
export function portalUrl(path: '/' | '/account' | '/privacy' | '/terms' | '/favicon.svg', host = window.location.hostname): string {
  const local = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost') || /^\d+\.\d+\.\d+\.\d+$/.test(host);
  const portal = host.endsWith('.kan-game.app')
    ? host.split('.')[0].endsWith('-dev') ? 'https://dev.kan-game.app' : 'https://kan-game.app'
    : import.meta.env.VITE_KAN_GAME_PORTAL || (local ? 'http://localhost:8787' : 'https://kan-game.app');
  return new URL(path, portal).href;
}
