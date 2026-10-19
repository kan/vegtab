/**
 * Generate VAPID key pair for Web Push.
 * Run: npx tsx scripts/generate-vapid-keys.ts
 *
 * Output the keys in base64url format.
 * - VAPID_PUBLIC_KEY: set in wrangler.jsonc "vars" (top level and env.production)
 * - VAPID_PRIVATE_KEY: set via `wrangler secret put VAPID_PRIVATE_KEY`
 */

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function main() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign'],
  );

  const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

  console.log('=== VAPID Keys ===\n');
  console.log('VAPID_PUBLIC_KEY (add to wrangler.jsonc "vars", top level and env.production):');
  console.log(bufferToBase64url(publicKeyRaw));
  console.log('\nVAPID_PRIVATE_KEY (set via: wrangler secret put VAPID_PRIVATE_KEY --env production):');
  console.log(privateKeyJwk.d);
  console.log('\nAlso add to backend/.dev.vars for local development.');
}

main();
