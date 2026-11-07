// Short-lived signed links for private media: /api/media/<kind>/<id>?exp=…&sig=…
// The server also checks the viewer's session before streaming (see routes/media.js).
import crypto from 'node:crypto';

let devSecret = null;
function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  devSecret ||= crypto.randomBytes(32).toString('hex');
  return devSecret;
}

const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

export function signedUrl(kind, id, ttlSeconds = 15 * 60) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `/api/media/${kind}/${encodeURIComponent(id)}?exp=${exp}&sig=${sign(`${kind}|${id}|${exp}`)}`;
}

export function verifySigned(kind, id, exp, sig) {
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const expected = sign(`${kind}|${id}|${exp}`);
  return expected.length === String(sig).length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(sig)));
}
