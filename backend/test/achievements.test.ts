import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { evaluateAchievements, type ScoreData } from '../src/lib/achievements';
import { resetDb } from './helpers';

const USER = 'user-achievements';

const score = (over: Partial<ScoreData>): ScoreData => ({
  moveCount: 20, isCleared: false, maxChain: 0, generatedItemTypes: [], ...over,
});

/** Insert one play_scores row per day for day numbers [from, to) counted from 2026-01-01 */
async function playDays(from: number, to: number) {
  const stmts = Array.from({ length: to - from }, (_, i) => {
    const day = new Date(Date.UTC(2026, 0, 1 + from + i)).toISOString().slice(0, 10);
    return env.DB.prepare(
      `INSERT INTO play_scores (id, user_id, seed_id, mode, move_count, score, created_at) VALUES (?, ?, ?, 'clear', 1, 1, ?)`
    ).bind(crypto.randomUUID(), USER, `seed-${day}`, `${day} 12:00:00`);
  });
  await env.DB.batch(stmts);
}

/** Run migration 0012 again on the current rows (the test setup already applied it to an empty table) */
async function runMigration0012() {
  const migration = (env as unknown as { TEST_MIGRATIONS: { name: string; queries: string[] }[] })
    .TEST_MIGRATIONS.find(m => m.name.startsWith('0012_'))!;
  for (const q of migration.queries) await env.DB.prepare(q).run();
}

describe('evaluateAchievements: #89 で足した段階', () => {
  beforeEach(resetDb);

  it('手数の実績は手数の段階ごとに解除する（5 手で 5 手クリアまで、3 手で 3 手クリアも）', async () => {
    const five = await evaluateAchievements(env.DB, USER, score({ isCleared: true, moveCount: 5 }));
    expect(five).toEqual(expect.arrayContaining(['clear_first', 'clear_under_10', 'clear_under_7', 'clear_under_5']));
    expect(five).not.toContain('clear_under_3');

    const three = await evaluateAchievements(env.DB, USER, score({ isCleared: true, moveCount: 3 }));
    expect(three).toEqual(['clear_under_3']);
  });

  it('6 手のクリアでは 5 手クリアを、4 手のクリアでは 3 手クリアを解除しない', async () => {
    const six = await evaluateAchievements(env.DB, USER, score({ isCleared: true, moveCount: 6 }));
    expect(six).toContain('clear_under_7');
    expect(six).not.toContain('clear_under_5');

    const four = await evaluateAchievements(env.DB, USER, score({ isCleared: true, moveCount: 4 }));
    expect(four).toEqual(['clear_under_5']);
  });

  it('未クリアのゲームは手数が少なくても手数の実績を解除しない', async () => {
    const got = await evaluateAchievements(env.DB, USER, score({ isCleared: false, moveCount: 2 }));
    expect(got.filter(t => t.startsWith('clear_'))).toEqual([]);
    const { results } = await env.DB.prepare(
      `SELECT achievement_type FROM achievements WHERE user_id = ? AND achievement_type LIKE 'clear_%'`
    ).bind(USER).all();
    expect(results).toEqual([]);
  });

  it('移行で作った行の unlocked_at は ISO 形式', async () => {
    await env.DB.prepare(
      `INSERT INTO achievements (id, user_id, achievement_type, current_value, is_unlocked) VALUES (?, ?, 'clear_under_7', 3, 1)`
    ).bind(crypto.randomUUID(), USER).run();
    await runMigration0012();
    const row = await env.DB.prepare(
      `SELECT unlocked_at FROM achievements WHERE user_id = ? AND achievement_type = 'clear_under_3'`
    ).bind(USER).first<{ unlocked_at: string }>();
    expect(row!.unlocked_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('7 連鎖は 7 連鎖以上で解除し、6 連鎖では解除しない', async () => {
    expect(await evaluateAchievements(env.DB, USER, score({ maxChain: 6 }))).not.toContain('chain_7');
    const got = await evaluateAchievements(env.DB, USER, score({ maxChain: 7 }));
    expect(got).toContain('chain_7');
    expect(got).not.toContain('cascade_chain_10');
  });

  it('マイグレーション 0012 は既存の実績の行に残る記録から、足した 4 種の行を作る', async () => {
    const insert = (user: string, type: string, value: number) => env.DB.prepare(
      `INSERT INTO achievements (id, user_id, achievement_type, current_value, is_unlocked) VALUES (?, ?, ?, ?, 1)`
    ).bind(crypto.randomUUID(), user, type, value);
    await env.DB.batch([
      insert('good', 'clear_under_7', 3), insert('good', 'cascade_chain_3', 9), insert('good', 'play_days_3', 120),
      insert('plain', 'clear_under_7', 6), insert('plain', 'cascade_chain_3', 5), insert('plain', 'play_days_3', 12),
      // 足した実績の行がすでにあれば変えない
      insert('plain', 'chain_7', 8),
    ]);

    await runMigration0012();

    const { results } = await env.DB.prepare(
      `SELECT user_id, achievement_type, current_value, is_unlocked, unlocked_at IS NOT NULL AS has_date FROM achievements
       WHERE achievement_type IN ('clear_under_5', 'clear_under_3', 'chain_7', 'play_days_100') ORDER BY user_id, achievement_type`
    ).all();
    expect(results).toEqual([
      { user_id: 'good', achievement_type: 'chain_7', current_value: 9, is_unlocked: 1, has_date: 1 },
      { user_id: 'good', achievement_type: 'clear_under_3', current_value: 3, is_unlocked: 1, has_date: 1 },
      { user_id: 'good', achievement_type: 'clear_under_5', current_value: 3, is_unlocked: 1, has_date: 1 },
      { user_id: 'good', achievement_type: 'play_days_100', current_value: 120, is_unlocked: 1, has_date: 1 },
      { user_id: 'plain', achievement_type: 'chain_7', current_value: 8, is_unlocked: 1, has_date: 0 },
      { user_id: 'plain', achievement_type: 'clear_under_3', current_value: 6, is_unlocked: 0, has_date: 0 },
      { user_id: 'plain', achievement_type: 'clear_under_5', current_value: 6, is_unlocked: 0, has_date: 0 },
      { user_id: 'plain', achievement_type: 'play_days_100', current_value: 12, is_unlocked: 0, has_date: 0 },
    ]);
  });

  it('100 日プレイは 100 日目で解除する', async () => {
    await playDays(0, 99);
    expect(await evaluateAchievements(env.DB, USER, score({}))).not.toContain('play_days_100');
    await playDays(99, 100);
    expect(await evaluateAchievements(env.DB, USER, score({}))).toContain('play_days_100');
  });
});
