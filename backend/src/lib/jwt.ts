import { SignJWT, jwtVerify } from 'jose';

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

export async function createRefreshToken(userId: string, secret: string): Promise<string> {
  return new SignJWT({ sub: userId, type: 'refresh' })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .sign(getSecretKey(secret));
}

export async function verifyToken(
  token: string,
  secret: string,
  expectedType: 'access' | 'refresh'
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(secret));
    if (payload.type !== expectedType || !payload.sub) return null;
    return payload.sub;
  } catch {
    return null;
  }
}
