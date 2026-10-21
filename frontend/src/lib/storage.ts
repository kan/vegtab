/** localStorage からの読み込み。ストレージが使えないとき（Safari のプライベートモードなど）は null を返す */
export function getItemSync(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** localStorage から消す。ストレージが使えないときは何もしない */
export function removeLocalItem(key: string): void {
  try { localStorage.removeItem(key); } catch { /* nothing stored */ }
}

/**
 * localStorage への同期書き込み。
 * 容量超過や Safari のプライベートモードで setItem が例外を投げても、呼び出し元の処理は続ける。
 */
export function setLocalItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.warn(`Failed to save ${key} to localStorage`, e);
  }
}
