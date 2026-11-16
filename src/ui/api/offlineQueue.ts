import { getItemSync, removeLocalItem, setLocalItem } from '@/lib/storage';
import { isRemovedModeScoreSubmission } from '@/lib/legacyData';
import { isBetterResult, type ResultSummary } from '@/lib/bestResult';

const QUEUE_KEY = 'vegtab_offline_queue';
/** #123 より前のキー（接頭辞が無い）。古い画面が書いた分も読むので、見つけるたびに取り込む */
const LEGACY_QUEUE_KEY = 'offline_queue';
/** 読めなかったキューの退避先。直すときのために、捨てずに 1 つだけ残す */
const CORRUPT_KEY = `${QUEUE_KEY}.corrupt`;
const MAX_RETRIES = 3;
const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
/**
 * 件数の上限。超えたら古いものから捨てる。項目は操作列（最大 1000 手）を持つので、ローカルの保存の容量を
 * 食い尽くさないようにする。同じ日の記録は 1 件にまとめるので、ふつうは数件しか溜まらない
 */
export const MAX_QUEUE_ENTRIES = 20;

export interface QueueEntry {
  id: string;
  url: string;
  method: string;
  body: string;
  createdAt: number;
  retries: number;
  /** 追加したときの ID。送信時の Cookie の ID で送られるので、別の ID に切り替わっていたら送らない */
  userId?: string | null;
  /** 同じ ID でこの値が同じ項目は、summary の良い方だけを残す（スコアの送信では日付） */
  dedupeKey?: string;
  summary?: ResultSummary;
}

/** 同じ ID・同じ dedupeKey の項目をまとめる手がかり */
export interface QueueDedupe {
  key: string;
  summary: ResultSummary;
}

function parseEntries(raw: string | null, key: string): QueueEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed as QueueEntry[];
  } catch {
    // 読めないキューは退避して、次の保存で上書きされないようにする
    setLocalItem(CORRUPT_KEY, raw);
    removeLocalItem(key);
    return [];
  }
}

function loadQueue(): QueueEntry[] {
  const current = parseEntries(getItemSync(QUEUE_KEY), QUEUE_KEY);
  const legacyRaw = getItemSync(LEGACY_QUEUE_KEY);
  const now = Date.now();
  // Remove expired entries and score submissions of removed modes (queued before #102)
  const live = (e: QueueEntry) => now - e.createdAt < EXPIRY_MS && !isRemovedModeScoreSubmission(e);
  if (legacyRaw === null) return current.filter(live);
  const known = new Set(current.map(e => e.id));
  const entries = [...current, ...parseEntries(legacyRaw, LEGACY_QUEUE_KEY).filter(e => !known.has(e.id))]
    .filter(live);
  if (saveQueue(entries)) removeLocalItem(LEGACY_QUEUE_KEY);
  return entries;
}

/** Retry-After（秒）を読む。無いか読めなければ、backend の窓の長さ（60 秒）とみなす */
export function retryAfterSecondsOf(res: Response): number {
  const seconds = Number(res.headers.get('Retry-After'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60;
}

/** 保存できたかを返す。保存できなくても、ローカルの記録が残っていれば次回起動時の再送で回復する */
function saveQueue(queue: QueueEntry[]): boolean {
  return setLocalItem(QUEUE_KEY, JSON.stringify(queue));
}

/**
 * 項目を積む。同じ ID・同じ dedupeKey の項目があれば、良い方の記録だけを残す（新しい方が良くなければ積まない）。
 * 上限を超えたら古いものから捨てる。保存できたか（新しい方を捨てた場合も true）を返す
 */
export function enqueue(url: string, method: string, body: string, userId: string | null, dedupe?: QueueDedupe): boolean {
  let queue = loadQueue();
  if (dedupe) {
    const same = (e: QueueEntry) => e.dedupeKey === dedupe.key && (e.userId ?? null) === userId && e.url === url;
    const kept = queue.filter(same);
    // 前の項目が良いか同じなら、それを残す（summary が無い項目は比べられないので置き換える）
    if (kept.some(e => e.summary && !isBetterResult(dedupe.summary, e.summary))) return true;
    queue = queue.filter(e => !same(e));
  }
  queue.push({
    id: crypto.randomUUID(),
    url,
    method,
    body,
    createdAt: Date.now(),
    retries: 0,
    userId,
    ...(dedupe ? { dedupeKey: dedupe.key, summary: dedupe.summary } : {}),
  });
  return saveQueue(queue.slice(-MAX_QUEUE_ENTRIES));
}

export function getQueueSize(): number {
  return loadQueue().length;
}

/**
 * Process all queued requests. Returns { succeeded, failed, remaining }, and retryAfterSeconds when
 * the per-ID limit (429) stopped it: the caller sends the rest again after that.
 * Caller should provide a fetch function that handles auth headers.
 */
export async function processQueue(
  doFetch: (url: string, method: string, body: string) => Promise<Response>,
  getCurrentUserId: () => string | null,
): Promise<{ succeeded: number; failed: number; remaining: number; retryAfterSeconds?: number }> {
  const queue = loadQueue();
  // Without an ID nothing can be sent; the queue waits for one
  if (queue.length === 0 || !getCurrentUserId()) return { succeeded: 0, failed: 0, remaining: queue.length };

  let succeeded = 0;
  let failed = 0;
  let retryAfterSeconds: number | undefined;
  /** 処理した項目の id → 残す項目（null なら取り除く） */
  const processed = new Map<string, QueueEntry | null>();

  function retryOrFail(entry: QueueEntry) {
    entry.retries++;
    if (entry.retries < MAX_RETRIES) {
      processed.set(entry.id, entry);
    } else {
      failed++;
    }
  }

  for (const entry of queue) {
    processed.set(entry.id, null); // 既定は取り除く。再試行する項目は retryOrFail が差し替える
    // 処理の途中で引き継ぎが起きても旧アカウントの項目を送らないよう、1 件ごとに確かめる
    const currentUserId = getCurrentUserId();
    if (entry.userId && currentUserId && entry.userId !== currentUserId) continue;
    try {
      const res = await doFetch(entry.url, entry.method, entry.body);
      if (res.ok || res.status === 409) {
        succeeded++;
      } else if (res.status === 429) {
        // 回数の制限（backend の rate_limits）。項目は傷んでいないので retries を増やさずに残し、
        // 残りも同じ ID の枠を使うので、この回は送るのをやめる
        processed.set(entry.id, entry);
        retryAfterSeconds = retryAfterSecondsOf(res);
        break;
      } else if (res.status === 401 || res.status === 410) {
        // The ID's cookie, not the request, was refused; the ID is asked for again (src/api/id.ts)
        retryOrFail(entry);
      } else if (res.status >= 400 && res.status < 500) {
        failed++; // Client error — don't retry
      } else {
        retryOrFail(entry); // Server error
      }
    } catch {
      retryOrFail(entry); // Network error
    }
  }

  // 送信中に enqueue された項目を消さないよう、キューを読み直して処理した項目だけを差し替える
  const remaining = loadQueue()
    .map(e => processed.has(e.id) ? processed.get(e.id) : e)
    .filter((e): e is QueueEntry => e != null);
  saveQueue(remaining);
  return {
    succeeded, failed, remaining: remaining.length,
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  };
}
