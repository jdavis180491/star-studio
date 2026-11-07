// The Director call. Claude runs the conversation; if Claude is unavailable we fall
// back to a simple scripted chat so the kids are never stuck.
import { claudeEnabled, directorTurn, MOODS, MUSIC } from './claude.js';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const MAX_KID_TURNS = 8;

const SYNONYMS = {
  funny: ['funny', 'silly', 'laugh', 'joke', 'comedy', 'hilarious'],
  dramatic: ['dramatic', 'drama', 'serious', 'intense', 'sad'],
  spooky: ['spooky', 'scary', 'ghost', 'creepy', 'halloween'],
  epic: ['epic', 'awesome', 'cool', 'huge', 'action', 'big'],
  pop: ['pop', 'dance', 'happy', 'bouncy'],
  rock: ['rock', 'guitar', 'loud', 'metal'],
  orchestra: ['orchestra', 'violin', 'movie', 'film', 'classical'],
  funky: ['funky', 'funk', 'groovy', 'disco'],
  chill: ['chill', 'calm', 'relaxed', 'lofi', 'quiet'],
};
const matchEnum = (answer, options) => {
  const a = String(answer).toLowerCase();
  return options.find((o) => (SYNONYMS[o] || [o]).some((w) => a.includes(w))) || null;
};

function offlineTurn({ brief, channelName, history, plan }) {
  const last = [...history].reverse().find((h) => h.who === 'kid')?.text || '';
  const asked = history.filter((h) => h.who === 'director').length;
  const p = { ...plan };
  if (asked === 0) {
    return { say: `Hey ${channelName}! Today's shoot is ${brief.title}. First things first: should it be funny, dramatic, spooky or epic?`, plan: p, done: false };
  }
  if (!p.mood) {
    p.mood = matchEnum(last, MOODS) || pick(MOODS);
    return { say: `${cap(p.mood)}, love it! What music do you want behind it? Pop, rock, movie music, spooky, funky or chill?`, plan: p, done: false };
  }
  if (!p.music) {
    p.music = matchEnum(last, MUSIC) || pick(MUSIC);
    return { say: `${cap(p.music === 'orchestra' ? 'movie music' : p.music)}, perfect. Now the big one: how does your video end?`, plan: p, done: false };
  }
  p.ending = String(last).trim().slice(0, 80) || 'a massive surprise finish';
  return { say: `That ending is going to look amazing. ${cap(p.mood)} vibes, ${p.music} music. Cameras are yours, go make it legendary!`, plan: p, done: true };
}

/** Fill anything still missing so the camera always has a full plan. */
export function completePlan(plan = {}) {
  return {
    mood: plan.mood || 'funny',
    music: plan.music || 'pop',
    ending: plan.ending || 'a big surprise finish',
    weather: plan.weather || 'none',
    backdrop: plan.backdrop || 'none',
    look: plan.look || 'none',
  };
}

export async function nextTurn({ brief, channelName, history = [], plan = {}, little = false }) {
  const kidTurns = history.filter((h) => h.who === 'kid').length;
  let out = null;
  if (claudeEnabled()) {
    try {
      out = await directorTurn({ brief, channelName, history, plan, little });
    } catch (err) {
      console.warn('Director fell back to scripted lines:', err.message);
    }
  }
  out ||= offlineTurn({ brief, channelName, history, plan });
  if (kidTurns >= MAX_KID_TURNS && !out.done) {
    out = { ...out, say: `${out.say} Right, I think we've got it. Cameras are yours!`, done: true };
  }
  if (out.done) out.plan = completePlan(out.plan);
  return out;
}
