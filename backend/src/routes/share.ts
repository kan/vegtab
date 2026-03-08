import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';

export const shareRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// GET /s/:seedId - Share URL endpoint
// Returns OGP for crawlers, app intro page for browsers
shareRoutes.get('/:seedId', async (c) => {
  const seedId = c.req.param('seedId');
  const ua = c.req.header('User-Agent') ?? '';

  // Look up seed
  const seed = await c.env.DB.prepare(
    'SELECT id, seed_value, share_code, is_daily, daily_date FROM puzzle_seeds WHERE id = ? OR share_code = ?'
  ).bind(seedId, seedId.toUpperCase()).first<{
    id: string; seed_value: string; share_code: string; is_daily: number; daily_date: string | null;
  }>();

  if (!seed) {
    return c.html('<html><body><h1>Seed not found</h1></body></html>', 404);
  }

  // Get top score for this seed
  const topScore = await c.env.DB.prepare(
    `SELECT MAX(score) as best_score FROM play_scores
     WHERE seed_id = ? AND mode = 'limited' AND used_brought_items = 0 AND is_trial = 0`
  ).bind(seed.id).first<{ best_score: number | null }>();

  const title = seed.is_daily
    ? `Tomado Daily Puzzle - ${seed.daily_date}`
    : `Tomado Puzzle - ${seed.share_code}`;
  const description = topScore?.best_score
    ? `Top score: ${topScore.best_score} points. Can you beat it?`
    : 'Try this puzzle and compete for the high score!';

  const isCrawler = /bot|crawl|spider|facebook|twitter|slack|discord|telegram|line|whatsapp/i.test(ua);

  if (isCrawler) {
    // Return OGP meta tags for SNS preview
    return c.html(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://tomado.app/s/${seed.share_code}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <title>${title}</title>
</head>
<body></body>
</html>`);
  }

  // For browsers: app intro page with deep link attempt
  const deepLink = `tomado://puzzle/${seed.id}`;
  return c.html(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 480px; margin: 40px auto; padding: 0 20px; text-align: center; }
    h1 { font-size: 1.5rem; }
    .code { font-size: 2rem; font-weight: bold; letter-spacing: 0.2em; margin: 20px 0; }
    .score { color: #666; margin: 10px 0; }
    .btn { display: inline-block; padding: 12px 32px; background: #4CAF50; color: white; text-decoration: none; border-radius: 8px; margin: 10px; }
  </style>
</head>
<body>
  <h1>Tomado Puzzle</h1>
  <div class="code">${seed.share_code}</div>
  <p class="score">${description}</p>
  <a class="btn" href="${deepLink}">Open in App</a>
  <p style="margin-top: 40px; color: #999; font-size: 0.9rem;">
    Don't have the app? Download it from the store.
  </p>
  <script>
    // Try deep link, fallback stays on page
    setTimeout(() => { window.location.href = "${deepLink}"; }, 100);
  </script>
</body>
</html>`);
});
