import { Cell, Color, Obstacle, Position, BOARD_SIZE } from './types.js';
import { createRng, nextInt } from './rng.js';

/**
 * 盤面上におじゃまタイルを生成する
 * @param board 自動消去済みの盤面
 * @param columnRngStates 列ごとRNG状態（おじゃま生成用に先頭列のRNGから派生）
 * @param count おじゃまタイルの数（省略時: 10-20のランダム）
 * @returns 更新された盤面と更新されたRNG状態
 */
export function generateObstacles(
  board: (Cell | null)[][],
  columnRngStates: number[],
  count?: number,
): { board: (Cell | null)[][]; rngState: number[] } {
  // おじゃま配置用に列RNGの先頭から専用RNGを派生
  let [derivedSeed] = nextInt(columnRngStates[0], 0x7fffffff);
  let rng = createRng(derivedSeed);
  // 先頭列のRNGも進める（派生で1回消費）
  const newStates = [...columnRngStates];
  newStates[0] = derivedSeed;

  // デフォルト数: 10-20
  let obstacleCount: number;
  if (count !== undefined) {
    obstacleCount = count;
  } else {
    let val: number;
    [rng, val] = nextInt(rng, 11); // 0-10
    obstacleCount = val + 10; // 10-20
  }

  // 全64マスの位置をFisher-Yatesシャッフル
  const positions: Position[] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      positions.push({ row, col });
    }
  }

  // Fisher-Yates shuffle
  for (let i = positions.length - 1; i > 0; i--) {
    let j: number;
    [rng, j] = nextInt(rng, i + 1);
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }

  // 先頭からobstacleCount個を選択
  const selected = positions.slice(0, obstacleCount);

  for (const pos of selected) {
    // 耐久値の決定: nextInt(rng, 6) → 0-2=dur1(50%), 3-4=dur2(33%), 5=dur3(17%)
    let val: number;
    [rng, val] = nextInt(rng, 6);
    let durability: number;
    if (val <= 2) durability = 1;
    else if (val <= 4) durability = 2;
    else durability = 3;

    const existingCell = board[pos.row][pos.col];
    const color: Color = existingCell ? existingCell.color : 0;
    board[pos.row][pos.col] = { color, obstacle: { durability } };
  }

  return { board, rngState: newStates };
}

/** おじゃまタイルの数をカウント */
export function countObstacles(board: (Cell | null)[][]): number {
  let count = 0;
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row][col]?.obstacle) count++;
    }
  }
  return count;
}

/** 全おじゃまタイルが除去されたか（最初の1つ見つかった時点でfalse） */
export function allObstaclesCleared(board: (Cell | null)[][]): boolean {
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row][col]?.obstacle) return false;
    }
  }
  return true;
}

/**
 * 指定位置のおじゃまタイルに1ダメージを与える。
 * 耐久値が0になったらセルをnullにする。
 * @returns 破壊された場合true
 */
export function damageObstacleAt(board: (Cell | null)[][], pos: Position): boolean {
  const cell = board[pos.row]?.[pos.col];
  if (!cell?.obstacle) return false;
  cell.obstacle.durability--;
  if (cell.obstacle.durability <= 0) {
    board[pos.row][pos.col] = null;
    return true;
  }
  return false;
}

/**
 * 盤上の全おじゃまタイルに1ダメージを与える。
 * 耐久値が0になったおじゃまタイルはnullに置き換える。
 * @returns damaged: ダメージを受けた全位置, destroyed: 破壊された位置
 */
export function damageAllObstacles(board: (Cell | null)[][]): { damaged: Position[]; destroyed: Position[] } {
  const damaged: Position[] = [];
  const destroyed: Position[] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = board[row][col];
      if (!cell?.obstacle) continue;
      damaged.push({ row, col });
      cell.obstacle.durability--;
      if (cell.obstacle.durability <= 0) {
        board[row][col] = null;
        destroyed.push({ row, col });
      }
    }
  }
  return { damaged, destroyed };
}

/**
 * おじゃまタイルにダメージを与える
 * 消去された位置の上下左右のおじゃまタイルの耐久値を1減らす
 * 耐久値が0になったおじゃまタイルはnullに置き換える
 * @returns 破壊されたおじゃまタイルの位置リスト
 */
export function damageObstacles(
  board: (Cell | null)[][],
  clearedPositions: Position[],
): Position[] {
  const damaged = new Set<string>();
  const destroyedPositions: Position[] = [];
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  for (const pos of clearedPositions) {
    for (const [dr, dc] of directions) {
      const nr = pos.row + dr;
      const nc = pos.col + dc;
      if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
      const key = `${nr},${nc}`;
      if (damaged.has(key)) continue;

      if (board[nr][nc]?.obstacle) {
        damaged.add(key);
        const adjPos = { row: nr, col: nc };
        if (damageObstacleAt(board, adjPos)) {
          destroyedPositions.push(adjPos);
        }
      }
    }
  }

  return destroyedPositions;
}
