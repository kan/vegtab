import {
  BOARD_SIZE, createColumnRngStates, createRng, findItemPosition, initializeGame,
  type Cell, type Color, type GameState, type ItemType, type Position,
} from '@vegtab/engine';
import { adj, type BoardHint, type BoardInput } from '@/lib/boardInput';

/**
 * The tutorial's lessons (#108): each is a small board played on the real engine and the real
 * PuzzleBoard. A lesson's tasks run in order; the board lets through only the task's inputs, and
 * the next task starts when that move settles. The free lesson takes any input and ends when the
 * board is cleared. lessons.test.ts plays every lesson through the engine with the tasks' inputs
 */

export interface LessonTask {
  bodyKey: string;
  /** What to show the player, on the board as it stands (items fall, so their cells are looked up) */
  hints: (state: GameState) => BoardHint[];
  accepts: (input: BoardInput, state: GameState) => boolean;
}

export interface Lesson {
  id: string;
  titleKey: string;
  start: () => GameState;
  /** Empty for the free lesson */
  tasks: LessonTask[];
  /** i18n keys of a list shown under the lesson's result */
  doneList?: string[];
}

// --- Boards ---

/** A board with no match and no 2×2: colour (2 × row + col) mod 5 */
function background(r: number, c: number): Cell {
  return { color: ((r * 2 + c) % 5) as Color };
}

type Override = [row: number, col: number, cell: Cell];

const v = (color: number): Cell => ({ color: color as Color });
const item = (it: ItemType): Cell => ({ color: 0, item: it });
const obstacle = (durability: number): Cell => ({ color: 0, obstacle: { durability } });

/** Refills follow a fixed seed, so a lesson plays the same every time */
const LESSON_RNG_SEED = 20261022;

function lessonState(overrides: Override[]): GameState {
  const board: (Cell | null)[][] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    board.push([]);
    for (let c = 0; c < BOARD_SIZE; c++) board[r].push(background(r, c));
  }
  for (const [r, c, cell] of overrides) board[r][c] = cell;
  return {
    board,
    score: 0,
    rngState: createColumnRngStates(createRng(LESSON_RNG_SEED)),
    moveCount: 0,
    isGameOver: false,
    maxChainIndex: 0,
  };
}

// --- Inputs ---

const p = (row: number, col: number): Position => ({ row, col });
const same = (a: Position, b: Position) => a.row === b.row && a.col === b.col;

/** The swap of a and b, dragged from either of them */
function isSwapOf(input: BoardInput, a: Position, b: Position): boolean {
  if (input.type !== 'swap') return false;
  const to = adj(input.pos, input.dir);
  return (same(input.pos, a) && same(to, b)) || (same(input.pos, b) && same(to, a));
}

/** Where the item is now (items fall, so they are looked up on the board as it stands) */
const findItem = (state: GameState, it: ItemType) => findItemPosition(state.board, it, p(0, 0));

/** A task: swap a and b */
function swapTask(bodyKey: string, a: Position, b: Position): LessonTask {
  return {
    bodyKey,
    hints: () => [{ type: 'swap', from: a, to: b }],
    accepts: input => isSwapOf(input, a, b),
  };
}

/**
 * A task on the item, wherever it fell to: tap it, tap it and then pick the target (a spoon), or
 * swap it with the target
 */
function itemTask(bodyKey: string, it: ItemType, then?: { target: Position; by: 'select' | 'swap' }): LessonTask {
  return {
    bodyKey,
    hints: s => {
      const at = findItem(s, it);
      if (!at) return [];
      if (then?.by === 'swap') return [{ type: 'swap', from: at, to: then.target }];
      const tap: BoardHint[] = [{ type: 'tap', at }];
      return then ? [...tap, { type: 'tap', at: then.target, whileSelecting: true }] : tap;
    },
    accepts: (input, s) => {
      const at = findItem(s, it);
      if (!at) return false;
      if (then?.by === 'swap') return isSwapOf(input, at, then.target);
      if (input.type === 'tap') return same(input.pos, at);
      return then?.by === 'select' && input.type === 'select' && same(input.pos, then.target);
    },
  };
}

// --- Lessons ---

/** The free lesson's board: few obstacles, and clearable (lessons.test.ts plays it out) */
export const FREE_LESSON_SEED = 1;
export const FREE_LESSON_OBSTACLES = 4;

/** Row 3 has two tomatoes; the one below (4,5) slides up beside them. Lessons 1 and 2 share it */
const TOMATO_ROW: Override[] = [[3, 2, v(0)], [3, 3, v(3)], [3, 4, v(3)], [4, 5, v(3)]];
const TOMATO_SWAP = [p(4, 5), p(3, 5)] as const;

export const LESSONS: Lesson[] = [
  {
    id: 'match',
    titleKey: 'tutorial.match.title',
    start: () => lessonState(TOMATO_ROW),
    tasks: [swapTask('tutorial.match.body', ...TOMATO_SWAP)],
  },
  {
    // The same match, now under two obstacles: the one with 1 breaks, the one with 2 goes to 1
    id: 'obstacle',
    titleKey: 'tutorial.obstacle.title',
    start: () => lessonState([...TOMATO_ROW, [2, 3, obstacle(2)], [2, 4, obstacle(1)]]),
    tasks: [swapTask('tutorial.obstacle.body', ...TOMATO_SWAP)],
  },
  {
    // A 2×2 of onions makes a spoon; the spoon then picks the obstacle in the corner
    id: 'spoon',
    titleKey: 'tutorial.spoon.title',
    start: () => lessonState([
      [2, 4, v(0)], [3, 3, v(0)], [3, 4, v(2)], [4, 2, v(3)], [4, 3, v(0)], [4, 4, v(0)],
      [0, 7, obstacle(1)],
    ]),
    tasks: [
      swapTask('tutorial.spoon.make', p(2, 4), p(3, 4)),
      itemTask('tutorial.spoon.use', 'scope', { target: p(0, 7), by: 'select' }),
    ],
  },
  {
    // Four tomatoes in row 3 make scissors, which clear their column down to the obstacle
    id: 'scissors',
    titleKey: 'tutorial.scissors.title',
    start: () => lessonState([
      [3, 2, v(3)], [3, 3, v(3)], [3, 5, v(3)], [2, 4, v(3)],
      [6, 4, obstacle(1)],
    ]),
    tasks: [
      swapTask('tutorial.scissors.make', p(2, 4), p(3, 4)),
      itemTask('tutorial.scissors.use', 'v_cut'),
    ],
  },
  {
    // An L of five cucumbers makes a dish set, which clears the 5×5 around it
    id: 'dishes',
    titleKey: 'tutorial.dishes.title',
    start: () => lessonState([
      [2, 3, v(1)], [4, 3, v(1)], [3, 4, v(1)], [3, 5, v(1)], [3, 2, v(1)],
      [5, 4, obstacle(1)],
    ]),
    tasks: [
      swapTask('tutorial.dishes.make', p(3, 2), p(3, 3)),
      itemTask('tutorial.dishes.use', 'burst'),
    ],
  },
  {
    // Five eggplants in a row make a salad bowl; swapped with an obstacle, it wears down them all.
    // The obstacle above the bowl takes a hit from the match too, so it starts at 2
    id: 'salad',
    titleKey: 'tutorial.salad.title',
    start: () => lessonState([
      [3, 1, v(2)], [3, 2, v(2)], [3, 3, v(4)], [3, 4, v(2)], [3, 5, v(2)], [3, 6, v(3)], [4, 3, v(2)],
      [2, 3, obstacle(2)], [0, 0, obstacle(1)], [6, 0, obstacle(1)], [6, 7, obstacle(1)],
    ]),
    tasks: [
      swapTask('tutorial.salad.make', p(4, 3), p(3, 3)),
      itemTask('tutorial.salad.use', 'flush', { target: p(2, 3), by: 'swap' }),
    ],
  },
  {
    // Two scissors swapped together clear their row and column at once
    id: 'combo',
    titleKey: 'tutorial.combo.title',
    start: () => lessonState([
      [3, 3, item('v_cut')], [3, 4, item('h_cut')],
      [3, 0, obstacle(1)], [3, 7, obstacle(1)],
    ]),
    tasks: [swapTask('tutorial.combo.body', p(3, 3), p(3, 4))],
    doneList: ['lineDishes', 'dishesDishes', 'spoonSpoon', 'spoonOther', 'saladOther', 'saladSalad']
      .map(k => `tutorial.combo.list.${k}`),
  },
  {
    id: 'free',
    titleKey: 'tutorial.free.title',
    start: () => initializeGame(FREE_LESSON_SEED, { obstacleCount: FREE_LESSON_OBSTACLES }),
    tasks: [],
  },
];
