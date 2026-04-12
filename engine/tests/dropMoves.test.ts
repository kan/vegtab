import { describe, it, expect } from 'vitest';
import { computeDropMoves } from '../src/dropMoves.js';
import { BOARD_SIZE, Cell, Color } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 全セル null の盤面を生成 */
function emptyBoard(): (Cell | null)[][] {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
}

/** 全セルを色 0 で埋めた盤面を生成 */
function fullBoard(): (Cell | null)[][] {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => ({ color: 0 as Color })),
  );
}

// ---------------------------------------------------------------------------
// computeDropMoves 基本テスト
// ---------------------------------------------------------------------------
describe('computeDropMoves', () => {
  it('全セルが埋まっている盤面では移動もnewTileEntryもゼロ', () => {
    const board = fullBoard();
    const { moves, newTileEntries } = computeDropMoves(board);
    expect(moves).toHaveLength(0);
    expect(newTileEntries).toHaveLength(0);
  });

  it('全セルが null の盤面では移動ゼロ・newTileEntries が全セル分', () => {
    const board = emptyBoard();
    const { moves, newTileEntries } = computeDropMoves(board);
    expect(moves).toHaveLength(0);
    // 各列で BOARD_SIZE 個の newTileEntry
    expect(newTileEntries).toHaveLength(BOARD_SIZE * BOARD_SIZE);
  });

  it('列上部に null があるとタイルが落下する', () => {
    const board = fullBoard();
    // col=0 の row=0 を null にする -> row=0 が空いて上からタイルが落下するはず
    board[0][0] = null;
    const { moves, newTileEntries } = computeDropMoves(board);
    // col=0 の残りの BOARD_SIZE-1 個のタイルはすべて1行下に落下する
    // ただし row=0 が空いた場合、row=1,2,...,BOARD_SIZE-1 のタイルが 1 行上に移動するのではなく
    // 実際は「上に null がある」なので下方向の重力では移動しない
    // -> 実装を再確認: 重力は "下に落下" なので row=0 (上) が null の場合...
    // computeDropMoves は gravity 適用前の board から計算する
    // null は上にあるとき、下のタイルは移動しない。上のタイルは下に落ちる。
    // row=0 が null で row=1..7 がタイルの場合、移動は発生しない（下が埋まっている）
    // => newTileEntry が row=0 に 1 つ
    expect(newTileEntries).toHaveLength(1);
    expect(newTileEntries[0]).toEqual({ row: 0, col: 0, segNulls: 1 });
    expect(moves).toHaveLength(0);
  });

  it('列下部に null があるとタイルが下方向に落下する', () => {
    const board = fullBoard();
    // col=2 の最下行を null にする
    board[BOARD_SIZE - 1][2] = null;
    const { moves, newTileEntries } = computeDropMoves(board);
    // row=0..BOARD_SIZE-2 のタイルが 1 行ずつ下に移動
    const colMoves = moves.filter(m => m.col === 2);
    expect(colMoves).toHaveLength(BOARD_SIZE - 1);
    for (const m of colMoves) {
      expect(m.toRow).toBe(m.fromRow + 1);
    }
    // newTileEntry は row=0 に 1 つ
    const colEntries = newTileEntries.filter(e => e.col === 2);
    expect(colEntries).toHaveLength(1);
    expect(colEntries[0].row).toBe(0);
  });

  it('中間に null がある場合、その下のタイルは移動せず上のタイルが落下する', () => {
    const board = fullBoard();
    // col=3 の row=4 を null にする
    board[4][3] = null;
    const { moves, newTileEntries } = computeDropMoves(board);
    const colMoves = moves.filter(m => m.col === 3);
    // row=0..3 の4つのタイルが1行ずつ下に移動
    expect(colMoves).toHaveLength(4);
    for (const m of colMoves) {
      expect(m.fromRow).toBeLessThan(4);
      expect(m.toRow).toBe(m.fromRow + 1);
    }
  });

  // ---------------------------------------------------------------------------
  // おじゃまタイル（セグメントバリア）
  // ---------------------------------------------------------------------------
  describe('おじゃまタイル（segment barrier モード）', () => {
    it('おじゃまタイルの上下でセグメントが分離される', () => {
      const board = fullBoard();
      // row=3, col=1 におじゃまタイルを配置
      board[3][1] = { color: 0 as Color, obstacle: { durability: 1 } };
      // row=5 を null にする（おじゃまの下セグメント内）
      board[5][1] = null;

      const { moves } = computeDropMoves(board, false);
      // col=1 のおじゃまの下セグメント（row=4..7）内で row=4 が row=5 に落下
      const colMoves = moves.filter(m => m.col === 1);
      expect(colMoves).toHaveLength(1);
      expect(colMoves[0].fromRow).toBe(4);
      expect(colMoves[0].toRow).toBe(5);
    });

    it('おじゃまタイル自体は移動しない', () => {
      const board = fullBoard();
      board[3][0] = { color: 0 as Color, obstacle: { durability: 2 } };
      board[BOARD_SIZE - 1][0] = null;

      const { moves } = computeDropMoves(board, false);
      // おじゃまタイル (row=3) は移動リストに含まれない
      const obsMove = moves.find(m => m.col === 0 && m.fromRow === 3);
      expect(obsMove).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // passThroughObstacles モード
  // ---------------------------------------------------------------------------
  describe('passThroughObstacles=true', () => {
    it('おじゃまタイルを固定して通常タイルがすり抜け落下する', () => {
      const board = fullBoard();
      // row=2, col=0 におじゃまタイル
      board[2][0] = { color: 0 as Color, obstacle: { durability: 1 } };
      // row=6 を null にする
      board[6][0] = null;

      const { moves } = computeDropMoves(board, true);
      // おじゃまタイル（row=2）は freeRows に含まれないので移動しない
      const obsMove = moves.find(m => m.col === 0 && m.fromRow === 2);
      expect(obsMove).toBeUndefined();
      // row=6 の null を埋めるために上のフリータイルが1つ下にずれる
      expect(moves.length).toBeGreaterThan(0);
    });

    it('おじゃまタイルが存在しない列では通常と同じ動作', () => {
      const board = fullBoard();
      board[BOARD_SIZE - 1][3] = null;
      const result1 = computeDropMoves(board, false);
      // 再作成（computeDropMoves は board を変更しないが念のため）
      const board2 = fullBoard();
      board2[BOARD_SIZE - 1][3] = null;
      const result2 = computeDropMoves(board2, true);

      const col3Moves1 = result1.moves.filter(m => m.col === 3);
      const col3Moves2 = result2.moves.filter(m => m.col === 3);
      expect(col3Moves1).toEqual(col3Moves2);
    });
  });

  // ---------------------------------------------------------------------------
  // エッジケース
  // ---------------------------------------------------------------------------
  it('複数列に null がある場合、各列独立に計算される', () => {
    const board = fullBoard();
    board[BOARD_SIZE - 1][0] = null;
    board[BOARD_SIZE - 1][BOARD_SIZE - 1] = null;
    const { moves } = computeDropMoves(board);
    const col0Moves = moves.filter(m => m.col === 0);
    const colLastMoves = moves.filter(m => m.col === BOARD_SIZE - 1);
    expect(col0Moves.length).toBe(BOARD_SIZE - 1);
    expect(colLastMoves.length).toBe(BOARD_SIZE - 1);
  });

  it('連続した null がある場合、タイルが複数行落下する', () => {
    const board = fullBoard();
    // col=1 の下2行を null にする
    board[BOARD_SIZE - 1][1] = null;
    board[BOARD_SIZE - 2][1] = null;
    const { moves, newTileEntries } = computeDropMoves(board);
    const colMoves = moves.filter(m => m.col === 1);
    // 各タイルは 2 行落下
    for (const m of colMoves) {
      expect(m.toRow - m.fromRow).toBe(2);
    }
    const colEntries = newTileEntries.filter(e => e.col === 1);
    expect(colEntries).toHaveLength(2);
    expect(colEntries[0].segNulls).toBe(2);
  });
});
