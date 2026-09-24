-- play_scores に (user_id, seed_id, mode) の UNIQUE 制約を付け、Cascade のインデックスを cascade_points に張り替える。
--
-- 同じ seed×mode の初回送信が同時に走ると重複行ができえたので、先に各ユーザーのベスト 1 件だけを残す。
-- 「ベスト」の基準は routes/scores.ts の upsert と同じ（Clear はクリア済みを優先）。同じ記録なら先に送った行を残す。
-- 適用前に本番の重複（この DELETE で消える行）の件数を確かめるには:
--   npx wrangler d1 execute tomado-db --env production --remote --command \
--     "SELECT COUNT(*) - COUNT(DISTINCT user_id || '|' || seed_id || '|' || mode) AS duplicates FROM play_scores"

DELETE FROM play_scores WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY user_id, seed_id, mode
      ORDER BY
        CASE WHEN mode = 'clear' THEN is_cleared ELSE 0 END DESC,
        CASE mode
          WHEN 'sprint' THEN score
          WHEN 'clear' THEN -move_count
          WHEN 'survival' THEN move_count
          WHEN 'cascade' THEN cascade_points
        END DESC,
        score DESC,
        created_at ASC,
        id ASC
    ) AS rn
    FROM play_scores
  ) WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_play_scores_user_seed_mode ON play_scores (user_id, seed_id, mode);

-- 旧インデックスは使われていない max_chain に張られていた
DROP INDEX IF EXISTS idx_scores_cascade;
CREATE INDEX IF NOT EXISTS idx_play_scores_cascade ON play_scores (seed_id, mode, cascade_points DESC, score DESC);
