-- #89 で足した実績（clear_under_5 / clear_under_3 / chain_7 / play_days_100）の行を、既存の実績の行に
-- 残る記録から作る。手数と連鎖はスコア送信時に送ったゲームの値だけで判定するので、行を作らないと、
-- すでに条件を満たしている人も、もう一度同じ記録を出すまで解除されない。
-- - 手数: clear_under_7 の current_value（クリア手数の最少値）
-- - 連鎖: cascade_chain_3 の current_value（最大連鎖数）
-- - 日数: play_days_3 の current_value（プレイ日数）
-- 行の追加だけなので、デプロイ前の Worker に先に当てても壊れない（知らない type は API で返さない）。
-- 行がすでにあれば何もしない（idx_achievements_user_type の一意制約）。
-- unlocked_at は evaluateAchievements（new Date().toISOString()）と同じ ISO 形式で書く。

INSERT OR IGNORE INTO achievements (id, user_id, achievement_type, current_value, is_unlocked, unlocked_at)
SELECT lower(hex(randomblob(16))), user_id, 'clear_under_5', current_value,
       CASE WHEN current_value > 0 AND current_value <= 5 THEN 1 ELSE 0 END,
       CASE WHEN current_value > 0 AND current_value <= 5 THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') END
FROM achievements WHERE achievement_type = 'clear_under_7';

INSERT OR IGNORE INTO achievements (id, user_id, achievement_type, current_value, is_unlocked, unlocked_at)
SELECT lower(hex(randomblob(16))), user_id, 'clear_under_3', current_value,
       CASE WHEN current_value > 0 AND current_value <= 3 THEN 1 ELSE 0 END,
       CASE WHEN current_value > 0 AND current_value <= 3 THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') END
FROM achievements WHERE achievement_type = 'clear_under_7';

INSERT OR IGNORE INTO achievements (id, user_id, achievement_type, current_value, is_unlocked, unlocked_at)
SELECT lower(hex(randomblob(16))), user_id, 'chain_7', current_value,
       CASE WHEN current_value >= 7 THEN 1 ELSE 0 END,
       CASE WHEN current_value >= 7 THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') END
FROM achievements WHERE achievement_type = 'cascade_chain_3';

INSERT OR IGNORE INTO achievements (id, user_id, achievement_type, current_value, is_unlocked, unlocked_at)
SELECT lower(hex(randomblob(16))), user_id, 'play_days_100', current_value,
       CASE WHEN current_value >= 100 THEN 1 ELSE 0 END,
       CASE WHEN current_value >= 100 THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') END
FROM achievements WHERE achievement_type = 'play_days_3';
