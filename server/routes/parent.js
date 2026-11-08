// The grown-ups' dashboard API (requires the parent password, 30-minute window).
import express from 'express';
import { q, one, many, tx } from '../db.js';
import { requireParent, hashSecret, checkSecret, validPin, endSession } from '../auth.js';
import { dayISO, addDays, isISODate } from '../lib/dates.js';
import { TRACKS, KEYWORDS_PER_BRIEF, chooseKeywords, getBrief, saveBrief, sampleFor } from '../lib/briefs.js';
import { familySettings, familyManagesScope, scopeMembers, randomCode } from '../lib/family.js';
import { wordsFor, pickWords, YEAR_GROUPS, YEAR_LABELS } from '../data/wordBank.js';
import { claudeEnabled, generateBrief, generateLittleFromMain, briefProblems, MODEL } from '../ai/claude.js';
import { voiceEnabled, listVoices, registerLine, lineAudio, DEFAULT_VOICE } from '../ai/voice.js';
import { transcribeEnabled } from '../ai/transcribe.js';
import { rateLimit } from '../lib/rateLimit.js';
import { videoForClient } from '../lib/videos.js';
import { storageKind } from '../media/storage.js';
import { deleteVideoFiles } from './kid.js';
import { AVATAR_DEFAULT, FREE_ITEMS } from '../lib/catalog.js';
import { DOB_ACTIVITIES, dobRules, grant } from '../lib/rewards.js';
import { TIMES_TABLES, BOND_TARGETS, mathsSettings, MATHS_TYPES } from '../lib/maths.js';
import { eventForClient } from './learn.js';

const MAX_CREW = 4;
const TRACK_OPTIONS = ['star', 'little', 'family'];

const cleanWords = (list) =>
  [...new Set((Array.isArray(list) ? list : String(list || '').split(/[\s,;]+/))
    .map((w) => String(w).toLowerCase().replace(/[^a-z'-]/g, '').trim())
    .filter((w) => w.length >= 2 && w.length <= 24))].slice(0, 30);

const kidForParent = (k) => ({
  id: k.id,
  name: k.name,
  channelName: k.channel_name,
  track: k.track,
  yearGroup: k.year_group,
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
      const f = await one(`SELECT email FROM families WHERE id = $1`, [fam(req)]);
      res.json({
        email: f.email,
        claude: claudeEnabled(),
        model: MODEL,
        voice: voiceEnabled(),
        transcribe: transcribeEnabled(),
        storage: storageKind(),
        today: dayISO(),
        tomorrow: addDays(dayISO(), 1),
        yearGroups: YEAR_GROUPS.map((id) => ({ id, label: YEAR_LABELS[id] })),
        keywordsPerBrief: KEYWORDS_PER_BRIEF,
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
      const { name, channelName, pin, track = 'star', yearGroup } = req.body || {};
      if (!String(name || '').trim()) return res.status(400).json({ error: 'Add a name (only you will see it)' });
      if (!String(channelName || '').trim()) return res.status(400).json({ error: 'Add a channel name' });
      if (!validPin(String(pin || ''))) return res.status(400).json({ error: 'The PIN must be 4 digits' });
      if (!TRACK_OPTIONS.includes(track)) return res.status(400).json({ error: 'Bad mode' });
      const count = await one(`SELECT count(*)::int AS n FROM kids WHERE family_id = $1`, [fam(req)]);
      if (count.n >= 6) return res.status(400).json({ error: 'Up to 6 profiles per family' });
      const yg = YEAR_GROUPS.includes(yearGroup) ? yearGroup : track === 'little' ? 'R' : 'Y3';
      const k = await one(
        `INSERT INTO kids (family_id, name, channel_name, track, year_group, pin_hash, avatar, owned)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [fam(req), String(name).trim().slice(0, 40), String(channelName).trim().slice(0, 30), track, yg, await hashSecret(pin), AVATAR_DEFAULT, JSON.stringify(FREE_ITEMS)]
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

  // ------------------------------------------------------------- keywords & studio settings
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
      const f = await one(`SELECT settings FROM families WHERE id = $1`, [fam(req)]);
      const cur = familySettings(f.settings);
      const b = req.body || {};
      const nxt = { ...f.settings, ...cur };
      if (b.directorVoiceId !== undefined) nxt.directorVoiceId = b.directorVoiceId ? String(b.directorVoiceId).slice(0, 60) : null;
      for (const t of TRACKS) {
        if (!b[t]) continue;
        const s = { ...cur[t] };
        if (YEAR_GROUPS.includes(b[t].yearGroup)) s.yearGroup = b[t].yearGroup;
        if (b[t].weeklyWords !== undefined) s.weeklyWords = cleanWords(b[t].weeklyWords);
        if (b[t].todayWords && typeof b[t].todayWords === 'object') {
          const tw = {};
          for (const [d, words] of Object.entries(b[t].todayWords)) {
            if (isISODate(d) && d >= addDays(dayISO(), -1)) {
              const w = cleanWords(words);
              if (w.length) tw[d] = w;
            }
          }
          s.todayWords = tw;
        }
        nxt[t] = s;
      }
      await q(`UPDATE families SET settings = $2 WHERE id = $1`, [fam(req), nxt]);
      res.json(familySettings(nxt));
    } catch (e) {
      next(e);
    }
  });

  r.get('/wordbank/suggest', (req, res) => {
    const little = req.query.track === 'little';
    const n = Math.min(Number(req.query.n) || 10, 20);
    res.json({ words: pickWords(wordsFor(String(req.query.year || 'Y3'), { little }), n) });
  });

  // ------------------------------------------------------------- daily briefs
  // Which briefs this family writes: their own (kids not in a crew) + crews they host.
  r.get('/briefs/scopes', async (req, res, next) => {
    try {
      const scopes = [];
      const own = await scopeMembers(`f:${fam(req)}`);
      if (own.length) scopes.push({ scope: `f:${fam(req)}`, label: 'My family', members: own.map((k) => k.channel_name) });
      for (const c of await many(`SELECT * FROM crews WHERE owner_family_id = $1 ORDER BY id`, [fam(req)])) {
        const m = await scopeMembers(`c:${c.id}`);
        scopes.push({ scope: `c:${c.id}`, label: `Crew: ${c.name}`, members: m.map((k) => k.channel_name) });
      }
      // Crews my kids are in but someone else hosts (read-only note).
      const guest = await many(
        `SELECT DISTINCT c.name FROM crews c JOIN crew_members m ON m.crew_id = c.id JOIN kids k ON k.id = m.kid_id
          WHERE k.family_id = $1 AND c.owner_family_id <> $1`,
        [fam(req)]
      );
      res.json({ scopes, hostedElsewhere: guest.map((g) => g.name) });
    } catch (e) {
      next(e);
    }
  });

  const checkScope = async (req, res, scope) => {
    if (typeof scope !== 'string' || !(await familyManagesScope(fam(req), scope))) {
      res.status(403).json({ error: 'You can only manage your family or crews you host' });
      return false;
    }
    return true;
  };

  r.get('/briefs', async (req, res, next) => {
    try {
      const { scope } = req.query;
      if (!(await checkScope(req, res, scope))) return;
      const date = isISODate(req.query.date) ? req.query.date : dayISO();
      const [star, little] = await Promise.all(TRACKS.map((t) => getBrief(scope, date, t)));
      res.json({ date, star, little, samples: { star: sampleFor('star', date), little: sampleFor('little', date) } });
    } catch (e) {
      next(e);
    }
  });

  r.post('/briefs/generate', rateLimit({ perMinute: 8 }), async (req, res, next) => {
    try {
      const { scope, date, track, theme } = req.body || {};
      if (!(await checkScope(req, res, scope))) return;
      if (!isISODate(date) || !TRACKS.includes(track)) return res.status(400).json({ error: 'Bad date or track' });
      if (!claudeEnabled()) return res.status(503).json({ error: 'Add ANTHROPIC_API_KEY in Replit Secrets to write briefs with Claude.' });
      const keywords = (await chooseKeywords(scope, date, track)).keywords;
      let out;
      const main = track === 'little' ? await getBrief(scope, date, 'star') : null;
      if (main && !theme) out = await generateLittleFromMain({ main, keywords });
      else out = await generateBrief({ track, keywords, theme: typeof theme === 'string' ? theme.slice(0, 120) : '' });
      const saved = await saveBrief({ scope, date, track, status: 'draft', title: out.title, text: out.text, keywords, chunks: out.chunks, picture: out.picture, source: 'claude' });
      res.json({ brief: saved, problems: out.problems });
    } catch (e) {
      next(e);
    }
  });

  r.put('/briefs', async (req, res, next) => {
    try {
      const { scope, date, track, title, text, keywords } = req.body || {};
      if (!(await checkScope(req, res, scope))) return;
      if (!isISODate(date) || !TRACKS.includes(track)) return res.status(400).json({ error: 'Bad date or track' });
      const cur = await getBrief(scope, date, track);
      const kws = keywords ? cleanWords(keywords) : cur?.keywords || [];
      const body = String(text || '').trim().slice(0, 600);
      if (!body) return res.status(400).json({ error: 'The brief is empty' });
      const saved = await saveBrief({
        scope, date, track, status: 'draft',
        title: String(title || cur?.title || 'Today').trim().slice(0, 40),
        text: body, keywords: kws, chunks: cur?.chunks || {}, picture: cur?.picture, source: 'edited',
      });
      res.json({ brief: saved, problems: briefProblems(body, kws, track) });
    } catch (e) {
      next(e);
    }
  });

  r.post('/briefs/approve', async (req, res, next) => {
    try {
      const { scope, date, track } = req.body || {};
      if (!(await checkScope(req, res, scope))) return;
      const cur = isISODate(date) && TRACKS.includes(track) ? await getBrief(scope, date, track) : null;
      if (!cur) return res.status(404).json({ error: 'Nothing to approve yet' });
      const problems = briefProblems(cur.text, cur.keywords, track).filter((p) => p.includes('keyword'));
      if (problems.length) return res.status(400).json({ error: problems.join(' ') });
      res.json({ brief: await saveBrief({ ...cur, status: 'approved' }) });
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
      await q(`DELETE FROM briefs WHERE scope = $1`, [`f:${fam(req)}`]);
      await q(`DELETE FROM families WHERE id = $1`, [fam(req)]);
      await endSession(req, res);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // ------------------------------------------------------------- Dibbly Dobs
  r.get('/dob-rules', async (req, res, next) => {
    try {
      const f = await one(`SELECT settings FROM families WHERE id = $1`, [fam(req)]);
      res.json({ activities: DOB_ACTIVITIES, rules: dobRules(f.settings) });
    } catch (e) {
      next(e);
    }
  });

  r.put('/dob-rules', async (req, res, next) => {
    try {
      const f = await one(`SELECT settings FROM families WHERE id = $1`, [fam(req)]);
      const rules = dobRules({ dobRules: { ...dobRules(f.settings), ...(req.body?.rules || {}) } });
      await q(`UPDATE families SET settings = settings || $2::jsonb WHERE id = $1`, [fam(req), JSON.stringify({ dobRules: rules })]);
      res.json({ rules });
    } catch (e) {
      next(e);
    }
  });

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
