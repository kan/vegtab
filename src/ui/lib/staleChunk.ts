/**
 * 新しいデプロイの後、開いたままのタブが旧ハッシュのチャンクを読みに行くと失敗する
 * （新しい Service Worker が旧 precache を消し、サーバーは存在しない /assets/* に index.html を返す。#86）。
 * そのときは読み込み直して、新しいバンドルで開き直す。
 *
 * 失敗は 2 つの経路で届く。画面の遷移の遅延 import の失敗（router.onError）と、Vite の
 * vite:preloadError（router を通らない動的 import と、CSS や依存の preload の失敗）。同じ失敗で両方が
 * 届くことがあるので、どちらも reloadForStaleChunk を通し、60 秒に 1 回までにする（TAKO-SEN の
 * src/ui/stale-chunk.ts と同じ。#121）
 */

const MARK_KEY = 'vegtab_stale_chunk_reload';
/** 読み込み直すのはこの間隔に 1 回まで。新しいバンドルでも失敗するときに繰り返さない */
const RELOAD_GAP_MS = 60_000;

/** ブラウザごとのメッセージ（Chrome / Firefox / Safari）と、Vite の CSS preload の失敗 */
const CHUNK_LOAD_ERROR = /dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

export function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && CHUNK_LOAD_ERROR.test(error.message);
}

interface MarkStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * 読み込み直すか。オンラインのときだけ（オフラインでは読み込み直しても画面を失うだけ）、前に読み込み直して
 * から 1 分たっていれば。storage はタブごとのもの（sessionStorage）で、ほかのタブの読み込み直しに引きずられない
 */
export function shouldReloadForStaleChunk(storage: MarkStorage, online: boolean, now: number): boolean {
  if (!online) return false;
  try {
    const last = Number(storage.getItem(MARK_KEY));
    if (Number.isFinite(last) && now - last < RELOAD_GAP_MS) return false;
    storage.setItem(MARK_KEY, String(now));
    return true;
  } catch {
    // 記録できないと間隔を守れないので、繰り返しを避けて読み込み直さない
    return false;
  }
}

/** target（遷移先、または今の URL）を読み込み直す。読み込み直すことにしたら true */
export function reloadForStaleChunk(target: string): boolean {
  let storage: Storage;
  try {
    storage = sessionStorage; // サイトのデータを拒んでいると、読むだけで例外を投げる
  } catch {
    return false;
  }
  if (!shouldReloadForStaleChunk(storage, navigator.onLine, Date.now())) return false;
  location.assign(target);
  return true;
}
