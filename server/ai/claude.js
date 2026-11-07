// All Claude calls live here. Privacy rule: we only ever send the channel name,
// never a child's real name.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { tokenizeBrief, normalizeWord, isKeywordForm } from '../../client/src/reading/words.js';

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

// ---------------------------------------------------------------- director

export const MOODS = ['funny', 'dramatic', 'spooky', 'epic'];
export const MUSIC = ['pop', 'rock', 'orchestra', 'spooky', 'funky', 'chill'];

const DIRECTOR_SYSTEM = `You are "The Director", a hype, quick-witted film director character in a private creator game for children aged 5-9.
You are chatting by voice with a young creator before they film. Your lines are read aloud by a voice actor.
Rules: 1-2 short sentences, max 28 words. Warm, funny, energetic, never babyish or teacher-like. British English.
React specifically to what they said, so they feel heard. Never ask for or repeat personal details (names, school, address).
If the answer is unclear, rude or off-topic, stay upbeat, make a sensible choice for them, and move on.`;

const SLOT_SCHEMAS = {
  mood: z.object({ reaction: z.string(), value: z.enum(MOODS) }),
  music: z.object({ reaction: z.string(), value: z.enum(MUSIC) }),
  ending: z.object({
    reaction: z.string(),
    value: z.string().describe('Their big ending, summarised in 3-10 words for the edit plan'),
  }),
};

const SLOT_ASK = {
  mood: `Map their answer to one mood: ${MOODS.join(', ')}.`,
  music: `Map their answer to one music style: ${MUSIC.join(', ')}.`,
  ending: 'Summarise the big ending they described. If they had no idea, invent a fun simple one.',
};

export async function directorReact({ slot, answer, brief, channelName, plan }) {
  const user = `Channel: "${channelName}"
Today's brief: "${brief.title}": ${brief.text}
Plan so far: ${JSON.stringify(plan || {})}
You asked about: ${slot}. ${SLOT_ASK[slot]}
The creator answered (speech transcript, may contain mistakes): "${String(answer).slice(0, 300)}"
Write your reaction line (do NOT ask the next question; that is added after your line).`;
  const out = await askJSON({ system: DIRECTOR_SYSTEM, user, schema: SLOT_SCHEMAS[slot], maxTokens: 1500, effort: 'low' });
  return { reaction: out.reaction.trim(), value: typeof out.value === 'string' ? out.value.trim() : out.value };
}
