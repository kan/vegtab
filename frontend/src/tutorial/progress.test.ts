import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isTutorialFirstVisit, markTutorialSeen } from './progress';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
    data,
  };
}

describe('チュートリアルの既読', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  describe('ストレージが使えるとき', () => {
    let storage: ReturnType<typeof memoryStorage>;
    beforeEach(() => {
      storage = memoryStorage();
      vi.stubGlobal('localStorage', storage);
    });

    it('記録がなければ初回として扱い、既読にした後は初回にしない', () => {
      expect(isTutorialFirstVisit()).toBe(true);
      markTutorialSeen();
      expect(isTutorialFirstVisit()).toBe(false);
    });

    it('紙芝居の版（vegtab_tutorial）の記録は引き継がない', () => {
      storage.setItem('vegtab_tutorial', JSON.stringify({ completed: true, lastStep: 17, version: 1 }));
      expect(isTutorialFirstVisit()).toBe(true);
    });

    it('既読にするとき、紙芝居の版の記録を消し、ほかのキーには触れない', () => {
      storage.setItem('vegtab_tutorial', 'old');
      storage.setItem('vegtab_play_time', '1');
      markTutorialSeen();
      expect([...storage.data.keys()].sort()).toEqual(['vegtab_play_time', 'vegtab_tutorial_v2']);
    });
  });

  it('ストレージが例外を投げても止まらず、案内は出さない', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    expect(isTutorialFirstVisit()).toBe(false);
    expect(() => markTutorialSeen()).not.toThrow();
  });
});
