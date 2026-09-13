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
  sparkle?: boolean;   // Cascade: キラキラ野菜（消去時+1 CP）
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

/** リプレイログに記録する操作（Action に、選択を伴うスプーン操作と終了時の自動発動を加えたもの） */
export type ReplayAction =
  | Action
  | { type: 'scope_synthesis'; pos1: Position; pos2: Position; targetCells: Position[] }
  | { type: 'scope_swap'; pos: Position; dir: Direction; targetCells: Position[] }
  | { type: 'auto_activate' };

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
  sparkleCount?: number;  // Cascade: 消去されたキラキラ数
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
  /** ベースシード値（Survivalのウェーブ侵食位置算出などに利用） */
  seed?: number;
  moveLimit?: number;        // Sprint only
  isCleared?: boolean;       // Clear: true when all obstacles removed
  numColors?: number;        // Cascade: number of colors (default NUM_COLORS)
  maxChainIndex?: number;    // Cascade: max chain achieved so far
  cascadePoints?: number;    // Cascade: cumulative chain points (sum of chainIndex for chainIndex >= 2)
  milestonesClaimed?: number[];  // Cascade: chain milestones already claimed this game
  sparkleRngState?: number[];    // Cascade: per-column sparkle RNG
  lastChainCount?: number;   // Chain count of the last action (for replay display)
};

export const BOARD_SIZE = 8;
export const NUM_COLORS = 5;
