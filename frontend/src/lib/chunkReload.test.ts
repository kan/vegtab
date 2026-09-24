import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isChunkLoadError, reloadOnChunkLoadError, clearChunkReloadMark } from './chunkReload';

function stubSessionStorage(opts: { throwOnSet?: boolean } = {}) {
  const data = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (opts.throwOnSet) throw new Error('SecurityError');
      data.set(k, v);
    },
    removeItem: (k: string) => { data.delete(k); },
  });
}

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://vegtab.app/assets/PuzzleView-abc.js',
    'error loading dynamically imported module: https://vegtab.app/assets/PuzzleView-abc.js',
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

describe('reloadOnChunkLoadError', () => {
  const chunkError = new Error('Failed to fetch dynamically imported module: /assets/x.js');
  let assign: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.unstubAllGlobals();
    stubSessionStorage();
    assign = vi.fn();
    vi.stubGlobal('location', { assign });
  });

  it('チャンクの読み込み失敗なら遷移先を読み込み直す', () => {
    reloadOnChunkLoadError(chunkError, '/puzzle/1');
    expect(assign).toHaveBeenCalledWith('/puzzle/1');
  });

  it('同じ遷移先で 2 回目に失敗したら読み込み直さない（無限リロードを避ける）', () => {
    reloadOnChunkLoadError(chunkError, '/puzzle/1');
    reloadOnChunkLoadError(chunkError, '/puzzle/1');
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('遷移に成功して記録を消せば、次の失敗でまた読み込み直す', () => {
    reloadOnChunkLoadError(chunkError, '/puzzle/1');
    clearChunkReloadMark();
    reloadOnChunkLoadError(chunkError, '/puzzle/1');
    expect(assign).toHaveBeenCalledTimes(2);
  });

  it('チャンク以外のエラーでは何もしない', () => {
    reloadOnChunkLoadError(new Error('boom'), '/puzzle/1');
    expect(assign).not.toHaveBeenCalled();
  });

  it('sessionStorage に書けない環境では、繰り返しを止められないので読み込み直さない', () => {
    stubSessionStorage({ throwOnSet: true });
    reloadOnChunkLoadError(chunkError, '/puzzle/1');
    expect(assign).not.toHaveBeenCalled();
  });
});
