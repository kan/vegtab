import { describe, it, expect } from 'vitest';
import { findMatches, getUniquePositions, hasMatches } from '../src/match.js';
import { Cell, Color, BOARD_SIZE } from '../src/types.js';

function makeBoard(colors: number[][]): (Cell | null)[][] {
  return colors.map(row => row.map(c => c === -1 ? null : { color: c as Color }));
}

function emptyBoard(): (Cell | null)[][] {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => ({ color: 0 as Color }))
  );
}

describe('Match Detection', () => {
  it('横3つのマッチを検出する', () => {
    const board = emptyBoard();
    // row 0: 色1, 1, 1, 0, 0, 0, 0, 0
    board[0][0] = { color: 1 };
    board[0][1] = { color: 1 };
    board[0][2] = { color: 1 };
    const matches = findMatches(board);
    // row0の色0の連続5つも含む
    expect(matches.length).toBeGreaterThanOrEqual(1);
    const match1 = matches.find(m => m.color === 1);
    expect(match1).toBeDefined();
    expect(match1!.positions.length).toBe(3);
  });

  it('縦3つのマッチを検出する', () => {
    const board = emptyBoard();
    board[0][0] = { color: 2 };
    board[1][0] = { color: 2 };
    board[2][0] = { color: 2 };
    // 他は色0
    const matches = findMatches(board);
    const match2 = matches.find(m => m.color === 2 && m.positions.every(p => p.col === 0));
    expect(match2).toBeDefined();
    expect(match2!.positions.length).toBe(3);
  });

  it('マッチがない盤面ではfalseを返す', () => {
    // チェッカーボード的にマッチなし
    const board: (Cell | null)[][] = Array.from({ length: BOARD_SIZE }, (_, r) =>
      Array.from({ length: BOARD_SIZE }, (_, c) => ({
        color: ((r + c) % 3) as Color,
      }))
    );
    expect(hasMatches(board)).toBe(false);
  });

  it('5つ以上の連続マッチを正しく検出する', () => {
    const board: (Cell | null)[][] = Array.from({ length: BOARD_SIZE }, () =>
      Array.from({ length: BOARD_SIZE }, () => ({ color: 1 as Color }))
    );
    // 全部色1なので多数のマッチ
    const matches = findMatches(board);
    expect(matches.length).toBeGreaterThan(0);
    // 横マッチは各行で8個の連続
    const hMatch = matches.find(m => m.positions.length === BOARD_SIZE && m.positions.every(p => p.row === 0));
    expect(hMatch).toBeDefined();
  });

  it('getUniquePositions が重複を除去する', () => {
    const matches = [
      { positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }], color: 0 as Color },
      { positions: [{ row: 0, col: 0 }, { row: 1, col: 0 }, { row: 2, col: 0 }], color: 0 as Color },
    ];
    const unique = getUniquePositions(matches);
    expect(unique.length).toBe(5); // (0,0)は1回だけ
  });

  it('2×2正方形マッチを検出する', () => {
    const board = emptyBoard();
    // 左上2×2を色2にする
    board[0][0] = { color: 2 };
    board[0][1] = { color: 2 };
    board[1][0] = { color: 2 };
    board[1][1] = { color: 2 };
    const matches = findMatches(board);
    const match2x2 = matches.find(m => m.shape === '2x2' && m.color === 2);
    expect(match2x2).toBeDefined();
    expect(match2x2!.positions.length).toBe(4);
  });

  it('2×2マッチは4つのセルの色が全て同じ場合のみ成立する', () => {
    const board = emptyBoard();
    board[0][0] = { color: 2 };
    board[0][1] = { color: 2 };
    board[1][0] = { color: 2 };
    board[1][1] = { color: 3 }; // 1マスだけ違う色
    const matches = findMatches(board);
    const match2x2 = matches.find(m => m.shape === '2x2' && m.color === 2);
    expect(match2x2).toBeUndefined();
  });

  it('2×2マッチとアイテムセルは共存しない', () => {
    const board = emptyBoard();
    board[0][0] = { color: 2 };
    board[0][1] = { color: 2 };
    board[1][0] = { color: 2 };
    board[1][1] = { color: 2, item: 'v_cut' };
    const matches = findMatches(board);
    const match2x2 = matches.find(m => m.shape === '2x2' && m.color === 2);
    expect(match2x2).toBeUndefined();
  });

  it('アイテムセルはマッチに含まれない', () => {
    const board = emptyBoard();
    board[0][0] = { color: 1 };
    board[0][1] = { color: 1, item: 'v_cut' };
    board[0][2] = { color: 1 };
    // アイテムがあるのでマッチは成立しない
    const color1Matches = findMatches(board).filter(m => m.color === 1);
    expect(color1Matches.length).toBe(0);
  });

  it('おじゃまタイルは横マッチ検出から除外される', () => {
    const board = emptyBoard();
    // row 0: 色1, obstacle(色1), 色1, ... (残りは色0)
    board[0][0] = { color: 1 };
    board[0][1] = { color: 1, obstacle: { durability: 1 } };
    board[0][2] = { color: 1 };
    const color1Matches = findMatches(board).filter(m => m.color === 1);
    // おじゃまタイルが間にあるのでマッチしない
    expect(color1Matches.length).toBe(0);
  });

  it('おじゃまタイルは縦マッチ検出から除外される', () => {
    const board = emptyBoard();
    board[0][0] = { color: 2 };
    board[1][0] = { color: 2, obstacle: { durability: 2 } };
    board[2][0] = { color: 2 };
    const color2VertMatches = findMatches(board).filter(
      m => m.color === 2 && m.positions.every(p => p.col === 0)
    );
    expect(color2VertMatches.length).toBe(0);
  });

  it('おじゃまタイルは2x2マッチ検出から除外される', () => {
    const board = emptyBoard();
    board[0][0] = { color: 3 };
    board[0][1] = { color: 3 };
    board[1][0] = { color: 3 };
    board[1][1] = { color: 3, obstacle: { durability: 1 } };
    const match2x2 = findMatches(board).find(m => m.shape === '2x2' && m.color === 3);
    expect(match2x2).toBeUndefined();
  });
});
