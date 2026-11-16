import { reactive, shallowRef, type Component, type ShallowRef } from 'vue';
import { matchPath } from '../../core/path';

/**
 * The screen's own small router, in place of vue-router (#125): a table of paths, the History API,
 * and lazily loaded screens. The URLs stay as they were (/puzzle/:seed, /replay/:scoreId, /s/:code).
 *
 * - push / replace load the screen first, then change the URL and the route together, so a screen
 *   being left never sees the next route's params
 * - popstate opens the screen of the URL. An entry with the same path (PuzzleView adds one to hold
 *   the back gesture during play) changes nothing
 * - back() leaves the app only when there is no entry of the app to go back to: it opens / instead
 */

export interface RouteMeta {
  /** The footer menu is hidden (the tutorial, the prototypes) */
  hideNav?: boolean;
}

export interface RouteDef {
  /** Segments, `:name` taking one non-empty segment (src/core/path.ts) */
  path: string;
  load: () => Promise<{ default: Component }>;
  meta?: RouteMeta;
}

export interface RouteState {
  path: string;
  /** The path with its query, as given to push */
  fullPath: string;
  params: Record<string, string>;
  meta: RouteMeta;
}

/** The parts of window the router uses (tests pass their own) */
export interface RouterWindow {
  location: { pathname: string; search: string; hash: string };
  history: {
    readonly state: unknown;
    pushState(state: unknown, unused: string, url?: string): void;
    replaceState(state: unknown, unused: string, url?: string): void;
    back(): void;
  };
  addEventListener(type: 'popstate', listener: () => void): void;
}

export interface Router {
  route: RouteState;
  /** The screen of the route; null for a path no route takes (as vue-router, an empty screen) */
  component: ShallowRef<Component | null>;
  push(path: string): Promise<void>;
  replace(path: string): Promise<void>;
  back(): void;
  /**
   * Adds an entry with the same URL, which popstate passes over (PuzzleView holds the back gesture
   * during play with it)
   */
  pushSameEntry(): void;
  /** Opens the screen of the current URL and follows popstate from then on */
  start(): Promise<void>;
  /** The path being opened while its screen loads (main.ts's vite:preloadError reloads it) */
  pendingPath(): string | null;
}

/** The first route for the path, with its params (src/core/path.ts, the Worker's rule too) */
export function matchRoute(
  routes: readonly RouteDef[], path: string,
): { def: RouteDef; params: Record<string, string> } | undefined {
  for (const def of routes) {
    const params = matchPath(def.path, path);
    if (params) return { def, params };
  }
  return undefined;
}

/** history.state of the app's entries: how many entries of the app are before this one */
interface AppState {
  appDepth?: number;
}

function depthOf(state: unknown): number {
  const depth = (state as AppState | null)?.appDepth;
  return typeof depth === 'number' ? depth : 0;
}

export function createRouter(
  routes: readonly RouteDef[],
  win: RouterWindow,
  /** A screen failed to load (a stale chunk after a deploy is reloaded here: lib/staleChunk.ts) */
  onLoadError: (error: unknown, fullPath: string) => void,
): Router {
  const route = reactive<RouteState>({ path: '', fullPath: '', params: {}, meta: {} });
  const component = shallowRef<Component | null>(null);
  let pending: string | null = null;
  /** Only the latest navigation lands: an earlier one whose screen loads later is dropped */
  let sequence = 0;

  async function open(fullPath: string, update: (() => void) | null): Promise<void> {
    const seq = ++sequence;
    const path = fullPath.split(/[?#]/)[0];
    const matched = matchRoute(routes, path);
    pending = fullPath;
    let loaded: Component | null = null;
    try {
      loaded = matched ? (await matched.def.load()).default : null;
    } catch (error) {
      if (seq === sequence) pending = null;
      onLoadError(error, fullPath);
      return;
    }
    if (seq !== sequence) return;
    pending = null;
    update?.();
    // Together, in one tick: the screen being left is unmounted before its watchers see the new params
    route.path = path;
    route.fullPath = fullPath;
    route.params = matched?.params ?? {};
    route.meta = matched?.def.meta ?? {};
    component.value = loaded;
  }

  /** The state of an entry `offset` entries after the current one (1 for a new entry, 0 to replace it) */
  function stateAt(offset: number): AppState {
    return { appDepth: depthOf(win.history.state) + offset };
  }

  /** Drops a navigation still loading its screen: the user has stayed (or gone back) here */
  function cancelPending(): void {
    sequence++;
    pending = null;
  }

  /** To the current path, nothing is added (as vue-router: tapping HOME on HOME stacks no entries) */
  function push(path: string): Promise<void> {
    if (path === route.fullPath) {
      cancelPending();
      return Promise.resolve();
    }
    return open(path, () => win.history.pushState(stateAt(1), '', path));
  }

  function replace(path: string): Promise<void> {
    return open(path, () => win.history.replaceState(stateAt(0), '', path));
  }

  return {
    route,
    component,
    push,
    replace,
    back() {
      if (depthOf(win.history.state) > 0) win.history.back();
      else void replace('/');
    },
    pushSameEntry() {
      win.history.pushState(stateAt(1), '');
    },
    start() {
      win.addEventListener('popstate', () => {
        // Back to an entry of the current screen: a navigation still loading would push past it
        if (win.location.pathname === route.path) {
          cancelPending();
          return;
        }
        void open(win.location.pathname + win.location.search, null);
      });
      const { pathname, search } = win.location;
      return open(pathname + search, null);
    },
    pendingPath: () => pending,
  };
}
