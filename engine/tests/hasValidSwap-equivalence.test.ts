import { describe, it, expect } from 'vitest';
import { hasValidSwap } from '../src/gameOver.js';
import { findMatches } from '../src/match.js';
import { cloneBoard } from '../src/board.js';
import { createRng, nextInt } from '../src/rng.js';
import { initializeGame, processAction } from '../src/engine.js';
import { Cell, Color, ItemType, BOARD_SIZE } from '../src/types.js';

/**
 * #87 で書き換える前の hasValidSwap（候補ペアごとに盤面を複製し、全体のマッチを調べる）。
 * 書き換えた実装と結果が一致することを確かめるための参照実装
 */
function referenceHasValidSwap(board: (Cell | null)[][]): boolean {
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = board[row][col];
      if (cell === null) continue;
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const nr = row + dr;
        const nc = col + dc;
        if (nr >= BOARD_SIZE || nc >= BOARD_SIZE) continue;
        const neighbor = board[nr][nc];
        if (neighbor === null) continue;
        if (cell.obstacle && neighbor.obstacle) continue;
        if (cell.obstacle || neighbor.obstacle) {
          const nonObstacle = cell.obstacle ? neighbor : cell;
          if (nonObstacle.item && nonObstacle.item !== 'scope') return true;
          if (!nonObstacle.item) {
            const t = cloneBoard(board);
            t[row][col] = { ...neighbor };
            t[nr][nc] = { ...cell };
            if (findMatches(t).length > 0) return true;
          }
          continue;
        }
        if (cell.item || neighbor.item) return true;
        const t = cloneBoard(board);
        t[row][col] = { ...neighbor };
        t[nr][nc] = { ...cell };
        if (findMatches(t).length > 0) return true;
      }
    }
  }
  return false;
}

const ITEMS: ItemType[] = ['scope', 'v_cut', 'h_cut', 'burst', 'flush'];

/** シード付きのランダムな盤面。itemRate / obstacleRate は 0〜100 の割合 */
function randomBoard(seed: number, opts: { colors: number; itemRate: number; obstacleRate: number; nullRate?: number }) {
  let rng = createRng(seed);
  const roll = (n: number) => { let v: number; [rng, v] = nextInt(rng, n); return v; };
  return Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, (): Cell | null => {
    if (opts.nullRate && roll(100) < opts.nullRate) return null;
    const color = roll(opts.colors) as Color;
    const kind = roll(100);
    if (kind < opts.obstacleRate) return { color, obstacle: { durability: 1 + roll(3) } };
    if (kind < opts.obstacleRate + opts.itemRate) return { color, item: ITEMS[roll(ITEMS.length)] };
    return { color };
  }));
}

function expectSameAsReference(board: (Cell | null)[][]) {
  const before = JSON.stringify(board);
  expect(hasValidSwap(board)).toBe(referenceHasValidSwap(board));
  // 判定は盤面を書き換えない
  expect(JSON.stringify(board)).toBe(before);
}

describe('hasValidSwap: 書き換え前の実装と同じ結果になる', () => {
  it('実際のゲームの盤面（200 シード × 数手）', () => {
    for (let seed = 1; seed <= 200; seed++) {
      let s = initializeGame(seed);
      expectSameAsReference(s.board);
      for (let k = 0; k < 6 && !s.isGameOver; k++) {
        let moved = false;
        for (let r = 0; r < BOARD_SIZE && !moved; r++) {
          for (let c = 0; c < BOARD_SIZE && !moved; c++) {
            for (const dir of ['right', 'down'] as const) {
              const n = processAction(s, { type: 'swap', pos: { row: r, col: c }, dir });
              if (n !== s) { s = n; moved = true; break; }
            }
          }
        }
        expectSameAsReference(s.board);
      }
    }
  });

  it('マッチの無い詰みに近い盤面（アイテムなし、おじゃまが多い）', () => {
    // おじゃまを多くすると有効手の無い盤面が混ざる（true と false の両方を確かめる）
    const results = new Set<boolean>();
    for (let seed = 1; seed <= 3000; seed++) {
      const board = randomBoard(seed, { colors: 5, itemRate: 0, obstacleRate: 55 });
      if (findMatches(board).length > 0) continue;
      expectSameAsReference(board);
      results.add(hasValidSwap(board));
    }
    expect(results).toEqual(new Set([true, false]));
  });

  it('アイテム・おじゃま・空きマスが混ざった盤面と、マッチが残っている盤面', () => {
    let unstable = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      const board = randomBoard(seed, { colors: 3 + (seed % 3), itemRate: seed % 3 === 0 ? 4 : 0, obstacleRate: 15, nullRate: 3 });
      if (findMatches(board).length > 0) unstable++;
      expectSameAsReference(board);
    }
    // マッチが残っている盤面（複製して全体を調べる経路）も確かめている
    expect(unstable).toBeGreaterThan(100);
  });
});
