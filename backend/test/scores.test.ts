import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { BOARD_SIZE } from '@vegtab/engine';
import { replayKeyPrefix } from '../src/lib/replay-key';
import {
  call, resetDb, registerUser, authHeader, buildReplay, submitScore, submitReplay, insertPlayScore,
  getTodaySeedId, useFakeToday, CLEARED_DATE, clearedRun,
} from './helpers';
import { todayJST } from '../src/lib/date';

/** Legacy client payload: reported score fields (and the removed moveLimit) are still sent but must be ignored */
const basePayload = () => ({
  date: todayJST(),
  mode: 'clear',
  moveLimit: 15,
  moveCount: 15,
  score: 999999999,
  isCleared: false,
});

describe('POST /api/scores replay verification', () => {
  let token: string;

  beforeEach(async () => {
    ({ accessToken: token } = await registerUser());
  });

  it('rejects an empty replay log instead of trusting reported values', async () => {
    const res = await submitScore(token, { ...basePayload(), replayLog: [] });
    expect(res.status).toBe(400);
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM play_scores').first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it.each(['sprint', 'survival', 'cascade', undefined])('rejects mode %s (only clear is accepted)', async (mode) => {
    const { replayLog } = buildReplay(1);
    const res = await submitScore(token, { ...basePayload(), mode, replayLog });
    expect(res.status).toBe(400);
  });

  it('rejects unknown action types', async () => {
    const res = await submitScore(token, { ...basePayload(), replayLog: [{ type: 'teleport' }] });
    expect(res.status).toBe(400);
  });

  it('rejects the removed auto_activate action', async () => {
    const { replayLog } = buildReplay(1);
    const res = await submitScore(token, { ...basePayload(), replayLog: [...replayLog, { type: 'auto_activate' }] });
    expect(res.status).toBe(400);
  });

  it('rejects positions outside the board', async () => {
    const res = await submitScore(token, {
      ...basePayload(),
      replayLog: [{ type: 'swap', pos: { row: BOARD_SIZE, col: 0 }, dir: 'right' }],
    });
    expect(res.status).toBe(400);
  });

  it('rejects scope actions with too many target cells', async () => {
    const targetCells = Array.from({ length: 4 }, (_, col) => ({ row: 0, col }));
    const res = await submitScore(token, {
      ...basePayload(),
      replayLog: [{ type: 'scope', pos: { row: 3, col: 3 }, targetCells }],
    });
    expect(res.status).toBe(400);
  });

  it('rejects replay logs with too many actions', async () => {
    const replayLog = Array.from({ length: 1001 }, () => ({ type: 'tap', pos: { row: 0, col: 0 } }));
    const res = await submitScore(token, { ...basePayload(), replayLog });
    expect(res.status).toBe(400);
  });

  it('rejects oversized request bodies', async () => {
    const { replayLog } = buildReplay(1);
    const res = await submitScore(token, { ...basePayload(), replayLog, padding: 'x'.repeat(300 * 1024) });
    expect(res.status).toBe(413);
  });

  it('stores the re-simulated score and a normalized replay log', async () => {
    const { replayLog: [action], state } = buildReplay(1);
    const res = await submitScore(token, {
      ...basePayload(),
      replayLog: [{ ...action, injected: 'x'.repeat(100) }],
    });
    expect(res.status).toBe(201);
    const data = await res.json() as { scoreId: string; verifiedScore: number; verifiedMoveCount: number };
    expect(data.verifiedScore).toBe(state.score);
    expect(data.verifiedMoveCount).toBe(1);

    const row = await env.DB.prepare(
      'SELECT mode, score, move_count, is_cleared, move_limit, cascade_points, replay_log_key FROM play_scores WHERE id = ?'
    ).bind(data.scoreId).first<Record<string, unknown> & { replay_log_key: string }>();
    // move_limit and cascade_points belong to removed modes and are left to their column defaults
    expect(row).toMatchObject({
      mode: 'clear', score: state.score, move_count: 1, is_cleared: 0, move_limit: null, cascade_points: 0,
    });

    const stored = await env.R2.get(row!.replay_log_key);
    expect(JSON.parse(await stored!.text())).toEqual([action]);
  });
});

describe('POST /api/scores: ベスト記録の upsert', () => {
  let token: string;
  let userId: string;

  beforeEach(async () => {
    await resetDb();
    ({ accessToken: token, userId } = await registerUser());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function storedRows() {
    const { results } = await env.DB.prepare(
      'SELECT id, score, move_count, is_cleared, clear_time_ms, max_chain, replay_log_key FROM play_scores WHERE user_id = ?'
    ).bind(userId).all<{
      id: string; score: number; move_count: number; is_cleared: number; clear_time_ms: number | null;
      max_chain: number; replay_log_key: string;
    }>();
    return results;
  }

  async function replayObjectKeys() {
    return (await env.R2.list({ prefix: replayKeyPrefix(userId) })).objects.map(o => o.key);
  }

  /** Submit the run that clears CLEARED_DATE's board (the clock must already be fixed to that day) */
  async function submitClearedRun(clearTimeMs?: number) {
    const { replayLog, state } = clearedRun();
    expect(state.isCleared).toBe(true);
    const res = await submitScore(token, { date: CLEARED_DATE, mode: 'clear', clearTimeMs, replayLog });
    expect(res.status).toBe(201);
    return { body: await res.json() as { scoreId: string; newAchievements: string[] }, state };
  }

  it('同じ seed の初回送信が同時に届いても 1 行にまとまる', async () => {
    const [r1, r2] = await Promise.all([submitReplay(token, 2), submitReplay(token, 3)]);
    expect([r1.res.status, r2.res.status]).toEqual([201, 201]);
    expect(await storedRows()).toHaveLength(1);
  });

  it('クリアした記録は未クリアの記録を置き換え、R2 には新しいリプレイだけが残る', async () => {
    useFakeToday(CLEARED_DATE);
    const first = await submitReplay(token, 1);
    const firstId = (await first.res.json() as { scoreId: string }).scoreId;

    const { body, state } = await submitClearedRun();
    expect(body.scoreId).toBe(firstId);

    const [row] = await storedRows();
    // max_chain keeps recording the run's longest chain
    expect(row).toMatchObject({
      id: firstId, score: state.score, move_count: state.moveCount, is_cleared: 1, max_chain: state.maxChainIndex,
    });
    expect(await replayObjectKeys()).toEqual([row.replay_log_key]);
  });

  it('保存済みのクリアより手数が多い記録は保存せず、そのリプレイも R2 に残さない', async () => {
    useFakeToday(CLEARED_DATE);
    const seedId = await getTodaySeedId(token);
    const keptKey = `${replayKeyPrefix(userId)}${seedId}/kept.json`;
    await env.R2.put(keptKey, '[]');
    const bestId = await insertPlayScore({ userId, seedId, moveCount: 5, score: 100, isCleared: true, replayLogKey: keptKey });

    const { body } = await submitClearedRun();
    expect(body.scoreId).toBe(bestId);
    expect((await storedRows())[0]).toMatchObject({ move_count: 5, score: 100 });
    expect(await replayObjectKeys()).toEqual([keptKey]);
  });

  it('保存済みのクリアより少ない手数のクリアは記録を更新する', async () => {
    useFakeToday(CLEARED_DATE);
    const seedId = await getTodaySeedId(token);
    await insertPlayScore({ userId, seedId, moveCount: 999, score: 100, isCleared: true });

    const { state } = await submitClearedRun();
    expect((await storedRows())[0]).toMatchObject({ move_count: state.moveCount, score: state.score });
  });

  it('同じ手数なら短い時間のクリアで更新し、長い時間なら更新しない（スコアは比べない）', async () => {
    useFakeToday(CLEARED_DATE);
    const seedId = await getTodaySeedId(token);
    const { state } = clearedRun();
    // 保存済み: 同じ手数、スコアは高いが時間は遅い
    await insertPlayScore({ userId, seedId, moveCount: state.moveCount, score: 999_999, isCleared: true, clearTimeMs: 90_000 });

    await submitClearedRun(120_000);
    expect((await storedRows())[0]).toMatchObject({ score: 999_999, clear_time_ms: 90_000 });

    await submitClearedRun(60_000);
    expect((await storedRows())[0]).toMatchObject({ score: state.score, clear_time_ms: 60_000 });
  });

  it('時間の記録がない保存済みのクリアは、同じ手数で時間のあるクリアに置き換わる', async () => {
    useFakeToday(CLEARED_DATE);
    const seedId = await getTodaySeedId(token);
    const { state } = clearedRun();
    await insertPlayScore({ userId, seedId, moveCount: state.moveCount, score: 1, isCleared: true, clearTimeMs: null });

    await submitClearedRun(600_000);
    expect((await storedRows())[0]).toMatchObject({ clear_time_ms: 600_000 });
  });

  it('未クリアの記録は時間を持たない（送られてきても保存しない）', async () => {
    const { res } = await submitReplay(token, 1, { clearTimeMs: 5_000 });
    expect(res.status).toBe(201);
    expect((await storedRows())[0]).toMatchObject({ is_cleared: 0, clear_time_ms: null });
  });

  it('負の値・小数・数値でない時間は 400', async () => {
    for (const clearTimeMs of [-1, 1.5, '60000']) {
      const { res } = await submitReplay(token, 1, { clearTimeMs });
      expect(res.status, String(clearTimeMs)).toBe(400);
    }
  });

  it('上限（24 時間）を超える時間は弾かず、時間なしとして保存する', async () => {
    useFakeToday(CLEARED_DATE);
    await submitClearedRun(24 * 60 * 60 * 1000 + 1);
    expect((await storedRows())[0]).toMatchObject({ is_cleared: 1, clear_time_ms: null });
  });

  it('クリアで clear_first と連鎖実績を解除する', async () => {
    useFakeToday(CLEARED_DATE);
    const { body, state } = await submitClearedRun();
    // The cleared run's longest chain is 5: cascade_chain_5 unlocks, chain_7 does not
    expect(state.maxChainIndex).toBe(5);
    expect(body.newAchievements).toEqual(expect.arrayContaining(['clear_first', 'cascade_chain_3', 'cascade_chain_5']));
    expect(body.newAchievements).not.toContain('chain_7');
    expect(body.newAchievements).not.toContain('clear_under_10');
  });

  it('プレイ日数は撤去したモードの行も数える', async () => {
    // Two earlier days played only in removed modes, plus today's Clear submission = 3 days
    for (const [mode, day] of [['sprint', '2026-01-01'], ['survival', '2026-01-02']]) {
      await env.DB.prepare(
        `INSERT INTO play_scores (id, user_id, seed_id, mode, move_count, score, created_at) VALUES (?, ?, 'old-seed', ?, 1, 1, ?)`
      ).bind(crypto.randomUUID(), userId, mode, `${day} 12:00:00`).run();
    }

    const { res } = await submitReplay(token, 1);
    const body = await res.json() as { newAchievements: string[] };
    expect(body.newAchievements).toContain('play_days_3');
  });
});

describe('POST /api/scores: 0 時をまたいだプレイ', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** サーバーの時刻を JST の iso に固定し、ユーザー登録と前日（2026-09-23）分の送信をする */
  async function submitYesterdayAt(iso: string) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`${iso}+09:00`));
    const { accessToken } = await registerUser();
    const { replayLog } = buildReplay(2, '2026-09-23');
    const res = await submitScore(accessToken, { date: '2026-09-23', mode: 'clear', replayLog });
    return { status: res.status, body: await res.json() as { scoreId: string | null; pastDate?: boolean } };
  }

  it('0 時を過ぎて 30 分以内なら、前日分もランキングに記録する', async () => {
    const { status, body } = await submitYesterdayAt('2026-09-24T00:10:00');
    expect(status).toBe(201);
    expect(body.pastDate).toBeUndefined();
    expect(body.scoreId).not.toBeNull();
  });

  it('猶予を過ぎたら前日分は記録しない', async () => {
    const { status, body } = await submitYesterdayAt('2026-09-24T00:40:00');
    expect(status).toBe(200);
    expect(body).toMatchObject({ scoreId: null, pastDate: true });
  });
});

describe('撤去したモードの行は読み出さない', () => {
  let token: string;
  let userId: string;
  let seedId: string;

  beforeEach(async () => {
    await resetDb();
    ({ accessToken: token, userId } = await registerUser());
    seedId = await getTodaySeedId(token);
  });

  it('GET /api/scores/my は Clear の行だけを返し、moveLimit を含めない', async () => {
    const clearId = await insertPlayScore({ userId, seedId, moveCount: 12, score: 300, isCleared: true });
    await insertPlayScore({ userId, seedId, mode: 'sprint', moveCount: 15, score: 900 });
    await insertPlayScore({ userId, seedId, mode: 'cascade', moveCount: 15, score: 900, cascadePoints: 30 });

    const res = await call('http://localhost/api/scores/my', { headers: authHeader(token) });
    const { scores } = await res.json() as { scores: Array<Record<string, unknown>> };
    expect(scores).toHaveLength(1);
    expect(scores[0]).toMatchObject({ id: clearId, seedId, mode: 'clear', moveCount: 12, score: 300, isCleared: true });
    expect(scores[0]).not.toHaveProperty('moveLimit');
  });

  it('GET /api/scores/:scoreId/replay は Clear の行を返し、他モードの scoreId は 404', async () => {
    await env.R2.put('replays/test/clear.json', JSON.stringify([{ type: 'tap', pos: { row: 0, col: 0 } }]));
    await env.R2.put('replays/test/sprint.json', JSON.stringify([{ type: 'tap', pos: { row: 0, col: 0 } }]));
    const clearId = await insertPlayScore({ userId, seedId, moveCount: 12, score: 300, isCleared: true, replayLogKey: 'replays/test/clear.json' });
    const sprintId = await insertPlayScore({ userId, seedId, mode: 'sprint', moveCount: 15, score: 900, replayLogKey: 'replays/test/sprint.json' });

    const ok = await call(`http://localhost/api/scores/${clearId}/replay`, { headers: authHeader(token) });
    expect(ok.status).toBe(200);
    const body = await ok.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['displayName', 'finalScore', 'replayLog', 'seed']);
    expect(body.finalScore).toBe(300);

    const removed = await call(`http://localhost/api/scores/${sprintId}/replay`, { headers: authHeader(token) });
    expect(removed.status).toBe(404);
  });
});
