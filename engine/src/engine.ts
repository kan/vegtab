import {
  Cell, Color, ItemType, Position, Direction, Action, ReplayAction, SynthesisEffect,
  ChainStep, GameState, GameInitParams, BOARD_SIZE,
} from './types.js';
import {
  generateRawBoard, fillEmptyCells, cloneBoard, getCell, isValidPosition,
  createColumnRngStates, findItemPosition,
} from './board.js';
import { findMatches, getUniquePositions, hasMatches } from './match.js';
import { applyGravity } from './gravity.js';
import {
  determineItemFromMatches,
  getItemTargets, getSynthesisEffect, getSynthesisTargets,
  findFlushTargetColor, getFlushTargets,
  getVCutTargets, getHCutTargets, getBurstTargets,
  getScopeAdjacentTargets,
} from './item.js';
import { calculateStepScore, getFullClearBonus } from './score.js';
import { checkGameOverState } from './gameOver.js';
import { generateObstacles, damageObstacles, damageObstacleAt, damageAllObstacles } from './obstacle.js';
import type { TraceCollector } from './traceCollector.js';
import { computeDropMoves } from './dropMoves.js';

/**
 * 「マッチがなくなるまで消して補充する」ループの安全弁。
 *
 * 列RNGが独立していれば数回〜十数回で収束するため、この上限に達すること自体が
 * バグの兆候。到達した場合は盤面にマッチが残るが、次の操作で解消される。
 * 無限ループでブラウザやWorkerを固めるよりは望ましいので break する。
 */
export const MAX_STABILIZE_ITERATIONS = 200;

/** 方向から隣接位置を計算（盤の外の位置も返す） */
export function getAdjacentPos(pos: Position, dir: Direction): Position {
  switch (dir) {
    case 'up': return { row: pos.row - 1, col: pos.col };
    case 'down': return { row: pos.row + 1, col: pos.col };
    case 'left': return { row: pos.row, col: pos.col - 1 };
    case 'right': return { row: pos.row, col: pos.col + 1 };
  }
}

/** ユーザーのマス選択を伴うスプーン合成（scope_synthesis アクションで処理する） */
const SCOPE_SELECTION_EFFECTS: ReadonlySet<SynthesisEffect> = new Set([
  'scope+scope', 'scope+v_cut', 'scope+h_cut', 'scope+burst',
]);

/** 盤面内の整数座標か。リプレイログ由来の値も受けるので型を信用しない */
function isBoardPosition(pos: unknown): pos is Position {
  const p = pos as Position | null;
  return !!p && Number.isInteger(p.row) && Number.isInteger(p.col) && isValidPosition(p);
}

/** スプーンの選択マスが「盤面内・重複なし・指定個数ちょうど」か */
function isValidTargetCells(targetCells: unknown, expected: number): targetCells is Position[] {
  if (!Array.isArray(targetCells) || targetCells.length !== expected) return false;
  const keys = new Set<string>();
  for (const p of targetCells) {
    if (!isBoardPosition(p)) return false;
    keys.add(`${p.row},${p.col}`);
  }
  return keys.size === expected;
}

/** 初期盤面を生成（自動消去込み、スコア0・アイテムなし）し、おじゃまタイルを配置する */
export function initializeGame(seed: number, params?: GameInitParams): GameState {
  const { board, rngState: mainRng } = generateRawBoard(seed);
  let rngState = createColumnRngStates(mainRng);

  // 自動消去ループ: マッチがなくなるまで繰り返す
  let iterations = 0;
  while (hasMatches(board)) {
    // 安全弁: 列RNGが独立していれば数回で収束する（実測の最大は19回）。
    // 万一収束しない場合でも無限ループにしない。
    if (++iterations > MAX_STABILIZE_ITERATIONS) break;
    const matches = findMatches(board);
    const positions = getUniquePositions(matches);
    for (const pos of positions) {
      board[pos.row][pos.col] = null;
    }
    applyGravity(board);
    rngState = fillEmptyCells(board, rngState);
  }

  const obstacles = generateObstacles(board, rngState, params?.obstacleCount);
  return {
    board,
    score: 0,
    rngState: obstacles.rngState,
    moveCount: 0,
    isGameOver: false,
    seed,
    maxChainIndex: 0,
  };
}

/** GameStateのディープコピー */
export function cloneGameState(state: GameState): GameState {
  return {
    board: cloneBoard(state.board),
    score: state.score,
    rngState: [...state.rngState],
    moveCount: state.moveCount,
    isGameOver: state.isGameOver,
    seed: state.seed,
    isCleared: state.isCleared,
    maxChainIndex: state.maxChainIndex,
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
): { score: number; rngState: number[]; clearedPositions: Position[]; depthLevels: number } {
  const activated = new Set<string>();
  let totalScore = 0;
  const rng = rngState; // アイテム発動中はRNG不使用（補充なし）
  const allCleared: Position[] = [];
  // タイルを消した発動のうち最も深い段（起動したアイテム自身が1段目）。後続の連鎖の開始値に使う
  let depthLevels = 0;

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
      depthLevels = Math.max(depthLevels, current.depth + 1);
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

  return { score: totalScore, rngState: rng, clearedPositions: allCleared, depthLevels };
}

/**
 * サラダボウル+アイテム合成: 対象色の全タイルからアイテム効果を発動
 * @returns depthLevels: 合成の効果で誘爆したアイテムのうち、タイルを消した発動の最も深い段
 */
function activateCoffeeSynthesis(
  board: (Cell | null)[][],
  pos: Position,
  coffeePos: Position,
  otherItem: ItemType,
  targetColor: number,
  chainIndex: number,
  rngState: number[],
  collector?: TraceCollector,
): { score: number; rngState: number[]; clearedPositions: Position[]; depthLevels: number } {
  // まず両方のアイテムを消去
  board[pos.row][pos.col] = null;
  board[coffeePos.row][coffeePos.col] = null;

  // 対象色の全タイル位置を取得
  const colorTargets = getFlushTargets(board, targetColor);

  let totalScore = 0;
  let rng = rngState;
  let depthLevels = 0;
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
          depthLevels = Math.max(depthLevels, result.depthLevels);
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

  return { score: totalScore, rngState: rng, clearedPositions: allCleared, depthLevels };
}

/** おじゃまタイルへのダメージ処理（消去位置に基づく）
 * boardを直接変更する: 隣接おじゃまの耐久値減少・破壊時のgravity・補充
 * @returns 更新後のrngState */
export function processDamage(board: (Cell | null)[][], clearedPositions: Position[], rngState: number[]): number[] {
  if (clearedPositions.length === 0) return rngState;
  let rng = rngState;
  const destroyed = damageObstacles(board, clearedPositions);
  if (destroyed.length > 0) {
    applyGravity(board);
    rng = fillEmptyCells(board, rng);
  }
  return rng;
}

/**
 * アイテム効果の後に続く連鎖の chainIndex の開始値（SPEC §3.6.1: 操作で直接消えるのが1連鎖目、
 * 誘爆・落下で消えるのが2連鎖目以降）。
 * @param depthLevels タイルを消した発動の最も深い段。起動したアイテム・スプーン・合成の効果そのものを
 *   1段目とし、誘爆の深さごとに1段ずつ増える（同じ深さで同時に誘爆したアイテムは何個でも1段）
 * @param preChains アイテム発動より前に入れ替えで起きた連鎖の数
 */
function chainStartAfterItems(depthLevels: number, preChains = 0): number {
  return Math.max(2, depthLevels + preChains + 1);
}

/** 連鎖の結果から maxChainIndex・lastChainCount を更新する */
export function applyChainStats(state: GameState, steps: readonly Pick<ChainStep, 'chainIndex'>[]): void {
  let maxInAction = 0;
  for (const step of steps) {
    if (step.chainIndex > maxInAction) {
      maxInAction = step.chainIndex;
    }
  }
  state.lastChainCount = maxInAction;

  if (maxInAction > (state.maxChainIndex ?? 0)) {
    state.maxChainIndex = maxInAction;
  }
}

/**
 * アイテム効果の後の落下 → 補充 → 連鎖（おじゃまのダメージは効果の中で処理済み）。
 * state.board を直接変更し、スコアと RNG を state に反映して、連鎖のステップを返す
 */
function dropFillAndChain(state: GameState, startChain: number, collector?: TraceCollector): ChainStep[] {
  const board = state.board;
  // collector: gravity 前に dropMoves を計算
  if (collector?.onDropData) {
    const dm = computeDropMoves(board);
    collector.onDropData(dm.moves, dm.newTileEntries);
  }

  applyGravity(board);
  state.rngState = fillEmptyCells(board, state.rngState);

  // collector: gravity + fill 後の盤面スナップショット
  collector?.onBoardSnapshot?.('afterItemDrop', cloneBoard(board));

  const chainResult = processChains(board, state.rngState, startChain, collector);
  state.score += chainResult.score;
  state.rngState = chainResult.rngState;
  return chainResult.steps;
}

/** ゲーム終了チェック */
function applyGameOver(state: GameState): void {
  const result = checkGameOverState(state);
  if (result.gameOver) state.isGameOver = true;
  if (result.isCleared !== undefined) state.isCleared = result.isCleared;
}

/** プレイヤーの操作を処理して新しいGameStateを返す */
export function processAction(state: GameState, action: Action, collector?: TraceCollector): GameState {
  if (state.isGameOver) return state;
  // 無効な scope 操作は盤面を複製する前に弾く
  if (action.type === 'scope'
    && (getCell(state.board, action.pos)?.item !== 'scope' || !isValidTargetCells(action.targetCells, 1))) {
    return state;
  }

  const newState = cloneGameState(state);
  newState.lastChainCount = 0;
  const board = newState.board;

  if (action.type === 'scope') {
    // scope起動: タップで1手消費、周囲4マス消去 + ユーザー選択マスを消去
    board[action.pos.row][action.pos.col] = null;
    newState.moveCount++;

    const allCleared: Position[] = [];
    let depthLevels = 1;

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
        depthLevels = Math.max(depthLevels, 1 + result.depthLevels);
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
        depthLevels = Math.max(depthLevels, 1 + result.depthLevels);
        allCleared.push(...result.clearedPositions);
      } else {
        board[target.row][target.col] = null;
        newState.score += 10;
        allCleared.push(target);
      }
    }

    // collector: 消去完了後の盤面スナップショット
    collector?.onBoardSnapshot?.('boardAfterClear', cloneBoard(board));

    applyChainStats(newState, dropFillAndChain(newState, chainStartAfterItems(depthLevels), collector));
    applyGameOver(newState);
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

    applyChainStats(newState, dropFillAndChain(newState, chainStartAfterItems(result.depthLevels), collector));

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
        // スプーン合成でユーザー選択が必要な場合は無効（フロントエンドが scope_synthesis アクションを送る）
        if (SCOPE_SELECTION_EFFECTS.has(synthesis.effect)) return state;

        collector?.onBoardSnapshot?.('afterSwap', cloneBoard(board));

        const synthResult = processSynthesis(
          board, action.pos, targetPos, cell1.item, cell2.item,
          synthesis.effect, newState.rngState, collector
        );
        newState.score += synthResult.score;
        newState.rngState = synthResult.rngState;
        newState.moveCount++;

        applyChainStats(newState, dropFillAndChain(newState, chainStartAfterItems(synthResult.depthLevels), collector));
        applyGameOver(newState);
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

        applyChainStats(newState, dropFillAndChain(newState, chainStartAfterItems(1), collector));
        applyGameOver(newState);
        return newState;
      }

      // サラダボウルのtargetColorを事前保存（pre-chainで消去される可能性）
      const savedOtherColor = otherCell.item ? undefined : otherCell.color;

      // まず入れ替え
      board[action.pos.row][action.pos.col] = cell2;
      board[targetPos.row][targetPos.col] = cell1;

      collector?.onBoardSnapshot?.('afterSwap', cloneBoard(board));

      // #15: 野菜のマッチ判定を先に処理（pre-chains）
      const preChainResult = processChains(board, newState.rngState, 1, collector);
      newState.score += preChainResult.score;
      newState.rngState = preChainResult.rngState;

      // アイテム位置の再検索（gravity で落下している可能性）
      const currentItemPos = findItemPosition(board, itemCell.item!, itemPos);
      if (!currentItemPos) {
        // アイテムが消滅（pre-chainで誘爆等） — スワップのみ有効
        newState.moveCount++;
        applyGameOver(newState);
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

      const chainSteps = dropFillAndChain(newState, chainStartAfterItems(result.depthLevels, preChainResult.steps.length), collector);

      // 入れ替えの連鎖とアイテムの後の連鎖を1回の操作としてまとめて集計する（lastChainCount は操作内の最大）
      applyChainStats(newState, [...preChainResult.steps, ...chainSteps]);
      applyGameOver(newState);
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

    // マッチ消去
    const cleared = getUniquePositions(matches);
    for (const pos of cleared) {
      board[pos.row][pos.col] = null;
    }

    // スコア計算（1連鎖目）
    const stepScore = calculateStepScore(matches, 1);
    newState.score += stepScore;

    // アイテム配置
    for (const ig of itemGens) {
      board[ig.pos.row][ig.pos.col] = { color: 0 as Color, item: ig.item };
    }

    // おじゃまタイルへのダメージ
    const destroyedObstacles = damageObstacles(board, cleared);
    if (destroyedObstacles.length > 0) {
      applyGravity(board);
      newState.rngState = fillEmptyCells(board, newState.rngState);
    }

    // collector: gravity 前に dropMoves を計算
    const firstChainDropData = collector?.onChainStep
      ? computeDropMoves(board)
      : undefined;

    // 落下 → 補充 → 連鎖
    applyGravity(board);
    newState.rngState = fillEmptyCells(board, newState.rngState);

    // collector: inline first chain step を通知
    if (collector?.onChainStep) {
      collector.onChainStep({
        chainIndex: 1,
        matches,
        clearedPositions: cleared,
        destroyedObstacles,
        itemGens,
        score: stepScore,
        dropMoves: firstChainDropData!.moves,
        newTileEntries: firstChainDropData!.newTileEntries,
        boardAfterDrop: cloneBoard(board),
      });
    }

    const chainResult = processChains(board, newState.rngState, 2, collector);
    newState.score += chainResult.score;
    newState.rngState = chainResult.rngState;

    applyChainStats(newState, chainResult.steps);
  }

  applyGameOver(newState);
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
): { score: number; rngState: number[]; clearedPositions: Position[]; depthLevels: number } {
  let rng = rngState;
  let score = 0;
  let cleared = 0;
  let depthLevels = 1;
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
        depthLevels = Math.max(depthLevels, 1 + result.depthLevels);
        allCleared.push(...result.clearedPositions);
      }
    } else {
      board[t.row][t.col] = null;
      cleared++;
      allCleared.push(t);
    }
  }

  score += 10 * cleared;
  return { score, rngState: rng, clearedPositions: allCleared, depthLevels };
}

/**
 * @returns depthLevels: 合成の効果を1段目とした誘爆の段数（chainStartAfterItems に渡す）
 */
function processSynthesis(
  board: (Cell | null)[][],
  pos1: Position,
  pos2: Position,
  item1: ItemType,
  item2: ItemType,
  effect: SynthesisEffect,
  rngState: number[],
  collector?: TraceCollector,
): { score: number; rngState: number[]; clearedPositions: Position[]; depthLevels: number } {
  let rng = rngState;
  let totalScore = 0;
  const allCleared: Position[] = [];

  if (effect === 'flush+flush') {
    // 全消し: アイテムは残留（誘爆なし）
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
    // 落下・補充は呼び出し側で行う（他の合成と同じく落下のアニメーションも出る）

    return { score: totalScore, rngState: rng, clearedPositions: allCleared, depthLevels: 1 };
  }

  if (effect === 'scope+flush') {
    const coffeePos = item1 === 'flush' ? pos1 : pos2;
    board[pos1.row][pos1.col] = null;
    board[pos2.row][pos2.col] = null;

    const targetColor = findFlushTargetColor(board, coffeePos);
    if (targetColor === null) {
      return { score: 0, rngState: rng, clearedPositions: [], depthLevels: 1 };
    }

    // Flush targets are plain tiles only (no items, no obstacles), so there is nothing to detonate
    const targets = getFlushTargets(board, targetColor);
    for (const t of targets) board[t.row][t.col] = null;
    allCleared.push(...targets);
    totalScore += 10 * targets.length;

    collector?.onSynthesisEffect?.({
      effectType: effect, item1, item2, pos1, pos2,
      targets: allCleared, detonations: [], score: totalScore,
    });

    return { score: totalScore, rngState: rng, clearedPositions: allCleared, depthLevels: 1 };
  }

  if (effect.startsWith('flush+')) {
    const otherItem = effect.replace('flush+', '') as ItemType;
    const coffeePos = item1 === 'flush' ? pos1 : pos2;
    const otherPos = item1 === 'flush' ? pos2 : pos1;

    const targetColor = findFlushTargetColor(board, coffeePos);
    if (targetColor === null) {
      board[pos1.row][pos1.col] = null;
      board[pos2.row][pos2.col] = null;
      return { score: 0, rngState: rng, clearedPositions: [], depthLevels: 1 };
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

    return { score: totalScore, rngState: rng, clearedPositions: allCleared, depthLevels: 1 + result.depthLevels };
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

  return { score: totalScore, rngState: rng, clearedPositions: allCleared, depthLevels: result.depthLevels };
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
  if (!isBoardPosition(pos1) || !isBoardPosition(pos2)) return state;
  if (Math.abs(pos1.row - pos2.row) + Math.abs(pos1.col - pos2.col) !== 1) return state;

  const cell1 = getCell(state.board, pos1);
  const cell2 = getCell(state.board, pos2);
  if (!cell1?.item || !cell2?.item) return state;

  const synthesis = getSynthesisEffect(cell1.item, cell2.item);
  if (!synthesis || !SCOPE_SELECTION_EFFECTS.has(synthesis.effect)) return state;
  if (!isValidTargetCells(targetCells, synthesis.effect === 'scope+scope' ? 3 : 1)) return state;

  const newState = cloneGameState(state);
  newState.lastChainCount = 0;
  const board = newState.board;

  board[pos1.row][pos1.col] = null;
  board[pos2.row][pos2.col] = null;
  newState.moveCount++;

  const synthPos = pos2;
  const effect = synthesis.effect;
  const allCleared: Position[] = [];
  let depthLevels = 1;

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
        depthLevels = Math.max(depthLevels, 1 + result.depthLevels);
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
        depthLevels = Math.max(depthLevels, 1 + result.depthLevels);
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
    depthLevels = Math.max(depthLevels, result.depthLevels);
    allCleared.push(...result.clearedPositions);
  }

  // collector: 消去完了後の盤面スナップショット
  collector?.onBoardSnapshot?.('boardAfterClear', cloneBoard(board));

  applyChainStats(newState, dropFillAndChain(newState, chainStartAfterItems(depthLevels), collector));
  applyGameOver(newState);
  return newState;
}

/** スプーンと「アイテム以外」のセルの入れ替えか（scope_swap の成立条件） */
export function isScopeSwapPair(cell1: Cell, cell2: Cell): boolean {
  return (cell1.item === 'scope' || cell2.item === 'scope') && !(cell1.item && cell2.item);
}

/**
 * スプーンと野菜の入れ替えと、それで起きた連鎖（スプーンの発動の前まで）を処理する。
 * 入れ替えが成立しなければ null。scopePos は連鎖の後のスプーンの位置（連鎖で消えたときは null）。
 * フロントはここで止めてスプーンの対象を選ばせる（trace.ts の computeScopeSwapPreChains）
 */
export function processScopeSwapPreChains(
  state: GameState, pos: Position, dir: Direction, collector?: TraceCollector,
): { state: GameState; scopePos: Position | null } | null {
  if (state.isGameOver) return null;

  // 無効な操作は盤面を複製する前に弾く
  const targetPos = getAdjacentPos(pos, dir);
  if (!isValidPosition(targetPos)) return null;
  const cell1 = getCell(state.board, pos);
  const cell2 = getCell(state.board, targetPos);
  if (!cell1 || !cell2 || !isScopeSwapPair(cell1, cell2)) return null;

  const newState = cloneGameState(state);
  const board = newState.board;

  // Swap cells (on the cloned board)
  [board[pos.row][pos.col], board[targetPos.row][targetPos.col]] =
    [board[targetPos.row][targetPos.col], board[pos.row][pos.col]];
  collector?.onBoardSnapshot?.('afterSwap', cloneBoard(board));

  // Pre-chains: process matches created by the vegetable swap
  const preChainResult = processChains(board, newState.rngState, 1, collector);
  newState.score += preChainResult.score;
  newState.rngState = preChainResult.rngState;
  applyChainStats(newState, preChainResult.steps);

  // Re-find scope position after gravity
  const origScopePos = cell1.item === 'scope' ? targetPos : pos;
  return { state: newState, scopePos: findItemPosition(board, 'scope', origScopePos) };
}

/** #15: スプーンと野菜を入れ替え後、pre-chainsを処理してからscope発動 */
export function processScopeSwap(
  state: GameState, pos: Position, dir: Direction, targetCells: Position[],
  collector?: TraceCollector,
): GameState {
  if (!isValidTargetCells(targetCells, 1)) return state;
  const pre = processScopeSwapPreChains(state, pos, dir, collector);
  if (!pre) return state;

  const { state: newState, scopePos } = pre;
  if (!scopePos) {
    // Scope was destroyed during pre-chains
    newState.moveCount++;
    applyGameOver(newState);
    return newState;
  }

  // Now process scope action on the post-pre-chain state
  const result = processAction(newState, { type: 'scope', pos: scopePos, targetCells }, collector);
  // processAction は lastChainCount を0から数え直すので、入れ替えで起きた連鎖の分を引き継ぐ
  result.lastChainCount = Math.max(result.lastChainCount ?? 0, newState.lastChainCount ?? 0);
  return result;
}

/** リプレイログの 1 操作を適用する（リプレイ検証・再生で使う） */
export function applyReplayAction(state: GameState, action: ReplayAction): GameState {
  switch (action.type) {
    case 'scope_synthesis': return processScopeSynthesis(state, action.pos1, action.pos2, action.targetCells);
    case 'scope_swap': return processScopeSwap(state, action.pos, action.dir, action.targetCells);
    default: return processAction(state, action);
  }
}

/** 落下後の連鎖を処理 */
function processChains(
  board: (Cell | null)[][],
  rngState: number[],
  startChain: number,
  collector?: TraceCollector,
): { score: number; rngState: number[]; steps: ChainStep[] } {
  let rng = rngState;
  let totalScore = 0;
  const steps: ChainStep[] = [];
  let chainIndex = startChain;

  const MAX_CHAIN_ITERATIONS = 20;
  let iterations = 0;
  while (true) {
    const matches = findMatches(board);
    if (matches.length === 0) break;

    iterations++;
    if (iterations > MAX_CHAIN_ITERATIONS) {
      // 連鎖上限到達: 残りのマッチをスコアなしで安定化
      let stabilize = 0;
      while (stabilize++ < MAX_STABILIZE_ITERATIONS) {
        const m = findMatches(board);
        if (m.length === 0) break;
        const c = getUniquePositions(m);
        for (const p of c) board[p.row][p.col] = null;
        rng = processDamage(board, c, rng);
        applyGravity(board);
        rng = fillEmptyCells(board, rng);
      }
      break;
    }

    // アイテム生成判定
    const itemGens = determineItemFromMatches(matches);

    // 消去
    const cleared = getUniquePositions(matches);
    for (const pos of cleared) {
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
    });

    chainIndex++;

    // おじゃまタイルへのダメージ
    const destroyed = damageObstacles(board, cleared);
    if (destroyed.length > 0) {
      applyGravity(board);
      rng = fillEmptyCells(board, rng);
    }

    // collector: gravity 前に dropMoves を計算
    const dropData = collector?.onChainStep
      ? computeDropMoves(board)
      : undefined;

    // 落下 → 補充
    applyGravity(board);
    rng = fillEmptyCells(board, rng);

    // collector: chain step 完了を通知
    if (collector?.onChainStep) {
      collector.onChainStep({
        chainIndex: chainIndex - 1,
        matches,
        clearedPositions: cleared,
        destroyedObstacles: destroyed,
        itemGens: generatedItems,
        score: stepScore,
        dropMoves: dropData!.moves,
        newTileEntries: dropData!.newTileEntries,
        boardAfterDrop: cloneBoard(board),
      });
    }
  }

  return { score: totalScore, rngState: rng, steps };
}
