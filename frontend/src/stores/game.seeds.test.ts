import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const api = vi.fn();
vi.mock('@/api/client', () => ({
  api: (...args: unknown[]) => api(...args),
  apiErrorCode: () => null,
  flushOfflineQueue: vi.fn(),
  showToast: vi.fn(),
  ApiError: class extends Error {},
}));
vi.mock('@/api/id', () => ({
  getUserId: () => 'me',
  onIdChange: vi.fn(),
  rememberKanGameName: vi.fn(),
  startId: vi.fn(),
}));
vi.mock('@/stores/achievements', () => ({ useAchievementStore: () => ({}) }));

const { useGameStore } = await import('./game');

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
    data,
  };
}

/** 日ごとの seed は API から受け取り、端末では計算しない（#116） */
describe('日ごとの seed', () => {
  let storage: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T12:00:00+09:00'));
    storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    api.mockReset();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('今日の seed を API から受け取って覚え、次からは API を呼ばない', async () => {
    api.mockResolvedValue({ date: '2026-11-20', seedValue: '123456' });
    const store = useGameStore();
    expect(store.dailySeed()).toBeNull();

    expect(await store.fetchTodaySeed()).toBe(123456);
    expect(api).toHaveBeenCalledWith('/api/seeds/daily');
    expect(JSON.parse(storage.data.get('vegtab_daily_seeds')!)).toEqual({ '2026-11-20': 123456 });

    expect(await store.fetchTodaySeed()).toBe(123456);
    expect(api).toHaveBeenCalledTimes(1);
    expect(store.isPastDailySeed(123456)).toBe(false);
    expect(store.isPastDailySeed(42)).toBe(true);
  });

  it('今日の seed を受け取れていなければ、別の日と分かっている seed だけを過去のパズルとする', async () => {
    storage.data.set('vegtab_daily_seeds', JSON.stringify({ '2026-11-19': 19 }));
    api.mockRejectedValue(new TypeError('offline'));
    const store = useGameStore();
    await store.fetchTodaySeed();
    expect(store.isPastDailySeed(19)).toBe(true);
    expect(store.isPastDailySeed(20)).toBe(false);
  });

  it('前に受け取った seed は、オフラインでも使える', async () => {
    storage.data.set('vegtab_daily_seeds', JSON.stringify({ '2026-11-20': 777 }));
    api.mockRejectedValue(new TypeError('offline'));
    const store = useGameStore();
    expect(await store.fetchTodaySeed()).toBe(777);
    expect(api).not.toHaveBeenCalled();
  });

  it('受け取れず、覚えてもいなければ null（今日のパズルを開かない）', async () => {
    api.mockRejectedValue(new TypeError('offline'));
    const store = useGameStore();
    expect(await store.fetchTodaySeed()).toBeNull();
    expect(await store.todayPuzzlePath()).toBeNull();
  });

  it('同時に呼んでも、今日の seed の問い合わせは 1 回', async () => {
    api.mockResolvedValue({ date: '2026-11-20', seedValue: '5' });
    const store = useGameStore();
    expect(await Promise.all([store.fetchTodaySeed(), store.fetchTodaySeed()])).toEqual([5, 5]);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('カレンダーは月の seed を受け取り、受け取っていない日は null のまま', async () => {
    api.mockResolvedValue({ seeds: [{ date: '2026-11-02', seedValue: '22' }, { date: '2026-11-01', seedValue: '11' }] });
    const store = useGameStore();
    expect(await store.fetchMonthSeeds('2026-11')).toBe(true);
    expect(api).toHaveBeenCalledWith('/api/seeds/daily/calendar?month=2026-11');

    const days = store.getDailySeeds('2026-11');
    expect(days).toHaveLength(30);
    expect(days.slice(0, 3)).toEqual([
      { date: '2026-11-01', seed: 11 },
      { date: '2026-11-02', seed: 22 },
      { date: '2026-11-03', seed: null },
    ]);
  });

  it('今日までの日がそろっている月は問い合わせない（先の日は無くてよい）', async () => {
    const seeds = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`2026-11-${String(i + 1).padStart(2, '0')}`, i]));
    storage.data.set('vegtab_daily_seeds', JSON.stringify(seeds));
    const store = useGameStore();
    expect(await store.fetchMonthSeeds('2026-11')).toBe(true);
    expect(api).not.toHaveBeenCalled();
  });

  it('月の seed を受け取れなければ false', async () => {
    api.mockRejectedValue(new TypeError('offline'));
    const store = useGameStore();
    expect(await store.fetchMonthSeeds('2026-10')).toBe(false);
  });
});
