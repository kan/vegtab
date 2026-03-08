-- Users
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  device_id TEXT NOT NULL,
  is_premium INTEGER NOT NULL DEFAULT 0,
  stamina INTEGER NOT NULL DEFAULT 5,
  last_stamina_recover_at TEXT NOT NULL,
  undo_stock INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_users_device_id ON users(device_id);

-- TODO Groups
CREATE TABLE todo_groups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_todo_groups_user_id ON todo_groups(user_id);

-- TODOs
CREATE TABLE todos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  group_id TEXT REFERENCES todo_groups(id),
  title TEXT NOT NULL,
  memo TEXT,
  due_date TEXT,
  recurrence_rule TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  subtasks TEXT NOT NULL DEFAULT '[]',
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_todos_user_id ON todos(user_id);
CREATE INDEX idx_todos_group_id ON todos(group_id);
CREATE INDEX idx_todos_status ON todos(status);

-- Stamina Recovery Logs
CREATE TABLE stamina_recovery_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  target_date TEXT NOT NULL,
  recovered_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_stamina_recovery_user_date ON stamina_recovery_logs(user_id, target_date);

-- Daily TODO Progress
CREATE TABLE daily_todo_progress (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  target_date TEXT NOT NULL,
  completed_count INTEGER NOT NULL DEFAULT 0,
  item_claimed INTEGER NOT NULL DEFAULT 0,
  undo_claimed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_daily_progress_user_date ON daily_todo_progress(user_id, target_date);

-- User Items
CREATE TABLE user_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  item_type TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX idx_user_items_user_type ON user_items(user_id, item_type);

-- Puzzle Seeds
CREATE TABLE puzzle_seeds (
  id TEXT PRIMARY KEY,
  seed_value TEXT NOT NULL UNIQUE,
  share_code TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT REFERENCES users(id),
  is_daily INTEGER NOT NULL DEFAULT 0,
  daily_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_puzzle_seeds_daily_date ON puzzle_seeds(daily_date);
CREATE INDEX idx_puzzle_seeds_share_code ON puzzle_seeds(share_code);

-- User Unlocked Seeds
CREATE TABLE user_unlocked_seeds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  seed_id TEXT NOT NULL REFERENCES puzzle_seeds(id),
  unlocked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_unlocked_seeds_user_seed ON user_unlocked_seeds(user_id, seed_id);

-- Play Scores
CREATE TABLE play_scores (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  seed_id TEXT NOT NULL REFERENCES puzzle_seeds(id),
  mode TEXT NOT NULL,
  move_limit INTEGER,
  move_count INTEGER NOT NULL,
  score INTEGER NOT NULL,
  is_cleared INTEGER NOT NULL DEFAULT 0,
  used_brought_items INTEGER NOT NULL DEFAULT 0,
  used_undo INTEGER NOT NULL DEFAULT 0,
  is_trial INTEGER NOT NULL DEFAULT 0,
  replay_log_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_play_scores_user_id ON play_scores(user_id);
CREATE INDEX idx_play_scores_seed_mode ON play_scores(seed_id, mode);
CREATE INDEX idx_play_scores_ranking ON play_scores(seed_id, mode, score DESC)
  WHERE used_brought_items = 0 AND is_trial = 0;

-- Achievements
CREATE TABLE achievements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  achievement_type TEXT NOT NULL,
  current_value INTEGER NOT NULL DEFAULT 0,
  is_unlocked INTEGER NOT NULL DEFAULT 0,
  unlocked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_achievements_user_type ON achievements(user_id, achievement_type);

-- Achievement Milestones
CREATE TABLE achievement_milestones (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  threshold INTEGER NOT NULL,
  reward_claimed INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_milestones_user_threshold ON achievement_milestones(user_id, threshold);
