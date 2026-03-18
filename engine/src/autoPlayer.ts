import {
  Action, GameMode, GameState, GameInitParams, Position, BOARD_SIZE,
} from './types.js';
import { initializeGame, processAction, processAutoActivation } from './engine.js';
import { getScopeAdjacentTargets } from './item.js';
import { countObstacles } from './obstacle.js';

export type GameMetrics = {
  seed: number;
  mode: GameMode;
  finalScore: number;
  moveCount: number;
  isCleared?: boolean;
  remainingObstacles?: number;
  segmentsSurvived?: number;
  maxChainIndex?: number;
};

const SWAP_DIRS = [
  { dir: 'right' as const, dr: 0, dc: 1 },
  { dir: 'down' as const, dr: 1, dc: 0 },
] as const;

/**
 * 有効手を探す。scopeタップを優先し、次にスワップから最初の有効手を返す。
 * 結果のGameStateも返すことで、呼び出し側でprocessActionを再実行する必要をなくす。
 */
function findBestAction(state: GameState): { action: Action; newState: GameState } | null {
  const board = state.board;

  // 1. scopeタップ: 盤上にscopeがあれば起動
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = board[r][c];
      if (cell?.item === 'scope' && !cell.obstacle) {
        const pos: Position = { row: r, col: c };
        const adjTargets = getScopeAdjacentTargets(board, pos);
        const targetCells: Position[] = [];
        // obstacle優先、なければ非obstacleの隣接セルを1つ選ぶ
        const obstacle = adjTargets.find(t => board[t.row][t.col]?.obstacle);
        if (obstacle) {
          targetCells.push(obstacle);
        } else {
          const nonObstacle = adjTargets.find(t => !board[t.row][t.col]?.obstacle);
          if (nonObstacle) targetCells.push(nonObstacle);
        }
        const action: Action = { type: 'scope', pos, targetCells };
        const newState = processAction(state, action);
        if (newState !== state) return { action, newState };
      }
    }
  }

  // 2. スワップ探索: 最初に見つかった有効手を返す
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      for (const { dir, dr, dc } of SWAP_DIRS) {
        if (r + dr >= BOARD_SIZE || c + dc >= BOARD_SIZE) continue;
        const action: Action = { type: 'swap', pos: { row: r, col: c }, dir };
        const newState = processAction(state, action);
        if (newState !== state) return { action, newState };
      }
    }
  }

  return null;
}

/** 自動プレイの最大手数（無限ループ防止） */
const MAX_MOVES = 500;

/** 指定シード・モードで自動プレイし、メトリクスを返す */
export function playGame(seed: number, mode: GameMode, params?: GameInitParams): GameMetrics {
  let state = initializeGame(seed, mode, params);

  while (!state.isGameOver && state.moveCount < MAX_MOVES) {
    const found = findBestAction(state);
    if (!found) break;
    state = found.newState;
  }

  // Sprint終了後: 残存アイテム自動発動（processAutoActivationは非sprintでは即returnする）
  if (mode === 'sprint') {
    state = processAutoActivation(state);
  }

  return {
    seed,
    mode,
    finalScore: state.score,
    moveCount: state.moveCount,
    isCleared: state.isCleared,
    remainingObstacles: mode === 'clear' ? countObstacles(state.board) : undefined,
    segmentsSurvived: mode === 'survival' ? Math.floor(state.moveCount / 5) : undefined,
    maxChainIndex: state.maxChainIndex,
  };
}
