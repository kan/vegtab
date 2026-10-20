import { describe, it, expect } from 'vitest';
import { PlayClock, MAX_PLAY_TIME_MS } from './playClock';

function setup(initialMs = 0, saveEveryMs = 5_000) {
  let t = 1_000;
  const saved: number[] = [];
  const clock = new PlayClock(initialMs, () => t, ms => saved.push(ms), saveEveryMs);
  return { clock, saved, advance: (ms: number) => { t += ms; } };
}

describe('PlayClock', () => {
  it('動いている間だけ数え、止めると累計を確定する', () => {
    const { clock, advance } = setup(10_000);
    advance(3_000);
    expect(clock.now()).toBe(10_000);
    clock.start(0);
    advance(2_500);
    expect(clock.now()).toBe(12_500);
    clock.stop(false);
    advance(60_000);
    expect(clock.now()).toBe(12_500);
    clock.start(0);
    advance(500);
    expect(clock.now()).toBe(13_000);
  });

  it('アニメーションによる停止（persist=false）は保存せず、離れたときとゲーム終了（persist=true）は保存する', () => {
    const { clock, saved, advance } = setup();
    clock.start(0);
    advance(1_000);
    clock.stop(false);
    expect(saved).toEqual([]);
    clock.start(0);
    advance(1_000);
    clock.stop(true);
    expect(saved).toEqual([2_000]);
  });

  it('止まっていても persist=true なら確定済みの累計を保存する（アニメーション中に画面を離れた場合）', () => {
    const { clock, saved, advance } = setup(5_000);
    clock.start(0);
    advance(1_000);
    clock.stop(false);
    clock.stop(true);
    expect(saved).toEqual([6_000]);
  });

  it('動いている間は saveEveryMs ごとに保存する', () => {
    const { clock, saved, advance } = setup(0, 5_000);
    clock.start(0);
    advance(4_000);
    clock.tick();
    expect(saved).toEqual([]);
    advance(1_000);
    clock.tick();
    expect(saved).toEqual([5_000]);
    advance(3_000);
    clock.tick();
    expect(saved).toEqual([5_000]);
  });

  it('再開時に保存値の方が大きければ（別のタブで足された分）、そこから数える', () => {
    const { clock, advance } = setup(600_000);
    clock.start(900_000);
    advance(1_000);
    expect(clock.now()).toBe(901_000);
    clock.stop(false);
    clock.start(100_000); // 保存値が小さければ自分の累計を使う
    advance(1_000);
    expect(clock.now()).toBe(902_000);
  });

  it('累計は上限（24 時間）で止まる', () => {
    const { clock, advance } = setup(MAX_PLAY_TIME_MS - 1_000);
    clock.start(0);
    advance(10_000);
    expect(clock.now()).toBe(MAX_PLAY_TIME_MS);
    expect(setup(MAX_PLAY_TIME_MS * 2).clock.now()).toBe(MAX_PLAY_TIME_MS);
  });

  it('二重に start しても開始時刻は変わらない', () => {
    const { clock, advance } = setup();
    clock.start(0);
    advance(1_000);
    clock.start(0);
    advance(1_000);
    expect(clock.now()).toBe(2_000);
  });
});
