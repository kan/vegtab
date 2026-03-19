import type { Color, Cell, Position, Direction, ItemType } from '@tomado/engine';
import { BOARD_SIZE } from '@tomado/engine';

// --- Types ---

export type TutorialStepType = 'info' | 'demo' | 'guided';

export interface MatchPhase {
  matched: Position[];
  boardAfter: (Cell | null)[][];
}

export interface TutorialStep {
  id: string;
  type: TutorialStepType;
  titleKey: string;
  bodyKey: string;
  board?: (Cell | null)[][];
  focusArea?: { startRow: number; startCol: number; rows: number; cols: number };
  highlight?: Position[];
  highlightDir?: Direction;
  demoAction?: { type: 'swap'; pos: Position; dir: Direction } | { type: 'tap'; pos: Position };
  expectedAction?: { type: 'swap'; pos: Position; dir: Direction } | { type: 'tap'; pos: Position };
  matchedCells?: Position[];
  boardAfterAction?: (Cell | null)[][];
  matchPhases?: MatchPhase[];
  image?: string;
}

export interface TutorialSection {
  id: string;
  titleKey: string;
  steps: TutorialStep[];
}

// --- Helpers ---

function C(color: Color): Cell { return { color }; }
function CI(color: Color, item: ItemType): Cell { return { color, item }; }

/** Safe background: no 3-in-a-row or 2×2 matches */
function safeBg(r: number, c: number): Cell {
  return C(([0, 1, 2, 3, 4] as Color[])[(r * 2 + c) % 5]);
}

function makeBoard(overrides: [number, number, Cell | null][]): (Cell | null)[][] {
  const board: (Cell | null)[][] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    board[r] = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      board[r][c] = safeBg(r, c);
    }
  }
  for (const [r, c, cell] of overrides) {
    board[r][c] = cell;
  }
  return board;
}

function setCells(board: (Cell | null)[][], entries: [number, number, Cell | null][]): (Cell | null)[][] {
  const b = board.map(row => [...row]);
  for (const [r, c, cell] of entries) {
    b[r][c] = cell;
  }
  return b;
}

function range8(): number[] { return [0, 1, 2, 3, 4, 5, 6, 7]; }

// --- Step 1: Basic 3-Match [guided] ---
// Row 3 safeBg: 1,2,3,4,0,1,2,3. Override (3,2)=0 to break accidental match.
// (3,3)=3(tomato), (3,4)=3. (3,5)=1(safeBg), (4,5)=3(safeBg).
// Swap (4,5) up → row3 = ...,3,3,3,... → horizontal 3-match.

const step1_board = makeBoard([
  [3, 2, C(0)],  // break safeBg=3 to avoid 4-in-a-row
  [3, 3, C(3)],  // tomato
  [3, 4, C(3)],  // tomato
]);
const step1_matched: Position[] = [
  { row: 3, col: 3 }, { row: 3, col: 4 }, { row: 3, col: 5 },
];
const step1_after = setCells(step1_board, [
  [3, 3, null], [3, 4, null], [3, 5, null],
  [4, 5, C(1)],  // swapped tile (was safeBg=3, now safeBg(3,5)=1)
]);

// --- Step 2: Chain [demo] ---
// Swap (4,4) left → col3 rows 2,3,4 = 1,1,1 → vertical match.
// After gravity: (0,3)=2 drops to (3,3). Row 3 = 2,2,2 → horizontal chain.

const step2_board = makeBoard([
  [0, 3, C(2)], [1, 3, C(0)],
  [2, 2, C(2)], [2, 3, C(1)], [2, 4, C(2)],
  [3, 2, C(2)], [3, 3, C(1)], [3, 4, C(2)],
  [4, 3, C(0)], [4, 4, C(1)],
]);
const step2_phase1_matched: Position[] = [
  { row: 2, col: 3 }, { row: 3, col: 3 }, { row: 4, col: 3 },
];
// After phase 1: gravity in col 3
const step2_phase1_after = setCells(step2_board, [
  [0, 3, null], [1, 3, null], [2, 3, null],
  [3, 3, C(2)],  // dropped from (0,3)
  [4, 3, C(0)],  // dropped from (1,3)
  [4, 4, C(0)],  // from swap
]);
const step2_phase2_matched: Position[] = [
  { row: 3, col: 2 }, { row: 3, col: 3 }, { row: 3, col: 4 },
];
const step2_phase2_after = setCells(step2_phase1_after, [
  [3, 2, null], [3, 3, null], [3, 4, null],
]);

// --- Step 3: 2×2 Match → Spoon [guided] ---
// Swap (2,4) down → 2×2 of color 0 at (3,3)(3,4)(4,3)(4,4).

const step3_board = makeBoard([
  [2, 4, C(0)],
  [3, 3, C(0)], [3, 4, C(2)],  // (3,4) will be swapped out
  [4, 2, C(3)],  // break safeBg=0
  [4, 3, C(0)], [4, 4, C(0)],
]);
const step3_matched: Position[] = [
  { row: 3, col: 3 }, { row: 3, col: 4 },
  { row: 4, col: 3 }, { row: 4, col: 4 },
];
const step3_after = setCells(step3_board, [
  [2, 4, C(2)],  // swapped from (3,4)
  [3, 3, null],
  [3, 4, CI(0, 'scope')],  // spoon generated
  [4, 3, null], [4, 4, null],
]);

// --- Step 4: Spoon Usage [demo] ---
// Scope at (3,4). Tap → clears surrounding 4 + select 1 cell.

const step4_board = makeBoard([
  [3, 4, CI(0, 'scope')],
]);
const step4_matched: Position[] = [
  { row: 2, col: 4 }, { row: 4, col: 4 },
  { row: 3, col: 3 }, { row: 3, col: 5 },
  { row: 2, col: 3 },  // auto-selected target
];
const step4_after = setCells(step4_board, [
  [3, 4, null],
  [2, 4, null], [4, 4, null], [3, 3, null], [3, 5, null],
  [2, 3, null],
]);

// --- Step 5: Scissors [guided] ---
// 4-match horizontal → v_cut. Swap (2,5) down → row3 cols 2-5 = 3,3,3,3.

const step5_board = makeBoard([
  [3, 3, C(3)], [3, 4, C(3)],  // safeBg(3,2)=3 already
  [2, 5, C(3)],  // swap this down
]);
const step5_matched: Position[] = [
  { row: 3, col: 2 }, { row: 3, col: 3 },
  { row: 3, col: 4 }, { row: 3, col: 5 },
];
const step5_after = setCells(step5_board, [
  [2, 5, C(1)],  // swapped from (3,5)
  [3, 2, null], [3, 3, null],
  [3, 4, CI(3, 'v_cut')],  // scissors (vertical) generated
  [3, 5, null],
]);

// --- Step 6: Dish Set [guided] ---
// L-shape 5-match → burst. Swap (3,2) right → vertical (2,3)(3,3)(4,3) + horizontal (3,3)(3,4)(3,5).

const step6_board = makeBoard([
  [2, 3, C(1)],
  [3, 2, C(1)], [3, 3, C(2)],  // (3,3) will receive C(1) from swap
  [3, 4, C(1)],  // safeBg(3,5)=1 already
]);
const step6_matched: Position[] = [
  { row: 2, col: 3 }, { row: 3, col: 3 }, { row: 4, col: 3 },
  { row: 3, col: 4 }, { row: 3, col: 5 },
];
const step6_after = setCells(step6_board, [
  [3, 2, C(2)],  // swapped from (3,3)
  [2, 3, null],
  [3, 3, CI(1, 'burst')],  // fork generated
  [4, 3, null], [3, 4, null], [3, 5, null],
]);

// --- Step 7: Salad Bowl [guided] ---
// 5-match straight → flush. Swap (4,3) up fills gap → row3 cols 1-5 = 2,2,2,2,2.

const step7_board = makeBoard([
  [3, 1, C(2)], [3, 2, C(2)], [3, 3, C(4)],  // gap at (3,3)
  [3, 4, C(2)], [3, 5, C(2)],
  [3, 6, C(3)],  // break safeBg=2
  [4, 3, C(2)],  // swap this up
]);
const step7_matched: Position[] = [
  { row: 3, col: 1 }, { row: 3, col: 2 }, { row: 3, col: 3 },
  { row: 3, col: 4 }, { row: 3, col: 5 },
];
const step7_after = setCells(step7_board, [
  [4, 3, C(4)],  // swapped from (3,3)
  [3, 1, null], [3, 2, null],
  [3, 3, CI(2, 'flush')],  // salad bowl generated
  [3, 4, null], [3, 5, null],
]);

// --- Step 8: Spoon × Scissors [guided] ---
const step8_board = makeBoard([
  [3, 3, CI(0, 'scope')],
  [3, 4, CI(0, 'h_cut')],
]);
const step8_matched: Position[] = [
  { row: 2, col: 3 }, { row: 4, col: 3 }, { row: 3, col: 2 },  // scope surrounding
  ...range8().map(c => ({ row: 3, col: c })),  // h_cut row
];
const step8_after = setCells(step8_board, [
  [2, 3, null], [4, 3, null], [3, 2, null],
  ...range8().map(c => [3, c, null] as [number, number, null]),
]);

// --- Step 9: Scissors × Scissors [guided] ---
const step9_board = makeBoard([
  [3, 3, CI(0, 'v_cut')],
  [3, 4, CI(0, 'h_cut')],
]);
const step9_matched: Position[] = [
  ...range8().map(c => ({ row: 3, col: c })),  // row
  ...range8().filter(r => r !== 3).map(r => ({ row: r, col: 3 })),  // col
];
const step9_after = setCells(step9_board, [
  ...range8().map(c => [3, c, null] as [number, number, null]),
  ...range8().filter(r => r !== 3).map(r => [r, 3, null] as [number, number, null]),
]);

// --- Step 10: Spoon × Spoon [demo] ---
const step10_board = makeBoard([
  [3, 3, CI(0, 'scope')],
  [3, 4, CI(0, 'scope')],
]);
const step10_matched: Position[] = [
  { row: 2, col: 3 }, { row: 4, col: 3 }, { row: 3, col: 2 },  // scope 1 surrounding
  { row: 2, col: 4 }, { row: 4, col: 4 }, { row: 3, col: 5 },  // scope 2 surrounding
  { row: 1, col: 3 }, { row: 5, col: 4 }, { row: 2, col: 2 },  // 3 "selected" cells
];
const step10_after = setCells(step10_board, [
  [3, 3, null], [3, 4, null],
  ...step10_matched.map(p => [p.row, p.col, null] as [number, number, null]),
]);

// --- Step 11: Dish Set × Spoon [demo] ---
const step11_board = makeBoard([
  [3, 3, CI(0, 'burst')],
  [3, 4, CI(0, 'scope')],
]);
const step11_matched: Position[] = [
  { row: 2, col: 4 }, { row: 4, col: 4 }, { row: 3, col: 5 },  // scope surrounding
  // burst at selected pos (2,2) → 3×3 area
  { row: 1, col: 1 }, { row: 1, col: 2 }, { row: 1, col: 3 },
  { row: 2, col: 1 }, { row: 2, col: 2 }, { row: 2, col: 3 },
  { row: 3, col: 1 }, { row: 3, col: 2 },
];
const step11_after = setCells(step11_board, [
  [3, 3, null], [3, 4, null],
  ...step11_matched.map(p => [p.row, p.col, null] as [number, number, null]),
]);

// --- Step 12: Dish Set × Scissors [guided] ---
const step12_board = makeBoard([
  [3, 3, CI(0, 'burst')],
  [3, 4, CI(0, 'v_cut')],
]);
// 3 columns cleared (cols 2,3,4)
const step12_matched: Position[] = range8().flatMap(r =>
  [2, 3, 4].map(c => ({ row: r, col: c }))
);
const step12_after = setCells(step12_board, [
  ...step12_matched.map(p => [p.row, p.col, null] as [number, number, null]),
]);

// --- Step 13: Dish Set × Dish Set [guided] ---
const step13_board = makeBoard([
  [3, 3, CI(0, 'burst')],
  [3, 4, CI(0, 'burst')],
]);
// 5×5 area centered at (3,3)
const step13_matched: Position[] = [];
for (let r = 1; r <= 5; r++) {
  for (let c = 1; c <= 5; c++) {
    step13_matched.push({ row: r, col: c });
  }
}
const step13_after = setCells(step13_board, [
  ...step13_matched.map(p => [p.row, p.col, null] as [number, number, null]),
]);

// --- Step 14: Salad Bowl × Item [demo] ---
const step14_board = makeBoard([
  [3, 3, CI(0, 'flush')],
  [3, 4, CI(0, 'v_cut')],
]);
// Salad Bowl transforms same-color tiles to items, then all activate
// Show several color-0 tiles highlighted
const step14_matched: Position[] = [];
for (let r = 0; r < BOARD_SIZE; r++) {
  for (let c = 0; c < BOARD_SIZE; c++) {
    const bg = safeBg(r, c);
    if (bg.color === 0 && !(r === 3 && (c === 3 || c === 4))) {
      step14_matched.push({ row: r, col: c });
    }
  }
}
const step14_after = setCells(step14_board, [
  [3, 3, null], [3, 4, null],
  ...step14_matched.map(p => [p.row, p.col, null] as [number, number, null]),
]);

// --- Sections & Export ---

export const tutorialSections: TutorialSection[] = [
  {
    id: 'basics',
    titleKey: 'tutorial.section_basics',
    steps: [
      {
        id: 'basic_match',

        type: 'guided',
        titleKey: 'tutorial.step1_title',
        bodyKey: 'tutorial.step1_body',
        board: step1_board,
        focusArea: { startRow: 2, startCol: 2, rows: 4, cols: 5 },
        highlight: [{ row: 4, col: 5 }],
        highlightDir: 'up',
        expectedAction: { type: 'swap', pos: { row: 4, col: 5 }, dir: 'up' },
        matchedCells: step1_matched,
        boardAfterAction: step1_after,
      },
      {
        id: 'chain',

        type: 'demo',
        titleKey: 'tutorial.step2_title',
        bodyKey: 'tutorial.step2_body',
        board: step2_board,
        focusArea: { startRow: 0, startCol: 1, rows: 6, cols: 5 },
        highlight: [{ row: 4, col: 4 }],
        highlightDir: 'left',
        demoAction: { type: 'swap', pos: { row: 4, col: 4 }, dir: 'left' },
        matchPhases: [
          { matched: step2_phase1_matched, boardAfter: step2_phase1_after },
          { matched: step2_phase2_matched, boardAfter: step2_phase2_after },
        ],
      },
      {
        id: 'square_match',

        type: 'guided',
        titleKey: 'tutorial.step3_title',
        bodyKey: 'tutorial.step3_body',
        board: step3_board,
        focusArea: { startRow: 2, startCol: 2, rows: 4, cols: 4 },
        highlight: [{ row: 2, col: 4 }],
        highlightDir: 'down',
        expectedAction: { type: 'swap', pos: { row: 2, col: 4 }, dir: 'down' },
        matchedCells: step3_matched,
        boardAfterAction: step3_after,
      },
    ],
  },
  {
    id: 'items',
    titleKey: 'tutorial.section_items',
    steps: [
      {
        id: 'spoon_usage',

        type: 'demo',
        titleKey: 'tutorial.step4_title',
        bodyKey: 'tutorial.step4_body',
        board: step4_board,
        focusArea: { startRow: 1, startCol: 2, rows: 5, cols: 5 },
        highlight: [{ row: 3, col: 4 }],
        demoAction: { type: 'tap', pos: { row: 3, col: 4 } },
        matchedCells: step4_matched,
        boardAfterAction: step4_after,
      },
      {
        id: 'knife',

        type: 'guided',
        titleKey: 'tutorial.step5_title',
        bodyKey: 'tutorial.step5_body',
        board: step5_board,
        focusArea: { startRow: 1, startCol: 1, rows: 4, cols: 6 },
        highlight: [{ row: 2, col: 5 }],
        highlightDir: 'down',
        expectedAction: { type: 'swap', pos: { row: 2, col: 5 }, dir: 'down' },
        matchedCells: step5_matched,
        boardAfterAction: step5_after,
      },
      {
        id: 'fork',

        type: 'guided',
        titleKey: 'tutorial.step6_title',
        bodyKey: 'tutorial.step6_body',
        board: step6_board,
        focusArea: { startRow: 1, startCol: 1, rows: 5, cols: 6 },
        highlight: [{ row: 3, col: 2 }],
        highlightDir: 'right',
        expectedAction: { type: 'swap', pos: { row: 3, col: 2 }, dir: 'right' },
        matchedCells: step6_matched,
        boardAfterAction: step6_after,
      },
      {
        id: 'salad_bowl',

        type: 'guided',
        titleKey: 'tutorial.step7_title',
        bodyKey: 'tutorial.step7_body',
        board: step7_board,
        focusArea: { startRow: 2, startCol: 0, rows: 4, cols: 8 },
        highlight: [{ row: 4, col: 3 }],
        highlightDir: 'up',
        expectedAction: { type: 'swap', pos: { row: 4, col: 3 }, dir: 'up' },
        matchedCells: step7_matched,
        boardAfterAction: step7_after,
      },
    ],
  },
  {
    id: 'synthesis',
    titleKey: 'tutorial.section_synthesis',
    steps: [
      {
        id: 'spoon_knife',

        type: 'guided',
        titleKey: 'tutorial.step8_title',
        bodyKey: 'tutorial.step8_body',
        board: step8_board,
        focusArea: { startRow: 1, startCol: 1, rows: 5, cols: 6 },
        highlight: [{ row: 3, col: 3 }],
        highlightDir: 'right',
        expectedAction: { type: 'swap', pos: { row: 3, col: 3 }, dir: 'right' },
        matchedCells: step8_matched,
        boardAfterAction: step8_after,
      },
      {
        id: 'knife_knife',

        type: 'guided',
        titleKey: 'tutorial.step9_title',
        bodyKey: 'tutorial.step9_body',
        board: step9_board,
        focusArea: { startRow: 0, startCol: 0, rows: 8, cols: 8 },
        highlight: [{ row: 3, col: 3 }],
        highlightDir: 'right',
        expectedAction: { type: 'swap', pos: { row: 3, col: 3 }, dir: 'right' },
        matchedCells: step9_matched,
        boardAfterAction: step9_after,
      },
      {
        id: 'spoon_spoon',

        type: 'demo',
        titleKey: 'tutorial.step10_title',
        bodyKey: 'tutorial.step10_body',
        board: step10_board,
        focusArea: { startRow: 1, startCol: 1, rows: 6, cols: 5 },
        highlight: [{ row: 3, col: 3 }],
        highlightDir: 'right',
        demoAction: { type: 'swap', pos: { row: 3, col: 3 }, dir: 'right' },
        matchedCells: step10_matched,
        boardAfterAction: step10_after,
      },
      {
        id: 'fork_spoon',

        type: 'demo',
        titleKey: 'tutorial.step11_title',
        bodyKey: 'tutorial.step11_body',
        board: step11_board,
        focusArea: { startRow: 0, startCol: 0, rows: 6, cols: 7 },
        highlight: [{ row: 3, col: 3 }],
        highlightDir: 'right',
        demoAction: { type: 'swap', pos: { row: 3, col: 3 }, dir: 'right' },
        matchedCells: step11_matched,
        boardAfterAction: step11_after,
      },
      {
        id: 'fork_knife',

        type: 'guided',
        titleKey: 'tutorial.step12_title',
        bodyKey: 'tutorial.step12_body',
        board: step12_board,
        focusArea: { startRow: 0, startCol: 1, rows: 8, cols: 5 },
        highlight: [{ row: 3, col: 3 }],
        highlightDir: 'right',
        expectedAction: { type: 'swap', pos: { row: 3, col: 3 }, dir: 'right' },
        matchedCells: step12_matched,
        boardAfterAction: step12_after,
      },
      {
        id: 'fork_fork',

        type: 'guided',
        titleKey: 'tutorial.step13_title',
        bodyKey: 'tutorial.step13_body',
        board: step13_board,
        focusArea: { startRow: 0, startCol: 0, rows: 7, cols: 7 },
        highlight: [{ row: 3, col: 3 }],
        highlightDir: 'right',
        expectedAction: { type: 'swap', pos: { row: 3, col: 3 }, dir: 'right' },
        matchedCells: step13_matched,
        boardAfterAction: step13_after,
      },
      {
        id: 'salad_item',

        type: 'demo',
        titleKey: 'tutorial.step14_title',
        bodyKey: 'tutorial.step14_body',
        board: step14_board,
        focusArea: { startRow: 0, startCol: 0, rows: 8, cols: 8 },
        highlight: [{ row: 3, col: 3 }],
        highlightDir: 'right',
        demoAction: { type: 'swap', pos: { row: 3, col: 3 }, dir: 'right' },
        matchedCells: step14_matched,
        boardAfterAction: step14_after,
      },
    ],
  },
  {
    id: 'modes',
    titleKey: 'tutorial.section_modes',
    steps: [
      {
        id: 'mode_sprint',

        type: 'info',
        titleKey: 'tutorial.step15_title',
        bodyKey: 'tutorial.step15_body',
        image: '/tutorial/sprint.png',
      },
      {
        id: 'mode_clear',

        type: 'info',
        titleKey: 'tutorial.step16_title',
        bodyKey: 'tutorial.step16_body',
        image: '/tutorial/clear.png',
        // Show obstacle demo board
        board: makeBoard([
          [2, 3, { color: 0 as Color, obstacle: { durability: 3 } }],
          [2, 4, { color: 0 as Color, obstacle: { durability: 2 } }],
          [2, 5, { color: 0 as Color, obstacle: { durability: 1 } }],
        ]),
        focusArea: { startRow: 1, startCol: 2, rows: 3, cols: 5 },
      },
      {
        id: 'mode_survival',

        type: 'info',
        titleKey: 'tutorial.step17_title',
        bodyKey: 'tutorial.step17_body',
        image: '/tutorial/survival.png',
      },
      {
        id: 'mode_cascade',

        type: 'info',
        titleKey: 'tutorial.step18_title',
        bodyKey: 'tutorial.step18_body',
        image: '/tutorial/cascade.png',
      },
    ],
  },
  {
    id: 'other',
    titleKey: 'tutorial.section_other',
    steps: [
      {
        id: 'daily_puzzle',

        type: 'info',
        titleKey: 'tutorial.step19_title',
        bodyKey: 'tutorial.step19_body',
        image: '/tutorial/daily.png',
      },
      {
        id: 'ranking',

        type: 'info',
        titleKey: 'tutorial.step20_title',
        bodyKey: 'tutorial.step20_body',
        image: '/tutorial/ranking.png',
      },
      {
        id: 'replay',

        type: 'info',
        titleKey: 'tutorial.step21_title',
        bodyKey: 'tutorial.step21_body',
        image: '/tutorial/replay.png',
      },
    ],
  },
];

/** Flat list of all steps */
export const allTutorialSteps: TutorialStep[] = tutorialSections.flatMap(s => s.steps);

/** Get section index for a given step index */
export function getSectionForStep(stepIndex: number): number {
  let count = 0;
  for (let i = 0; i < tutorialSections.length; i++) {
    count += tutorialSections[i].steps.length;
    if (stepIndex < count) return i;
  }
  return tutorialSections.length - 1;
}
