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
const USER = 'user-a';
const asUser = (id: string | null) => () => id;

describe('offlineQueue', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    stubLocalStorage();
  });

  it('送信に成功した項目を取り除く', async () => {
    enqueue('/api/scores', 'POST', '{"a":1}', USER);
    const result = await processQueue(async () => ok(), asUser(USER));
    expect(result).toEqual({ succeeded: 1, failed: 0, remaining: 0 });
    expect(getQueueSize()).toBe(0);
  });

  it('送信中に enqueue された項目を消さない', async () => {
    enqueue('/api/scores', 'POST', '{"a":1}', USER);
    const result = await processQueue(async () => {
      enqueue('/api/scores', 'POST', '{"b":2}', USER);
      return ok();
    }, asUser(USER));
    expect(result.succeeded).toBe(1);
    expect(result.remaining).toBe(1);
    expect(getQueueSize()).toBe(1);
  });

  it('サーバーエラーの項目は retries を増やして残し、上限で取り除く', async () => {
    enqueue('/api/scores', 'POST', '{"a":1}', USER);
    const fail = async () => new Response('', { status: 500 });
    expect((await processQueue(fail, asUser(USER))).remaining).toBe(1);
    expect((await processQueue(fail, asUser(USER))).remaining).toBe(1);
    const last = await processQueue(fail, asUser(USER));
    expect(last).toEqual({ succeeded: 0, failed: 1, remaining: 0 });
  });

  it('別のアカウントが追加した項目は送らずに取り除く', async () => {
    enqueue('/api/scores', 'POST', '{"a":1}', 'user-old');
    const doFetch = vi.fn(async () => ok());
    const result = await processQueue(doFetch, asUser(USER));
    expect(doFetch).not.toHaveBeenCalled();
    expect(result).toEqual({ succeeded: 0, failed: 0, remaining: 0 });
  });

  it('処理の途中でアカウントが切り替わったら、残りの旧アカウントの項目を送らない', async () => {
    enqueue('/api/scores', 'POST', '{"a":1}', USER);
    enqueue('/api/scores', 'POST', '{"b":2}', USER);
    let current = USER;
    const doFetch = vi.fn(async () => {
      current = 'user-new';
      return ok();
    });
    await processQueue(doFetch, () => current);
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it('localStorage への保存が例外を投げても enqueue は例外を投げない', () => {
    stubLocalStorage({ throwOnSet: true });
    expect(() => enqueue('/api/scores', 'POST', '{}', USER)).not.toThrow();
  });
});
