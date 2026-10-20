import { describe, it, expect } from 'vitest';
import { isRemovedMode, filterPlayRecords, filterAchievements, isRemovedModeScoreSubmission } from './legacyData';

describe('isRemovedMode', () => {
  it('撤去したモードだけを真にする（mode なしと clear は残す）', () => {
    expect(isRemovedMode('sprint')).toBe(true);
    expect(isRemovedMode('survival')).toBe(true);
    expect(isRemovedMode('cascade')).toBe(true);
    expect(isRemovedMode('clear')).toBe(false);
    expect(isRemovedMode(undefined)).toBe(false);
  });
});

describe('filterPlayRecords', () => {
  it('撤去したモードの記録を除き、残す記録から mode を落とす', () => {
    const records = filterPlayRecords([
      { seed: 1, mode: 'sprint', score: 100 },
      { seed: 2, mode: 'clear', score: 200 },
      { seed: 3, score: 300 },
      { seed: 4, mode: 'cascade', score: 400 },
    ]);
    expect(records).toEqual([{ seed: 2, score: 200 }, { seed: 3, score: 300 }]);
  });

  it('壊れた要素や配列でない値でも例外にしない', () => {
    expect(filterPlayRecords([null, 1, 'x', { seed: 5 }])).toEqual([{ seed: 5 }]);
    expect(filterPlayRecords({ seed: 1 })).toEqual([]);
    expect(filterPlayRecords(null)).toEqual([]);
  });
});

describe('filterAchievements', () => {
  it('定義に無い（撤去した）実績と壊れた要素を除く', () => {
    const list = filterAchievements([
      { type: 'clear_first', isUnlocked: true },
      { type: 'sprint_score_500', isUnlocked: true },
      { type: 'all_modes_played', isUnlocked: true },
      { type: 'cascade_chain_3', isUnlocked: false },
      null,
      { isUnlocked: true },
    ]);
    expect(list.map(a => a.type)).toEqual(['clear_first', 'cascade_chain_3']);
    expect(filterAchievements('x')).toEqual([]);
  });
});

describe('isRemovedModeScoreSubmission', () => {
  const entry = (url: string, body: unknown) => ({ url, body: typeof body === 'string' ? body : JSON.stringify(body) });

  it('撤去したモードのスコア送信だけを真にする', () => {
    expect(isRemovedModeScoreSubmission(entry('/api/scores', { mode: 'sprint' }))).toBe(true);
    expect(isRemovedModeScoreSubmission(entry('/api/scores', { mode: 'clear' }))).toBe(false);
    expect(isRemovedModeScoreSubmission(entry('/api/other', { mode: 'sprint' }))).toBe(false);
  });

  it('本文が JSON でなければ捨てない', () => {
    expect(isRemovedModeScoreSubmission(entry('/api/scores', 'not json'))).toBe(false);
  });
});
