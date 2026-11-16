import { Cell, Color, ItemType, Position, BOARD_SIZE, NUM_COLORS } from './types.js';
import { createRng, nextInt, mix32 } from './rng.js';

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

/** 列シードを撹拌するための黄金比定数（列ごとに異なる値を混ぜる） */
const COLUMN_SALT = 0x9e3779b9;

/**
 * メインRNGから列ごとの独立RNGシードを生成。
 *
 * `nextInt(rng, 0x7fffffff)` の戻り値は、raw が正の int32 のとき raw そのもの
 * （= xorshift の次の状態）になる。これを素の列シードにすると 8 列が
 * 「同じストリームを 1 ステップずつずらしただけ」になり、ある列が隣の列より
 * 1 回多く補充された時点で両者の状態が完全に一致してしまう。一致した列は
 * 以後ずっと同じ色を引くため、消しても同じ並びが補充され続けて自動消去
 * ループが終わらない（例: 2026-07-26 のシード 1161844543）。
 *
 * mix32 で撹拌し、列同士のストリーム上の距離を実質ランダムにすることで
 * この衝突を防ぐ。
 */
export function createColumnRngStates(rngState: number): number[] {
  let rng = rngState;
  const states: number[] = [];
  for (let col = 0; col < BOARD_SIZE; col++) {
    let seed: number;
    [rng, seed] = nextInt(rng, 0x7fffffff);
    states.push(createRng(mix32(seed ^ Math.imul(col + 1, COLUMN_SALT))));
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
export function fillEmptyCells(
  board: (Cell | null)[][],
  columnRngStates: number[],
): number[] {
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

/** gravity後にアイテムの新しい位置を探索。同列下方を優先し、見つからなければ盤面全体を走査。 */
export function findItemPosition(
  board: (Cell | null)[][],
  itemType: ItemType,
  origPos: Position,
): Position | null {
  for (let r = origPos.row; r < BOARD_SIZE; r++) {
    if (board[r][origPos.col]?.item === itemType) {
      return { row: r, col: origPos.col };
    }
  }
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c]?.item === itemType) {
        return { row: r, col: c };
      }
    }
  }
  return null;
}
