import { describe, it, expect, beforeEach, vi } from 'vitest';
import { withPlayTime, getPlayTime, savePlayTime, loadPlayTimes, formatPlayTime, formatRecordTime } from './playTime';

function stubLocalStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
  });
  return data;
}

describe('playTime の保存', () => {
  beforeEach(() => { stubLocalStorage(); });

  it('seed ごとに累計を保存して読み戻せる', () => {
    savePlayTime(111, 12_345.6);
    savePlayTime(222, 1_000);
    expect(getPlayTime(111)).toBe(12_346);
    expect(getPlayTime(222)).toBe(1_000);
    expect(getPlayTime(333)).toBe(0);
  });

  it('壊れた保存値は空として扱う', () => {
    localStorage.setItem('vegtab_play_time', '{"s1":"x"}');
    expect(loadPlayTimes()).toEqual({});
    localStorage.setItem('vegtab_play_time', 'not json');
    expect(loadPlayTimes()).toEqual({});
  });
});

describe('withPlayTime', () => {
  it('更新した seed を最新として扱い、古い seed から 90 件まで間引く', () => {
    let times = {};
    for (let seed = 1; seed <= 95; seed++) times = withPlayTime(times, seed, seed);
    expect(Object.keys(times)).toHaveLength(90);
    expect(Object.keys(times)[0]).toBe('s6');

    // 6 を更新すると最新になり、次に間引かれるのは 7
    times = withPlayTime(times, 6, 999);
    times = withPlayTime(times, 96, 96);
    const keys = Object.keys(times);
    expect(keys).toHaveLength(90);
    expect(keys).toContain('s6');
    expect(keys).not.toContain('s7');
    expect(keys.slice(-2)).toEqual(['s6', 's96']);
  });
});

describe('formatPlayTime', () => {
  it('m:ss、1 時間以上は h:mm:ss にし、秒未満は切り捨てる', () => {
    expect(formatPlayTime(0)).toBe('0:00');
    expect(formatPlayTime(59_999)).toBe('0:59');
    expect(formatPlayTime(83_000)).toBe('1:23');
    expect(formatPlayTime(3_723_000)).toBe('1:02:03');
  });

  it('時間の記録がない記録は -:-- にする', () => {
    expect(formatRecordTime(null)).toBe('-:--');
    expect(formatRecordTime(undefined)).toBe('-:--');
    expect(formatRecordTime(61_000)).toBe('1:01');
  });
});
