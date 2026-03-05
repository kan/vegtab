/**
 * シード対応擬似乱数生成器 (xorshift32)
 * 決定的な結果を保証する
 */

export function createRng(seed: number): number {
  // seed が 0 だと xorshift が機能しないので避ける
  return seed === 0 ? 1 : (seed | 0) || 1;
}

export function nextRng(state: number): [number, number] {
  let s = state;
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  s = s | 0; // 32bit整数に丸める
  if (s === 0) s = 1;
  return [s, s];
}

/** 0以上max未満の整数を返す */
export function nextInt(state: number, max: number): [number, number] {
  const [next, raw] = nextRng(state);
  const value = ((raw >>> 0) % max);
  return [next, value];
}
