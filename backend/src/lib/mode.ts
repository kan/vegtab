/**
 * The only game mode. The API and the D1 `mode` column keep the value; rows of removed modes
 * (sprint / survival / cascade) stay in D1, so every query that reads results from play_scores
 * filters by this. The only exception is the play-day count in lib/achievements.ts.
 */
export const MODE = 'clear';
