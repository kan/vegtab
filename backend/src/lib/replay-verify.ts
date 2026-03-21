import {
  initializeGame, processAction, processScopeSynthesis, processScopeSwap, processAutoActivation,
  type GameState, type GameMode, type Action, type Position, type Direction, type GameInitParams,
} from '@vegtab/engine';

type ReplayAction = Action
  | { type: 'scope_synthesis'; pos1: Position; pos2: Position; targetCells: Position[] }
  | { type: 'scope_swap'; pos: Position; dir: Direction; targetCells: Position[] }
  | { type: 'auto_activate' };

export interface VerifyResult {
  valid: boolean;
  score: number;
  moveCount: number;
  isCleared: boolean;
  maxChain: number;
  cascadePoints: number;
  error?: string;
}

/**
 * Replay a game from seed + actions and return the verified final state.
 */
export function verifyReplay(
  seed: number,
  mode: GameMode,
  replayLog: unknown[],
  params?: GameInitParams,
): VerifyResult {
  let state: GameState;
  try {
    state = initializeGame(seed, mode, params);
  } catch {
    return { valid: false, score: 0, moveCount: 0, isCleared: false, maxChain: 0, cascadePoints: 0, error: 'init failed' };
  }

  for (let i = 0; i < replayLog.length; i++) {
    const raw = replayLog[i] as Record<string, unknown>;
    if (!raw || typeof raw.type !== 'string') {
      return { valid: false, score: state.score, moveCount: state.moveCount, isCleared: false, maxChain: 0, cascadePoints: 0, error: `invalid action at index ${i}` };
    }

    try {
      const action = raw as unknown as ReplayAction;

      if (action.type === 'scope_synthesis') {
        state = processScopeSynthesis(state, action.pos1, action.pos2, action.targetCells);
      } else if (action.type === 'scope_swap') {
        state = processScopeSwap(state, action.pos, action.dir, action.targetCells);
      } else if (action.type === 'auto_activate') {
        state = processAutoActivation(state);
      } else {
        state = processAction(state, action as Action);
      }
    } catch {
      return { valid: false, score: state.score, moveCount: state.moveCount, isCleared: false, maxChain: 0, cascadePoints: 0, error: `action failed at index ${i}` };
    }
  }

  // Sprint auto-activation (if not already in replay log)
  if (mode === 'sprint' && state.isGameOver) {
    state = processAutoActivation(state);
  }

  return {
    valid: true,
    score: state.score,
    moveCount: state.moveCount,
    isCleared: state.isCleared ?? false,
    maxChain: state.maxChainIndex ?? 0,
    cascadePoints: state.cascadePoints ?? 0,
  };
}
