-- Add cascade_points column for cumulative chain scoring
ALTER TABLE play_scores ADD COLUMN cascade_points INTEGER NOT NULL DEFAULT 0;
