/**
 * Achievement definitions — synced copy from engine/src/achievements.ts
 * Keep in sync with the canonical version.
 */

export interface AchievementDef {
  type: string;
  category: 'sprint' | 'clear' | 'survival' | 'collection';
  threshold: number;
  comparator: 'gte' | 'lte';
  secret: boolean;
}

export const ACHIEVEMENT_DEFS: readonly AchievementDef[] = [
  { type: 'sprint_score_500', category: 'sprint', threshold: 500, comparator: 'gte', secret: false },
  { type: 'sprint_score_1000', category: 'sprint', threshold: 1000, comparator: 'gte', secret: false },
  { type: 'sprint_score_2000', category: 'sprint', threshold: 2000, comparator: 'gte', secret: false },
  { type: 'sprint_score_5000', category: 'sprint', threshold: 5000, comparator: 'gte', secret: true },
  { type: 'sprint_chain_3', category: 'sprint', threshold: 3, comparator: 'gte', secret: false },
  { type: 'sprint_chain_5', category: 'sprint', threshold: 5, comparator: 'gte', secret: false },
  { type: 'clear_first', category: 'clear', threshold: 1, comparator: 'gte', secret: false },
  { type: 'clear_under_10', category: 'clear', threshold: 10, comparator: 'lte', secret: false },
  { type: 'clear_under_7', category: 'clear', threshold: 7, comparator: 'lte', secret: false },
  { type: 'survival_moves_20', category: 'survival', threshold: 20, comparator: 'gte', secret: false },
  { type: 'survival_moves_50', category: 'survival', threshold: 50, comparator: 'gte', secret: false },
  { type: 'survival_moves_100', category: 'survival', threshold: 100, comparator: 'gte', secret: false },
  { type: 'survival_moves_200', category: 'survival', threshold: 200, comparator: 'gte', secret: true },
  { type: 'play_days_3', category: 'collection', threshold: 3, comparator: 'gte', secret: false },
  { type: 'play_days_7', category: 'collection', threshold: 7, comparator: 'gte', secret: false },
  { type: 'play_days_30', category: 'collection', threshold: 30, comparator: 'gte', secret: false },
  { type: 'all_modes_played', category: 'collection', threshold: 1, comparator: 'gte', secret: false },
  { type: 'all_items_generated', category: 'collection', threshold: 1, comparator: 'gte', secret: false },
] as const;

export function isUnlocked(def: AchievementDef, currentValue: number): boolean {
  if (def.comparator === 'lte') return currentValue > 0 && currentValue <= def.threshold;
  return currentValue >= def.threshold;
}
