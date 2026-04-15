import {
  Cell, Color, ItemType, Position, Direction, Action, SynthesisEffect,
  Match, ChainStep, GameState, GameMode, GameInitParams, BOARD_SIZE, NUM_COLORS,
} from './types.js';
import { createRng, nextInt } from './rng.js';
import {
  generateRawBoard, fillEmptyCells, cloneBoard, getCell, isValidPosition, nextColor,
  createColumnRngStates, findItemPosition,
  createSparkleRngStates, placeInitialSparkles,
} from './board.js';
import { findMatches, getUniquePositions, hasMatches } from './match.js';
import { applyGravity } from './gravity.js';
import {
  determineItem, determineItemFromMatches, ITEM_PRIORITY,
  getItemTargets, getSynthesisEffect, getSynthesisTargets,
  findFlushTargetColor, getFlushTargets,
  getVCutTargets, getHCutTargets, getBurstTargets,
  getScopeAdjacentTargets,
} from './item.js';
import { calculateStepScore, getFullClearBonus } from './score.js';
import { checkGameOverState } from './gameOver.js';
import { generateObstacles, damageObstacles, damageObstacleAt, damageAllObstacles } from './obstacle.js';
import {
  computeWavePositions, SURVIVAL_WAVE_INTERVAL, SURVIVAL_MAX_OBSTACLE_DURABILITY,
} from './survival.js';
import type { TraceCollector } from './traceCollector.js';
import { computeDropMoves } from './dropMoves.js';

const DEFAULT_MOVE_LIMIT = 15;
const DEFAULT_CASCADE_MOVE_LIMIT = 15;

/** Cascadeモードの連鎖マイルストーンボーナス定義
 * 1ゲーム中に初めて到達した連鎖数に応じてCPを加算する */
export const CASCADE_MILESTONES: readonly { chain: number; bonus: number }[] = [
  { chain: 3, bonus: 10 },
  { chain: 5, bonus: 25 },
  { chain: 7, bonus: 50 },
];

/** Clear/Survivalモードではおじゃまタイルを固定し、非おじゃまタイルが
 *  すり抜けて落下する（passThroughObstacles=true）。 */
export function isPassThroughMode(mode: GameMode): boolean {
  return mode === 'clear' || mode === 'survival';
}

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
  const numColors = mode === 'cascade' ? (params?.numColors ?? 4) : NUM_COLORS;
  const { board, rngState: mainRng } = generateRawBoard(seed, numColors);
  let rngState = createColumnRngStates(mainRng);

  // 自動消去ループ: マッチがなくなるまで繰り返す
  const passThrough = isPassThroughMode(mode);
  while (hasMatches(board)) {
    const matches = findMatches(board);
    const positions = getUniquePositions(matches);
    for (const pos of positions) {
      board[pos.row][pos.col] = null;
    }
    applyGravity(board, passThrough);
    rngState = fillEmptyCells(board, rngState, numColors);
  }

  const state: GameState = {
    board,
    score: 0,
    rngState,
    moveCount: 0,
    isGameOver: false,
    mode,
    seed,
  };

  if (numColors !== NUM_COLORS) {
    state.numColors = numColors;
  }

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
      // 新仕様: 初期盤面にはおじゃまタイル配置なし。ウェーブ侵食で出現する。
      break;
    case 'cascade':
      state.moveLimit = params?.moveLimit ?? DEFAULT_CASCADE_MOVE_LIMIT;
      state.maxChainIndex = 0;
      state.cascadePoints = 0;
      state.milestonesClaimed = [];
      placeInitialSparkles(board, seed);
      state.sparkleRngState = createSparkleRngStates(seed);
      break;
  }

  return state;
}

/** GameStateのディープコピー */
export function cloneGameState(state: GameState): GameState {
  return {
    board: cloneBoard(state.board),
    score: state.score,
    rngState: [...state.rngState],
    moveCount: state.moveCount,
    isGameOver: state.isGameOver,
    mode: state.mode,
    seed: state.seed,
    moveLimit: state.moveLimit,
    isCleared: state.isCleared,
    numColors: state.numColors,
    maxChainIndex: state.maxChainIndex,
    cascadePoints: state.cascadePoints,
    milestonesClaimed: state.milestonesClaimed ? [...state.milestonesClaimed] : undefined,
    sparkleRngState: state.sparkleRngState ? [...state.sparkleRngState] : undefined,
    lastChainCount: state.lastChainCount,
  };
}

/** 消去ループ前にflushの隣接色をスナップショットする（誘爆時の空振り防止） */
function snapshotFlushColors(board: (Cell | null)[][], targets: Position[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of targets) {
    const cell = board[t.row]?.[t.col];
    if (cell?.item === 'flush' && !cell.obstacle) {
      const color = findFlushTargetColor(board, t);
      if (color !== null) map.set(`${t.row},${t.col}`, color);
    }
  }
  return map;
}

/** アイテムを起動し、効果範囲の対象を消去・誘爆する */
function activateItem(
  board: (Cell | null)[][],
  pos: Position,
  item: ItemType,
  targetColor: number | undefined,
  chainIndex: number,
  rngState: number[],
  targetCells?: Position[],
  collector?: TraceCollector,
): { score: number; rngState: number[]; chainSteps: ChainStep[]; clearedPositions: Position[] } {
  const activated = new Set<string>();
  const chainSteps: ChainStep[] = [];
  let totalScore = 0;
  const rng = rngState; // アイテム発動中はRNG不使用（補充なし）
  const allCleared: Position[] = [];

  // 再帰的に誘爆を処理するキュー（depth 追跡付き）
  const queue: { pos: Position; item: ItemType; targetColor?: number; targetCells?: Position[]; depth: number }[] = [
    { pos, item, targetColor, targetCells, depth: 0 },
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
    const detonations: { pos: Position; item: ItemType }[] = [];

    const flushColors = snapshotFlushColors(board, targets);

    for (const t of targets) {
      const tCell = board[t.row]?.[t.col];
      if (tCell === null) continue;
      if (tCell.obstacle) {
        if (damageObstacleAt(board, t)) allCleared.push(t);
        continue;
      }
      if (tCell.item) {
        // 誘爆キューに追加（flushはスナップショットした色を渡す）
        const tKey = `${t.row},${t.col}`;
        if (!activated.has(tKey)) {
          const preColor = tCell.item === 'flush' ? flushColors.get(tKey) : undefined;
          detonations.push({ pos: t, item: tCell.item });
          queue.push({ pos: t, item: tCell.item, targetColor: preColor, depth: current.depth + 1 });
        }
      } else {
        board[t.row][t.col] = null;
        cleared.push(t);
      }
    }

    allCleared.push(...cleared);

    const score = 10 * cleared.length * chainIndex;
    if (cleared.length > 0) {
      totalScore += score;
      chainSteps.push({
        chainIndex,
        matches: [],
        clearedPositions: cleared,
        generatedItems: [],
        score,
      });
    }

    // collector: アイテム効果を通知
    if (collector?.onItemEffect) {
      collector.onItemEffect({
        itemType: current.item,
        itemPos: current.pos,
        targets: cleared,
        detonations,
        depth: current.depth,
        score,
      });
    }
  }

  return { score: totalScore, rngState: rng, chainSteps, clearedPositions: allCleared };
}

/** サラダボウル+アイテム合成: 対象色の全タイルからアイテム効果を発動 */
function activateCoffeeSynthesis(
  board: (Cell | null)[][],
  pos: Position,
  coffeePos: Position,
  otherItem: ItemType,
  targetColor: number,
  chainIndex: number,
  rngState: number[],
  collector?: TraceCollector,
): { score: number; rngState: number[]; chainSteps: ChainStep[]; clearedPositions: Position[] } {
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

    const flushColors = snapshotFlushColors(board, targets);

    const cleared: Position[] = [];
    for (const t of targets) {
      const cell = board[t.row]?.[t.col];
      if (cell === null) continue;
      if (cell.obstacle) {
        if (damageObstacleAt(board, t)) allCleared.push(t);
        continue;
      }
      if (cell.item) {
        // 誘爆（flushはスナップショットした色を渡す）
        const key = `${t.row},${t.col}`;
        if (!activated.has(key)) {
          activated.add(key);
          const preColor = cell.item === 'flush' ? flushColors.get(key) : undefined;
          const result = activateItem(board, t, cell.item, preColor, chainIndex, rng, undefined, collector);
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

/** おじゃまタイルへのダメージ処理（消去位置に基づく）
 * boardを直接変更する: 隣接おじゃまの耐久値減少・破壊時のgravity・補充
 * @returns 更新後のrngState */
export function processDamage(board: (Cell | null)[][], clearedPositions: Position[], rngState: number[], mode: GameMode = 'sprint', numColors: number = NUM_COLORS): number[] {
  if (clearedPositions.length === 0) return rngState;
  let rng = rngState;
  const destroyed = damageObstacles(board, clearedPositions);
  if (destroyed.length > 0) {
    applyGravity(board, isPassThroughMode(mode));
    rng = fillEmptyCells(board, rng, numColors);
  }
  return rng;
}

/** cascade モードの maxChainIndex と cascadePoints を更新 */
function updateMaxChain(state: GameState, steps: ChainStep[]): void {
  let maxInAction = 0;
  for (const step of steps) {
    if (step.chainIndex > maxInAction) {
      maxInAction = step.chainIndex;
    }
    // Cascade points: accumulate chainIndex for chains >= 2
    if (state.cascadePoints !== undefined && step.chainIndex >= 2) {
      state.cascadePoints += step.chainIndex;
    }
    // キラキラボーナス: 消去されたキラキラ個数分 +1 CP
    if (state.cascadePoints !== undefined && step.sparkleCount) {
      state.cascadePoints += step.sparkleCount;
    }
  }
  state.lastChainCount = maxInAction;

  if (state.maxChainIndex !== undefined && maxInAction > state.maxChainIndex) {
    state.maxChainIndex = maxInAction;
  }

  // マイルストーンボーナス: 初到達の連鎖数に応じてCP加算
  if (state.milestonesClaimed !== undefined && state.cascadePoints !== undefined) {
    for (const ms of CASCADE_MILESTONES) {
      if (maxInAction >= ms.chain && !state.milestonesClaimed.includes(ms.chain)) {
        state.cascadePoints += ms.bonus;
        state.milestonesClaimed.push(ms.chain);
      }
    }
  }
}

/** ゲーム終了チェック */
function applyGameOver(state: GameState): void {
  const result = checkGameOverState(state);
  if (result.gameOver) state.isGameOver = true;
  if (result.isCleared !== undefined) state.isCleared = result.isCleared;
}

/** Survivalウェーブ侵食を盤面に適用する。
 *
 * 侵食位置 (シード×ウェーブ番号から決定論的に算出) を処理順に走査し:
 *  1. 既存おじゃまタイル → 耐久値+1 (MAX到達で gameOver=true)
 *  2. アイテム → 強制発動 (スプーンは周囲4マスのみ、flushは自動targetColor)
 *     → アイテム発動後の落下・補充・連鎖処理を行い、最後にその位置へ耐久値1のおじゃまを上書き設置
 *  3. 通常タイル (または空) → そのまま耐久値1のおじゃま設置
 *
 * boardを直接変更する。戻り値の gameOver=true の場合は呼び出し側で state.isGameOver を立てる。
 * 公開されているのはテスト向け。通常は finalizeMove から呼ばれる。
 */
export function applyWave(
  board: (Cell | null)[][],
  seed: number,
  waveNumber: number,
  rngState: number[],
  numColors: number,
  collector?: TraceCollector,
): { score: number; rngState: number[]; gameOver: boolean } {
  const positions = computeWavePositions(seed, waveNumber);
  let rng = rngState;
  let totalScore = 0;
  let gameOver = false;

  // --- フェーズ1: 全位置にお邪魔タイルを配置（アイテムは保存して後で発動） ---
  const deferredItems: { pos: Position; item: ItemType }[] = [];

  for (const pos of positions) {
    const cell = board[pos.row]?.[pos.col];

    // Case 1: 既存のおじゃまタイル → 耐久値+1
    if (cell?.obstacle) {
      cell.obstacle.durability += 1;
      if (cell.obstacle.durability >= SURVIVAL_MAX_OBSTACLE_DURABILITY) {
        gameOver = true;
      }
      if (collector?.onWaveStep) {
        collector.onWaveStep({
          pos, kind: 'bump',
          newDurability: cell.obstacle.durability,
          boardAfter: cloneBoard(board),
          score: 0,
        });
      }
      continue;
    }

    // Case 2: アイテム → 保存してからおじゃま設置（発動はフェーズ2で）
    if (cell?.item) {
      deferredItems.push({ pos, item: cell.item });
    }

    // Case 2 & 3: おじゃまタイル設置（アイテム位置も通常タイル位置も同じ処理）
    const color: Color = ((cell?.color ?? 0) as Color);
    board[pos.row][pos.col] = { color, obstacle: { durability: 1 } };
    if (collector?.onWaveStep) {
      collector.onWaveStep({
        pos, kind: 'place',
        boardAfter: cloneBoard(board),
        score: 0,
      });
    }
  }

  // --- フェーズ2: 保存したアイテムを順に強制発動 ---
  for (const { pos, item } of deferredItems) {
    // おじゃまタイルを一時的に除去してアイテムを発動
    board[pos.row][pos.col] = null;
    let stepScore = 0;

    if (item === 'scope') {
      const adjTargets = getScopeAdjacentTargets(board, pos);
      for (const t of adjTargets) {
        const adjCell = board[t.row]?.[t.col];
        if (!adjCell) continue;
        if (adjCell.obstacle) {
          damageObstacleAt(board, t);
          continue;
        }
        if (adjCell.item) {
          let tc: number | undefined;
          if (adjCell.item === 'flush') {
            tc = findFlushTargetColor(board, t) ?? undefined;
          }
          const r = activateItem(board, t, adjCell.item, tc, 1, rng, undefined, collector);
          stepScore += r.score;
          rng = r.rngState;
        } else {
          board[t.row][t.col] = null;
          stepScore += 10;
        }
      }
    } else if (item === 'flush') {
      const targetColor = findFlushTargetColor(board, pos) ?? undefined;
      if (targetColor !== undefined) {
        const result = activateItem(board, pos, item, targetColor, 1, rng, undefined, collector);
        stepScore += result.score;
        rng = result.rngState;
      }
    } else {
      const result = activateItem(board, pos, item, undefined, 1, rng, undefined, collector);
      stepScore += result.score;
      rng = result.rngState;
    }

    totalScore += stepScore;

    // collector: gravity 前に dropMoves を計算
    const dropData = collector?.onWaveStep
      ? computeDropMoves(board, true)
      : undefined;

    // 落下 → 補充 → 連鎖（Survivalは Clearと同じく passThrough）
    applyGravity(board, true);
    rng = fillEmptyCells(board, rng, numColors);
    const chainResult = processChains(board, rng, 2, 'survival', false, numColors, collector);
    totalScore += chainResult.score;
    rng = chainResult.rngState;

    if (collector?.onWaveStep) {
      collector.onWaveStep({
        pos, kind: 'item_activate',
        dropMoves: dropData?.moves,
        newTileEntries: dropData?.newTileEntries,
        boardAfter: cloneBoard(board),
        score: stepScore + chainResult.score,
      });
    }
  }

  // 全位置処理後に盤面を再チェック: アイテム強制発動で耐久値が下がった場合を反映
  if (gameOver) {
    gameOver = false;
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length; c++) {
        const cell = board[r][c];
        if (cell?.obstacle && cell.obstacle.durability >= SURVIVAL_MAX_OBSTACLE_DURABILITY) {
          gameOver = true;
          break;
        }
      }
      if (gameOver) break;
    }
  }

  return { score: totalScore, rngState: rng, gameOver };
}

/** Survivalウェーブを必要に応じて適用してから gameOver 判定を行う共通ヘルパー。
 *  processAction/processScopeSynthesis 等の末尾で applyGameOver の代わりに呼ぶ。 */
function finalizeMove(state: GameState, collector?: TraceCollector): void {
  if (state.mode === 'survival'
      && state.seed !== undefined
      && state.moveCount > 0
      && state.moveCount % SURVIVAL_WAVE_INTERVAL === 0) {
    const waveNumber = state.moveCount / SURVIVAL_WAVE_INTERVAL;
    const nc = state.numColors ?? NUM_COLORS;
    const result = applyWave(state.board, state.seed, waveNumber, state.rngState, nc, collector);
    state.score += result.score;
    state.rngState = result.rngState;
    if (result.gameOver) {
      state.isGameOver = true;
    }
  }
  applyGameOver(state);
}

/** プレイヤーの操作を処理して新しいGameStateを返す */
export function processAction(state: GameState, action: Action, collector?: TraceCollector): GameState {
  if (state.isGameOver) return state;

  const newState = cloneGameState(state);
  newState.lastChainCount = 0;
  const board = newState.board;
  const nc = newState.numColors ?? NUM_COLORS;

  if (action.type === 'scope') {
    // scope起動: タップで1手消費、周囲4マス消去 + ユーザー選択マスを消去
    const cell = getCell(board, action.pos);
    if (!cell?.item || cell.item !== 'scope') return state;

    board[action.pos.row][action.pos.col] = null;
    newState.moveCount++;

    const allCleared: Position[] = [];

    // まず周囲上下左右4マスを消去
    const adjTargets = getScopeAdjacentTargets(board, action.pos);
    collector?.onScopeAdjacent?.(adjTargets);
    for (const t of adjTargets) {
      const adjCell = getCell(board, t);
      if (!adjCell) continue;
      if (adjCell.obstacle) {
        if (damageObstacleAt(board, t)) allCleared.push(t);
        continue;
      }
      if (adjCell.item) {
        let tc: number | undefined;
        if (adjCell.item === 'flush') {
          tc = findFlushTargetColor(board, t) ?? undefined;
        }
        const result = activateItem(board, t, adjCell.item, tc, 1, newState.rngState, undefined, collector);
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
        if (damageObstacleAt(board, target)) allCleared.push(target);
        continue;
      }
      if (targetCell.item) {
        let targetColor: number | undefined;
        if (targetCell.item === 'flush') {
          targetColor = findFlushTargetColor(board, target) ?? undefined;
        }
        const result = activateItem(board, target, targetCell.item, targetColor, 1, newState.rngState, undefined, collector);
        newState.score += result.score;
        newState.rngState = result.rngState;
        allCleared.push(...result.clearedPositions);
      } else {
        board[target.row][target.col] = null;
        newState.score += 10;
        allCleared.push(target);
      }
    }

    // collector: 消去完了後の盤面スナップショット
    collector?.onBoardSnapshot?.('boardAfterClear', cloneBoard(board));

    // collector: gravity 前に dropMoves を計算
    if (collector?.onDropData) {
      const dm = computeDropMoves(board, isPassThroughMode(newState.mode));
      collector.onDropData(dm.moves, dm.newTileEntries);
    }

    // 落下 → 補充 → 連鎖（おじゃまダメージはアイテム効果内で直接処理済み）
    applyGravity(board, isPassThroughMode(newState.mode));
    newState.rngState = fillEmptyCells(board, newState.rngState, nc, newState.sparkleRngState);

    // collector: gravity + fill 後の盤面スナップショット
    collector?.onBoardSnapshot?.('afterItemDrop', cloneBoard(board));

    const chainResult = processChains(board, newState.rngState, 2, newState.mode, false, nc, collector, newState.sparkleRngState);
    newState.score += chainResult.score;
    newState.rngState = chainResult.rngState;

    updateMaxChain(newState, chainResult.steps);
    finalizeMove(newState, collector);
    return newState;
  }

  if (action.type === 'tap') {
    // タップ: アイテム起動
    const cell = getCell(board, action.pos);
    if (!cell?.item) return state; // アイテムがなければ無効
    if (cell.obstacle) return state; // おじゃまタイルはタップ不可

    const item = cell.item;

    // スプーンはtapでは起動しない（scope actionを使う）
    if (item === 'scope') return state;

    let targetColor: number | undefined;
    if (item === 'flush') {
      targetColor = findFlushTargetColor(board, action.pos) ?? undefined;
      if (targetColor === undefined) return state;
    }

    collector?.onBoardSnapshot?.('beforeItemActivation', cloneBoard(board));
    const result = activateItem(board, action.pos, item, targetColor, 1, newState.rngState, undefined, collector);
    newState.score += result.score;
    newState.rngState = result.rngState;
    newState.moveCount++;

    // collector: gravity 前に dropMoves を計算
    if (collector?.onDropData) {
      const dm = computeDropMoves(board, isPassThroughMode(newState.mode));
      collector.onDropData(dm.moves, dm.newTileEntries);
    }

    // 落下 → 補充 → 連鎖（おじゃまダメージはアイテム効果内で直接処理済み）
    applyGravity(board, isPassThroughMode(newState.mode));
    newState.rngState = fillEmptyCells(board, newState.rngState, nc, newState.sparkleRngState);

    // collector: gravity + fill 後の盤面スナップショット
    collector?.onBoardSnapshot?.('afterItemDrop', cloneBoard(board));

    const chainResult = processChains(board, newState.rngState, 2, newState.mode, false, nc, collector, newState.sparkleRngState);
    newState.score += chainResult.score;
    newState.rngState = chainResult.rngState;
    updateMaxChain(newState, chainResult.steps);

  } else {
    // スワイプ
    const targetPos = getAdjacentPos(action.pos, action.dir);
    if (!isValidPosition(targetPos)) return state;

    const cell1 = getCell(board, action.pos);
    const cell2 = getCell(board, targetPos);
    if (!cell1 || !cell2) return state;

    // アイテム合成チェック
    if (cell1.item && cell2.item) {
      const synthesis = getSynthesisEffect(cell1.item, cell2.item);
      if (synthesis) {
        // スプーン合成でユーザー選択が必要な場合は無効（別Actionで処理）
        if (synthesis.effect === 'scope+scope' ||
            synthesis.effect === 'scope+v_cut' ||
            synthesis.effect === 'scope+h_cut' ||
            synthesis.effect === 'scope+burst') {
          return state; // フロントエンドが scope_synthesis アクションを送る
        }

        collector?.onBoardSnapshot?.('afterSwap', cloneBoard(board));

        const synthResult = processSynthesis(
          board, action.pos, targetPos, cell1.item, cell2.item,
          synthesis.effect, newState.rngState, newState.mode, nc, collector
        );
        newState.score += synthResult.score;
        newState.rngState = synthResult.rngState;
        newState.moveCount++;

        // collector: gravity 前に dropMoves を計算
        if (collector?.onDropData) {
          const dm = computeDropMoves(board, isPassThroughMode(newState.mode));
          collector.onDropData(dm.moves, dm.newTileEntries);
        }

        // 落下 → 補充 → 連鎖（おじゃまダメージはアイテム効果内で直接処理済み）
        applyGravity(board, isPassThroughMode(newState.mode));
        newState.rngState = fillEmptyCells(board, newState.rngState, nc, newState.sparkleRngState);

        // collector: gravity + fill 後の盤面スナップショット
        collector?.onBoardSnapshot?.('afterItemDrop', cloneBoard(board));

        const chainResult = processChains(board, newState.rngState, 2, newState.mode, false, nc, collector, newState.sparkleRngState);
        newState.score += chainResult.score;
        newState.rngState = chainResult.rngState;

        updateMaxChain(newState, chainResult.steps);
        finalizeMove(newState, collector);
        return newState;
      }
    }

    // アイテムとのスワイプ（アイテム起動）
    if (cell1.item || cell2.item) {
      const itemCell = cell1.item ? cell1 : cell2;
      const itemPos = cell1.item ? targetPos : action.pos;
      const otherCell = cell1.item ? cell2 : cell1;

      // スプーンはスワイプ起動不可（tapの代わりにscope actionで）
      if (itemCell.item === 'scope') return state;

      // サラダボウル×おじゃまタイル: 全おじゃまの耐久値-1
      if (itemCell.item === 'flush' && otherCell.obstacle) {
        // まず入れ替え（アニメーション用のスナップショットを取るため）
        board[action.pos.row][action.pos.col] = cell2;
        board[targetPos.row][targetPos.col] = cell1;
        collector?.onBoardSnapshot?.('afterSwap', cloneBoard(board));

        // サラダボウルを消去（itemPos = スワップ後のflush位置）
        board[itemPos.row][itemPos.col] = null;
        newState.moveCount++;

        collector?.onBoardSnapshot?.('beforeItemActivation', cloneBoard(board));

        // 全おじゃまに1ダメージ
        const { damaged, destroyed } = damageAllObstacles(board);

        // collector: アイテム効果を通知（アニメーション用）
        collector?.onItemEffect?.({
          itemType: 'flush',
          itemPos: itemPos,
          targets: damaged,
          detonations: [],
          depth: 0,
          score: destroyed.length * 10,
        });

        // 破壊されたおじゃまの位置を消去扱い（スコア加算）
        newState.score += destroyed.length * 10;

        collector?.onBoardSnapshot?.('boardAfterClear', cloneBoard(board));

        const passThrough = isPassThroughMode(newState.mode);

        // collector: gravity 前に dropMoves を計算
        if (collector?.onDropData) {
          const dm = computeDropMoves(board, passThrough);
          collector.onDropData(dm.moves, dm.newTileEntries);
        }

        // 落下 → 補充 → 連鎖
        applyGravity(board, passThrough);
        newState.rngState = fillEmptyCells(board, newState.rngState, nc, newState.sparkleRngState);

        collector?.onBoardSnapshot?.('afterItemDrop', cloneBoard(board));

        const chainResult = processChains(board, newState.rngState, 2, newState.mode, false, nc, collector, newState.sparkleRngState);
        newState.score += chainResult.score;
        newState.rngState = chainResult.rngState;
        updateMaxChain(newState, chainResult.steps);
        finalizeMove(newState, collector);
        return newState;
      }

      // サラダボウルのtargetColorを事前保存（pre-chainで消去される可能性）
      const savedOtherColor = otherCell.item ? undefined : otherCell.color;

      // まず入れ替え
      board[action.pos.row][action.pos.col] = cell2;
      board[targetPos.row][targetPos.col] = cell1;

      collector?.onBoardSnapshot?.('afterSwap', cloneBoard(board));

      const passThrough = isPassThroughMode(newState.mode);

      // #15: 野菜のマッチ判定を先に処理（pre-chains）
      const preChainResult = processChains(board, newState.rngState, 1, newState.mode, false, nc, collector, newState.sparkleRngState);
      newState.score += preChainResult.score;
      newState.rngState = preChainResult.rngState;

      // アイテム位置の再検索（gravity で落下している可能性）
      const currentItemPos = findItemPosition(board, itemCell.item!, itemPos);
      if (!currentItemPos) {
        // アイテムが消滅（pre-chainで誘爆等） — スワップのみ有効
        newState.moveCount++;
        finalizeMove(newState, collector);
        return newState;
      }

      let targetColor: number | undefined;
      if (itemCell.item === 'flush') {
        targetColor = savedOtherColor;
      }

      collector?.onBoardSnapshot?.('beforeItemActivation', cloneBoard(board));
      const result = activateItem(board, currentItemPos, itemCell.item!, targetColor, preChainResult.steps.length + 1, newState.rngState, undefined, collector);
      newState.score += result.score;
      newState.rngState = result.rngState;
      newState.moveCount++;

      // collector: gravity 前に dropMoves を計算
      if (collector?.onDropData) {
        const dm = computeDropMoves(board, passThrough);
        collector.onDropData(dm.moves, dm.newTileEntries);
      }

      // 落下 → 補充 → 連鎖（おじゃまダメージはアイテム効果内で直接処理済み）
      applyGravity(board, passThrough);
      newState.rngState = fillEmptyCells(board, newState.rngState, nc, newState.sparkleRngState);

      // collector: gravity + fill 後の盤面スナップショット
      collector?.onBoardSnapshot?.('afterItemDrop', cloneBoard(board));

      const chainResult = processChains(board, newState.rngState, result.chainSteps.length + preChainResult.steps.length + 1, newState.mode, false, nc, collector, newState.sparkleRngState);
      newState.score += chainResult.score;
      newState.rngState = chainResult.rngState;

      updateMaxChain(newState, preChainResult.steps);
      updateMaxChain(newState, chainResult.steps);
      finalizeMove(newState, collector);
      return newState;
    }

    // 通常スワイプ: 入れ替えてマッチ判定
    board[action.pos.row][action.pos.col] = cell2;
    board[targetPos.row][targetPos.col] = cell1;

    collector?.onBoardSnapshot?.('afterSwap', cloneBoard(board));

    const matches = findMatches(board);
    if (matches.length === 0) {
      // マッチなし: 入れ替えを戻す
      board[action.pos.row][action.pos.col] = cell1;
      board[targetPos.row][targetPos.col] = cell2;
      return state;
    }

    newState.moveCount++;

    // アイテム生成判定
    const itemGens = determineItemFromMatches(matches, [action.pos, targetPos]);

    // マッチ消去（キラキラカウント付き）
    const cleared = getUniquePositions(matches);
    let firstChainSparkle = 0;
    for (const pos of cleared) {
      if (board[pos.row][pos.col]?.sparkle) firstChainSparkle++;
      board[pos.row][pos.col] = null;
    }
    // キラキラCP加算（1連鎖目は updateMaxChain を通らないため直接加算）
    if (newState.cascadePoints !== undefined && firstChainSparkle > 0) {
      newState.cascadePoints += firstChainSparkle;
    }

    // スコア計算（1連鎖目）
    const stepScore = calculateStepScore(matches, 1);
    newState.score += stepScore;

    // アイテム配置
    for (const ig of itemGens) {
      board[ig.pos.row][ig.pos.col] = { color: 0 as Color, item: ig.item };
    }

    // おじゃまタイルへのダメージ
    const passThrough_swap = isPassThroughMode(newState.mode);
    const destroyedObstacles = damageObstacles(board, cleared);
    if (destroyedObstacles.length > 0) {
      applyGravity(board, passThrough_swap);
      newState.rngState = fillEmptyCells(board, newState.rngState, nc, newState.sparkleRngState);
    }

    // collector: gravity 前に dropMoves を計算
    const firstChainDropData = collector?.onChainStep
      ? computeDropMoves(board, passThrough_swap)
      : undefined;

    // 落下 → 補充 → 連鎖
    applyGravity(board, passThrough_swap);
    newState.rngState = fillEmptyCells(board, newState.rngState, nc, newState.sparkleRngState);

    // collector: inline first chain step を通知
    if (collector?.onChainStep) {
      collector.onChainStep({
        chainIndex: 1,
        matches,
        clearedPositions: cleared,
        destroyedObstacles,
        itemGens,
        score: stepScore,
        sparkleCount: firstChainSparkle > 0 ? firstChainSparkle : undefined,
        dropMoves: firstChainDropData!.moves,
        newTileEntries: firstChainDropData!.newTileEntries,
        boardAfterDrop: cloneBoard(board),
      });
    }

    const chainResult = processChains(board, newState.rngState, 2, newState.mode, false, nc, collector, newState.sparkleRngState);
    newState.score += chainResult.score;
    newState.rngState = chainResult.rngState;

    // maxChainIndex 更新 (cascade mode)
    updateMaxChain(newState, chainResult.steps);
  }

  finalizeMove(newState, collector);
  return newState;
}

/** 合成効果を処理 */
/** Clear targets, activating any items encountered. Returns updated score and rng. */
function clearTargets(
  board: (Cell | null)[][],
  targets: Position[],
  rngState: number[],
  excludePositions?: Set<string>,
  collector?: TraceCollector,
): { score: number; rngState: number[]; clearedPositions: Position[] } {
  let rng = rngState;
  let score = 0;
  let cleared = 0;
  const activated = excludePositions ?? new Set<string>();
  const allCleared: Position[] = [];

  const flushColors = snapshotFlushColors(board, targets);

  for (const t of targets) {
    const cell = board[t.row]?.[t.col];
    if (cell === null) continue;
    if (cell.obstacle) {
      if (damageObstacleAt(board, t)) allCleared.push(t);
      continue;
    }
    if (cell.item) {
      const key = `${t.row},${t.col}`;
      if (!activated.has(key)) {
        activated.add(key);
        const preColor = cell.item === 'flush' ? flushColors.get(key) : undefined;
        const result = activateItem(board, t, cell.item, preColor, 1, rng, undefined, collector);
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
  effect: SynthesisEffect,
  rngState: number[],
  mode: GameMode = 'sprint',
  numColors: number = NUM_COLORS,
  collector?: TraceCollector,
): { score: number; rngState: number[]; clearedPositions: Position[] } {
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

    collector?.onSynthesisEffect?.({
      effectType: effect, item1, item2, pos1, pos2,
      targets: allCleared, detonations: [], score: getFullClearBonus(),
    });

    applyGravity(board, isPassThroughMode(mode));
    rng = fillEmptyCells(board, rng, numColors);

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
    const flushColors = snapshotFlushColors(board, targets);
    for (const t of targets) {
      const cell = board[t.row]?.[t.col];
      if (cell === null) continue;
      if (cell.obstacle) {
        if (damageObstacleAt(board, t)) allCleared.push(t);
        continue;
      }
      if (cell.item) {
        const preColor = cell.item === 'flush' ? flushColors.get(`${t.row},${t.col}`) : undefined;
        const result = activateItem(board, t, cell.item, preColor, 1, rng, undefined, collector);
        totalScore += result.score;
        rng = result.rngState;
        allCleared.push(...result.clearedPositions);
      } else {
        board[t.row][t.col] = null;
        allCleared.push(t);
      }
    }
    totalScore += 10 * targets.length;

    collector?.onSynthesisEffect?.({
      effectType: effect, item1, item2, pos1, pos2,
      targets: allCleared, detonations: [], score: totalScore,
    });

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
      board, otherPos, coffeePos, otherItem, targetColor, 1, rng, collector
    );
    totalScore += result.score;
    rng = result.rngState;
    allCleared.push(...result.clearedPositions);

    collector?.onSynthesisEffect?.({
      effectType: effect, item1, item2, pos1, pos2,
      targets: allCleared, detonations: [], score: totalScore,
    });

    return { score: totalScore, rngState: rng, clearedPositions: allCleared };
  }

  // 非サラダボウル合成
  board[pos1.row][pos1.col] = null;
  board[pos2.row][pos2.col] = null;

  const excluded = new Set([`${pos1.row},${pos1.col}`, `${pos2.row},${pos2.col}`]);
  const targets = getSynthesisTargets(board, pos2, effect);
  const result = clearTargets(board, targets, rng, excluded, collector);
  totalScore += result.score;
  rng = result.rngState;
  allCleared.push(...result.clearedPositions);

  collector?.onSynthesisEffect?.({
    effectType: effect, item1, item2, pos1, pos2,
    targets: allCleared, detonations: [], score: totalScore,
  });

  return { score: totalScore, rngState: rng, clearedPositions: allCleared };
}

/** スプーン合成を処理（ユーザー選択後に呼ばれる） */
export function processScopeSynthesis(
  state: GameState,
  pos1: Position,
  pos2: Position,
  targetCells: Position[],
  collector?: TraceCollector,
): GameState {
  if (state.isGameOver) return state;

  const cell1 = getCell(state.board, pos1);
  const cell2 = getCell(state.board, pos2);
  if (!cell1?.item || !cell2?.item) return state;

  const synthesis = getSynthesisEffect(cell1.item, cell2.item);
  if (!synthesis) return state;

  const newState = cloneGameState(state);
  newState.lastChainCount = 0;
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
    collector?.onScopeAdjacent?.(adjTargets);
    for (const t of adjTargets) {
      const adjCell = getCell(board, t);
      if (!adjCell) continue;
      if (adjCell.obstacle) {
        if (damageObstacleAt(board, t)) allCleared.push(t);
        continue;
      }
      if (adjCell.item) {
        let tc: number | undefined;
        if (adjCell.item === 'flush') {
          tc = findFlushTargetColor(board, t) ?? undefined;
        }
        const result = activateItem(board, t, adjCell.item, tc, 1, newState.rngState, undefined, collector);
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
        if (damageObstacleAt(board, target)) allCleared.push(target);
        continue;
      }
      if (cell.item) {
        let targetColor: number | undefined;
        if (cell.item === 'flush') {
          targetColor = findFlushTargetColor(board, target) ?? undefined;
        }
        const result = activateItem(board, target, cell.item, targetColor, 1, newState.rngState, undefined, collector);
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
    const result = clearTargets(board, targets, newState.rngState, excluded, collector);
    newState.score += result.score;
    newState.rngState = result.rngState;
    allCleared.push(...result.clearedPositions);
  }

  // collector: 消去完了後の盤面スナップショット
  collector?.onBoardSnapshot?.('boardAfterClear', cloneBoard(board));

  // collector: gravity 前に dropMoves を計算
  if (collector?.onDropData) {
    const dm = computeDropMoves(board, isPassThroughMode(newState.mode));
    collector.onDropData(dm.moves, dm.newTileEntries);
  }

  // 落下 → 補充 → 連鎖（おじゃまダメージはアイテム効果内で直接処理済み）
  const nc = newState.numColors ?? NUM_COLORS;
  applyGravity(board, isPassThroughMode(newState.mode));
  newState.rngState = fillEmptyCells(board, newState.rngState, nc, newState.sparkleRngState);

  // collector: gravity + fill 後の盤面スナップショット
  collector?.onBoardSnapshot?.('afterItemDrop', cloneBoard(board));

  const chainResult = processChains(board, newState.rngState, 2, newState.mode, false, nc, collector, newState.sparkleRngState);
  newState.score += chainResult.score;
  newState.rngState = chainResult.rngState;

  updateMaxChain(newState, chainResult.steps);
  finalizeMove(newState, collector);
  return newState;
}

/** #15: スプーンと野菜を入れ替え後、pre-chainsを処理してからscope発動 */
export function processScopeSwap(
  state: GameState, pos: Position, dir: Direction, targetCells: Position[],
  collector?: TraceCollector,
): GameState {
  if (state.isGameOver) return state;

  const newState = cloneGameState(state);
  newState.lastChainCount = 0;
  const board = newState.board;

  const targetPos = getAdjacentPos(pos, dir);
  if (!isValidPosition(targetPos)) return state;

  const cell1 = getCell(board, pos);
  const cell2 = getCell(board, targetPos);
  if (!cell1 || !cell2) return state;

  // Swap cells
  board[pos.row][pos.col] = cell2;
  board[targetPos.row][targetPos.col] = cell1;

  // Pre-chains: process matches created by the vegetable swap
  const nc = newState.numColors ?? NUM_COLORS;
  const preChainResult = processChains(board, newState.rngState, 1, newState.mode, false, nc, collector, newState.sparkleRngState);
  newState.score += preChainResult.score;
  newState.rngState = preChainResult.rngState;
  updateMaxChain(newState, preChainResult.steps);

  // Re-find scope position after gravity
  const origScopePos = cell1?.item === 'scope' ? targetPos : pos;
  const scopePos = findItemPosition(board, 'scope', origScopePos);
  if (!scopePos) {
    // Scope was destroyed during pre-chains
    newState.moveCount++;
    finalizeMove(newState, collector);
    return newState;
  }

  // Now process scope action on the post-pre-chain state
  return processAction(newState, { type: 'scope', pos: scopePos, targetCells }, collector);
}

/** Sprint終了時の残存アイテム自動発動（1アイテムのみ）。moveCountを増やさず、連鎖なし。
 *  最初に見つかったscope以外のアイテムを1つ発動し、新しいGameStateを返す。
 *  アイテムが見つからなければnullを返す。 */
export function processAutoActivationStep(state: GameState, collector?: TraceCollector): GameState | null {
  if (state.mode !== 'sprint') return null;

  const current = cloneGameState(state);
  const board = current.board;

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = board[r][c];
      if (!cell?.item) continue;
      if (cell.item === 'scope') continue; // スプーンは自動発動しない（ユーザー選択が必要）
      const pos = { row: r, col: c };
      let targetColor: number | undefined;
      if (cell.item === 'flush') {
        targetColor = findFlushTargetColor(board, pos) ?? undefined;
        if (targetColor === undefined) continue;
      }
      collector?.onBoardSnapshot?.('beforeItemActivation', cloneBoard(board));
      const result = activateItem(board, pos, cell.item, targetColor, 1, current.rngState, undefined, collector);
      current.score += result.score;
      current.rngState = result.rngState;

      // collector: gravity 前に dropMoves を計算
      if (collector?.onDropData) {
        const dm = computeDropMoves(board, false);
        collector.onDropData(dm.moves, dm.newTileEntries);
      }

      applyGravity(board, false);
      current.rngState = fillEmptyCells(board, current.rngState, current.numColors ?? NUM_COLORS);

      // collector: gravity + fill 後の盤面スナップショット
      collector?.onBoardSnapshot?.('afterItemDrop', cloneBoard(board));

      // 連鎖処理なし — アイテム効果のスコアのみ加算（#9: スキル要素を損なうランダム連鎖を抑制）
      return current;
    }
  }

  return null;
}

/** Sprint終了時の残存アイテム自動発動（全アイテム）。moveCountを増やさず、新アイテム生成を抑制する。 */
export function processAutoActivation(state: GameState, collector?: TraceCollector): GameState {
  if (state.mode !== 'sprint') return state;
  let current = state;
  let next = processAutoActivationStep(current, collector);
  while (next) {
    current = next;
    next = processAutoActivationStep(current, collector);
  }
  return current;
}

/** 落下後の連鎖を処理
 * @param suppressItemGen true なら連鎖中のアイテム生成を抑制（Sprint終了時の自動発動用）
 */
function processChains(
  board: (Cell | null)[][],
  rngState: number[],
  startChain: number,
  mode: GameMode = 'sprint',
  suppressItemGen = false,
  numColors: number = NUM_COLORS,
  collector?: TraceCollector,
  sparkleRngStates?: number[],
): { score: number; rngState: number[]; steps: ChainStep[] } {
  let rng = rngState;
  let totalScore = 0;
  const steps: ChainStep[] = [];
  let chainIndex = startChain;
  const passThrough = isPassThroughMode(mode);

  const MAX_CHAIN_ITERATIONS = 20;
  let iterations = 0;
  while (true) {
    const matches = findMatches(board);
    if (matches.length === 0) break;

    iterations++;
    if (iterations > MAX_CHAIN_ITERATIONS) {
      // 連鎖上限到達: 残りのマッチをスコアなしで安定化
      while (true) {
        const m = findMatches(board);
        if (m.length === 0) break;
        const c = getUniquePositions(m);
        for (const p of c) board[p.row][p.col] = null;
        rng = processDamage(board, c, rng, mode, numColors);
        applyGravity(board, passThrough);
        rng = fillEmptyCells(board, rng, numColors, sparkleRngStates);
      }
      break;
    }

    // アイテム生成判定
    const itemGens = suppressItemGen ? [] : determineItemFromMatches(matches);

    // 消去（キラキラカウント付き）
    const cleared = getUniquePositions(matches);
    let sparkleCount = 0;
    for (const pos of cleared) {
      if (board[pos.row][pos.col]?.sparkle) sparkleCount++;
      board[pos.row][pos.col] = null;
    }

    // スコア
    const stepScore = calculateStepScore(matches, chainIndex);
    totalScore += stepScore;

    // アイテムを即座に配置（重力前）— findMatchesはitem付きセルをスキップするため
    // 後続の連鎖マッチに影響せず、重力で正しい位置に落下する
    const generatedItems: { pos: Position; item: ItemType }[] = [];
    for (const ig of itemGens) {
      board[ig.pos.row][ig.pos.col] = { color: 0 as Color, item: ig.item };
      generatedItems.push(ig);
    }

    steps.push({
      chainIndex,
      matches,
      clearedPositions: cleared,
      generatedItems,
      score: stepScore,
      sparkleCount: sparkleCount > 0 ? sparkleCount : undefined,
    });

    chainIndex++;

    // おじゃまタイルへのダメージ
    const destroyed = damageObstacles(board, cleared);
    if (destroyed.length > 0) {
      applyGravity(board, passThrough);
      rng = fillEmptyCells(board, rng, numColors, sparkleRngStates);
    }

    // collector: gravity 前に dropMoves を計算
    const dropData = collector?.onChainStep
      ? computeDropMoves(board, passThrough)
      : undefined;

    // 落下 → 補充
    applyGravity(board, passThrough);
    rng = fillEmptyCells(board, rng, numColors, sparkleRngStates);

    // collector: chain step 完了を通知
    if (collector?.onChainStep) {
      collector.onChainStep({
        chainIndex: chainIndex - 1,
        matches,
        clearedPositions: cleared,
        destroyedObstacles: destroyed,
        itemGens: generatedItems,
        score: stepScore,
        sparkleCount: sparkleCount > 0 ? sparkleCount : undefined,
        dropMoves: dropData!.moves,
        newTileEntries: dropData!.newTileEntries,
        boardAfterDrop: cloneBoard(board),
      });
    }
  }

  return { score: totalScore, rngState: rng, steps };
}
