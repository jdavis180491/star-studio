// Accounts & sessions.
//
// - A parent signs up / logs in on a device. That "links" the device to the family
//   for 180 days, so kids can pick their avatar + PIN on it.
// - Grown-up mode (the dashboard) needs the parent password and lasts 30 minutes.
// - Kid login is avatar + 4-digit PIN, stored on the same device session.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { q, one } from './db.js';

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'ss_session';
const DEVICE_DAYS = 180;
const PARENT_MINUTES = 30;

export async function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(secret), salt, 32);
  return `s1$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function checkSecret(secret, stored) {
  const [v, saltB64, keyB64] = String(stored || '').split('$');
  if (v !== 's1' || !saltB64 || !keyB64) return false;
  const key = await scrypt(String(secret), Buffer.from(saltB64, 'base64'), 32);
  const expected = Buffer.from(keyB64, 'base64');
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(req, res, token, maxAgeSec) {
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  res.append(
    'Set-Cookie',
    `${COOKIE}=${token ? encodeURIComponent(token) : ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`
  );
}

export async function startSession(req, res, familyId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await q(
    `INSERT INTO sessions (token, family_id, parent_until, expires_at)
     VALUES ($1, $2, now() + interval '${PARENT_MINUTES} minutes', now() + interval '${DEVICE_DAYS} days')`,
    [token, familyId]
  );
  setCookie(req, res, token, DEVICE_DAYS * 86400);
  return token;
}

export async function endSession(req, res) {
  if (req.session) await q(`DELETE FROM sessions WHERE token = $1`, [req.session.token]);
  setCookie(req, res, '', 0);
}

export async function refreshParentMode(token) {
  await q(`UPDATE sessions SET parent_until = now() + interval '${PARENT_MINUTES} minutes' WHERE token = $1`, [token]);
}

/** Attach req.session = { token, familyId, kidId, parentMode } when the cookie is valid. */
export async function loadSession(req, res, next) {
  try {
    const token = parseCookies(req.get('cookie'))[COOKIE];
    req.session = null;
    if (token) {
      const s = await one(
        `SELECT token, family_id, kid_id, (parent_until > now()) AS parent_mode
         FROM sessions WHERE token = $1 AND expires_at > now()`,
        [token]
      );
      if (s) req.session = { token: s.token, familyId: s.family_id, kidId: s.kid_id, parentMode: s.parent_mode };
    }
    next();
  } catch (e) {
    next(e);
  }
}

// Mutating API calls must carry this header: a cheap, effective CSRF guard
// (other sites can't add custom headers to cross-site requests).
export function requireAppHeader(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-star-studio') !== '1') return res.status(403).json({ error: 'Blocked' });
  next();
}

export function requireDevice(req, res, next) {
  if (!req.session) return res.status(401).json({ error: 'A grown-up needs to sign in on this device first.', code: 'no_device' });
  next();
}

export function requireParent(req, res, next) {
  if (!req.session) return res.status(401).json({ error: 'Please sign in', code: 'no_device' });
  if (!req.session.parentMode) return res.status(401).json({ error: 'Enter your password to open the grown-ups area', code: 'parent_locked' });
  refreshParentMode(req.session.token).catch(() => {});
  next();
}

export async function requireKid(req, res, next) {
  try {
    if (!req.session) return res.status(401).json({ error: 'Ask a grown-up to sign in', code: 'no_device' });
    if (!req.session.kidId) return res.status(401).json({ error: 'Pick your profile', code: 'no_kid' });
    const kid = await one(`SELECT * FROM kids WHERE id = $1 AND family_id = $2`, [req.session.kidId, req.session.familyId]);
    if (!kid) return res.status(401).json({ error: 'Pick your profile', code: 'no_kid' });
    req.kid = kid;
    next();
  } catch (e) {
    next(e);
  }
}

export const validEmail = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;
export const validPin = (p) => typeof p === 'string' && /^\d{4}$/.test(p);
