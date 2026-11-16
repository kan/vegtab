/** 累計の上限。サーバーが受け付ける上限（backend/src/lib/ranking-rule.ts の MAX_CLEAR_TIME_MS）と同じ */
export const MAX_PLAY_TIME_MS = 24 * 60 * 60 * 1000;

/**
 * 1 つの seed の累計プレイ時間を数える時計。止まっている間の累計（base）と、動き出した時刻（since）を持つ。
 * 時刻の取得と保存は外から渡すので、DOM なしでテストできる（usePlayTimer がブラウザのイベントとつなぐ）
 */
export class PlayClock {
  private base: number;
  private since: number | null = null;
  private lastSave = 0;

  constructor(
    initialMs: number,
    private readonly clock: () => number,
    private readonly save: (ms: number) => void,
    private readonly saveEveryMs: number,
  ) {
    this.base = clamp(initialMs);
  }

  get running(): boolean {
    return this.since !== null;
  }

  /** 今の累計（動いている分を含む。上限で止める） */
  now(): number {
    return this.since === null ? this.base : clamp(this.base + (this.clock() - this.since));
  }

  /**
   * 動き出す。storedMs には保存済みの累計を渡す。別のタブが同じ seed で時間を足していた場合に、
   * 古い累計で上書きして時間を減らさないよう、大きい方から数える
   */
  start(storedMs: number) {
    if (this.since !== null) return;
    this.base = clamp(Math.max(this.base, storedMs));
    this.since = this.clock();
    this.lastSave = this.since;
  }

  /** 止めて累計を確定する。persist が true なら保存もする（アニメーションによる短い停止では保存しない） */
  stop(persist: boolean) {
    if (this.since !== null) {
      this.base = this.now();
      this.since = null;
    }
    if (persist) this.save(this.base);
  }

  /** 動いている間、saveEveryMs ごとに保存する（タブが突然閉じられたときの取りこぼしを抑える） */
  tick() {
    if (this.since === null) return;
    const t = this.clock();
    if (t - this.lastSave >= this.saveEveryMs) {
      this.lastSave = t;
      this.save(this.now());
    }
  }
}

function clamp(ms: number): number {
  return Math.min(Math.max(0, ms), MAX_PLAY_TIME_MS);
}
