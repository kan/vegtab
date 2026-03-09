import type { ItemType } from '@tomado/engine';

export const ALL_ITEM_TYPES: readonly ItemType[] = [
  'magnifying_glass', 'scissors', 'cutter', 'clip', 'coffee',
] as const;

export const ITEM_INFO: Record<ItemType, { label: string; desc: string }> = {
  magnifying_glass: { label: 'Magnifying Glass', desc: 'Tap to remove 1 tile' },
  scissors: { label: 'Scissors', desc: 'Clears a vertical line' },
  cutter: { label: 'Cutter', desc: 'Clears a horizontal line' },
  clip: { label: 'Clip', desc: 'Clears surrounding tiles' },
  coffee: { label: 'Coffee Cup', desc: 'Clears all tiles of one color' },
};

/** Shorthand for ITEM_INFO[type].label */
export const ITEM_LABELS: Record<ItemType, string> = Object.fromEntries(
  ALL_ITEM_TYPES.map(t => [t, ITEM_INFO[t].label])
) as Record<ItemType, string>;
