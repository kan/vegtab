/**
 * trace.ts -- Animation plan computation via TraceCollector.
 *
 * Each compute*Plan function creates a collector, delegates to
 * processAction / processScopeSynthesis, then assembles the animation
 * plan from the collected events.  This ensures the plan's finalState
 * is always identical to the engine result (single source of truth).
 */

import {
  type Cell, type Color, type Direction, type GameState,
  type ItemType, type Match, type Position, type SynthesisEffect,
  BOARD_SIZE, NUM_COLORS,
} from './types.js';
import {
  cloneBoard, fillEmptyCells, findItemPosition, isValidPosition,
} from './board.js';
import { findMatches, getUniquePositions } from './match.js';
import { applyGravity } from './gravity.js';
import {
  determineItemFromMatches, getSynthesisEffect,
} from './item.js';
import { calculateStepScore } from './score.js';
import { damageObstacles } from './obstacle.js';
import { computeDropMoves } from './dropMoves.js';
import {
  isPassThroughMode, processAction, processDamage, processScopeSynthesis,
} from './engine.js';
import { SURVIVAL_WAVE_INTERVAL } from './survival.js';
import type {
  TraceCollector, ChainStepData, ItemEffectData, WaveStepData,
  SynthesisEffectData, DropMove, NewTileEntry,
} from './traceCollector.js';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function adjPos(pos: Position, dir: Direction): Position {
  switch (dir) {
    case 'up': return { row: pos.row - 1, col: pos.col };
    case 'down': return { row: pos.row + 1, col: pos.col };
    case 'left': return { row: pos.row, col: pos.col - 1 };
    case 'right': return { row: pos.row, col: pos.col + 1 };
  }
}

// ---------------------------------------------------------------------------
// Exported animation plan interfaces (consumed by frontend)
// ---------------------------------------------------------------------------

export interface ChainAnimData {
  matches: Match[];
  clearedPositions: Position[];
  destroyedObstacles: Position[];
  itemGens: { pos: Position; item: ItemType }[];
  score: number;
  chainIndex: number;
  sparkleCount?: number;
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

/** Item effect score shown in the UI. Uses the engine-computed value. */
export function calcItemEffectScore(step: ItemEffectStep): number {
  return step.score;
}

// ---------------------------------------------------------------------------
// Internal: collector infrastructure
// ---------------------------------------------------------------------------

/**
 * CollectorState tracks the events emitted by the engine during a single
 * processAction / processScopeSynthesis call.  It separates "regular"
 * chain/item events from "wave" events using the onWaveStep boundary.
 */
interface CollectorState {
  // Board snapshots
  boardAfterSwap?: (Cell | null)[][];
  boardBeforeItemActivation?: (Cell | null)[][];
  boardAfterClear?: (Cell | null)[][];
  boardAfterItemDrop?: (Cell | null)[][];

  // Scope data
  adjacentTargets: Position[];

  // Regular (non-wave) events
  chains: ChainAnimData[];
  itemEffects: ItemEffectStep[];
  synthEffects: SynthesisEffectStep[];

  // Drop data (before gravity)
  dropMoves: DropMove[];
  newTileEntries: NewTileEntry[];

  // Wave events
  waveSteps: WaveAnimStep[];
  /** true once the first onWaveStep is received */
  insideWave: boolean;
  /** item effects accumulated for the current wave step (before onWaveStep fires) */
  pendingWaveEffects: ItemEffectStep[];
  /** chain steps accumulated for the current wave step */
  pendingWaveChains: ChainAnimData[];
}

function createCollectorState(): CollectorState {
  return {
    adjacentTargets: [],
    chains: [],
    itemEffects: [],
    synthEffects: [],
    dropMoves: [],
    newTileEntries: [],
    waveSteps: [],
    insideWave: false,
    pendingWaveEffects: [],
    pendingWaveChains: [],
  };
}

function createCollector(cs: CollectorState): TraceCollector {
  return {
    onBoardSnapshot(label, board) {
      switch (label) {
        case 'afterSwap':
          cs.boardAfterSwap = board;
          break;
        case 'beforeItemActivation':
          cs.boardBeforeItemActivation = board;
          break;
        case 'boardAfterClear':
          cs.boardAfterClear = board;
          break;
        case 'afterItemDrop':
          if (!cs.insideWave) {
            cs.boardAfterItemDrop = board;
          }
          break;
      }
    },

    onChainStep(data: ChainStepData) {
      const chain: ChainAnimData = {
        matches: data.matches,
        clearedPositions: data.clearedPositions,
        destroyedObstacles: data.destroyedObstacles,
        itemGens: data.itemGens,
        score: data.score,
        chainIndex: data.chainIndex,
        sparkleCount: data.sparkleCount,
        dropMoves: data.dropMoves,
        newTileEntries: data.newTileEntries,
        boardAfterDrop: data.boardAfterDrop,
      };
      if (cs.insideWave) {
        cs.pendingWaveChains.push(chain);
      } else {
        cs.chains.push(chain);
      }
    },

    onItemEffect(data: ItemEffectData) {
      const effect: ItemEffectStep = {
        itemType: data.itemType,
        itemPos: data.itemPos,
        targets: data.targets,
        detonations: data.detonations,
        depth: data.depth,
        score: data.score,
      };
      if (cs.insideWave) {
        cs.pendingWaveEffects.push(effect);
      } else {
        cs.itemEffects.push(effect);
      }
    },

    onWaveStep(data: WaveStepData) {
      cs.insideWave = true;
      const step: WaveAnimStep = {
        pos: data.pos,
        kind: data.kind,
        newDurability: data.newDurability,
        dropMoves: data.dropMoves,
        newTileEntries: data.newTileEntries,
        boardAfter: data.boardAfter,
        score: data.score,
      };
      if (data.kind === 'item_activate') {
        step.effects = cs.pendingWaveEffects.length > 0
          ? [...cs.pendingWaveEffects]
          : undefined;
        step.chainsAfter = cs.pendingWaveChains.length > 0
          ? [...cs.pendingWaveChains]
          : undefined;
      }
      cs.waveSteps.push(step);
      // Reset pending accumulators for next wave step
      cs.pendingWaveEffects = [];
      cs.pendingWaveChains = [];
    },

    onSynthesisEffect(data: SynthesisEffectData) {
      cs.synthEffects.push({
        effectType: data.effectType,
        item1: data.item1,
        item2: data.item2,
        pos1: data.pos1,
        pos2: data.pos2,
        targets: data.targets,
        detonations: data.detonations,
        score: data.score,
      });
    },

    onScopeAdjacent(targets: Position[]) {
      cs.adjacentTargets.push(...targets);
    },

    onDropData(moves: DropMove[], entries: NewTileEntry[]) {
      if (!cs.insideWave) {
        cs.dropMoves = moves;
        cs.newTileEntries = entries;
      }
    },
  };
}

function buildWaveAnimPlan(cs: CollectorState, finalState: GameState): WaveAnimPlan | undefined {
  if (cs.waveSteps.length === 0) return undefined;
  const waveNumber = finalState.moveCount > 0
    ? Math.floor(finalState.moveCount / SURVIVAL_WAVE_INTERVAL)
    : 0;
  return {
    waveNumber,
    obstacleCount: cs.waveSteps.length,
    steps: cs.waveSteps,
    totalScore: cs.waveSteps.reduce((s, w) => s + w.score, 0),
    finalBoard: cloneBoard(finalState.board),
  };
}

/**
 * Sync the last board of the plan to match finalState.board exactly.
 */
function syncFinalBoard(
  finalState: GameState,
  waveAnim: WaveAnimPlan | undefined,
  chains: ChainAnimData[],
  fallbackSetter: (board: (Cell | null)[][]) => void,
): void {
  const authBoard = cloneBoard(finalState.board);
  if (waveAnim) {
    waveAnim.finalBoard = authBoard;
  } else if (chains.length > 0) {
    chains[chains.length - 1].boardAfterDrop = authBoard;
  } else {
    fallbackSetter(authBoard);
  }
}

// ---------------------------------------------------------------------------
// computeSwapPlan
// ---------------------------------------------------------------------------

export function computeSwapPlan(state: GameState, pos: Position, dir: Direction): SwapAnimPlan | null {
  const target = adjPos(pos, dir);
  if (!isValidPosition(target)) return null;
  const cell1 = state.board[pos.row]?.[pos.col];
  const cell2 = state.board[target.row]?.[target.col];
  if (!cell1 || !cell2) return null;
  if (cell1.item || cell2.item) return null;

  const cs = createCollectorState();
  const collector = createCollector(cs);

  const finalState = processAction(state, { type: 'swap', pos, dir }, collector);
  if (finalState === state) return null;

  const waveAnim = buildWaveAnimPlan(cs, finalState);
  syncFinalBoard(finalState, waveAnim, cs.chains, () => {});

  return {
    boardAfterSwap: cs.boardAfterSwap!,
    chains: cs.chains,
    finalState,
    waveAnim,
  };
}

// ---------------------------------------------------------------------------
// computeItemTapPlan
// ---------------------------------------------------------------------------

export function computeItemTapPlan(state: GameState, pos: Position): ItemAnimPlan | null {
  const cell = state.board[pos.row]?.[pos.col];
  if (!cell?.item) return null;

  const cs = createCollectorState();
  const collector = createCollector(cs);

  const finalState = processAction(state, { type: 'tap', pos }, collector);
  if (finalState === state) return null;

  const waveAnim = buildWaveAnimPlan(cs, finalState);
  let boardAfterDrop = cs.boardAfterItemDrop ?? cloneBoard(finalState.board);

  syncFinalBoard(finalState, waveAnim, cs.chains, (b) => { boardAfterDrop = b; });

  return {
    boardBeforeActivation: cs.boardBeforeItemActivation ?? cloneBoard(state.board),
    effects: cs.itemEffects,
    dropMoves: cs.dropMoves,
    newTileEntries: cs.newTileEntries,
    boardAfterDrop,
    regularChains: cs.chains,
    finalState,
    waveAnim,
  };
}

// ---------------------------------------------------------------------------
// computeItemSwapPlan
// ---------------------------------------------------------------------------

export function computeItemSwapPlan(state: GameState, pos: Position, dir: Direction): {
  boardAfterSwap: (Cell | null)[][];
  preChains: ChainAnimData[];
  preScore: number;
  plan: ItemAnimPlan;
} | null {
  const target = adjPos(pos, dir);
  if (!isValidPosition(target)) return null;
  const cell1 = state.board[pos.row]?.[pos.col];
  const cell2 = state.board[target.row]?.[target.col];
  if (!cell1 || !cell2) return null;
  if (cell1.item && cell2.item) return null;
  if (!cell1.item && !cell2.item) return null;

  const cs = createCollectorState();
  const collector = createCollector(cs);

  const finalState = processAction(state, { type: 'swap', pos, dir }, collector);
  if (finalState === state) return null;

  // Split chains into pre-chains (before item activation) and regular chains (after).
  // Pre-chains have sequential chainIndex starting at 1.
  // After item activation, the engine continues chains at a higher index.
  const preChains: ChainAnimData[] = [];
  const regularChains: ChainAnimData[] = [];
  let preScore = state.score;

  if (cs.boardBeforeItemActivation) {
    // There was an item activation => split chains
    let lastPreChainIndex = 0;
    for (const chain of cs.chains) {
      if (chain.chainIndex === lastPreChainIndex + 1 && regularChains.length === 0) {
        preChains.push(chain);
        lastPreChainIndex = chain.chainIndex;
        preScore += chain.score;
      } else {
        regularChains.push(chain);
      }
    }
  } else {
    // No item activation => item was destroyed in pre-chains
    for (const chain of cs.chains) {
      preChains.push(chain);
      preScore += chain.score;
    }
  }

  const waveAnim = buildWaveAnimPlan(cs, finalState);
  let boardAfterDrop = cs.boardAfterItemDrop ?? cloneBoard(finalState.board);

  syncFinalBoard(finalState, waveAnim, regularChains, (b) => { boardAfterDrop = b; });

  return {
    boardAfterSwap: cs.boardAfterSwap!,
    preChains,
    preScore,
    plan: {
      boardBeforeActivation: cs.boardBeforeItemActivation ?? cs.boardAfterSwap!,
      effects: cs.itemEffects,
      dropMoves: cs.dropMoves,
      newTileEntries: cs.newTileEntries,
      boardAfterDrop,
      regularChains,
      finalState,
      waveAnim,
    },
  };
}

// ---------------------------------------------------------------------------
// computeSynthesisPlan
// ---------------------------------------------------------------------------

export function computeSynthesisPlan(state: GameState, pos: Position, dir: Direction): SynthesisAnimPlan | null {
  const target = adjPos(pos, dir);
  if (!isValidPosition(target)) return null;
  const cell1 = state.board[pos.row]?.[pos.col];
  const cell2 = state.board[target.row]?.[target.col];
  if (!cell1 || !cell2 || !cell1.item || !cell2.item) return null;

  const synthesis = getSynthesisEffect(cell1.item, cell2.item);
  if (!synthesis) return null;

  const cs = createCollectorState();
  const collector = createCollector(cs);

  const finalState = processAction(state, { type: 'swap', pos, dir }, collector);
  if (finalState === state) return null;

  // Compute effectScore from synthesis effects + item detonation effects
  let effectScore = 0;
  for (const e of cs.synthEffects) effectScore += e.score;
  for (const e of cs.itemEffects) effectScore += e.score;

  const waveAnim = buildWaveAnimPlan(cs, finalState);
  let boardAfterDrop = cs.boardAfterItemDrop ?? cloneBoard(finalState.board);

  syncFinalBoard(finalState, waveAnim, cs.chains, (b) => { boardAfterDrop = b; });

  return {
    boardAfterSwap: cs.boardAfterSwap!,
    boardBeforeActivation: cs.boardAfterSwap!,
    effects: cs.synthEffects,
    effectScore,
    dropMoves: cs.dropMoves,
    newTileEntries: cs.newTileEntries,
    boardAfterDrop,
    regularChains: cs.chains,
    finalState,
    waveAnim,
  };
}

// ---------------------------------------------------------------------------
// computeScopePlan
// ---------------------------------------------------------------------------

export function computeScopePlan(state: GameState, scopePos: Position, targetCells: Position[]): ScopeAnimPlan | null {
  const cell = state.board[scopePos.row]?.[scopePos.col];
  if (!cell?.item || cell.item !== 'scope') return null;

  const cs = createCollectorState();
  const collector = createCollector(cs);

  const finalState = processAction(state, { type: 'scope', pos: scopePos, targetCells }, collector);
  if (finalState === state) return null;

  const effectScore = finalState.score - state.score
    - cs.chains.reduce((s, c) => s + c.score, 0)
    - (cs.waveSteps.length > 0 ? cs.waveSteps.reduce((s, w) => s + w.score, 0) : 0);

  const waveAnim = buildWaveAnimPlan(cs, finalState);
  let boardAfterDrop = cs.boardAfterItemDrop ?? cloneBoard(finalState.board);

  syncFinalBoard(finalState, waveAnim, cs.chains, (b) => { boardAfterDrop = b; });

  return {
    scopePos,
    adjacentTargets: cs.adjacentTargets,
    targetCells,
    effectScore,
    boardAfterClear: cs.boardAfterClear ?? cloneBoard(state.board),
    itemEffects: cs.itemEffects,
    dropMoves: cs.dropMoves,
    newTileEntries: cs.newTileEntries,
    boardAfterDrop,
    regularChains: cs.chains,
    finalState,
    waveAnim,
  };
}

// ---------------------------------------------------------------------------
// computeScopeSwapPreChains
// ---------------------------------------------------------------------------

/**
 * This function computes pre-chains for a scope+vegetable swap.
 * It cannot use processAction because it needs to stop partway
 * (after pre-chains, before scope activation) to find the scope position.
 * We replicate the chain logic inline (same algorithm as processChains in engine).
 */
export function computeScopeSwapPreChains(state: GameState, pos: Position, dir: Direction): ScopeSwapPreChainResult | null {
  const target = adjPos(pos, dir);
  if (!isValidPosition(target)) return null;
  const cell1 = state.board[pos.row]?.[pos.col];
  const cell2 = state.board[target.row]?.[target.col];
  if (!cell1 || !cell2) return null;
  const scopeCell = cell1.item === 'scope' ? cell1 : cell2.item === 'scope' ? cell2 : null;
  if (!scopeCell) return null;
  if (cell1.item && cell2.item) return null;

  const board = cloneBoard(state.board);
  board[pos.row][pos.col] = { ...cell2 };
  board[target.row][target.col] = { ...cell1 };
  const boardAfterSwap = cloneBoard(board);
  const origScopePos = cell1.item === 'scope' ? target : pos;

  const passThrough = isPassThroughMode(state.mode);
  const nc = state.numColors ?? NUM_COLORS;
  let rng = state.rngState;
  const chains: ChainAnimData[] = [];
  const MAX_CHAIN_ITERATIONS = 20;
  let chainIndex = 1;
  let iterations = 0;
  let totalScore = state.score;
  let matches = findMatches(board);

  while (matches.length > 0) {
    iterations++;
    if (iterations > MAX_CHAIN_ITERATIONS) {
      while (true) {
        const m = findMatches(board);
        if (m.length === 0) break;
        const c = getUniquePositions(m);
        for (const p of c) board[p.row][p.col] = null;
        rng = processDamage(board, c, rng, state.mode, nc);
        applyGravity(board, passThrough);
        rng = fillEmptyCells(board, rng, nc);
      }
      break;
    }

    const clearedPositions = getUniquePositions(matches);
    const itemGens = determineItemFromMatches(matches);
    const stepScore = calculateStepScore(matches, chainIndex);
    totalScore += stepScore;

    for (const p of clearedPositions) board[p.row][p.col] = null;
    for (const ig of itemGens) {
      board[ig.pos.row][ig.pos.col] = { color: 0 as Color, item: ig.item };
    }

    const destroyed = damageObstacles(board, clearedPositions);
    if (destroyed.length > 0) {
      applyGravity(board, passThrough);
      rng = fillEmptyCells(board, rng, nc);
    }

    const dm = computeDropMoves(board, passThrough);
    applyGravity(board, passThrough);
    rng = fillEmptyCells(board, rng, nc);

    chains.push({
      matches,
      clearedPositions,
      destroyedObstacles: destroyed,
      itemGens,
      score: stepScore,
      chainIndex,
      dropMoves: dm.moves,
      newTileEntries: dm.newTileEntries,
      boardAfterDrop: cloneBoard(board),
    });

    chainIndex++;
    matches = findMatches(board);
  }

  const scopePos = findItemPosition(board, 'scope', origScopePos);
  if (!scopePos) return null;

  return {
    boardAfterSwap,
    boardAfterPreChains: cloneBoard(board),
    preChains: chains,
    preScore: totalScore,
    preRng: rng,
    scopePos,
  };
}

// ---------------------------------------------------------------------------
// computeScopeSynthesisPlan
// ---------------------------------------------------------------------------

export function computeScopeSynthesisPlan(state: GameState, pos1: Position, pos2: Position, targetCells: Position[]): ScopeSynthesisAnimPlan | null {
  const cell1 = state.board[pos1.row]?.[pos1.col];
  const cell2 = state.board[pos2.row]?.[pos2.col];
  if (!cell1?.item || !cell2?.item) return null;

  const synthesis = getSynthesisEffect(cell1.item, cell2.item);
  if (!synthesis) return null;

  const cs = createCollectorState();
  const collector = createCollector(cs);

  const finalState = processScopeSynthesis(state, pos1, pos2, targetCells, collector);

  const effectScore = finalState.score - state.score
    - cs.chains.reduce((s, c) => s + c.score, 0)
    - (cs.waveSteps.length > 0 ? cs.waveSteps.reduce((s, w) => s + w.score, 0) : 0);

  const waveAnim = buildWaveAnimPlan(cs, finalState);
  let boardAfterDrop = cs.boardAfterItemDrop ?? cloneBoard(finalState.board);

  syncFinalBoard(finalState, waveAnim, cs.chains, (b) => { boardAfterDrop = b; });

  return {
    pos1,
    pos2,
    synthEffect: synthesis.effect,
    adjacentTargets: cs.adjacentTargets,
    targetCells,
    effectTargets: [],
    effectScore,
    itemEffects: cs.itemEffects,
    boardAfterClear: cs.boardAfterClear ?? cloneBoard(state.board),
    dropMoves: cs.dropMoves,
    newTileEntries: cs.newTileEntries,
    boardAfterDrop,
    regularChains: cs.chains,
    finalState,
    waveAnim,
  };
}

// ---------------------------------------------------------------------------
// computeAutoActivationPlan
// ---------------------------------------------------------------------------

/**
 * Auto-activation is special: it processes one item at a time with
 * suppressChains=true and no moveCount increment.  We can't use
 * processAction('tap') because that has different semantics (moveCount+1,
 * chains enabled).
 *
 * We find the first non-scope item, run processAction('tap') with a
 * collector to get the item effects and drop data, then construct the
 * plan.  The finalState comes from processAction for consistency.
 */
export function computeAutoActivationPlan(state: GameState): { pos: Position; plan: ItemAnimPlan } | null {
  if (state.mode !== 'sprint') return null;

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = state.board[r][c];
      if (!cell?.item || cell.item === 'scope') continue;
      const pos = { row: r, col: c };

      // For flush, check if target color exists
      if (cell.item === 'flush') {
        const board = state.board;
        let hasTargetColor = false;
        for (let br = 0; br < BOARD_SIZE && !hasTargetColor; br++) {
          for (let bc = 0; bc < BOARD_SIZE && !hasTargetColor; bc++) {
            if (br === r && bc === c) continue;
            const tc = board[br]?.[bc];
            if (tc && !tc.item && !tc.obstacle) {
              hasTargetColor = true;
            }
          }
        }
        if (!hasTargetColor) continue;
      }

      const cs = createCollectorState();
      const collector = createCollector(cs);

      // Auto-activation happens after game over, but processAction
      // short-circuits when isGameOver=true.  Temporarily clear the flag.
      const tempState: GameState = { ...state, isGameOver: false, board: cloneBoard(state.board), rngState: [...state.rngState] };
      const finalState = processAction(tempState, { type: 'tap', pos }, collector);
      if (finalState === tempState) continue;

      const boardAfterDrop = cs.boardAfterItemDrop ?? cloneBoard(finalState.board);

      return {
        pos,
        plan: {
          boardBeforeActivation: cs.boardBeforeItemActivation ?? cloneBoard(state.board),
          effects: cs.itemEffects,
          dropMoves: cs.dropMoves,
          newTileEntries: cs.newTileEntries,
          boardAfterDrop,
          regularChains: [],
          finalState,
        },
      };
    }
  }
  return null;
}
