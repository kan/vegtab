import { Capacitor } from '@capacitor/core';

/** ネイティブ版の origin（https://localhost）は端末の外では開けないので、公開 URL を使う */
const PUBLIC_ORIGIN = 'https://vegtab.app';

export function buildShareUrl(shareCode: string): string {
  const origin = Capacitor.isNativePlatform() ? PUBLIC_ORIGIN : location.origin;
  return `${origin}/s/${shareCode}`;
}
