/**
 * Responses and request bodies of the Worker's routes (src/worker/main.ts). The routes are plain
 * fetch handlers, as in TAKO-SEN and NYORO-RIN; these are the few helpers they share.
 */

export function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return Response.json(body, { status, headers });
}

export function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
}

export function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=UTF-8' } });
}

/** Not Response.redirect: its headers are immutable, and withSecurityHeaders adds to every response */
export function redirect(location: string, status: 301 | 302 = 302): Response {
  return new Response(null, { status, headers: { Location: location } });
}

/**
 * Headers for every response of the Worker's code (/api/*, /s/*). The SPA from Static Assets gets
 * the same ones from public/_headers, which does not apply to responses the Worker makes.
 *
 * - The screen may not be framed by other sites (clickjacking), and nosniff / Referrer-Policy as the
 *   other kan-game.app games
 * - The API is per ID (the cookie), so no cache on the way may keep a response
 * - Environments other than production are kept out of search engines
 */
export function withSecurityHeaders(response: Response, url: URL, environment: string): Response {
  // A response passed on from a fetch (the ID platform's, /api/id/*) has immutable headers
  const res = new Response(response.body, response);
  const headers = res.headers;
  if (!headers.has('Content-Security-Policy')) {
    headers.set('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  }
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (url.pathname.startsWith('/api/')) headers.set('Cache-Control', 'no-store');
  if (environment !== 'production') headers.set('X-Robots-Tag', 'noindex');
  return res;
}

/** A body that is not JSON or not of the route's shape, answered like every other API error (a code) */
function invalidRequest(): Response {
  return json({ error: 'invalid_request' }, 400);
}

/**
 * JSON media types, as Hono's validator matched them (application/json, application/*+json, with
 * parameters). A body of another type is read as {}: every route has required fields, so it is
 * answered invalid_request
 */
const JSON_TYPE = /^application\/([a-z-.]+\+)?json(;\s*[a-zA-Z0-9-]+=([^;]+))*$/i;

/**
 * Reads a JSON body and parses it with the route's parser (lib/validate.ts), or returns the response
 * that refuses it: 400 invalid_request for a body that is not JSON or that `parse` refuses
 * (undefined), and 413 payload_too_large past `limit` bytes (by Content-Length before reading, and
 * by counting while reading when the length is not given)
 */
export async function readJsonBody<T>(
  request: Request, parse: (value: unknown) => T | undefined, limit?: number,
): Promise<T | Response> {
  if (limit !== undefined && !request.headers.has('Transfer-Encoding')) {
    const length = Number(request.headers.get('Content-Length'));
    if (length > limit) return tooLarge();
  }

  let value: unknown = {};
  if (JSON_TYPE.test(request.headers.get('Content-Type') ?? '')) {
    let raw: string;
    try {
      raw = await readText(request, limit);
    } catch (error) {
      if (error instanceof BodyTooLarge) return tooLarge();
      throw error;
    }
    try {
      value = JSON.parse(raw);
    } catch {
      return invalidRequest();
    }
  }
  return parse(value) ?? invalidRequest();
}

function tooLarge(): Response {
  return json({ error: 'payload_too_large' }, 413);
}

class BodyTooLarge extends Error {}

/** The body as text, failing with BodyTooLarge past `limit` bytes (from NYORO-RIN's readLimitedBody) */
async function readText(request: Request, limit?: number): Promise<string> {
  if (!request.body) return '';
  if (limit === undefined) return request.text();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
