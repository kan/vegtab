import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { generateOgpSvg } from '../lib/qr';
import { getBaseUrl } from '../lib/env';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

interface SeedRow {
  id: string; seed_value: string; share_code: string; is_daily: number; daily_date: string | null;
}

async function lookupSeedWithTopScore(db: D1Database, seedId: string) {
  const seed = await db.prepare(
    'SELECT id, seed_value, share_code, is_daily, daily_date FROM puzzle_seeds WHERE id = ? OR share_code = ?'
  ).bind(seedId, seedId.toUpperCase()).first<SeedRow>();
  if (!seed) return null;

  const topScore = await db.prepare(
    `SELECT MAX(score) as best_score FROM play_scores
     WHERE seed_id = ? AND mode = 'limited' AND used_brought_items = 0 AND is_trial = 0`
  ).bind(seed.id).first<{ best_score: number | null }>();

  return { seed, bestScore: topScore?.best_score ?? null };
}

export const shareRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// GET /s/:seedId/ogp.svg - Dynamic OGP image with QR code
shareRoutes.get('/:seedId/ogp.svg', async (c) => {
  const seedId = c.req.param('seedId');
  const result = await lookupSeedWithTopScore(c.env.DB, seedId);

  if (!result) {
    return c.text('Not found', 404);
  }

  const { seed, bestScore } = result;
  const description = bestScore
    ? `Top score: ${bestScore} points`
    : 'Try this puzzle!';

  const baseUrl = getBaseUrl(c.env);
  const shareUrl = `${baseUrl}/s/${seed.share_code}`;
  const svg = generateOgpSvg(seed.share_code, shareUrl, description);

  return c.body(svg, 200, {
    'Content-Type': 'image/svg+xml',
    'Cache-Control': 'public, max-age=3600',
  });
});

// GET /s/:seedId - Share URL endpoint
shareRoutes.get('/:seedId', async (c) => {
  const seedId = c.req.param('seedId');
  const ua = c.req.header('User-Agent') ?? '';

  const result = await lookupSeedWithTopScore(c.env.DB, seedId);

  if (!result) {
    return c.html('<html><body><h1>Seed not found</h1></body></html>', 404);
  }

  const { seed, bestScore } = result;
  const title = escapeHtml(seed.is_daily
    ? `Tomado Daily Puzzle - ${seed.daily_date}`
    : `Tomado Puzzle - ${seed.share_code}`);
  const description = escapeHtml(bestScore
    ? `Top score: ${bestScore} points. Can you beat it?`
    : 'Try this puzzle and compete for the high score!');
  const shareCode = escapeHtml(seed.share_code);
  const baseUrl = getBaseUrl(c.env);
  const ogpImageUrl = `${baseUrl}/s/${shareCode}/ogp.svg`;

  const isCrawler = /bot|crawl|spider|facebook|twitter|slack|discord|telegram|line|whatsapp/i.test(ua);

  if (isCrawler) {
    return c.html(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${baseUrl}/s/${shareCode}">
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
  return c.redirect(`${baseUrl}/puzzle/${encodeURIComponent(seed.seed_value)}`, 302);
});
