/**
 * Clear だけのゲームになる前（#102 で Sprint / Survival / Cascade を撤去する前）にブラウザへ保存されたデータの扱い。
 * 撤去したモードのデータは読み込まずに捨てる。どれも読み込み口で 1 回だけ通す
 */
import { getAchievementDef } from '@vegtab/engine';

/** 撤去したモードのものか。撤去前のデータは mode を持ち、撤去後のデータは持たない（または 'clear'） */
export function isRemovedMode(mode: unknown): boolean {
  return mode !== undefined && mode !== 'clear';
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** プレイ記録: 撤去したモードの記録と壊れた要素を除き、mode を落とす */
export function filterPlayRecords<T extends object>(raw: unknown): T[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => isObject(r) && !isRemovedMode(r.mode))
    .map(({ mode: _mode, ...r }) => r as T);
}

/** 実績のキャッシュ: 定義に無い（撤去した）実績と壊れた要素を除く（解除数が全数を超えないように） */
export function filterAchievements<T extends { type: string }>(raw: unknown): T[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((a): a is T => isObject(a) && typeof a.type === 'string' && !!getAchievementDef(a.type));
}

/** オフラインキューの項目が、撤去したモードのスコア送信か（送っても 400 になるので捨てる） */
export function isRemovedModeScoreSubmission(entry: { url: string; body: string }): boolean {
  if (entry.url !== '/api/scores') return false;
  try {
    const body: unknown = JSON.parse(entry.body);
    return isObject(body) && isRemovedMode(body.mode);
  } catch {
    return false;
  }
}
