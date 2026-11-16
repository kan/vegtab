import { Cell, Color, ItemType, Match, Position, SynthesisEffect, BOARD_SIZE } from './types.js';
import { isValidPosition } from './board.js';

/** 上から時計回りの8方向 */
const CLOCKWISE_8: readonly [number, number][] = [
  [-1, 0], [-1, 1], [0, 1], [1, 1],
  [1, 0], [1, -1], [0, -1], [-1, -1],
];

/**
 * 個別マッチパターンからアイテム生成を判定（直線マッチのみ）
 * 優先順: flush > burst > h_cut = v_cut
 * 2×2は別途 determineItemFromMatches で処理
 */
export function determineItem(match: Match): ItemType | null {
  if (match.shape === '2x2') return null; // 2×2は個別判定しない
  const positions = match.positions;
  const len = positions.length;

  if (len < 4) return null;

  // 直線判定
  const isHorizontal = positions.every(p => p.row === positions[0].row);
  const isVertical = positions.every(p => p.col === positions[0].col);
  const isStraight = isHorizontal || isVertical;

  if (len >= 5 && isStraight) return 'flush';
  if (len >= 5) return 'burst'; // 5以上の非直線
  // len === 4
  if (isHorizontal) return 'v_cut'; // 横4 → 縦一列消去
  if (isVertical) return 'h_cut'; // 縦4 → 横一列消去
  return 'burst'; // 4マスの非直線（L字等）→ burst
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

/** アイテム優先度（高いほど強い） */
export const ITEM_PRIORITY: Record<ItemType, number> = {
  flush: 5,
  burst: 4,
  h_cut: 3,
  v_cut: 3,
  scope: 1,
};

/**
 * マッチを色+位置の連結でコンポーネントに分割する
 */
function groupMatchesByComponent(matches: Match[]): Match[][] {
  const byColor = new Map<number, Match[]>();
  for (const m of matches) {
    const arr = byColor.get(m.color) ?? [];
    arr.push(m);
    byColor.set(m.color, arr);
  }

  const result: Match[][] = [];

  for (const [, colorMatches] of byColor) {
    const parent = colorMatches.map((_, i) => i);
    function find(x: number): number {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    }
    function union(a: number, b: number) {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }

    // 位置 → マッチindexのマッピング
    const posToMatch = new Map<string, number[]>();
    for (let i = 0; i < colorMatches.length; i++) {
      for (const p of colorMatches[i].positions) {
        const key = `${p.row},${p.col}`;
        const arr = posToMatch.get(key) ?? [];
        arr.push(i);
        posToMatch.set(key, arr);
      }
    }

    // 位置を共有するマッチを結合
    for (const indices of posToMatch.values()) {
      for (let i = 1; i < indices.length; i++) {
        union(indices[0], indices[i]);
      }
    }

    const groups = new Map<number, Match[]>();
    for (let i = 0; i < colorMatches.length; i++) {
      const root = find(i);
      const arr = groups.get(root) ?? [];
      arr.push(colorMatches[i]);
      groups.set(root, arr);
    }

    for (const group of groups.values()) {
      result.push(group);
    }
  }

  return result;
}

/**
 * 1つのコンポーネント内で最も優先度の高いアイテムを決定
 */
function determineBestItemForComponent(
  componentMatches: Match[],
  swapPositions?: [Position, Position],
  isBlocked?: (pos: Position) => boolean,
): { item: ItemType; pos: Position } | null {
  // 置けない位置（鎖の付いた野菜）を除いた中央。全部置けないときは null
  const center = (positions: Position[]): Position | null => {
    if (!isBlocked || !positions.some(isBlocked)) return getCenterPosition(positions);
    const free = positions.filter(p => !isBlocked(p));
    return free.length > 0 ? getCenterPosition(free) : null;
  };
  // コンポーネント内の全位置
  const allPositions = new Set<string>();
  for (const m of componentMatches) {
    for (const p of m.positions) {
      allPositions.add(`${p.row},${p.col}`);
    }
  }

  // このコンポーネントに属するスワイプ位置
  let swapPos: Position | undefined;
  if (swapPositions) {
    const [origin, target] = swapPositions;
    if (allPositions.has(`${origin.row},${origin.col}`)) {
      swapPos = origin;
    } else if (allPositions.has(`${target.row},${target.col}`)) {
      swapPos = target;
    }
  }

  // 置き場所が無い候補（全部が鎖の付いた野菜）は選ばず、次の候補に譲る
  let best: { item: ItemType; pos: Position; priority: number } | null = null;

  // 1. 個別マッチから直線アイテム判定 (v_cut, h_cut, flush)
  for (const match of componentMatches) {
    const item = determineItem(match);
    if (item === null) continue;

    const p = ITEM_PRIORITY[item];
    if (best === null || p > best.priority) {
      const pos = swapPos ?? center(match.positions);
      if (pos) best = { item, pos, priority: p };
    }
  }

  // 2. 連結グループからburst判定 (5+マス非直線)
  if (!best || best.priority < ITEM_PRIORITY.burst) {
    const straightMatches = componentMatches.filter(m => m.shape !== '2x2');
    const groups = mergeConnectedMatches(straightMatches);
    for (const group of groups) {
      if (group.positions.length >= 5) {
        const isH = group.positions.every(p => p.row === group.positions[0].row);
        const isV = group.positions.every(p => p.col === group.positions[0].col);
        if (!isH && !isV) {
          const p = ITEM_PRIORITY.burst;
          if (!best || p > best.priority) {
            const pos = swapPos ?? center(group.positions);
            if (pos) best = { item: 'burst', pos, priority: p };
          }
        }
      }
    }
  }

  // 3. 2×2マッチからscope判定
  const has2x2 = componentMatches.some(m => m.shape === '2x2');
  if (has2x2) {
    if (!best || best.priority < ITEM_PRIORITY.v_cut) {
      const match2x2 = componentMatches.find(m => m.shape === '2x2')!;
      const pos = swapPos ?? center(match2x2.positions);
      if (pos) best = { item: 'scope', pos, priority: ITEM_PRIORITY.scope };
    }
  }

  return best ? { item: best.item, pos: best.pos } : null;
}

/**
 * 複数のマッチからアイテムを決定（独立したコンポーネントごとに1つ）
 * swapPositions: ユーザーのスワイプに関わる2つの位置 [origin, target]
 *
 * 2×2マッチと直線マッチの重複ルール:
 *   - 2×2と3直線の重複 → scope成立
 *   - 2×2と4直線以上 or L/T字5マス以上の重複 → 上位アイテム優先、scope消滅
 * isBlocked: アイテムを置けない位置（鎖の付いた野菜。マッチしても残るため）
 */
export function determineItemFromMatches(
  matches: Match[],
  swapPositions?: [Position, Position],
  isBlocked?: (pos: Position) => boolean,
): { item: ItemType; pos: Position }[] {
  const components = groupMatchesByComponent(matches);
  const results: { item: ItemType; pos: Position }[] = [];

  for (const component of components) {
    const item = determineBestItemForComponent(component, swapPositions, isBlocked);
    if (item) results.push(item);
  }

  return results;
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

/** v_cutの効果: 縦一列消去 */
export function getVCutTargets(pos: Position): Position[] {
  const targets: Position[] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    targets.push({ row, col: pos.col });
  }
  return targets;
}

/** h_cutの効果: 横一列消去 */
export function getHCutTargets(pos: Position): Position[] {
  const targets: Position[] = [];
  for (let col = 0; col < BOARD_SIZE; col++) {
    targets.push({ row: pos.row, col });
  }
  return targets;
}

/** burstの効果: 周囲Nマス消去 */
export function getBurstTargets(pos: Position, radius: number): Position[] {
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

/** flushの効果: 対象色の全消し */
export function getFlushTargets(board: (Cell | null)[][], targetColor: number): Position[] {
  const targets: Position[] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = board[row][col];
      // おじゃまタイルは配置前の色を内部に保持しているが、画面には見えないので対象外
      if (cell && !cell.item && !cell.obstacle && cell.color === targetColor) {
        targets.push({ row, col });
      }
    }
  }
  return targets;
}

/** 上下左右4方向 */
const CROSS_4: readonly [number, number][] = [
  [-1, 0], [0, 1], [1, 0], [0, -1],
];

/** scopeの周囲4マス(上下左右)を返す */
export function getScopeAdjacentTargets(board: (Cell | null)[][], pos: Position): Position[] {
  const targets: Position[] = [];
  for (const [dr, dc] of CROSS_4) {
    const p = { row: pos.row + dr, col: pos.col + dc };
    if (isValidPosition(p) && board[p.row][p.col]) {
      targets.push(p);
    }
  }
  return targets;
}

export function findFlushTargetColor(board: (Cell | null)[][], pos: Position): number | null {
  // 上隣から時計回り: 上, 右上, 右, 右下, 下, 左下, 左, 左上（おじゃまタイルの見えない色は使わない）
  for (const [dr, dc] of CLOCKWISE_8) {
    const p = { row: pos.row + dr, col: pos.col + dc };
    if (isValidPosition(p)) {
      const cell = board[p.row][p.col];
      if (cell && !cell.item && !cell.obstacle) {
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
  targetColor?: number,
  targetCells?: Position[],
): Position[] {
  switch (item) {
    case 'scope':
      // 連鎖発動時: 周囲上下左右4マス消去のみ
      return getScopeAdjacentTargets(board, pos);
    case 'v_cut':
      return getVCutTargets(pos);
    case 'h_cut':
      return getHCutTargets(pos);
    case 'burst':
      return getBurstTargets(pos, 2);
    case 'flush': {
      const color = targetColor ?? findFlushTargetColor(board, pos);
      if (color === null) return [];
      return getFlushTargets(board, color);
    }
  }
}

/** 合成効果の取得 */
export function getSynthesisEffect(
  item1: ItemType,
  item2: ItemType
): { type: 'synthesis'; effect: SynthesisEffect } | null {
  const lineItems = new Set(['h_cut', 'v_cut']);

  // scope + scope
  if (item1 === 'scope' && item2 === 'scope') {
    return { type: 'synthesis', effect: 'scope+scope' };
  }

  // scope + 他
  if (item1 === 'scope' || item2 === 'scope') {
    const other = item1 === 'scope' ? item2 : item1;
    switch (other) {
      case 'v_cut': return { type: 'synthesis', effect: 'scope+v_cut' };
      case 'h_cut': return { type: 'synthesis', effect: 'scope+h_cut' };
      case 'burst': return { type: 'synthesis', effect: 'scope+burst' };
      case 'flush': return { type: 'synthesis', effect: 'scope+flush' };
      default: return null;
    }
  }

  // flush + flush
  if (item1 === 'flush' && item2 === 'flush') {
    return { type: 'synthesis', effect: 'flush+flush' };
  }

  // flush + 他
  if (item1 === 'flush' || item2 === 'flush') {
    const other = item1 === 'flush' ? item2 : item1;
    switch (other) {
      case 'v_cut': return { type: 'synthesis', effect: 'flush+v_cut' };
      case 'h_cut': return { type: 'synthesis', effect: 'flush+h_cut' };
      case 'burst': return { type: 'synthesis', effect: 'flush+burst' };
      default: return null;
    }
  }

  // burst + burst
  if (item1 === 'burst' && item2 === 'burst') {
    return { type: 'synthesis', effect: 'burst+burst' };
  }

  // v_cut/h_cut + burst
  if ((item1 === 'burst' || item2 === 'burst') && (lineItems.has(item1) || lineItems.has(item2))) {
    const lineItem = item1 === 'burst' ? item2 : item1;
    switch (lineItem) {
      case 'v_cut': return { type: 'synthesis', effect: 'v_cut+burst' };
      case 'h_cut': return { type: 'synthesis', effect: 'h_cut+burst' };
      default: return null;
    }
  }

  // v_cut/h_cut同士
  if (lineItems.has(item1) && lineItems.has(item2)) {
    return { type: 'synthesis', effect: 'line+line' };
  }

  return null;
}

/** 合成効果の対象位置を取得 */
export function getSynthesisTargets(
  board: (Cell | null)[][],
  pos: Position,
  effect: SynthesisEffect,
  targetColor?: number,
  targetCells?: Position[],
): Position[] {
  switch (effect) {
    case 'line+line': {
      // 十字消去
      const targets = new Set<string>();
      const result: Position[] = [];
      for (const p of [...getVCutTargets(pos), ...getHCutTargets(pos)]) {
        const key = `${p.row},${p.col}`;
        if (!targets.has(key)) {
          targets.add(key);
          result.push(p);
        }
      }
      return result;
    }
    case 'v_cut+burst': {
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
    case 'h_cut+burst': {
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
    case 'burst+burst': {
      // 周囲3マス消去
      return getBurstTargets(pos, 3);
    }
    case 'flush+v_cut': {
      return []; // 特殊処理が必要
    }
    case 'flush+h_cut': {
      return []; // 特殊処理が必要
    }
    case 'flush+burst': {
      return []; // 特殊処理が必要
    }
    case 'flush+flush': {
      return []; // 特殊処理: 全消し
    }
    case 'scope+scope': {
      // ユーザーが選んだ3マス
      return targetCells ?? [];
    }
    case 'scope+v_cut': {
      // ユーザーが選んだ1マスから縦一列
      if (!targetCells || targetCells.length === 0) return [];
      return getVCutTargets(targetCells[0]);
    }
    case 'scope+h_cut': {
      // ユーザーが選んだ1マスから横一列
      if (!targetCells || targetCells.length === 0) return [];
      return getHCutTargets(targetCells[0]);
    }
    case 'scope+burst': {
      // ユーザーが選んだ1マスから周囲2マス
      if (!targetCells || targetCells.length === 0) return [];
      return getBurstTargets(targetCells[0], 2);
    }
    case 'scope+flush': {
      // flushの隣接色で全消し → 特殊処理で対応
      return [];
    }
    default:
      return [];
  }
}
