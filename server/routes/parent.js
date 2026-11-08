// The grown-ups' dashboard API (requires the parent password, 30-minute window).
import express from 'express';
import { q, one, many, tx } from '../db.js';
import { requireParent, hashSecret, checkSecret, validPin, endSession } from '../auth.js';
import { dayISO, addDays, isISODate } from '../lib/dates.js';
import { upcomingBriefs, setAdminBriefs, clearBriefs, recentTitles } from '../lib/briefs.js';
import { cleanWords, windowProblem, wordsForKid, setsFor, COHORTS, WORDS_PER_DAY } from '../lib/keywords.js';
import { isAdminEmail } from '../lib/admin.js';
import { cleanLevels } from '../lib/levels.js';
import { sttEnabled, sttToken, STT_CONSENT_VERSION } from '../ai/stt.js';
import { familySettings, familyManagesScope, scopeMembers, randomCode } from '../lib/family.js';
import { wordsFor, pickWords, YEAR_GROUPS, YEAR_LABELS } from '../data/wordBank.js';
import { claudeEnabled, generateBrief, generateLittleFromMain, briefProblems, MODEL } from '../ai/claude.js';
import { voiceEnabled, listVoices, registerLine, lineAudio, DEFAULT_VOICE } from '../ai/voice.js';
import { transcribeEnabled } from '../ai/transcribe.js';
import { rateLimit } from '../lib/rateLimit.js';
import { videoForClient } from '../lib/videos.js';
import { storageKind, storageProblem } from '../media/storage.js';
import { deleteVideoFiles } from './kid.js';
import { AVATAR_DEFAULT, FREE_ITEMS } from '../lib/catalog.js';
import { grant } from '../lib/rewards.js';
import { vapidKeys, notifyPrefs, notifyFamily } from '../lib/notify.js';
import { TIMES_TABLES, BOND_TARGETS, mathsSettings, MATHS_TYPES } from '../lib/maths.js';
import { eventForClient } from './learn.js';

const MAX_CREW = 4;
const TRACK_OPTIONS = ['star', 'little', 'family'];

const kidForParent = (k) => ({
  id: k.id,
  name: k.name,
  channelName: k.channel_name,
  track: k.track,
  yearGroup: k.year_group,
  levels: k.settings?.levels || {},
  avatar: k.avatar,
  dobs: k.dobs,
  settings: k.settings,
  streak: k.streak,
});

export function parentRouter() {
  const r = express.Router();
  r.use(requireParent);
  const fam = (req) => req.session.familyId;

  r.get('/status', async (req, res, next) => {
    try {
      const f = await one(`SELECT email, settings FROM families WHERE id = $1`, [fam(req)]);
      res.json({
        email: f.email,
        listening: sttEnabled() ? 'elevenlabs' : 'device',
        consentNeeded: (f.settings?.consentVersion || 1) < STT_CONSENT_VERSION,
        claude: claudeEnabled(),
        model: MODEL,
        voice: voiceEnabled(),
        transcribe: transcribeEnabled(),
        storage: storageKind(),
        storageProblem: storageProblem(),
        today: dayISO(),
        tomorrow: addDays(dayISO(), 1),
        yearGroups: YEAR_GROUPS.map((id) => ({ id, label: YEAR_LABELS[id] })),
        keywordsPerBrief: WORDS_PER_DAY,
        admin: isAdminEmail(f.email),
        defaultVoice: DEFAULT_VOICE,
        maxCrew: MAX_CREW,
        timesTables: TIMES_TABLES,
        bondTargets: BOND_TARGETS,
      });
    } catch (e) {
      next(e);
    }
  });

  // ------------------------------------------------------------- kids
  r.get('/kids', async (req, res, next) => {
    try {
      res.json({ kids: (await many(`SELECT * FROM kids WHERE family_id = $1 ORDER BY id`, [fam(req)])).map(kidForParent) });
    } catch (e) {
      next(e);
    }
  });

  r.post('/kids', async (req, res, next) => {
    try {
      const { name, channelName, pin, track = 'star', yearGroup, levels, maths } = req.body || {};
      if (!String(name || '').trim()) return res.status(400).json({ error: 'Add a name (only you will see it)' });
      if (!String(channelName || '').trim()) return res.status(400).json({ error: 'Add a channel name' });
      if (!validPin(String(pin || ''))) return res.status(400).json({ error: 'The PIN must be 4 digits' });
      if (!TRACK_OPTIONS.includes(track)) return res.status(400).json({ error: 'Bad mode' });
      const count = await one(`SELECT count(*)::int AS n FROM kids WHERE family_id = $1`, [fam(req)]);
      if (count.n >= 6) return res.status(400).json({ error: 'Up to 6 profiles per family' });
      const yg = YEAR_GROUPS.includes(yearGroup) ? yearGroup : track === 'little' ? 'R' : 'Y3';
      const k = await one(
        `INSERT INTO kids (family_id, name, channel_name, track, year_group, pin_hash, avatar, owned, settings)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [fam(req), String(name).trim().slice(0, 40), String(channelName).trim().slice(0, 30), track, yg, await hashSecret(pin), AVATAR_DEFAULT, JSON.stringify(FREE_ITEMS), { levels: cleanLevels(levels), ...(maths && typeof maths === 'object' ? { maths: mathsSettings({ maths }) } : {}) }]
      );
      res.json({ kid: kidForParent(k) });
    } catch (e) {
      next(e);
    }
  });

  r.put('/kids/:id', async (req, res, next) => {
    try {
      const k = await one(`SELECT * FROM kids WHERE id = $1 AND family_id = $2`, [Number(req.params.id), fam(req)]);
      if (!k) return res.status(404).json({ error: 'Not found' });
      const b = req.body || {};
      const name = b.name !== undefined ? String(b.name).trim().slice(0, 40) || k.name : k.name;
      const channel = b.channelName !== undefined ? String(b.channelName).trim().slice(0, 30) || k.channel_name : k.channel_name;
      const track = TRACK_OPTIONS.includes(b.track) ? b.track : k.track;
      const yg = YEAR_GROUPS.includes(b.yearGroup) ? b.yearGroup : k.year_group;
      const settings = { ...k.settings };
      if (b.maths && typeof b.maths === 'object') settings.maths = mathsSettings({ maths: b.maths });
      if (b.levels && typeof b.levels === 'object') settings.levels = cleanLevels(b.levels);
      let pinHash = k.pin_hash;
      if (b.pin) {
        if (!validPin(String(b.pin))) return res.status(400).json({ error: 'The PIN must be 4 digits' });
        pinHash = await hashSecret(String(b.pin));
      }
      const out = await one(
        `UPDATE kids SET name=$2, channel_name=$3, track=$4, year_group=$5, pin_hash=$6, settings=$7, pin_fails=0, pin_locked_until=NULL WHERE id=$1 RETURNING *`,
        [k.id, name, channel, track, yg, pinHash, settings]
      );
      res.json({ kid: kidForParent(out) });
    } catch (e) {
      next(e);
    }
  });

  // Delete a child's profile and ALL their data (videos, scores, reading logs).
  r.delete('/kids/:id', async (req, res, next) => {
    try {
      const k = await one(`SELECT id FROM kids WHERE id = $1 AND family_id = $2`, [Number(req.params.id), fam(req)]);
      if (!k) return res.status(404).json({ error: 'Not found' });
      const vids = await many(`SELECT * FROM videos WHERE kid_id = $1`, [k.id]);
      for (const v of vids) await deleteVideoFiles(v);
      await q(`DELETE FROM kids WHERE id = $1`, [k.id]);
      res.json({ ok: true, deletedVideos: vids.length });
    } catch (e) {
      next(e);
    }
  });

  // ------------------------------------------------------------- updated Terms & hearing test
  r.post('/consent', async (req, res, next) => {
    try {
      await q(`UPDATE families SET settings = settings || $2::jsonb, consent_at = now() WHERE id = $1`, [fam(req), JSON.stringify({ consentVersion: STT_CONSENT_VERSION })]);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // Can the app use ElevenLabs to hear the children? (asks ElevenLabs for a test token)
  r.post('/listen-test', rateLimit({ perMinute: 6 }), async (req, res, next) => {
    try {
      if (!sttEnabled()) return res.json({ ok: false, hint: 'Add ELEVENLABS_API_KEY in Replit Secrets first.' });
      await sttToken();
      res.json({ ok: true });
    } catch (e) {
      res.json({ ok: false, hint: e.message, detail: e.detail || null });
    }
  });

  // ------------------------------------------------------------- phone notifications
  r.get('/notifications', async (req, res, next) => {
    try {
      const f = await one(`SELECT settings FROM families WHERE id = $1`, [fam(req)]);
      const n = await one(`SELECT COUNT(*)::int AS n FROM push_subs WHERE family_id = $1`, [fam(req)]);
      res.json({ publicKey: (await vapidKeys()).publicKey, prefs: notifyPrefs(f.settings), phones: n.n });
    } catch (e) {
      next(e);
    }
  });

  r.post('/notifications/subscribe', async (req, res, next) => {
    try {
      const sub = req.body?.subscription || {};
      const endpoint = String(sub.endpoint || '');
      const keys = sub.keys || {};
      if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
        return res.status(400).json({ error: 'That phone could not be set up for notifications' });
      }
      const origin = /^https:\/\/[\w.-]+(:\d+)?$/.test(req.body?.origin || '') ? req.body.origin : null;
      await q(
        `INSERT INTO push_subs (family_id, endpoint, keys, origin) VALUES ($1,$2,$3,$4)
         ON CONFLICT (endpoint) DO UPDATE SET family_id = EXCLUDED.family_id, keys = EXCLUDED.keys, origin = EXCLUDED.origin`,
        [fam(req), endpoint, { p256dh: keys.p256dh.slice(0, 200), auth: keys.auth.slice(0, 100) }, origin]
      );
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  r.post('/notifications/unsubscribe', async (req, res, next) => {
    try {
      await q(`DELETE FROM push_subs WHERE family_id = $1 AND endpoint = $2`, [fam(req), String(req.body?.endpoint || '')]);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  r.put('/notifications/prefs', async (req, res, next) => {
    try {
      const prefs = { approvals: req.body?.approvals !== false, dobs: req.body?.dobs !== false };
      await q(`UPDATE families SET settings = settings || $2::jsonb WHERE id = $1`, [fam(req), JSON.stringify({ notify: prefs })]);
      res.json({ prefs });
    } catch (e) {
      next(e);
    }
  });

  r.post('/notifications/test', async (req, res, next) => {
    try {
      const sent = await notifyFamily(fam(req), 'test', { title: 'Dibbly Dobs', body: 'Notifications are working 🎉', url: '/parent' }, { force: true });
      res.json({ sent });
    } catch (e) {
      next(e);
    }
  });

  // ------------------------------------------------------------- studio settings
  r.get('/settings', async (req, res, next) => {
    try {
      const f = await one(`SELECT settings FROM families WHERE id = $1`, [fam(req)]);
      res.json(familySettings(f.settings));
    } catch (e) {
      next(e);
    }
  });

  r.put('/settings', async (req, res, next) => {
    try {
      const b = req.body || {};
      if (b.directorVoiceId !== undefined) {
        const v = b.directorVoiceId ? String(b.directorVoiceId).slice(0, 60) : null;
        await q(`UPDATE families SET settings = settings || $2::jsonb WHERE id = $1`, [fam(req), JSON.stringify({ directorVoiceId: v })]);
      }
      const f = await one(`SELECT settings FROM families WHERE id = $1`, [fam(req)]);
      res.json(familySettings(f.settings));
    } catch (e) {
      next(e);
    }
  });

  r.get('/wordbank/suggest', (req, res) => {
    const little = req.query.track === 'little';
    const n = Math.min(Number(req.query.n) || 10, 20);
    res.json({ words: pickWords(wordsFor(String(req.query.year || 'Y3'), { little }), n) });
  });

  // ------------------------------------------------------------- keywords (a grown-up's own words for their children)
  r.get('/keywords', async (req, res, next) => {
    try {
      const kids = await many(`SELECT * FROM kids WHERE family_id = $1 ORDER BY id`, [fam(req)]);
      const out = [];
      for (const k of kids) {
        const w = await wordsForKid(k);
        out.push({ id: k.id, name: k.name, channelName: k.channel_name, avatar: k.avatar, yearGroup: k.year_group, today: w.words, source: w.source, until: w.until });
      }
      const sets = await setsFor({ kidIds: kids.map((k) => k.id) });
      res.json({ kids: out, sets, today: dayISO() });
    } catch (e) {
      next(e);
    }
  });

  r.post('/keywords', async (req, res, next) => {
    try {
      const b = req.body || {};
      const words = cleanWords(b.words);
      if (!words.length) return res.status(400).json({ error: 'Add at least one word' });
      const starts = b.starts || dayISO();
      const problem = windowProblem(starts, b.ends);
      if (problem) return res.status(400).json({ error: problem });
      const ids = (Array.isArray(b.kidIds) ? b.kidIds : []).map(Number);
      const mine = ids.length ? await many(`SELECT id FROM kids WHERE family_id = $1 AND id = ANY($2)`, [fam(req), ids]) : [];
      if (!mine.length || mine.length !== ids.length) return res.status(400).json({ error: 'Choose which of your children these words are for' });
      for (const k of mine) {
        await q(`INSERT INTO keyword_sets (kid_id, family_id, cohort, words, starts, ends) VALUES ($1,$2,'all',$3,$4,$5)`, [k.id, fam(req), JSON.stringify(words), starts, b.ends]);
      }
      res.json({ ok: true, words });
    } catch (e) {
      next(e);
    }
  });

  r.delete('/keywords/:id', async (req, res, next) => {
    try {
      const del = await q(`DELETE FROM keyword_sets WHERE id = $1 AND family_id = $2 AND kid_id IS NOT NULL`, [Number(req.params.id), fam(req)]);
      res.status(del.rowCount ? 200 : 404).json(del.rowCount ? { ok: true } : { error: 'Not found' });
    } catch (e) {
      next(e);
    }
  });

  // ------------------------------------------------------------- admin: the daily brief + keywords for everyone
  const requireAdmin = async (req, res, next) => {
    try {
      const f = await one(`SELECT email FROM families WHERE id = $1`, [fam(req)]);
      if (!isAdminEmail(f?.email)) return res.status(403).json({ error: 'Only the app’s admin can do this' });
      next();
    } catch (e) {
      next(e);
    }
  };
  const cleanBrief = (b, track) => {
    const title = String(b?.title || '').trim().slice(0, 40);
    const text = String(b?.text || '').trim().replace(/\s+/g, ' ').slice(0, 600);
    const emoji = String(b?.emoji || '⭐').slice(0, 8);
    const words = text.split(' ').length;
    const [lo, hi] = track === 'little' ? [3, 30] : [12, 110];
    if (!title || words < lo || words > hi) return null;
    return { title, text, emoji };
  };

  r.get('/admin/briefs', requireAdmin, async (req, res, next) => {
    try {
      res.json({ today: dayISO(), days: await upcomingBriefs(dayISO(), 14) });
    } catch (e) {
      next(e);
    }
  });

  r.post('/admin/briefs/generate', requireAdmin, rateLimit({ perMinute: 6 }), async (req, res, next) => {
    try {
      if (!claudeEnabled()) return res.status(503).json({ error: 'Add ANTHROPIC_API_KEY in Replit Secrets to write briefs with AI.' });
      const theme = typeof req.body?.theme === 'string' ? req.body.theme.slice(0, 160) : '';
      const avoid = await recentTitles(addDays(dayISO(), 30), 90);
      const star = await generateBrief({ track: 'star', keywords: [], theme, avoid });
      const little = await generateLittleFromMain({ main: star, keywords: [] });
      res.json({
        star: { title: star.title, text: star.text, emoji: star.picture || '⭐' },
        little: { title: star.title, text: little.text, emoji: star.picture || little.picture || '⭐' },
      });
    } catch (e) {
      next(e);
    }
  });

  r.put('/admin/briefs/:date', requireAdmin, async (req, res, next) => {
    try {
      const date = req.params.date;
      if (!isISODate(date) || date <= dayISO()) return res.status(400).json({ error: 'You can change tomorrow’s brief or later. Today’s is already out.' });
      const star = cleanBrief(req.body?.star, 'star');
      const little = cleanBrief(req.body?.little, 'little');
      if (!star || !little) return res.status(400).json({ error: 'Both the older and young briefs need a title and some text.' });
      await setAdminBriefs(date, { star, little });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  r.delete('/admin/briefs/:date', requireAdmin, async (req, res, next) => {
    try {
      const date = req.params.date;
      if (!isISODate(date) || date <= dayISO()) return res.status(400).json({ error: 'Today’s brief is already out.' });
      await clearBriefs(date);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  r.get('/admin/keywords', requireAdmin, async (req, res, next) => {
    try {
      res.json({ sets: await setsFor({ admin: true }), today: dayISO() });
    } catch (e) {
      next(e);
    }
  });

  r.post('/admin/keywords', requireAdmin, async (req, res, next) => {
    try {
      const b = req.body || {};
      const words = cleanWords(b.words);
      if (!words.length) return res.status(400).json({ error: 'Add at least one word' });
      const cohort = COHORTS.includes(b.cohort) ? b.cohort : 'all';
      const starts = b.starts || dayISO();
      const problem = windowProblem(starts, b.ends);
      if (problem) return res.status(400).json({ error: problem });
      await q(`INSERT INTO keyword_sets (kid_id, family_id, cohort, words, starts, ends) VALUES (NULL,$1,$2,$3,$4,$5)`, [fam(req), cohort, JSON.stringify(words), starts, b.ends]);
      res.json({ ok: true, words });
    } catch (e) {
      next(e);
    }
  });

  r.delete('/admin/keywords/:id', requireAdmin, async (req, res, next) => {
    try {
      const del = await q(`DELETE FROM keyword_sets WHERE id = $1 AND kid_id IS NULL`, [Number(req.params.id)]);
      res.status(del.rowCount ? 200 : 404).json(del.rowCount ? { ok: true } : { error: 'Not found' });
    } catch (e) {
      next(e);
    }
  });

  // ------------------------------------------------------------- videos & approvals
  r.get('/videos', async (req, res, next) => {
    try {
      const vids = await many(
        `SELECT v.*, k.channel_name, k.name AS kid_name FROM videos v JOIN kids k ON k.id = v.kid_id
          WHERE k.family_id = $1 AND v.status <> 'new' ORDER BY (v.status = 'submitted') DESC, v.created_at DESC LIMIT 100`,
        [fam(req)]
      );
      res.json({ videos: vids.map((v) => ({ ...videoForClient(v, { owner: true }), channelName: v.channel_name, kidName: v.kid_name })) });
    } catch (e) {
      next(e);
    }
  });

  const ownVideo = (req) =>
    one(`SELECT v.* FROM videos v JOIN kids k ON k.id = v.kid_id WHERE v.id = $1 AND k.family_id = $2`, [req.params.id, fam(req)]);

  r.post('/videos/:id/approve', async (req, res, next) => {
    try {
      const v = await ownVideo(req);
      if (!v) return res.status(404).json({ error: 'Not found' });
      if (v.status !== 'submitted') return res.status(409).json({ error: 'Nothing to approve' });
      await q(`UPDATE videos SET status = 'approved', approved_at = now() WHERE id = $1`, [v.id]);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  r.post('/videos/:id/reject', async (req, res, next) => {
    try {
      const v = await ownVideo(req);
      if (!v) return res.status(404).json({ error: 'Not found' });
      await q(`UPDATE videos SET status = 'rejected' WHERE id = $1`, [v.id]);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  r.delete('/videos/:id', async (req, res, next) => {
    try {
      const v = await ownVideo(req);
      if (!v) return res.status(404).json({ error: 'Not found' });
      await deleteVideoFiles(v);
      await q(`DELETE FROM videos WHERE id = $1`, [v.id]);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // ------------------------------------------------------------- crews
  r.get('/crews', async (req, res, next) => {
    try {
      const crews = await many(
        `SELECT DISTINCT c.* FROM crews c LEFT JOIN crew_members m ON m.crew_id = c.id LEFT JOIN kids k ON k.id = m.kid_id
          WHERE c.owner_family_id = $1 OR k.family_id = $1 ORDER BY c.id`,
        [fam(req)]
      );
      const out = [];
      for (const c of crews) {
        const members = await many(
          `SELECT k.id, k.channel_name, k.family_id, k.avatar FROM kids k JOIN crew_members m ON m.kid_id = k.id WHERE m.crew_id = $1 ORDER BY m.joined_at`,
          [c.id]
        );
        out.push({
          id: c.id,
          name: c.name,
          code: c.owner_family_id === fam(req) ? c.invite_code : undefined,
          host: c.owner_family_id === fam(req),
          members: members.map((m) => ({ id: m.id, channelName: m.channel_name, avatar: m.avatar, mine: m.family_id === fam(req) })),
        });
      }
      res.json({ crews: out });
    } catch (e) {
      next(e);
    }
  });

  async function addKids(c, crewId, kidIds, familyId) {
    const ids = (Array.isArray(kidIds) ? kidIds : []).map(Number);
    if (!ids.length) throw Object.assign(new Error('Pick at least one child'), { status: 400 });
    const mine = (await c.query(`SELECT id FROM kids WHERE family_id = $1 AND id = ANY($2)`, [familyId, ids])).rows.map((r) => r.id);
    if (mine.length !== ids.length) throw Object.assign(new Error('Unknown child'), { status: 400 });
    const already = (await c.query(`SELECT kid_id FROM crew_members WHERE kid_id = ANY($1)`, [ids])).rows;
    if (already.length) throw Object.assign(new Error('A child can only be in one crew. Leave the other crew first.'), { status: 409 });
    const n = (await c.query(`SELECT count(*)::int AS n FROM crew_members WHERE crew_id = $1`, [crewId])).rows[0].n;
    if (n + ids.length > MAX_CREW) throw Object.assign(new Error(`Crews are 2 to ${MAX_CREW} creators`), { status: 409 });
    for (const id of ids) await c.query(`INSERT INTO crew_members (crew_id, kid_id) VALUES ($1,$2)`, [crewId, id]);
  }

  r.post('/crews', async (req, res, next) => {
    try {
      const name = String(req.body?.name || '').trim().slice(0, 30);
      if (!name) return res.status(400).json({ error: 'Give your crew a name' });
      const crew = await tx(async (c) => {
        let code;
        for (let i = 0; i < 5; i++) {
          code = randomCode();
          if (!(await c.query(`SELECT 1 FROM crews WHERE invite_code = $1`, [code])).rows[0]) break;
        }
        const row = (await c.query(`INSERT INTO crews (name, invite_code, owner_family_id) VALUES ($1,$2,$3) RETURNING *`, [name, code, fam(req)])).rows[0];
        await addKids(c, row.id, req.body?.kidIds, fam(req));
        return row;
      });
      res.json({ crew: { id: crew.id, name: crew.name, code: crew.invite_code } });
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      next(e);
    }
  });

  r.post('/crews/join', rateLimit({ perMinute: 10 }), async (req, res, next) => {
    try {
      const code = String(req.body?.code || '').trim().toUpperCase();
      const crew = await one(`SELECT * FROM crews WHERE invite_code = $1`, [code]);
      if (!crew) return res.status(404).json({ error: 'No crew with that code' });
      await tx((c) => addKids(c, crew.id, req.body?.kidIds, fam(req)));
      res.json({ crew: { id: crew.id, name: crew.name } });
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      next(e);
    }
  });

  // Take my children out of a crew (or, as host, remove anyone / close the crew).
  r.post('/crews/:id/leave', async (req, res, next) => {
    try {
      const crew = await one(`SELECT * FROM crews WHERE id = $1`, [Number(req.params.id)]);
      if (!crew) return res.status(404).json({ error: 'Not found' });
      const ids = (req.body?.kidIds || []).map(Number);
      const host = crew.owner_family_id === fam(req);
      await q(
        `DELETE FROM crew_members WHERE crew_id = $1 AND kid_id = ANY($2) ${host ? '' : 'AND kid_id IN (SELECT id FROM kids WHERE family_id = $3)'}`,
        host ? [crew.id, ids] : [crew.id, ids, fam(req)]
      );
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  r.delete('/crews/:id', async (req, res, next) => {
    try {
      const del = await q(`DELETE FROM crews WHERE id = $1 AND owner_family_id = $2`, [Number(req.params.id), fam(req)]);
      if (!del.rowCount) return res.status(404).json({ error: 'Only the host can close a crew' });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // ------------------------------------------------------------- reading stats
  r.get('/stats', async (req, res, next) => {
    try {
      const kids = await many(`SELECT * FROM kids WHERE family_id = $1 ORDER BY id`, [fam(req)]);
      const week = addDays(dayISO(), -6);
      const out = [];
      for (const k of kids) {
        const logs = await many(`SELECT * FROM reading_logs WHERE kid_id = $1 ORDER BY created_at DESC LIMIT 200`, [k.id]);
        const sum = (rows, f) => rows.reduce((s, r) => s + (r[f] || 0), 0);
        const weekLogs = logs.filter((l) => l.created_at.toISOString().slice(0, 10) >= week);
        const helpCount = {};
        for (const l of logs) for (const w of l.helped) helpCount[w] = (helpCount[w] || 0) + 1;
        // Mastered = read correctly (not helped, not counted-anyway) in 2+ different sessions.
        const readCount = {};
        const struggled = new Set();
        for (const l of logs) {
          for (const w of l.keywords_read) if (!l.keywords_forced.includes(w)) readCount[w] = (readCount[w] || 0) + 1;
          for (const w of [...l.helped, ...l.keywords_forced]) struggled.add(w);
        }
        const keywords = [...new Set(logs.flatMap((l) => l.keywords))];
        const mastered = keywords.filter((w) => (readCount[w] || 0) >= 2);
        const practising = keywords.filter((w) => !mastered.includes(w));
        out.push({
          kid: kidForParent(k),
          sessions: logs.length,
          wordsRead: { week: sum(weekLogs, 'words_read'), total: sum(logs, 'words_read') },
          accuracy: sum(logs, 'total_words') ? Math.round((100 * sum(logs, 'words_read')) / sum(logs, 'total_words')) : null,
          helpWords: Object.entries(helpCount).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([word, times]) => ({ word, times })),
          keywordsMastered: mastered,
          keywordsPractising: practising.map((w) => ({ word: w, struggled: struggled.has(w) })),
          recent: logs.slice(0, 7).map((l) => ({ date: l.created_at, title: l.brief_title, wordsRead: l.words_read, totalWords: l.total_words, helped: l.helped.length, skipped: l.grown_up_skip })),
        });
      }
      res.json({ kids: out });
    } catch (e) {
      next(e);
    }
  });

  // ------------------------------------------------------------- voice
  r.get('/voices', async (req, res, next) => {
    try {
      res.json({ voices: await listVoices() });
    } catch (e) {
      next(e);
    }
  });

  r.post('/voice-test', async (req, res, next) => {
    try {
      const line = registerLine(`Hey superstar! I'm your Director. Ready to make something brilliant?`, req.body?.voiceId);
      if (!voiceEnabled()) return res.json({ ...line, ok: false, hint: 'No ELEVENLABS_API_KEY found, so the iPad voice is used.' });
      const out = await lineAudio(line.id);
      res.json({ ...line, ok: out.status === 200, hint: out.error?.hint, detail: out.error?.detail });
    } catch (e) {
      next(e);
    }
  });

  // ------------------------------------------------------------- account
  r.post('/password', async (req, res, next) => {
    try {
      const f = await one(`SELECT password_hash FROM families WHERE id = $1`, [fam(req)]);
      if (!(await checkSecret(req.body?.current || '', f.password_hash))) return res.status(401).json({ error: 'Current password not right' });
      if (String(req.body?.next || '').length < 8) return res.status(400).json({ error: 'New password needs at least 8 characters' });
      await q(`UPDATE families SET password_hash = $2 WHERE id = $1`, [fam(req), await hashSecret(req.body.next)]);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // Delete the whole family account and every file.
  r.delete('/account', async (req, res, next) => {
    try {
      const f = await one(`SELECT password_hash FROM families WHERE id = $1`, [fam(req)]);
      if (!(await checkSecret(req.body?.password || '', f.password_hash))) return res.status(401).json({ error: 'Password not right' });
      const vids = await many(`SELECT v.* FROM videos v JOIN kids k ON k.id = v.kid_id WHERE k.family_id = $1`, [fam(req)]);
      for (const v of vids) await deleteVideoFiles(v);
      await q(`DELETE FROM families WHERE id = $1`, [fam(req)]);
      await endSession(req, res);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // ------------------------------------------------------------- Dibbly Dobs
  // Every Dob earned or spent, newest first, with what they did.
  r.get('/dobs', async (req, res, next) => {
    try {
      const kids = await many(`SELECT * FROM kids WHERE family_id = $1 ORDER BY id`, [fam(req)]);
      const feed = await many(
        `SELECT e.*, k.channel_name FROM events e JOIN kids k ON k.id = e.kid_id
          WHERE k.family_id = $1 AND e.dobs <> 0 ORDER BY e.created_at DESC LIMIT 150`,
        [fam(req)]
      );
      res.json({ kids: kids.map(kidForParent), feed: feed.map((e) => ({ ...eventForClient(e), kidId: e.kid_id, channelName: e.channel_name })) });
    } catch (e) {
      next(e);
    }
  });

  // Good behaviour (+), naughty (−), spent at the shops (−), or anything else.
  r.post('/dobs/adjust', async (req, res, next) => {
    try {
      const { kidId, amount, reason, note } = req.body || {};
      const k = await one(`SELECT id, dobs FROM kids WHERE id = $1 AND family_id = $2`, [Number(kidId), fam(req)]);
      if (!k) return res.status(404).json({ error: 'Not found' });
      const n = Math.round(Number(amount));
      if (!n || Math.abs(n) > 500) return res.status(400).json({ error: 'Enter an amount' });
      const kinds = { good: 'Good behaviour', naughty: 'Naughty', spent: 'Spent at the shops', other: 'Grown-up' };
      const type = kinds[reason] ? `parent-${reason}` : 'parent-other';
      const signed = reason === 'naughty' || reason === 'spent' ? -Math.abs(n) : reason === 'good' ? Math.abs(n) : n;
      if (signed < 0 && k.dobs + signed < 0 && reason === 'spent') return res.status(400).json({ error: `Only ${k.dobs} Dibbly Dobs to spend` });
      const out = await tx((c) => grant(c, k.id, type, { dobs: signed, note: String(note || '').slice(0, 120) || null, byParent: true, meta: { what: kinds[reason] || kinds.other } }));
      res.json(out);
    } catch (e) {
      next(e);
    }
  });

  // ------------------------------------------------------------- letters
  r.get('/letters', async (req, res, next) => {
    try {
      const rows = await many(
        `SELECT l.*, f.channel_name AS from_name, t.channel_name AS to_name FROM letters l
           JOIN kids f ON f.id = l.from_kid LEFT JOIN kids t ON t.id = l.to_kid
          WHERE (f.family_id = $1 AND l.status = 'pending') OR l.to_family = $1
          ORDER BY (l.status = 'pending') DESC, l.created_at DESC LIMIT 60`,
        [fam(req)]
      );
      res.json({
        letters: rows.map((l) => ({ id: l.id, from: l.from_name, to: l.to_family ? 'You' : l.to_name, topic: l.topic, body: l.body, status: l.status, toMe: Boolean(l.to_family), at: l.created_at })),
      });
    } catch (e) {
      next(e);
    }
  });

  const ownLetter = (req) =>
    one(`SELECT l.* FROM letters l JOIN kids f ON f.id = l.from_kid WHERE l.id = $1 AND f.family_id = $2 AND l.status = 'pending'`, [Number(req.params.id), fam(req)]);

  r.post('/letters/:id/approve', async (req, res, next) => {
    try {
      const l = await ownLetter(req);
      if (!l) return res.status(404).json({ error: 'Not found' });
      await q(`UPDATE letters SET status = 'delivered' WHERE id = $1`, [l.id]);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  r.post('/letters/:id/reject', async (req, res, next) => {
    try {
      const l = await ownLetter(req);
      if (!l) return res.status(404).json({ error: 'Not found' });
      await q(`UPDATE letters SET status = 'rejected' WHERE id = $1`, [l.id]);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // ------------------------------------------------------------- spelling & maths stats
  r.get('/practice-stats', async (req, res, next) => {
    try {
      const kids = await many(`SELECT * FROM kids WHERE family_id = $1 ORDER BY id`, [fam(req)]);
      const out = [];
      for (const k of kids) {
        const sets = await many(`SELECT * FROM practice_sets WHERE kid_id = $1 AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 200`, [k.id]);
        const spelling = sets.filter((s) => s.kind === 'spelling');
        const tricky = {};
        for (const s of spelling) s.items.forEach((it, i) => {
          const r2 = s.results?.[i];
          if (r2 && (!r2.correct || r2.gaveUp || r2.tries > 1)) tricky[it.word] = (tricky[it.word] || 0) + 1;
        });
        const maths = MATHS_TYPES.map((t) => {
          const ss = sets.filter((s) => s.kind === 'maths' && s.type === t.id);
          const right = ss.reduce((a, s) => a + (s.score || 0), 0);
          const total = ss.reduce((a, s) => a + s.items.length, 0);
          return { type: t.id, name: t.name, sets: ss.length, accuracy: total ? Math.round((100 * right) / total) : null };
        });
        const letters = await one(`SELECT count(*)::int AS n FROM letters WHERE from_kid = $1`, [k.id]);
        const stories = await one(`SELECT count(*)::int AS n, COALESCE(sum(reads),0)::int AS reads FROM stories WHERE kid_id = $1`, [k.id]);
        out.push({
          kidId: k.id,
          channelName: k.channel_name,
          spelling: {
            sets: spelling.length,
            accuracy: spelling.length ? Math.round((100 * spelling.reduce((a, s) => a + (s.score || 0), 0)) / spelling.reduce((a, s) => a + s.items.length, 0)) : null,
            tricky: Object.entries(tricky).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([word, times]) => ({ word, times })),
          },
          maths,
          writing: letters.n,
          stories: stories.n,
          storyReads: stories.reads,
          mathsSettings: mathsSettings(k.settings),
        });
      }
      res.json({ kids: out });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
