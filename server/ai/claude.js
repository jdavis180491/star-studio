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
async function askJSON({ system, user, schema, maxTokens = 4000, effort = 'low', timeoutMs = null }) {
  const params = {
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { format: zodOutputFormat(schema), effort },
  };
  // A time limit (no retries) for steps a child is waiting on; the caller falls back if it runs out.
  const reqOpts = timeoutMs ? { timeout: timeoutMs, maxRetries: 0 } : {};
  let res;
  try {
    res = await getClient().messages.parse(
      { ...params, fallbacks: 'default' },
      { headers: { 'anthropic-beta': 'server-side-fallback-2026-07-01' }, ...reqOpts }
    );
  } catch (err) {
    if (!(err instanceof Anthropic.BadRequestError)) throw err;
    res = await getClient().messages.parse(params, reqOpts);
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
If keywords are given, every keyword MUST appear in the brief exactly as given (a plural or -ed/-ing form is acceptable, but the plain form is best).`;

const TRACK_RULES = {
  star: (kw) =>
    `Audience: ages 7-11. Write 3-5 short sentences (40-70 words total).${kw.length ? ` Use the keywords: ${kw.join(', ')}.` : ''}
Keep most words easy to decode (mostly one or two syllables). End with a clear "big finish" moment to film.`,
  little: (kw) =>
    `Audience: age 4-5, just learning phonics. Write 1-2 very short sentences (6-14 words total) using only simple, decodable words.${kw.length ? ` Use the keyword: ${kw.join(', ')}.` : ''}
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

export async function generateBrief({ track, keywords = [], theme, avoid = [] }) {
  let feedback = '';
  let last = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const user = [
      TRACK_RULES[track](keywords),
      theme ? `Theme idea: ${theme}` : 'Pick a fresh, surprising scenario.',
      avoid.length ? `Recent challenges (don't repeat these ideas): ${avoid.slice(0, 60).join('; ')}` : '',
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
  // The child is waiting: if the plan takes more than 12 seconds, the built-in edit is used instead.
  return askJSON({ system: EDIT_SYSTEM, user, schema: EditSchema, maxTokens: 3000, effort: 'low', timeoutMs: 12000 });
}

// ---------------------------------------------------------------- reading: Story Buddy

export const LEVELS = {
  R: { words: [15, 30], guide: '2-3 very short sentences. Mostly CVC words (cat, sun, hop) and Reception tricky words (the, I, to, go, was).' },
  Y1: { words: [30, 50], guide: '4-5 short sentences. Simple phonics words with digraphs (sh, ch, ai, ee, igh, oa, oo).' },
  Y2: { words: [50, 80], guide: '5-7 sentences. Year 2 common words, some two-syllable words.' },
  Y3: { words: [80, 110], guide: 'Short paragraphs. Mostly familiar words, a few longer words.' },
  Y4: { words: [100, 130], guide: 'Two paragraphs, some dialogue, richer vocabulary.' },
  Y5: { words: [120, 160], guide: 'Two or three paragraphs, varied sentences, some ambitious vocabulary.' },
  Y6: { words: [140, 180], guide: 'Two or three paragraphs, varied sentences and ambitious vocabulary.' },
};

const BUDDY_SYSTEM = `You are "Story Buddy", a playful, warm story-maker in a private reading game for children aged 4-11 in the UK.
You are on a VOICE CALL with a child, inventing a story together that they will then read aloud. Your words are spoken by a voice actor: talk naturally, short and friendly, no emojis or lists.
- 1-2 short sentences per turn (max 25 words; for young children max 15 simple words).
- The whole call is EXACTLY TWO questions, then you write the story:
  1. Your first line: a quick, fresh hello and ONE question (you'll be told which kind to ask; word it your own way).
  2. After their first answer: react with excitement in a few words, then ONE more question (again, you'll be told which kind).
  3. After their second answer: react in a few words, say you're writing it now, and set done = true. Never ask a third question.
- Vary your greeting and wording every time: never start the same way twice.
- Fill in anything they didn't say yourself (a fun place, a silly problem) so the story always works.
- Never ask for real names, school or address. If they give a real-sounding name, use it as a character name only if it sounds made up; otherwise suggest a fun character name.
- If they're stuck, offer two silly ideas. If they say nothing, nudge gently.
Return the story ideas gathered so far each turn (null if not decided).`;

const BuddySchema = z.object({
  say: z.string(),
  hero: z.string().nullable(),
  place: z.string().nullable(),
  problem: z.string().nullable(),
  detail: z.string().nullable(),
  done: z.boolean(),
});

export async function storyTurn({ history, ideas, young, ask }) {
  const transcript = history
    .slice(-14)
    .map((h) => `${h.who === 'kid' ? 'CHILD' : 'BUDDY'}: ${String(h.text || '').slice(0, 400) || '(silence)'}`)
    .join('\n');
  const user = `${young ? 'This child is very young (age 4-6): use tiny, simple words.\n' : ''}Ideas so far: ${JSON.stringify(ideas || {})}
Child replies so far: ${history.filter((h) => h.who === 'kid').length}

Call so far:
${transcript || '(the call has just connected: say hi and ask your first question)'}
${ask ? `\nThe question to ask this time (in your own words): ${ask}` : ''}
Write Story Buddy's next line.`;
  const out = await askJSON({ system: BUDDY_SYSTEM, user, schema: BuddySchema, maxTokens: 1500, effort: 'low' });
  const merged = { ...ideas };
  for (const k of ['hero', 'place', 'problem', 'detail']) if (out[k]) merged[k] = out[k];
  return { say: out.say.trim(), plan: merged, done: Boolean(out.done) };
}

const StorySchema = z.object({
  title: z.string(),
  text: z.string(),
  picture_emoji: z.string(),
  keyword_chunks: z.array(z.object({ word: z.string(), chunks: z.array(z.string()) })),
});

/** Write a reading passage at the child's level from the ideas they gave. */
export async function writeStory({ ideas, keywords, yearGroup }) {
  const level = LEVELS[yearGroup] || LEVELS.Y3;
  const [lo, hi] = level.words;
  let feedback = '';
  let last = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const user = `Write a short story for a child to read ALOUD, built from their ideas: ${JSON.stringify(ideas)}.
Reading level (England, ${yearGroup}): ${level.guide} Length: ${lo}-${hi} words.
Use each of these keywords at least once, exactly as written: ${keywords.join(', ')}.
Make it funny and exciting, with a satisfying ending. British English. Plain text paragraphs only, no headings.
${feedback && `Fix these problems from your last attempt:\n${feedback}`}`;
    const out = await askJSON({
      system: 'You write short, funny, perfectly levelled reading passages for children in UK primary schools.',
      user,
      schema: StorySchema,
      maxTokens: 4000,
      effort: 'medium',
    });
    const tokens = tokenizeBrief(out.text);
    const problems = keywords.filter((k) => !tokens.some((t) => isKeywordForm(normalizeWord(k), t.norm))).map((k) => `Missing keyword "${k}".`);
    if (tokens.length < lo * 0.8 || tokens.length > hi * 1.3) problems.push(`It is ${tokens.length} words; aim for ${lo}-${hi}.`);
    last = { ...out, problems };
    if (!problems.length) break;
    feedback = problems.join('\n');
  }
  return { title: last.title.trim(), text: last.text.trim().replace(/[ \t]+/g, ' '), picture: last.picture_emoji, chunks: cleanChunks(last.keyword_chunks, keywords) };
}

// ---------------------------------------------------------------- writing: spell check

const SpellSchema = z.object({
  issues: z.array(
    z.object({
      word: z.string().describe('The misspelt word exactly as the child typed it'),
      suggestion: z.string().describe('The correctly spelt word they most likely meant (empty if you really cannot tell)'),
      sure: z.boolean().describe('false if you are not confident which word they meant'),
    })
  ),
});

/** Find misspelt words in a child's writing. Grammar and style are ignored on purpose. */
export async function spellCheck(text) {
  const out = await askJSON({
    system: `You check SPELLING ONLY in writing by children aged 5-11 in the UK. Use British spelling as correct (colour, favourite, mum).
Ignore grammar, punctuation, capital letters and style. Names and made-up words in a story are fine. Children often spell phonetically ("becos" = because, "frend" = friend): suggest the word they meant.
List each misspelt word once. If you can't tell which word they meant, set sure=false.`,
    user: `Check the spelling:\n"""${String(text).slice(0, 4000)}"""`,
    schema: SpellSchema,
    maxTokens: 3000,
    effort: 'low',
  });
  return out.issues.filter((i) => i.word && i.word.toLowerCase() !== i.suggestion.toLowerCase()).slice(0, 40);
}

const SaidSchema = z.object({ word: z.string().describe('Correct British spelling of the word they meant') });

/** The child typed something unclear, then said the word out loud: work out the spelling. */
export async function resolveSpoken({ typed, said, context }) {
  const out = await askJSON({
    system: 'A child aged 5-11 misspelt a word, then said it aloud (speech-to-text below). Give the correct British spelling of the single word they meant.',
    user: `They typed: "${String(typed).slice(0, 40)}". They said: "${String(said).slice(0, 80)}". Sentence: "${String(context).slice(0, 300)}"`,
    schema: SaidSchema,
    maxTokens: 500,
    effort: 'low',
  });
  return out.word.trim();
}

// ---------------------------------------------------------------- spelling: example sentences

const SentencesSchema = z.object({ sentences: z.array(z.object({ word: z.string(), sentence: z.string() })) });

export async function spellingSentences(words) {
  const out = await askJSON({
    system: 'You write one short, clear, fun example sentence per spelling word for a UK primary school spelling test. 6-14 words, uses the word exactly as given, British English.',
    user: `Words: ${words.join(', ')}`,
    schema: SentencesSchema,
    maxTokens: 1500,
    effort: 'low',
  });
  return out.sentences;
}
