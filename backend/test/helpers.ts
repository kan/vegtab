import { env } from 'cloudflare:test';

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

import { SELF } from 'cloudflare:test';

export function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}
