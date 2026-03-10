import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  initializeGame, processAction, processScopeSynthesis, processDamage,
  cloneBoard, findMatches, getUniquePositions, applyGravity, fillEmptyCells,
  calculateStepScore,
  determineItemFromMatches, checkGameOverState,
  isValidPosition, getItemTargets, findFlushTargetColor,
  getSynthesisEffect, getSynthesisTargets,
  getFlushTargets, getVCutTargets, getHCutTargets, getBurstTargets,
  getScopeAdjacentTargets,
  countObstacles, damageObstacles, getQuota,
  type GameState, type GameMode, type Position, type Direction,
  type Cell, type Color, type ItemType, type Match, type SynthesisEffect,
  BOARD_SIZE,
} from '@tomado/engine';

// --- Animation plan types ---

export interface ChainAnimData {
  matches: Match[];
  clearedPositions: Position[];
  destroyedObstacles: Position[];
  itemGen: { pos: Position; item: ItemType } | null;
  score: number;
  chainIndex: number;
  dropMoves: { col: number; fromRow: number; toRow: number }[];
  newTileEntries: { row: number; col: number; segNulls: number }[];
  boardAfterDrop: (Cell | null)[][];
}

export interface SwapAnimPlan {
  boardAfterSwap: (Cell | null)[][];
  chains: ChainAnimData[];
  finalState: GameState;
}

export interface ItemEffectStep {
  itemType: ItemType;
  itemPos: Position;
  targets: Position[];
  detonations: { pos: Position; item: ItemType }[];
  depth: number; // 0 = direct activation, 1+ = detonation chain depth
}

/** アイテム種別ごとの基礎点 */
const ITEM_BASE_POINTS: Record<ItemType, number> = {
  scope: 10,
  v_cut: 20,
  h_cut: 20,
  burst: 30,
  flush: 40,
};

/** 誘爆チェーン倍率: ×(1 + 0.5 × depth) */
function itemChainMultiplier(depth: number): number {
  return 1 + 0.5 * depth;
}

/** アイテム効果1ステップのスコアを計算 */
function calcItemEffectScore(step: ItemEffectStep): number {
  const base = ITEM_BASE_POINTS[step.itemType] * step.targets.length;
  return Math.round(base * itemChainMultiplier(step.depth));
}

/** 合成効果の基礎点（タイルあたり）: 構成アイテムの高い方を採用 */
function synthBasePoints(item1: ItemType, item2: ItemType): number {
  return Math.max(ITEM_BASE_POINTS[item1], ITEM_BASE_POINTS[item2]);
}

export interface ItemAnimPlan {
  boardBeforeActivation: (Cell | null)[][];
  effects: ItemEffectStep[];
  dropMoves: { col: number; fromRow: number; toRow: number }[];
  newTileEntries: { row: number; col: number; segNulls: number }[];
  boardAfterDrop: (Cell | null)[][];
  regularChains: ChainAnimData[];
  finalState: GameState;
}

export interface SynthesisEffectStep {
  effectType: SynthesisEffect;
  item1: ItemType;
  item2: ItemType;
  pos1: Position; // first item position
  pos2: Position; // second item position
  targets: Position[];
  detonations: { pos: Position; item: ItemType }[];
}

export interface SynthesisAnimPlan {
  boardAfterSwap: (Cell | null)[][];
  boardBeforeActivation: (Cell | null)[][];
  effects: SynthesisEffectStep[];
  dropMoves: { col: number; fromRow: number; toRow: number }[];
  newTileEntries: { row: number; col: number; segNulls: number }[];
  boardAfterDrop: (Cell | null)[][];
  regularChains: ChainAnimData[];
  finalState: GameState;
}

export interface ScopeAnimPlan {
  scopePos: Position;
  adjacentTargets: Position[]; // 周囲上下左右4マス
  targetCells: Position[];
  boardAfterClear: (Cell | null)[][];
  itemEffects: ItemEffectStep[];
  dropMoves: { col: number; fromRow: number; toRow: number }[];
  newTileEntries: { row: number; col: number; segNulls: number }[];
  boardAfterDrop: (Cell | null)[][];
  regularChains: ChainAnimData[];
  finalState: GameState;
}

export interface ScopeSynthesisAnimPlan {
  pos1: Position;
  pos2: Position;
  synthEffect: SynthesisEffect;
  adjacentTargets: Position[]; // 両位置の周囲4マス(統合)
  /** The effect position (user-selected cell for scope+v_cut/h_cut/burst, or multiple for scope+scope) */
  targetCells: Position[];
  /** Targets cleared by the synthesis effect */
  effectTargets: Position[];
  itemEffects: ItemEffectStep[];
  boardAfterClear: (Cell | null)[][];
  dropMoves: { col: number; fromRow: number; toRow: number }[];
  newTileEntries: { row: number; col: number; segNulls: number }[];
  boardAfterDrop: (Cell | null)[][];
  regularChains: ChainAnimData[];
  finalState: GameState;
}

// --- Helpers ---

function adjPos(pos: Position, dir: Direction): Position {
  switch (dir) {
    case 'up': return { row: pos.row - 1, col: pos.col };
    case 'down': return { row: pos.row + 1, col: pos.col };
    case 'left': return { row: pos.row, col: pos.col - 1 };
    case 'right': return { row: pos.row, col: pos.col + 1 };
  }
}

function computeDropMovesForSegment(
  board: (Cell | null)[][],
  col: number,
  start: number,
  end: number,
  moves: { col: number; fromRow: number; toRow: number }[],
  newTileEntries: { row: number; col: number; segNulls: number }[],
): void {
  let writeRow = end - 1;
  let nullCount = 0;
  for (let readRow = end - 1; readRow >= start; readRow--) {
    if (board[readRow][col] !== null) {
      if (writeRow !== readRow) {
        moves.push({ col, fromRow: readRow, toRow: writeRow });
      }
      writeRow--;
    } else {
      nullCount++;
    }
  }
  if (nullCount > 0) {
    // 新タイルはセグメント上部 [start, start + nullCount) に入る
    for (let i = 0; i < nullCount; i++) {
      newTileEntries.push({ row: start + i, col, segNulls: nullCount });
    }
  }
}

function computeDropMoves(board: (Cell | null)[][]) {
  const moves: { col: number; fromRow: number; toRow: number }[] = [];
  const newTileEntries: { row: number; col: number; segNulls: number }[] = [];
  for (let col = 0; col < BOARD_SIZE; col++) {
    // おじゃまタイルの有無を確認
    let hasObstacle = false;
    for (let row = 0; row < BOARD_SIZE; row++) {
      if (board[row][col]?.obstacle) { hasObstacle = true; break; }
    }

    if (!hasObstacle) {
      // 従来の単純コンパクション
      computeDropMovesForSegment(board, col, 0, BOARD_SIZE, moves, newTileEntries);
    } else {
      // セグメントベース: おじゃまタイルで区切られたセグメントごとに計算
      const obstacleRows: number[] = [];
      for (let row = 0; row < BOARD_SIZE; row++) {
        if (board[row][col]?.obstacle) obstacleRows.push(row);
      }

      const segments: [number, number][] = [];
      let segStart = 0;
      for (const obsRow of obstacleRows) {
        if (obsRow > segStart) segments.push([segStart, obsRow]);
        segStart = obsRow + 1;
      }
      if (segStart < BOARD_SIZE) segments.push([segStart, BOARD_SIZE]);

      for (const [start, end] of segments) {
        computeDropMovesForSegment(board, col, start, end, moves, newTileEntries);
      }
    }
  }
  return { moves, newTileEntries };
}

/** ゲーム終了判定 + ボーナス加算 + finalState構築の共通ヘルパー */
function resolveFinalState(
  board: (Cell | null)[][],
  score: number,
  rngState: number,
  moveCount: number,
  mode: GameMode,
  moveLimit: number | undefined,
  quotaTable: number[] | undefined,
  segmentStartScore: number | undefined,
): GameState {
  const tempState: GameState = {
    board, score, rngState, moveCount,
    isGameOver: false, mode, moveLimit, quotaTable, segmentStartScore,
  };
  const goResult = checkGameOverState(tempState);
  let finalScore = score;
  if (goResult.gameOver && mode === 'clear') finalScore = moveCount;
  return {
    board: cloneBoard(board),
    score: finalScore,
    rngState,
    moveCount,
    isGameOver: goResult.gameOver,
    isCleared: goResult.isCleared,
    mode,
    moveLimit,
    quotaTable,
    segmentStartScore: goResult.newSegmentStartScore ?? segmentStartScore,
  };
}

function computeItemEffects(
  board: (Cell | null)[][],
  startPos: Position,
  startItem: ItemType,
  targetColor?: number,
): ItemEffectStep[] {
  const effects: ItemEffectStep[] = [];
  const activated = new Set<string>();
  const queue: { pos: Position; item: ItemType; targetColor?: number; depth: number }[] = [
    { pos: startPos, item: startItem, targetColor, depth: 0 },
  ];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const key = `${cur.pos.row},${cur.pos.col}`;
    if (activated.has(key)) continue;
    activated.add(key);

    if (board[cur.pos.row]?.[cur.pos.col]?.item) {
      board[cur.pos.row][cur.pos.col] = null;
    }

    const allTargets = getItemTargets(board, cur.pos, cur.item, cur.targetColor);
    const cleared: Position[] = [];
    const detonations: { pos: Position; item: ItemType }[] = [];

    for (const t of allTargets) {
      const c = board[t.row]?.[t.col];
      if (c === null) continue;
      if (c.obstacle) continue; // おじゃまタイルはアイテム直接消去不可
      if (c.item) {
        const tKey = `${t.row},${t.col}`;
        if (!activated.has(tKey)) {
          detonations.push({ pos: t, item: c.item });
          queue.push({ pos: t, item: c.item, depth: cur.depth + 1 });
        }
      } else {
        board[t.row][t.col] = null;
        cleared.push(t);
      }
    }

    effects.push({ itemType: cur.item, itemPos: cur.pos, targets: cleared, detonations, depth: cur.depth });
  }
  return effects;
}

function buildItemPlan(
  board: (Cell | null)[][],
  rngState: number,
  baseScore: number,
  moveCount: number,
  itemPos: Position,
  itemType: ItemType,
  targetColor: number | undefined,
  gameMode: GameMode,
  gameMoveLimit?: number,
  quotaTable?: number[],
  segmentStartScore?: number,
): ItemAnimPlan {
  const boardBefore = cloneBoard(board);
  const effects = computeItemEffects(board, itemPos, itemType, targetColor);

  let scoreFromItems = 0;
  for (const e of effects) scoreFromItems += calcItemEffectScore(e);

  // おじゃまタイルへのダメージ（アイテム効果で消去された全位置）
  const allItemCleared: Position[] = [];
  for (const e of effects) {
    allItemCleared.push(e.itemPos);
    allItemCleared.push(...e.targets);
  }
  let rng = processDamage(board, allItemCleared, rngState);

  const { moves: dropMoves, newTileEntries } = computeDropMoves(board);
  applyGravity(board);
  rng = fillEmptyCells(board, rng);
  const boardAfterDrop = cloneBoard(board);

  const regularChains: ChainAnimData[] = [];
  let totalScore = baseScore + scoreFromItems;
  let chainIndex = 2;
  let matches = findMatches(board);

  while (matches.length > 0) {
    const clearedPositions = getUniquePositions(matches);
    const itemGen = determineItemFromMatches(matches);
    const stepScore = calculateStepScore(matches, chainIndex);
    totalScore += stepScore;

    for (const p of clearedPositions) board[p.row][p.col] = null;
    if (itemGen) board[itemGen.pos.row][itemGen.pos.col] = { color: 0 as Color, item: itemGen.item };

    // おじゃまタイルへのダメージ
    const destroyed = damageObstacles(board, clearedPositions);
    if (destroyed.length > 0) {
      applyGravity(board);
      rng = fillEmptyCells(board, rng);
    }

    const { moves: dm, newTileEntries: nt } = computeDropMoves(board);
    applyGravity(board);
    rng = fillEmptyCells(board, rng);

    regularChains.push({
      matches, clearedPositions, destroyedObstacles: destroyed,
      itemGen, score: stepScore, chainIndex,
      dropMoves: dm, newTileEntries: nt,
      boardAfterDrop: cloneBoard(board),
    });
    chainIndex++;
    matches = findMatches(board);
  }

  return {
    boardBeforeActivation: boardBefore,
    effects,
    dropMoves, newTileEntries, boardAfterDrop,
    regularChains,
    finalState: resolveFinalState(
      board, totalScore, rng, moveCount + 1,
      gameMode, gameMoveLimit, quotaTable, segmentStartScore,
    ),
  };
}

function computeChainSteps(board: (Cell | null)[][], rng: number, totalScore: number, startChain: number) {
  const chains: ChainAnimData[] = [];
  let chainIndex = startChain;
  let matches = findMatches(board);

  while (matches.length > 0) {
    const clearedPositions = getUniquePositions(matches);
    const itemGen = determineItemFromMatches(matches);
    const stepScore = calculateStepScore(matches, chainIndex);
    totalScore += stepScore;

    for (const p of clearedPositions) board[p.row][p.col] = null;
    if (itemGen) board[itemGen.pos.row][itemGen.pos.col] = { color: 0 as Color, item: itemGen.item };

    // おじゃまタイルへのダメージ
    const destroyed = damageObstacles(board, clearedPositions);
    if (destroyed.length > 0) {
      applyGravity(board);
      rng = fillEmptyCells(board, rng);
    }

    const { moves: dm, newTileEntries: nt } = computeDropMoves(board);
    applyGravity(board);
    rng = fillEmptyCells(board, rng);

    chains.push({
      matches, clearedPositions, destroyedObstacles: destroyed,
      itemGen, score: stepScore, chainIndex,
      dropMoves: dm, newTileEntries: nt,
      boardAfterDrop: cloneBoard(board),
    });
    chainIndex++;
    matches = findMatches(board);
  }
  return { chains, rng, totalScore };
}

// --- Store ---

export const usePuzzleStore = defineStore('puzzle', () => {
  const gameState = ref<GameState | null>(null);
  const seed = ref(0);

  // Stats tracking for achievements
  const maxChain = ref(0);
  const generatedItemTypes = ref<Set<string>>(new Set());

  const board = computed(() => gameState.value?.board ?? null);
  // displayScore overrides score during chain animations for real-time display
  const _displayScore = ref<number | null>(null);
  const score = computed(() => _displayScore.value ?? (gameState.value?.score ?? 0));
  const moveCount = computed(() => gameState.value?.moveCount ?? 0);
  const autoActivating = ref(false);
  const isGameOver = computed(() => gameState.value?.isGameOver ?? false);
  const mode = computed<GameMode>(() => gameState.value?.mode ?? 'sprint');
  const moveLimit = computed(() => gameState.value?.moveLimit);
  const isCleared = computed(() => gameState.value?.isCleared);
  const remainingMoves = computed(() => {
    if (!gameState.value || gameState.value.mode !== 'sprint' || !gameState.value.moveLimit) return undefined;
    return gameState.value.moveLimit - gameState.value.moveCount;
  });
  const obstacleCount = computed(() => {
    if (!gameState.value) return 0;
    return countObstacles(gameState.value.board);
  });
  const quotaTable = computed(() => gameState.value?.quotaTable);
  const quotaTarget = computed(() => {
    if (!gameState.value?.quotaTable) return undefined;
    const mc = gameState.value.moveCount;
    const nextCheckpoint = Math.ceil((mc + 1) / 5) * 5;
    const idx = (nextCheckpoint / 5) - 1;
    if (idx < 0) return getQuota(gameState.value.quotaTable, 0);
    return getQuota(gameState.value.quotaTable, idx);
  });
  const movesUntilCheck = computed(() => {
    if (!gameState.value?.quotaTable) return undefined;
    const mc = gameState.value.moveCount;
    return 5 - (mc % 5);
  });
  /** 現区間で稼いだスコア（displayScore反映） */
  const segmentScore = computed(() => {
    if (!gameState.value) return 0;
    const currentScore = _displayScore.value ?? gameState.value.score;
    return currentScore - (gameState.value.segmentStartScore ?? 0);
  });

  function startGame(newSeed?: number, gameMode?: GameMode) {
    seed.value = newSeed ?? Math.floor(Math.random() * 0x7FFFFFFF);
    maxChain.value = 0;
    generatedItemTypes.value = new Set();
    gameState.value = initializeGame(seed.value, gameMode ?? 'sprint');
  }

  function restoreState(savedSeed: number, state: GameState, savedMaxChain: number, savedItemTypes: string[]) {
    seed.value = savedSeed;
    maxChain.value = savedMaxChain;
    generatedItemTypes.value = new Set(savedItemTypes);
    gameState.value = state;
  }

  function swap(pos: Position, dir: Direction) {
    if (!gameState.value) return;
    const newState = processAction(gameState.value, { type: 'swap', pos, dir });
    if (newState !== gameState.value) gameState.value = newState;
  }

  function tap(pos: Position) {
    if (!gameState.value) return;
    const newState = processAction(gameState.value, { type: 'tap', pos });
    if (newState !== gameState.value) gameState.value = newState;
  }

  function activateScope(pos: Position, targetCells: Position[]) {
    if (!gameState.value) return;
    const newState = processAction(gameState.value, {
      type: 'scope', pos, targetCells,
    });
    if (newState !== gameState.value) gameState.value = newState;
  }

  function applyScopeSynthesis(pos1: Position, pos2: Position, targetCells: Position[]) {
    if (!gameState.value) return;
    const newState = processScopeSynthesis(gameState.value, pos1, pos2, targetCells);
    if (newState !== gameState.value) gameState.value = newState;
  }

  function computeScopePlan(scopePos: Position, targetCells: Position[]): ScopeAnimPlan | null {
    if (!gameState.value) return null;
    const state = gameState.value;
    const cell = state.board[scopePos.row]?.[scopePos.col];
    if (!cell?.item || cell.item !== 'scope') return null;

    const board = cloneBoard(state.board);
    // Remove the scope itself
    board[scopePos.row][scopePos.col] = null;

    let totalScore = state.score;
    let rng = state.rngState;
    const itemEffects: ItemEffectStep[] = [];

    // まず周囲上下左右4マスを消去
    const adjacentTargets = getScopeAdjacentTargets(board, scopePos);
    const allScopeCleared: Position[] = [scopePos]; // scope自身も消去済み
    for (const t of adjacentTargets) {
      const ac = board[t.row]?.[t.col];
      if (!ac) continue;
      if (ac.obstacle) continue; // おじゃまタイルはスキップ
      if (ac.item) {
        const effects = computeItemEffects(board, t, ac.item);
        for (const e of effects) {
          totalScore += calcItemEffectScore(e);
          itemEffects.push(e);
          allScopeCleared.push(e.itemPos);
          allScopeCleared.push(...e.targets);
        }
      } else {
        board[t.row][t.col] = null;
        allScopeCleared.push(t);
        totalScore += 10;
      }
    }

    // ユーザー選択マスを消去
    for (const target of targetCells) {
      const tc = board[target.row]?.[target.col];
      if (!tc) continue;
      if (tc.obstacle) {
        // おじゃまタイルを直接選択した場合、耐久値を1減らす
        tc.obstacle.durability--;
        if (tc.obstacle.durability <= 0) {
          board[target.row][target.col] = null;
          allScopeCleared.push(target);
        }
        continue;
      }
      if (tc.item) {
        const effects = computeItemEffects(board, target, tc.item);
        for (const e of effects) {
          totalScore += calcItemEffectScore(e);
          itemEffects.push(e);
          allScopeCleared.push(e.itemPos);
          allScopeCleared.push(...e.targets);
        }
      } else {
        board[target.row][target.col] = null;
        allScopeCleared.push(target);
        totalScore += 10;
      }
    }

    // おじゃまタイルへのダメージ
    rng = processDamage(board, allScopeCleared, rng);

    const boardAfterClear = cloneBoard(board);

    const { moves: dropMoves, newTileEntries } = computeDropMoves(board);
    applyGravity(board);
    rng = fillEmptyCells(board, rng);
    const boardAfterDrop = cloneBoard(board);

    const { chains: regularChains, rng: finalRng, totalScore: finalScore } =
      computeChainSteps(board, rng, totalScore, 2);

    return {
      scopePos,
      adjacentTargets,
      targetCells,
      boardAfterClear,
      itemEffects,
      dropMoves, newTileEntries, boardAfterDrop,
      regularChains,
      finalState: resolveFinalState(
        board, finalScore, finalRng, state.moveCount + 1,
        state.mode, state.moveLimit, state.quotaTable, state.segmentStartScore,
      ),
    };
  }

  function computeScopeSynthesisPlan(
    pos1: Position, pos2: Position, targetCells: Position[],
  ): ScopeSynthesisAnimPlan | null {
    if (!gameState.value) return null;
    const state = gameState.value;
    const cell1 = state.board[pos1.row]?.[pos1.col];
    const cell2 = state.board[pos2.row]?.[pos2.col];
    if (!cell1?.item || !cell2?.item) return null;

    const synthesis = getSynthesisEffect(cell1.item, cell2.item);
    if (!synthesis) return null;
    const effect = synthesis.effect;

    const board = cloneBoard(state.board);
    board[pos1.row][pos1.col] = null;
    board[pos2.row][pos2.col] = null;

    let totalScore = state.score;
    let rng = state.rngState;
    const itemEffects: ItemEffectStep[] = [];
    const effectTargets: Position[] = [];

    // 合成時: 両位置で周囲4マス消去を追加発動
    const adj1 = getScopeAdjacentTargets(board, pos1);
    const adj2 = getScopeAdjacentTargets(board, pos2);
    const adjSet = new Set<string>();
    const adjacentTargets: Position[] = [];
    const allSynthCleared: Position[] = [pos1, pos2]; // 合成元も消去済み
    for (const t of [...adj1, ...adj2]) {
      const key = `${t.row},${t.col}`;
      if (adjSet.has(key)) continue;
      adjSet.add(key);
      adjacentTargets.push(t);
      const ac = board[t.row]?.[t.col];
      if (!ac) continue;
      if (ac.obstacle) continue; // おじゃまタイルはスキップ
      if (ac.item) {
        const effects = computeItemEffects(board, t, ac.item);
        for (const e of effects) {
          totalScore += calcItemEffectScore(e);
          itemEffects.push(e);
          allSynthCleared.push(e.itemPos);
          allSynthCleared.push(...e.targets);
        }
      } else {
        board[t.row][t.col] = null;
        effectTargets.push(t);
        allSynthCleared.push(t);
        totalScore += 10;
      }
    }

    if (effect === 'scope+scope') {
      // 3マス消去
      for (const target of targetCells) {
        const tc = board[target.row]?.[target.col];
        if (!tc) continue;
        if (tc.obstacle) {
          // おじゃまタイルを直接選択した場合、耐久値を1減らす
          tc.obstacle.durability--;
          if (tc.obstacle.durability <= 0) {
            board[target.row][target.col] = null;
            allSynthCleared.push(target);
          }
          continue;
        }
        if (tc.item) {
          const effects = computeItemEffects(board, target, tc.item);
          for (const e of effects) {
            totalScore += calcItemEffectScore(e);
            itemEffects.push(e);
            allSynthCleared.push(e.itemPos);
            allSynthCleared.push(...e.targets);
          }
        } else {
          board[target.row][target.col] = null;
          effectTargets.push(target);
          allSynthCleared.push(target);
          totalScore += 10;
        }
      }
    } else {
      // scope+v_cut/h_cut/burst: get synthesis targets from user-selected cell
      const synthTargets = getSynthesisTargets(board, pos2, effect, undefined, targetCells);
      const activated = new Set<string>();
      activated.add(`${pos1.row},${pos1.col}`);
      activated.add(`${pos2.row},${pos2.col}`);

      for (const t of synthTargets) {
        const c = board[t.row]?.[t.col];
        if (c === null) continue;
        if (c.obstacle) continue; // おじゃまタイルはスキップ
        if (c.item) {
          const tKey = `${t.row},${t.col}`;
          if (!activated.has(tKey)) {
            activated.add(tKey);
            const effects = computeItemEffects(board, t, c.item);
            for (const e of effects) {
              totalScore += calcItemEffectScore(e);
              itemEffects.push(e);
              allSynthCleared.push(e.itemPos);
              allSynthCleared.push(...e.targets);
            }
          }
        } else {
          board[t.row][t.col] = null;
          effectTargets.push(t);
          allSynthCleared.push(t);
          totalScore += synthBasePoints(cell1.item, cell2.item);
        }
      }
    }

    // おじゃまタイルへのダメージ
    rng = processDamage(board, allSynthCleared, rng);

    const boardAfterClear = cloneBoard(board);

    const { moves: dropMoves, newTileEntries } = computeDropMoves(board);
    applyGravity(board);
    rng = fillEmptyCells(board, rng);
    const boardAfterDrop = cloneBoard(board);

    const { chains: regularChains, rng: finalRng, totalScore: finalScore } =
      computeChainSteps(board, rng, totalScore, 2);

    return {
      pos1, pos2, synthEffect: effect, adjacentTargets, targetCells, effectTargets,
      itemEffects, boardAfterClear,
      dropMoves, newTileEntries, boardAfterDrop,
      regularChains,
      finalState: resolveFinalState(
        board, finalScore, finalRng, state.moveCount + 1,
        state.mode, state.moveLimit, state.quotaTable, state.segmentStartScore,
      ),
    };
  }

  function computeSwapPlan(pos: Position, dir: Direction): SwapAnimPlan | null {
    if (!gameState.value) return null;
    const state = gameState.value;
    const board = cloneBoard(state.board);

    const target = adjPos(pos, dir);
    if (!isValidPosition(target)) return null;
    const cell1 = board[pos.row][pos.col];
    const cell2 = board[target.row][target.col];
    if (!cell1 || !cell2) return null;
    if (cell1.item || cell2.item) return null;

    board[pos.row][pos.col] = cell2;
    board[target.row][target.col] = cell1;
    const boardAfterSwap = cloneBoard(board);

    let matches = findMatches(board);
    if (matches.length === 0) return null;

    const chains: ChainAnimData[] = [];
    let rng = state.rngState;
    let totalScore = state.score;
    let chainIndex = 1;

    while (matches.length > 0) {
      const clearedPositions = getUniquePositions(matches);
      const itemGen = determineItemFromMatches(matches, chainIndex === 1 ? [pos, target] : undefined);
      const stepScore = calculateStepScore(matches, chainIndex);
      totalScore += stepScore;

      for (const p of clearedPositions) board[p.row][p.col] = null;
      if (itemGen) board[itemGen.pos.row][itemGen.pos.col] = { color: 0 as Color, item: itemGen.item };

      // おじゃまタイルへのダメージ
      const destroyed = damageObstacles(board, clearedPositions);
      if (destroyed.length > 0) {
        applyGravity(board);
        rng = fillEmptyCells(board, rng);
      }

      const { moves: dropMoves, newTileEntries } = computeDropMoves(board);
      applyGravity(board);
      rng = fillEmptyCells(board, rng);

      chains.push({
        matches, clearedPositions, destroyedObstacles: destroyed,
        itemGen, score: stepScore, chainIndex,
        dropMoves, newTileEntries, boardAfterDrop: cloneBoard(board),
      });
      chainIndex++;
      matches = findMatches(board);
    }

    return {
      boardAfterSwap, chains,
      finalState: resolveFinalState(
        board, totalScore, rng, state.moveCount + 1,
        state.mode, state.moveLimit, state.quotaTable, state.segmentStartScore,
      ),
    };
  }

  function computeItemTapPlan(pos: Position): ItemAnimPlan | null {
    if (!gameState.value) return null;
    const state = gameState.value;
    const cell = state.board[pos.row]?.[pos.col];
    if (!cell?.item) return null;

    const board = cloneBoard(state.board);
    let targetColor: number | undefined;
    if (cell.item === 'flush') {
      targetColor = findFlushTargetColor(board, pos) ?? undefined;
      if (targetColor === undefined) return null;
    }

    return buildItemPlan(
      board, state.rngState, state.score, state.moveCount,
      pos, cell.item, targetColor,
      state.mode, state.moveLimit, state.quotaTable, state.segmentStartScore,
    );
  }

  function computeItemSwapPlan(pos: Position, dir: Direction): {
    boardAfterSwap: (Cell | null)[][];
    preChains: ChainAnimData[];
    preScore: number;
    plan: ItemAnimPlan;
  } | null {
    if (!gameState.value) return null;
    const state = gameState.value;
    const target = adjPos(pos, dir);
    if (!isValidPosition(target)) return null;

    const cell1 = state.board[pos.row][pos.col];
    const cell2 = state.board[target.row][target.col];
    if (!cell1 || !cell2) return null;
    if (cell1.item && cell2.item) return null; // synthesis -> instant
    if (!cell1.item && !cell2.item) return null;

    const board = cloneBoard(state.board);
    board[pos.row][pos.col] = { ...cell2 };
    board[target.row][target.col] = { ...cell1 };
    const boardAfterSwap = cloneBoard(board);

    const itemCell = cell1.item ? cell1 : cell2;
    const otherCell = cell1.item ? cell2 : cell1;

    const origItemPos = cell1.item ? target : pos;

    // Process pre-chains: matches created by the vegetable's new position
    const { chains: preChains, rng: preRng, totalScore: preScore } =
      computeChainSteps(board, state.rngState, state.score, 1);

    // Find the item's current position after gravity (it may have dropped).
    // Items never participate in matches, so the original item is still on the board.
    // Gravity only moves it down within the same column — search from origItemPos.row
    // downward to find the closest match (avoids confusion with newly generated items).
    let newItemPos: Position | null = null;
    for (let r = origItemPos.row; r < BOARD_SIZE; r++) {
      if (board[r][origItemPos.col]?.item === itemCell.item) {
        newItemPos = { row: r, col: origItemPos.col };
        break;
      }
    }
    // Fallback: scan entire board (e.g. if column was restructured by obstacle destruction)
    if (!newItemPos) {
      for (let r = 0; r < BOARD_SIZE && !newItemPos; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (board[r][c]?.item === itemCell.item) {
            newItemPos = { row: r, col: c };
            break;
          }
        }
      }
    }
    if (!newItemPos) return null;

    let targetColor: number | undefined;
    if (itemCell.item === 'flush') targetColor = otherCell.color;

    const plan = buildItemPlan(
      board, preRng, preScore, state.moveCount,
      newItemPos, itemCell.item!, targetColor,
      state.mode, state.moveLimit, state.quotaTable, state.segmentStartScore,
    );
    return { boardAfterSwap, preChains, preScore, plan };
  }

  function computeSynthesisPlan(pos: Position, dir: Direction): SynthesisAnimPlan | null {
    if (!gameState.value) return null;
    const state = gameState.value;
    const target = adjPos(pos, dir);
    if (!isValidPosition(target)) return null;

    const cell1 = state.board[pos.row][pos.col];
    const cell2 = state.board[target.row][target.col];
    if (!cell1 || !cell2 || !cell1.item || !cell2.item) return null;

    const synthesis = getSynthesisEffect(cell1.item, cell2.item);
    if (!synthesis) return null;

    const board = cloneBoard(state.board);
    board[pos.row][pos.col] = { ...cell2 };
    board[target.row][target.col] = { ...cell1 };
    const boardAfterSwap = cloneBoard(board);
    const boardBefore = cloneBoard(board);

    const synthPos = target;
    const effect = synthesis.effect;
    let rng = state.rngState;
    let totalScore = state.score;

    const effects: SynthesisEffectStep[] = [];
    const activated = new Set<string>();
    activated.add(`${pos.row},${pos.col}`);
    activated.add(`${target.row},${target.col}`);

    if (effect === 'flush+flush') {
      // Full clear: items remain, all regular tiles cleared
      board[pos.row][pos.col] = null;
      board[target.row][target.col] = null;
      const targets: Position[] = [];
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const cell = board[r][c];
          if (cell && !cell.item && !cell.obstacle) {
            targets.push({ row: r, col: c });
            board[r][c] = null;
          }
        }
      }
      totalScore += 1000; // full clear bonus
      effects.push({
        effectType: effect, item1: cell1.item, item2: cell2.item,
        pos1: target, pos2: pos, targets, detonations: [],
      });
    } else if (effect.startsWith('flush+')) {
      const otherItem = effect.replace('flush+', '') as ItemType;
      const flushPos = cell1.item === 'flush' ? pos : target;
      // Use findFlushTargetColor to find adjacent color (same as engine)
      const targetColor = findFlushTargetColor(board, flushPos) ?? undefined;

      board[pos.row][pos.col] = null;
      board[target.row][target.col] = null;

      // Get color targets and clear them (skip obstacles)
      const colorTargetsRaw = targetColor != null ? getFlushTargets(board, targetColor) : [];
      const colorTargets = colorTargetsRaw.filter(t => !board[t.row][t.col]?.obstacle);
      const allTargets: Position[] = [...colorTargets];
      for (const ct of colorTargets) board[ct.row][ct.col] = null;
      totalScore += ITEM_BASE_POINTS.flush * colorTargets.length;

      // Each color target position fires the other item's effect
      const detonations: { pos: Position; item: ItemType }[] = [];
      for (const ct of colorTargets) {
        let subTargets: Position[];
        switch (otherItem) {
          case 'v_cut': subTargets = getVCutTargets(ct); break;
          case 'h_cut': subTargets = getHCutTargets(ct); break;
          case 'burst': subTargets = getBurstTargets(ct, 2); break;
          default: subTargets = [];
        }
        for (const t of subTargets) {
          const c = board[t.row]?.[t.col];
          if (c === null) continue;
          if (c.obstacle) continue; // おじゃまタイルはスキップ
          if (c.item) {
            const tKey = `${t.row},${t.col}`;
            if (!activated.has(tKey)) {
              activated.add(tKey);
              detonations.push({ pos: t, item: c.item });
            }
          } else {
            board[t.row][t.col] = null;
            allTargets.push(t);
          }
        }
        totalScore += ITEM_BASE_POINTS[otherItem] * subTargets.filter(t => board[t.row]?.[t.col] === null).length;
      }

      effects.push({
        effectType: effect, item1: cell1.item, item2: cell2.item,
        pos1: target, pos2: pos, targets: allTargets, detonations,
      });
    } else if (effect === 'scope+flush') {
      // scope+flush: flush color clear (same as flush activation)
      const flushPos = cell1.item === 'flush' ? pos : target;
      const targetColor = findFlushTargetColor(board, flushPos) ?? undefined;

      board[pos.row][pos.col] = null;
      board[target.row][target.col] = null;

      const colorTargets = targetColor != null ? getFlushTargets(board, targetColor) : [];
      const cleared: Position[] = [];
      const detonations: { pos: Position; item: ItemType }[] = [];
      for (const t of colorTargets) {
        const c = board[t.row]?.[t.col];
        if (c === null) continue;
        if (c.obstacle) continue; // おじゃまタイルはスキップ
        if (c.item) {
          const tKey = `${t.row},${t.col}`;
          if (!activated.has(tKey)) {
            activated.add(tKey);
            detonations.push({ pos: t, item: c.item });
          }
        } else {
          board[t.row][t.col] = null;
          cleared.push(t);
        }
      }
      totalScore += ITEM_BASE_POINTS.flush * cleared.length;

      effects.push({
        effectType: effect, item1: cell1.item, item2: cell2.item,
        pos1: target, pos2: pos, targets: cleared, detonations,
      });
    } else {
      // Non-flush synthesis
      board[pos.row][pos.col] = null;
      board[target.row][target.col] = null;

      const targets = getSynthesisTargets(board, synthPos, effect);
      const cleared: Position[] = [];
      const detonations: { pos: Position; item: ItemType }[] = [];

      for (const t of targets) {
        const c = board[t.row]?.[t.col];
        if (c === null) continue;
        if (c.obstacle) continue; // おじゃまタイルはスキップ
        if (c.item) {
          const tKey = `${t.row},${t.col}`;
          if (!activated.has(tKey)) {
            activated.add(tKey);
            detonations.push({ pos: t, item: c.item });
          }
        } else {
          board[t.row][t.col] = null;
          cleared.push(t);
        }
      }
      totalScore += synthBasePoints(cell1.item, cell2.item) * cleared.length;

      effects.push({
        effectType: effect, item1: cell1.item, item2: cell2.item,
        pos1: target, pos2: pos, targets: cleared, detonations,
      });
    }

    // Handle detonations with computeItemEffects
    const allSynthCleared: Position[] = [pos, target]; // 合成元も消去済み
    for (const ef of effects) {
      allSynthCleared.push(...ef.targets);
      for (const det of ef.detonations) {
        const detEffects = computeItemEffects(board, det.pos, det.item);
        for (const e of detEffects) {
          totalScore += calcItemEffectScore(e);
          allSynthCleared.push(e.itemPos);
          allSynthCleared.push(...e.targets);
        }
      }
    }

    // おじゃまタイルへのダメージ
    rng = processDamage(board, allSynthCleared, rng);

    const { moves: dropMoves, newTileEntries } = computeDropMoves(board);
    applyGravity(board);
    rng = fillEmptyCells(board, rng);
    const boardAfterDrop = cloneBoard(board);

    const { chains: regularChains, rng: finalRng, totalScore: finalScore } =
      computeChainSteps(board, rng, totalScore, 2);

    return {
      boardAfterSwap,
      boardBeforeActivation: boardBefore,
      effects,
      dropMoves, newTileEntries, boardAfterDrop,
      regularChains,
      finalState: resolveFinalState(
        board, finalScore, finalRng, state.moveCount + 1,
        state.mode, state.moveLimit, state.quotaTable, state.segmentStartScore,
      ),
    };
  }

  /** Record chain/item stats from animation plan data for achievement tracking */
  function recordPlanStats(chains: ChainAnimData[]) {
    for (const chain of chains) {
      if (chain.chainIndex > maxChain.value) {
        maxChain.value = chain.chainIndex;
      }
      if (chain.itemGen) {
        generatedItemTypes.value.add(chain.itemGen.item);
      }
    }
  }

  /** Sprint auto-activation: compute plan for the next item on the board */
  function computeAutoActivationPlan(): { pos: Position; plan: ItemAnimPlan } | null {
    if (!gameState.value || gameState.value.mode !== 'sprint') return null;
    const state = gameState.value;

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const cell = state.board[r][c];
        if (!cell?.item) continue;
        const pos = { row: r, col: c };
        const board = cloneBoard(state.board);
        let targetColor: number | undefined;
        if (cell.item === 'flush') {
          targetColor = findFlushTargetColor(board, pos) ?? undefined;
        }
        // moveCount - 1 because buildItemPlan adds 1 internally; we don't want to increment
        const plan = buildItemPlan(
          board, state.rngState, state.score, state.moveCount - 1,
          pos, cell.item, targetColor,
          state.mode, state.moveLimit, state.quotaTable, state.segmentStartScore,
        );
        return { pos, plan };
      }
    }
    return null;
  }

  function setDisplayScore(s: number) { _displayScore.value = s; }

  function applyState(state: GameState) {
    _displayScore.value = null;
    gameState.value = state;
  }

  /** Debug-only: place an item on the board */
  function placeItem(pos: Position, item: ItemType) {
    if (!gameState.value) return;
    const cell = gameState.value.board[pos.row]?.[pos.col];
    if (!cell) return;
    gameState.value.board[pos.row][pos.col] = { color: 0 as Color, item };
  }

  return {
    gameState, seed,
    board, score, moveCount, autoActivating, isGameOver, isCleared,
    mode, moveLimit, remainingMoves,
    obstacleCount, quotaTable, quotaTarget, movesUntilCheck, segmentScore,
    startGame, restoreState, swap, tap,
    activateScope, applyScopeSynthesis,
    computeScopePlan, computeScopeSynthesisPlan,
    computeSwapPlan, computeItemTapPlan, computeItemSwapPlan, computeSynthesisPlan,
    computeAutoActivationPlan,
    applyState, setDisplayScore, placeItem,
    maxChain, generatedItemTypes, recordPlanStats,
  };
});
