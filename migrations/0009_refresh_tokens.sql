-- One row per sign-in on a device (a refresh token family). Each refresh rotates current_jti.
-- Presenting any other token of the family revokes it, except the previous one right after a rotation.
CREATE TABLE refresh_token_families (
  family_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  current_jti TEXT NOT NULL,
  previous_jti TEXT,
  rotated_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_refresh_token_families_expires_at ON refresh_token_families(expires_at);
