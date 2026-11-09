// Everything a logged-in child can do.
import express from 'express';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import { q, one, many, tx } from '../db.js';
import { requireKid, requireDevice } from '../auth.js';
import { dayISO, weekStartISO, weekday, localHour, PREMIERE_HOUR } from '../lib/dates.js';
import { briefForKid } from '../lib/briefs.js';
import { scopeForKid, crewForKid, scopeMembers, publicKid, familySettings } from '../lib/family.js';
import { grant, markDaily, spend, nextStreak, DOB_VALUES, BONUS, VIRAL_CHANCE } from '../lib/rewards.js';
import { later, notifyFamily } from '../lib/notify.js';
import { SHOP, STICKERS, AWARDS, cleanAvatar } from '../lib/catalog.js';
import { premiereState, videoForClient } from '../lib/videos.js';
import { rateLimit } from '../lib/rateLimit.js';
import { nextTurn } from '../ai/director.js';
import { registerLine, lineAudio } from '../ai/voice.js';
import { putFile, receiveUpload, removeFile, seedCache } from '../media/storage.js';
import { renderVideo, renderReel, probe, planEarly } from '../media/render.js';
import { signedUrl } from '../media/signed.js';

const MAX_UPLOAD = 300 * 1024 * 1024;
const pickTrack = (kid, wanted) => (kid.track === 'family' ? (wanted === 'little' ? 'little' : 'star') : kid.track);

async function voiceIdFor(kid) {
  const f = await one(`SELECT settings FROM families WHERE id = $1`, [kid.family_id]);
  return familySettings(f?.settings).directorVoiceId;
}

export function kidRouter() {
  const r = express.Router();

  // Director audio is fetched by unguessable line id (issued only to this app).
  r.get('/director/audio/:id', requireDevice, async (req, res, next) => {
    try {
      const out = await lineAudio(req.params.id);
      if (out.status !== 200) return res.status(out.status).end();
      res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=3600' }).send(out.audio);
    } catch (e) {
      next(e);
    }
  });

  r.use('/kid', requireKid);

  // ---------------------------------------------------------------- today
  r.get('/kid/today', async (req, res, next) => {
    try {
      const kid = req.kid;
      const date = dayISO();
      const tracks = kid.track === 'family' ? ['star', 'little'] : [kid.track];
      const briefs = {};
      for (const t of tracks) briefs[t] = await briefForKid(kid, { track: t, date });
      const events = await many(`SELECT type FROM events WHERE kid_id = $1 AND event_date = $2`, [kid.id, date]);
      const video = await one(
        `SELECT * FROM videos WHERE kid_id = $1 AND brief_date = $2 ORDER BY (status IN ('submitted','approved')) DESC, created_at DESC LIMIT 1`,
        [kid.id, date]
      );
      const crew = await crewForKid(kid.id);
      res.json({
        date,
        kid: publicKid(kid, { self: true }),
        briefs,
        progress: {
          read: events.some((e) => e.type === 'read'),
          word: events.some((e) => e.type === 'word'),
          posted: Boolean(video && ['submitted', 'approved', 'rejected'].includes(video.status)),
          video: video ? videoForClient(video, { owner: true }) : null,
        },
        crew: crew ? { id: crew.id, name: crew.name } : null,
        premiereHour: PREMIERE_HOUR,
      });
    } catch (e) {
      next(e);
    }
  });

  r.post('/kid/read', async (req, res, next) => {
    try {
      const s = req.body?.stats || {};
      const list = (v) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 30)).slice(0, 60) : []);
      await q(
        `INSERT INTO reading_logs (kid_id, brief_title, words_read, total_words, helped, keywords, keywords_read, keywords_forced, grown_up_skip)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [req.kid.id, String(req.body?.briefTitle || '').slice(0, 80), Math.max(0, Number(s.wordsRead) || 0), Math.max(0, Number(s.totalWords) || 0),
          JSON.stringify(list(s.helpedWords)), JSON.stringify(list(s.keywords)), JSON.stringify(list(s.keywordsRead)), JSON.stringify(list(s.keywordsForced)), Boolean(s.grownUpSkip)]
      );
      res.json(await markDaily(req.kid.id, 'read'));
    } catch (e) {
      next(e);
    }
  });

  r.post('/kid/word', async (req, res, next) => {
    try {
      res.json(await markDaily(req.kid.id, 'word', { result: req.body?.result || {} }));
    } catch (e) {
      next(e);
    }
  });

  // ---------------------------------------------------------------- director call
  r.post('/kid/director/turn', rateLimit({ perMinute: 40 }), async (req, res, next) => {
    try {
      const kid = req.kid;
      const track = pickTrack(kid, req.body?.track);
      const brief = await briefForKid(kid, { track });
      const history = (Array.isArray(req.body?.history) ? req.body.history : [])
        .slice(-20)
        .map((h) => ({ who: h.who === 'kid' ? 'kid' : 'director', text: String(h.text || '').slice(0, 400) }));
      const out = await nextTurn({ brief, channelName: kid.channel_name, history, plan: req.body?.plan || {}, little: track === 'little' });
      res.json({ ...out, line: registerLine(out.say, await voiceIdFor(kid)) });
    } catch (e) {
      next(e);
    }
  });

  // Little Stars: the Director reads the brief first.
  r.post('/kid/director/read-brief', async (req, res, next) => {
    try {
      const brief = await briefForKid(req.kid, { track: pickTrack(req.kid, req.body?.track) });
      res.json({ line: registerLine(brief.text, await voiceIdFor(req.kid)) });
    } catch (e) {
      next(e);
    }
  });

  // ---------------------------------------------------------------- videos
  r.post('/kid/videos', async (req, res, next) => {
    try {
      const kid = req.kid;
      const date = dayISO();
      const posted = await one(`SELECT 1 FROM videos WHERE kid_id = $1 AND brief_date = $2 AND status IN ('submitted','approved')`, [kid.id, date]);
      if (posted) return res.status(409).json({ error: "You've already posted today's video. New challenge tomorrow!" });
      const track = pickTrack(kid, req.body?.track);
      const scope = await scopeForKid(kid); // the crew: who sees the video at the premiere
      const brief = await briefForKid(kid, { track, date });
      // Only one draft per day: replace older unposted takes.
      const old = await many(`SELECT * FROM videos WHERE kid_id = $1 AND brief_date = $2 AND status NOT IN ('submitted','approved','rejected')`, [kid.id, date]);
      for (const o of old) await deleteVideoFiles(o);
      await q(`DELETE FROM videos WHERE kid_id = $1 AND brief_date = $2 AND status NOT IN ('submitted','approved','rejected')`, [kid.id, date]);
      const id = crypto.randomBytes(12).toString('base64url').replace(/[^a-zA-Z0-9]/g, 'x');
      const plan = req.body?.plan && typeof req.body.plan === 'object' ? req.body.plan : {};
      const title = String(req.body?.title || brief.title).slice(0, 40);
      await q(
        `INSERT INTO videos (id, kid_id, scope, brief_date, brief, title, plan, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'new')`,
        [id, kid.id, scope, date, { title: brief.title, text: brief.text, keywords: brief.keywords, track }, title, plan]
      );
      // Start planning the edit now, while the video uploads.
      const seconds = Number(req.body?.seconds);
      if (seconds > 0 && seconds <= 70) {
        planEarly(id, { brief: { title: brief.title, text: brief.text, keywords: brief.keywords, track }, plan, title, channelName: kid.channel_name, seconds });
      }
      res.json({ id });
    } catch (e) {
      next(e);
    }
  });

  r.put('/kid/videos/:id/raw', async (req, res, next) => {
    let tmp = null;
    try {
      const v = await one(`SELECT * FROM videos WHERE id = $1 AND kid_id = $2`, [req.params.id, req.kid.id]);
      if (!v) return res.status(404).json({ error: 'Video not found' });
      if (v.status !== 'new') return res.status(409).json({ error: 'Already uploaded' });
      const mime = String(req.get('content-type') || 'video/mp4').split(';')[0];
      if (!/^video\//.test(mime)) return res.status(400).json({ error: 'Not a video' });
      const up = await receiveUpload(req, MAX_UPLOAD);
      tmp = up.file;
      const { seconds } = await probe(tmp);
      if (seconds < 0.5) return res.status(400).json({ error: 'That video looks empty. Try filming again.' });
      const ext = mime.includes('webm') ? 'webm' : 'mp4';
      const key = `videos/${v.id}/raw.${ext}`;
      // The edit starts straight away from the file we just received (no download from storage);
      // the original is saved to storage at the same time.
      await seedCache(key, tmp);
      const saving = putFile(key, tmp);
      await q(`UPDATE videos SET raw_key = $2, raw_mime = $3, status = 'uploaded', seconds = $4 WHERE id = $1`, [v.id, key, mime, Math.round(seconds)]);
      // Keep this request open until the edit is done: on Replit Autoscale the server only gets
      // full computing power while a request is open, so a background edit crawls.
      await Promise.race([renderVideo(v.id), new Promise((r) => setTimeout(r, 4 * 60 * 1000))]);
      await saving;
      res.json({ ok: true });
    } catch (e) {
      next(e);
    } finally {
      if (tmp) fsp.rm(tmp, { force: true }).catch(() => {});
    }
  });

  r.get('/kid/videos/:id', async (req, res, next) => {
    try {
      const v = await one(`SELECT * FROM videos WHERE id = $1 AND kid_id = $2`, [req.params.id, req.kid.id]);
      if (!v) return res.status(404).json({ error: 'Video not found' });
      res.json({ video: videoForClient(v, { owner: true }) });
    } catch (e) {
      next(e);
    }
  });

  r.post('/kid/videos/:id/remix', async (req, res, next) => {
    try {
      const v = await one(`SELECT * FROM videos WHERE id = $1 AND kid_id = $2`, [req.params.id, req.kid.id]);
      if (!v) return res.status(404).json({ error: 'Video not found' });
      if (v.status !== 'ready') return res.status(409).json({ error: 'The edit is not ready yet' });
      if (v.remixes >= 1) return res.status(409).json({ error: 'You already used your remix' });
      await q(`UPDATE videos SET status = 'rendering' WHERE id = $1`, [v.id]);
      await Promise.race([renderVideo(v.id, { remix: true }), new Promise((r) => setTimeout(r, 4 * 60 * 1000))]);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // Post = send for the grown-up's approval. Dibbly Dobs are earned now.
  r.post('/kid/videos/:id/post', async (req, res, next) => {
    try {
      const out = await tx(async (c) => {
        const v = (await c.query(`SELECT * FROM videos WHERE id = $1 AND kid_id = $2 FOR UPDATE`, [req.params.id, req.kid.id])).rows[0];
        if (!v) return { status: 404, body: { error: 'Video not found' } };
        if (v.status !== 'ready') return { status: 409, body: { error: 'The edit is not ready yet' } };
        const dup = (await c.query(`SELECT 1 FROM videos WHERE kid_id = $1 AND brief_date = $2 AND status IN ('submitted','approved') AND id <> $3`, [v.kid_id, v.brief_date, v.id])).rows[0];
        if (dup) return { status: 409, body: { error: 'Already posted today' } };
        const viral = Math.random() < VIRAL_CHANCE;
        const kws = (v.keywords_said || []).slice(0, 3);
        const dobs = DOB_VALUES.studio * (viral ? 2 : 1) + kws.length * BONUS.keyword;
        const k = (await c.query(`SELECT last_post_date, streak, best_streak FROM kids WHERE id = $1 FOR UPDATE`, [v.kid_id])).rows[0];
        const streak = nextStreak(k.last_post_date, k.streak);
        await c.query(`UPDATE kids SET streak = $2, best_streak = GREATEST(best_streak, $2), last_post_date = $3 WHERE id = $1`, [v.kid_id, streak, dayISO()]);
        const what = `Posted “${v.title || v.brief?.title}”${viral ? ' (viral hit: double Dobs!)' : ''}${kws.length ? ` + said ${kws.length} unlock word${kws.length > 1 ? 's' : ''} on camera` : ''}`;
        const g = await grant(c, v.kid_id, 'studio', { dobs, meta: { what, video: v.id, viral, keywords: kws }, quiet: true });
        await c.query(`UPDATE videos SET status = 'submitted', submitted_at = now(), viral = $2, followers_awarded = $3 WHERE id = $1`, [v.id, viral, dobs]);
        const title = v.title || v.brief?.title || 'today’s video';
        later(() =>
          notifyFamily(req.kid.family_id, 'approvals', {
            title: 'A video is ready to approve',
            body: `${req.kid.name} posted “${title}” and earned ${dobs === 1 ? '1 Dob' : `${dobs} Dobs`}. Tap to watch and approve.`,
            url: '/parent?tab=approvals',
          })
        );
        return { status: 200, body: { ...g, viral, keywordsSaid: kws, streak } };
      });
      res.status(out.status).json(out.body);
    } catch (e) {
      next(e);
    }
  });

  r.get('/kid/channel', async (req, res, next) => {
    try {
      const vids = await many(`SELECT * FROM videos WHERE kid_id = $1 AND status IN ('submitted','approved','rejected','ready') ORDER BY created_at DESC LIMIT 60`, [req.kid.id]);
      res.json({ kid: publicKid(req.kid, { self: true }), videos: vids.map((v) => videoForClient(v, { owner: true })) });
    } catch (e) {
      next(e);
    }
  });

  // ---------------------------------------------------------------- studio & shop
  r.get('/kid/shop', (req, res) => {
    res.json({ items: SHOP, owned: req.kid.owned, dobs: req.kid.dobs, avatar: req.kid.avatar, decor: req.kid.decor });
  });

  r.post('/kid/shop/buy', async (req, res, next) => {
    try {
      const item = SHOP.find((i) => i.id === req.body?.itemId);
      if (!item) return res.status(404).json({ error: 'Item not found' });
      if (req.kid.owned.includes(item.id)) return res.status(409).json({ error: 'You already have it' });
      const out = await spend(req.kid.id, item.price, 'buy', { item: item.id, what: `Bought ${item.name}` });
      if (!out) return res.status(402).json({ error: 'Not enough Dibbly Dobs yet!' });
      const k = await one(`UPDATE kids SET owned = owned || $2::jsonb WHERE id = $1 RETURNING owned, dobs`, [req.kid.id, JSON.stringify([item.id])]);
      res.json({ owned: k.owned, dobs: k.dobs });
    } catch (e) {
      next(e);
    }
  });

  r.put('/kid/avatar', async (req, res, next) => {
    try {
      const avatar = cleanAvatar(req.body?.avatar, req.kid.owned);
      const k = await one(`UPDATE kids SET avatar = $2 WHERE id = $1 RETURNING avatar`, [req.kid.id, avatar]);
      res.json({ avatar: k.avatar });
    } catch (e) {
      next(e);
    }
  });

  r.put('/kid/decor', async (req, res, next) => {
    try {
      const decor = (Array.isArray(req.body?.decor) ? req.body.decor : []).filter((id) => req.kid.owned.includes(id) && id.startsWith('decor-'));
      const k = await one(`UPDATE kids SET decor = $2 WHERE id = $1 RETURNING decor`, [req.kid.id, JSON.stringify([...new Set(decor)])]);
      res.json({ decor: k.decor });
    } catch (e) {
      next(e);
    }
  });

  // ---------------------------------------------------------------- crew: premiere, reactions, awards
  r.get('/kid/crew', async (req, res, next) => {
    try {
      const kid = req.kid;
      const scope = await scopeForKid(kid);
      const crew = await crewForKid(kid.id);
      const members = await scopeMembers(scope);
      const date = String(req.query.date || dayISO());
      const state = await premiereState(scope, date);
      const vids = await many(`SELECT * FROM videos WHERE scope = $1 AND brief_date = $2 AND status IN ('submitted','approved')`, [scope, date]);
      const reactions = vids.length
        ? await many(`SELECT video_id, sticker, kid_id FROM reactions WHERE video_id = ANY($1)`, [vids.map((v) => v.id)])
        : [];
      const awards = await many(`SELECT * FROM awards WHERE scope = $1 AND award_date = $2`, [scope, date]);
      const feed = members.map((m) => {
        const v = vids.find((x) => x.kid_id === m.id);
        const visible = v && v.status === 'approved' && (state.revealed || m.id === kid.id);
        return {
          kid: publicKid(m),
          me: m.id === kid.id,
          state: !v ? 'not-posted' : v.status === 'submitted' ? 'waiting-approval' : visible ? 'revealed' : 'locked',
          video: visible ? videoForClient(v) : null,
          reactions: visible
            ? STICKERS.map((s) => ({ sticker: s, count: reactions.filter((x) => x.video_id === v.id && x.sticker === s).length, mine: reactions.some((x) => x.video_id === v.id && x.sticker === s && x.kid_id === kid.id) }))
            : [],
          awards: awards.filter((a) => a.to_kid === m.id).map((a) => a.award),
        };
      });
      const wd = weekday(dayISO());
      const week = weekStartISO();
      const reel = crew ? await one(`SELECT * FROM reels WHERE scope = $1 AND week_start = $2`, [scope, week]) : null;
      res.json({
        date,
        crew: crew ? { id: crew.id, name: crew.name } : null,
        revealed: state.revealed,
        revealReason: state.reason,
        premiereHour: PREMIERE_HOUR,
        hourNow: localHour(),
        feed,
        stickers: STICKERS,
        awardTypes: AWARDS,
        myAward: awards.find((a) => a.from_kid === kid.id) || null,
        premiereNight: {
          available: Boolean(crew) && (wd === 5 || wd === 6 || wd === 0),
          status: reel?.status || null,
          url: reel?.status === 'ready' ? signedUrl('reel', `${scope}|${week}`) : null,
        },
      });
    } catch (e) {
      next(e);
    }
  });

  r.post('/kid/react', async (req, res, next) => {
    try {
      const { videoId, sticker } = req.body || {};
      if (!STICKERS.includes(sticker)) return res.status(400).json({ error: 'Unknown sticker' });
      const v = await one(`SELECT * FROM videos WHERE id = $1 AND status = 'approved'`, [videoId]);
      const scope = await scopeForKid(req.kid);
      if (!v || v.scope !== scope) return res.status(404).json({ error: 'Video not found' });
      if (!(await premiereState(scope, v.brief_date)).revealed && v.kid_id !== req.kid.id) return res.status(409).json({ error: 'Not premiered yet' });
      const del = await q(`DELETE FROM reactions WHERE video_id = $1 AND kid_id = $2 AND sticker = $3`, [v.id, req.kid.id, sticker]);
      if (!del.rowCount) await q(`INSERT INTO reactions (video_id, kid_id, sticker) VALUES ($1,$2,$3)`, [v.id, req.kid.id, sticker]);
      res.json({ on: !del.rowCount });
    } catch (e) {
      next(e);
    }
  });

  r.post('/kid/award', async (req, res, next) => {
    try {
      const { videoId, award } = req.body || {};
      if (!AWARDS.some((a) => a.id === award)) return res.status(400).json({ error: 'Unknown award' });
      const scope = await scopeForKid(req.kid);
      const v = await one(`SELECT * FROM videos WHERE id = $1 AND status = 'approved' AND scope = $2`, [videoId, scope]);
      if (!v) return res.status(404).json({ error: 'Video not found' });
      if (v.kid_id === req.kid.id) return res.status(400).json({ error: 'Give your award to someone else!' });
      if (!(await premiereState(scope, v.brief_date)).revealed) return res.status(409).json({ error: 'Not premiered yet' });
      const out = await tx(async (c) => {
        const ins = await c.query(
          `INSERT INTO awards (scope, award_date, from_kid, to_kid, video_id, award) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (from_kid, award_date) DO NOTHING RETURNING id`,
          [scope, dayISO(), req.kid.id, v.kid_id, v.id, award]
        );
        if (!ins.rowCount) return null;
        const name = AWARDS.find((a) => a.id === award)?.name;
        await grant(c, v.kid_id, 'award', { dobs: BONUS.award, meta: { award, from: req.kid.id, what: `Won “${name}” from ${req.kid.channel_name}` } });
        return true;
      });
      if (!out) return res.status(409).json({ error: "You've already given today's award" });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  r.post('/kid/premiere-night', async (req, res, next) => {
    try {
      const crew = await crewForKid(req.kid.id);
      if (!crew) return res.status(400).json({ error: 'Join a crew first' });
      const wd = weekday(dayISO());
      if (!(wd === 5 || wd === 6 || wd === 0)) return res.status(409).json({ error: 'Premiere Night is on Friday!' });
      const scope = `c:${crew.id}`;
      const week = weekStartISO();
      const cur = await one(`SELECT * FROM reels WHERE scope = $1 AND week_start = $2`, [scope, week]);
      if (cur?.status === 'rendering') return res.json({ status: 'rendering' });
      await q(
        `INSERT INTO reels (scope, week_start, status) VALUES ($1,$2,'rendering')
         ON CONFLICT (scope, week_start) DO UPDATE SET status = 'rendering', error = NULL`,
        [scope, week]
      );
      renderReel(scope, week, crew.name);
      res.json({ status: 'rendering' });
    } catch (e) {
      next(e);
    }
  });

  return r;
}

export async function deleteVideoFiles(v) {
  for (const key of [v.raw_key, v.final_key, v.thumb_key]) await removeFile(key);
}
