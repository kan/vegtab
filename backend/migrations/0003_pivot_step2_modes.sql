-- Delete old 'limited' mode data
DELETE FROM play_scores WHERE mode = 'limited';

-- Drop old index
DROP INDEX IF EXISTS idx_play_scores_ranking;

-- Add mode-specific indexes
CREATE INDEX IF NOT EXISTS idx_play_scores_sprint ON play_scores(seed_id, mode, score DESC);
CREATE INDEX IF NOT EXISTS idx_play_scores_clear ON play_scores(seed_id, mode, is_cleared, move_count ASC);
CREATE INDEX IF NOT EXISTS idx_play_scores_survival ON play_scores(seed_id, mode, move_count DESC, score DESC);
