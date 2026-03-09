import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  initializeGame, processAction, processMagnifyingSynthesis,
  cloneBoard, findMatches, getUniquePositions, applyGravity, fillEmptyCells,
  calculateStepScore, calculateRemainingItemBonus,
  determineItemFromMatches, isGameOver as checkGameOver,
  isValidPosition, getItemTargets, findCoffeeTargetColor,
  getSynthesisEffect, getSynthesisTargets,
  getCoffeeTargets, getScissorsTargets, getCutterTargets, getClipTargets,
  type GameState, type Position, type Direction,
  type Cell, type Color, type ItemType, type Match,
  BOARD_SIZE,
} from '@tomado/engine';

// --- Animation plan types ---

export interface ChainAnimData {
  matches: Match[];
  clearedPositions: Position[];
  itemGen: { pos: Position; item: ItemType } | null;
  score: number;
  chainIndex: number;
  dropMoves: { col: number; fromRow: number; toRow: number }[];
  newTilesPerCol: Map<number, number>;
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
}

export interface ItemAnimPlan {
  boardBeforeActivation: (Cell | null)[][];
  effects: ItemEffectStep[];
  dropMoves: { col: number; fromRow: number; toRow: number }[];
  newTilesPerCol: Map<number, number>;
  boardAfterDrop: (Cell | null)[][];
  regularChains: ChainAnimData[];
  finalState: GameState;
}

export interface SynthesisEffectStep {
  effectType: string; // e.g. 'line+line', 'scissors+clip', etc.
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
  newTilesPerCol: Map<number, number>;
  boardAfterDrop: (Cell | null)[][];
  regularChains: ChainAnimData[];
  finalState: GameState;
}

export interface MagGlassAnimPlan {
  magPos: Position;
  targetCells: Position[];
  boardAfterClear: (Cell | null)[][];
  itemEffects: ItemEffectStep[];
  dropMoves: { col: number; fromRow: number; toRow: number }[];
  newTilesPerCol: Map<number, number>;
  boardAfterDrop: (Cell | null)[][];
  regularChains: ChainAnimData[];
  finalState: GameState;
}

export interface MagSynthesisAnimPlan {
  pos1: Position;
  pos2: Position;
  synthEffect: string;
  /** The effect position (user-selected cell for mag+scissors/cutter/clip, or multiple for mag+mag) */
  targetCells: Position[];
  /** Targets cleared by the synthesis effect */
  effectTargets: Position[];
  itemEffects: ItemEffectStep[];
  boardAfterClear: (Cell | null)[][];
  dropMoves: { col: number; fromRow: number; toRow: number }[];
  newTilesPerCol: Map<number, number>;
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

function computeDropMoves(board: (Cell | null)[][]) {
  const moves: { col: number; fromRow: number; toRow: number }[] = [];
  const newTilesPerCol = new Map<number, number>();
  for (let col = 0; col < BOARD_SIZE; col++) {
    let writeRow = BOARD_SIZE - 1;
    let nullCount = 0;
    for (let readRow = BOARD_SIZE - 1; readRow >= 0; readRow--) {
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
      newTilesPerCol.set(col, nullCount);
    }
  }
  return { moves, newTilesPerCol };
}

function computeItemEffects(
  board: (Cell | null)[][],
  startPos: Position,
  startItem: ItemType,
  targetColor?: number,
): ItemEffectStep[] {
  const effects: ItemEffectStep[] = [];
  const activated = new Set<string>();
  const queue: { pos: Position; item: ItemType; targetColor?: number }[] = [
    { pos: startPos, item: startItem, targetColor },
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
      if (c.item) {
        const tKey = `${t.row},${t.col}`;
        if (!activated.has(tKey)) {
          detonations.push({ pos: t, item: c.item });
          queue.push({ pos: t, item: c.item });
        }
      } else {
        board[t.row][t.col] = null;
        cleared.push(t);
      }
    }

    effects.push({ itemType: cur.item, itemPos: cur.pos, targets: cleared, detonations });
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
  gameMode: 'limited',
  gameMoveLimit?: number,
): ItemAnimPlan {
  const boardBefore = cloneBoard(board);
  const effects = computeItemEffects(board, itemPos, itemType, targetColor);

  let scoreFromItems = 0;
  for (const e of effects) scoreFromItems += 10 * e.targets.length;

  const { moves: dropMoves, newTilesPerCol } = computeDropMoves(board);
  applyGravity(board);
  let rng = fillEmptyCells(board, rngState);
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

    const { moves: dm, newTilesPerCol: nt } = computeDropMoves(board);
    applyGravity(board);
    rng = fillEmptyCells(board, rng);

    regularChains.push({
      matches, clearedPositions, itemGen,
      score: stepScore, chainIndex,
      dropMoves: dm, newTilesPerCol: nt,
      boardAfterDrop: cloneBoard(board),
    });
    chainIndex++;
    matches = findMatches(board);
  }

  return {
    boardBeforeActivation: boardBefore,
    effects,
    dropMoves, newTilesPerCol, boardAfterDrop,
    regularChains,
    finalState: (() => {
      const newMoveCount = moveCount + 1;
      const gameOver = checkGameOver(board, gameMode, newMoveCount, gameMoveLimit);
      let finalScore = totalScore;
      if (gameOver) finalScore += calculateRemainingItemBonus(board);
      return {
        board: cloneBoard(board),
        score: finalScore,
        rngState: rng,
        moveCount: newMoveCount,

        isGameOver: gameOver,
        mode: gameMode,
        moveLimit: gameMoveLimit,
      };
    })(),
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

    const { moves: dm, newTilesPerCol: nt } = computeDropMoves(board);
    applyGravity(board);
    rng = fillEmptyCells(board, rng);

    chains.push({
      matches, clearedPositions, itemGen,
      score: stepScore, chainIndex,
      dropMoves: dm, newTilesPerCol: nt,
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

  const board = computed(() => gameState.value?.board ?? null);
  const score = computed(() => gameState.value?.score ?? 0);
  const moveCount = computed(() => gameState.value?.moveCount ?? 0);
  const isGameOver = computed(() => gameState.value?.isGameOver ?? false);
  const mode = computed(() => gameState.value?.mode ?? 'limited');
  const moveLimit = computed(() => gameState.value?.moveLimit);
  const remainingMoves = computed(() => {
    if (!gameState.value || gameState.value.mode !== 'limited' || !gameState.value.moveLimit) return undefined;
    return gameState.value.moveLimit - gameState.value.moveCount;
  });

  function startGame(newSeed?: number) {
    seed.value = newSeed ?? Math.floor(Math.random() * 0x7FFFFFFF);
    gameState.value = initializeGame(seed.value);
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

  function activateMagnifyingGlass(pos: Position, targetCells: Position[]) {
    if (!gameState.value) return;
    const newState = processAction(gameState.value, {
      type: 'magnifying_glass', pos, targetCells,
    });
    if (newState !== gameState.value) gameState.value = newState;
  }

  function applyMagnifyingSynthesis(pos1: Position, pos2: Position, targetCells: Position[]) {
    if (!gameState.value) return;
    const newState = processMagnifyingSynthesis(gameState.value, pos1, pos2, targetCells);
    if (newState !== gameState.value) gameState.value = newState;
  }

  function computeMagGlassPlan(magPos: Position, targetCells: Position[]): MagGlassAnimPlan | null {
    if (!gameState.value) return null;
    const state = gameState.value;
    const cell = state.board[magPos.row]?.[magPos.col];
    if (!cell?.item || cell.item !== 'magnifying_glass') return null;

    const board = cloneBoard(state.board);
    // Remove the magnifying glass itself
    board[magPos.row][magPos.col] = null;

    let totalScore = state.score;
    let rng = state.rngState;
    const itemEffects: ItemEffectStep[] = [];

    // Process each target cell
    for (const target of targetCells) {
      const tc = board[target.row]?.[target.col];
      if (!tc) continue;
      if (tc.item) {
        // Item detonation: use computeItemEffects
        const effects = computeItemEffects(board, target, tc.item);
        for (const e of effects) {
          totalScore += 10 * e.targets.length;
          itemEffects.push(e);
        }
      } else {
        board[target.row][target.col] = null;
        totalScore += 10;
      }
    }

    const boardAfterClear = cloneBoard(board);

    const { moves: dropMoves, newTilesPerCol } = computeDropMoves(board);
    applyGravity(board);
    rng = fillEmptyCells(board, rng);
    const boardAfterDrop = cloneBoard(board);

    const { chains: regularChains, rng: finalRng, totalScore: finalScore } =
      computeChainSteps(board, rng, totalScore, 2);

    const newMoveCount = state.moveCount + 1;
    const gameOver = checkGameOver(board, state.mode, newMoveCount, state.moveLimit);
    let score = finalScore;
    if (gameOver && state.mode === 'limited') score += calculateRemainingItemBonus(board);

    return {
      magPos,
      targetCells,
      boardAfterClear,
      itemEffects,
      dropMoves, newTilesPerCol, boardAfterDrop,
      regularChains,
      finalState: {
        board: cloneBoard(board),
        score,
        rngState: finalRng,
        moveCount: newMoveCount,

        isGameOver: gameOver,
        mode: state.mode,
        moveLimit: state.moveLimit,
      },
    };
  }

  function computeMagSynthesisPlan(
    pos1: Position, pos2: Position, targetCells: Position[],
  ): MagSynthesisAnimPlan | null {
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

    if (effect === 'mag+mag') {
      // Clear 3 user-selected cells
      for (const target of targetCells) {
        const tc = board[target.row]?.[target.col];
        if (!tc) continue;
        if (tc.item) {
          const effects = computeItemEffects(board, target, tc.item);
          for (const e of effects) {
            totalScore += 10 * e.targets.length;
            itemEffects.push(e);
          }
        } else {
          board[target.row][target.col] = null;
          effectTargets.push(target);
          totalScore += 10;
        }
      }
    } else {
      // mag+scissors/cutter/clip: get synthesis targets from user-selected cell
      const synthTargets = getSynthesisTargets(board, pos2, effect, undefined, targetCells);
      const activated = new Set<string>();
      activated.add(`${pos1.row},${pos1.col}`);
      activated.add(`${pos2.row},${pos2.col}`);

      for (const t of synthTargets) {
        const c = board[t.row]?.[t.col];
        if (c === null) continue;
        if (c.item) {
          const tKey = `${t.row},${t.col}`;
          if (!activated.has(tKey)) {
            activated.add(tKey);
            const effects = computeItemEffects(board, t, c.item);
            for (const e of effects) {
              totalScore += 10 * e.targets.length;
              itemEffects.push(e);
            }
          }
        } else {
          board[t.row][t.col] = null;
          effectTargets.push(t);
          totalScore += 10;
        }
      }
    }

    const boardAfterClear = cloneBoard(board);

    const { moves: dropMoves, newTilesPerCol } = computeDropMoves(board);
    applyGravity(board);
    rng = fillEmptyCells(board, rng);
    const boardAfterDrop = cloneBoard(board);

    const { chains: regularChains, rng: finalRng, totalScore: finalScore } =
      computeChainSteps(board, rng, totalScore, 2);

    const newMoveCount = state.moveCount + 1;
    const gameOver = checkGameOver(board, state.mode, newMoveCount, state.moveLimit);
    let score = finalScore;
    if (gameOver && state.mode === 'limited') score += calculateRemainingItemBonus(board);

    return {
      pos1, pos2, synthEffect: effect, targetCells, effectTargets,
      itemEffects, boardAfterClear,
      dropMoves, newTilesPerCol, boardAfterDrop,
      regularChains,
      finalState: {
        board: cloneBoard(board),
        score,
        rngState: finalRng,
        moveCount: newMoveCount,

        isGameOver: gameOver,
        mode: state.mode,
        moveLimit: state.moveLimit,
      },
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

      const { moves: dropMoves, newTilesPerCol } = computeDropMoves(board);
      applyGravity(board);
      rng = fillEmptyCells(board, rng);

      chains.push({
        matches, clearedPositions, itemGen,
        score: stepScore, chainIndex,
        dropMoves, newTilesPerCol, boardAfterDrop: cloneBoard(board),
      });
      chainIndex++;
      matches = findMatches(board);
    }

    const newMoveCount = state.moveCount + 1;
    const gameOver = checkGameOver(board, state.mode, newMoveCount, state.moveLimit);
    let finalScore = totalScore;
    if (gameOver && state.mode === 'limited') finalScore += calculateRemainingItemBonus(board);

    return {
      boardAfterSwap, chains,
      finalState: {
        board: cloneBoard(board), score: finalScore, rngState: rng,
        moveCount: newMoveCount,
        isGameOver: gameOver, mode: state.mode, moveLimit: state.moveLimit,
      },
    };
  }

  function computeItemTapPlan(pos: Position): ItemAnimPlan | null {
    if (!gameState.value) return null;
    const state = gameState.value;
    const cell = state.board[pos.row]?.[pos.col];
    if (!cell?.item) return null;

    const board = cloneBoard(state.board);
    let targetColor: number | undefined;
    if (cell.item === 'coffee') {
      targetColor = findCoffeeTargetColor(board, pos) ?? undefined;
      if (targetColor === undefined) return null;
    }

    return buildItemPlan(
      board, state.rngState, state.score, state.moveCount,
      pos, cell.item, targetColor,
      'limited', state.moveLimit,
    );
  }

  function computeItemSwapPlan(pos: Position, dir: Direction): { boardAfterSwap: (Cell | null)[][]; plan: ItemAnimPlan } | null {
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
    const newItemPos = cell1.item ? target : pos;

    let targetColor: number | undefined;
    if (itemCell.item === 'coffee') targetColor = otherCell.color;

    const plan = buildItemPlan(
      board, state.rngState, state.score, state.moveCount,
      newItemPos, itemCell.item!, targetColor,
      'limited', state.moveLimit,
    );
    return { boardAfterSwap, plan };
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

    if (effect === 'coffee+coffee') {
      // Full clear: items remain, all regular tiles cleared
      board[pos.row][pos.col] = null;
      board[target.row][target.col] = null;
      const targets: Position[] = [];
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const cell = board[r][c];
          if (cell && !cell.item) {
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
    } else if (effect.startsWith('coffee+')) {
      const otherItem = effect.replace('coffee+', '') as ItemType;
      const coffeePos = cell1.item === 'coffee' ? pos : target;
      // Use findCoffeeTargetColor to find adjacent color (same as engine)
      const targetColor = findCoffeeTargetColor(board, coffeePos) ?? undefined;

      board[pos.row][pos.col] = null;
      board[target.row][target.col] = null;

      // Get color targets and clear them
      const colorTargets = targetColor != null ? getCoffeeTargets(board, targetColor) : [];
      const allTargets: Position[] = [...colorTargets];
      for (const ct of colorTargets) board[ct.row][ct.col] = null;
      totalScore += 10 * colorTargets.length;

      // Each color target position fires the other item's effect
      const detonations: { pos: Position; item: ItemType }[] = [];
      for (const ct of colorTargets) {
        let subTargets: Position[];
        switch (otherItem) {
          case 'scissors': subTargets = getScissorsTargets(ct); break;
          case 'cutter': subTargets = getCutterTargets(ct); break;
          case 'clip': subTargets = getClipTargets(ct, 2); break;
          default: subTargets = [];
        }
        for (const t of subTargets) {
          const c = board[t.row]?.[t.col];
          if (c === null) continue;
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
        totalScore += 10 * subTargets.filter(t => board[t.row]?.[t.col] === null).length;
      }

      effects.push({
        effectType: effect, item1: cell1.item, item2: cell2.item,
        pos1: target, pos2: pos, targets: allTargets, detonations,
      });
    } else if (effect === 'mag+coffee') {
      // mag+coffee: coffee color clear (same as coffee activation)
      const coffeePos = cell1.item === 'coffee' ? pos : target;
      const targetColor = findCoffeeTargetColor(board, coffeePos) ?? undefined;

      board[pos.row][pos.col] = null;
      board[target.row][target.col] = null;

      const colorTargets = targetColor != null ? getCoffeeTargets(board, targetColor) : [];
      const cleared: Position[] = [];
      const detonations: { pos: Position; item: ItemType }[] = [];
      for (const t of colorTargets) {
        const c = board[t.row]?.[t.col];
        if (c === null) continue;
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
      totalScore += 10 * cleared.length;

      effects.push({
        effectType: effect, item1: cell1.item, item2: cell2.item,
        pos1: target, pos2: pos, targets: cleared, detonations,
      });
    } else {
      // Non-coffee synthesis
      board[pos.row][pos.col] = null;
      board[target.row][target.col] = null;

      const targets = getSynthesisTargets(board, synthPos, effect);
      const cleared: Position[] = [];
      const detonations: { pos: Position; item: ItemType }[] = [];

      for (const t of targets) {
        const c = board[t.row]?.[t.col];
        if (c === null) continue;
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
      totalScore += 10 * cleared.length;

      effects.push({
        effectType: effect, item1: cell1.item, item2: cell2.item,
        pos1: target, pos2: pos, targets: cleared, detonations,
      });
    }

    // Handle detonations with computeItemEffects
    for (const effect of effects) {
      for (const det of effect.detonations) {
        const detEffects = computeItemEffects(board, det.pos, det.item);
        for (const e of detEffects) {
          totalScore += 10 * e.targets.length;
        }
      }
    }

    const { moves: dropMoves, newTilesPerCol } = computeDropMoves(board);
    applyGravity(board);
    rng = fillEmptyCells(board, rng);
    const boardAfterDrop = cloneBoard(board);

    const { chains: regularChains, rng: finalRng, totalScore: finalScore } =
      computeChainSteps(board, rng, totalScore, 2);

    return {
      boardAfterSwap,
      boardBeforeActivation: boardBefore,
      effects,
      dropMoves, newTilesPerCol, boardAfterDrop,
      regularChains,
      finalState: (() => {
        const newMoveCount = state.moveCount + 1;
        const gameOver = checkGameOver(board, state.mode, newMoveCount, state.moveLimit);
        let score = finalScore;
        if (gameOver && state.mode === 'limited') score += calculateRemainingItemBonus(board);
        return {
          board: cloneBoard(board),
          score,
          rngState: finalRng,
          moveCount: newMoveCount,
  
          isGameOver: gameOver,
          mode: state.mode,
          moveLimit: state.moveLimit,
        };
      })(),
    };
  }

  function applyState(state: GameState) {
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
    board, score, moveCount, isGameOver,
    mode, moveLimit, remainingMoves,
    startGame, swap, tap,
    activateMagnifyingGlass, applyMagnifyingSynthesis,
    computeMagGlassPlan, computeMagSynthesisPlan,
    computeSwapPlan, computeItemTapPlan, computeItemSwapPlan, computeSynthesisPlan,
    applyState, placeItem,
  };
});
