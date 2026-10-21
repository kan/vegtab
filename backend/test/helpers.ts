import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { vi } from 'vitest';
import { initializeGame, processAction, BOARD_SIZE, type Action, type GameState } from '@vegtab/engine';
import worker from '../src/index';
import type { Bindings } from '../src/types';
import { generateDailySeed, todayJST } from '../src/lib/date';
import { issueTokens } from '../src/lib/refresh-tokens';
import { createTestIdIssuer } from './kan-game/test-id-cookie';
import { createFakeIdPlatform, type FakeIdPlatform } from './kan-game/fake-id-platform';

/** Signs the test cookies; its key is the only one in ID_PUBLIC_KEYS (see call) */
export const idIssuer = await createTestIdIssuer({ issuer: 'test.kan-game.app', cookieName: '__Secure-kgtest_id' });

/** The ID platform's RPC (the ID binding). Reset by resetDb */
export let idPlatform: FakeIdPlatform = createFakeIdPlatform();

/** The origin the API accepts in the tests (ALLOWED_ORIGINS at the top of wrangler.jsonc) */
export const ORIGIN = 'http://localhost:5173';

/**
 * Calls the Worker with the test's ID settings: the fake ID platform as the ID binding and the test
 * issuer's key. `overrides` replaces more of the env (e.g. LEGACY_HOST, or the ID binding's fetch)
 */
export async function call(input: string, init?: RequestInit, overrides: Partial<Bindings> = {}): Promise<Response> {
  const request = new Request(input, init);
  // A test ID's cookie is signed now, by the clock the test may have faked (useFakeToday): a cookie
  // signed by the real clock is in the future of a faked day, and refused
  const testId = /^test-id:(.+)$/.exec(request.headers.get('Cookie') ?? '');
  if (testId) request.headers.set('Cookie', await idIssuer.cookie(testId[1]));
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, { ...testEnv(), ...overrides }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/** The env the tests' Worker runs with: the fake ID platform and the test issuer's key */
export function testEnv(): Bindings {
  return {
    ...(env as unknown as Bindings),
    ID: idPlatform.rpc as unknown as Bindings['ID'],
    ID_PUBLIC_KEYS: idIssuer.publicKeys,
    ID_ISSUER: idIssuer.issuer,
    ID_COOKIE_NAME: idIssuer.cookieName,
  };
}

/** Empty every table and the ranking cache so each test starts clean (the schema comes from test/apply-migrations.ts) */
export async function resetDb() {
  for (const table of [
    'achievements', 'play_scores', 'puzzle_seeds', 'user_devices', 'push_subscriptions', 'refresh_token_families',
    'transfer_codes', 'users', 'profiles', 'deleted_accounts', 'legacy_handoffs', 'legacy_claims',
  ]) {
    await env.DB.exec(`DELETE FROM ${table}`);
  }
  for (const { name } of (await env.KV.list({ prefix: 'ranking:' })).keys) await env.KV.delete(name);
  idPlatform = createFakeIdPlatform();
}

/**
 * A new kan-game.app ID. `accessToken` stands for its cookie, for authHeader: `call` signs it when
 * the request is made. With `name`, the ID has registered the name and consented to publish it here
 * (it is ranked)
 */
export async function registerUser(options: { name?: string } = {}): Promise<{ userId: string; accessToken: string }> {
  const userId = crypto.randomUUID();
  if (options.name) {
    idPlatform.setName(userId, options.name);
    await env.DB.prepare('INSERT INTO profiles (account_id, display_name, consented_at) VALUES (?, ?, ?)')
      .bind(userId, options.name, Date.now()).run();
  }
  return { userId, accessToken: `test-id:${userId}` };
}

/** The headers of a request with the ID's cookie, from the allowed origin */
export function authHeader(cookie: string) {
  return { Cookie: cookie, Origin: ORIGIN };
}

/** An old vegtab.app account (users row) with its Bearer tokens, as the old screen holds them */
export async function createLegacyUser(displayName: string | null = null) {
  const userId = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users (id, device_id, display_name) VALUES (?, ?, ?)')
    .bind(userId, crypto.randomUUID(), displayName).run();
  const tokens = await issueTokens(env.DB, (env as unknown as Bindings).JWT_SECRET, userId);
  return { userId, ...tokens };
}

/**
 * Build a replay log of `moves` valid swaps for the daily seed of `date` (the first valid swap each time).
 * Every valid swap adds points, so a longer replay always has a higher score.
 * `moves = Infinity` plays until the game is over.
 */
export function buildReplay(moves: number, date = todayJST()): { replayLog: Action[]; state: GameState } {
  let state = initializeGame(generateDailySeed(date));
  const replayLog: Action[] = [];
  while (replayLog.length < moves && !state.isGameOver) {
    const before = state;
    search: for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        for (const dir of ['right', 'down'] as const) {
          const action: Action = { type: 'swap', pos: { row, col }, dir };
          const next = processAction(state, action);
          if (next !== state) {
            replayLog.push(action);
            state = next;
            break search;
          }
        }
      }
    }
    if (state === before) break;
  }
  if (Number.isFinite(moves) && replayLog.length < moves) {
    throw new Error(`no valid swap after ${replayLog.length} moves`);
  }
  return { replayLog, state };
}

/**
 * A day whose daily seed buildReplay(Infinity) clears: 74 moves, max chain 5 (boards of #106).
 * Short replays cannot clear a board, so tests that need a cleared run fix the clock to this day.
 */
export const CLEARED_DATE = '2026-09-03';

let clearedRunCache: ReturnType<typeof buildReplay> | undefined;

/** The replay that clears CLEARED_DATE's board. It is the same for every test, so it is built once (do not mutate it) */
export function clearedRun(): ReturnType<typeof buildReplay> {
  return clearedRunCache ??= buildReplay(Infinity, CLEARED_DATE);
}

/** Fix the server clock to noon JST of `date` (undo with vi.useRealTimers()) */
export function useFakeToday(date: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${date}T12:00:00+09:00`));
}

export function submitScore(token: string, body: Record<string, unknown>) {
  return call('http://localhost/api/scores', {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Submit a replay of `moves` valid swaps for today's seed; returns the response and the expected final state */
export async function submitReplay(token: string, moves: number, extra: Record<string, unknown> = {}) {
  const { replayLog, state } = buildReplay(moves);
  const res = await submitScore(token, { date: todayJST(), mode: 'clear', replayLog, ...extra });
  return { res, state };
}

/** Dummy Web Push subscription keys (format-valid, not tied to a real browser) */
export const PUSH_KEYS = {
  p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8p8REfWIA',
  auth: 'tBHItJI5svbpC7sc9d8MqQ',
};

export function subscribePush(token: string | null, endpoint: string) {
  return call('http://localhost/api/push/subscribe', {
    method: 'POST',
    headers: { ...(token ? authHeader(token) : { Origin: ORIGIN }), 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint, keys: PUSH_KEYS }),
  });
}

/** Get (and auto-create) today's daily seed id */
export async function getTodaySeedId(token: string): Promise<string> {
  const res = await call('http://localhost/api/seeds/daily', { headers: authHeader(token) });
  const data = await res.json() as { seedId: string };
  return data.seedId;
}

/**
 * Insert a play_scores row directly, for results a short replay cannot produce (e.g. cleared runs).
 * `mode` defaults to clear; pass a removed mode (sprint / survival / cascade) to stand in for rows left in D1.
 * Returns the row id.
 */
export async function insertPlayScore(row: {
  userId: string; seedId: string; mode?: string; moveCount: number; score: number; isCleared?: boolean;
  clearTimeMs?: number | null; maxChain?: number; cascadePoints?: number; replayLogKey?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO play_scores (id, user_id, seed_id, mode, move_count, score, is_cleared, clear_time_ms, max_chain, cascade_points, replay_log_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, row.userId, row.seedId, row.mode ?? 'clear', row.moveCount, row.score, row.isCleared ? 1 : 0,
    row.clearTimeMs ?? null, row.maxChain ?? 0, row.cascadePoints ?? 0, row.replayLogKey ?? null,
  ).run();
  return id;
}
