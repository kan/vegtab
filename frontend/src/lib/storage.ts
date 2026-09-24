import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const isNative = Capacitor.isNativePlatform();

/** Native keeps a copy of what it read or wrote so that getItemSync works after hydrate() */
const nativeCache = new Map<string, string | null>();

/**
 * Platform-aware key-value storage.
 * - Native (iOS/Android): Capacitor Preferences (Keychain/Keystore-backed)
 * - Web: localStorage
 */
export async function getItem(key: string): Promise<string | null> {
  if (isNative) {
    const { value } = await Preferences.get({ key });
    nativeCache.set(key, value);
    return value;
  }
  try { return localStorage.getItem(key); } catch { return null; }
}

export async function setItem(key: string, value: string): Promise<void> {
  if (isNative) {
    nativeCache.set(key, value);
    await Preferences.set({ key, value });
    return;
  }
  try { localStorage.setItem(key, value); } catch { /* */ }
}

export async function removeItem(key: string): Promise<void> {
  if (isNative) {
    nativeCache.set(key, null);
    await Preferences.remove({ key });
    return;
  }
  try { localStorage.removeItem(key); } catch { /* */ }
}

/**
 * Load keys into the native cache. Native can only read asynchronously, so call this before any
 * getItemSync() of those keys (on web it does nothing that getItemSync needs).
 */
export async function hydrate(keys: string[]): Promise<void> {
  await Promise.all(keys.map(getItem));
}

/**
 * Synchronous get. Web reads localStorage (so other tabs' changes are seen); native reads the cache
 * filled by hydrate() / getItem() / setItem().
 */
export function getItemSync(key: string): string | null {
  if (isNative) return nativeCache.get(key) ?? null;
  try { return localStorage.getItem(key); } catch { return null; }
}

/**
 * localStorage への同期書き込み（ネイティブでも localStorage に書く）。
 * 容量超過や Safari のプライベートモードで setItem が例外を投げても、呼び出し元の処理は続ける。
 */
export function setLocalItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.warn(`Failed to save ${key} to localStorage`, e);
  }
}
