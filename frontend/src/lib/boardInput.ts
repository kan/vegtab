import type { Direction, Position } from '@vegtab/engine';
import { getAdjacentPos } from '@vegtab/engine';

/** An input on the puzzle board, as PuzzleBoard's guard (the tutorial) sees it */
export type BoardInput =
  | { type: 'swap'; pos: Position; dir: Direction }
  | { type: 'tap'; pos: Position }
  /** A cell picked while a spoon is choosing its target */
  | { type: 'select'; pos: Position };

/**
 * What the tutorial shows the player to do: drag `from` onto its neighbour `to`, or tap `at`. A tap
 * with `whileSelecting` is the cell to pick once a spoon is choosing its target; it shows only then,
 * and the other hints show only when no spoon is choosing
 */
export type BoardHint =
  | { type: 'swap'; from: Position; to: Position }
  | { type: 'tap'; at: Position; whileSelecting?: boolean };

/** The cell next to p in direction d (may be off the board): the engine's own */
export const adj = getAdjacentPos;

/** The direction from a to its neighbour b */
export function dirBetween(a: Position, b: Position): Direction {
  if (b.row < a.row) return 'up';
  if (b.row > a.row) return 'down';
  return b.col < a.col ? 'left' : 'right';
}
