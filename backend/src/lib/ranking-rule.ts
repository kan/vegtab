/**
 * 順位の規則（#91）: クリアした記録だけを、少ない手数 → 短いクリアまでの時間の順に並べる。スコアは使わない。
 * 時間はその日の累計（ミリ秒）で、クライアントの自己申告の値。サーバーでは検証できない（SPEC §5.3）。
 * 時間の記録がない（時間を順位に入れる前の）行は、同じ手数の中で最後に並ぶ。
 * ランキングの並び（RANKING_ORDER）とベストの置き換え（BETTER_THAN_STORED）を、ここで同じ規則から作る。
 * frontend の同じ比較は frontend/src/lib/bestResult.ts。
 */
import { MODE } from './mode';

/** 受け付ける時間の上限。1 日の累計なので 24 時間を超えることはない */
export const MAX_CLEAR_TIME_MS = 24 * 60 * 60 * 1000;

/** 時間の記録がない行を、同じ手数の中で最後に並べるための値 */
const NO_TIME = Number.MAX_SAFE_INTEGER;

const timeOrLast = (table: string) => `COALESCE(${table}clear_time_ms, ${NO_TIME})`;

/** ランキングの ORDER BY（良い順）。すべての項目が同じなら同順位 */
export const RANKING_ORDER = `move_count ASC, ${timeOrLast('')} ASC`;

/**
 * upsert の DO UPDATE の条件: 新しい記録（excluded）が保存済みのベスト（play_scores）より良いか。
 * クリアした記録を優先し、どちらもクリアなら RANKING_ORDER と同じ基準で比べる
 */
export const BETTER_THAN_STORED = `excluded.is_cleared > play_scores.is_cleared
    OR (excluded.is_cleared = 1 AND play_scores.is_cleared = 1
      AND (excluded.move_count < play_scores.move_count
        OR (excluded.move_count = play_scores.move_count
          AND ${timeOrLast('excluded.')} < ${timeOrLast('play_scores.')})))`;

/**
 * ランキングの KV キャッシュのキー。並びやエントリの形を変えたら版を上げ、古い形のキャッシュを読まないようにする
 * （古いキーは TTL で消える）
 */
export function rankingCacheKey(seedId: string): string {
  return `ranking:v2:${seedId}:${MODE}`;
}
