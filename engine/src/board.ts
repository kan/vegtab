import { Cell, Color, Position, BOARD_SIZE, NUM_COLORS } from './types.js';
import { createRng, nextInt } from './rng.js';

/** 新しいランダムな色を生成 */
export function nextColor(rngState: number): [number, Color] {
  const [next, value] = nextInt(rngState, NUM_COLORS);
  return [next, value as Color];
}

/** 空の盤面を作成 */
export function createEmptyBoard(): (Cell | null)[][] {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => null)
  );
}

/** メインRNGから列ごとの独立RNGシードを生成 */
export function createColumnRngStates(rngState: number): number[] {
  let rng = rngState;
  const states: number[] = [];
  for (let col = 0; col < BOARD_SIZE; col++) {
    let seed: number;
    [rng, seed] = nextInt(rng, 0x7fffffff);
    states.push(createRng(seed));
  }
  return states;
}

/** シード値から初期盤面を生成（自動消去前） */
export function generateRawBoard(seed: number): { board: (Cell | null)[][]; rngState: number } {
  let rng = createRng(seed);
  const board = createEmptyBoard();
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      let color: Color;
      [rng, color] = nextColor(rng);
      board[row][col] = { color };
    }
  }
  return { board, rngState: rng };
}

/**
 * 盤面上の空きマスを列ごとのRNGストリームで補充する。
 * 各列の補充タイル列はシードにより一意に決まる（操作順に依存しない）。
 */
export function fillEmptyCells(board: (Cell | null)[][], columnRngStates: number[]): number[] {
  const states = [...columnRngStates];
  for (let col = 0; col < BOARD_SIZE; col++) {
    let rng = states[col];
    for (let row = 0; row < BOARD_SIZE; row++) {
      if (board[row][col] === null) {
        let color: Color;
        [rng, color] = nextColor(rng);
        board[row][col] = { color };
      }
    }
    states[col] = rng;
  }
  return states;
}

/** 盤面のディープコピー */
export function cloneBoard(board: (Cell | null)[][]): (Cell | null)[][] {
  return board.map(row => row.map(cell =>
    cell === null ? null : { ...cell, obstacle: cell.obstacle ? { ...cell.obstacle } : undefined }
  ));
}

/** 指定位置のセルを取得 */
export function getCell(board: (Cell | null)[][], pos: Position): Cell | null {
  if (pos.row < 0 || pos.row >= BOARD_SIZE || pos.col < 0 || pos.col >= BOARD_SIZE) {
    return null;
  }
  return board[pos.row][pos.col];
}

/** 位置が盤面内かチェック */
export function isValidPosition(pos: Position): boolean {
  return pos.row >= 0 && pos.row < BOARD_SIZE && pos.col >= 0 && pos.col < BOARD_SIZE;
}
