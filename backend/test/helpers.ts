import { env, SELF } from 'cloudflare:test';
import { initializeGame, processAction, BOARD_SIZE, type Action, type GameMode, type GameState } from '@vegtab/engine';
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
 * Build a replay log of `moves` valid swaps for the daily seed of `date`.
 * Every valid swap adds points, so a longer replay always has a higher score.
 */
export function buildReplay(mode: GameMode, moves: number, date = todayJST()): { replayLog: Action[]; state: GameState } {
  let state = initializeGame(generateDailySeed(date), mode);
  const replayLog: Action[] = [];
  while (replayLog.length < moves) {
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
    if (state === before) throw new Error(`no valid swap after ${replayLog.length} moves`);
  }
  return { replayLog, state };
}

export function submitScore(token: string, body: Record<string, unknown>) {
  return SELF.fetch('http://localhost/api/scores', {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Submit a replay of `moves` valid swaps for today's seed; returns the response and the expected final state */
export async function submitReplay(token: string, mode: GameMode, moves: number, extra: Record<string, unknown> = {}) {
  const { replayLog, state } = buildReplay(mode, moves);
  const res = await submitScore(token, { date: todayJST(), mode, replayLog, ...extra });
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

/** Insert a play_scores row directly, for results a short replay cannot produce (e.g. cleared Clear runs) */
export async function insertPlayScore(row: {
  userId: string; seedId: string; mode: GameMode; moveCount: number; score: number; isCleared?: boolean;
  maxChain?: number; cascadePoints?: number;
}) {
  await env.DB.prepare(
    `INSERT INTO play_scores (id, user_id, seed_id, mode, move_count, score, is_cleared, max_chain, cascade_points)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(), row.userId, row.seedId, row.mode, row.moveCount, row.score, row.isCleared ? 1 : 0,
    row.maxChain ?? 0, row.cascadePoints ?? 0,
  ).run();
}
