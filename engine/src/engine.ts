import {
  Cell, Color, ItemType, Position, Direction, Action,
  Match, ChainStep, GameState, GameMode, GameInitParams, BOARD_SIZE, NUM_COLORS,
} from './types.js';
import { createRng, nextInt } from './rng.js';
import {
  generateRawBoard, fillEmptyCells, cloneBoard, getCell, isValidPosition, nextColor,
} from './board.js';
import { findMatches, getUniquePositions, hasMatches } from './match.js';
import { applyGravity } from './gravity.js';
import {
  determineItem, determineItemFromMatches,
  getItemTargets, getSynthesisEffect, getSynthesisTargets,
  findFlushTargetColor, getFlushTargets,
  getVCutTargets, getHCutTargets, getBurstTargets,
  getScopeAdjacentTargets,
} from './item.js';
import { calculateStepScore, getFullClearBonus, calculateRemainingItemBonus } from './score.js';
import { checkGameOverState } from './gameOver.js';
import { generateObstacles, damageObstacles } from './obstacle.js';
import { DEFAULT_QUOTA_TABLE } from './survival.js';

const DEFAULT_MOVE_LIMIT = 15;

/** 方向から隣接位置を計算 */
function getAdjacentPos(pos: Position, dir: Direction): Position {
  switch (dir) {
    case 'up': return { row: pos.row - 1, col: pos.col };
    case 'down': return { row: pos.row + 1, col: pos.col };
    case 'left': return { row: pos.row, col: pos.col - 1 };
    case 'right': return { row: pos.row, col: pos.col + 1 };
  }
}

/** 初期盤面を生成（自動消去込み、スコア0・アイテムなし） */
export function initializeGame(
  seed: number,
  mode: GameMode = 'sprint',
  params?: GameInitParams,
): GameState {
  let { board, rngState } = generateRawBoard(seed);

  // 自動消去ループ: マッチがなくなるまで繰り返す
  while (hasMatches(board)) {
    const matches = findMatches(board);
    const positions = getUniquePositions(matches);
    for (const pos of positions) {
      board[pos.row][pos.col] = null;
    }
    applyGravity(board);
    rngState = fillEmptyCells(board, rngState);
  }

  const state: GameState = {
    board,
    score: 0,
    rngState,
    moveCount: 0,
    isGameOver: false,
    mode,
  };

  switch (mode) {
    case 'sprint':
      state.moveLimit = params?.moveLimit ?? DEFAULT_MOVE_LIMIT;
      break;
    case 'clear': {
      const result = generateObstacles(board, rngState, params?.obstacleCount);
      state.rngState = result.rngState;
      break;
    }
    case 'survival':
      state.quotaTable = params?.quotaTable ?? [...DEFAULT_QUOTA_TABLE];
      state.segmentStartScore = 0;
      break;
  }

  return state;
}

/** GameStateのディープコピー */
export function cloneGameState(state: GameState): GameState {
  return {
    board: cloneBoard(state.board),
    score: state.score,
    rngState: state.rngState,
    moveCount: state.moveCount,
    isGameOver: state.isGameOver,
    mode: state.mode,
    moveLimit: state.moveLimit,
    isCleared: state.isCleared,
    quotaTable: state.quotaTable ? [...state.quotaTable] : undefined,
    segmentStartScore: state.segmentStartScore,
  };
}

/** アイテムを起動し、効果範囲の対象を消去・誘爆する */
function activateItem(
  board: (Cell | null)[][],
  pos: Position,
  item: ItemType,
  targetColor: number | undefined,
  chainIndex: number,
  rngState: number,
  targetCells?: Position[],
): { score: number; rngState: number; chainSteps: ChainStep[]; clearedPositions: Position[] } {
  const activated = new Set<string>();
  const chainSteps: ChainStep[] = [];
  let totalScore = 0;
  let rng = rngState;
  const allCleared: Position[] = [];

  // 再帰的に誘爆を処理するキュー
  const queue: { pos: Position; item: ItemType; targetColor?: number; targetCells?: Position[] }[] = [
    { pos, item, targetColor, targetCells },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const key = `${current.pos.row},${current.pos.col}`;
    if (activated.has(key)) continue;
    activated.add(key);

    // アイテム自体を消去
    const cell = board[current.pos.row]?.[current.pos.col];
    if (cell?.item) {
      board[current.pos.row][current.pos.col] = null;
    }

    const targets = getItemTargets(board, current.pos, current.item, current.targetColor, current.targetCells);
    const cleared: Position[] = [];

    for (const t of targets) {
      const tCell = board[t.row]?.[t.col];
      if (tCell === null) continue;
      if (tCell.obstacle) continue; // おじゃまタイルはアイテム直接消去不可
      if (tCell.item) {
        // 誘爆キューに追加
        const tKey = `${t.row},${t.col}`;
        if (!activated.has(tKey)) {
          queue.push({ pos: t, item: tCell.item });
        }
      } else {
        board[t.row][t.col] = null;
        cleared.push(t);
      }
    }

    allCleared.push(...cleared);

    if (cleared.length > 0) {
      const score = 10 * cleared.length * chainIndex;
      totalScore += score;
      chainSteps.push({
        chainIndex,
        matches: [],
        clearedPositions: cleared,
        generatedItems: [],
        score,
      });
    }
  }

  return { score: totalScore, rngState: rng, chainSteps, clearedPositions: allCleared };
}

/** コーヒー+アイテム合成: 対象色の全タイルからアイテム効果を発動 */
function activateCoffeeSynthesis(
  board: (Cell | null)[][],
  pos: Position,
  coffeePos: Position,
  otherItem: ItemType,
  targetColor: number,
  chainIndex: number,
  rngState: number,
): { score: number; rngState: number; chainSteps: ChainStep[]; clearedPositions: Position[] } {
  // まず両方のアイテムを消去
  board[pos.row][pos.col] = null;
  board[coffeePos.row][coffeePos.col] = null;

  // 対象色の全タイル位置を取得
  const colorTargets = getFlushTargets(board, targetColor);

  let totalScore = 0;
  let rng = rngState;
  const allSteps: ChainStep[] = [];
  const activated = new Set<string>();
  const allCleared: Position[] = [];

  // 対象色タイルを消して、各位置からアイテム効果を発動
  for (const ct of colorTargets) {
    board[ct.row][ct.col] = null;
    allCleared.push(ct);
  }
  totalScore += 10 * colorTargets.length * chainIndex;

  // 各位置からアイテム効果を発動
  for (const ct of colorTargets) {
    let targets: Position[];
    switch (otherItem) {
      case 'v_cut':
        targets = getVCutTargets(ct);
        break;
      case 'h_cut':
        targets = getHCutTargets(ct);
        break;
      case 'burst':
        targets = getBurstTargets(ct, 2);
        break;
      default:
        targets = [];
    }

    const cleared: Position[] = [];
    for (const t of targets) {
      const cell = board[t.row]?.[t.col];
      if (cell === null) continue;
      if (cell.obstacle) continue; // おじゃまタイルはスキップ
      if (cell.item) {
        // 誘爆
        const key = `${t.row},${t.col}`;
        if (!activated.has(key)) {
          activated.add(key);
          const result = activateItem(board, t, cell.item, undefined, chainIndex, rng);
          totalScore += result.score;
          rng = result.rngState;
          allSteps.push(...result.chainSteps);
          allCleared.push(...result.clearedPositions);
        }
      } else {
        board[t.row][t.col] = null;
        cleared.push(t);
        allCleared.push(t);
      }
    }

    if (cleared.length > 0) {
      totalScore += 10 * cleared.length * chainIndex;
    }
  }

  return { score: totalScore, rngState: rng, chainSteps: allSteps, clearedPositions: allCleared };
}

/** おじゃまタイルへのダメージ処理（消去位置に基づく） */
function processDamage(board: (Cell | null)[][], clearedPositions: Position[], rngState: number): number {
  let rng = rngState;
  const destroyed = damageObstacles(board, clearedPositions);
  if (destroyed.length > 0) {
    // おじゃまタイルが破壊された → 上のタイルが落下 → 補充 → 連鎖チェックは呼び出し元で行う
    applyGravity(board);
    rng = fillEmptyCells(board, rng);
  }
  return rng;
}

/** ゲーム終了チェック＋残存アイテムボーナス加算 */
function applyGameOver(state: GameState): void {
  const result = checkGameOverState(state);
  state.isGameOver = result.gameOver;
  if (result.isCleared !== undefined) state.isCleared = result.isCleared;
  if (result.newSegmentStartScore !== undefined) state.segmentStartScore = result.newSegmentStartScore;

  if (state.isGameOver) {
    if (state.mode === 'sprint') {
      state.score += calculateRemainingItemBonus(state.board);
    }
    if (state.mode === 'clear') {
      // Clearモード: スコアは手数（少ないほど良い）
      state.score = state.moveCount;
    }
  }
}

/** プレイヤーの操作を処理して新しいGameStateを返す */
export function processAction(state: GameState, action: Action): GameState {
  if (state.isGameOver) return state;

  const newState = cloneGameState(state);
  const board = newState.board;

  if (action.type === 'scope') {
    // scope起動: タップで1手消費、周囲4マス消去 + ユーザー選択マスを消去
    const cell = getCell(board, action.pos);
    if (!cell?.item || cell.item !== 'scope') return state;

    board[action.pos.row][action.pos.col] = null;
    newState.moveCount++;

    const allCleared: Position[] = [];

    // まず周囲上下左右4マスを消去
    const adjTargets = getScopeAdjacentTargets(board, action.pos);
    for (const t of adjTargets) {
      const adjCell = getCell(board, t);
      if (!adjCell) continue;
      if (adjCell.obstacle) continue;
      if (adjCell.item) {
        let tc: number | undefined;
        if (adjCell.item === 'flush') {
          tc = findFlushTargetColor(board, t) ?? undefined;
        }
        const result = activateItem(board, t, adjCell.item, tc, 1, newState.rngState);
        newState.score += result.score;
        newState.rngState = result.rngState;
        allCleared.push(...result.clearedPositions);
      } else {
        board[t.row][t.col] = null;
        newState.score += 10;
        allCleared.push(t);
      }
    }

    // ユーザー選択マスを消去
    for (const target of action.targetCells) {
      const targetCell = getCell(board, target);
      if (!targetCell) continue;
      if (targetCell.obstacle) {
        // おじゃまタイルを直接選択した場合、耐久値を1減らす
        targetCell.obstacle.durability--;
        if (targetCell.obstacle.durability <= 0) {
          board[target.row][target.col] = null;
          allCleared.push(target);
        }
        continue;
      }
      if (targetCell.item) {
        let targetColor: number | undefined;
        if (targetCell.item === 'flush') {
          targetColor = findFlushTargetColor(board, target) ?? undefined;
        }
        const result = activateItem(board, target, targetCell.item, targetColor, 1, newState.rngState);
        newState.score += result.score;
        newState.rngState = result.rngState;
        allCleared.push(...result.clearedPositions);
      } else {
        board[target.row][target.col] = null;
        newState.score += 10;
        allCleared.push(target);
      }
    }

    // おじゃまタイルへのダメージ
    newState.rngState = processDamage(board, allCleared, newState.rngState);

    // 落下 → 補充 → 連鎖
    applyGravity(board);
    newState.rngState = fillEmptyCells(board, newState.rngState);
    const chainResult = processChains(board, newState.rngState, 2, newState.mode);
    newState.score += chainResult.score;
    newState.rngState = chainResult.rngState;

    applyGameOver(newState);
    return newState;
  }

  if (action.type === 'tap') {
    // タップ: アイテム起動
    const cell = getCell(board, action.pos);
    if (!cell?.item) return state; // アイテムがなければ無効
    if (cell.obstacle) return state; // おじゃまタイルはタップ不可

    const item = cell.item;

    // 虫めがねはtapでは起動しない（magnifying_glass actionを使う）
    if (item === 'scope') return state;

    let targetColor: number | undefined;
    if (item === 'flush') {
      targetColor = findFlushTargetColor(board, action.pos) ?? undefined;
      if (targetColor === undefined) return state;
    }

    const result = activateItem(board, action.pos, item, targetColor, 1, newState.rngState);
    newState.score += result.score;
    newState.rngState = result.rngState;
    newState.moveCount++;

    // おじゃまタイルへのダメージ
    newState.rngState = processDamage(board, result.clearedPositions, newState.rngState);

    // 落下 → 補充 → 連鎖
    applyGravity(board);
    newState.rngState = fillEmptyCells(board, newState.rngState);
    const chainResult = processChains(board, newState.rngState, 2, newState.mode);
    newState.score += chainResult.score;
    newState.rngState = chainResult.rngState;

  } else {
    // スワイプ
    const targetPos = getAdjacentPos(action.pos, action.dir);
    if (!isValidPosition(targetPos)) return state;

    const cell1 = getCell(board, action.pos);
    const cell2 = getCell(board, targetPos);
    if (!cell1 || !cell2) return state;

    // おじゃまタイルはスワイプ不可
    if (cell1.obstacle || cell2.obstacle) return state;

    // アイテム合成チェック
    if (cell1.item && cell2.item) {
      const synthesis = getSynthesisEffect(cell1.item, cell2.item);
      if (synthesis) {
        // 虫めがね合成でユーザー選択が必要な場合は無効（別Actionで処理）
        if (synthesis.effect === 'scope+scope' ||
            synthesis.effect === 'scope+v_cut' ||
            synthesis.effect === 'scope+h_cut' ||
            synthesis.effect === 'scope+burst') {
          return state; // フロントエンドが magnifying_glass_synthesis アクションを送る
        }

        const synthResult = processSynthesis(
          board, action.pos, targetPos, cell1.item, cell2.item,
          synthesis.effect, newState.rngState
        );
        newState.score += synthResult.score;
        newState.rngState = synthResult.rngState;
        newState.moveCount++;

        // おじゃまタイルへのダメージ
        newState.rngState = processDamage(board, synthResult.clearedPositions, newState.rngState);

        applyGravity(board);
        newState.rngState = fillEmptyCells(board, newState.rngState);
        const chainResult = processChains(board, newState.rngState, 2, newState.mode);
        newState.score += chainResult.score;
        newState.rngState = chainResult.rngState;

        applyGameOver(newState);
        return newState;
      }
    }

    // アイテムとのスワイプ（アイテム起動）
    if (cell1.item || cell2.item) {
      const itemCell = cell1.item ? cell1 : cell2;
      const itemPos = cell1.item ? action.pos : targetPos;
      const otherCell = cell1.item ? cell2 : cell1;
      const otherPos = cell1.item ? targetPos : action.pos;

      // 虫めがねはスワイプ起動不可（tapの代わりにmagnifying_glass actionで）
      if (itemCell.item === 'scope') return state;

      // まず入れ替え
      board[action.pos.row][action.pos.col] = cell2;
      board[targetPos.row][targetPos.col] = cell1;

      let targetColor: number | undefined;
      if (itemCell.item === 'flush') {
        // コーヒーのスワイプ: 入れ替え先の色
        targetColor = otherCell.item ? undefined : otherCell.color;
      }

      const result = activateItem(board, itemPos, itemCell.item!, targetColor, 1, newState.rngState);
      newState.score += result.score;
      newState.rngState = result.rngState;
      newState.moveCount++;

      // おじゃまタイルへのダメージ
      newState.rngState = processDamage(board, result.clearedPositions, newState.rngState);

      applyGravity(board);
      newState.rngState = fillEmptyCells(board, newState.rngState);
      const chainResult = processChains(board, newState.rngState, 2, newState.mode);
      newState.score += chainResult.score;
      newState.rngState = chainResult.rngState;

      applyGameOver(newState);
      return newState;
    }

    // 通常スワイプ: 入れ替えてマッチ判定
    board[action.pos.row][action.pos.col] = cell2;
    board[targetPos.row][targetPos.col] = cell1;

    const matches = findMatches(board);
    if (matches.length === 0) {
      // マッチなし: 入れ替えを戻す
      board[action.pos.row][action.pos.col] = cell1;
      board[targetPos.row][targetPos.col] = cell2;
      return state;
    }

    newState.moveCount++;

    // アイテム生成判定
    const itemGen = determineItemFromMatches(matches, [action.pos, targetPos]);

    // マッチ消去
    const cleared = getUniquePositions(matches);
    for (const pos of cleared) {
      board[pos.row][pos.col] = null;
    }

    // スコア計算（1連鎖目）— Clearモードでは通常スコアを加算しない
    if (newState.mode !== 'clear') {
      const stepScore = calculateStepScore(matches, 1);
      newState.score += stepScore;
    }

    // アイテム配置
    if (itemGen) {
      board[itemGen.pos.row][itemGen.pos.col] = { color: 0 as Color, item: itemGen.item };
    }

    // おじゃまタイルへのダメージ
    newState.rngState = processDamage(board, cleared, newState.rngState);

    // 落下 → 補充 → 連鎖
    applyGravity(board);
    newState.rngState = fillEmptyCells(board, newState.rngState);
    const chainResult = processChains(board, newState.rngState, 2, newState.mode);
    newState.score += chainResult.score;
    newState.rngState = chainResult.rngState;
  }

  applyGameOver(newState);
  return newState;
}

/** 合成効果を処理 */
/** Clear targets, activating any items encountered. Returns updated score and rng. */
function clearTargets(
  board: (Cell | null)[][],
  targets: Position[],
  rngState: number,
  excludePositions?: Set<string>,
): { score: number; rngState: number; clearedPositions: Position[] } {
  let rng = rngState;
  let score = 0;
  let cleared = 0;
  const activated = excludePositions ?? new Set<string>();
  const allCleared: Position[] = [];

  for (const t of targets) {
    const cell = board[t.row]?.[t.col];
    if (cell === null) continue;
    if (cell.obstacle) continue; // おじゃまタイルはスキップ
    if (cell.item) {
      const key = `${t.row},${t.col}`;
      if (!activated.has(key)) {
        activated.add(key);
        const result = activateItem(board, t, cell.item, undefined, 1, rng);
        score += result.score;
        rng = result.rngState;
        allCleared.push(...result.clearedPositions);
      }
    } else {
      board[t.row][t.col] = null;
      cleared++;
      allCleared.push(t);
    }
  }

  score += 10 * cleared;
  return { score, rngState: rng, clearedPositions: allCleared };
}

function processSynthesis(
  board: (Cell | null)[][],
  pos1: Position,
  pos2: Position,
  item1: ItemType,
  item2: ItemType,
  effect: string,
  rngState: number,
): { score: number; rngState: number; clearedPositions: Position[] } {
  let rng = rngState;
  let totalScore = 0;
  const allCleared: Position[] = [];

  if (effect === 'flush+flush') {
    // 全消し: アイテムは残留
    board[pos1.row][pos1.col] = null;
    board[pos2.row][pos2.col] = null;

    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const cell = board[row][col];
        if (cell === null) continue;
        if (cell.obstacle) continue; // おじゃまタイルは残留
        if (!cell.item) {
          board[row][col] = null;
          allCleared.push({ row, col });
        }
      }
    }

    totalScore += getFullClearBonus();
    applyGravity(board);
    rng = fillEmptyCells(board, rng);

    return { score: totalScore, rngState: rng, clearedPositions: allCleared };
  }

  if (effect === 'scope+flush') {
    const coffeePos = item1 === 'flush' ? pos1 : pos2;
    board[pos1.row][pos1.col] = null;
    board[pos2.row][pos2.col] = null;

    const targetColor = findFlushTargetColor(board, coffeePos);
    if (targetColor === null) {
      return { score: 0, rngState: rng, clearedPositions: [] };
    }

    const targets = getFlushTargets(board, targetColor);
    for (const t of targets) {
      const cell = board[t.row]?.[t.col];
      if (cell === null) continue;
      if (cell.obstacle) continue;
      if (cell.item) {
        const result = activateItem(board, t, cell.item, undefined, 1, rng);
        totalScore += result.score;
        rng = result.rngState;
        allCleared.push(...result.clearedPositions);
      } else {
        board[t.row][t.col] = null;
        allCleared.push(t);
      }
    }
    totalScore += 10 * targets.length;

    return { score: totalScore, rngState: rng, clearedPositions: allCleared };
  }

  if (effect.startsWith('flush+')) {
    const otherItem = effect.replace('flush+', '') as ItemType;
    const coffeePos = item1 === 'flush' ? pos1 : pos2;
    const otherPos = item1 === 'flush' ? pos2 : pos1;

    const targetColor = findFlushTargetColor(board, coffeePos);
    if (targetColor === null) {
      board[pos1.row][pos1.col] = null;
      board[pos2.row][pos2.col] = null;
      return { score: 0, rngState: rng, clearedPositions: [] };
    }

    const result = activateCoffeeSynthesis(
      board, otherPos, coffeePos, otherItem, targetColor, 1, rng
    );
    totalScore += result.score;
    rng = result.rngState;
    allCleared.push(...result.clearedPositions);

    return { score: totalScore, rngState: rng, clearedPositions: allCleared };
  }

  // 非コーヒー合成
  board[pos1.row][pos1.col] = null;
  board[pos2.row][pos2.col] = null;

  const excluded = new Set([`${pos1.row},${pos1.col}`, `${pos2.row},${pos2.col}`]);
  const targets = getSynthesisTargets(board, pos2, effect);
  const result = clearTargets(board, targets, rng, excluded);
  totalScore += result.score;
  rng = result.rngState;
  allCleared.push(...result.clearedPositions);

  return { score: totalScore, rngState: rng, clearedPositions: allCleared };
}

/** 虫めがね合成を処理（ユーザー選択後に呼ばれる） */
export function processScopeSynthesis(
  state: GameState,
  pos1: Position,
  pos2: Position,
  targetCells: Position[],
): GameState {
  if (state.isGameOver) return state;

  const cell1 = getCell(state.board, pos1);
  const cell2 = getCell(state.board, pos2);
  if (!cell1?.item || !cell2?.item) return state;

  const synthesis = getSynthesisEffect(cell1.item, cell2.item);
  if (!synthesis) return state;

  const newState = cloneGameState(state);
  const board = newState.board;

  board[pos1.row][pos1.col] = null;
  board[pos2.row][pos2.col] = null;
  newState.moveCount++;

  const synthPos = pos2;
  const effect = synthesis.effect;
  const allCleared: Position[] = [];

  // 合成時: 元の位置(pos1, pos2)で周囲4マス消去を追加発動
  for (const sPos of [pos1, pos2]) {
    const adjTargets = getScopeAdjacentTargets(board, sPos);
    for (const t of adjTargets) {
      const adjCell = getCell(board, t);
      if (!adjCell) continue;
      if (adjCell.obstacle) continue;
      if (adjCell.item) {
        let tc: number | undefined;
        if (adjCell.item === 'flush') {
          tc = findFlushTargetColor(board, t) ?? undefined;
        }
        const result = activateItem(board, t, adjCell.item, tc, 1, newState.rngState);
        newState.score += result.score;
        newState.rngState = result.rngState;
        allCleared.push(...result.clearedPositions);
      } else {
        board[t.row][t.col] = null;
        newState.score += 10;
        allCleared.push(t);
      }
    }
  }

  if (effect === 'scope+scope') {
    // 3マス消去
    for (const target of targetCells) {
      const cell = getCell(board, target);
      if (!cell) continue;
      if (cell.obstacle) {
        // おじゃまタイルを直接選択した場合、耐久値を1減らす
        cell.obstacle.durability--;
        if (cell.obstacle.durability <= 0) {
          board[target.row][target.col] = null;
          allCleared.push(target);
        }
        continue;
      }
      if (cell.item) {
        let targetColor: number | undefined;
        if (cell.item === 'flush') {
          targetColor = findFlushTargetColor(board, target) ?? undefined;
        }
        const result = activateItem(board, target, cell.item, targetColor, 1, newState.rngState);
        newState.score += result.score;
        newState.rngState = result.rngState;
        allCleared.push(...result.clearedPositions);
      } else {
        board[target.row][target.col] = null;
        newState.score += 10;
        allCleared.push(target);
      }
    }
  } else {
    // scope+v_cut, scope+h_cut, scope+burst: 1マス選択→効果発動
    const excluded = new Set([`${pos1.row},${pos1.col}`, `${pos2.row},${pos2.col}`]);
    const targets = getSynthesisTargets(board, synthPos, effect, undefined, targetCells);
    const result = clearTargets(board, targets, newState.rngState, excluded);
    newState.score += result.score;
    newState.rngState = result.rngState;
    allCleared.push(...result.clearedPositions);
  }

  // おじゃまタイルへのダメージ
  newState.rngState = processDamage(board, allCleared, newState.rngState);

  // 落下 → 補充 → 連鎖
  applyGravity(board);
  newState.rngState = fillEmptyCells(board, newState.rngState);
  const chainResult = processChains(board, newState.rngState, 2, newState.mode);
  newState.score += chainResult.score;
  newState.rngState = chainResult.rngState;

  applyGameOver(newState);
  return newState;
}

/** 落下後の連鎖を処理 */
function processChains(
  board: (Cell | null)[][],
  rngState: number,
  startChain: number,
  mode: GameMode = 'sprint',
): { score: number; rngState: number; steps: ChainStep[] } {
  let rng = rngState;
  let totalScore = 0;
  const steps: ChainStep[] = [];
  let chainIndex = startChain;

  while (true) {
    const matches = findMatches(board);
    if (matches.length === 0) break;

    // アイテム生成（連鎖中は中央位置に配置）
    const itemGen = determineItemFromMatches(matches);

    // 消去
    const cleared = getUniquePositions(matches);
    for (const pos of cleared) {
      board[pos.row][pos.col] = null;
    }

    // スコア — Clearモードでは加算しない
    const stepScore = mode !== 'clear' ? calculateStepScore(matches, chainIndex) : 0;
    totalScore += stepScore;

    // アイテム配置
    const generatedItems: { pos: Position; item: ItemType }[] = [];
    if (itemGen) {
      board[itemGen.pos.row][itemGen.pos.col] = { color: 0 as Color, item: itemGen.item };
      generatedItems.push(itemGen);
    }

    steps.push({
      chainIndex,
      matches,
      clearedPositions: cleared,
      generatedItems,
      score: stepScore,
    });

    chainIndex++;

    // おじゃまタイルへのダメージ
    rng = processDamage(board, cleared, rng);

    // 落下 → 補充
    applyGravity(board);
    rng = fillEmptyCells(board, rng);
  }

  return { score: totalScore, rngState: rng, steps };
}
