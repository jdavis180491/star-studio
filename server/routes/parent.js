import express from 'express';
import { parentLogin, requireParent } from '../lib/parentAuth.js';
import { dayISO, addDays, isISODate } from '../lib/dates.js';
import { TRACKS, chooseKeywords, sampleFor, KEYWORDS_PER_BRIEF } from '../lib/briefs.js';
import { wordsFor, pickWords, YEAR_GROUPS, YEAR_LABELS } from '../data/wordBank.js';
import { claudeEnabled, generateBrief, briefProblems, MODEL } from '../ai/claude.js';
import { voiceEnabled, listVoices, registerLine, lineAudio, voiceStatus, DEFAULT_VOICE } from '../ai/voice.js';
import { rateLimit } from '../lib/rateLimit.js';

const cleanWords = (list) =>
  [...new Set((Array.isArray(list) ? list : String(list || '').split(/[\s,;]+/))
    .map((w) => String(w).toLowerCase().replace(/[^a-z'-]/g, '').trim())
    .filter((w) => w.length >= 2 && w.length <= 24))].slice(0, 30);

export function parentRouter(store) {
  const r = express.Router();
  r.post('/login', rateLimit({ perMinute: 10 }), parentLogin);
  r.use(requireParent);

  r.get('/status', async (req, res) => {
    res.json({
      claude: claudeEnabled(),
      model: MODEL,
      voice: voiceEnabled(),
      database: store.kind,
      today: dayISO(),
      tomorrow: addDays(dayISO(), 1),
      yearGroups: YEAR_GROUPS.map((id) => ({ id, label: YEAR_LABELS[id] })),
      keywordsPerBrief: KEYWORDS_PER_BRIEF,
      defaultVoice: DEFAULT_VOICE,
    });
  });

  r.get('/settings', async (req, res, next) => {
    try {
      res.json(await store.getSettings());
    } catch (e) {
      next(e);
    }
  });

  r.put('/settings', async (req, res, next) => {
    try {
      const cur = await store.getSettings();
      const b = req.body || {};
      const next_ = { ...cur };
      if (typeof b.channelName === 'string') next_.channelName = b.channelName.trim().slice(0, 30) || cur.channelName;
      if (b.directorVoiceId !== undefined) next_.directorVoiceId = b.directorVoiceId || null;
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
        next_[t] = s;
      }
      res.json(await store.saveSettings(next_));
    } catch (e) {
      next(e);
    }
  });

  r.get('/wordbank/suggest', (req, res) => {
    const little = req.query.track === 'little';
    const n = Math.min(Number(req.query.n) || 10, 20);
    res.json({ words: pickWords(wordsFor(String(req.query.year || 'Y3'), { little }), n) });
  });

  r.get('/briefs', async (req, res, next) => {
    try {
      const date = isISODate(req.query.date) ? req.query.date : dayISO();
      const [star, little] = await Promise.all(TRACKS.map((t) => store.getBrief(date, t)));
      res.json({ date, star, little, samples: { star: sampleFor('star', date), little: sampleFor('little', date) } });
    } catch (e) {
      next(e);
    }
  });

  r.post('/briefs/generate', rateLimit({ perMinute: 6 }), async (req, res, next) => {
    try {
      const { date, track, theme } = req.body || {};
      if (!isISODate(date) || !TRACKS.includes(track)) return res.status(400).json({ error: 'Bad date or track' });
      if (!claudeEnabled()) return res.status(503).json({ error: 'Add ANTHROPIC_API_KEY in Replit Secrets to write briefs with Claude.' });
      const settings = await store.getSettings();
      const keywords = req.body.keywords?.length ? cleanWords(req.body.keywords).slice(0, KEYWORDS_PER_BRIEF[track]) : (await chooseKeywords(store, settings, date, track)).keywords;
      const out = await generateBrief({ track, keywords, theme: typeof theme === 'string' ? theme.slice(0, 120) : '' });
      const saved = await store.saveBrief({ date, track, status: 'draft', title: out.title, text: out.text, keywords, chunks: out.chunks, picture: out.picture, source: 'claude' });
      res.json({ brief: saved, problems: out.problems });
    } catch (e) {
      next(e);
    }
  });

  r.put('/briefs', async (req, res, next) => {
    try {
      const { date, track, title, text, keywords } = req.body || {};
      if (!isISODate(date) || !TRACKS.includes(track)) return res.status(400).json({ error: 'Bad date or track' });
      const cur = await store.getBrief(date, track);
      const kws = keywords ? cleanWords(keywords) : cur?.keywords || [];
      const body = String(text || '').trim().slice(0, 600);
      if (!body) return res.status(400).json({ error: 'The brief is empty' });
      const saved = await store.saveBrief({
        date, track, status: 'draft',
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
      const { date, track } = req.body || {};
      const cur = isISODate(date) && TRACKS.includes(track) ? await store.getBrief(date, track) : null;
      if (!cur) return res.status(404).json({ error: 'Nothing to approve yet' });
      const problems = briefProblems(cur.text, cur.keywords, track).filter((p) => p.includes('keyword'));
      if (problems.length) return res.status(400).json({ error: problems.join(' ') });
      res.json({ brief: await store.saveBrief({ ...cur, status: 'approved' }) });
    } catch (e) {
      next(e);
    }
  });

  r.get('/voices', async (req, res, next) => {
    try {
      res.json({ voices: await listVoices() });
    } catch (e) {
      next(e);
    }
  });

  // Registers a test line and checks ElevenLabs straight away, so problems show on screen.
  r.post('/voice-test', async (req, res, next) => {
    try {
      const { channelName } = await store.getSettings();
      const line = registerLine(`Hey ${channelName}! I'm your Director. Ready to make something brilliant?`, req.body?.voiceId);
      if (!voiceEnabled()) return res.json({ ...line, ok: false, hint: 'No ELEVENLABS_API_KEY found, so the iPad voice is used.' });
      const out = await lineAudio(line.id);
      res.json({ ...line, ok: out.status === 200, hint: out.error?.hint, detail: out.error?.detail });
    } catch (e) {
      next(e);
    }
  });

  r.get('/voice-status', (req, res) => res.json(voiceStatus()));

  return r;
}
