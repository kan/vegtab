import { enqueue, processQueue } from './offlineQueue';
import { getUserId, recoverId } from './id';

// --- Toast notification system ---
export type ToastType = 'error' | 'info' | 'success';
export interface ToastEvent {
  type: ToastType;
  messageKey: string;
  params?: Record<string, string>;
  duration?: number;
}
type ToastListener = (event: ToastEvent) => void;
const toastListeners: ToastListener[] = [];

export function onToast(listener: ToastListener): () => void {
  toastListeners.push(listener);
  return () => {
    const idx = toastListeners.indexOf(listener);
    if (idx >= 0) toastListeners.splice(idx, 1);
  };
}

export function showToast(type: ToastType, messageKey: string, params?: Record<string, string>, duration = 4000) {
  for (const l of toastListeners) l({ type, messageKey, params, duration });
}

/**
 * fetch for vegtab's own API (same origin). The kan-game.app ID cookie goes with it; after a 401
 * or 410 the ID is asked for again (src/api/id.ts) and the request is sent once more
 */
async function idFetch(path: string, init: RequestInit): Promise<Response> {
  const res = await fetch(path, init);
  if ((res.status === 401 || res.status === 410) && await recoverId(res.status)) {
    return fetch(path, init);
  }
  return res;
}

// --- API call ---
export async function api<T = unknown>(
  path: string,
  options: RequestInit & { offlineQueue?: boolean } = {},
): Promise<T> {
  const { offlineQueue: shouldQueue, ...fetchOptions } = options;
  const queueableBody = shouldQueue && typeof fetchOptions.body === 'string' ? fetchOptions.body : null;
  const headers: Record<string, string> = { ...(fetchOptions.headers as Record<string, string> ?? {}) };
  if (fetchOptions.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const queue = (status: number, message: string): never => {
    enqueue(path, fetchOptions.method ?? 'POST', queueableBody!, getUserId());
    showToast('info', 'toast.scoreSavedOffline');
    throw new ApiError(status, message);
  };

  // No ID yet (the ID platform was unreachable): kept until the device has one
  if (queueableBody && !getUserId()) return queue(0, 'No ID yet — queued for retry');

  let res: Response;
  try {
    res = await idFetch(path, { ...fetchOptions, headers });
  } catch (e) {
    if (queueableBody) return queue(0, 'Network error — queued for retry');
    showToast('error', 'toast.networkError');
    throw e;
  }

  if (!res.ok) {
    if (queueableBody && res.status >= 500) return queue(res.status, 'Server error — queued for retry');
    throw new ApiError(res.status, await res.text());
  }

  return res.json() as Promise<T>;
}

// --- Offline queue processing ---
let flushing = false;

export async function flushOfflineQueue(): Promise<{ succeeded: number; failed: number; remaining: number }> {
  if (flushing) return { succeeded: 0, failed: 0, remaining: 0 };
  flushing = true;
  try {
    const result = await processQueue(
      (url, method, body) => idFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body }),
      getUserId,
    );
    if (result.succeeded > 0) {
      showToast('success', 'toast.offlineQueueSent');
    }
    if (result.failed > 0) {
      showToast('error', 'toast.offlineQueueFailed');
    }
    return result;
  } finally {
    flushing = false;
  }
}

// Auto-flush on online event
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { flushOfflineQueue(); });
}

export class ApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`API Error ${status}: ${body}`);
  }
}

/** The `error` code of an API error's JSON body, if any */
export function apiErrorCode(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  try {
    const parsed = JSON.parse(e.body) as { error?: unknown };
    return typeof parsed.error === 'string' ? parsed.error : null;
  } catch {
    return null;
  }
}

// --- Push notifications ---
export async function getVapidPublicKey(): Promise<string> {
  const data = await api<{ publicKey: string }>('/api/push/vapid-public-key');
  return data.publicKey;
}

export async function subscribePush(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  await api('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: {
        p256dh: json.keys?.p256dh ?? '',
        auth: json.keys?.auth ?? '',
      },
    }),
  });
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  await api('/api/push/unsubscribe', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint }),
  });
}
