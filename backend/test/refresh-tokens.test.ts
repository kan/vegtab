import { describe, it, expect, beforeEach } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { SignJWT } from 'jose';
import { applyMigrations, registerUser } from './helpers';
import { purgeExpiredRefreshTokens } from '../src/lib/refresh-tokens';

function refresh(refreshToken: string) {
  return SELF.fetch('http://localhost/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
}

async function refreshOk(refreshToken: string) {
  const res = await refresh(refreshToken);
  expect(res.status).toBe(200);
  return res.json() as Promise<{ accessToken: string; refreshToken: string }>;
}

/** Pretend every rotation happened long ago, i.e. outside the reuse grace window */
async function ageRotations() {
  await env.DB.prepare(
    "UPDATE refresh_token_families SET rotated_at = datetime('now', '-1 hour') WHERE rotated_at IS NOT NULL"
  ).run();
}

describe('Refresh token rotation', () => {
  beforeEach(async () => {
    await applyMigrations();
  });

  it('rotates the token; retrying the used one right away fails without revoking the new one', async () => {
    const { refreshToken } = await registerUser(crypto.randomUUID());
    const next = await refreshOk(refreshToken);
    expect(next.refreshToken).not.toBe(refreshToken);
    expect(next.accessToken).toBeTruthy();

    // e.g. the response was lost, or another tab refreshed at the same moment
    expect((await refresh(refreshToken)).status).toBe(401);
    await refreshOk(next.refreshToken);
  });

  it('keeps rotating along the chain', async () => {
    const { refreshToken } = await registerUser(crypto.randomUUID());
    const second = await refreshOk(refreshToken);
    const third = await refreshOk(second.refreshToken);
    await refreshOk(third.refreshToken);
  });

  it('revokes the family when the previous token is presented after the grace window', async () => {
    const { refreshToken } = await registerUser(crypto.randomUUID());
    const next = await refreshOk(refreshToken);
    await ageRotations();

    expect((await refresh(refreshToken)).status).toBe(401);
    expect((await refresh(next.refreshToken)).status).toBe(401);
  });

  it('revokes the family when an older generation is presented, even right away', async () => {
    const { refreshToken: first } = await registerUser(crypto.randomUUID());
    const second = await refreshOk(first);
    const third = await refreshOk(second.refreshToken);

    expect((await refresh(first)).status).toBe(401);
    expect((await refresh(third.refreshToken)).status).toBe(401);
  });

  it('does not revoke other sign-ins of the same user', async () => {
    const deviceId = crypto.randomUUID();
    const first = await registerUser(deviceId);
    const second = await registerUser(deviceId);
    expect(second.userId).toBe(first.userId);

    const next = await refreshOk(first.refreshToken);
    await ageRotations();
    await refresh(first.refreshToken); // reuse revokes the first sign-in's family
    expect((await refresh(next.refreshToken)).status).toBe(401);

    await refreshOk(second.refreshToken);
  });

  it('rejects refresh tokens issued before rotation existed (no family or jti)', async () => {
    const { userId } = await registerUser(crypto.randomUUID());
    const legacy = await new SignJWT({ sub: userId, type: 'refresh' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('90d')
      .sign(new TextEncoder().encode((env as unknown as { JWT_SECRET: string }).JWT_SECRET));

    expect((await refresh(legacy)).status).toBe(401);
  });

  it('rejects an access token presented as a refresh token', async () => {
    const { accessToken } = await registerUser(crypto.randomUUID());
    expect((await refresh(accessToken)).status).toBe(401);
  });

  it('purges expired families and keeps active ones', async () => {
    const { userId, refreshToken } = await registerUser(crypto.randomUUID());
    await env.DB.prepare(
      `INSERT INTO refresh_token_families (family_id, user_id, current_jti, expires_at)
       VALUES ('expired-family', ?, 'expired-jti', datetime('now', '-1 seconds'))`
    ).bind(userId).run();

    await purgeExpiredRefreshTokens(env.DB);

    const expired = await env.DB.prepare("SELECT 1 FROM refresh_token_families WHERE family_id = 'expired-family'").first();
    expect(expired).toBeNull();
    await refreshOk(refreshToken);
  });
});
