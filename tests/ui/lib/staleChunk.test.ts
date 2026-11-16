import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isChunkLoadError, reloadForStaleChunk, shouldReloadForStaleChunk } from '@/lib/staleChunk';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://vegtab.kan-game.app/assets/PuzzleView-abc.js',
    'error loading dynamically imported module: https://vegtab.kan-game.app/assets/PuzzleView-abc.js',
    'Importing a module script failed.',
    'Unable to preload CSS for /assets/PuzzleView-abc.css',
  ])('チャンクの読み込み失敗とみなす: %s', (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  it('それ以外のエラーはみなさない', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false);
  });
});

describe('shouldReloadForStaleChunk', () => {
  it('1 分に 1 回まで読み込み直す', () => {
    const storage = memoryStorage();
    expect(shouldReloadForStaleChunk(storage, true, 1_000_000)).toBe(true);
    expect(shouldReloadForStaleChunk(storage, true, 1_030_000)).toBe(false);
    expect(shouldReloadForStaleChunk(storage, true, 1_061_000)).toBe(true);
  });

  it('オフラインのときと、記録できないときは読み込み直さない', () => {
    expect(shouldReloadForStaleChunk(memoryStorage(), false, 1)).toBe(false);
    const broken = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => undefined,
    };
    expect(shouldReloadForStaleChunk(broken, true, 1)).toBe(false);
  });
});

describe('reloadForStaleChunk', () => {
  let assign: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('sessionStorage', memoryStorage());
    vi.stubGlobal('navigator', { onLine: true });
    assign = vi.fn();
    vi.stubGlobal('location', { assign });
  });

  it('遷移先を読み込み直す。同じ失敗が router と vite:preloadError の両方から届いても 1 回だけ', () => {
    expect(reloadForStaleChunk('/puzzle/1')).toBe(true);
    expect(reloadForStaleChunk('/puzzle/1')).toBe(false);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/puzzle/1');
  });

  it('オフラインでは読み込み直さない', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(reloadForStaleChunk('/puzzle/1')).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it('sessionStorage を読めない環境では読み込み直さない', () => {
    Object.defineProperty(globalThis, 'sessionStorage', { get() { throw new Error('SecurityError'); }, configurable: true });
    expect(reloadForStaleChunk('/puzzle/1')).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });
});
