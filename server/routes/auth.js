import express from 'express';
import { q, one, many } from '../db.js';
import {
  hashSecret, checkSecret, startSession, endSession, refreshParentMode, validEmail, validPin, requireDevice,
} from '../auth.js';
import { publicKid } from '../lib/family.js';
import { rateLimit } from '../lib/rateLimit.js';

const CONSENT_VERSION = 2;

export function authRouter() {
  const r = express.Router();
  const slow = rateLimit({ perMinute: 10 });

  r.post('/auth/signup', slow, async (req, res, next) => {
    try {
      const { email, password, consent } = req.body || {};
      const em = String(email || '').trim().toLowerCase();
      if (!validEmail(em)) return res.status(400).json({ error: 'Please enter a valid email address' });
      if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Password needs at least 8 characters' });
      if (consent !== true) return res.status(400).json({ error: 'Please accept the Terms & Privacy to continue' });
      if (await one(`SELECT 1 FROM families WHERE email = $1`, [em])) return res.status(409).json({ error: 'That email already has an account. Try logging in.' });
      const fam = await one(
        `INSERT INTO families (email, password_hash, consent_at, settings) VALUES ($1, $2, now(), $3) RETURNING id`,
        [em, await hashSecret(password), { consentVersion: CONSENT_VERSION }]
      );
      await startSession(req, res, fam.id);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  r.post('/auth/login', slow, async (req, res, next) => {
    try {
      const em = String(req.body?.email || '').trim().toLowerCase();
      const fam = await one(`SELECT id, password_hash FROM families WHERE email = $1`, [em]);
      if (!fam || !(await checkSecret(req.body?.password || '', fam.password_hash))) {
        return setTimeout(() => res.status(401).json({ error: 'Email or password not right' }), 500);
      }
      if (req.session) await endSession(req, res);
      await startSession(req, res, fam.id);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // Re-open the grown-ups area on an already-linked device.
  r.post('/auth/unlock', slow, requireDevice, async (req, res, next) => {
    try {
      const fam = await one(`SELECT password_hash FROM families WHERE id = $1`, [req.session.familyId]);
      if (!(await checkSecret(req.body?.password || '', fam?.password_hash))) {
        return setTimeout(() => res.status(401).json({ error: 'Password not right' }), 500);
      }
      await refreshParentMode(req.session.token);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  r.post('/auth/lock', requireDevice, async (req, res, next) => {
    try {
      await q(`UPDATE sessions SET parent_until = NULL WHERE token = $1`, [req.session.token]);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  r.post('/auth/logout', async (req, res, next) => {
    try {
      await endSession(req, res);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  r.get('/me', async (req, res, next) => {
    try {
      if (!req.session) return res.json({ device: false });
      const fam = await one(`SELECT email FROM families WHERE id = $1`, [req.session.familyId]);
      const kids = await many(`SELECT * FROM kids WHERE family_id = $1 ORDER BY id`, [req.session.familyId]);
      const self = kids.find((k) => k.id === req.session.kidId);
      res.json({
        device: true,
        parentMode: req.session.parentMode,
        email: req.session.parentMode ? fam?.email : undefined,
        kids: kids.map((k) => publicKid(k)),
        kid: self ? publicKid(self, { self: true }) : null,
      });
    } catch (e) {
      next(e);
    }
  });

  r.post('/kid/login', rateLimit({ perMinute: 20 }), requireDevice, async (req, res, next) => {
    try {
      const { kidId, pin } = req.body || {};
      const kid = await one(`SELECT * FROM kids WHERE id = $1 AND family_id = $2`, [Number(kidId), req.session.familyId]);
      if (!kid) return res.status(404).json({ error: 'Profile not found' });
      if (kid.pin_locked_until && new Date(kid.pin_locked_until) > new Date()) {
        return res.status(429).json({ error: 'Too many tries. Ask a grown-up, or wait 5 minutes.' });
      }
      if (!validPin(String(pin)) || !(await checkSecret(String(pin), kid.pin_hash))) {
        const fails = kid.pin_fails + 1;
        await q(
          `UPDATE kids SET pin_fails = $2, pin_locked_until = CASE WHEN $2 >= 5 THEN now() + interval '5 minutes' ELSE NULL END WHERE id = $1`,
          [kid.id, fails >= 5 ? 0 : fails]
        );
        return res.status(401).json({ error: 'Not quite! Try again.' });
      }
      await q(`UPDATE kids SET pin_fails = 0, pin_locked_until = NULL WHERE id = $1`, [kid.id]);
      await q(`UPDATE sessions SET kid_id = $2 WHERE token = $1`, [req.session.token, kid.id]);
      res.json({ kid: publicKid(kid, { self: true }) });
    } catch (e) {
      next(e);
    }
  });

  r.post('/kid/logout', requireDevice, async (req, res, next) => {
    try {
      await q(`UPDATE sessions SET kid_id = NULL WHERE token = $1`, [req.session.token]);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
