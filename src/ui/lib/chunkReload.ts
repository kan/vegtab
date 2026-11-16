/**
 * 新しいデプロイの後、開いたままのタブが旧ハッシュのチャンクを遅延 import すると失敗する
 * （新しい Service Worker が旧 precache を消し、サーバーは存在しない /assets/* に index.html を返す）。
 * そのときは遷移先を読み込み直し、新しいバンドルで開き直す。
 */

const RELOAD_KEY = 'vegtab_chunk_reload';

/** ブラウザごとのメッセージ（Chrome / Firefox / Safari）と、Vite の CSS preload の失敗 */
const CHUNK_LOAD_ERROR = /dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

export function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && CHUNK_LOAD_ERROR.test(error.message);
}

function readTried(): string | null {
  try { return sessionStorage.getItem(RELOAD_KEY); } catch { return null; }
}

/**
 * チャンクの読み込み失敗なら target を読み込み直す。同じ target で一度読み込み直していたら
 * （新しいバンドルでも失敗した）無限リロードを避けて何もしない
 */
export function reloadOnChunkLoadError(error: unknown, target: string): void {
  if (!isChunkLoadError(error) || readTried() === target) return;
  try { sessionStorage.setItem(RELOAD_KEY, target); } catch { return; } // 記録できないと繰り返しを止められない
  location.assign(target);
}

/** 遷移に成功したら、次の失敗でまた読み込み直せるように記録を消す */
export function clearChunkReloadMark(): void {
  try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* ignore */ }
}
