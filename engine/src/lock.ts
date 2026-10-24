import { Cell, LockParams, Position, BOARD_SIZE } from './types.js';
import { createRng, nextInt } from './rng.js';

/**
 * 鎖のモードの試作（#107）。コードでは「連鎖（chain）」と区別するため、鎖を lock と呼ぶ。
 * 鎖の付いた野菜は入れ替えできず、落下しない（ほかのタイルはすり抜けて落ちる）。
 * 同じ色のマッチに入るか、アイテムの効果範囲に入ると鎖が 1 段外れ、野菜はその場に残る。
 * おじゃまと違い、隣でマッチしても外れない
 */

/** 入れ替えできないセルか（鎖の付いた野菜） */
export function isImmovable(cell: Cell | null | undefined): boolean {
  return !!cell?.lock;
}

/** 落下しないセルか（おじゃまタイルと、鎖の付いた野菜） */
export function isPinned(cell: Cell | null): boolean {
  return !!cell && (!!cell.obstacle || !!cell.lock);
}

/**
 * 盤面に鎖を置く。位置と 2 段にする野菜はシードから決める
 * @param board 自動消去済みの盤面（おじゃまタイルは無い前提）
 * @param columnRngStates 列ごとの RNG の状態（鎖の配置用に先頭列の RNG から派生させる）
 */
export function generateLocks(
  board: (Cell | null)[][],
  columnRngStates: number[],
  params: LockParams,
): { board: (Cell | null)[][]; rngState: number[] } {
  const [derivedSeed] = nextInt(columnRngStates[0], 0x7fffffff);
  let rng = createRng(derivedSeed);
  const newStates = [...columnRngStates];
  newStates[0] = derivedSeed;

  const positions: Position[] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = board[row][col];
      if (cell && !cell.item && !cell.obstacle) positions.push({ row, col });
    }
  }
  for (let i = positions.length - 1; i > 0; i--) {
    let j: number;
    [rng, j] = nextInt(rng, i + 1);
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }

  const count = Math.min(params.count, positions.length);
  for (let i = 0; i < count; i++) {
    const { row, col } = positions[i];
    board[row][col]!.lock = i < params.double ? 2 : 1;
  }
  return { board, rngState: newStates };
}

/** 鎖の段数の合計 */
export function countLockLayers(board: (Cell | null)[][]): number {
  let n = 0;
  for (const row of board) for (const cell of row) n += cell?.lock ?? 0;
  return n;
}

/** 鎖の付いた野菜の数 */
export function countLocks(board: (Cell | null)[][]): number {
  let n = 0;
  for (const row of board) for (const cell of row) if (cell?.lock) n++;
  return n;
}

/** 鎖が 1 つも残っていないか */
export function allLocksCleared(board: (Cell | null)[][]): boolean {
  for (const row of board) for (const cell of row) if (cell?.lock) return false;
  return true;
}

/**
 * pos の野菜に鎖があれば 1 段外す（野菜は残る）
 * @returns 鎖があったか（あったときは、呼び出し側で野菜を消さない）
 */
export function hitLock(board: (Cell | null)[][], pos: Position): boolean {
  const cell = board[pos.row]?.[pos.col];
  if (!cell?.lock) return false;
  if (cell.lock > 1) cell.lock--;
  else delete cell.lock;
  return true;
}

/**
 * マッチした位置を消す。鎖の付いた野菜は消さずに鎖を 1 段外す
 * @returns 実際に消した位置（鎖を外しただけの位置は含めない）
 */
export function clearMatchedPositions(board: (Cell | null)[][], positions: Position[]): Position[] {
  const cleared: Position[] = [];
  for (const pos of positions) {
    if (hitLock(board, pos)) continue;
    board[pos.row][pos.col] = null;
    cleared.push(pos);
  }
  return cleared;
}
