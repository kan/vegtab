import type { ItemType } from '@tomado/engine';

export const ALL_ITEM_TYPES: readonly ItemType[] = [
  'magnifying_glass', 'scissors', 'cutter', 'clip', 'coffee',
] as const;

export const ITEM_LABELS: Record<ItemType, string> = {
  magnifying_glass: 'Magnifying Glass',
  scissors: 'Scissors',
  cutter: 'Cutter',
  clip: 'Clip',
  coffee: 'Coffee Cup',
};

/** Band colors for the 5 sticky-note colors (indexed by Color type 0-4). */
export const STICKY_NOTE_COLORS = [
  '#e6c832', '#5aad5e', '#4088c4', '#e06b6b', '#a85e90',
] as const;
