import { Cell, ItemType, Match, Position, BOARD_SIZE } from './types.js';
import { isValidPosition } from './board.js';

/**
 * マッチパターンからアイテム生成を判定
 * 優先順: コーヒーカップ > クリップ > カッター = はさみ
 */
export function determineItem(match: Match): ItemType | null {
  const positions = match.positions;
  const len = positions.length;

  if (len < 4) return null;

  // 直線判定
  const isHorizontal = positions.every(p => p.row === positions[0].row);
  const isVertical = positions.every(p => p.col === positions[0].col);
  const isStraight = isHorizontal || isVertical;

  if (len >= 5 && isStraight) return 'coffee';
  if (len >= 5) return 'clip'; // 5以上の非直線
  // len === 4
  if (isHorizontal) return 'scissors'; // 横4 → はさみ（縦一列消去）
  if (isVertical) return 'cutter'; // 縦4 → カッター（横一列消去）
  return 'clip'; // 4マスの非直線（L字等）→ クリップ
}

/**
 * 複数のマッチから最も優先度の高いアイテムを1つ決定
 * swapOriginがある場合はスワイプ起点位置に配置
 */
export function determineItemFromMatches(
  matches: Match[],
  swapOrigin?: Position
): { item: ItemType; pos: Position } | null {
  const priority: Record<ItemType, number> = {
    coffee: 4,
    clip: 3,
    cutter: 2,
    scissors: 2,
  };

  let best: { item: ItemType; pos: Position; priority: number } | null = null;

  for (const match of matches) {
    const item = determineItem(match);
    if (item === null) continue;

    const p = priority[item];
    if (best === null || p > best.priority) {
      // 生成位置の決定
      let pos: Position;
      if (swapOrigin && match.positions.some(mp => mp.row === swapOrigin.row && mp.col === swapOrigin.col)) {
        pos = swapOrigin;
      } else {
        pos = getCenterPosition(match.positions);
      }
      best = { item, pos, priority: p };
    }
  }

  return best ? { item: best.item, pos: best.pos } : null;
}

/** 位置群の中央を返す */
function getCenterPosition(positions: Position[]): Position {
  const midIndex = Math.floor(positions.length / 2);
  // 位置をソートして中央を取る
  const sorted = [...positions].sort((a, b) =>
    a.row !== b.row ? a.row - b.row : a.col - b.col
  );
  return sorted[midIndex];
}

/** はさみの効果: 縦一列消去 */
export function getScissorsTargets(pos: Position): Position[] {
  const targets: Position[] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    targets.push({ row, col: pos.col });
  }
  return targets;
}

/** カッターの効果: 横一列消去 */
export function getCutterTargets(pos: Position): Position[] {
  const targets: Position[] = [];
  for (let col = 0; col < BOARD_SIZE; col++) {
    targets.push({ row: pos.row, col });
  }
  return targets;
}

/** クリップの効果: 周囲Nマス消去 */
export function getClipTargets(pos: Position, radius: number): Position[] {
  const targets: Position[] = [];
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      const p = { row: pos.row + dr, col: pos.col + dc };
      if (isValidPosition(p)) {
        targets.push(p);
      }
    }
  }
  return targets;
}

/** コーヒーカップの効果: 対象色の全消し */
export function getCoffeeTargets(board: (Cell | null)[][], targetColor: number): Position[] {
  const targets: Position[] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = board[row][col];
      if (cell && !cell.item && cell.color === targetColor) {
        targets.push({ row, col });
      }
    }
  }
  return targets;
}

/** コーヒーカップのタップ/連鎖時: 上隣から時計回りで最初の付箋の色を取得 */
export function findCoffeeTargetColor(board: (Cell | null)[][], pos: Position): number | null {
  // 上隣から時計回り: 上, 右上, 右, 右下, 下, 左下, 左, 左上
  const directions = [
    [-1, 0], [-1, 1], [0, 1], [1, 1],
    [1, 0], [1, -1], [0, -1], [-1, -1],
  ];
  for (const [dr, dc] of directions) {
    const p = { row: pos.row + dr, col: pos.col + dc };
    if (isValidPosition(p)) {
      const cell = board[p.row][p.col];
      if (cell && !cell.item) {
        return cell.color;
      }
    }
  }
  return null;
}

/** アイテムの効果範囲を取得 */
export function getItemTargets(
  board: (Cell | null)[][],
  pos: Position,
  item: ItemType,
  targetColor?: number
): Position[] {
  switch (item) {
    case 'scissors':
      return getScissorsTargets(pos);
    case 'cutter':
      return getCutterTargets(pos);
    case 'clip':
      return getClipTargets(pos, 2);
    case 'coffee': {
      const color = targetColor ?? findCoffeeTargetColor(board, pos);
      if (color === null) return [];
      return getCoffeeTargets(board, color);
    }
  }
}

/** 合成効果の取得 */
export function getSynthesisEffect(
  item1: ItemType,
  item2: ItemType
): { type: 'synthesis'; effect: string } | null {
  const pair = [item1, item2].sort().join('+');

  const lineItems = new Set(['cutter', 'scissors']);

  // コーヒー + コーヒー
  if (item1 === 'coffee' && item2 === 'coffee') {
    return { type: 'synthesis', effect: 'coffee+coffee' };
  }

  // コーヒー + 他
  if (item1 === 'coffee' || item2 === 'coffee') {
    const other = item1 === 'coffee' ? item2 : item1;
    return { type: 'synthesis', effect: `coffee+${other}` };
  }

  // クリップ + クリップ
  if (item1 === 'clip' && item2 === 'clip') {
    return { type: 'synthesis', effect: 'clip+clip' };
  }

  // はさみ/カッター + クリップ
  if ((item1 === 'clip' || item2 === 'clip') && (lineItems.has(item1) || lineItems.has(item2))) {
    const lineItem = item1 === 'clip' ? item2 : item1;
    return { type: 'synthesis', effect: `${lineItem}+clip` };
  }

  // はさみ/カッター同士
  if (lineItems.has(item1) && lineItems.has(item2)) {
    return { type: 'synthesis', effect: 'line+line' };
  }

  return null;
}

/** 合成効果の対象位置を取得 */
export function getSynthesisTargets(
  board: (Cell | null)[][],
  pos: Position,
  effect: string,
  targetColor?: number
): Position[] {
  switch (effect) {
    case 'line+line': {
      // 十字消去
      const targets = new Set<string>();
      const result: Position[] = [];
      for (const p of [...getScissorsTargets(pos), ...getCutterTargets(pos)]) {
        const key = `${p.row},${p.col}`;
        if (!targets.has(key)) {
          targets.add(key);
          result.push(p);
        }
      }
      return result;
    }
    case 'scissors+clip': {
      // 縦3列消去
      const targets = new Set<string>();
      const result: Position[] = [];
      for (let dc = -1; dc <= 1; dc++) {
        const c = pos.col + dc;
        if (c >= 0 && c < BOARD_SIZE) {
          for (let row = 0; row < BOARD_SIZE; row++) {
            const key = `${row},${c}`;
            if (!targets.has(key)) {
              targets.add(key);
              result.push({ row, col: c });
            }
          }
        }
      }
      return result;
    }
    case 'cutter+clip': {
      // 横3列消去
      const targets = new Set<string>();
      const result: Position[] = [];
      for (let dr = -1; dr <= 1; dr++) {
        const r = pos.row + dr;
        if (r >= 0 && r < BOARD_SIZE) {
          for (let col = 0; col < BOARD_SIZE; col++) {
            const key = `${r},${col}`;
            if (!targets.has(key)) {
              targets.add(key);
              result.push({ row: r, col });
            }
          }
        }
      }
      return result;
    }
    case 'clip+clip': {
      // 周囲4マス消去
      return getClipTargets(pos, 4);
    }
    case 'coffee+scissors': {
      // 対象色タイルから縦一列消去 → 対象位置は後でactivateで処理
      return []; // 特殊処理が必要
    }
    case 'coffee+cutter': {
      return []; // 特殊処理が必要
    }
    case 'coffee+clip': {
      return []; // 特殊処理が必要
    }
    case 'coffee+coffee': {
      return []; // 特殊処理: 全消し
    }
    default:
      return [];
  }
}
