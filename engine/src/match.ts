import { Cell, Color, Match, Position, BOARD_SIZE } from './types.js';

/** マッチに参加できるセルか（アイテムとおじゃまタイルは参加しない） */
export function isMatchable(cell: Cell | null): cell is Cell {
  return cell !== null && !cell.item && !cell.obstacle;
}

/**
 * (row, col) を含むマッチ（縦横 3 つ以上の直線、または 2×2）があるか。findMatches と同じ規則。
 * cellAt で盤面の読み方を差し替えられる（入れ替えた後の盤面を、書き換えずに調べるため）
 */
export function hasMatchAt(
  row: number, col: number,
  cellAt: (row: number, col: number) => Cell | null,
): boolean {
  const colorAt = (r: number, c: number): Color | null => {
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return null;
    const cell = cellAt(r, c);
    return isMatchable(cell) ? cell.color : null;
  };
  const color = colorAt(row, col);
  if (color === null) return false;
  const same = (r: number, c: number) => colorAt(r, c) === color;

  let h = 1;
  for (let c = col - 1; same(row, c); c--) h++;
  for (let c = col + 1; same(row, c); c++) h++;
  if (h >= 3) return true;

  let v = 1;
  for (let r = row - 1; same(r, col); r--) v++;
  for (let r = row + 1; same(r, col); r++) v++;
  if (v >= 3) return true;

  // (row, col) を角に持つ 4 つの 2×2
  for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    if (same(row + dr, col) && same(row, col + dc) && same(row + dr, col + dc)) return true;
  }
  return false;
}

/** 盤面上の全マッチを検出（縦横3以上の直線） */
export function findMatches(board: (Cell | null)[][]): Match[] {
  const matches: Match[] = [];
  const visited = Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => ({ h: false, v: false }))
  );

  // 横方向のマッチ検出
  for (let row = 0; row < BOARD_SIZE; row++) {
    let col = 0;
    while (col < BOARD_SIZE) {
      const cell = board[row][col];
      if (!isMatchable(cell)) {
        col++;
        continue;
      }
      const color = cell.color;
      let end = col + 1;
      while (end < BOARD_SIZE) {
        const next = board[row][end];
        if (!isMatchable(next) || next.color !== color) break;
        end++;
      }
      const length = end - col;
      if (length >= 3) {
        const positions: Position[] = [];
        for (let c = col; c < end; c++) {
          positions.push({ row, col: c });
          visited[row][c].h = true;
        }
        matches.push({ positions, color });
      }
      col = end;
    }
  }

  // 2×2正方形マッチ検出
  for (let row = 0; row < BOARD_SIZE - 1; row++) {
    for (let col = 0; col < BOARD_SIZE - 1; col++) {
      const c00 = board[row][col];
      const c01 = board[row][col + 1];
      const c10 = board[row + 1][col];
      const c11 = board[row + 1][col + 1];
      if (
        isMatchable(c00) && isMatchable(c01) && isMatchable(c10) && isMatchable(c11) &&
        c00.color === c01.color &&
        c00.color === c10.color &&
        c00.color === c11.color
      ) {
        matches.push({
          positions: [
            { row, col }, { row, col: col + 1 },
            { row: row + 1, col }, { row: row + 1, col: col + 1 },
          ],
          color: c00.color,
          shape: '2x2',
        });
      }
    }
  }

  // 縦方向のマッチ検出
  for (let col = 0; col < BOARD_SIZE; col++) {
    let row = 0;
    while (row < BOARD_SIZE) {
      const cell = board[row][col];
      if (!isMatchable(cell)) {
        row++;
        continue;
      }
      const color = cell.color;
      let end = row + 1;
      while (end < BOARD_SIZE) {
        const next = board[end][col];
        if (!isMatchable(next) || next.color !== color) break;
        end++;
      }
      const length = end - row;
      if (length >= 3) {
        const positions: Position[] = [];
        for (let r = row; r < end; r++) {
          positions.push({ row: r, col });
          visited[r][col].v = true;
        }
        matches.push({ positions, color });
      }
      row = end;
    }
  }

  return matches;
}

/** マッチが存在するかチェック */
export function hasMatches(board: (Cell | null)[][]): boolean {
  return findMatches(board).length > 0;
}

/** 重複する位置を除いた消去対象リストを取得 */
export function getUniquePositions(matches: Match[]): Position[] {
  const seen = new Set<string>();
  const result: Position[] = [];
  for (const match of matches) {
    for (const pos of match.positions) {
      const key = `${pos.row},${pos.col}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(pos);
      }
    }
  }
  return result;
}
