import { describe, it, expect } from 'vitest';
import { DEFAULT_QUOTA_TABLE, getQuota, checkSurvivalQuota } from '../src/survival.js';

describe('DEFAULT_QUOTA_TABLE', () => {
  it('各区間のノルマ値が正しい: [300, 400, 500, 600, 700, ...]', () => {
    expect(DEFAULT_QUOTA_TABLE[0]).toBe(300);
    expect(DEFAULT_QUOTA_TABLE[1]).toBe(400);
    expect(DEFAULT_QUOTA_TABLE[2]).toBe(500);
    expect(DEFAULT_QUOTA_TABLE[3]).toBe(600);
    expect(DEFAULT_QUOTA_TABLE[4]).toBe(700);
  });

  it('テーブルの長さが20', () => {
    expect(DEFAULT_QUOTA_TABLE.length).toBe(20);
  });

  it('値が単調増加する', () => {
    for (let i = 1; i < DEFAULT_QUOTA_TABLE.length; i++) {
      expect(DEFAULT_QUOTA_TABLE[i]).toBeGreaterThan(DEFAULT_QUOTA_TABLE[i - 1]);
    }
  });
});

describe('getQuota', () => {
  it('テーブル範囲内のインデックスで正しい値を返す', () => {
    expect(getQuota(DEFAULT_QUOTA_TABLE, 0)).toBe(300);
    expect(getQuota(DEFAULT_QUOTA_TABLE, 4)).toBe(700);
    expect(getQuota(DEFAULT_QUOTA_TABLE, 19)).toBe(DEFAULT_QUOTA_TABLE[19]);
  });

  it('テーブル範囲外のインデックスで外挿される', () => {
    const result = getQuota(DEFAULT_QUOTA_TABLE, 20);
    // テーブル外なので最後の値より大きい
    expect(result).toBeGreaterThan(DEFAULT_QUOTA_TABLE[19]);
  });

  it('外挿値も単調増加する', () => {
    const v20 = getQuota(DEFAULT_QUOTA_TABLE, 20);
    const v21 = getQuota(DEFAULT_QUOTA_TABLE, 21);
    const v22 = getQuota(DEFAULT_QUOTA_TABLE, 22);
    expect(v21).toBeGreaterThan(v20);
    expect(v22).toBeGreaterThan(v21);
  });
});

describe('checkSurvivalQuota', () => {
  it('move 0 はチェックポイントではない', () => {
    const result = checkSurvivalQuota(0, 0, DEFAULT_QUOTA_TABLE);
    expect(result.isCheckpoint).toBe(false);
    expect(result.quotaMet).toBe(true);
    expect(result.checkpointIndex).toBe(-1);
  });

  it('move 5 はチェックポイント（index 0）', () => {
    const result = checkSurvivalQuota(5, 300, DEFAULT_QUOTA_TABLE);
    expect(result.isCheckpoint).toBe(true);
    expect(result.checkpointIndex).toBe(0);
  });

  it('move 10 はチェックポイント（index 1）', () => {
    // 区間1のノルマは400（区間スコアで判定）
    const result = checkSurvivalQuota(10, 400, DEFAULT_QUOTA_TABLE);
    expect(result.isCheckpoint).toBe(true);
    expect(result.checkpointIndex).toBe(1);
    expect(result.quotaMet).toBe(true);
  });

  it('move 3 はチェックポイントではない', () => {
    const result = checkSurvivalQuota(3, 100, DEFAULT_QUOTA_TABLE);
    expect(result.isCheckpoint).toBe(false);
  });

  it('区間スコアがノルマ以上ならquotaMet=true', () => {
    // checkpoint 0: quota = 300, segmentScore = 300
    const result = checkSurvivalQuota(5, 300, DEFAULT_QUOTA_TABLE);
    expect(result.quotaMet).toBe(true);
  });

  it('区間スコアがノルマ超過でもquotaMet=true', () => {
    const result = checkSurvivalQuota(5, 500, DEFAULT_QUOTA_TABLE);
    expect(result.quotaMet).toBe(true);
  });

  it('区間スコアがノルマ未達ならquotaMet=false', () => {
    // checkpoint 0: quota = 300, segmentScore = 299
    const result = checkSurvivalQuota(5, 299, DEFAULT_QUOTA_TABLE);
    expect(result.isCheckpoint).toBe(true);
    expect(result.quotaMet).toBe(false);
  });

  it('5の倍数でないmoveはチェックポイントではない', () => {
    for (const move of [1, 2, 3, 4, 6, 7, 8, 9, 11]) {
      const result = checkSurvivalQuota(move, 9999, DEFAULT_QUOTA_TABLE);
      expect(result.isCheckpoint).toBe(false);
    }
  });
});
