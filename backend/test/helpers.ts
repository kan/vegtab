import { env, SELF } from 'cloudflare:test';
import { initializeGame, processAction, BOARD_SIZE, type Action, type GameMode, type GameState } from '@vegtab/engine';
import { generateDailySeed, todayJST } from '../src/lib/date';

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  device_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_device_id ON users(device_id);

CREATE TABLE IF NOT EXISTS puzzle_seeds (
  id TEXT PRIMARY KEY,
  seed_value TEXT NOT NULL UNIQUE,
  share_code TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT REFERENCES users(id),
  is_daily INTEGER NOT NULL DEFAULT 0,
  daily_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_puzzle_seeds_daily_date ON puzzle_seeds(daily_date);
CREATE INDEX IF NOT EXISTS idx_puzzle_seeds_share_code ON puzzle_seeds(share_code);

CREATE TABLE IF NOT EXISTS play_scores (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  seed_id TEXT NOT NULL REFERENCES puzzle_seeds(id),
  mode TEXT NOT NULL,
  move_limit INTEGER,
  move_count INTEGER NOT NULL,
  score INTEGER NOT NULL,
  is_cleared INTEGER NOT NULL DEFAULT 0,
  max_chain INTEGER DEFAULT 0,
  cascade_points INTEGER NOT NULL DEFAULT 0,
  replay_log_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_play_scores_user_id ON play_scores(user_id);
CREATE INDEX IF NOT EXISTS idx_play_scores_seed_mode ON play_scores(seed_id, mode);
CREATE INDEX IF NOT EXISTS idx_play_scores_sprint ON play_scores(seed_id, mode, score DESC);
CREATE INDEX IF NOT EXISTS idx_play_scores_clear ON play_scores(seed_id, mode, is_cleared, move_count ASC);
CREATE INDEX IF NOT EXISTS idx_play_scores_survival ON play_scores(seed_id, mode, move_count DESC, score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_cascade ON play_scores(seed_id, mode, max_chain DESC, score DESC);

CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  achievement_type TEXT NOT NULL,
  current_value INTEGER NOT NULL DEFAULT 0,
  is_unlocked INTEGER NOT NULL DEFAULT 0,
  unlocked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_achievements_user_type ON achievements(user_id, achievement_type);

CREATE TABLE IF NOT EXISTS user_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_devices_device_id ON user_devices(device_id);
CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON user_devices(user_id);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL,
  key_p256dh TEXT NOT NULL,
  key_auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);
`;

export async function applyMigrations() {
  const statements = MIGRATION_SQL.split(';').filter((s) => s.trim());
  for (const stmt of statements) {
    await env.DB.prepare(stmt).run();
  }
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
}) {
  await env.DB.prepare(
    `INSERT INTO play_scores (id, user_id, seed_id, mode, move_count, score, is_cleared)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), row.userId, row.seedId, row.mode, row.moveCount, row.score, row.isCleared ? 1 : 0).run();
}
