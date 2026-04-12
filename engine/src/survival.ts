/**
 * Survivalモード: ウェーブ制のおじゃまタイル侵食
 *
 * 一定ターン経過ごとに、シード値とウェーブ番号から決定論的に算出された
 * 位置へおじゃまタイルが侵食する。同位置への再侵食で耐久値が+1され、
 * 最大値4に到達した瞬間にゲームオーバーとなる。
 *
 * 本モジュールは純粋関数のみを含む。実際の盤面への侵食適用（アイテム強制
 * 発動を含む）は engine.ts の applyWave で行う。
 */
import { Position, BOARD_SIZE } from './types.js';
import { createRng, nextInt } from './rng.js';

/** ウェーブ発生間隔（ターン数）
 * moveCount がこの倍数に到達したターンにウェーブ N が発生する。
 * ウェーブ1 = 3手目終了時、ウェーブ2 = 6手目終了時、... */
export const SURVIVAL_WAVE_INTERVAL = 3;

/** 予告表示のリードタイム（ターン数）
 * 次のウェーブまで残り N 手以下になったら予告マーカーを表示する。 */
export const SURVIVAL_WAVE_PREVIEW_LEAD = 2;

/** 1ウェーブあたりの最大侵食個数 */
export const SURVIVAL_WAVE_MAX_OBSTACLES = 20;

/** 初期盤面のおじゃまタイル配置個数（Survivalモード） */
export const SURVIVAL_INITIAL_OBSTACLE_COUNT = 0;

/** おじゃまタイル耐久値の上限（到達でゲームオーバー） */
export const SURVIVAL_MAX_OBSTACLE_DURABILITY = 4;

/** 直近で発生済みのウェーブ番号を返す
 * moveCount 0..2 → 0 (未発生), 3..5 → 1, 6..8 → 2, ... */
export function currentWaveNumber(moveCount: number): number {
  if (moveCount <= 0) return 0;
  return Math.floor(moveCount / SURVIVAL_WAVE_INTERVAL);
}

/** 次のウェーブまでの残りターン数（1以上 SURVIVAL_WAVE_INTERVAL 以下） */
export function movesUntilNextWave(moveCount: number): number {
  const rem = moveCount % SURVIVAL_WAVE_INTERVAL;
  return SURVIVAL_WAVE_INTERVAL - rem;
}

/** 指定ウェーブ番号の侵食個数
 * 初回から強烈で、4個ずつ増え、最大 SURVIVAL_WAVE_MAX_OBSTACLES で頭打ち。
 * ウェーブ1=12, 2=16, 3=20, 4=20, 5=20, ... */
export function waveObstacleCount(waveNumber: number): number {
  if (waveNumber <= 0) return 0;
  return Math.min(8 + waveNumber * 4, SURVIVAL_WAVE_MAX_OBSTACLES);
}

/** 予告中のウェーブ番号を返す（予告中でなければ null）
 * 次のウェーブまで残り SURVIVAL_WAVE_PREVIEW_LEAD 手以下になったら予告を開始。 */
export function previewWaveNumber(moveCount: number): number | null {
  const remain = movesUntilNextWave(moveCount);
  if (remain > SURVIVAL_WAVE_PREVIEW_LEAD) return null;
  return currentWaveNumber(moveCount) + 1;
}

/** シード値とウェーブ番号から決定論的に派生したRNG初期値を生成
 * 列ごとRNGストリームとは独立。同じシード・同じウェーブ番号なら常に同じ値。 */
function deriveWaveRng(seed: number, waveNumber: number): number {
  const base = createRng(seed);
  const mixed = (base ^ ((waveNumber * 0x9e3779b9) | 0)) | 0;
  return createRng(mixed === 0 ? waveNumber + 1 : mixed);
}

/** シード値とウェーブ番号から侵食位置を決定論的に算出
 *
 * @param seed        ベースシード（GameState.seed）
 * @param waveNumber  ウェーブ番号（1以上）
 * @returns           処理順の侵食位置配列（常にこの順序で処理すること）
 */
export function computeWavePositions(
  seed: number,
  waveNumber: number,
): Position[] {
  const count = waveObstacleCount(waveNumber);
  if (count === 0) return [];

  let rng = deriveWaveRng(seed, waveNumber);

  // 全64マスを列挙し Fisher-Yates でシャッフルして先頭 count 個を採用
  const positions: Position[] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      positions.push({ row, col });
    }
  }
  for (let i = positions.length - 1; i > 0; i--) {
    let j: number;
    [rng, j] = nextInt(rng, i + 1);
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  return positions.slice(0, count);
}

/** 現在のmoveCountで予告中のウェーブの侵食予定位置を返す。
 * 予告中でなければ null。UI表示用。 */
export function previewWavePositions(
  seed: number,
  moveCount: number,
): Position[] | null {
  const waveNum = previewWaveNumber(moveCount);
  if (waveNum === null) return null;
  return computeWavePositions(seed, waveNum);
}
