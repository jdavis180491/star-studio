// The Director's script. Claude writes the reactions; the questions are fixed so the
// chat always gets the three answers the edit needs (mood, music, big ending).
import { MOODS, MUSIC, claudeEnabled, directorReact } from './claude.js';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export const SLOTS = ['mood', 'music', 'ending'];

export const QUESTIONS = {
  mood: [
    'First up, what vibe are we going for? Funny, dramatic, spooky or epic?',
    'Right, the big question. Is this one funny, dramatic, spooky or totally epic?',
  ],
  music: [
    'Now the soundtrack. What music do you want? Pop, rock, orchestra, spooky, funky or chill?',
    'Music time! Pop, rock, big orchestra, spooky, funky or chill?',
  ],
  ending: [
    'Last thing, and it is the most important. What is your big ending?',
    'Final question. How does it end? Give me your biggest finish!',
  ],
};

export function introLine(channelName, title) {
  return pick([
    `Welcome to the set, ${channelName}! Today's shoot is ${title}. I've got three quick questions.`,
    `${channelName}, you're on set! ${title} is going to be huge. Three quick questions, then we roll.`,
  ]);
}

export function wrapLine(plan) {
  return pick([
    `Love it. ${cap(plan.mood)} vibes, ${plan.music} music, and that ending. Cameras are yours. Go make it legendary!`,
    `That's a plan! ${cap(plan.mood)}, ${plan.music}, big finish locked in. Hit record when you're ready!`,
  ]);
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// --- offline fallback (no API key, or Claude is unavailable) ---------------
const SYNONYMS = {
  funny: ['funny', 'silly', 'laugh', 'joke', 'comedy', 'hilarious'],
  dramatic: ['dramatic', 'drama', 'serious', 'intense'],
  spooky: ['spooky', 'scary', 'ghost', 'creepy', 'halloween', 'spooky'],
  epic: ['epic', 'awesome', 'cool', 'huge', 'action', 'big'],
  pop: ['pop', 'dance', 'happy', 'bouncy'],
  rock: ['rock', 'guitar', 'loud', 'metal'],
  orchestra: ['orchestra', 'orchestral', 'violin', 'movie', 'film', 'classical'],
  funky: ['funky', 'funk', 'groovy', 'disco'],
  chill: ['chill', 'calm', 'relaxed', 'lofi', 'lo-fi', 'quiet'],
};

function matchEnum(answer, options) {
  const a = String(answer).toLowerCase();
  for (const o of options) if ((SYNONYMS[o] || [o]).some((w) => a.includes(w))) return o;
  return null;
}

function offlineReact(slot, answer) {
  if (slot === 'mood') {
    const v = matchEnum(answer, MOODS) || pick(MOODS);
    return { reaction: pick([`${cap(v)}! Great call.`, `Ooh, ${v}. I can already see it.`]), value: v };
  }
  if (slot === 'music') {
    const v = matchEnum(answer, MUSIC) || pick(MUSIC);
    return { reaction: pick([`${cap(v)} it is. Banger incoming.`, `Yes! ${cap(v)} music, perfect.`]), value: v };
  }
  const v = String(answer).trim().slice(0, 80) || 'a massive surprise finish';
  return { reaction: pick(['That is going to look amazing.', 'Ha! The crowd will go wild.']), value: v };
}

export async function react(args) {
  if (claudeEnabled()) {
    try {
      return await directorReact(args);
    } catch (err) {
      console.warn('Director fell back to offline lines:', err.message);
    }
  }
  return offlineReact(args.slot, args.answer);
}
