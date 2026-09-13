import { buildPushPayload, type PushSubscription, type VapidKeys } from '@block65/webcrypto-web-push';

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
  error?: string;
};

/** Hosts of the push services browsers hand out endpoints for (Chrome, Firefox, Safari, Edge) */
const PUSH_SERVICE_HOST = /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|(.+\.)?push\.apple\.com|.+\.notify\.windows\.com)$/;

/** Whether an endpoint belongs to a real push service. The daily cron POSTs to every stored endpoint. */
export function isPushServiceEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && PUSH_SERVICE_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Send a push notification to a single subscription.
 */
export async function sendPushNotification(
  subscription: { endpoint: string; keyP256dh: string; keyAuth: string },
  payload: PushPayload,
  vapidKeys: VapidKeys,
): Promise<PushResult> {
  const pushSub: PushSubscription = {
    endpoint: subscription.endpoint,
    expirationTime: null,
    keys: {
      p256dh: subscription.keyP256dh,
      auth: subscription.keyAuth,
    },
  };

  try {
    const { headers, body, method } = await buildPushPayload(
      { data: payload, options: { ttl: 60 * 60, urgency: 'normal' } },
      pushSub,
      vapidKeys,
    );

    const res = await fetch(subscription.endpoint, { method, headers, body });

    return {
      success: res.status >= 200 && res.status < 300,
      statusCode: res.status,
      gone: res.status === 404 || res.status === 410,
    };
  } catch (e) {
    return { success: false, statusCode: 0, error: String(e) };
  }
}
