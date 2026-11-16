import type { Bindings } from './types';
import { matchPath } from '../core/path';

/** The route tables of the Worker (src/worker/main.ts), matched by hand as in TAKO-SEN and NYORO-RIN */

export interface RouteRequest {
  request: Request;
  env: Bindings;
  url: URL;
  /** The `:name` segments of the path, decoded */
  params: Record<string, string>;
}

/** A request with the kan-game.app ID of its cookie (main.ts checks it before the account routes) */
export interface AccountRequest extends RouteRequest {
  accountId: string;
}

export interface Route<R extends RouteRequest = RouteRequest> {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  handler: (req: R) => Promise<Response> | Response;
}

/**
 * The first route of `routes` for the method and path, in the order listed, with its params
 * (src/core/path.ts, the screen's rule too). HEAD takes the GET routes (main.ts drops the body)
 */
export function matchRoute<R extends RouteRequest>(
  routes: readonly Route<R>[], method: string, pathname: string,
): { route: Route<R>; params: Record<string, string> } | undefined {
  const wanted = method === 'HEAD' ? 'GET' : method;
  for (const route of routes) {
    if (route.method !== wanted) continue;
    const params = matchPath(route.path, pathname);
    if (params) return { route, params };
  }
  return undefined;
}
