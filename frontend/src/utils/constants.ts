import type { ItemType, GameMode } from '@tomado/engine';
import { lightningIcon, brickIcon, infinityIcon, linkIcon } from '@/assets/icons';

export const DEFAULT_DISPLAY_NAME = 'NO NAME';

export const ALL_ITEM_TYPES: readonly ItemType[] = [
  'scope', 'v_cut', 'h_cut', 'burst', 'flush',
] as const;

export const ITEM_INFO: Record<ItemType, { label: string; desc: string }> = {
  scope: { label: 'Spoon', desc: 'Tap to remove 1 tile' },
  v_cut: { label: 'Knife', desc: 'Clears a vertical line' },
  h_cut: { label: 'Knife (H)', desc: 'Clears a horizontal line' },
  burst: { label: 'Fork', desc: 'Clears surrounding tiles' },
  flush: { label: 'Pot', desc: 'Clears all tiles of one color' },
};

/** Shorthand for ITEM_INFO[type].label */
export const ITEM_LABELS: Record<ItemType, string> = Object.fromEntries(
  ALL_ITEM_TYPES.map(t => [t, ITEM_INFO[t].label])
) as Record<ItemType, string>;

/** Mode icon mapping (shared across ModeSelector, HomeView, RankingModal) */
export const MODE_ICONS: Record<GameMode, string> = {
  sprint: lightningIcon,
  clear: brickIcon,
  survival: infinityIcon,
  cascade: linkIcon,
};
