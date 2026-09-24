import { setLocalItem } from '@/lib/storage';

const QUEUE_KEY = 'offline_queue';
const MAX_RETRIES = 3;
const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface QueueEntry {
  id: string;
  url: string;
  method: string;
  body: string;
  createdAt: number;
  retries: number;
  /** 追加したときのユーザー。送信時のトークンで送られるので、別のアカウントに切り替わっていたら送らない */
  userId?: string | null;
}

function loadQueue(): QueueEntry[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const entries: QueueEntry[] = JSON.parse(raw);
    const now = Date.now();
    // Remove expired entries
    return entries.filter(e => now - e.createdAt < EXPIRY_MS);
  } catch {
    return [];
  }
}

/** 保存できなくても、ローカルの記録が残っていれば次回起動時の再送で回復する */
function saveQueue(queue: QueueEntry[]) {
  setLocalItem(QUEUE_KEY, JSON.stringify(queue));
}

export function enqueue(url: string, method: string, body: string, userId: string | null) {
  const queue = loadQueue();
  queue.push({
    id: crypto.randomUUID(),
    url,
    method,
    body,
    createdAt: Date.now(),
    retries: 0,
    userId,
  });
  saveQueue(queue);
}

export function clearQueue() {
  saveQueue([]);
}

export function getQueueSize(): number {
  return loadQueue().length;
}

/**
 * Process all queued requests. Returns { succeeded, failed, remaining }.
 * Caller should provide a fetch function that handles auth headers.
 */
export async function processQueue(
  doFetch: (url: string, method: string, body: string) => Promise<Response>,
  getCurrentUserId: () => string | null,
): Promise<{ succeeded: number; failed: number; remaining: number }> {
  const queue = loadQueue();
  if (queue.length === 0) return { succeeded: 0, failed: 0, remaining: 0 };

  let succeeded = 0;
  let failed = 0;
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
  return { succeeded, failed, remaining: remaining.length };
}
