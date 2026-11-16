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
  /**
   * 鎖の段数（鎖のモードの試作、#107。連鎖の chain と区別するため lock と呼ぶ）。鎖の付いた野菜は入れ替えできず、落下しない。
   * 同じ色のマッチに入るか、アイテムの効果範囲に入ると 1 段外れ、野菜はその場に残る
   */
  lock?: number;
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

/** リプレイログに記録する操作（Action に、選択を伴うスプーン操作を加えたもの） */
export type ReplayAction =
  | Action
  | { type: 'scope_synthesis'; pos1: Position; pos2: Position; targetCells: Position[] }
  | { type: 'scope_swap'; pos: Position; dir: Direction; targetCells: Position[] };

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

/** 合成効果の種類 */
export type SynthesisEffect =
  | 'line+line'
  | 'v_cut+burst' | 'h_cut+burst'
  | 'burst+burst'
  | 'flush+flush' | 'flush+v_cut' | 'flush+h_cut' | 'flush+burst'
  | 'scope+scope' | 'scope+v_cut' | 'scope+h_cut' | 'scope+burst' | 'scope+flush';

/** ゲーム初期化パラメータ */
export type GameInitParams = {
  obstacleCount?: number;    // default OBSTACLE_DURABILITIES (16, durability total 28). For tests
  /**
   * 鎖のモードの盤にする（#107 の試作）。おじゃまタイルを置かず、代わりに鎖を置く。
   * 鎖をすべて外すとクリア
   */
  locks?: LockParams;
};

/** 鎖の置き方（#107 の試作） */
export type LockParams = {
  /** 鎖の付いた野菜の数 */
  count: number;
  /** そのうち 2 段の鎖の数 */
  double: number;
};

/** ゲーム状態 */
export type GameState = {
  board: (Cell | null)[][];
  score: number;
  /** 列ごとの独立RNGストリーム（各列の補充タイル列がシードで一意に決まる） */
  rngState: number[];
  moveCount: number;
  isGameOver: boolean;
  /** ベースシード値 */
  seed?: number;
  isCleared?: boolean;       // true when all obstacles removed
  maxChainIndex?: number;    // max chain achieved so far
  lastChainCount?: number;   // Chain count of the last action (for replay display)
};

export const BOARD_SIZE = 8;
export const NUM_COLORS = 5;
