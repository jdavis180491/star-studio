import express from 'express';
import { sampleBriefs } from '../data/sampleBriefs.js';
import { briefForKids, resolveBriefRef } from '../lib/briefs.js';
import { dayISO } from '../lib/dates.js';
import { rateLimit } from '../lib/rateLimit.js';
import { SLOTS, QUESTIONS, introLine, wrapLine, react } from '../ai/director.js';
import { registerLine, lineAudio } from '../ai/voice.js';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function kidsRouter(store) {
  const r = express.Router();

  r.get('/briefs/samples', (req, res) => res.json({ briefs: sampleBriefs }));

  r.get('/briefs/today', async (req, res, next) => {
    try {
      const date = dayISO();
      const [star, little] = await Promise.all([briefForKids(store, 'star', date), briefForKids(store, 'little', date)]);
      const settings = await store.getSettings();
      res.json({ date, brief: star, little, channelName: settings.channelName });
    } catch (e) {
      next(e);
    }
  });

  // ---- Director chat ----
  const director = express.Router();
  director.use(rateLimit({ perMinute: 40 }));

  director.post('/start', async (req, res, next) => {
    try {
      const brief = await resolveBriefRef(store, req.body?.briefRef);
      if (!brief) return res.status(404).json({ error: 'Unknown brief' });
      const { channelName, directorVoiceId } = await store.getSettings();
      res.json({
        lines: [registerLine(introLine(channelName, brief.title), directorVoiceId), registerLine(pick(QUESTIONS.mood), directorVoiceId)],
        slot: 'mood',
      });
    } catch (e) {
      next(e);
    }
  });

  director.post('/answer', async (req, res, next) => {
    try {
      const { briefRef, slot, answer = '', plan = {} } = req.body || {};
      if (!SLOTS.includes(slot)) return res.status(400).json({ error: 'Bad slot' });
      const brief = await resolveBriefRef(store, briefRef);
      if (!brief) return res.status(404).json({ error: 'Unknown brief' });
      const { channelName, directorVoiceId } = await store.getSettings();
      const { reaction, value } = await react({ slot, answer: String(answer).slice(0, 300), brief, channelName, plan });
      const nextSlot = SLOTS[SLOTS.indexOf(slot) + 1] || null;
      const newPlan = { ...plan, [slot]: value };
      const follow = nextSlot ? pick(QUESTIONS[nextSlot]) : wrapLine(newPlan);
      res.json({
        value,
        nextSlot,
        plan: newPlan,
        lines: [registerLine(reaction, directorVoiceId), registerLine(follow, directorVoiceId)],
      });
    } catch (e) {
      next(e);
    }
  });

  director.get('/audio/:id', async (req, res, next) => {
    try {
      const out = await lineAudio(req.params.id);
      if (out.status !== 200) return res.status(out.status).end();
      res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=3600' }).send(out.audio);
    } catch (e) {
      next(e);
    }
  });

  r.use('/director', director);
  return r;
}
