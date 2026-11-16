-- #119: per-ID counts for the write APIs that cost CPU or call the ID platform (src/lib/rate-limit.ts).
-- One row per ID and action: the current fixed window and how many requests it took. Rows of past
-- windows are overwritten by the next request, and the daily scheduled run deletes stale ones.
CREATE TABLE rate_limits (
  account_id TEXT NOT NULL,
  action TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (account_id, action)
);
CREATE INDEX rate_limits_window_start ON rate_limits (window_start);
