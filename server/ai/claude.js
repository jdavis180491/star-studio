// All Claude calls live here. Privacy rule: we only ever send the channel name,
// never a child's real name.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { tokenizeBrief, normalizeWord, isKeywordForm } from '../../client/src/reading/words.js';
import * as CREATIVE from '../../client/src/shared/creative.js';

const { ids } = CREATIVE;

export const MODEL = 'claude-sonnet-5-5';

let client = null;
export const claudeEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);
const getClient = () => (client ||= new Anthropic());

/**
 * One structured-output request. Refusals are retried server-side on another model
 * (fallbacks: "default"); if this account doesn't accept that option we retry without it.
 */
async function askJSON({ system, user, schema, maxTokens = 4000, effort = 'low' }) {
  const params = {
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { format: zodOutputFormat(schema), effort },
  };
  let res;
  try {
    res = await getClient().messages.parse(
      { ...params, fallbacks: 'default' },
      { headers: { 'anthropic-beta': 'server-side-fallback-2026-07-01' } }
    );
  } catch (err) {
    if (!(err instanceof Anthropic.BadRequestError)) throw err;
    res = await getClient().messages.parse(params);
  }
  if (res.stop_reason === 'refusal') throw new Error('Claude declined this request');
  if (!res.parsed_output) throw new Error(`No usable output (stop: ${res.stop_reason})`);
  return res.parsed_output;
}

// ---------------------------------------------------------------- briefs

const BriefSchema = z.object({
  title: z.string().describe('Punchy 2-4 word challenge title'),
  text: z.string().describe('The brief the child reads aloud'),
  picture_emoji: z.string().describe('One emoji that pictures the challenge'),
  keyword_chunks: z
    .array(z.object({ word: z.string(), chunks: z.array(z.string()) }))
    .describe('Phonics chunks for each keyword, e.g. disaster -> dis, as, ter'),
});

const BRIEF_SYSTEM = `You write daily video challenges for a private creator game played by children aged 5-9 in the UK.
Each day a small group of friends all get the same "brief", read it aloud, then film themselves doing it.

Voice: funny, energetic, a bit cheeky, like a cool older cousin who makes videos. Never babyish, never like school or homework.
The challenge must be something a child can film safely indoors in under 60 seconds, with no props they wouldn't have (toys, socks, a pillow, a spoon are fine).
Never mention real people, brands, apps, websites, YouTube, or anything scary beyond silly-spooky.
Use British English spelling.
Every keyword MUST appear in the brief exactly as given (a plural or -ed/-ing form is acceptable, but the plain form is best).`;

const TRACK_RULES = {
  star: (kw) =>
    `Audience: age 8, a reluctant reader. Write 3-5 short sentences (45-70 words total). Use the keywords: ${kw.join(', ')}.
Keep every other word easy to decode (mostly one or two syllables). End with a clear "big finish" moment to film.`,
  little: (kw) =>
    `Audience: age 5, just learning phonics. Write 1-2 very short sentences (6-14 words total) using only simple, decodable words. Use the keyword: ${kw.join(', ')}.
Include one simple action to film (hop, wave, spin, roar...). Choose an emoji that clearly pictures the sentence.`,
};

export function briefProblems(text, keywords, track) {
  const tokens = tokenizeBrief(text);
  const problems = [];
  for (const k of keywords) {
    const n = normalizeWord(k);
    if (!tokens.some((t) => isKeywordForm(n, t.norm))) problems.push(`The keyword "${k}" is missing.`);
  }
  const words = tokens.length;
  const [lo, hi] = track === 'little' ? [4, 18] : [25, 90];
  if (words < lo || words > hi) problems.push(`The brief is ${words} words; it must be ${lo}-${hi}.`);
  return problems;
}

function cleanChunks(list = [], keywords = []) {
  const out = {};
  for (const { word, chunks } of list) {
    const w = normalizeWord(word);
    const joined = (chunks || []).join('').toLowerCase().replace(/[^a-z]/g, '');
    if (w && joined === w && keywords.some((k) => normalizeWord(k) === w)) out[w] = chunks.map((c) => c.toLowerCase());
  }
  return out;
}

export async function generateBrief({ track, keywords, theme }) {
  let feedback = '';
  let last = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const user = [
      TRACK_RULES[track](keywords),
      theme ? `Theme idea from the kids: ${theme}` : 'Pick a fresh, surprising scenario.',
      feedback && `Your last attempt had problems, fix them:\n${feedback}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const out = await askJSON({ system: BRIEF_SYSTEM, user, schema: BriefSchema, effort: 'medium' });
    const problems = briefProblems(out.text, keywords, track);
    last = { ...out, problems };
    if (!problems.length) break;
    feedback = problems.join('\n');
  }
  return {
    title: last.title.trim(),
    text: last.text.trim().replace(/\s+/g, ' '),
    picture: last.picture_emoji,
    chunks: cleanChunks(last.keyword_chunks, keywords),
    problems: last.problems,
  };
}

// ---------------------------------------------------------------- little stars

/** Little Stars get the same daily challenge, simplified, around their CVC keyword. */
export async function generateLittleFromMain({ main, keywords }) {
  return generateBrief({
    track: 'little',
    keywords,
    theme: `Make a very simple version of today's main challenge so a 5-year-old can do the same idea. Main challenge "${main.title}": ${main.text}`,
  });
}

// ---------------------------------------------------------------- director call

export const MOODS = CREATIVE.MOODS;
export const MUSIC = ids(CREATIVE.MUSIC);
const WEATHER = ids(CREATIVE.WEATHER);
const BACKDROPS = ids(CREATIVE.BACKDROPS);
const LOOKS = ids(CREATIVE.LOOKS);

const CALL_SYSTEM = `You are "The Director", a warm, quick-witted, hype film director in a private creator game for children aged 5-9 in the UK.
You are on a live VOICE CALL with a young creator, planning the video they are about to film. Everything you say is spoken aloud by a voice actor, so write how people talk: short, natural, no emojis, no lists, no stage directions.

How to talk:
- 1 to 3 short sentences per turn (max 35 words; for Little Stars max 20 very simple words).
- React specifically to what they just said, so they feel heard. Be funny, excited, a bit cheeky. Never babyish or teacher-like.
- Ask ONE question at a time. Follow their ideas; build on them ("Ooh, and what if...").
- Don't read out menus. Only if they're stuck, offer two fun ideas.
- Never ask for or repeat personal details (real names, school, address). Use the channel name.
- If what they say is unclear, silly or off-topic, laugh it off, pick something sensible and keep going.
- If they say nothing, gently nudge them with an easy question.

What you need by the end (gather it naturally in conversation):
- mood: one of ${MOODS.join(', ')}
- music: one of ${MUSIC.join(', ')} (orchestra = big movie music)
- ending: their big finish, summarised in 3-10 words
- Also suggest fun extras when they fit the idea: weather (${WEATHER.join(', ')}), backdrop (${BACKDROPS.join(', ')}), look (${LOOKS.join(', ')}).
When you have mood, music and ending and they sound happy, wrap up in one or two sentences (recap the plan in a fun way and say the cameras are theirs) and set done = true.
Keep the whole call short: aim to finish within 5-7 of their replies. If they've replied 7 times, wrap up and fill any gaps yourself.

Each turn, also return the plan fields as currently agreed (null if not decided yet).`;

const CallSchema = z.object({
  say: z.string().describe('What you say next, spoken aloud'),
  mood: z.enum(MOODS).nullable(),
  music: z.enum(MUSIC).nullable(),
  ending: z.string().nullable().describe('Their big ending in 3-10 words, or null'),
  weather: z.enum(WEATHER).nullable(),
  backdrop: z.enum(BACKDROPS).nullable(),
  look: z.enum(LOOKS).nullable(),
  done: z.boolean(),
});

/**
 * One turn of the Director call. history = [{ who: 'director' | 'kid', text }].
 * Returns { say, plan, done }.
 */
export async function directorTurn({ brief, channelName, history, plan, little }) {
  const transcript = history
    .slice(-16)
    .map((h) => `${h.who === 'kid' ? 'CREATOR' : 'DIRECTOR'}: ${String(h.text || '').slice(0, 400) || '(silence)'}`)
    .join('\n');
  const kidTurns = history.filter((h) => h.who === 'kid').length;
  const user = `Channel name: "${channelName}"${little ? '\nThis is a LITTLE STARS creator (age 5): use very short, simple words.' : ''}
Today's challenge "${brief.title}": ${brief.text}
Plan so far: ${JSON.stringify(plan || {})}
Creator replies so far: ${kidTurns}

Call so far:
${transcript || '(the call has just connected: say hello and ask your first question)'}

Write the Director's next line.`;
  const out = await askJSON({ system: CALL_SYSTEM, user, schema: CallSchema, maxTokens: 2000, effort: 'low' });
  const merged = { ...plan };
  for (const k of ['mood', 'music', 'ending', 'weather', 'backdrop', 'look']) if (out[k]) merged[k] = out[k];
  return { say: out.say.trim(), plan: merged, done: Boolean(out.done) };
}

// ---------------------------------------------------------------- edit plan

const EditSchema = z.object({
  intro_tagline: z.string().describe('Short hype line for the intro card, max 6 words'),
  captions: z
    .array(
      z.object({
        start: z.number(),
        end: z.number(),
        text: z.string().describe('Max 6 words, punchy, fun'),
        position: z.enum(['top', 'bottom']),
      })
    )
    .describe('3-6 captions spread through the clip'),
  effects: z.array(z.object({ type: z.enum(CREATIVE.EDIT_EFFECTS), start: z.number(), end: z.number() })).describe('1-4 short effect hits'),
  lyrics: z.array(z.string()).describe('4-8 short song lines for a sing-along outro using the keywords, or empty'),
  outro_text: z.string().describe('Max 6 words sign-off'),
});

const EDIT_SYSTEM = `You are the editor for a private kids' creator game (ages 5-9, UK). You turn a child's raw clip into a fun finished video.
The child's clip is the star: captions and effects should hype it up, never cover it for long or mock the child.
Captions: short and funny, in the style of a creator video (e.g. "BREAKING NEWS", "wait for it...", "THE BIG FINISH!"). Use British English. No emojis.
Effects: flash, shake, zoom or glitch, each 0.3-1.2 seconds, timed to big moments (especially the ending).
Lyrics: a catchy 4-8 line song for the outro that uses the keywords (each keyword at least once), simple words, lines under 8 words.
All times are seconds within the clip duration.`;

export async function editPlan({ brief, plan, title, channelName, seconds, transcript, remix }) {
  const user = `Channel: "${channelName}"
Video title: "${title || brief.title}"
Challenge "${brief.title}": ${brief.text}
Keywords: ${(brief.keywords || []).join(', ')}
Creator's plan: ${JSON.stringify(plan || {})}
Clip duration: ${seconds} seconds
${transcript ? `What the creator says in the clip (timed transcript):\n${transcript}` : 'No transcript available: spread captions evenly and put a big hit near the end.'}
${remix ? 'This is a REMIX: make it feel different from a normal edit (different caption style and effect timing, more surprising).' : ''}`;
  return askJSON({ system: EDIT_SYSTEM, user, schema: EditSchema, maxTokens: 4000, effort: 'low' });
}
