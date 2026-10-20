import {
  initializeGame, applyReplayAction,
  type GameState, type ReplayAction,
} from '@vegtab/engine';

export interface VerifyResult {
  valid: boolean;
  score: number;
  moveCount: number;
  isCleared: boolean;
  maxChain: number;
  error?: string;
}

/**
 * Replay a game from seed + actions and return the verified final state.
 * The replay log is expected to be schema-validated already (see routes/scores.ts).
 */
export function verifyReplay(seed: number, replayLog: ReplayAction[]): VerifyResult {
  let state: GameState;
  try {
    state = initializeGame(seed);
  } catch {
    return { valid: false, score: 0, moveCount: 0, isCleared: false, maxChain: 0, error: 'init failed' };
  }

  for (let i = 0; i < replayLog.length; i++) {
    try {
      state = applyReplayAction(state, replayLog[i]);
    } catch {
      return { valid: false, score: state.score, moveCount: state.moveCount, isCleared: false, maxChain: 0, error: `action failed at index ${i}` };
    }
  }

  return {
    valid: true,
    score: state.score,
    moveCount: state.moveCount,
    isCleared: state.isCleared ?? false,
    maxChain: state.maxChainIndex ?? 0,
  };
}
