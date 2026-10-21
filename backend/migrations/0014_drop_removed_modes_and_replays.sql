-- #103 cutover. Also safe under the Worker it replaces, which already ignores these rows.

-- Records of the removed modes (#102) and achievements no longer defined (engine ACHIEVEMENT_DEFS)
DELETE FROM play_scores WHERE mode <> 'clear';
DELETE FROM achievements WHERE achievement_type NOT IN (
  'tutorial_complete',
  'clear_first', 'clear_under_10', 'clear_under_7', 'clear_under_5', 'clear_under_3',
  'cascade_chain_3', 'cascade_chain_5', 'chain_7', 'cascade_chain_10', 'cascade_chain_15',
  'play_days_3', 'play_days_7', 'play_days_30', 'play_days_100',
  'all_items_generated'
);

-- #106 builds every day's board anew, so the stored replays no longer play on their boards.
-- Their R2 objects (prefix replays/) are removed by the bucket's lifecycle rule (docs/SPEC.md §5.4).
UPDATE play_scores SET replay_log_key = NULL;

-- Rankings still open (today, and yesterday in its 30-minute grace period: src/lib/date.ts
-- isRankingClosed) would mix the old boards with the new ones, so their records go. Past rankings
-- are closed and stay as they were. The Worker before this keeps writing old boards' records until
-- the deploy; those are removed after it (docs/SPEC.md §5.4).
DELETE FROM play_scores WHERE seed_id IN (
  SELECT id FROM puzzle_seeds WHERE daily_date >= date('now', '+9 hours', '-30 minutes')
);
