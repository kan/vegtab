import { env, SELF } from 'cloudflare:test';
import { vi } from 'vitest';
import { initializeGame, processAction, BOARD_SIZE, type Action, type GameState } from '@vegtab/engine';
import { generateDailySeed, todayJST } from '../src/lib/date';

/** Empty every table and the ranking cache so each test starts clean (the schema comes from test/apply-migrations.ts) */
export async function resetDb() {
  for (const table of ['achievements', 'play_scores', 'puzzle_seeds', 'user_devices', 'push_subscriptions', 'refresh_token_families', 'transfer_codes', 'users']) {
    await env.DB.exec(`DELETE FROM ${table}`);
  }
  for (const { name } of (await env.KV.list({ prefix: 'ranking:' })).keys) await env.KV.delete(name);
}

export async function registerUser(deviceId: string) {
  const res = await SELF.fetch('http://localhost/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId }),
  });
  return res.json() as Promise<{ userId: string; accessToken: string; refreshToken: string }>;
}

export function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Build a replay log of `moves` valid swaps for the daily seed of `date` (the first valid swap each time).
 * Every valid swap adds points, so a longer replay always has a higher score.
 * `moves = Infinity` plays until the game is over.
 */
export function buildReplay(moves: number, date = todayJST()): { replayLog: Action[]; state: GameState } {
  let state = initializeGame(generateDailySeed(date));
  const replayLog: Action[] = [];
  while (replayLog.length < moves && !state.isGameOver) {
    const before = state;
    search: for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        for (const dir of ['right', 'down'] as const) {
          const action: Action = { type: 'swap', pos: { row, col }, dir };
          const next = processAction(state, action);
          if (next !== state) {
            replayLog.push(action);
            state = next;
            break search;
          }
        }
      }
    }
    if (state === before) break;
  }
  if (Number.isFinite(moves) && replayLog.length < moves) {
    throw new Error(`no valid swap after ${replayLog.length} moves`);
  }
  return { replayLog, state };
}

/**
 * A day whose daily seed buildReplay(Infinity) clears: 36 moves, max chain 4.
 * Short replays cannot clear a board, so tests that need a cleared run fix the clock to this day.
 */
export const CLEARED_DATE = '2026-09-17';

let clearedRunCache: ReturnType<typeof buildReplay> | undefined;

/** The replay that clears CLEARED_DATE's board. It is the same for every test, so it is built once (do not mutate it) */
export function clearedRun(): ReturnType<typeof buildReplay> {
  return clearedRunCache ??= buildReplay(Infinity, CLEARED_DATE);
}

/** Fix the server clock to noon JST of `date` (undo with vi.useRealTimers()) */
export function useFakeToday(date: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${date}T12:00:00+09:00`));
}

export function submitScore(token: string, body: Record<string, unknown>) {
  return SELF.fetch('http://localhost/api/scores', {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Submit a replay of `moves` valid swaps for today's seed; returns the response and the expected final state */
export async function submitReplay(token: string, moves: number, extra: Record<string, unknown> = {}) {
  const { replayLog, state } = buildReplay(moves);
  const res = await submitScore(token, { date: todayJST(), mode: 'clear', replayLog, ...extra });
  return { res, state };
}

/** Dummy Web Push subscription keys (format-valid, not tied to a real browser) */
export const PUSH_KEYS = {
  p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8p8REfWIA',
  auth: 'tBHItJI5svbpC7sc9d8MqQ',
};

export function subscribePush(token: string | null, endpoint: string) {
  return SELF.fetch('http://localhost/api/push/subscribe', {
    method: 'POST',
    headers: { ...(token ? authHeader(token) : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint, keys: PUSH_KEYS }),
  });
}

/** Get (and auto-create) today's daily seed id */
export async function getTodaySeedId(token: string): Promise<string> {
  const res = await SELF.fetch('http://localhost/api/seeds/daily', { headers: authHeader(token) });
  const data = await res.json() as { seedId: string };
  return data.seedId;
}

/**
 * Insert a play_scores row directly, for results a short replay cannot produce (e.g. cleared runs).
 * `mode` defaults to clear; pass a removed mode (sprint / survival / cascade) to stand in for rows left in D1.
 * Returns the row id.
 */
export async function insertPlayScore(row: {
  userId: string; seedId: string; mode?: string; moveCount: number; score: number; isCleared?: boolean;
  maxChain?: number; cascadePoints?: number; replayLogKey?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO play_scores (id, user_id, seed_id, mode, move_count, score, is_cleared, max_chain, cascade_points, replay_log_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, row.userId, row.seedId, row.mode ?? 'clear', row.moveCount, row.score, row.isCleared ? 1 : 0,
    row.maxChain ?? 0, row.cascadePoints ?? 0, row.replayLogKey ?? null,
  ).run();
  return id;
}
