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

/** モードごとのトップ記録（ランキングの 1 位と同じ基準） */
interface SeedWithScoreRow extends SeedRow {
  mode: string | null;
  best_score: number | null;
  most_moves: number | null;
  fewest_cleared_moves: number | null;
  best_cascade_points: number | null;
}

type TopScores = Partial<Record<'sprint' | 'clear' | 'survival' | 'cascade', number>>;

async function lookupSeedWithTopScores(db: D1Database, seedId: string) {
  const rows = await db.prepare(
    `SELECT s.id, s.seed_value, s.share_code, s.is_daily, s.daily_date,
            p.mode, MAX(p.score) as best_score, MAX(p.move_count) as most_moves,
            MIN(CASE WHEN p.is_cleared = 1 THEN p.move_count END) as fewest_cleared_moves,
            MAX(p.cascade_points) as best_cascade_points
     FROM puzzle_seeds s
     LEFT JOIN play_scores p ON p.seed_id = s.id
     WHERE s.id = ? OR s.share_code = ?
     GROUP BY s.id, s.seed_value, s.share_code, s.is_daily, s.daily_date, p.mode`
  ).bind(seedId, seedId.toUpperCase()).all<SeedWithScoreRow>();

  if (!rows.results || rows.results.length === 0) return null;

  const first = rows.results[0];
  const seed: SeedRow = {
    id: first.id, seed_value: first.seed_value, share_code: first.share_code,
    is_daily: first.is_daily, daily_date: first.daily_date,
  };

  const topScores: TopScores = {};
  for (const row of rows.results) {
    const value = row.mode === 'sprint' ? row.best_score
      : row.mode === 'clear' ? row.fewest_cleared_moves
      : row.mode === 'survival' ? row.most_moves
      : row.mode === 'cascade' ? row.best_cascade_points
      : null;
    if (value != null) topScores[row.mode as keyof TopScores] = value;
  }

  return { seed, topScores };
}

function buildDescription(topScores: TopScores): string {
  const parts: string[] = [];
  if (topScores.sprint != null) parts.push(`Sprint: ${topScores.sprint} pts`);
  if (topScores.clear != null) parts.push(`Clear: ${topScores.clear} moves`);
  if (topScores.survival != null) parts.push(`Survival: ${topScores.survival} moves`);
  if (topScores.cascade != null) parts.push(`Cascade: ${topScores.cascade} CP`);
  return parts.length > 0 ? parts.join(' | ') : 'Try this puzzle!';
}

export const shareRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// GET /s/:seedId/ogp.svg - Dynamic OGP image with QR code
shareRoutes.get('/:seedId/ogp.svg', async (c) => {
  const seedId = c.req.param('seedId');
  const result = await lookupSeedWithTopScores(c.env.DB, seedId);

  if (!result) {
    return c.text('Not found', 404);
  }

  const { seed, topScores } = result;
  const description = buildDescription(topScores);

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

  const result = await lookupSeedWithTopScores(c.env.DB, seedId);

  if (!result) {
    return c.html('<html><body><h1>Seed not found</h1></body></html>', 404);
  }

  const { seed, topScores } = result;
  const title = escapeHtml(seed.is_daily
    ? `Vege-Table Daily Puzzle - ${seed.daily_date}`
    : `Vege-Table Puzzle - ${seed.share_code}`);
  const description = escapeHtml(
    buildDescription(topScores)
      + (Object.keys(topScores).length > 0 ? '. Can you beat it?' : '')
  );
  const shareCode = seed.share_code;
  const safeShareCode = escapeHtml(shareCode);
  const baseUrl = getBaseUrl(c.env);
  const ogpImageUrl = `${baseUrl}/s/${encodeURIComponent(shareCode)}/ogp.svg`;

  const isCrawler = /bot|crawl|spider|facebook|twitter|slack|discord|telegram|Line\/|whatsapp/i.test(ua);

  if (isCrawler) {
    return c.html(`<!DOCTYPE html>
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
  return c.redirect(`${baseUrl}/puzzle/${encodeURIComponent(seed.seed_value)}`, 302);
});
