import { Cell, Color, Match, Position, BOARD_SIZE } from './types.js';

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
      if (cell === null || cell.item || cell.obstacle) {
        col++;
        continue;
      }
      const color = cell.color;
      let end = col + 1;
      while (end < BOARD_SIZE) {
        const next = board[row][end];
        if (next === null || next.item || next.obstacle || next.color !== color) break;
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
        c00 && !c00.item && !c00.obstacle &&
        c01 && !c01.item && !c01.obstacle &&
        c10 && !c10.item && !c10.obstacle &&
        c11 && !c11.item && !c11.obstacle &&
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
      if (cell === null || cell.item || cell.obstacle) {
        row++;
        continue;
      }
      const color = cell.color;
      let end = row + 1;
      while (end < BOARD_SIZE) {
        const next = board[end][col];
        if (next === null || next.item || next.obstacle || next.color !== color) break;
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
