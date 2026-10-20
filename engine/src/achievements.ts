/** Achievement definition and evaluation logic (shared between frontend and backend) */

/**
 * 実績を判定する値。サーバーはスコア送信時にこの値を求め、metric が同じ実績をまとめて判定する。
 * - clearMoves: クリアした手数（未クリアなら判定しない）
 * - cleared: クリアしたら 1
 * - maxChain: 1 ゲームの最大連鎖数
 * - allItems: 1 ゲームで 5 種のアイテムを全て作ったら 1
 * - playDays: プレイした日数（累計）
 * - client: クライアントが解除を知らせる（`POST /api/achievements/unlock`）
 */
export type AchievementMetric = 'clearMoves' | 'cleared' | 'maxChain' | 'allItems' | 'playDays' | 'client';

export interface AchievementDef {
  type: string;
  category: 'clear' | 'chain' | 'collection';
  metric: AchievementMetric;
  threshold: number;
  /** 'gte' = current_value >= threshold to unlock, 'lte' = current_value <= threshold */
  comparator: 'gte' | 'lte';
  secret: boolean;
}

export const ACHIEVEMENT_DEFS: readonly AchievementDef[] = [
  // Tutorial
  { type: 'tutorial_complete', category: 'collection', metric: 'client', threshold: 1, comparator: 'gte', secret: false },
  // Clear
  { type: 'clear_first', category: 'clear', metric: 'cleared', threshold: 1, comparator: 'gte', secret: false },
  { type: 'clear_under_10', category: 'clear', metric: 'clearMoves', threshold: 10, comparator: 'lte', secret: false },
  { type: 'clear_under_7', category: 'clear', metric: 'clearMoves', threshold: 7, comparator: 'lte', secret: false },
  { type: 'clear_under_5', category: 'clear', metric: 'clearMoves', threshold: 5, comparator: 'lte', secret: false },
  { type: 'clear_under_3', category: 'clear', metric: 'clearMoves', threshold: 3, comparator: 'lte', secret: true },
  // Chain（cascade_chain_* の type 名は Cascade モードがあった頃のまま。解除済みの記録と対応させるため変えない。
  // 後から足した段階は chain_* にする）
  { type: 'cascade_chain_3', category: 'chain', metric: 'maxChain', threshold: 3, comparator: 'gte', secret: false },
  { type: 'cascade_chain_5', category: 'chain', metric: 'maxChain', threshold: 5, comparator: 'gte', secret: false },
  { type: 'chain_7', category: 'chain', metric: 'maxChain', threshold: 7, comparator: 'gte', secret: false },
  { type: 'cascade_chain_10', category: 'chain', metric: 'maxChain', threshold: 10, comparator: 'gte', secret: false },
  { type: 'cascade_chain_15', category: 'chain', metric: 'maxChain', threshold: 15, comparator: 'gte', secret: true },
  // Collection
  { type: 'play_days_3', category: 'collection', metric: 'playDays', threshold: 3, comparator: 'gte', secret: false },
  { type: 'play_days_7', category: 'collection', metric: 'playDays', threshold: 7, comparator: 'gte', secret: false },
  { type: 'play_days_30', category: 'collection', metric: 'playDays', threshold: 30, comparator: 'gte', secret: false },
  { type: 'play_days_100', category: 'collection', metric: 'playDays', threshold: 100, comparator: 'gte', secret: true },
  { type: 'all_items_generated', category: 'collection', metric: 'allItems', threshold: 1, comparator: 'gte', secret: false },
] as const;

export const ALL_ACHIEVEMENT_TYPES = ACHIEVEMENT_DEFS.map(d => d.type);

export function getAchievementDef(type: string): AchievementDef | undefined {
  return ACHIEVEMENT_DEFS.find(d => d.type === type);
}

export function isUnlocked(def: AchievementDef, currentValue: number): boolean {
  if (def.comparator === 'lte') return currentValue > 0 && currentValue <= def.threshold;
  return currentValue >= def.threshold;
}
