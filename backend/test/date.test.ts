import { describe, it, expect } from 'vitest';
import { isDateNearToday, parseDateString, todayJST } from '../src/lib/date';

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
