import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  initializeGame, processAction, undoAction, cloneGameState,
  cloneBoard, findMatches, getUniquePositions, applyGravity, fillEmptyCells,
  calculateStepScore, determineItemFromMatches, isGameOver as checkGameOver,
  isValidPosition, getItemTargets, findCoffeeTargetColor,
  getSynthesisEffect, getSynthesisTargets,
  getCoffeeTargets, getScissorsTargets, getCutterTargets, getClipTargets,
  type GameState, type Action, type Position, type Direction,
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
  undoUsed: boolean,
  itemPos: Position,
  itemType: ItemType,
  targetColor: number | undefined,
  prevState: GameState,
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
    finalState: {
      board: cloneBoard(board),
      score: totalScore,
      rngState: rng,
      moveCount: moveCount + 1,
      undoUsed,
      isGameOver: checkGameOver(board),
      previousState: prevState,
    },
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
  const canUndo = computed(() =>
    gameState.value !== null &&
    !gameState.value.undoUsed &&
    gameState.value.previousState !== undefined
  );

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

  function undo() {
    if (!gameState.value) return;
    const result = undoAction(gameState.value);
    if (result) gameState.value = result;
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

    return {
      boardAfterSwap, chains,
      finalState: {
        board: cloneBoard(board), score: totalScore, rngState: rng,
        moveCount: state.moveCount + 1, undoUsed: state.undoUsed,
        isGameOver: checkGameOver(board), previousState: cloneGameState(state),
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
      state.undoUsed, pos, cell.item, targetColor, cloneGameState(state),
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
    if (cell1.item && cell2.item) return null; // synthesis → instant
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
      state.undoUsed, newItemPos, itemCell.item!, targetColor, cloneGameState(state),
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
      finalState: {
        board: cloneBoard(board),
        score: finalScore,
        rngState: finalRng,
        moveCount: state.moveCount + 1,
        undoUsed: state.undoUsed,
        isGameOver: checkGameOver(board),
        previousState: cloneGameState(state),
      },
    };
  }

  function applyState(state: GameState) {
    gameState.value = state;
  }

  function placeItem(pos: Position, item: ItemType) {
    if (!gameState.value) return;
    const cell = gameState.value.board[pos.row]?.[pos.col];
    if (!cell) return;
    gameState.value.board[pos.row][pos.col] = { color: 0 as Color, item };
  }

  return {
    gameState, seed,
    board, score, moveCount, isGameOver, canUndo,
    startGame, swap, tap, undo,
    computeSwapPlan, computeItemTapPlan, computeItemSwapPlan, computeSynthesisPlan,
    applyState, placeItem,
  };
});
