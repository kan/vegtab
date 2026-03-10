import { enqueue, processQueue } from './offlineQueue';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8787';

const TOKEN_KEY = 'tomado_access_token';
const REFRESH_KEY = 'tomado_refresh_token';
const DEVICE_KEY = 'tomado_device_id';
const USER_ID_KEY = 'tomado_user_id';

let accessToken: string | null = localStorage.getItem(TOKEN_KEY);
let refreshToken: string | null = localStorage.getItem(REFRESH_KEY);

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function getUserId(): string | null {
  return localStorage.getItem(USER_ID_KEY);
}

function saveTokens(access: string, refresh: string, userId?: string) {
  accessToken = access;
  refreshToken = refresh;
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
  if (userId) localStorage.setItem(USER_ID_KEY, userId);
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
