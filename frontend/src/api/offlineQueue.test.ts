import { describe, it, expect, beforeEach, vi } from 'vitest';
import { enqueue, getQueueSize, processQueue } from './offlineQueue';

function stubLocalStorage(opts: { throwOnSet?: boolean } = {}) {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (opts.throwOnSet) throw new Error('QuotaExceededError');
      data.set(k, v);
    },
    removeItem: (k: string) => { data.delete(k); },
  });
}

const ok = () => new Response('{}', { status: 200 });

describe('offlineQueue', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    stubLocalStorage();
  });

  it('送信に成功した項目を取り除く', async () => {
    enqueue('/api/scores', 'POST', '{"a":1}');
    const result = await processQueue(async () => ok());
    expect(result).toEqual({ succeeded: 1, failed: 0, remaining: 0 });
    expect(getQueueSize()).toBe(0);
  });

  it('送信中に enqueue された項目を消さない', async () => {
    enqueue('/api/scores', 'POST', '{"a":1}');
    const result = await processQueue(async () => {
      enqueue('/api/scores', 'POST', '{"b":2}');
      return ok();
    });
    expect(result.succeeded).toBe(1);
    expect(result.remaining).toBe(1);
    expect(getQueueSize()).toBe(1);
  });

  it('サーバーエラーの項目は retries を増やして残し、上限で取り除く', async () => {
    enqueue('/api/scores', 'POST', '{"a":1}');
    const fail = async () => new Response('', { status: 500 });
    expect((await processQueue(fail)).remaining).toBe(1);
    expect((await processQueue(fail)).remaining).toBe(1);
    const last = await processQueue(fail);
    expect(last).toEqual({ succeeded: 0, failed: 1, remaining: 0 });
  });

  it('localStorage への保存が例外を投げても enqueue は例外を投げない', () => {
    stubLocalStorage({ throwOnSet: true });
    expect(() => enqueue('/api/scores', 'POST', '{}')).not.toThrow();
  });
});
