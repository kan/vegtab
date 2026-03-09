/** 付箋の色 (0-4) */
export type Color = 0 | 1 | 2 | 3 | 4;

/** アイテム種別 */
export type ItemType = 'magnifying_glass' | 'scissors' | 'cutter' | 'clip' | 'coffee';

/** 盤面上のセル */
export type Cell = {
  color: Color;
  item?: ItemType;
};

/** 盤面座標 */
export type Position = {
  row: number;
  col: number;
};

/** スワイプ方向 */
export type Direction = 'up' | 'down' | 'left' | 'right';

/** プレイヤー操作 */
export type Action =
  | { type: 'swap'; pos: Position; dir: Direction }
  | { type: 'tap'; pos: Position }
  | { type: 'magnifying_glass'; pos: Position; targetCells: Position[] };

/** マッチ情報 */
export type Match = {
  positions: Position[];
  color: Color;
  shape?: '2x2';
};

/** 連鎖ステップの結果 */
export type ChainStep = {
  chainIndex: number;
  matches: Match[];
  clearedPositions: Position[];
  generatedItems: { pos: Position; item: ItemType }[];
  score: number;
};

/** ゲームモード */
export type GameMode = 'limited';

/** ゲーム状態 */
export type GameState = {
  board: (Cell | null)[][];
  score: number;
  rngState: number;
  moveCount: number;
  isGameOver: boolean;
  mode: GameMode;
  moveLimit?: number;
};

export const BOARD_SIZE = 8;
export const NUM_COLORS = 5;
