import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { BOARD_SIZE } from '@vegtab/engine';
import { applyMigrations, registerUser, buildReplay, submitScore } from './helpers';
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
