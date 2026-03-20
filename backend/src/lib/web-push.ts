import {
  generatePushHTTPRequest,
  type PushSubscription,
  type VAPIDKeys,
} from '@block65/webcrypto-web-push';

export type PushPayload = {
  title: string;
  body: string;
  icon?: string;
  url?: string;
};

export type PushResult = {
  success: boolean;
  statusCode: number;
  gone?: boolean;
};

/**
 * Import VAPID keys from base64url-encoded strings.
 */
export async function importVapidKeys(
  publicKey: string,
  privateKey: string,
): Promise<VAPIDKeys> {
  // @block65/webcrypto-web-push expects { publicKey, privateKey } as CryptoKeyPair
  // We need to import from raw base64url
  const pubRaw = base64urlToBuffer(publicKey);
  const privRaw = base64urlToBuffer(privateKey);

  const pubCryptoKey = await crypto.subtle.importKey(
    'raw',
    pubRaw,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    [],
  );

  const privCryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    privRaw,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign'],
  );

  return { publicKey: pubCryptoKey, privateKey: privCryptoKey };
}

/**
 * Send a push notification to a single subscription.
 */
export async function sendPushNotification(
  subscription: { endpoint: string; keyP256dh: string; keyAuth: string },
  payload: PushPayload,
  vapidKeys: VAPIDKeys,
  vapidSubject: string,
): Promise<PushResult> {
  const pushSub: PushSubscription = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.keyP256dh,
      auth: subscription.keyAuth,
    },
  };

  try {
    const { headers, body, endpoint } = await generatePushHTTPRequest({
      applicationServerKeys: vapidKeys,
      payload: JSON.stringify(payload),
      target: pushSub,
      adminContact: vapidSubject,
      ttl: 60 * 60, // 1 hour
    });

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
    });

    return {
      success: res.status >= 200 && res.status < 300,
      statusCode: res.status,
      gone: res.status === 404 || res.status === 410,
    };
  } catch {
    return { success: false, statusCode: 0 };
  }
}

function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  const binary = atob(base64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
