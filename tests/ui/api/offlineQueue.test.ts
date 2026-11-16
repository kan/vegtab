import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MAX_QUEUE_ENTRIES, enqueue, getQueueSize, processQueue } from '@/api/offlineQueue';

let data = new Map<string, string>();

function stubLocalStorage(opts: { throwOnSet?: boolean } = {}) {
  data = new Map<string, string>();
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

  it('ID の Cookie を断られた項目（401 / 410）は捨てずに残す', async () => {
    enqueue('/api/scores', 'POST', '{"a":1}', USER);
    const refused = async () => new Response('', { status: 401 });
    expect(await processQueue(refused, asUser(USER))).toEqual({ succeeded: 0, failed: 0, remaining: 1 });
  });

  it('回数の制限（429）の項目は retries を増やさずに残し、残りの項目も送らない', async () => {
    enqueue('/api/scores', 'POST', '{"a":1}', USER);
    enqueue('/api/scores', 'POST', '{"b":2}', USER);
    const limited = vi.fn(async () => new Response('', { status: 429 }));
    for (let i = 0; i < 5; i++) {
      expect(await processQueue(limited, asUser(USER))).toEqual({ succeeded: 0, failed: 0, remaining: 2 });
    }
    expect(limited).toHaveBeenCalledTimes(5);
    expect(await processQueue(async () => ok(), asUser(USER))).toEqual({ succeeded: 2, failed: 0, remaining: 0 });
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

  it('ID がまだ無いあいだは送らずに残し、ID ができたら ID なしで積んだ項目を送る', async () => {
    enqueue('/api/scores', 'POST', '{"a":1}', null);
    const doFetch = vi.fn(async () => ok());
    expect(await processQueue(doFetch, asUser(null))).toEqual({ succeeded: 0, failed: 0, remaining: 1 });
    expect(doFetch).not.toHaveBeenCalled();
    expect(await processQueue(doFetch, asUser(USER))).toEqual({ succeeded: 1, failed: 0, remaining: 0 });
  });

  it('localStorage への保存が例外を投げても enqueue は例外を投げず、保存できなかったことを返す', () => {
    expect(enqueue('/api/scores', 'POST', '{}', USER)).toBe(true);
    stubLocalStorage({ throwOnSet: true });
    let saved: boolean | undefined;
    expect(() => { saved = enqueue('/api/scores', 'POST', '{}', USER); }).not.toThrow();
    expect(saved).toBe(false);
  });

  describe('件数の上限とまとめ（#123）', () => {
    const cleared = (moves: number, timeMs: number | null = 60_000) => ({ isCleared: true, moves, timeMs });
    const bodies = async () => {
      const sent: string[] = [];
      await processQueue(async (_u, _m, body) => { sent.push(body); return ok(); }, asUser(USER));
      return sent;
    };

    it('上限を超えたら古いものから捨てる', async () => {
      for (let i = 0; i < MAX_QUEUE_ENTRIES + 5; i++) enqueue('/api/scores', 'POST', `{"n":${i}}`, USER);
      expect(getQueueSize()).toBe(MAX_QUEUE_ENTRIES);
      const sent = await bodies();
      expect(sent[0]).toBe('{"n":5}');
      expect(sent.at(-1)).toBe(`{"n":${MAX_QUEUE_ENTRIES + 4}}`);
    });

    it('同じ ID・同じ日の項目は良い方だけを残す', async () => {
      enqueue('/api/scores', 'POST', 'fail', USER, { key: '2026-11-16', summary: { isCleared: false, moves: 30, timeMs: null } });
      enqueue('/api/scores', 'POST', 'clear12', USER, { key: '2026-11-16', summary: cleared(12) });
      enqueue('/api/scores', 'POST', 'clear15', USER, { key: '2026-11-16', summary: cleared(15) }); // 悪い: 積まない
      enqueue('/api/scores', 'POST', 'clear12-same', USER, { key: '2026-11-16', summary: cleared(12) }); // 同じ: 前を残す
      enqueue('/api/scores', 'POST', 'clear12-faster', USER, { key: '2026-11-16', summary: cleared(12, 30_000) });
      enqueue('/api/scores', 'POST', 'other-day', USER, { key: '2026-11-15', summary: cleared(20) });
      enqueue('/api/scores', 'POST', 'other-id', 'user-b', { key: '2026-11-16', summary: cleared(40) });
      expect(getQueueSize()).toBe(3);
      // user-b の項目は USER では送らずに捨てる
      expect(await bodies()).toEqual(['clear12-faster', 'other-day']);
    });

    it('summary の無い項目（前の版で積んだもの）は新しい記録で置き換える', async () => {
      enqueue('/api/scores', 'POST', 'old', USER);
      data.set('vegtab_offline_queue', data.get('vegtab_offline_queue')!.replace('}]', ',"dedupeKey":"2026-11-16"}]'));
      enqueue('/api/scores', 'POST', 'new', USER, { key: '2026-11-16', summary: cleared(20) });
      expect(await bodies()).toEqual(['new']);
    });
  });

  describe('保存のキー', () => {
    it('旧キー（offline_queue）の項目を取り込み、旧キーを消す', async () => {
      data.set('offline_queue', JSON.stringify([
        { id: 'a', url: '/api/scores', method: 'POST', body: 'legacy', createdAt: Date.now(), retries: 0, userId: USER },
      ]));
      enqueue('/api/scores', 'POST', 'new', USER);
      expect(data.has('offline_queue')).toBe(false);
      expect(getQueueSize()).toBe(2);
    });

    it('読めないキューは退避して、空から始める', () => {
      data.set('vegtab_offline_queue', '{broken');
      expect(getQueueSize()).toBe(0);
      expect(data.get('vegtab_offline_queue.corrupt')).toBe('{broken');
      enqueue('/api/scores', 'POST', 'new', USER);
      expect(getQueueSize()).toBe(1);
      expect(data.get('vegtab_offline_queue.corrupt')).toBe('{broken');
    });
  });
});
