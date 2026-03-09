-- Pivot Step 1: Remove deprecated features
-- Drop TODO tables
DROP TABLE IF EXISTS daily_todo_progress;
DROP TABLE IF EXISTS todos;
DROP TABLE IF EXISTS todo_groups;

-- Drop stamina recovery logs
DROP TABLE IF EXISTS stamina_recovery_logs;

-- Drop user items
DROP TABLE IF EXISTS user_items;

-- Drop user unlocked seeds
DROP TABLE IF EXISTS user_unlocked_seeds;

-- Drop achievement milestones
DROP TABLE IF EXISTS achievement_milestones;

-- Recreate users table without deprecated columns
-- (SQLite doesn't support DROP COLUMN in older versions, so recreate)
CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  device_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO users_new (id, display_name, device_id, created_at, updated_at)
  SELECT id, display_name, device_id, created_at, updated_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE UNIQUE INDEX idx_users_device_id ON users(device_id);

-- Recreate play_scores without deprecated columns
CREATE TABLE play_scores_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  seed_id TEXT NOT NULL REFERENCES puzzle_seeds(id),
  mode TEXT NOT NULL,
  move_limit INTEGER,
  move_count INTEGER NOT NULL,
  score INTEGER NOT NULL,
  is_cleared INTEGER NOT NULL DEFAULT 0,
  replay_log_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO play_scores_new (id, user_id, seed_id, mode, move_limit, move_count, score, is_cleared, replay_log_key, created_at)
  SELECT id, user_id, seed_id, mode, move_limit, move_count, score, is_cleared, replay_log_key, created_at FROM play_scores;
DROP TABLE play_scores;
ALTER TABLE play_scores_new RENAME TO play_scores;
CREATE INDEX idx_play_scores_user_id ON play_scores(user_id);
CREATE INDEX idx_play_scores_seed_mode ON play_scores(seed_id, mode);
CREATE INDEX idx_play_scores_ranking ON play_scores(seed_id, mode, score DESC);
