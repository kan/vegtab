import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { BOARD_SIZE } from '@vegtab/engine';
import { applyMigrations, resetDb, registerUser, buildReplay, submitScore, submitReplay } from './helpers';
import { todayJST } from '../src/lib/date';

/** Legacy client payload: reported score fields are still sent but must be ignored */
const basePayload = () => ({
  date: todayJST(),
  mode: 'sprint',
  moveLimit: 15,
  moveCount: 15,
  score: 999999999,
  isCleared: false,
});

describe('POST /api/scores replay verification', () => {
  let token: string;

  beforeEach(async () => {
    await applyMigrations();
    ({ accessToken: token } = await registerUser(crypto.randomUUID()));
  });

  it('rejects an empty replay log instead of trusting reported values', async () => {
    const res = await submitScore(token, { ...basePayload(), replayLog: [] });
    expect(res.status).toBe(400);
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM play_scores').first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it('rejects unknown action types', async () => {
    const res = await submitScore(token, { ...basePayload(), replayLog: [{ type: 'teleport' }] });
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
    const replayLog = Array.from({ length: 1001 }, () => ({ type: 'auto_activate' }));
    const res = await submitScore(token, { ...basePayload(), replayLog });
    expect(res.status).toBe(400);
  });

  it('rejects oversized request bodies', async () => {
    const { replayLog } = buildReplay('sprint', 1);
    const res = await submitScore(token, { ...basePayload(), replayLog, padding: 'x'.repeat(300 * 1024) });
    expect(res.status).toBe(413);
  });

  it('stores the re-simulated score and a normalized replay log', async () => {
    const { replayLog: [action], state } = buildReplay('sprint', 1);
    const res = await submitScore(token, {
      ...basePayload(),
      replayLog: [{ ...action, injected: 'x'.repeat(100) }],
    });
    expect(res.status).toBe(201);
    const data = await res.json() as { verifiedScore: number; verifiedMoveCount: number };
    expect(data.verifiedScore).toBe(state.score);
    expect(data.verifiedMoveCount).toBe(1);

    const row = await env.DB.prepare('SELECT score, move_count, replay_log_key FROM play_scores')
      .first<{ score: number; move_count: number; replay_log_key: string }>();
    expect(row?.score).toBe(state.score);
    expect(row?.move_count).toBe(1);

    const stored = await env.R2.get(row!.replay_log_key);
    expect(JSON.parse(await stored!.text())).toEqual([action]);
  });
});

describe('POST /api/scores: ベスト記録の upsert', () => {
  let token: string;
  let userId: string;

  beforeEach(async () => {
    await resetDb();
    ({ accessToken: token, userId } = await registerUser(crypto.randomUUID()));
  });

  async function storedRows() {
    const { results } = await env.DB.prepare(
      'SELECT id, score, replay_log_key FROM play_scores WHERE user_id = ?'
    ).bind(userId).all<{ id: string; score: number; replay_log_key: string }>();
    return results;
  }

  async function replayObjectKeys() {
    return (await env.R2.list({ prefix: `replays/${userId}/` })).objects.map(o => o.key);
  }

  it('同じ seed×mode の初回送信が同時に届いても 1 行にまとまる', async () => {
    const [r1, r2] = await Promise.all([submitReplay(token, 'sprint', 2), submitReplay(token, 'sprint', 3)]);
    expect([r1.res.status, r2.res.status]).toEqual([201, 201]);
    const rows = await storedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].score).toBe(Math.max(r1.state.score, r2.state.score));
  });

  it('良くなった記録は同じ行を更新し、R2 には新しいリプレイだけが残る', async () => {
    const first = await submitReplay(token, 'sprint', 1);
    const firstId = (await first.res.json() as { scoreId: string }).scoreId;
    const better = await submitReplay(token, 'sprint', 3);
    expect((await better.res.json() as { scoreId: string }).scoreId).toBe(firstId);

    const [row] = await storedRows();
    expect(row).toMatchObject({ id: firstId, score: better.state.score });
    expect(await replayObjectKeys()).toEqual([row.replay_log_key]);
  });

  it('悪い記録は保存せず、そのリプレイも R2 に残さない', async () => {
    const best = await submitReplay(token, 'sprint', 3);
    const bestId = (await best.res.json() as { scoreId: string }).scoreId;
    const keysBefore = await replayObjectKeys();

    const worse = await submitReplay(token, 'sprint', 1);
    expect(worse.res.status).toBe(201);
    expect((await worse.res.json() as { scoreId: string }).scoreId).toBe(bestId);
    expect((await storedRows())[0].score).toBe(best.state.score);
    expect(await replayObjectKeys()).toEqual(keysBefore);
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
    await applyMigrations();
    const { accessToken } = await registerUser(crypto.randomUUID());
    const { replayLog } = buildReplay('sprint', 2, '2026-09-23');
    const res = await submitScore(accessToken, { date: '2026-09-23', mode: 'sprint', moveLimit: 15, replayLog });
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
