// Followers (the main score), coins, trophies and the forgiving streak.
import { tx, one, many } from '../db.js';
import { TROPHIES } from './catalog.js';
import { dayISO, addDays, weekStartISO } from './dates.js';

export const REWARDS = {
  read: { followers: 50, coins: 5 },
  word: { followers: 20, coins: 3 },
  post: { followers: 100, coins: 10 },
  keyword: { followers: 30, coins: 0 }, // each unlock word said on camera
  award: { followers: 25, coins: 2 },
};
export const VIRAL_CHANCE = 1 / 6;

/** Add followers/coins inside a transaction, record the event, and pay out any new trophies. */
export async function grant(client, kidId, type, { followers = 0, coins = 0, meta = {} } = {}) {
  const before = (await client.query(`SELECT followers FROM kids WHERE id = $1 FOR UPDATE`, [kidId])).rows[0];
  if (!before) throw new Error('kid not found');
  const date = dayISO();
  await client.query(
    `INSERT INTO events (kid_id, type, followers, coins, meta, event_date) VALUES ($1,$2,$3,$4,$5,$6)`,
    [kidId, type, followers, coins, meta, date]
  );
  let after = (
    await client.query(
      `UPDATE kids SET followers = followers + $2, coins = GREATEST(0, coins + $3) WHERE id = $1 RETURNING followers, coins`,
      [kidId, followers, coins]
    )
  ).rows[0];
  const newTrophies = TROPHIES.filter((t) => before.followers < t.at && after.followers >= t.at);
  for (const t of newTrophies) {
    await client.query(
      `INSERT INTO events (kid_id, type, coins, meta, event_date) VALUES ($1,'trophy',$2,$3,$4)`,
      [kidId, t.bonus, { trophy: t.id }, date]
    );
    after = (await client.query(`UPDATE kids SET coins = coins + $2 WHERE id = $1 RETURNING followers, coins`, [kidId, t.bonus])).rows[0];
  }
  return { followers: after.followers, coins: after.coins, gained: { followers, coins }, newTrophies: newTrophies.map((t) => t.id) };
}

export async function alreadyToday(kidId, type) {
  return Boolean(await one(`SELECT 1 FROM events WHERE kid_id = $1 AND type = $2 AND event_date = $3`, [kidId, type, dayISO()]));
}

/** Once-a-day reward (reading the brief, the word moment). */
export async function grantDaily(kidId, type, meta = {}) {
  return tx(async (c) => {
    const done = (await c.query(`SELECT 1 FROM events WHERE kid_id = $1 AND type = $2 AND event_date = $3`, [kidId, type, dayISO()])).rows[0];
    if (done) {
      const k = (await c.query(`SELECT followers, coins FROM kids WHERE id = $1`, [kidId])).rows[0];
      return { ...k, gained: { followers: 0, coins: 0 }, newTrophies: [], already: true };
    }
    return grant(c, kidId, type, { ...REWARDS[type], meta });
  });
}

/**
 * Forgiving streak: posting on consecutive days grows it, and one missed day is
 * forgiven. Returns the new streak.
 */
export function nextStreak(lastPostDate, streak, today = dayISO()) {
  if (lastPostDate === today) return streak || 1;
  if (lastPostDate && lastPostDate >= addDays(today, -2)) return (streak || 0) + 1;
  return 1;
}

/** Spend coins (word help, shop). Returns null if not enough. */
export async function spend(kidId, amount, type, meta = {}) {
  return tx(async (c) => {
    const k = (await c.query(`SELECT coins FROM kids WHERE id = $1 FOR UPDATE`, [kidId])).rows[0];
    if (!k || k.coins < amount) return null;
    return grant(c, kidId, type, { coins: -amount, meta });
  });
}

/** Weekly league: followers earned since Monday by everyone in the scope. */
export async function league(memberIds) {
  if (!memberIds.length) return [];
  return many(
    `SELECT k.id, k.channel_name, k.avatar, COALESCE(SUM(e.followers), 0)::int AS week_followers
       FROM kids k LEFT JOIN events e ON e.kid_id = k.id AND e.event_date >= $2
      WHERE k.id = ANY($1) GROUP BY k.id ORDER BY week_followers DESC, k.id`,
    [memberIds, weekStartISO()]
  );
}
