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

function saveQueue(queue: QueueEntry[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function enqueue(url: string, method: string, body: string) {
  const queue = loadQueue();
  queue.push({
    id: crypto.randomUUID(),
    url,
    method,
    body,
    createdAt: Date.now(),
    retries: 0,
  });
  saveQueue(queue);
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
): Promise<{ succeeded: number; failed: number; remaining: number }> {
  const queue = loadQueue();
  if (queue.length === 0) return { succeeded: 0, failed: 0, remaining: 0 };

  let succeeded = 0;
  let failed = 0;
  const remaining: QueueEntry[] = [];

  function retryOrFail(entry: QueueEntry) {
    entry.retries++;
    if (entry.retries < MAX_RETRIES) {
      remaining.push(entry);
    } else {
      failed++;
    }
  }

  for (const entry of queue) {
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

  saveQueue(remaining);
  return { succeeded, failed, remaining: remaining.length };
}
