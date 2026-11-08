// Dibbly Dobs (the reward children earn, spend, and grown-ups manage),
// followers (Star Studio's fun video score), trophies and the forgiving streak.
import { tx, one, many } from '../db.js';
import { TROPHIES } from './catalog.js';
import { dayISO, addDays, weekStartISO } from './dates.js';

// What each activity is worth. Grown-ups change these in the portal ("Dob values").
export const DOB_ACTIVITIES = [
  { id: 'studio', name: 'Star Studio video posted', hint: 'once a day', def: 3 },
  { id: 'reading', name: 'Story read aloud', hint: 'every time', def: 2 },
  { id: 'writing', name: 'Story or letter written', hint: 'every time', def: 2 },
  { id: 'continue', name: 'Continued a friend’s story', hint: 'every time', def: 1 },
  { id: 'spelling', name: 'Spelling set (5 words)', hint: 'every time', def: 1 },
  { id: 'maths-addition', name: 'Maths: addition (5 questions)', hint: 'every time', def: 1 },
  { id: 'maths-subtraction', name: 'Maths: subtraction (5 questions)', hint: 'every time', def: 1 },
  { id: 'maths-bonds', name: 'Maths: number bonds (5 questions)', hint: 'every time', def: 1 },
  { id: 'maths-times', name: 'Maths: times tables (5 questions)', hint: 'every time', def: 1 },
];
export const DEFAULT_RULES = { ...Object.fromEntries(DOB_ACTIVITIES.map((a) => [a.id, a.def])), helpCost: 0 };

export function dobRules(familySettings = {}) {
  const r = { ...DEFAULT_RULES, ...(familySettings.dobRules || {}) };
  for (const k of Object.keys(r)) r[k] = Math.max(0, Math.min(50, Math.round(Number(r[k]) || 0)));
  return r;
}

export async function rulesForKid(kidId) {
  const f = await one(`SELECT f.settings FROM families f JOIN kids k ON k.family_id = f.id WHERE k.id = $1`, [kidId]);
  return dobRules(f?.settings || {});
}

// Star Studio followers (the creator score) per step.
export const REWARDS = {
  read: { followers: 50 },
  word: { followers: 20 },
  post: { followers: 100 },
  keyword: { followers: 30 }, // each unlock word said on camera
  award: { followers: 25 },
};
export const VIRAL_CHANCE = 1 / 6;

/**
 * Record an event and add followers / Dobs inside a transaction.
 * `meta` says what they did (shown to grown-ups). Returns the new totals.
 */
export async function grant(client, kidId, type, { followers = 0, dobs = 0, meta = {}, note = null, byParent = false } = {}) {
  const before = (await client.query(`SELECT followers FROM kids WHERE id = $1 FOR UPDATE`, [kidId])).rows[0];
  if (!before) throw new Error('kid not found');
  await client.query(
    `INSERT INTO events (kid_id, type, followers, dobs, meta, note, by_parent, event_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [kidId, type, followers, dobs, meta, note, byParent, dayISO()]
  );
  const after = (
    await client.query(
      `UPDATE kids SET followers = followers + $2, dobs = GREATEST(0, dobs + $3) WHERE id = $1 RETURNING followers, dobs`,
      [kidId, followers, dobs]
    )
  ).rows[0];
  const newTrophies = TROPHIES.filter((t) => before.followers < t.at && after.followers >= t.at).map((t) => t.id);
  return { followers: after.followers, dobs: after.dobs, gained: { followers, dobs }, newTrophies };
}

/** Give the Dobs a grown-up set for this activity. */
export async function earnDobs(kidId, activity, meta = {}) {
  const rules = await rulesForKid(kidId);
  const dobs = rules[activity] ?? 0;
  return tx((c) => grant(c, kidId, activity, { dobs, meta }));
}

export async function alreadyToday(kidId, type) {
  return Boolean(await one(`SELECT 1 FROM events WHERE kid_id = $1 AND type = $2 AND event_date = $3`, [kidId, type, dayISO()]));
}

/** Once-a-day Star Studio steps (reading the script, the word moment): followers only. */
export async function grantDaily(kidId, type, meta = {}) {
  return tx(async (c) => {
    const done = (await c.query(`SELECT 1 FROM events WHERE kid_id = $1 AND type = $2 AND event_date = $3`, [kidId, type, dayISO()])).rows[0];
    if (done) {
      const k = (await c.query(`SELECT followers, dobs FROM kids WHERE id = $1`, [kidId])).rows[0];
      return { ...k, gained: { followers: 0, dobs: 0 }, newTrophies: [], already: true };
    }
    return grant(c, kidId, type, { ...REWARDS[type], meta });
  });
}

/** Forgiving streak: consecutive days grow it; one missed day is forgiven. */
export function nextStreak(lastPostDate, streak, today = dayISO()) {
  if (lastPostDate === today) return streak || 1;
  if (lastPostDate && lastPostDate >= addDays(today, -2)) return (streak || 0) + 1;
  return 1;
}

/** Spend Dobs (shop, word help). Returns null if not enough. */
export async function spend(kidId, amount, type, meta = {}) {
  return tx(async (c) => {
    const k = (await c.query(`SELECT dobs FROM kids WHERE id = $1 FOR UPDATE`, [kidId])).rows[0];
    if (!k || k.dobs < amount) return null;
    return grant(c, kidId, type, { dobs: -amount, meta });
  });
}

/** Star Studio weekly league: followers earned since Monday. */
export async function league(memberIds) {
  if (!memberIds.length) return [];
  return many(
    `SELECT k.id, k.channel_name, k.avatar, COALESCE(SUM(e.followers), 0)::int AS week_followers
       FROM kids k LEFT JOIN events e ON e.kid_id = k.id AND e.event_date >= $2
      WHERE k.id = ANY($1) GROUP BY k.id ORDER BY week_followers DESC, k.id`,
    [memberIds, weekStartISO()]
  );
}

/** Dibbly Dobs leaderboard: Dobs earned this week (not counting spending), plus balances. */
export async function dobLeaderboard(kidIds) {
  if (!kidIds.length) return [];
  return many(
    `SELECT k.id, k.channel_name, k.avatar, k.dobs,
            COALESCE(SUM(CASE WHEN e.dobs > 0 THEN e.dobs ELSE 0 END), 0)::int AS week_dobs
       FROM kids k LEFT JOIN events e ON e.kid_id = k.id AND e.event_date >= $2
      WHERE k.id = ANY($1) GROUP BY k.id ORDER BY week_dobs DESC, k.dobs DESC, k.id`,
    [kidIds, weekStartISO()]
  );
}
