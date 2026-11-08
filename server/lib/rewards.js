// Dibbly Dobs (the one reward children earn, spend, and grown-ups manage),
// trophies (by Dobs ever earned) and the forgiving streak.
import { tx, one, many } from '../db.js';
import { TROPHIES } from './catalog.js';
import { dayISO, addDays, weekStartISO } from './dates.js';
import { later, notifyDob } from './notify.js';

// What each activity is worth: one Dob each, the same for every family so it's fair.
export const DOB_ACTIVITIES = [
  { id: 'studio', name: 'Star Studio video posted', hint: 'once a day' },
  { id: 'reading', name: 'Story read aloud', hint: 'every time' },
  { id: 'writing', name: 'Story or letter written', hint: 'every time' },
  { id: 'continue', name: 'Continued a friend’s story', hint: 'every time' },
  { id: 'spelling', name: 'Spelling set (5 words)', hint: 'every time' },
  { id: 'maths-addition', name: 'Maths: addition (5 questions)', hint: 'every time' },
  { id: 'maths-subtraction', name: 'Maths: subtraction (5 questions)', hint: 'every time' },
  { id: 'maths-bonds', name: 'Maths: number bonds (5 questions)', hint: 'every time' },
  { id: 'maths-times', name: 'Maths: times tables (5 questions)', hint: 'every time' },
];
export const DOB_VALUES = Object.freeze(Object.fromEntries(DOB_ACTIVITIES.map((a) => [a.id, 1])));

// Star Studio extras, in Dobs (on top of the 1 Dob for posting).
export const BONUS = {
  keyword: 1, // each unlock word said on camera (max 3)
  award: 1, // receiving an award from a crew friend
};
export const VIRAL_CHANCE = 1 / 6; // viral hit = double Dobs for that video

/**
 * Record an event and add (or take away) Dobs inside a transaction.
 * `meta` says what they did (shown to grown-ups). Returns the new totals.
 */
export async function grant(client, kidId, type, { dobs = 0, meta = {}, note = null, byParent = false, quiet = false } = {}) {
  const before = (await client.query(`SELECT dobs_earned FROM kids WHERE id = $1 FOR UPDATE`, [kidId])).rows[0];
  if (!before) throw new Error('kid not found');
  await client.query(
    `INSERT INTO events (kid_id, type, dobs, meta, note, by_parent, event_date) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [kidId, type, dobs, meta, note, byParent, dayISO()]
  );
  const after = (
    await client.query(
      `UPDATE kids SET dobs = GREATEST(0, dobs + $2), dobs_earned = dobs_earned + GREATEST($2, 0) WHERE id = $1 RETURNING dobs, dobs_earned`,
      [kidId, dobs]
    )
  ).rows[0];
  // Tell the grown-ups' phones (not for their own adjustments, or when another notification already says it).
  if (dobs > 0 && !byParent && !quiet) later(() => notifyDob(kidId, dobs, meta.what));
  const newTrophies = TROPHIES.filter((t) => before.dobs_earned < t.at && after.dobs_earned >= t.at).map((t) => t.id);
  return { dobs: after.dobs, gained: { dobs }, newTrophies };
}

/** Give the Dob for finishing an activity. */
export async function earnDobs(kidId, activity, meta = {}, { quiet = false } = {}) {
  const dobs = DOB_VALUES[activity] ?? 0;
  return tx((c) => grant(c, kidId, activity, { dobs, meta, quiet }));
}

export async function alreadyToday(kidId, type) {
  return Boolean(await one(`SELECT 1 FROM events WHERE kid_id = $1 AND type = $2 AND event_date = $3`, [kidId, type, dayISO()]));
}

/** Mark a once-a-day Star Studio step (reading the script, the word moment) as done. */
export async function markDaily(kidId, type, meta = {}) {
  return tx(async (c) => {
    const done = (await c.query(`SELECT 1 FROM events WHERE kid_id = $1 AND type = $2 AND event_date = $3`, [kidId, type, dayISO()])).rows[0];
    if (done) {
      const k = (await c.query(`SELECT dobs FROM kids WHERE id = $1`, [kidId])).rows[0];
      return { ...k, gained: { dobs: 0 }, newTrophies: [], already: true };
    }
    return grant(c, kidId, type, { meta });
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
