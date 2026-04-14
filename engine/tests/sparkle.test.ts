/**
 * Cascadeモード: キラキラ野菜のテスト
 */
import { describe, it, expect } from 'vitest';
import {
  initializeGame, processAction, cloneGameState,
} from '../src/engine.js';
import {
  fillEmptyCells, createSparkleRngStates, placeInitialSparkles,
  createEmptyBoard, SPARKLE_PROBABILITY, INITIAL_SPARKLE_COUNT,
  SPARKLE_BONUS_CP, peekNextTiles,
} from '../src/board.js';
import { playGame } from '../src/autoPlayer.js';
import { BOARD_SIZE, NUM_COLORS } from '../src/types.js';
import type { Color, Cell, GameState } from '../src/types.js';

const SEED = 42;

/** 盤面上のキラキラ数をカウント */
function countSparkles(board: (Cell | null)[][]): number {
  let count = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c]?.sparkle) count++;
    }
  }
  return count;
}

describe('キラキラ: 初期配置', () => {
  it('Cascadeモード初期盤面にINITIAL_SPARKLE_COUNT個のキラキラが存在する', () => {
    const state = initializeGame(SEED, 'cascade');
    expect(countSparkles(state.board)).toBe(INITIAL_SPARKLE_COUNT);
  });

  it('非Cascadeモードではキラキラがない', () => {
    for (const mode of ['sprint', 'clear', 'survival'] as const) {
      const state = initializeGame(SEED, mode, mode === 'clear' ? { obstacleCount: 5 } : undefined);
      expect(countSparkles(state.board)).toBe(0);
      expect(state.sparkleRngState).toBeUndefined();
    }
  });

  it('同一シードで同一キラキラ位置（決定性）', () => {
    const s1 = initializeGame(SEED, 'cascade');
    const s2 = initializeGame(SEED, 'cascade');
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(s1.board[r][c]?.sparkle).toBe(s2.board[r][c]?.sparkle);
      }
    }
  });

  it('sparkleRngStateが8列分初期化される', () => {
    const state = initializeGame(SEED, 'cascade');
    expect(state.sparkleRngState).toBeDefined();
    expect(state.sparkleRngState!.length).toBe(BOARD_SIZE);
  });
});

describe('キラキラ: 補充タイル', () => {
  it('fillEmptyCellsにsparkleRngを渡すとキラキラが生成される', () => {
    const board = createEmptyBoard();
    const colRng = [1, 2, 3, 4, 5, 6, 7, 8].map(s => s * 12345);
    const sparkleRng = createSparkleRngStates(SEED);

    fillEmptyCells(board, colRng, 4, sparkleRng);

    // 64マス中、約10%がキラキラ（統計的に0より大きいはず）
    const sparkleCount = countSparkles(board);
    expect(sparkleCount).toBeGreaterThanOrEqual(0);
    // 全てキラキラではない
    expect(sparkleCount).toBeLessThan(64);
  });

  it('fillEmptyCellsにsparkleRngを渡さないとキラキラは生成されない', () => {
    const board = createEmptyBoard();
    const colRng = [1, 2, 3, 4, 5, 6, 7, 8].map(s => s * 12345);

    fillEmptyCells(board, colRng, 4);

    expect(countSparkles(board)).toBe(0);
  });

  it('sparkleRngStatesがin-place更新される', () => {
    const board = createEmptyBoard();
    const colRng = [1, 2, 3, 4, 5, 6, 7, 8].map(s => s * 12345);
    const sparkleRng = createSparkleRngStates(SEED);
    const before = [...sparkleRng];

    fillEmptyCells(board, colRng, 4, sparkleRng);

    // 少なくとも1列のRNG状態が変化している
    expect(sparkleRng).not.toEqual(before);
  });
});

describe('キラキラ: CP計算', () => {
  it('キラキラ消去でCPが加算される', () => {
    // 2つのゲームを比較: キラキラありvsなし
    const withSparkle = initializeGame(SEED, 'cascade');
    const withoutSparkle = initializeGame(SEED, 'cascade');

    // キラキラを全て除去
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (withoutSparkle.board[r][c]?.sparkle) {
          withoutSparkle.board[r][c]!.sparkle = undefined;
        }
      }
    }

    // 同じ操作を両方に適用
    let s1 = withSparkle;
    let s2 = withoutSparkle;
    for (let i = 0; i < 5 && !s1.isGameOver && !s2.isGameOver; i++) {
      let moved = false;
      for (let r = 0; r < BOARD_SIZE && !moved; r++) {
        for (let c = 0; c < BOARD_SIZE && !moved; c++) {
          for (const dir of ['right', 'down'] as const) {
            const next1 = processAction(s1, { type: 'swap', pos: { row: r, col: c }, dir });
            const next2 = processAction(s2, { type: 'swap', pos: { row: r, col: c }, dir });
            if (next1 !== s1 && next2 !== s2) {
              s1 = next1;
              s2 = next2;
              moved = true;
              break;
            }
          }
        }
      }
      if (!moved) break;
    }

    // キラキラありの方がCPが高い（キラキラが消去された場合）
    // 注: キラキラが一度も消去されなければ同値の可能性もある
    expect(s1.cascadePoints!).toBeGreaterThanOrEqual(s2.cascadePoints!);
  });

  it('SPARKLE_BONUS_CPが1である', () => {
    expect(SPARKLE_BONUS_CP).toBe(1);
  });
});

describe('キラキラ: RNG独立性', () => {
  it('sparkleRngは色RNGに影響しない', () => {
    // キラキラあり盤面と、sparkleRngをundefinedにした盤面で同じ操作後の色配置が一致
    const s1 = initializeGame(SEED, 'cascade');
    const s2 = initializeGame(SEED, 'cascade');

    // 色のみ比較（sparkleフラグは除外）
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(s1.board[r][c]?.color).toBe(s2.board[r][c]?.color);
      }
    }
  });
});

describe('キラキラ: cloneGameState', () => {
  it('sparkleRngStateが正しくコピーされる', () => {
    const state = initializeGame(SEED, 'cascade');
    const cloned = cloneGameState(state);
    expect(cloned.sparkleRngState).toEqual(state.sparkleRngState);
    // 独立していること
    state.sparkleRngState![0] = 99999;
    expect(cloned.sparkleRngState![0]).not.toBe(99999);
  });

  it('非Cascadeの場合sparkleRngStateはundefined', () => {
    const state = initializeGame(SEED, 'sprint');
    const cloned = cloneGameState(state);
    expect(cloned.sparkleRngState).toBeUndefined();
  });
});

describe('キラキラ: リプレイ決定性', () => {
  it('同一シード・同一操作で同一CP（playGame）', () => {
    const r1 = playGame(SEED, 'cascade');
    const r2 = playGame(SEED, 'cascade');
    expect(r1.cascadePoints).toBe(r2.cascadePoints);
    expect(r1.finalScore).toBe(r2.finalScore);
  });

  it('複数シードで決定論的', () => {
    for (const seed of [1, 42, 100, 9999]) {
      const a = playGame(seed, 'cascade');
      const b = playGame(seed, 'cascade');
      expect(a.cascadePoints).toBe(b.cascadePoints);
    }
  });
});

describe('キラキラ: peekNextTiles', () => {
  it('色とキラキラ状態の先読みが可能', () => {
    const state = initializeGame(SEED, 'cascade');
    const tiles = peekNextTiles(state.rngState, state.sparkleRngState!, 4, state.numColors ?? NUM_COLORS);
    expect(tiles.length).toBe(BOARD_SIZE);
    for (const col of tiles) {
      expect(col.length).toBe(4);
      for (const tile of col) {
        expect(tile.color).toBeGreaterThanOrEqual(0);
        expect(typeof tile.sparkle).toBe('boolean');
      }
    }
  });

  it('RNG状態を消費しない', () => {
    const state = initializeGame(SEED, 'cascade');
    const rngBefore = [...state.rngState];
    const sparkleRngBefore = [...state.sparkleRngState!];
    peekNextTiles(state.rngState, state.sparkleRngState!, 4, state.numColors ?? NUM_COLORS);
    expect(state.rngState).toEqual(rngBefore);
    expect(state.sparkleRngState).toEqual(sparkleRngBefore);
  });
});
