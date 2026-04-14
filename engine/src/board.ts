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

// --- キラキラ野菜定数 ---
const SPARKLE_SALT = 0x5A4B3C2D;
const SPARKLE_INIT_SALT = 0x1A2B3C4D;
export const SPARKLE_PROBABILITY = 10;
export const INITIAL_SPARKLE_COUNT = 2;
export const SPARKLE_BONUS_CP = 1;

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

/** キラキラ判定用の列ごと独立RNGを生成（色RNGとは完全に独立） */
export function createSparkleRngStates(seed: number): number[] {
  const mainRng = createRng(seed ^ SPARKLE_SALT);
  return createColumnRngStates(mainRng);
}

/** 盤面に初期キラキラを配置（自動消去後の安定盤面に対して実行） */
export function placeInitialSparkles(board: (Cell | null)[][], seed: number): void {
  let rng = createRng(seed ^ SPARKLE_INIT_SALT);

  // 非nullセル位置を収集
  const positions: { row: number; col: number }[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c]) positions.push({ row: r, col: c });
    }
  }

  // Fisher-Yates で先頭 INITIAL_SPARKLE_COUNT 個を選出
  const count = Math.min(INITIAL_SPARKLE_COUNT, positions.length);
  for (let i = 0; i < count; i++) {
    let j: number;
    [rng, j] = nextInt(rng, positions.length - i);
    j += i;
    [positions[i], positions[j]] = [positions[j], positions[i]];
    board[positions[i].row][positions[i].col]!.sparkle = true;
  }
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
export function fillEmptyCells(
  board: (Cell | null)[][],
  columnRngStates: number[],
  numColors: number = NUM_COLORS,
  sparkleRngStates?: number[],
): number[] {
  const states = [...columnRngStates];
  for (let col = 0; col < BOARD_SIZE; col++) {
    let rng = states[col];
    for (let row = 0; row < BOARD_SIZE; row++) {
      if (board[row][col] === null) {
        let color: Color;
        [rng, color] = nextColor(rng, numColors);
        const cell: Cell = { color };
        // キラキラ判定（独立RNG）
        if (sparkleRngStates) {
          let sVal: number;
          [sparkleRngStates[col], sVal] = nextInt(sparkleRngStates[col], 100);
          if (sVal < SPARKLE_PROBABILITY) cell.sparkle = true;
        }
        board[row][col] = cell;
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

/**
 * 各列の次に落ちてくるタイルの色とキラキラ状態を先読みする（RNG状態を消費しない）。
 */
export function peekNextTiles(
  columnRngStates: number[],
  sparkleRngStates: number[],
  count: number,
  numColors: number = NUM_COLORS,
): { color: Color; sparkle: boolean }[][] {
  const result: { color: Color; sparkle: boolean }[][] = [];
  for (let col = 0; col < BOARD_SIZE; col++) {
    const tiles: { color: Color; sparkle: boolean }[] = [];
    let rng = columnRngStates[col];
    let sRng = sparkleRngStates[col];
    for (let i = 0; i < count; i++) {
      let color: Color;
      [rng, color] = nextColor(rng, numColors);
      let sVal: number;
      [sRng, sVal] = nextInt(sRng, 100);
      tiles.push({ color, sparkle: sVal < SPARKLE_PROBABILITY });
    }
    result.push(tiles);
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
