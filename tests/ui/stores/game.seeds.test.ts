import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const api = vi.fn();
vi.mock('@/api/client', () => ({
  api: (...args: unknown[]) => api(...args),
  apiErrorCode: () => null,
  flushOfflineQueue: vi.fn(),
  showToast: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public body = '') { super(`API Error ${status}`); }
  },
}));
vi.mock('@/api/id', () => ({
  getUserId: () => 'me',
  onIdChange: vi.fn(),
  rememberKanGameName: vi.fn(),
  startId: vi.fn(),
}));
vi.mock('@/stores/achievements', () => ({
  useAchievementStore: () => ({ fetchAchievements: vi.fn(), handleNewAchievements: vi.fn(), reset: vi.fn() }),
}));

const { useGameStore } = await import('@/stores/game');
const { ApiError } = await import('@/api/client');

/** Answers the API by path; a path not listed fails like the network does */
function routeApi(routes: Record<string, (init?: RequestInit) => unknown>) {
  api.mockImplementation(async (path: string, init?: RequestInit) => {
    const route = routes[path];
    if (!route) throw new TypeError(`offline: ${path}`);
    return route(init);
  });
}

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
  });

  it('seed の日付は、受け取った seed から引き、無ければサーバーに聞いて覚える', async () => {
    storage.data.set('vegtab_daily_seeds', JSON.stringify({ '2026-11-19': 19 }));
    routeApi({ '/api/seeds/by-value/33': () => ({ seedValue: '33', date: '2026-11-03' }) });
    const store = useGameStore();
    expect(await store.resolveDailyDate(19)).toBe('2026-11-19');
    expect(api).not.toHaveBeenCalled();

    expect(await store.resolveDailyDate(33)).toBe('2026-11-03');
    expect(await store.resolveDailyDate(33)).toBe('2026-11-03');
    expect(api).toHaveBeenCalledTimes(1);
    expect(store.dailySeed('2026-11-03')).toBe(33);
  });

  it('デイリーでない seed の日付は null、サーバーに届かなければ例外', async () => {
    routeApi({ '/api/seeds/by-value/44': () => { throw new ApiError(404, ''); } });
    const store = useGameStore();
    expect(await store.resolveDailyDate(44)).toBeNull();
    await expect(store.resolveDailyDate(55)).rejects.toThrow('offline');
  });

  it('62 日より古い seed は読み込みで捨てる', () => {
    storage.data.set('vegtab_daily_seeds', JSON.stringify({ '2026-09-18': 1, '2026-09-19': 2, '2026-11-20': 3 }));
    const store = useGameStore();
    expect(store.getDailySeeds('2026-09').filter(d => d.seed !== null)).toEqual([{ date: '2026-09-19', seed: 2 }]);
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

  it('最初のデイリーの日を覚え、それより前の日は無くても月がそろっているとみなす', async () => {
    api.mockResolvedValue({ seeds: [{ date: '2026-11-20', seedValue: '20' }], firstDate: '2026-11-20' });
    const store = useGameStore();
    await store.fetchMonthSeeds('2026-11');
    expect(store.firstDailyDate).toBe('2026-11-20');
    expect(storage.data.get('vegtab_first_daily_date')).toBe('2026-11-20');

    api.mockClear();
    expect(await store.fetchMonthSeeds('2026-11')).toBe(true);
    expect(await store.fetchMonthSeeds('2026-10')).toBe(true);
    expect(api).not.toHaveBeenCalled();
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

/** 記録は日付を持ち、送れなかった記録は起動時に送り直す（#117） */
describe('記録の再送', () => {
  let storage: ReturnType<typeof memoryStorage>;
  const replayLog = [{ type: 'swap', pos: { row: 0, col: 0 }, dir: 'right' }];

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

  function storeRecords(records: object[]) {
    storage.data.set('vegtab_play_records', JSON.stringify(
      records.map((r) => ({ score: 10, moves: 1, playedAt: 0, playerName: 'p', mode: 'clear', replayLog, ...r })),
    ));
  }

  /** The record of `seed` as saved after the start's sync */
  async function savedRecord(seed: number) {
    const store = useGameStore();
    await store.init();
    // The resubmission runs after init, unawaited. The mocked API answers at once, so it is done after a task
    await new Promise((r) => setTimeout(r, 0));
    const records = JSON.parse(storage.data.get('vegtab_play_records')!) as Array<{ seed: number; date?: string; replayLog?: unknown }>;
    return records.find((r) => r.seed === seed)!;
  }

  const baseRoutes = {
    '/api/user/profile': () => ({ displayName: null }),
    '/api/scores/my': () => ({ scores: [] }),
  };

  it('日付のある記録は、その日付で送り、受け付けられたら replayLog を落とす', async () => {
    storeRecords([{ seed: 1, date: '2026-11-19' }]);
    const sent: unknown[] = [];
    routeApi({ ...baseRoutes, '/api/scores': (init) => { sent.push(JSON.parse(init!.body as string)); return { scoreId: 's', shareCode: 'ABCDEF', newAchievements: [] }; } });
    const record = await savedRecord(1);
    expect(sent).toMatchObject([{ date: '2026-11-19', replayLog }]);
    expect(record.replayLog).toBeUndefined();
    expect(api).not.toHaveBeenCalledWith(expect.stringMatching(/by-value/));
  });

  it('日付の無い古い記録は、サーバーに日付を聞いてから送り、日付を記録に残す', async () => {
    storeRecords([{ seed: 2 }]);
    const sent: Array<{ date: string }> = [];
    routeApi({
      ...baseRoutes,
      '/api/seeds/by-value/2': () => ({ seedValue: '2', date: '2026-11-02' }),
      '/api/scores': (init) => { sent.push(JSON.parse(init!.body as string)); return { scoreId: 's', shareCode: 'ABCDEF', newAchievements: [] }; },
    });
    const record = await savedRecord(2);
    expect(sent.map((s) => s.date)).toEqual(['2026-11-02']);
    expect(record.date).toBe('2026-11-02');
  });

  it('サーバーが 400 で拒んだ記録と、デイリーでない seed の記録は、replayLog を落として送り直さない', async () => {
    storeRecords([{ seed: 3, date: '2026-08-01' }, { seed: 4 }]);
    routeApi({
      ...baseRoutes,
      '/api/seeds/by-value/4': () => { throw new ApiError(404, ''); },
      '/api/scores': () => { throw new ApiError(400, '{"error":"Invalid date"}'); },
    });
    expect((await savedRecord(3)).replayLog).toBeUndefined();
    const records = JSON.parse(storage.data.get('vegtab_play_records')!) as Array<{ seed: number; replayLog?: unknown }>;
    expect(records.find((r) => r.seed === 4)!.replayLog).toBeUndefined();
  });

  it('送れなかった（オフライン）記録は replayLog を残し、次の起動で送り直す', async () => {
    storeRecords([{ seed: 5, date: '2026-11-19' }]);
    routeApi({ ...baseRoutes });
    expect((await savedRecord(5)).replayLog).toEqual(replayLog);
  });
});
