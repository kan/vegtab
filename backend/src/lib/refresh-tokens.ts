import { createAccessToken, createRefreshToken, verifyRefreshToken } from './jwt';
import { generateId } from './id';

/**
 * The previous token presented again this soon after its rotation is most likely a retry after a
 * lost response, or another tab refreshing at the same moment, so the family is not revoked.
 */
const REUSE_GRACE = '-30 seconds';

export type TokenPair = { accessToken: string; refreshToken: string };

async function signTokenPair(secret: string, userId: string, familyId: string, jti: string): Promise<TokenPair> {
  const [accessToken, refreshToken] = await Promise.all([
    createAccessToken(userId, secret),
    createRefreshToken(userId, familyId, jti, secret),
  ]);
  return { accessToken, refreshToken };
}

/**
 * Sign in on a device: starts a new refresh token family. Old accounts can no longer sign in
 * (docs/SPEC.md §5.4); only the tests use this, to stand for an old account's device
 */
export async function issueTokens(db: D1Database, secret: string, userId: string): Promise<TokenPair> {
  const familyId = generateId();
  const jti = generateId();
  await db.prepare(
    `INSERT INTO refresh_token_families (family_id, user_id, current_jti, expires_at)
     VALUES (?, ?, ?, datetime('now', '+90 days'))`
  ).bind(familyId, userId, jti).run();
  return signTokenPair(secret, userId, familyId, jti);
}

/**
 * Exchange a refresh token for a new pair. Only the family's current token is accepted. Presenting
 * any other token of the family revokes the family, since the token has most likely leaked, except
 * the previous token within the reuse grace window. Returns null when the token is not accepted.
 */
export async function rotateRefreshToken(db: D1Database, secret: string, refreshToken: string): Promise<TokenPair | null> {
  const claims = await verifyRefreshToken(refreshToken, secret);
  if (!claims) return null;
  const { userId, familyId, jti } = claims;
  const nextJti = generateId();

  // One transaction: after a successful rotation current_jti is nextJti, so the DELETE matches nothing
  const [rotated, revoked] = await db.batch([
    db.prepare(
      `UPDATE refresh_token_families
       SET previous_jti = current_jti, current_jti = ?,
           rotated_at = datetime('now'), expires_at = datetime('now', '+90 days')
       WHERE family_id = ? AND user_id = ? AND current_jti = ?
       RETURNING family_id`
    ).bind(nextJti, familyId, userId, jti),
    db.prepare(
      `DELETE FROM refresh_token_families
       WHERE family_id = ? AND current_jti <> ?
         AND NOT (previous_jti IS ? AND rotated_at > datetime('now', ?))
       RETURNING family_id`
    ).bind(familyId, nextJti, jti, REUSE_GRACE),
  ]);

  if (rotated.results.length > 0) return signTokenPair(secret, userId, familyId, nextJti);
  if (revoked.results.length > 0) {
    console.warn(`Refresh token reuse detected: revoked token family ${familyId} of user ${userId}`);
  }
  return null;
}

/** Drop families whose refresh token has expired (run by the daily cron) */
export async function purgeExpiredRefreshTokens(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM refresh_token_families WHERE expires_at <= datetime('now')").run();
}
