// Kids, crews and "scopes". A scope is who shares the daily brief:
//   'c:<crewId>' for a crew of friends, or 'f:<familyId>' for a family not in a crew.
import { one, many } from '../db.js';
import { trophiesFor } from './catalog.js';

export const DEFAULT_FAMILY_SETTINGS = {
  star: { yearGroup: 'Y3', weeklyWords: [], todayWords: {} },
  little: { yearGroup: 'R', weeklyWords: [], todayWords: {} },
  directorVoiceId: null,
};

export function familySettings(raw = {}) {
  return {
    ...DEFAULT_FAMILY_SETTINGS,
    ...raw,
    star: { ...DEFAULT_FAMILY_SETTINGS.star, ...(raw.star || {}) },
    little: { ...DEFAULT_FAMILY_SETTINGS.little, ...(raw.little || {}) },
  };
}

/** What a kid's own app (and their crew) may see. Never includes the real name. */
export function publicKid(k, { self = false } = {}) {
  const base = {
    id: k.id,
    channelName: k.channel_name,
    avatar: k.avatar,
    track: k.track,
    trophies: trophiesFor(k.dobs_earned || 0),
  };
  if (!self) return base;
  return {
    ...base,
    yearGroup: k.year_group,
    dobs: k.dobs,
    dobsEarned: k.dobs_earned || 0,
    settings: k.settings,
    streak: k.streak,
    bestStreak: k.best_streak,
    lastPostDate: k.last_post_date,
    owned: k.owned,
    decor: k.decor,
  };
}

export async function crewForKid(kidId) {
  return one(
    `SELECT c.* FROM crews c JOIN crew_members m ON m.crew_id = c.id WHERE m.kid_id = $1`,
    [kidId]
  );
}

export async function scopeForKid(kid) {
  const crew = await crewForKid(kid.id);
  return crew ? `c:${crew.id}` : `f:${kid.family_id}`;
}

export async function scopeMembers(scope) {
  const [kind, id] = scope.split(':');
  if (kind === 'c') {
    return many(`SELECT k.* FROM kids k JOIN crew_members m ON m.kid_id = k.id WHERE m.crew_id = $1 ORDER BY k.id`, [Number(id)]);
  }
  // Family scope: only kids not in a crew.
  return many(
    `SELECT k.* FROM kids k WHERE k.family_id = $1
       AND NOT EXISTS (SELECT 1 FROM crew_members m WHERE m.kid_id = k.id) ORDER BY k.id`,
    [Number(id)]
  );
}

/** Families whose keywords feed a scope's brief (all crew families, or the one family). */
export async function scopeFamilies(scope) {
  const [kind, id] = scope.split(':');
  if (kind === 'c') {
    return many(
      `SELECT DISTINCT f.* FROM families f JOIN kids k ON k.family_id = f.id
         JOIN crew_members m ON m.kid_id = k.id WHERE m.crew_id = $1 ORDER BY f.id`,
      [Number(id)]
    );
  }
  return many(`SELECT * FROM families WHERE id = $1`, [Number(id)]);
}

/** Can this family write/approve the brief for this scope? (crew owner, or the family itself) */
export async function familyManagesScope(familyId, scope) {
  const [kind, id] = scope.split(':');
  if (kind === 'f') return Number(id) === familyId;
  if (kind === 'c') return Boolean(await one(`SELECT 1 FROM crews WHERE id = $1 AND owner_family_id = $2`, [Number(id), familyId]));
  return false;
}

export function randomCode(len = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}
