import type { Route, RouteRequest } from '../router';
import { html, redirect, text } from '../lib/http';
import { generateOgpSvg } from '../lib/qr';
import { getBaseUrl } from '../lib/env';
import { MODE } from '../lib/mode';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

interface SeedRow {
  id: string; seed_value: string; share_code: string; is_daily: number; daily_date: string | null;
}

/** The seed with its top record: the fewest moves among cleared runs (the ranking's #1 criterion) */
interface SeedWithTopRow extends SeedRow {
  fewest_cleared_moves: number | null;
}

async function lookupSeedWithTopScore(db: D1Database, seedId: string) {
  const row = await db.prepare(
    `SELECT s.id, s.seed_value, s.share_code, s.is_daily, s.daily_date,
            (SELECT MIN(p.move_count) FROM play_scores p
             WHERE p.seed_id = s.id AND p.mode = ? AND p.is_cleared = 1) as fewest_cleared_moves
     FROM puzzle_seeds s
     WHERE s.id = ? OR s.share_code = ?`
  ).bind(MODE, seedId, seedId.toUpperCase()).first<SeedWithTopRow>();

  if (!row) return null;

  const { fewest_cleared_moves, ...seed } = row;
  return { seed, fewestClearedMoves: fewest_cleared_moves };
}

function buildDescription(fewestClearedMoves: number | null): string {
  return fewestClearedMoves != null ? `Clear: ${fewestClearedMoves} moves` : 'Try this puzzle!';
}

// GET /s/:seedId/ogp.svg - Dynamic OGP image with QR code
async function getOgpImage({ env, params }: RouteRequest): Promise<Response> {
  const result = await lookupSeedWithTopScore(env.DB, params.seedId);

  if (!result) {
    return text('Not found', 404);
  }

  const { seed, fewestClearedMoves } = result;
  const description = buildDescription(fewestClearedMoves);

  const baseUrl = getBaseUrl(env);
  const shareUrl = `${baseUrl}/s/${seed.share_code}`;
  const svg = generateOgpSvg(seed.share_code, shareUrl, description);

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

// GET /s/:seedId - Share URL endpoint
async function getSharePage({ request, env, params }: RouteRequest): Promise<Response> {
  const ua = request.headers.get('User-Agent') ?? '';

  const result = await lookupSeedWithTopScore(env.DB, params.seedId);

  if (!result) {
    return html('<html><body><h1>Seed not found</h1></body></html>', 404);
  }

  const { seed, fewestClearedMoves } = result;
  const title = escapeHtml(seed.is_daily
    ? `Vege-Table Daily Puzzle - ${seed.daily_date}`
    : `Vege-Table Puzzle - ${seed.share_code}`);
  const description = escapeHtml(
    buildDescription(fewestClearedMoves)
      + (fewestClearedMoves != null ? '. Can you beat it?' : '')
  );
  const shareCode = seed.share_code;
  const safeShareCode = escapeHtml(shareCode);
  const baseUrl = getBaseUrl(env);
  const ogpImageUrl = `${baseUrl}/s/${encodeURIComponent(shareCode)}/ogp.svg`;

  const isCrawler = /bot|crawl|spider|facebook|twitter|slack|discord|telegram|Line\/|whatsapp/i.test(ua);

  if (isCrawler) {
    return html(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${baseUrl}/s/${safeShareCode}">
  <meta property="og:image" content="${ogpImageUrl}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${ogpImageUrl}">
  <title>${title}</title>
</head>
<body></body>
</html>`);
  }

  // For browsers: redirect to puzzle page on frontend origin
  return redirect(`${baseUrl}/puzzle/${encodeURIComponent(seed.seed_value)}`, 302);
}

/** Open to anyone: share links and their preview images */
export const shareRoutes: Route[] = [
  { method: 'GET', path: '/s/:seedId/ogp.svg', handler: getOgpImage },
  { method: 'GET', path: '/s/:seedId', handler: getSharePage },
];
