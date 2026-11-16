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

/**
 * 32bit の avalanche ハッシュ（splitmix32 の finalizer 相当）。
 *
 * xorshift の状態を「別ストリームの開始点」として使いたいときに挟む。
 * nextInt(rng, 0x7fffffff) の戻り値は raw が正の int32 のとき raw そのもの
 * （= 次の状態）になるため、それをそのまま別ストリームの種にすると
 * 両者が 1 ステップずれただけの同一ストリームになってしまう。
 */
export function mix32(x: number): number {
  let h = x >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h | 0;
}
