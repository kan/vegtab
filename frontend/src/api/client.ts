import { enqueue, processQueue } from './offlineQueue';
import { getItem, setItem, getItemSync, setItemSync } from '@/lib/storage';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8787';

const TOKEN_KEY = 'vegtab_access_token';
const REFRESH_KEY = 'vegtab_refresh_token';
const DEVICE_KEY = 'vegtab_device_id';
const USER_ID_KEY = 'vegtab_user_id';

// Sync init for Web; native loads async via initTokens()
let accessToken: string | null = getItemSync(TOKEN_KEY);
let refreshToken: string | null = getItemSync(REFRESH_KEY);

/** Load tokens from secure storage (call on app startup for native) */
export async function initTokens(): Promise<void> {
  accessToken = await getItem(TOKEN_KEY);
  refreshToken = await getItem(REFRESH_KEY);
}

export function getDeviceId(): string {
  let id = getItemSync(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    setItemSync(DEVICE_KEY, id);
    setItem(DEVICE_KEY, id); // also persist to secure storage
  }
  return id;
}

export function getUserId(): string | null {
  return getItemSync(USER_ID_KEY);
}

function saveTokens(access: string, refresh: string, userId?: string) {
  accessToken = access;
  refreshToken = refresh;
  setItem(TOKEN_KEY, access);
  setItem(REFRESH_KEY, refresh);
  if (userId) setItem(USER_ID_KEY, userId);
}

export function isAuthenticated(): boolean {
  return !!accessToken;
}

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json() as { accessToken: string; refreshToken: string };
    saveTokens(data.accessToken, data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

export async function register(): Promise<{ userId: string }> {
  const deviceId = getDeviceId();
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId }),
  });
  if (!res.ok) throw new Error('Registration failed');
  const data = await res.json() as { userId: string; accessToken: string; refreshToken: string };
  saveTokens(data.accessToken, data.refreshToken, data.userId);
  return { userId: data.userId };
}

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

// --- API call ---
export async function api<T = unknown>(
  path: string,
  options: RequestInit & { offlineQueue?: boolean } = {},
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const { offlineQueue: shouldQueue, ...fetchOptions } = options;

  const doFetch = async () => {
    const headers: Record<string, string> = {
      ...(fetchOptions.headers as Record<string, string> ?? {}),
    };
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    if (fetchOptions.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    return fetch(url, { ...fetchOptions, headers });
  };

  let res: Response;
  try {
    res = await doFetch();
  } catch (e) {
    // Network error
    if (shouldQueue && fetchOptions.body && typeof fetchOptions.body === 'string') {
      enqueue(path, fetchOptions.method ?? 'POST', fetchOptions.body);
      showToast('info', 'toast.scoreSavedOffline');
      throw new ApiError(0, 'Network error — queued for retry');
    }
    showToast('error', 'toast.networkError');
    throw e;
  }

  // Auto-refresh on 401
  if (res.status === 401 && refreshToken) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      res = await doFetch();
    } else {
      showToast('info', 'toast.authRetry');
      await register();
      res = await doFetch();
    }
  }

  if (!res.ok) {
    if (shouldQueue && res.status >= 500 && fetchOptions.body && typeof fetchOptions.body === 'string') {
      enqueue(path, fetchOptions.method ?? 'POST', fetchOptions.body);
      showToast('info', 'toast.scoreSavedOffline');
      throw new ApiError(res.status, 'Server error — queued for retry');
    }
    const body = await res.text();
    throw new ApiError(res.status, body);
  }

  return res.json() as Promise<T>;
}

// --- Shared authenticated fetch (used by api() and offline queue) ---
async function authedFetch(path: string, method: string, body?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  let res = await fetch(`${API_BASE}${path}`, { method, headers, body });
  // Handle 401 with token refresh
  if (res.status === 401 && refreshToken) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      res = await fetch(`${API_BASE}${path}`, { method, headers, body });
    } else {
      await register();
      headers['Authorization'] = `Bearer ${accessToken}`;
      res = await fetch(`${API_BASE}${path}`, { method, headers, body });
    }
  }
  return res;
}

// --- Offline queue processing ---
let flushing = false;

export async function flushOfflineQueue(): Promise<{ succeeded: number; failed: number; remaining: number }> {
  if (flushing) return { succeeded: 0, failed: 0, remaining: 0 };
  flushing = true;
  try {
    const result = await processQueue((url, method, body) => authedFetch(url, method, body));
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

// --- Account transfer ---
export async function generateTransferCode(): Promise<{ code: string; expiresIn: number }> {
  return api<{ code: string; expiresIn: number }>('/api/auth/transfer-code', { method: 'POST' });
}

export async function redeemTransferCode(code: string): Promise<{
  userId: string;
  displayName: string | null;
  accessToken: string;
  refreshToken: string;
}> {
  const deviceId = getDeviceId();
  const res = await fetch(`${API_BASE}/api/auth/redeem-transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, deviceId }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(res.status, body);
  }
  const data = await res.json() as {
    userId: string;
    displayName: string | null;
    accessToken: string;
    refreshToken: string;
  };
  saveTokens(data.accessToken, data.refreshToken, data.userId);
  return data;
}
