import { goldMedalIcon, silverMedalIcon, bronzeMedalIcon } from '@/assets/icons';

/** The medal shown for ranks 1 to 3 in the rankings (HOME and the ranking dialog); other ranks show their number */
export function rankMedalIcon(rank: number): string | null {
  if (rank === 1) return goldMedalIcon;
  if (rank === 2) return silverMedalIcon;
  if (rank === 3) return bronzeMedalIcon;
  return null;
}
