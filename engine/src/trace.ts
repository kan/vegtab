import {
  type Cell, type Color, type Direction, type GameMode, type GameState,
  type ItemType, type Match, type Position, type SynthesisEffect,
  BOARD_SIZE, NUM_COLORS,
} from './types.js';
import {
  cloneBoard, fillEmptyCells, findItemPosition, isValidPosition,
} from './board.js';
import { findMatches, getUniquePositions } from './match.js';
import { applyGravity } from './gravity.js';
import {
  determineItemFromMatches, findFlushTargetColor, getBurstTargets, getFlushTargets,
  getHCutTargets, getItemTargets, getScopeAdjacentTargets, getSynthesisEffect,
  getSynthesisTargets, getVCutTargets,
} from './item.js';
import { calculateStepScore } from './score.js';
import { checkGameOverState } from './gameOver.js';
import { damageObstacles, damageObstacleAt } from './obstacle.js';
import {
  computeWavePositions, SURVIVAL_WAVE_INTERVAL,
} from './survival.js';
import { isPassThroughMode, processAction, processDamage, processScopeSynthesis } from './engine.js';

function adjPos(pos: Position, dir: Direction): Position {
  switch (dir) {
    case 'up': return { row: pos.row - 1, col: pos.col };
    case 'down': return { row: pos.row + 1, col: pos.col };
    case 'left': return { row: pos.row, col: pos.col - 1 };
    case 'right': return { row: pos.row, col: pos.col + 1 };
  }
}

export interface ChainAnimData {
  matches: Match[];
  clearedPositions: Position[];
  destroyedObstacles: Position[];
  itemGens: { pos: Position; item: ItemType }[];
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
  waveAnim?: WaveAnimPlan;
}

export interface ItemEffectStep {
  itemType: ItemType;
  itemPos: Position;
  targets: Position[];
  detonations: { pos: Position; item: ItemType }[];
  depth: number;
  score: number;
}

export interface ItemAnimPlan {
  boardBeforeActivation: (Cell | null)[][];
  effects: ItemEffectStep[];
  dropMoves: { col: number; fromRow: number; toRow: number }[];
  newTileEntries: { row: number; col: number; segNulls: number }[];
  boardAfterDrop: (Cell | null)[][];
  regularChains: ChainAnimData[];
  finalState: GameState;
  waveAnim?: WaveAnimPlan;
}

export interface WaveAnimStep {
  pos: Position;
  kind: 'place' | 'bump' | 'item_activate';
  effects?: ItemEffectStep[];
  dropMoves?: { col: number; fromRow: number; toRow: number }[];
  newTileEntries?: { row: number; col: number; segNulls: number }[];
  chainsAfter?: ChainAnimData[];
  newDurability?: number;
  boardAfter: (Cell | null)[][];
  score: number;
}

export interface WaveAnimPlan {
  waveNumber: number;
  obstacleCount: number;
  steps: WaveAnimStep[];
  totalScore: number;
  finalBoard: (Cell | null)[][];
}

export interface SynthesisEffectStep {
  effectType: SynthesisEffect;
  item1: ItemType;
  item2: ItemType;
  pos1: Position;
  pos2: Position;
  targets: Position[];
  detonations: { pos: Position; item: ItemType }[];
  score: number;
}

export interface SynthesisAnimPlan {
  boardAfterSwap: (Cell | null)[][];
  boardBeforeActivation: (Cell | null)[][];
  effects: SynthesisEffectStep[];
  effectScore: number;
  dropMoves: { col: number; fromRow: number; toRow: number }[];
  newTileEntries: { row: number; col: number; segNulls: number }[];
  boardAfterDrop: (Cell | null)[][];
  regularChains: ChainAnimData[];
  finalState: GameState;
  waveAnim?: WaveAnimPlan;
}

export interface ScopeAnimPlan {
  scopePos: Position;
  adjacentTargets: Position[];
  targetCells: Position[];
  effectScore: number;
  boardAfterClear: (Cell | null)[][];
  itemEffects: ItemEffectStep[];
  dropMoves: { col: number; fromRow: number; toRow: number }[];
  newTileEntries: { row: number; col: number; segNulls: number }[];
  boardAfterDrop: (Cell | null)[][];
  regularChains: ChainAnimData[];
  finalState: GameState;
  waveAnim?: WaveAnimPlan;
}

export interface ScopeSynthesisAnimPlan {
  pos1: Position;
  pos2: Position;
  synthEffect: SynthesisEffect;
  adjacentTargets: Position[];
  targetCells: Position[];
  effectTargets: Position[];
  effectScore: number;
  itemEffects: ItemEffectStep[];
  boardAfterClear: (Cell | null)[][];
  dropMoves: { col: number; fromRow: number; toRow: number }[];
  newTileEntries: { row: number; col: number; segNulls: number }[];
  boardAfterDrop: (Cell | null)[][];
  regularChains: ChainAnimData[];
  finalState: GameState;
  waveAnim?: WaveAnimPlan;
}

export interface ScopeSwapPreChainResult {
  boardAfterSwap: (Cell | null)[][];
  boardAfterPreChains: (Cell | null)[][];
  preChains: ChainAnimData[];
  preScore: number;
  preRng: number[];
  scopePos: Position;
}

/** Item effect score shown in the UI. This now uses the same exact values the engine applied. */
export function calcItemEffectScore(step: ItemEffectStep): number {
  return step.score;
}

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
    for (let i = 0; i < nullCount; i++) {
      newTileEntries.push({ row: start + i, col, segNulls: nullCount });
    }
  }
}

function computeDropMoves(board: (Cell | null)[][], passThroughObstacles = false) {
  const moves: { col: number; fromRow: number; toRow: number }[] = [];
  const newTileEntries: { row: number; col: number; segNulls: number }[] = [];
  for (let col = 0; col < BOARD_SIZE; col++) {
    let hasObstacle = false;
    for (let row = 0; row < BOARD_SIZE; row++) {
      if (board[row][col]?.obstacle) { hasObstacle = true; break; }
    }

    if (!hasObstacle) {
      computeDropMovesForSegment(board, col, 0, BOARD_SIZE, moves, newTileEntries);
    } else if (passThroughObstacles) {
      const freeRows: number[] = [];
      const tiles: { row: number; cell: Cell }[] = [];
      for (let row = BOARD_SIZE - 1; row >= 0; row--) {
        if (board[row][col]?.obstacle) continue;
        freeRows.push(row);
        if (board[row][col] !== null) {
          tiles.push({ row, cell: board[row][col]! });
        }
      }
      let nullCount = 0;
      for (let i = 0; i < freeRows.length; i++) {
        if (i < tiles.length) {
          if (freeRows[i] !== tiles[i].row) {
            moves.push({ col, fromRow: tiles[i].row, toRow: freeRows[i] });
          }
        } else {
          nullCount++;
        }
      }
      if (nullCount > 0) {
        const topFreeRows = freeRows.slice(freeRows.length - nullCount);
        for (const row of topFreeRows) {
          newTileEntries.push({ row, col, segNulls: nullCount });
        }
      }
    } else {
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

function resolveFinalState(
  board: (Cell | null)[][],
  score: number,
  rngState: number[],
  moveCount: number,
  mode: GameMode,
  moveLimit: number | undefined,
  seed: number | undefined,
  numColors: number,
  maxChainIndex?: number,
  cascadePoints?: number,
): GameState {
  const tempState: GameState = {
    board, score, rngState, moveCount,
    isGameOver: false, mode, moveLimit, seed,
    numColors, maxChainIndex, cascadePoints,
  };
  const goResult = checkGameOverState(tempState);
  return {
    board: cloneBoard(board),
    score,
    rngState,
    moveCount,
    isGameOver: goResult.gameOver,
    isCleared: goResult.isCleared,
    mode,
    moveLimit,
    seed,
    numColors,
    maxChainIndex,
    cascadePoints,
  };
}

function computeItemEffects(
  board: (Cell | null)[][],
  startPos: Position,
  startItem: ItemType,
  targetColor?: number,
  chainIndex = 1,
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
    const flushColors = snapshotFlushColors(board, allTargets);

    for (const t of allTargets) {
      const c = board[t.row]?.[t.col];
      if (c === null) continue;
      if (c.obstacle) {
        if (damageObstacleAt(board, t)) cleared.push(t);
        continue;
      }
      if (c.item) {
        const tKey = `${t.row},${t.col}`;
        if (!activated.has(tKey)) {
          detonations.push({ pos: t, item: c.item });
          queue.push({
            pos: t,
            item: c.item,
            targetColor: c.item === 'flush' ? flushColors.get(tKey) : undefined,
            depth: cur.depth + 1,
          });
        }
      } else {
        board[t.row][t.col] = null;
        cleared.push(t);
      }
    }

    effects.push({
      itemType: cur.item,
      itemPos: cur.pos,
      targets: cleared,
      detonations,
      depth: cur.depth,
      score: 10 * cleared.length * chainIndex,
    });
  }
  return effects;
}

function accumulateItemEffects(
  effects: ItemEffectStep[],
  outEffects: ItemEffectStep[],
  outCleared: Position[],
): number {
  let score = 0;
  for (const e of effects) {
    score += e.score;
    outEffects.push(e);
    outCleared.push(e.itemPos, ...e.targets);
  }
  return score;
}

function computeChainSteps(
  board: (Cell | null)[][],
  rng: number[],
  totalScore: number,
  startChain: number,
  gameMode: GameMode = 'sprint',
  suppressItemGen = false,
  numColors: number = NUM_COLORS,
  initialMaxChain = 0,
  initialCascadePoints = 0,
) {
  const chains: ChainAnimData[] = [];
  const passThrough = isPassThroughMode(gameMode);
  const MAX_CHAIN_ITERATIONS = 20;
  let chainIndex = startChain;
  let iterations = 0;
  let matches = findMatches(board);
  let maxChainIndex = initialMaxChain;
  let cascadePoints = initialCascadePoints;

  while (matches.length > 0) {
    iterations++;
    if (iterations > MAX_CHAIN_ITERATIONS) {
      while (true) {
        const m = findMatches(board);
        if (m.length === 0) break;
        const c = getUniquePositions(m);
        for (const p of c) board[p.row][p.col] = null;
        rng = processDamage(board, c, rng, gameMode, numColors);
        applyGravity(board, passThrough);
        rng = fillEmptyCells(board, rng, numColors);
      }
      break;
    }

    const clearedPositions = getUniquePositions(matches);
    const itemGens = suppressItemGen ? [] : determineItemFromMatches(matches);
    const stepScore = calculateStepScore(matches, chainIndex);
    totalScore += stepScore;

    for (const p of clearedPositions) board[p.row][p.col] = null;
    for (const ig of itemGens) {
      board[ig.pos.row][ig.pos.col] = { color: 0 as Color, item: ig.item };
    }

    const destroyed = damageObstacles(board, clearedPositions);
    if (destroyed.length > 0) {
      applyGravity(board, passThrough);
      rng = fillEmptyCells(board, rng, numColors);
    }

    const { moves: dm, newTileEntries: nt } = computeDropMoves(board, passThrough);
    applyGravity(board, passThrough);
    rng = fillEmptyCells(board, rng, numColors);

    chains.push({
      matches,
      clearedPositions,
      destroyedObstacles: destroyed,
      itemGens,
      score: stepScore,
      chainIndex,
      dropMoves: dm,
      newTileEntries: nt,
      boardAfterDrop: cloneBoard(board),
    });

    if (chainIndex > maxChainIndex) maxChainIndex = chainIndex;
    if (gameMode === 'cascade' && chainIndex >= 2) cascadePoints += chainIndex;

    chainIndex++;
    matches = findMatches(board);
  }

  return { chains, rng, totalScore, maxChainIndex, cascadePoints };
}

function computeWavePlanForAnim(
  board: (Cell | null)[][],
  seed: number,
  waveNumber: number,
  rngState: number[],
  numColors: number,
): { plan: WaveAnimPlan; rng: number[] } {
  const positions = computeWavePositions(seed, waveNumber);
  const steps: WaveAnimStep[] = [];
  let rng = rngState;
  let totalScore = 0;

  for (const pos of positions) {
    const cell = board[pos.row]?.[pos.col];

    if (cell?.obstacle) {
      cell.obstacle.durability += 1;
      steps.push({
        pos,
        kind: 'bump',
        newDurability: cell.obstacle.durability,
        boardAfter: cloneBoard(board),
        score: 0,
      });
      continue;
    }

    if (cell?.item) {
      const item = cell.item;
      const effectsAccum: ItemEffectStep[] = [];
      let stepScore = 0;

      if (item === 'scope') {
        board[pos.row][pos.col] = null;
        const adjTargets = getScopeAdjacentTargets(board, pos);
        const cleared: Position[] = [];
        const detonations: { pos: Position; item: ItemType }[] = [];
        for (const t of adjTargets) {
          const adj = board[t.row]?.[t.col];
          if (!adj) continue;
          if (adj.obstacle) {
            if (damageObstacleAt(board, t)) cleared.push(t);
            continue;
          }
          if (adj.item) {
            const detEffects = computeItemEffects(
              board,
              t,
              adj.item,
              adj.item === 'flush' ? (findFlushTargetColor(board, t) ?? undefined) : undefined,
              1,
            );
            detonations.push({ pos: t, item: adj.item });
            effectsAccum.push(...detEffects);
          } else {
            board[t.row][t.col] = null;
            cleared.push(t);
          }
        }
        effectsAccum.unshift({
          itemType: 'scope',
          itemPos: pos,
          targets: cleared,
          detonations,
          depth: 0,
          score: 10 * cleared.length,
        });
      } else if (item === 'flush') {
        const targetColor = findFlushTargetColor(board, pos) ?? undefined;
        if (targetColor === undefined) {
          board[pos.row][pos.col] = null;
        } else {
          effectsAccum.push(...computeItemEffects(board, pos, item, targetColor, 1));
        }
      } else {
        effectsAccum.push(...computeItemEffects(board, pos, item, undefined, 1));
      }

      for (const e of effectsAccum) stepScore += e.score;
      totalScore += stepScore;

      const { moves: dropMoves, newTileEntries } = computeDropMoves(board, true);
      applyGravity(board, true);
      rng = fillEmptyCells(board, rng, numColors);
      const chainResult = computeChainSteps(board, rng, 0, 2, 'survival', false, numColors);
      const chainsAfter = chainResult.chains;
      stepScore += chainResult.totalScore;
      totalScore += chainResult.totalScore;
      rng = chainResult.rng;

      const finalColor: Color = ((board[pos.row]?.[pos.col]?.color ?? 0) as Color);
      board[pos.row][pos.col] = { color: finalColor, obstacle: { durability: 1 } };

      steps.push({
        pos,
        kind: 'item_activate',
        effects: effectsAccum,
        dropMoves,
        newTileEntries,
        chainsAfter,
        boardAfter: cloneBoard(board),
        score: stepScore,
      });
      continue;
    }

    const color: Color = ((cell?.color ?? 0) as Color);
    board[pos.row][pos.col] = { color, obstacle: { durability: 1 } };
    steps.push({
      pos,
      kind: 'place',
      boardAfter: cloneBoard(board),
      score: 0,
    });
  }

  return {
    plan: {
      waveNumber,
      obstacleCount: positions.length,
      steps,
      totalScore,
      finalBoard: cloneBoard(board),
    },
    rng,
  };
}

function shouldTriggerWaveAfter(gameMode: GameMode, seed: number | undefined, newMoveCount: number): boolean {
  return gameMode === 'survival'
    && seed !== undefined
    && newMoveCount > 0
    && newMoveCount % SURVIVAL_WAVE_INTERVAL === 0;
}

function maybeAppendWavePlan(
  board: (Cell | null)[][],
  newMoveCount: number,
  gameMode: GameMode,
  seed: number | undefined,
  rngState: number[],
  numColors: number,
): { waveAnim?: WaveAnimPlan; rng: number[]; scoreDelta: number } {
  if (!shouldTriggerWaveAfter(gameMode, seed, newMoveCount)) {
    return { rng: rngState, scoreDelta: 0 };
  }
  const waveNumber = newMoveCount / SURVIVAL_WAVE_INTERVAL;
  const { plan, rng } = computeWavePlanForAnim(board, seed!, waveNumber, rngState, numColors);
  return { waveAnim: plan, rng, scoreDelta: plan.totalScore };
}

function syncPlanBoard(plan: ItemAnimPlan): void {
  const authBoard = cloneBoard(plan.finalState.board);
  if (plan.waveAnim) {
    plan.waveAnim.finalBoard = authBoard;
    return;
  }
  if (plan.regularChains.length > 0) {
    plan.regularChains[plan.regularChains.length - 1].boardAfterDrop = authBoard;
  } else {
    plan.boardAfterDrop = authBoard;
  }
}

function buildItemPlan(
  state: GameState,
  board: (Cell | null)[][],
  rngState: number[],
  baseScore: number,
  moveCount: number,
  itemPos: Position,
  itemType: ItemType,
  targetColor: number | undefined,
  suppressItemGen = false,
  suppressChains = false,
): ItemAnimPlan {
  const boardBefore = cloneBoard(board);
  const effects = computeItemEffects(board, itemPos, itemType, targetColor, 1);
  let scoreFromItems = 0;
  for (const e of effects) scoreFromItems += e.score;

  const passThrough = isPassThroughMode(state.mode);
  const { moves: dropMoves, newTileEntries } = computeDropMoves(board, passThrough);
  applyGravity(board, passThrough);
  let rng = fillEmptyCells(board, rngState, state.numColors ?? NUM_COLORS);
  const boardAfterDrop = cloneBoard(board);

  let regularChains: ChainAnimData[];
  let totalScore: number;
  let maxChainIndex = state.maxChainIndex ?? 0;
  let cascadePoints = state.cascadePoints ?? 0;
  if (suppressChains) {
    regularChains = [];
    totalScore = baseScore + scoreFromItems;
  } else {
    const result = computeChainSteps(
      board,
      rng,
      baseScore + scoreFromItems,
      2,
      state.mode,
      suppressItemGen,
      state.numColors ?? NUM_COLORS,
      maxChainIndex,
      cascadePoints,
    );
    regularChains = result.chains;
    totalScore = result.totalScore;
    rng = result.rng;
    maxChainIndex = result.maxChainIndex;
    cascadePoints = result.cascadePoints;
  }

  const newMoveCount = moveCount + 1;
  const waveResult = maybeAppendWavePlan(board, newMoveCount, state.mode, state.seed, rng, state.numColors ?? NUM_COLORS);
  totalScore += waveResult.scoreDelta;
  rng = waveResult.rng;

  return {
    boardBeforeActivation: boardBefore,
    effects,
    dropMoves,
    newTileEntries,
    boardAfterDrop,
    regularChains,
    finalState: resolveFinalState(
      board,
      totalScore,
      rng,
      newMoveCount,
      state.mode,
      state.moveLimit,
      state.seed,
      state.numColors ?? NUM_COLORS,
      maxChainIndex,
      cascadePoints,
    ),
    waveAnim: waveResult.waveAnim,
  };
}

export function computeScopePlan(state: GameState, scopePos: Position, targetCells: Position[]): ScopeAnimPlan | null {
  const cell = state.board[scopePos.row]?.[scopePos.col];
  if (!cell?.item || cell.item !== 'scope') return null;

  const board = cloneBoard(state.board);
  board[scopePos.row][scopePos.col] = null;

  let totalScore = state.score;
  let rng = state.rngState;
  const itemEffects: ItemEffectStep[] = [];
  const adjacentTargets = getScopeAdjacentTargets(board, scopePos);
  const allScopeCleared: Position[] = [scopePos];

  for (const t of adjacentTargets) {
    const ac = board[t.row]?.[t.col];
    if (!ac) continue;
    if (ac.obstacle) {
      if (damageObstacleAt(board, t)) allScopeCleared.push(t);
      continue;
    }
    if (ac.item) {
      totalScore += accumulateItemEffects(
        computeItemEffects(board, t, ac.item, ac.item === 'flush' ? (findFlushTargetColor(board, t) ?? undefined) : undefined, 1),
        itemEffects,
        allScopeCleared,
      );
    } else {
      board[t.row][t.col] = null;
      allScopeCleared.push(t);
      totalScore += 10;
    }
  }

  for (const target of targetCells) {
    const tc = board[target.row]?.[target.col];
    if (!tc) continue;
    if (tc.obstacle) {
      if (damageObstacleAt(board, target)) allScopeCleared.push(target);
      continue;
    }
    if (tc.item) {
      totalScore += accumulateItemEffects(
        computeItemEffects(board, target, tc.item, tc.item === 'flush' ? (findFlushTargetColor(board, target) ?? undefined) : undefined, 1),
        itemEffects,
        allScopeCleared,
      );
    } else {
      board[target.row][target.col] = null;
      allScopeCleared.push(target);
      totalScore += 10;
    }
  }

  const passThrough = isPassThroughMode(state.mode);
  const effectScore = totalScore - state.score;
  const boardAfterClear = cloneBoard(board);
  const { moves: dropMoves, newTileEntries } = computeDropMoves(board, passThrough);
  applyGravity(board, passThrough);
  rng = fillEmptyCells(board, rng, state.numColors ?? NUM_COLORS);
  let boardAfterDrop = cloneBoard(board);
  const chainResult = computeChainSteps(
    board,
    rng,
    totalScore,
    2,
    state.mode,
    false,
    state.numColors ?? NUM_COLORS,
    state.maxChainIndex ?? 0,
    state.cascadePoints ?? 0,
  );
  const regularChains = chainResult.chains;
  rng = chainResult.rng;

  const waveResult = maybeAppendWavePlan(board, state.moveCount + 1, state.mode, state.seed, rng, state.numColors ?? NUM_COLORS);
  const finalState = processAction(state, { type: 'scope', pos: scopePos, targetCells });
  if (finalState === state) return null;

  const authBoard = cloneBoard(finalState.board);
  if (waveResult.waveAnim) {
    waveResult.waveAnim.finalBoard = authBoard;
  } else if (regularChains.length > 0) {
    regularChains[regularChains.length - 1].boardAfterDrop = authBoard;
  } else {
    boardAfterDrop = authBoard;
  }

  return {
    scopePos,
    adjacentTargets,
    targetCells,
    effectScore,
    boardAfterClear,
    itemEffects,
    dropMoves,
    newTileEntries,
    boardAfterDrop,
    regularChains,
    finalState,
    waveAnim: waveResult.waveAnim,
  };
}

export function computeScopeSwapPreChains(state: GameState, pos: Position, dir: Direction): ScopeSwapPreChainResult | null {
  const target = adjPos(pos, dir);
  if (!isValidPosition(target)) return null;
  const cell1 = state.board[pos.row][pos.col];
  const cell2 = state.board[target.row][target.col];
  if (!cell1 || !cell2) return null;
  const scopeCell = cell1.item === 'scope' ? cell1 : cell2.item === 'scope' ? cell2 : null;
  if (!scopeCell) return null;
  if (cell1.item && cell2.item) return null;

  const board = cloneBoard(state.board);
  board[pos.row][pos.col] = { ...cell2 };
  board[target.row][target.col] = { ...cell1 };
  const boardAfterSwap = cloneBoard(board);
  const origScopePos = cell1.item === 'scope' ? target : pos;

  const preChainResult = computeChainSteps(
    board,
    state.rngState,
    state.score,
    1,
    state.mode,
    false,
    state.numColors ?? NUM_COLORS,
    state.maxChainIndex ?? 0,
    state.cascadePoints ?? 0,
  );
  const scopePos = findItemPosition(board, 'scope', origScopePos);
  if (!scopePos) return null;

  return {
    boardAfterSwap,
    boardAfterPreChains: cloneBoard(board),
    preChains: preChainResult.chains,
    preScore: preChainResult.totalScore,
    preRng: preChainResult.rng,
    scopePos,
  };
}

export function computeScopeSynthesisPlan(state: GameState, pos1: Position, pos2: Position, targetCells: Position[]): ScopeSynthesisAnimPlan | null {
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
  const adj1 = getScopeAdjacentTargets(board, pos1);
  const adj2 = getScopeAdjacentTargets(board, pos2);
  const adjSet = new Set<string>();
  const adjacentTargets: Position[] = [];
  const allSynthCleared: Position[] = [pos1, pos2];

  for (const t of [...adj1, ...adj2]) {
    const key = `${t.row},${t.col}`;
    if (adjSet.has(key)) continue;
    adjSet.add(key);
    adjacentTargets.push(t);
    const ac = board[t.row]?.[t.col];
    if (!ac) continue;
    if (ac.obstacle) {
      if (damageObstacleAt(board, t)) allSynthCleared.push(t);
      continue;
    }
    if (ac.item) {
      totalScore += accumulateItemEffects(
        computeItemEffects(board, t, ac.item, ac.item === 'flush' ? (findFlushTargetColor(board, t) ?? undefined) : undefined, 1),
        itemEffects,
        allSynthCleared,
      );
    } else {
      board[t.row][t.col] = null;
      effectTargets.push(t);
      allSynthCleared.push(t);
      totalScore += 10;
    }
  }

  if (effect === 'scope+scope') {
    for (const target of targetCells) {
      const tc = board[target.row]?.[target.col];
      if (!tc) continue;
      if (tc.obstacle) {
        if (damageObstacleAt(board, target)) allSynthCleared.push(target);
        continue;
      }
      if (tc.item) {
        totalScore += accumulateItemEffects(
          computeItemEffects(board, target, tc.item, tc.item === 'flush' ? (findFlushTargetColor(board, target) ?? undefined) : undefined, 1),
          itemEffects,
          allSynthCleared,
        );
      } else {
        board[target.row][target.col] = null;
        effectTargets.push(target);
        allSynthCleared.push(target);
        totalScore += 10;
      }
    }
  } else {
    const synthTargets = getSynthesisTargets(board, pos2, effect, undefined, targetCells);
    const activated = new Set<string>([`${pos1.row},${pos1.col}`, `${pos2.row},${pos2.col}`]);
    for (const t of synthTargets) {
      const c = board[t.row]?.[t.col];
      if (c === null) continue;
      if (c.obstacle) {
        if (damageObstacleAt(board, t)) allSynthCleared.push(t);
        continue;
      }
      if (c.item) {
        const tKey = `${t.row},${t.col}`;
        if (!activated.has(tKey)) {
          activated.add(tKey);
          totalScore += accumulateItemEffects(
            computeItemEffects(board, t, c.item, c.item === 'flush' ? (findFlushTargetColor(board, t) ?? undefined) : undefined, 1),
            itemEffects,
            allSynthCleared,
          );
        }
      } else {
        board[t.row][t.col] = null;
        effectTargets.push(t);
        allSynthCleared.push(t);
        totalScore += 10;
      }
    }
  }

  const passThrough = isPassThroughMode(state.mode);
  const effectScore = totalScore - state.score;
  const boardAfterClear = cloneBoard(board);
  const { moves: dropMoves, newTileEntries } = computeDropMoves(board, passThrough);
  applyGravity(board, passThrough);
  rng = fillEmptyCells(board, rng, state.numColors ?? NUM_COLORS);
  let boardAfterDrop = cloneBoard(board);
  const chainResult = computeChainSteps(
    board,
    rng,
    totalScore,
    2,
    state.mode,
    false,
    state.numColors ?? NUM_COLORS,
    state.maxChainIndex ?? 0,
    state.cascadePoints ?? 0,
  );
  const regularChains = chainResult.chains;
  rng = chainResult.rng;
  const waveResult = maybeAppendWavePlan(board, state.moveCount + 1, state.mode, state.seed, rng, state.numColors ?? NUM_COLORS);
  const finalState = processScopeSynthesis(state, pos1, pos2, targetCells);
  const authBoard = cloneBoard(finalState.board);
  if (waveResult.waveAnim) {
    waveResult.waveAnim.finalBoard = authBoard;
  } else if (regularChains.length > 0) {
    regularChains[regularChains.length - 1].boardAfterDrop = authBoard;
  } else {
    boardAfterDrop = authBoard;
  }

  return {
    pos1,
    pos2,
    synthEffect: effect,
    adjacentTargets,
    targetCells,
    effectTargets,
    effectScore,
    itemEffects,
    boardAfterClear,
    dropMoves,
    newTileEntries,
    boardAfterDrop,
    regularChains,
    finalState,
    waveAnim: waveResult.waveAnim,
  };
}

export function computeSwapPlan(state: GameState, pos: Position, dir: Direction): SwapAnimPlan | null {
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
  const passThrough = isPassThroughMode(state.mode);
  let rng = state.rngState;
  let totalScore = state.score;
  let chainIndex = 1;
  let chainIterations = 0;

  while (matches.length > 0) {
    chainIterations++;
    if (chainIterations > 20) {
      while (true) {
        const m = findMatches(board);
        if (m.length === 0) break;
        const c = getUniquePositions(m);
        for (const p of c) board[p.row][p.col] = null;
        rng = processDamage(board, c, rng, state.mode, state.numColors ?? NUM_COLORS);
        applyGravity(board, passThrough);
        rng = fillEmptyCells(board, rng, state.numColors ?? NUM_COLORS);
      }
      break;
    }
    const clearedPositions = getUniquePositions(matches);
    const itemGens = determineItemFromMatches(matches, chainIndex === 1 ? [pos, target] : undefined);
    const stepScore = calculateStepScore(matches, chainIndex);
    totalScore += stepScore;

    for (const p of clearedPositions) board[p.row][p.col] = null;
    for (const ig of itemGens) {
      board[ig.pos.row][ig.pos.col] = { color: 0 as Color, item: ig.item };
    }

    const destroyed = damageObstacles(board, clearedPositions);
    if (destroyed.length > 0) {
      applyGravity(board, passThrough);
      rng = fillEmptyCells(board, rng, state.numColors ?? NUM_COLORS);
    }

    const { moves: dropMoves, newTileEntries } = computeDropMoves(board, passThrough);
    applyGravity(board, passThrough);
    rng = fillEmptyCells(board, rng, state.numColors ?? NUM_COLORS);
    chains.push({
      matches,
      clearedPositions,
      destroyedObstacles: destroyed,
      itemGens,
      score: stepScore,
      chainIndex,
      dropMoves,
      newTileEntries,
      boardAfterDrop: cloneBoard(board),
    });
    chainIndex++;
    matches = findMatches(board);
  }

  const waveResult = maybeAppendWavePlan(board, state.moveCount + 1, state.mode, state.seed, rng, state.numColors ?? NUM_COLORS);
  const finalState = processAction(state, { type: 'swap', pos, dir });
  if (finalState === state) return null;

  if (waveResult.waveAnim) {
    waveResult.waveAnim.finalBoard = cloneBoard(finalState.board);
  } else if (chains.length > 0) {
    chains[chains.length - 1].boardAfterDrop = cloneBoard(finalState.board);
  }

  return { boardAfterSwap, chains, finalState, waveAnim: waveResult.waveAnim };
}

export function computeItemTapPlan(state: GameState, pos: Position): ItemAnimPlan | null {
  const cell = state.board[pos.row]?.[pos.col];
  if (!cell?.item) return null;
  const board = cloneBoard(state.board);
  let targetColor: number | undefined;
  if (cell.item === 'flush') {
    targetColor = findFlushTargetColor(board, pos) ?? undefined;
    if (targetColor === undefined) return null;
  }

  const plan = buildItemPlan(state, board, state.rngState, state.score, state.moveCount, pos, cell.item, targetColor, false, false);
  const finalState = processAction(state, { type: 'tap', pos });
  if (finalState === state) return null;
  plan.finalState = finalState;
  syncPlanBoard(plan);
  return plan;
}

export function computeItemSwapPlan(state: GameState, pos: Position, dir: Direction): {
  boardAfterSwap: (Cell | null)[][];
  preChains: ChainAnimData[];
  preScore: number;
  plan: ItemAnimPlan;
} | null {
  const target = adjPos(pos, dir);
  if (!isValidPosition(target)) return null;
  const cell1 = state.board[pos.row][pos.col];
  const cell2 = state.board[target.row][target.col];
  if (!cell1 || !cell2) return null;
  if (cell1.item && cell2.item) return null;
  if (!cell1.item && !cell2.item) return null;

  const board = cloneBoard(state.board);
  board[pos.row][pos.col] = { ...cell2 };
  board[target.row][target.col] = { ...cell1 };
  const boardAfterSwap = cloneBoard(board);
  const itemCell = cell1.item ? cell1 : cell2;
  const otherCell = cell1.item ? cell2 : cell1;
  const origItemPos = cell1.item ? target : pos;

  const preChainResult = computeChainSteps(
    board,
    state.rngState,
    state.score,
    1,
    state.mode,
    false,
    state.numColors ?? NUM_COLORS,
    state.maxChainIndex ?? 0,
    state.cascadePoints ?? 0,
  );
  const newItemPos = findItemPosition(board, itemCell.item!, origItemPos);
  if (!newItemPos) return null;

  let targetColor: number | undefined;
  if (itemCell.item === 'flush') targetColor = otherCell.color;

  const plan = buildItemPlan(state, board, preChainResult.rng, preChainResult.totalScore, state.moveCount, newItemPos, itemCell.item!, targetColor, false, false);
  const finalState = processAction(state, { type: 'swap', pos, dir });
  if (finalState === state) return null;
  plan.finalState = finalState;
  syncPlanBoard(plan);
  return {
    boardAfterSwap,
    preChains: preChainResult.chains,
    preScore: preChainResult.totalScore,
    plan,
  };
}

export function computeSynthesisPlan(state: GameState, pos: Position, dir: Direction): SynthesisAnimPlan | null {
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
  const effect = synthesis.effect;
  let rng = state.rngState;
  let totalScore = state.score;
  const effects: SynthesisEffectStep[] = [];
  const activated = new Set<string>([`${pos.row},${pos.col}`, `${target.row},${target.col}`]);

  if (effect === 'flush+flush') {
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
    totalScore += 1000;
    effects.push({
      effectType: effect,
      item1: cell1.item,
      item2: cell2.item,
      pos1: target,
      pos2: pos,
      targets,
      detonations: [],
      score: 1000,
    });
  } else if (effect.startsWith('flush+')) {
    const otherItem = effect.replace('flush+', '') as ItemType;
    const flushPos = cell1.item === 'flush' ? pos : target;
    const targetColor = findFlushTargetColor(board, flushPos) ?? undefined;
    board[pos.row][pos.col] = null;
    board[target.row][target.col] = null;

    const colorTargetsRaw = targetColor != null ? getFlushTargets(board, targetColor) : [];
    const allTargets: Position[] = [];
    const colorTargets: Position[] = [];
    for (const t of colorTargetsRaw) {
      const c = board[t.row]?.[t.col];
      if (!c) continue;
      if (c.obstacle) {
        if (damageObstacleAt(board, t)) allTargets.push(t);
        continue;
      }
      colorTargets.push(t);
      allTargets.push(t);
      board[t.row][t.col] = null;
    }
    let effectScore = 10 * colorTargets.length;
    const detonations: { pos: Position; item: ItemType }[] = [];
    for (const ct of colorTargets) {
      let subTargets: Position[];
      switch (otherItem) {
        case 'v_cut': subTargets = getVCutTargets(ct); break;
        case 'h_cut': subTargets = getHCutTargets(ct); break;
        case 'burst': subTargets = getBurstTargets(ct, 2); break;
        default: subTargets = [];
      }
      const flushColors = snapshotFlushColors(board, subTargets);
      for (const t of subTargets) {
        const c = board[t.row]?.[t.col];
        if (c === null) continue;
        if (c.obstacle) {
          if (damageObstacleAt(board, t)) allTargets.push(t);
          continue;
        }
        if (c.item) {
          const tKey = `${t.row},${t.col}`;
          if (!activated.has(tKey)) {
            activated.add(tKey);
            detonations.push({ pos: t, item: c.item });
            if (c.item === 'flush') flushColors.get(tKey);
          }
        } else {
          board[t.row][t.col] = null;
          allTargets.push(t);
          effectScore += 10;
        }
      }
    }
    totalScore += effectScore;
    effects.push({
      effectType: effect,
      item1: cell1.item,
      item2: cell2.item,
      pos1: target,
      pos2: pos,
      targets: allTargets,
      detonations,
      score: effectScore,
    });
  } else if (effect === 'scope+flush') {
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
      if (c.obstacle) {
        if (damageObstacleAt(board, t)) cleared.push(t);
        continue;
      }
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
    const effectScore = 10 * cleared.length;
    totalScore += effectScore;
    effects.push({
      effectType: effect,
      item1: cell1.item,
      item2: cell2.item,
      pos1: target,
      pos2: pos,
      targets: cleared,
      detonations,
      score: effectScore,
    });
  } else {
    board[pos.row][pos.col] = null;
    board[target.row][target.col] = null;
    const targets = getSynthesisTargets(board, target, effect);
    const cleared: Position[] = [];
    const detonations: { pos: Position; item: ItemType }[] = [];
    for (const t of targets) {
      const c = board[t.row]?.[t.col];
      if (c === null) continue;
      if (c.obstacle) {
        if (damageObstacleAt(board, t)) cleared.push(t);
        continue;
      }
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
    const effectScore = 10 * cleared.length;
    totalScore += effectScore;
    effects.push({
      effectType: effect,
      item1: cell1.item,
      item2: cell2.item,
      pos1: target,
      pos2: pos,
      targets: cleared,
      detonations,
      score: effectScore,
    });
  }

  for (const ef of effects) {
    for (const det of ef.detonations) {
      const detEffects = computeItemEffects(board, det.pos, det.item, det.item === 'flush' ? (findFlushTargetColor(board, det.pos) ?? undefined) : undefined, 1);
      for (const e of detEffects) totalScore += e.score;
    }
  }

  const passThrough = isPassThroughMode(state.mode);
  const effectScore = totalScore - state.score;
  const { moves: dropMoves, newTileEntries } = computeDropMoves(board, passThrough);
  applyGravity(board, passThrough);
  rng = fillEmptyCells(board, rng, state.numColors ?? NUM_COLORS);
  let boardAfterDrop = cloneBoard(board);
  const chainResult = computeChainSteps(
    board,
    rng,
    totalScore,
    2,
    state.mode,
    false,
    state.numColors ?? NUM_COLORS,
    state.maxChainIndex ?? 0,
    state.cascadePoints ?? 0,
  );
  const regularChains = chainResult.chains;
  rng = chainResult.rng;
  const waveResult = maybeAppendWavePlan(board, state.moveCount + 1, state.mode, state.seed, rng, state.numColors ?? NUM_COLORS);
  const finalState = processAction(state, { type: 'swap', pos, dir });
  if (finalState === state) return null;
  const authBoard = cloneBoard(finalState.board);
  if (waveResult.waveAnim) {
    waveResult.waveAnim.finalBoard = authBoard;
  } else if (regularChains.length > 0) {
    regularChains[regularChains.length - 1].boardAfterDrop = authBoard;
  } else {
    boardAfterDrop = authBoard;
  }

  return {
    boardAfterSwap,
    boardBeforeActivation: boardBefore,
    effects,
    effectScore,
    dropMoves,
    newTileEntries,
    boardAfterDrop,
    regularChains,
    finalState,
    waveAnim: waveResult.waveAnim,
  };
}

export function computeAutoActivationPlan(state: GameState): { pos: Position; plan: ItemAnimPlan } | null {
  if (state.mode !== 'sprint') return null;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = state.board[r][c];
      if (!cell?.item || cell.item === 'scope') continue;
      const pos = { row: r, col: c };
      const board = cloneBoard(state.board);
      let targetColor: number | undefined;
      if (cell.item === 'flush') {
        targetColor = findFlushTargetColor(board, pos) ?? undefined;
      }
      const plan = buildItemPlan(state, board, state.rngState, state.score, state.moveCount - 1, pos, cell.item, targetColor, true, true);
      const finalState = processAction(state, { type: 'tap', pos });
      if (finalState !== state) plan.finalState = finalState;
      return { pos, plan };
    }
  }
  return null;
}

