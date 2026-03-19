import { Cell, Color, ItemType, Position, BOARD_SIZE, NUM_COLORS } from './types.js';
import { createRng, nextInt } from './rng.js';

/** 新しいランダムな色を生成 */
export function nextColor(rngState: number, numColors: number = NUM_COLORS): [number, Color] {
  const [next, value] = nextInt(rngState, numColors);
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
export function generateRawBoard(seed: number, numColors: number = NUM_COLORS): { board: (Cell | null)[][]; rngState: number } {
  let rng = createRng(seed);
  const board = createEmptyBoard();
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      let color: Color;
      [rng, color] = nextColor(rng, numColors);
      board[row][col] = { color };
    }
  }
  return { board, rngState: rng };
}

/**
 * 盤面上の空きマスを列ごとのRNGストリームで補充する。
 * 各列の補充タイル列はシードにより一意に決まる（操作順に依存しない）。
 */
export function fillEmptyCells(board: (Cell | null)[][], columnRngStates: number[], numColors: number = NUM_COLORS): number[] {
  const states = [...columnRngStates];
  for (let col = 0; col < BOARD_SIZE; col++) {
    let rng = states[col];
    for (let row = 0; row < BOARD_SIZE; row++) {
      if (board[row][col] === null) {
        let color: Color;
        [rng, color] = nextColor(rng, numColors);
        board[row][col] = { color };
      }
    }
    states[col] = rng;
  }
  return states;
}

/**
 * 各列の次に落ちてくるタイルの色を先読みする（RNG状態を消費しない）。
 * @returns Color[BOARD_SIZE][count] — 各列の次count個の色
 */
export function peekNextColors(
  columnRngStates: number[],
  count: number,
  numColors: number = NUM_COLORS,
): Color[][] {
  const result: Color[][] = [];
  for (let col = 0; col < BOARD_SIZE; col++) {
    const colors: Color[] = [];
    let rng = columnRngStates[col];
    for (let i = 0; i < count; i++) {
      let color: Color;
      [rng, color] = nextColor(rng, numColors);
      colors.push(color);
    }
    result.push(colors);
  }
  return result;
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
