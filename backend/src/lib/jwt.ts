import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const ALGORITHM = 'HS256';
const ACCESS_TOKEN_EXPIRY = '1h';
const REFRESH_TOKEN_EXPIRY = '90d';

function getSecretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function createAccessToken(userId: string, secret: string): Promise<string> {
  return new SignJWT({ sub: userId, type: 'access' })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(getSecretKey(secret));
}

/** A refresh token names its token family (fid) and generation (jti); see lib/refresh-tokens.ts */
export async function createRefreshToken(userId: string, familyId: string, jti: string, secret: string): Promise<string> {
  return new SignJWT({ sub: userId, type: 'refresh', fid: familyId })
    .setProtectedHeader({ alg: ALGORITHM })
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .sign(getSecretKey(secret));
}

async function verifyPayload(
  token: string, secret: string, expectedType: 'access' | 'refresh',
): Promise<(JWTPayload & { sub: string }) | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(secret), { algorithms: [ALGORITHM] });
    if (payload.type !== expectedType || !payload.sub) return null;
    return payload as JWTPayload & { sub: string };
  } catch {
    return null;
  }
}

/** Returns the user id of a valid access token */
export async function verifyAccessToken(token: string, secret: string): Promise<string | null> {
  return (await verifyPayload(token, secret, 'access'))?.sub ?? null;
}

/** Tokens issued before rotation existed carry no family or jti and are rejected */
export async function verifyRefreshToken(
  token: string, secret: string,
): Promise<{ userId: string; familyId: string; jti: string } | null> {
  const payload = await verifyPayload(token, secret, 'refresh');
  if (!payload?.jti || typeof payload.fid !== 'string') return null;
  return { userId: payload.sub, familyId: payload.fid, jti: payload.jti };
}
