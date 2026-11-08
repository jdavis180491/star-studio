// Video visibility and the shape sent to the apps.
import { one, many } from '../db.js';
import { signedUrl } from '../media/signed.js';
import { dayISO, localHour, PREMIERE_HOUR } from './dates.js';
import { scopeMembers } from './family.js';

export const VIEWABLE = new Set(['approved']);

/**
 * Premiere rule: a crew's videos for a day are revealed together once every member
 * has an approved video, or at 6pm (then whatever is approved shows). Earlier days
 * are always revealed. Families not in a crew see their approved videos straight away.
 */
export async function premiereState(scope, date) {
  if (scope.startsWith('f:')) return { revealed: true, reason: 'family' };
  const members = await scopeMembers(scope);
  const approved = await many(
    `SELECT DISTINCT kid_id FROM videos WHERE scope = $1 AND brief_date = $2 AND status = 'approved'`,
    [scope, date]
  );
  const allIn = members.length > 0 && members.every((m) => approved.some((a) => a.kid_id === m.id));
  const today = dayISO();
  if (date < today) return { revealed: true, reason: 'past' };
  if (allIn) return { revealed: true, reason: 'everyone' };
  if (localHour() >= PREMIERE_HOUR) return { revealed: true, reason: '6pm' };
  return { revealed: false, reason: 'waiting' };
}

/** Is this viewer (session) allowed to watch this video right now? */
export async function canView(session, video) {
  if (!session) return false;
  const owner = await one(`SELECT family_id FROM kids WHERE id = $1`, [video.kid_id]);
  if (!owner) return false;
  if (owner.family_id === session.familyId) return true; // own family (kid or parent)
  if (!session.kidId || !VIEWABLE.has(video.status)) return false;
  // A crew-mate, once the premiere has happened.
  const sameCrew = await one(
    `SELECT 1 FROM crew_members a JOIN crew_members b ON a.crew_id = b.crew_id WHERE a.kid_id = $1 AND b.kid_id = $2`,
    [session.kidId, video.kid_id]
  );
  if (!sameCrew) return false;
  return (await premiereState(video.scope, video.brief_date)).revealed;
}

export function videoForClient(v, { owner = false } = {}) {
  const out = {
    id: v.id,
    kidId: v.kid_id,
    date: v.brief_date,
    title: v.title || v.brief?.title,
    briefTitle: v.brief?.title,
    status: v.status,
    seconds: v.seconds,
    viral: v.viral,
    finalUrl: v.final_key ? signedUrl('final', v.id) : null,
    thumbUrl: v.thumb_key ? signedUrl('thumb', v.id) : null,
  };
  if (owner) {
    Object.assign(out, {
      rawUrl: v.raw_key ? signedUrl('raw', v.id) : null,
      plan: v.plan,
      edit: v.edit,
      remixesLeft: Math.max(0, 1 - v.remixes),
      renderError: v.render_error,
      keywordsSaid: v.keywords_said,
      dobsAwarded: v.followers_awarded,
    });
  }
  return out;
}
