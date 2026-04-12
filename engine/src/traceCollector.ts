/**
 * TraceCollector: アニメーション用中間データを収集するオプショナルインターフェース。
 *
 * processAction / processScopeSynthesis 等の内部関数がゲーム状態を更新しながら
 * collector のメソッドを呼び出し、呼び出し側（trace.ts の compute*Plan 関数）が
 * アニメーションプランを組み立てるのに使う。
 *
 * collector が undefined の場合（backend, テスト等）は一切のオーバーヘッドなし。
 * すべてのメソッドはオプショナル。
 */

import type { Cell, ItemType, Match, Position, SynthesisEffect } from './types.js';

// --- Drop move types (shared with dropMoves.ts) ---

export interface DropMove {
  col: number;
  fromRow: number;
  toRow: number;
}

export interface NewTileEntry {
  row: number;
  col: number;
  segNulls: number;
}

// --- Collector callback data ---

/** processChains / processAction inline chain で1連鎖ごとに通知されるデータ */
export interface ChainStepData {
  chainIndex: number;
  matches: Match[];
  clearedPositions: Position[];
  destroyedObstacles: Position[];
  itemGens: { pos: Position; item: ItemType }[];
  score: number;
  /** gravity 前の board から計算した落下移動（アニメ用） */
  dropMoves: DropMove[];
  /** gravity 前の board から計算した新タイル出現情報（アニメ用） */
  newTileEntries: NewTileEntry[];
  /** gravity + fill 後の board スナップショット */
  boardAfterDrop: (Cell | null)[][];
}

/** activateItem 内で各アイテム効果（誘爆含む）ごとに通知されるデータ */
export interface ItemEffectData {
  itemType: ItemType;
  itemPos: Position;
  targets: Position[];
  detonations: { pos: Position; item: ItemType }[];
  depth: number;
  score: number;
}

/** applyWave 内で各侵食位置ごとに通知されるデータ */
export interface WaveStepData {
  pos: Position;
  kind: 'place' | 'bump' | 'item_activate';
  /** bump の場合: 上昇後の耐久値 */
  newDurability?: number;
  /** item_activate の場合: 落下移動 */
  dropMoves?: DropMove[];
  /** item_activate の場合: 新タイル出現情報 */
  newTileEntries?: NewTileEntry[];
  /** 本ステップ完了後の盤面 */
  boardAfter: (Cell | null)[][];
  score: number;
}

/** 合成効果のデータ（processSynthesis 内で通知） */
export interface SynthesisEffectData {
  effectType: SynthesisEffect;
  item1: ItemType;
  item2: ItemType;
  pos1: Position;
  pos2: Position;
  targets: Position[];
  detonations: { pos: Position; item: ItemType }[];
  score: number;
}

// --- TraceCollector interface ---

export interface TraceCollector {
  /** 連鎖ステップ完了時（processChains 内 + processAction の inline first chain） */
  onChainStep?(data: ChainStepData): void;

  /** アイテム効果（activateItem 内、各 detonation ごと） */
  onItemEffect?(data: ItemEffectData): void;

  /** ウェーブ侵食ステップ（applyWave 内、各位置ごと） */
  onWaveStep?(data: WaveStepData): void;

  /** 合成効果（processSynthesis 内） */
  onSynthesisEffect?(data: SynthesisEffectData): void;

  /** 盤面スナップショット（任意のタイミングでラベル付きで通知） */
  onBoardSnapshot?(label: string, board: (Cell | null)[][]): void;

  /** スプーンの周囲消去効果（processAction scope パス内） */
  onScopeAdjacent?(targets: Position[]): void;

  /** gravity 前の落下移動情報（アイテム発動後/合成効果後/scope効果後 等） */
  onDropData?(moves: DropMove[], newTileEntries: NewTileEntry[]): void;
}
