-- Add max_chain column for Cascade mode ranking
ALTER TABLE play_scores ADD COLUMN max_chain INTEGER DEFAULT 0;

-- Index for Cascade ranking: max_chain DESC, score DESC
CREATE INDEX IF NOT EXISTS idx_scores_cascade ON play_scores (seed_id, mode, max_chain DESC, score DESC);
