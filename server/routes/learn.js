// Reading, Writing, Spelling, Maths, the Dibbly Dobs leaderboard and Dob history.
import express from 'express';
import crypto from 'node:crypto';
import { q, one, many } from '../db.js';
import { requireKid } from '../auth.js';
import { earnDobs, dobLeaderboard, DOB_VALUES } from '../lib/rewards.js';
import { later, notifyFamily } from '../lib/notify.js';
import { practiceWords, wordsForKid } from '../lib/keywords.js';
import { levelFor } from '../lib/levels.js';
import { familySettings, crewForKid } from '../lib/family.js';
import { wordsFor, pickWords } from '../data/wordBank.js';
import { pickTopic } from '../data/topics.js';
import { makeSet, MATHS_TYPES } from '../lib/maths.js';
import { rateLimit } from '../lib/rateLimit.js';
import { claudeEnabled, storyTurn, writeStory, spellCheck, resolveSpoken, spellingSentences } from '../ai/claude.js';
import { registerLine } from '../ai/voice.js';
import { chunkWord } from '../../client/src/reading/phonics.js';

const newId = () => crypto.randomBytes(9).toString('base64url').replace(/[^a-zA-Z0-9]/g, 'x');
// A story or letter must have at least this many words to send (and earn its Dob):
// 5 for Year 2 and below (by their writing level), 15 for everyone else.
export const minWritingWords = (kid) => (['R', 'Y1', 'Y2'].includes(levelFor(kid, 'writing')) ? 5 : 15);
const isYoung = (kid) => kid.track === 'little' || kid.year_group === 'R';
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

async function familyOf(kid) {
  const f = await one(`SELECT settings FROM families WHERE id = $1`, [kid.family_id]);
  return familySettings(f?.settings);
}

/** Words to try in a story: their keywords, or words for their writing level if that's different. */
async function writingWords(kid) {
  const level = levelFor(kid, 'writing');
  const k = await wordsForKid(kid);
  if (k.source !== 'auto' || level === levelFor(kid, 'reading')) return k.words.slice(0, 2);
  return pickWords(wordsFor(level, { little: level === 'R' }), 2);
}

const voiceId = async (kid) => (await familyOf(kid)).directorVoiceId;

export function learnRouter() {
  const r = express.Router();
  r.use('/kid', requireKid);

  // ================================================================ VOICE
  // Anything the kids' app reads out (word help, the word moment, a story) uses the same
  // ElevenLabs voice as the rest of the app. The app falls back to the iPad voice if it's off.
  r.post('/kid/say', rateLimit({ perMinute: 90 }), async (req, res, next) => {
    try {
      const texts = (Array.isArray(req.body?.texts) ? req.body.texts : [req.body?.text])
        .map((t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 1500))
        .filter(Boolean)
        .slice(0, 10);
      if (!texts.length) return res.status(400).json({ error: 'Nothing to say' });
      const v = await voiceId(req.kid);
      res.json({ lines: texts.map((t) => registerLine(t, v)) });
    } catch (e) {
      next(e);
    }
  });

  // ================================================================ READING
  r.post('/kid/story/turn', rateLimit({ perMinute: 40 }), async (req, res, next) => {
    try {
      const history = (Array.isArray(req.body?.history) ? req.body.history : [])
        .slice(-16)
        .map((h) => ({ who: h.who === 'kid' ? 'kid' : 'buddy', text: String(h.text || '').slice(0, 400) }));
      const ideas = req.body?.plan && typeof req.body.plan === 'object' ? req.body.plan : {};
      let out = null;
      if (claudeEnabled()) {
        try {
          out = await storyTurn({ history, ideas, young: isYoung(req.kid), ask: buddyQuestion(history) });
        } catch (e) {
          console.warn('Story Buddy fell back:', e.message);
        }
      }
      out ||= offlineBuddy(history, ideas);
      // Exactly two questions: after the child's second answer, Story Buddy writes the story.
      const replies = history.filter((h) => h.who === 'kid').length;
      if (replies >= 2) {
        const say = out.done ? out.say : `${out.say.replace(/[^.!]*\?\s*$/, '').trim() || 'Brilliant!'} I’m writing your story now!`;
        out = { ...out, say, done: true };
      } else if (out.done) {
        out = { ...out, done: false };
      }
      res.json({ ...out, line: registerLine(out.say, await voiceId(req.kid)) });
    } catch (e) {
      next(e);
    }
  });

  r.post('/kid/story/create', rateLimit({ perMinute: 10 }), async (req, res, next) => {
    try {
      const kid = req.kid;
      const ideas = req.body?.ideas && typeof req.body.ideas === 'object' ? req.body.ideas : {};
      const keywords = (await wordsForKid(kid)).words;
      let story = null;
      if (claudeEnabled()) {
        try {
          story = await writeStory({ ideas, keywords, yearGroup: kid.year_group });
        } catch (e) {
          console.warn('Story writing fell back:', e.message);
        }
      }
      story ||= offlineStory(ideas, keywords, isYoung(kid));
      const row = await one(
        `INSERT INTO stories (kid_id, title, body, keywords, chunks, picture) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [kid.id, story.title.slice(0, 60), story.text, JSON.stringify(keywords), JSON.stringify(story.chunks || {}), story.picture || '📖']
      );
      res.json({ story: storyForClient(row) });
    } catch (e) {
      next(e);
    }
  });

  r.get('/kid/stories', async (req, res, next) => {
    try {
      const rows = await many(`SELECT * FROM stories WHERE kid_id = $1 ORDER BY created_at DESC LIMIT 50`, [req.kid.id]);
      res.json({ stories: rows.map(storyForClient) });
    } catch (e) {
      next(e);
    }
  });

  r.post('/kid/stories/:id/read', async (req, res, next) => {
    try {
      const st = await one(`SELECT * FROM stories WHERE id = $1 AND kid_id = $2`, [Number(req.params.id), req.kid.id]);
      if (!st) return res.status(404).json({ error: 'Story not found' });
      const s = req.body?.stats || {};
      const list = (v) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 30)).slice(0, 80) : []);
      await q(
        `INSERT INTO reading_logs (kid_id, brief_title, words_read, total_words, helped, keywords, keywords_read, keywords_forced, grown_up_skip)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [req.kid.id, `📖 ${st.title}`, Math.max(0, Number(s.wordsRead) || 0), Math.max(0, Number(s.totalWords) || 0),
          JSON.stringify(list(s.helpedWords)), JSON.stringify(list(s.keywords)), JSON.stringify(list(s.keywordsRead)), JSON.stringify(list(s.keywordsForced)), Boolean(s.grownUpSkip)]
      );
      await q(`UPDATE stories SET reads = reads + 1 WHERE id = $1`, [st.id]);
      res.json(await earnDobs(req.kid.id, 'reading', { what: `Read “${st.title}” aloud`, words: Number(s.wordsRead) || 0 }));
    } catch (e) {
      next(e);
    }
  });

  // ================================================================ WRITING
  // Who can I write to? Brothers/sisters, crew friends, and my grown-up.
  async function recipients(kid) {
    const out = [{ type: 'parent', id: 'parent', channelName: 'My grown-up', sameFamily: true }];
    const sibs = await many(`SELECT * FROM kids WHERE family_id = $1 AND id <> $2 ORDER BY id`, [kid.family_id, kid.id]);
    for (const s of sibs) out.push({ type: 'kid', id: s.id, channelName: s.channel_name, avatar: s.avatar, sameFamily: true });
    const crew = await crewForKid(kid.id);
    if (crew) {
      const mates = await many(
        `SELECT k.* FROM kids k JOIN crew_members m ON m.kid_id = k.id WHERE m.crew_id = $1 AND k.family_id <> $2 ORDER BY k.id`,
        [crew.id, kid.family_id]
      );
      for (const m of mates) out.push({ type: 'kid', id: m.id, channelName: m.channel_name, avatar: m.avatar, sameFamily: false });
    }
    return out;
  }

  r.get('/kid/writing/recipients', async (req, res, next) => {
    try {
      res.json({ recipients: await recipients(req.kid) });
    } catch (e) {
      next(e);
    }
  });

  r.get('/kid/writing/topic', async (req, res, next) => {
    try {
      const to = String(req.query.to || 'your friend').slice(0, 30);
      res.json({ topic: pickTopic(to, String(req.query.not || '')), tryWords: await writingWords(req.kid) });
    } catch (e) {
      next(e);
    }
  });

  r.post('/kid/writing/check', rateLimit({ perMinute: 12 }), async (req, res, next) => {
    try {
      const text = String(req.body?.text || '').slice(0, 4000);
      if (!text.trim()) return res.json({ issues: [] });
      if (!claudeEnabled()) return res.json({ issues: [], unavailable: true });
      res.json({ issues: await spellCheck(text) });
    } catch (e) {
      next(e);
    }
  });

  r.post('/kid/writing/say', rateLimit({ perMinute: 30 }), async (req, res, next) => {
    try {
      const { typed, said, context } = req.body || {};
      if (!claudeEnabled()) return res.json({ word: String(said || '').trim().split(/\s+/)[0] || typed });
      res.json({ word: await resolveSpoken({ typed, said, context }) });
    } catch (e) {
      next(e);
    }
  });

  r.post('/kid/letters', rateLimit({ perMinute: 10 }), async (req, res, next) => {
    try {
      const kid = req.kid;
      const body = String(req.body?.body || '').trim().slice(0, 4000);
      const realWords = body.split(/\s+/).filter((w) => /[a-z]/i.test(w)).length;
      const min = minWritingWords(kid);
      if (realWords < min) return res.status(400).json({ error: `Write at least ${min} words first! (${realWords} so far)` });
      const topic = String(req.body?.topic || '').slice(0, 200);
      let threadId = req.body?.threadId ? Number(req.body.threadId) : null;
      let toKid = null;
      let toFamily = null;
      let sameFamily = true;
      if (threadId) {
        // Continuing a story: reply to the other person in the thread.
        const root = await one(`SELECT * FROM letters WHERE id = $1`, [threadId]);
        const part = await one(`SELECT 1 FROM letters WHERE thread_id = $1 AND (to_kid = $2 OR from_kid = $2) AND (status = 'delivered' OR from_kid = $2)`, [threadId, kid.id]);
        if (!root || !part) return res.status(404).json({ error: 'Story not found' });
        const last = await one(`SELECT * FROM letters WHERE thread_id = $1 AND to_kid = $2 ORDER BY created_at DESC LIMIT 1`, [threadId, kid.id]);
        const otherId = last ? last.from_kid : root.from_kid === kid.id ? root.to_kid : root.from_kid;
        const other = otherId ? await one(`SELECT family_id FROM kids WHERE id = $1`, [otherId]) : null;
        if (!other) return res.status(400).json({ error: 'Can’t continue this one' });
        toKid = otherId;
        sameFamily = other.family_id === kid.family_id;
      } else {
        const to = req.body?.to || {};
        const allowed = await recipients(kid);
        const pick = to.parent ? allowed.find((a) => a.type === 'parent') : allowed.find((a) => a.type === 'kid' && a.id === Number(to.kidId));
        if (!pick) return res.status(400).json({ error: 'Pick who to send it to' });
        if (pick.type === 'parent') toFamily = kid.family_id;
        else toKid = pick.id;
        sameFamily = pick.sameFamily;
      }
      // Stories to friends in other families wait for the sender's grown-up to check them.
      const status = sameFamily ? 'delivered' : 'pending';
      const row = await one(
        `INSERT INTO letters (thread_id, from_kid, to_kid, to_family, topic, body, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [threadId, kid.id, toKid, toFamily, topic, body, status]
      );
      if (!threadId) await q(`UPDATE letters SET thread_id = id WHERE id = $1`, [row.id]);
      const words = body.split(/\s+/).length;
      const reward = await earnDobs(
        kid.id,
        threadId ? 'continue' : 'writing',
        { what: threadId ? `Continued a story (${words} words)` : `Wrote “${(topic || '').slice(0, 60)}” (${words} words)` },
        { quiet: status === 'pending' }
      );
      if (status === 'pending') {
        later(() =>
          notifyFamily(kid.family_id, 'approvals', {
            title: 'A story to check',
            body: `${kid.name} wrote a story to a friend and earned 1 Dob. Tap to read it before it’s sent.`,
            url: '/parent?tab=approvals',
          })
        );
      }
      res.json({ ...reward, status });
    } catch (e) {
      next(e);
    }
  });

  r.get('/kid/letters', async (req, res, next) => {
    try {
      const rows = await many(
        `SELECT l.*, f.channel_name AS from_name, f.avatar AS from_avatar, t.channel_name AS to_name, t.avatar AS to_avatar
           FROM letters l JOIN kids f ON f.id = l.from_kid LEFT JOIN kids t ON t.id = l.to_kid
          WHERE (l.to_kid = $1 AND l.status = 'delivered') OR l.from_kid = $1
          ORDER BY l.created_at DESC LIMIT 80`,
        [req.kid.id]
      );
      const shape = (l) => ({
        id: l.id, threadId: l.thread_id, topic: l.topic, body: l.body, status: l.status, unread: !l.read_at && l.to_kid === req.kid.id,
        from: { id: l.from_kid, channelName: l.from_name, avatar: l.from_avatar },
        to: l.to_family ? { channelName: 'My grown-up' } : { id: l.to_kid, channelName: l.to_name, avatar: l.to_avatar },
        at: l.created_at,
      });
      res.json({ inbox: rows.filter((l) => l.to_kid === req.kid.id).map(shape), sent: rows.filter((l) => l.from_kid === req.kid.id).map(shape) });
    } catch (e) {
      next(e);
    }
  });

  r.get('/kid/letters/thread/:id', async (req, res, next) => {
    try {
      const rows = await many(
        `SELECT l.*, f.channel_name AS from_name, f.avatar AS from_avatar FROM letters l JOIN kids f ON f.id = l.from_kid
          WHERE l.thread_id = $1 AND (l.status = 'delivered' OR l.from_kid = $2) ORDER BY l.created_at`,
        [Number(req.params.id), req.kid.id]
      );
      if (!rows.some((l) => l.from_kid === req.kid.id || l.to_kid === req.kid.id)) return res.status(404).json({ error: 'Not found' });
      await q(`UPDATE letters SET read_at = now() WHERE thread_id = $1 AND to_kid = $2 AND read_at IS NULL AND status = 'delivered'`, [Number(req.params.id), req.kid.id]);
      res.json({
        parts: rows.map((l) => ({ id: l.id, body: l.body, topic: l.topic, status: l.status, mine: l.from_kid === req.kid.id, from: { channelName: l.from_name, avatar: l.from_avatar }, at: l.created_at })),
        canContinue: rows.some((l) => l.to_kid === req.kid.id && l.status === 'delivered'),
      });
    } catch (e) {
      next(e);
    }
  });

  // ================================================================ SPELLING
  r.post('/kid/spelling/start', async (req, res, next) => {
    try {
      const kid = req.kid;
      const words = await practiceWords(kid, 5);
      const cached = await many(`SELECT word, sentence FROM spell_sentences WHERE word = ANY($1)`, [words]);
      const sentences = Object.fromEntries(cached.map((c) => [c.word, c.sentence]));
      const missing = words.filter((w) => !sentences[w]);
      if (missing.length && claudeEnabled()) {
        try {
          for (const s of await spellingSentences(missing)) {
            const w = s.word.toLowerCase();
            if (missing.includes(w) && s.sentence.toLowerCase().includes(w)) {
              sentences[w] = s.sentence;
              await q(`INSERT INTO spell_sentences (word, sentence) VALUES ($1,$2) ON CONFLICT (word) DO NOTHING`, [w, s.sentence]);
            }
          }
        } catch (e) {
          console.warn('Spelling sentences fell back:', e.message);
        }
      }
      const vid = await voiceId(kid);
      const items = words.map((w) => {
        const sentence = sentences[w] || `Can you spell ${w}? ${cap(w)}.`;
        return { word: w, sentence, chunks: chunkWord(w), line: registerLine(`${w}. ... ${sentence} ... ${w}.`, vid) };
      });
      const id = newId();
      await q(`INSERT INTO practice_sets (id, kid_id, kind, type, items) VALUES ($1,$2,'spelling','words',$3)`, [id, kid.id, JSON.stringify(items.map(({ word, sentence }) => ({ word, sentence })))]);
      res.json({ setId: id, items });
    } catch (e) {
      next(e);
    }
  });

  // ================================================================ MATHS
  r.get('/kid/maths/types', (req, res) => res.json({ types: MATHS_TYPES }));

  r.post('/kid/maths/start', async (req, res, next) => {
    try {
      const type = String(req.body?.type || '');
      if (!MATHS_TYPES.some((t) => t.id === type)) return res.status(400).json({ error: 'Unknown maths type' });
      const questions = makeSet(type, levelFor(req.kid, 'maths'), req.kid.settings);
      const id = newId();
      await q(`INSERT INTO practice_sets (id, kid_id, kind, type, items) VALUES ($1,$2,'maths',$3,$4)`, [id, req.kid.id, type, JSON.stringify(questions)]);
      res.json({ setId: id, type, questions });
    } catch (e) {
      next(e);
    }
  });

  // Finishing a spelling or maths set earns its Dobs (once per set).
  r.post('/kid/practice/:id/finish', async (req, res, next) => {
    try {
      const set = await one(`SELECT * FROM practice_sets WHERE id = $1 AND kid_id = $2`, [req.params.id, req.kid.id]);
      if (!set) return res.status(404).json({ error: 'Not found' });
      if (set.finished_at) return res.status(409).json({ error: 'Already finished' });
      const results = (Array.isArray(req.body?.results) ? req.body.results : []).slice(0, set.items.length).map((x) => ({
        correct: Boolean(x.correct), tries: Math.max(1, Math.min(9, Number(x.tries) || 1)), gaveUp: Boolean(x.gaveUp),
      }));
      if (results.length < set.items.length) return res.status(400).json({ error: 'Finish all the questions first' });
      const score = results.filter((x) => x.correct && !x.gaveUp).length;
      await q(`UPDATE practice_sets SET results = $2, score = $3, finished_at = now() WHERE id = $1`, [set.id, JSON.stringify(results), score]);
      const activity = set.kind === 'spelling' ? 'spelling' : `maths-${set.type}`;
      const label = set.kind === 'spelling' ? 'Spelling' : MATHS_TYPES.find((t) => t.id === set.type)?.name;
      res.json({ ...(await earnDobs(req.kid.id, activity, { what: `${label}: ${score}/${set.items.length} right` })), score, total: set.items.length });
    } catch (e) {
      next(e);
    }
  });

  // ================================================================ DOBS
  r.get('/kid/rules', (req, res) => res.json(DOB_VALUES));

  r.get('/kid/leaderboard', async (req, res, next) => {
    try {
      const fam = await many(`SELECT id FROM kids WHERE family_id = $1`, [req.kid.family_id]);
      const crew = await crewForKid(req.kid.id);
      const mates = crew ? await many(`SELECT kid_id AS id FROM crew_members WHERE crew_id = $1`, [crew.id]) : [];
      const ids = [...new Set([...fam, ...mates].map((x) => x.id))];
      const rows = await dobLeaderboard(ids);
      res.json({ crew: crew ? crew.name : null, rows: rows.map((r2) => ({ kidId: r2.id, channelName: r2.channel_name, avatar: r2.avatar, weekDobs: r2.week_dobs, dobs: r2.dobs })) });
    } catch (e) {
      next(e);
    }
  });

  r.get('/kid/dobs', async (req, res, next) => {
    try {
      const rows = await many(`SELECT * FROM events WHERE kid_id = $1 AND dobs <> 0 ORDER BY created_at DESC LIMIT 40`, [req.kid.id]);
      res.json({ dobs: req.kid.dobs, history: rows.map(eventForClient) });
    } catch (e) {
      next(e);
    }
  });

  return r;
}

export function eventForClient(e) {
  return { id: e.id, type: e.type, dobs: e.dobs, what: e.meta?.what || null, note: e.note, byParent: e.by_parent, at: e.created_at };
}

function storyForClient(s) {
  return { id: s.id, title: s.title, text: s.body, keywords: s.keywords, chunks: s.chunks, picture: s.picture, reads: s.reads, createdAt: s.created_at };
}

// ---------------------------------------------------------------- Story Buddy's two questions
// A different mix every time, so it isn't always "who's the hero?".
const FIRST_QUESTIONS = [
  ['what kind of story they want today: funny, spooky, magical, or a big adventure', 'What kind of story today: funny, spooky, magical or a big adventure?'],
  ['who the story is about (a person, an animal, a monster, anything)', 'Who should our story be about?'],
  ['where the story happens: space, a jungle, under the sea, a castle, or their own idea', 'Where shall our story happen? Space, a jungle, under the sea, or somewhere else?'],
  ['which animal would be the star of the story, and what is special about it', 'If an animal was the star of our story, which one would it be?'],
  ['what the silliest thing in the story should be', 'What’s the silliest thing we could put in a story?'],
  ['who the main character is: a pirate, a robot, a dragon, a superhero or their own idea', 'Pick a hero: a pirate, a robot, a dragon, a superhero, or your own idea!'],
  ['what magical object the story should have', 'Our story needs something magic. What could it be?'],
];
const SECOND_QUESTIONS = [
  ['what goes wrong', 'Uh oh, what goes wrong?'],
  ['what surprising thing happens next', 'Then something surprising happens. What is it?'],
  ['who or what they meet on the way', 'Who do they bump into on the way?'],
  ['what secret power or trick saves the day', 'What secret power or trick saves the day?'],
  ['what they find, and what is inside it', 'They find something mysterious. What is it?'],
  ['what the funny ending should be', 'How should it end? Make it funny!'],
  ['what the big problem is that they have to fix', 'What big problem do they have to fix?'],
];
const pick = (list) => list[Math.floor(Math.random() * list.length)];
function buddyQuestion(history) {
  const replies = history.filter((h) => h.who === 'kid').length;
  if (replies >= 2) return null;
  return pick(replies === 0 ? FIRST_QUESTIONS : SECOND_QUESTIONS)[0];
}
const HELLOS = ['Hello, storyteller!', 'Hi there, superstar!', 'Ooh, hello! Story time!', 'Hey you! Let’s make something brilliant.', 'Welcome back, story maker!'];

// ---------------------------------------------------------------- offline fallbacks (no API key)
function offlineBuddy(history, ideas) {
  const last = [...history].reverse().find((h) => h.who === 'kid')?.text?.trim() || '';
  const p = { ...ideas };
  const replies = history.filter((h) => h.who === 'kid').length;
  if (replies === 0) return { say: `${pick(HELLOS)} ${pick(FIRST_QUESTIONS)[1]}`, plan: p, done: false };
  if (replies === 1) {
    p.hero = last || 'a brave little robot';
    return { say: `Ooh, ${p.hero}! ${pick(SECOND_QUESTIONS)[1]}`, plan: p, done: false };
  }
  p.problem = last || 'everything turns to jelly';
  return { say: 'Brilliant! I’m writing your story now!', plan: p, done: true };
}

function offlineStory(ideas, keywords, young) {
  const hero = ideas.hero || 'a little robot';
  const place = ideas.place || 'a big castle';
  const problem = ideas.problem || 'the lights went out';
  const kw = keywords.length ? keywords : ['fun'];
  const text = young
    ? `${cap(hero)} was in ${place}. Then ${problem}! It was a ${kw[0]} day.`
    : `Once upon a time, ${hero} lived in ${place}. Every day was quiet, until one morning ${problem}. ` +
      `"Oh no!" said ${hero}. "This is a ${kw[0]} problem!" ` +
      `So ${hero} made a plan${kw[1] ? ` with a ${kw[1]}` : ''}. It was tricky and very silly, but it worked. ` +
      `${kw[2] ? `In the end, everyone shouted "${kw[2]}!" and ` : 'In the end, '}they all laughed until bedtime.`;
  return { title: `${cap(hero.replace(/^(a|an|the) /i, ''))} and the Big Surprise`.slice(0, 50), text, picture: '📖', chunks: {} };
}
