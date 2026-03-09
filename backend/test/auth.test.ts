import { describe, it, expect, beforeEach } from 'vitest';
import { SELF } from 'cloudflare:test';
import { applyMigrations, registerUser, authHeader } from './helpers';

describe('Auth API', () => {
  beforeEach(async () => {
    await applyMigrations();
  });

  it('POST /api/auth/register creates a new user and returns tokens', async () => {
    const res = await SELF.fetch('http://localhost/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: '550e8400-e29b-41d4-a716-446655440000' }),
    });

    expect(res.status).toBe(200);
    const data = await res.json() as { userId: string; accessToken: string; refreshToken: string };
    expect(data.userId).toBeTruthy();
    expect(data.accessToken).toBeTruthy();
    expect(data.refreshToken).toBeTruthy();
  });

  it('POST /api/auth/register returns same user for same device', async () => {
    const deviceId = '550e8400-e29b-41d4-a716-446655440001';
    const data1 = await registerUser(deviceId);
    const data2 = await registerUser(deviceId);
    expect(data1.userId).toBe(data2.userId);
  });

  it('POST /api/auth/refresh returns new tokens', async () => {
    const { refreshToken } = await registerUser('550e8400-e29b-41d4-a716-446655440002');

    const res = await SELF.fetch('http://localhost/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    expect(res.status).toBe(200);
    const data = await res.json() as { accessToken: string; refreshToken: string };
    expect(data.accessToken).toBeTruthy();
    expect(data.refreshToken).toBeTruthy();
  });

  it('rejects requests to protected endpoints without token', async () => {
    const res = await SELF.fetch('http://localhost/api/user/profile');
    expect(res.status).toBe(401);
  });

  it('authenticated request to /api/user/profile works', async () => {
    const { accessToken } = await registerUser('550e8400-e29b-41d4-a716-446655440003');

    const res = await SELF.fetch('http://localhost/api/user/profile', {
      headers: authHeader(accessToken),
    });

    expect(res.status).toBe(200);
    const data = await res.json() as { id: string; displayName: string | null };
    expect(data.id).toBeTruthy();
  });
});
