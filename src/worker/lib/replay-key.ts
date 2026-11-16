/**
 * Where a replay log is stored in R2. Replays of the boards before #106 were under `replays/`, which
 * the bucket's lifecycle rule removes (docs/SPEC.md §5.4), so the prefix changed with the boards.
 */
const REPLAY_PREFIX = 'replays-v2';

/** The prefix of all of an account's replays (deleted with the account) */
export function replayKeyPrefix(accountId: string): string {
  return `${REPLAY_PREFIX}/${accountId}/`;
}

export function newReplayKey(accountId: string, seedId: string): string {
  return `${replayKeyPrefix(accountId)}${seedId}/${crypto.randomUUID()}.json`;
}
