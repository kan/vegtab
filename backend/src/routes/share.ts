import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { generateOgpSvg } from '../lib/qr';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const shareRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// GET /s/:seedId/ogp.svg - Dynamic OGP image with QR code
shareRoutes.get('/:seedId/ogp.svg', async (c) => {
  const seedId = c.req.param('seedId');

  const seed = await c.env.DB.prepare(
    'SELECT id, seed_value, share_code, is_daily, daily_date FROM puzzle_seeds WHERE id = ? OR share_code = ?'
  ).bind(seedId, seedId.toUpperCase()).first<{
    id: string; seed_value: string; share_code: string; is_daily: number; daily_date: string | null;
  }>();

  if (!seed) {
    return c.text('Not found', 404);
  }

  const topScore = await c.env.DB.prepare(
    `SELECT MAX(score) as best_score FROM play_scores
     WHERE seed_id = ? AND mode = 'limited' AND used_brought_items = 0 AND is_trial = 0`
  ).bind(seed.id).first<{ best_score: number | null }>();

  const description = topScore?.best_score
    ? `Top score: ${topScore.best_score} points`
    : 'Try this puzzle!';

  const shareUrl = `https://tomado.app/s/${seed.share_code}`;
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

  const seed = await c.env.DB.prepare(
    'SELECT id, seed_value, share_code, is_daily, daily_date FROM puzzle_seeds WHERE id = ? OR share_code = ?'
  ).bind(seedId, seedId.toUpperCase()).first<{
    id: string; seed_value: string; share_code: string; is_daily: number; daily_date: string | null;
  }>();

  if (!seed) {
    return c.html('<html><body><h1>Seed not found</h1></body></html>', 404);
  }

  const topScore = await c.env.DB.prepare(
    `SELECT MAX(score) as best_score FROM play_scores
     WHERE seed_id = ? AND mode = 'limited' AND used_brought_items = 0 AND is_trial = 0`
  ).bind(seed.id).first<{ best_score: number | null }>();

  const title = escapeHtml(seed.is_daily
    ? `Tomado Daily Puzzle - ${seed.daily_date}`
    : `Tomado Puzzle - ${seed.share_code}`);
  const description = escapeHtml(topScore?.best_score
    ? `Top score: ${topScore.best_score} points. Can you beat it?`
    : 'Try this puzzle and compete for the high score!');
  const shareCode = escapeHtml(seed.share_code);
  const ogpImageUrl = `https://tomado.app/s/${shareCode}/ogp.svg`;

  const isCrawler = /bot|crawl|spider|facebook|twitter|slack|discord|telegram|line|whatsapp/i.test(ua);

  if (isCrawler) {
    return c.html(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://tomado.app/s/${shareCode}">
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

  // For browsers: redirect to SPA
  return c.html(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta property="og:title" content="${title}">
  <meta property="og:image" content="${ogpImageUrl}">
  <meta property="og:description" content="${description}">
  <title>${title}</title>
  <script>window.location.replace('/s/${shareCode}');</script>
</head>
<body></body>
</html>`);
});
