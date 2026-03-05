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
 * 同色のマッチをマージして連結グループを作る
 * L字やT字のパターンを検出するために必要
 */
function mergeConnectedMatches(matches: Match[]): { positions: Position[]; color: number }[] {
  // 色ごとにマッチをグループ化
  const byColor = new Map<number, Match[]>();
  for (const m of matches) {
    const arr = byColor.get(m.color) ?? [];
    arr.push(m);
    byColor.set(m.color, arr);
  }

  const groups: { positions: Position[]; color: number }[] = [];

  for (const [color, colorMatches] of byColor) {
    // Union-Find で連結判定
    const posMap = new Map<string, number>(); // key -> index
    const allPositions: Position[] = [];

    for (const m of colorMatches) {
      for (const p of m.positions) {
        const key = `${p.row},${p.col}`;
        if (!posMap.has(key)) {
          posMap.set(key, allPositions.length);
          allPositions.push(p);
        }
      }
    }

    const parent = allPositions.map((_, i) => i);
    function find(x: number): number {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    }
    function union(a: number, b: number) {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }

    // 同じマッチ内のポジションを結合
    for (const m of colorMatches) {
      const firstIdx = posMap.get(`${m.positions[0].row},${m.positions[0].col}`)!;
      for (let i = 1; i < m.positions.length; i++) {
        const idx = posMap.get(`${m.positions[i].row},${m.positions[i].col}`)!;
        union(firstIdx, idx);
      }
    }

    // グループ化
    const groupMap = new Map<number, Position[]>();
    for (let i = 0; i < allPositions.length; i++) {
      const root = find(i);
      const arr = groupMap.get(root) ?? [];
      arr.push(allPositions[i]);
      groupMap.set(root, arr);
    }

    for (const positions of groupMap.values()) {
      groups.push({ positions, color });
    }
  }

  return groups;
}

/**
 * 複数のマッチから最も優先度の高いアイテムを1つ決定
 * swapPositions: ユーザーのスワイプに関わる2つの位置 [origin, target]
 *   - originを優先し、originがマッチに含まれなければtargetを使う
 */
export function determineItemFromMatches(
  matches: Match[],
  swapPositions?: [Position, Position]
): { item: ItemType; pos: Position } | null {
  const priority: Record<ItemType, number> = {
    coffee: 4,
    clip: 3,
    cutter: 2,
    scissors: 2,
  };

  // 全マッチの位置をセットにまとめる
  const allMatchPositions = new Set<string>();
  for (const m of matches) {
    for (const p of m.positions) {
      allMatchPositions.add(`${p.row},${p.col}`);
    }
  }

  // スワイプ位置のうちマッチに含まれるものを優先順で選択
  let swapPos: Position | undefined;
  if (swapPositions) {
    const [origin, target] = swapPositions;
    if (allMatchPositions.has(`${origin.row},${origin.col}`)) {
      swapPos = origin;
    } else if (allMatchPositions.has(`${target.row},${target.col}`)) {
      swapPos = target;
    }
  }

  let best: { item: ItemType; pos: Position; priority: number } | null = null;

  // 1. 個別マッチから直線アイテム判定 (scissors, cutter, coffee)
  for (const match of matches) {
    const item = determineItem(match);
    if (item === null) continue;

    const p = priority[item];
    if (best === null || p > best.priority) {
      const pos = swapPos ?? getCenterPosition(match.positions);
      best = { item, pos, priority: p };
    }
  }

  // 2. 連結グループからクリップ判定 (5+マス非直線)
  //    coffeeが既に見つかっている場合はスキップ（優先度が上）
  if (!best || best.priority < priority.clip) {
    const groups = mergeConnectedMatches(matches);
    for (const group of groups) {
      if (group.positions.length >= 5) {
        const isH = group.positions.every(p => p.row === group.positions[0].row);
        const isV = group.positions.every(p => p.col === group.positions[0].col);
        if (!isH && !isV) {
          const p = priority.clip;
          if (!best || p > best.priority) {
            const pos = swapPos ?? getCenterPosition(group.positions);
            best = { item: 'clip', pos, priority: p };
          }
        }
      }
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
