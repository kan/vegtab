/** 野菜の色 (0-4) */
export type Color = 0 | 1 | 2 | 3 | 4;

/** アイテム種別 */
export type ItemType = 'scope' | 'v_cut' | 'h_cut' | 'burst' | 'flush';

/** おじゃまタイル */
export type Obstacle = { durability: number };

/** 盤面上のセル */
export type Cell = {
  color: Color;
  item?: ItemType;
  obstacle?: Obstacle;
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
  | { type: 'scope'; pos: Position; targetCells: Position[] };

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
export type GameMode = 'sprint' | 'clear' | 'survival' | 'cascade';

/** 合成効果の種類 */
export type SynthesisEffect =
  | 'line+line'
  | 'v_cut+burst' | 'h_cut+burst'
  | 'burst+burst'
  | 'flush+flush' | 'flush+v_cut' | 'flush+h_cut' | 'flush+burst'
  | 'scope+scope' | 'scope+v_cut' | 'scope+h_cut' | 'scope+burst' | 'scope+flush';

/** ゲーム初期化パラメータ */
export type GameInitParams = {
  moveLimit?: number;        // Sprint/Cascade: default 15
  obstacleCount?: number;    // Clear: default seed-dependent 10-20
  quotaTable?: number[];     // Survival: default generated
  numColors?: number;        // Cascade: default 4
};

/** ゲーム状態 */
export type GameState = {
  board: (Cell | null)[][];
  score: number;
  /** 列ごとの独立RNGストリーム（各列の補充タイル列がシードで一意に決まる） */
  rngState: number[];
  moveCount: number;
  isGameOver: boolean;
  mode: GameMode;
  moveLimit?: number;        // Sprint only
  isCleared?: boolean;       // Clear: true when all obstacles removed
  quotaTable?: number[];     // Survival: per-segment score quotas
  segmentStartScore?: number; // Survival: score at start of current segment
  numColors?: number;        // Cascade: number of colors (default NUM_COLORS)
  maxChainIndex?: number;    // Cascade: max chain achieved so far
  cascadePoints?: number;    // Cascade: cumulative chain points (sum of chainIndex for chainIndex >= 2)
  lastChainCount?: number;   // Chain count of the last action (for replay display)
};

export const BOARD_SIZE = 8;
export const NUM_COLORS = 5;
