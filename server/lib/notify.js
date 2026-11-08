// Phone notifications for grown-ups (Web Push). Each grown-up's phone subscribes from
// Settings → Phone notifications. Payloads are end-to-end encrypted, so Apple's / Google's
// push service can't read them. Keys are made once and kept in the database (no setup).
import webpush from 'web-push';
import { q, one, many } from '../db.js';
import { dayISO } from './dates.js';

export const NOTIFY_KINDS = ['approvals', 'dobs'];
let vapid = null;

export async function vapidKeys() {
  if (vapid) return vapid;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    return vapid;
  }
  const fresh = webpush.generateVAPIDKeys();
  await q(`INSERT INTO app_kv (key, value) VALUES ('vapid', $1) ON CONFLICT (key) DO NOTHING`, [fresh]);
  vapid = (await one(`SELECT value FROM app_kv WHERE key = 'vapid'`)).value;
  return vapid;
}

export function notifyPrefs(settings = {}) {
  const n = settings.notify || {};
  return { approvals: n.approvals !== false, dobs: n.dobs !== false };
}

/** Send a notification to every phone a family has switched on. Never throws. */
export async function notifyFamily(familyId, kind, { title, body, url = '/parent' }, { force = false } = {}) {
  try {
    const fam = await one(`SELECT settings FROM families WHERE id = $1`, [familyId]);
    if (!fam) return 0;
    if (!force && !notifyPrefs(fam.settings)[kind]) return 0;
    const subs = await many(`SELECT * FROM push_subs WHERE family_id = $1`, [familyId]);
    if (!subs.length) return 0;
    const keys = await vapidKeys();
    const payload = JSON.stringify({ title, body, url, tag: `${kind}-${Date.now()}` });
    let sent = 0;
    await Promise.all(
      subs.map(async (s) => {
        const subject = /^https:\/\//.test(s.origin || '') ? s.origin : 'mailto:notifications@dibblydobs.app';
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, {
            TTL: 60 * 60 * 24,
            urgency: kind === 'approvals' ? 'high' : 'normal',
            vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
          });
          sent++;
        } catch (e) {
          // The phone turned notifications off or the app was removed: forget it.
          if (e.statusCode === 404 || e.statusCode === 410) await q(`DELETE FROM push_subs WHERE id = $1`, [s.id]);
          else console.warn('🔔 Notification failed:', e.statusCode || '', e.body || e.message);
        }
      })
    );
    return sent;
  } catch (e) {
    console.warn('🔔 Notification error:', e.message);
    return 0;
  }
}

/** "Ann earned a Dibbly Dob". Called just after the Dob is saved. */
export async function notifyDob(kidId, dobs, what) {
  const k = await one(`SELECT id, family_id, name FROM kids WHERE id = $1`, [kidId]).catch(() => null);
  if (!k) return;
  const today = await one(`SELECT COALESCE(SUM(dobs), 0)::int AS n FROM events WHERE kid_id = $1 AND event_date = $2 AND dobs > 0`, [kidId, dayISO()]);
  const title = `${k.name} earned ${dobs === 1 ? 'a Dibbly Dob' : `${dobs} Dibbly Dobs`}`;
  const body = `${what || 'Well done!'} · ${today.n} today`;
  await notifyFamily(k.family_id, 'dobs', { title, body, url: '/parent?tab=dobs' });
}

/** Run a notification after the current request's database work has finished. */
export function later(fn) {
  setTimeout(() => fn().catch((e) => console.warn('🔔', e.message)), 300);
}
