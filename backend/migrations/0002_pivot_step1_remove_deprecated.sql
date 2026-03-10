-- Pivot: Drop all old tables and recreate with new schema
-- (α release — no data migration needed)

DROP TABLE IF EXISTS achievement_milestones;
DROP TABLE IF EXISTS achievements;
DROP TABLE IF EXISTS daily_todo_progress;
DROP TABLE IF EXISTS user_items;
DROP TABLE IF EXISTS stamina_recovery_logs;
DROP TABLE IF EXISTS user_unlocked_seeds;
DROP TABLE IF EXISTS play_scores;
DROP TABLE IF EXISTS todos;
DROP TABLE IF EXISTS todo_groups;
DROP TABLE IF EXISTS puzzle_seeds;
DROP TABLE IF EXISTS users;

-- Users (simplified: removed stamina, undo_stock, is_premium)
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  device_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_users_device_id ON users(device_id);

-- Puzzle Seeds (removed created_by_user_id FK)
CREATE TABLE puzzle_seeds (
  id TEXT PRIMARY KEY,
  seed_value TEXT NOT NULL UNIQUE,
  share_code TEXT NOT NULL UNIQUE,
  is_daily INTEGER NOT NULL DEFAULT 0,
  daily_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_puzzle_seeds_daily_date ON puzzle_seeds(daily_date);
CREATE INDEX idx_puzzle_seeds_share_code ON puzzle_seeds(share_code);

-- Play Scores (removed used_brought_items, used_undo, is_trial)
CREATE TABLE play_scores (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  seed_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  move_limit INTEGER,
  move_count INTEGER NOT NULL,
  score INTEGER NOT NULL,
  is_cleared INTEGER NOT NULL DEFAULT 0,
  replay_log_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_play_scores_user_id ON play_scores(user_id);
CREATE INDEX idx_play_scores_seed_mode ON play_scores(seed_id, mode);

-- Achievements (kept for future use)
CREATE TABLE achievements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  achievement_type TEXT NOT NULL,
  current_value INTEGER NOT NULL DEFAULT 0,
  is_unlocked INTEGER NOT NULL DEFAULT 0,
  unlocked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_achievements_user_type ON achievements(user_id, achievement_type);
