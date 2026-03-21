import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const isNative = Capacitor.isNativePlatform();

/**
 * Platform-aware key-value storage.
 * - Native (iOS/Android): Capacitor Preferences (Keychain/Keystore-backed)
 * - Web: localStorage
 */
export async function getItem(key: string): Promise<string | null> {
  if (isNative) {
    const { value } = await Preferences.get({ key });
    return value;
  }
  try { return localStorage.getItem(key); } catch { return null; }
}

export async function setItem(key: string, value: string): Promise<void> {
  if (isNative) {
    await Preferences.set({ key, value });
    return;
  }
  try { localStorage.setItem(key, value); } catch { /* */ }
}

export async function removeItem(key: string): Promise<void> {
  if (isNative) {
    await Preferences.remove({ key });
    return;
  }
  try { localStorage.removeItem(key); } catch { /* */ }
}

/**
 * Synchronous get for Web only (used during module initialization).
 * On native, returns null — call getItem() async instead.
 */
export function getItemSync(key: string): string | null {
  if (isNative) return null;
  try { return localStorage.getItem(key); } catch { return null; }
}

export function setItemSync(key: string, value: string): void {
  if (isNative) return;
  try { localStorage.setItem(key, value); } catch { /* */ }
}
