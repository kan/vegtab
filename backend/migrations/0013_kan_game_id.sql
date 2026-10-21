-- #103: accounts become kan-game.app IDs (kan/game docs/ID_DESIGN.md). The user_id columns keep
-- their name and type; new rows hold the kan-game.app ID. The users table and its device/token
-- tables stay for the old accounts of vegtab.app until they are handed over (legacy_claims).

-- The kan-game.app name of an ID (a copy of what the ID platform registered) and its consent to
-- publish it in vegtab's rankings. Only IDs with a row here are ranked.
CREATE TABLE profiles (
  account_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  consented_at INTEGER NOT NULL
);

-- IDs withdrawn from kan-game.app. Their cookies stay valid for up to 400 days, so requests
-- carrying them are refused (src/lib/id-auth.ts).
CREATE TABLE deleted_accounts (
  account_id TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL
);

-- One-time tokens the old vegtab.app screen gets for its account, to hand the account's records
-- over to a kan-game.app ID on vegtab.kan-game.app. Only the SHA-256 of the token is stored.
CREATE TABLE legacy_handoffs (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX legacy_handoffs_user_id ON legacy_handoffs (user_id);

-- push_subscriptions referenced users(id), which a kan-game.app ID is not in: rebuilt without it
-- (same columns, so the Worker before this keeps working)
CREATE TABLE push_subscriptions_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  key_p256dh TEXT NOT NULL,
  key_auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO push_subscriptions_new (id, user_id, endpoint, key_p256dh, key_auth, created_at)
  SELECT id, user_id, endpoint, key_p256dh, key_auth, created_at FROM push_subscriptions;
DROP TABLE push_subscriptions;
ALTER TABLE push_subscriptions_new RENAME TO push_subscriptions;
CREATE UNIQUE INDEX idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);
CREATE INDEX idx_push_subscriptions_user_id ON push_subscriptions(user_id);

-- Old accounts already handed over, and the ID they went to.
CREATE TABLE legacy_claims (
  legacy_user_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL
);
CREATE INDEX legacy_claims_account_id ON legacy_claims (account_id);
