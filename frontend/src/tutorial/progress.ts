/**
 * Whether the device has seen the tutorial. v2 is the hands-on tutorial (#108); the slideshow's
 * record (vegtab_tutorial) is not carried over, so everyone is offered the new one once. Opening the
 * tutorial or declining the offer both count as seen
 */
import { removeLocalItem, setLocalItem } from '@/lib/storage';

const STORAGE_KEY = 'vegtab_tutorial_v2';
/** The slideshow's record, no longer read */
const OLD_STORAGE_KEY = 'vegtab_tutorial';

/**
 * Reads localStorage directly rather than through getItemSync: that returns null both for "never
 * seen" and for storage that can't be read, and the latter must not offer the tutorial on every visit
 */
export function isTutorialFirstVisit(): boolean {
  try {
    return !localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

export function markTutorialSeen(): void {
  setLocalItem(STORAGE_KEY, 'seen');
  removeLocalItem(OLD_STORAGE_KEY);
}
