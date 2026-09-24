import { describe, it, expect } from 'vitest';
import { isDateNearToday, isRankingClosed, parseDateString, todayJST } from '../src/lib/date';

/** YYYY-MM-DD for today (JST) shifted by `days` */
function shiftToday(days: number): string {
  const date = parseDateString(todayJST())!;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe('parseDateString', () => {
  it('parses real calendar dates', () => {
    expect(parseDateString('2026-09-30')?.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    expect(parseDateString('2028-02-29')).not.toBeNull();
  });

  it.each(['2026-09-31', '2026-02-29', '2026-13-01', '2026-00-10', '2026-09-32'])(
    'rejects impossible date %s instead of rolling it over',
    (dateStr) => {
      expect(parseDateString(dateStr)).toBeNull();
    },
  );
});

describe('isDateNearToday', () => {
  it('accepts today and up to 60 days in the past', () => {
    expect(isDateNearToday(shiftToday(0))).toBe(true);
    expect(isDateNearToday(shiftToday(-1))).toBe(true);
    expect(isDateNearToday(shiftToday(-60))).toBe(true);
  });

  it('rejects tomorrow', () => {
    expect(isDateNearToday(shiftToday(1))).toBe(false);
  });

  it('rejects dates older than 60 days', () => {
    expect(isDateNearToday(shiftToday(-61))).toBe(false);
  });
});

describe('isRankingClosed', () => {
  /** JST の日時を epoch ms にする */
  const jst = (iso: string) => new Date(`${iso}+09:00`).getTime();

  it('当日のランキングは開いている', () => {
    expect(isRankingClosed('2026-09-24', jst('2026-09-24T12:00:00'))).toBe(false);
  });

  it('0 時を過ぎて 30 分以内なら、前日のランキングもまだ開いている', () => {
    expect(isRankingClosed('2026-09-23', jst('2026-09-24T00:00:00'))).toBe(false);
    expect(isRankingClosed('2026-09-23', jst('2026-09-24T00:29:59'))).toBe(false);
  });

  it('猶予を過ぎると前日のランキングは閉じる', () => {
    expect(isRankingClosed('2026-09-23', jst('2026-09-24T00:30:00'))).toBe(true);
  });

  it('2 日以上前は猶予の間でも閉じている', () => {
    expect(isRankingClosed('2026-09-22', jst('2026-09-24T00:10:00'))).toBe(true);
  });

  it('まだ始まっていない日は閉じていない（過去日扱いにしない）', () => {
    expect(isRankingClosed('2026-09-25', jst('2026-09-24T12:00:00'))).toBe(false);
  });
});
