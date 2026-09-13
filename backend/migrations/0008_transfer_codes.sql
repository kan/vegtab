-- Account transfer codes (moved from KV so that a code can be redeemed exactly once)
CREATE TABLE transfer_codes (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
