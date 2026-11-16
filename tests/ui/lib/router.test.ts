import { describe, it, expect, vi } from 'vitest';
import { defineComponent, nextTick, watch } from 'vue';
import { createRouter, matchRoute, type RouteDef, type RouterWindow } from '@/lib/router';

const Home = defineComponent({ name: 'Home', render: () => null });
const Puzzle = defineComponent({ name: 'Puzzle', render: () => null });
const Replay = defineComponent({ name: 'Replay', render: () => null });

const ROUTES: RouteDef[] = [
  { path: '/', load: async () => ({ default: Home }) },
  { path: '/puzzle/:seed', load: async () => ({ default: Puzzle }) },
  { path: '/replay/:scoreId', load: async () => ({ default: Replay }) },
  { path: '/tutorial', load: async () => ({ default: Home }), meta: { hideNav: true } },
];

/** A window whose history is a list of entries, as a browser keeps them */
function fakeWindow(start: string) {
  const entries: { url: string; state: unknown }[] = [{ url: start, state: null }];
  let index = 0;
  let onPopState: (() => void) | undefined;
  const current = () => entries[index];
  const win: RouterWindow = {
    location: {
      get pathname() { return current().url.split('?')[0]; },
      get search() { const q = current().url.indexOf('?'); return q < 0 ? '' : current().url.slice(q); },
      hash: '',
    },
    history: {
      get state() { return current().state; },
      pushState(state, _unused, url) {
        entries.splice(index + 1, entries.length, { url: url ?? current().url, state });
        index++;
      },
      replaceState(state, _unused, url) {
        entries[index] = { url: url ?? current().url, state };
      },
      back() {
        if (index === 0) return;
        index--;
        onPopState?.();
      },
    },
    addEventListener(_type, listener) { onPopState = listener; },
  };
  return { win, entries, index: () => index };
}

describe('matchRoute', () => {
  it('引数のセグメントを取り出し、デコードする', () => {
    expect(matchRoute(ROUTES, '/puzzle/12')?.params).toEqual({ seed: '12' });
    expect(matchRoute(ROUTES, '/replay/a%20b')?.params).toEqual({ scoreId: 'a b' });
    expect(matchRoute(ROUTES, '/replay/%E0%A4%A')?.params).toEqual({ scoreId: '%E0%A4%A' });
  });

  it('空のセグメント、末尾のスラッシュ、無いパスは一致させない', () => {
    expect(matchRoute(ROUTES, '/puzzle/')).toBeUndefined();
    expect(matchRoute(ROUTES, '/tutorial/')).toBeUndefined();
    expect(matchRoute(ROUTES, '/nope')).toBeUndefined();
  });
});

describe('createRouter', () => {
  it('start は今の URL の画面を開く', async () => {
    const { win } = fakeWindow('/puzzle/7?x=1');
    const router = createRouter(ROUTES, win, vi.fn());
    await router.start();
    expect(router.route).toMatchObject({ path: '/puzzle/7', fullPath: '/puzzle/7?x=1', params: { seed: '7' } });
    expect(router.component.value).toBe(Puzzle);
  });

  it('push は履歴を足し、replace は置き換える。meta も移る', async () => {
    const { win, entries } = fakeWindow('/');
    const router = createRouter(ROUTES, win, vi.fn());
    await router.start();
    await router.push('/tutorial');
    expect(router.route.meta).toEqual({ hideNav: true });
    await router.replace('/puzzle/3');
    expect(entries.map(e => e.url)).toEqual(['/', '/puzzle/3']);
    expect(router.route.meta).toEqual({});
  });

  it('今と同じパスへの push は履歴を積まない', async () => {
    const { win, entries } = fakeWindow('/');
    const router = createRouter(ROUTES, win, vi.fn());
    await router.start();
    await router.push('/puzzle/1');
    await router.push('/puzzle/1');
    expect(entries.map(e => e.url)).toEqual(['/', '/puzzle/1']);
  });

  it('画面の読み込み中に今の画面の項目へ戻ったら、その遷移を取り消す', async () => {
    const { win, entries } = fakeWindow('/');
    let release!: () => void;
    const slow: RouteDef = {
      path: '/slow',
      load: () => new Promise(resolve => { release = () => resolve({ default: Replay }); }),
    };
    const router = createRouter([...ROUTES, slow], win, vi.fn());
    await router.start();
    await router.push('/puzzle/1');
    router.pushSameEntry();
    const leaving = router.push('/slow');
    win.history.back();
    release();
    await leaving;
    expect(router.route.path).toBe('/puzzle/1');
    expect(entries.map(e => e.url)).toEqual(['/', '/puzzle/1', '/puzzle/1']);
    expect(router.pendingPath()).toBeNull();
  });

  it('無いパスは空の画面にする', async () => {
    const { win } = fakeWindow('/');
    const router = createRouter(ROUTES, win, vi.fn());
    await router.push('/nope');
    expect(router.component.value).toBeNull();
    expect(router.route.params).toEqual({});
  });

  it('戻る操作で前の画面を開き、同じパスの項目（プレイ中の抑止）では何もしない', async () => {
    const { win } = fakeWindow('/');
    const router = createRouter(ROUTES, win, vi.fn());
    await router.start();
    await router.push('/puzzle/1');
    router.pushSameEntry();
    const params = router.route.params;
    win.history.back();
    await nextTick();
    expect(router.route.path).toBe('/puzzle/1');
    expect(router.route.params).toBe(params);
    win.history.back();
    await vi.waitFor(() => expect(router.route.path).toBe('/'));
  });

  it('back はアプリの前の項目が無ければ / を開く（外へ出ない）', async () => {
    const { win, entries } = fakeWindow('/replay/abc');
    const router = createRouter(ROUTES, win, vi.fn());
    await router.start();
    router.back();
    await vi.waitFor(() => expect(router.route.path).toBe('/'));
    expect(entries.map(e => e.url)).toEqual(['/']);
  });

  it('back はアプリの前の項目があれば履歴を戻る', async () => {
    const { win, index } = fakeWindow('/');
    const router = createRouter(ROUTES, win, vi.fn());
    await router.start();
    await router.push('/replay/abc');
    router.back();
    await vi.waitFor(() => expect(router.route.path).toBe('/'));
    expect(index()).toBe(0);
  });

  it('画面の読み込みに失敗したら onLoadError に遷移先を渡し、URL も画面も変えない', async () => {
    const { win, entries } = fakeWindow('/');
    const error = new TypeError('Failed to fetch dynamically imported module');
    const routes: RouteDef[] = [...ROUTES, { path: '/broken', load: () => Promise.reject(error) }];
    const onLoadError = vi.fn();
    const router = createRouter(routes, win, onLoadError);
    await router.start();
    await router.push('/broken?q=1');
    expect(onLoadError).toHaveBeenCalledWith(error, '/broken?q=1');
    expect(entries.map(e => e.url)).toEqual(['/']);
    expect(router.route.path).toBe('/');
    expect(router.pendingPath()).toBeNull();
  });

  it('読み込みの間は pendingPath が遷移先を返し、後の遷移が先に終われば前の遷移は捨てる', async () => {
    const { win } = fakeWindow('/');
    let release!: () => void;
    const slow: RouteDef = {
      path: '/slow',
      load: () => new Promise(resolve => { release = () => resolve({ default: Replay }); }),
    };
    const router = createRouter([...ROUTES, slow], win, vi.fn());
    await router.start();
    const first = router.push('/slow');
    expect(router.pendingPath()).toBe('/slow');
    await router.push('/tutorial');
    release();
    await first;
    expect(router.route.path).toBe('/tutorial');
  });

  it('遷移先の params は、離れる画面の watch に届く前に画面ごと入れ替わる（1 回の更新）', async () => {
    const { win } = fakeWindow('/puzzle/1');
    const router = createRouter(ROUTES, win, vi.fn());
    await router.start();
    const seen: { seed: string | undefined; component: unknown }[] = [];
    watch(() => router.route.params.seed, (seed) => seen.push({ seed, component: router.component.value }));
    await router.push('/');
    await nextTick();
    expect(seen).toEqual([{ seed: undefined, component: Home }]);
  });
});
