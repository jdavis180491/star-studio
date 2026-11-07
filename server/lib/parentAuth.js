// Temporary grown-up lock for the parent dashboard (Phase 5 replaces it with real
// parent accounts). Set PARENT_PASSCODE in Replit Secrets.
import crypto from 'node:crypto';

const sessions = new Map(); // token -> expiry
const TTL = 12 * 60 * 60 * 1000;

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();

export function parentLogin(req, res) {
  const expected = process.env.PARENT_PASSCODE;
  if (!expected) return res.status(503).json({ error: 'PARENT_PASSCODE is not set in Replit Secrets yet.' });
  const given = String(req.body?.passcode || '');
  if (!crypto.timingSafeEqual(hash(given), hash(expected))) {
    return setTimeout(() => res.status(401).json({ error: 'Wrong passcode' }), 600);
  }
  const token = crypto.randomBytes(24).toString('base64url');
  sessions.set(token, Date.now() + TTL);
  res.json({ token });
}

export function requireParent(req, res, next) {
  const token = req.get('x-parent-token');
  const exp = token && sessions.get(token);
  if (!exp || exp < Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: 'Please log in again' });
  }
  next();
}
