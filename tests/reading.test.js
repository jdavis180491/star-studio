import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadingTracker, heardWord } from '../client/src/reading/tracker.js';
import { wordsMatch, tokenizeBrief } from '../client/src/reading/words.js';
import { chunkWord } from '../client/src/reading/phonics.js';
import { sampleBriefs } from '../server/data/sampleBriefs.js';

const sock = sampleBriefs.find((b) => b.id === 'sock-monster');
const gravity = sampleBriefs.find((b) => b.id === 'gravity-switch');

test('perfect reading unlocks', () => {
  const t = new ReadingTracker(sock.text, sock.keywords);
  t.ingest(1, sock.text);
  const s = t.snapshot();
  assert.equal(s.progress, 1);
  assert.ok(s.unlocked);
});

test('reading across several paused sessions unlocks', () => {
  const t = new ReadingTracker(sock.text, sock.keywords);
  const sentences = sock.text.split(/(?<=[.!?])\s+/);
  sentences.forEach((sent, i) => t.ingest(`s${i}`, sent));
  assert.ok(t.snapshot().unlocked);
});

test('interim results growing word by word', () => {
  const t = new ReadingTracker(gravity.text, gravity.keywords);
  const words = gravity.text.split(' ');
  for (let i = 1; i <= words.length; i++) t.ingest(1, words.slice(0, i).join(' '));
  assert.ok(t.snapshot().unlocked);
});

test('typical speech-engine mistakes still unlock', () => {
  const t = new ReadingTracker(sock.text, sock.keywords);
  // dropped "a", misheard "sneaky"->"sneaking", "tiptoe"->"tip toe", lowercase, no punctuation
  t.ingest(1, 'breaking news sneaking monster has stolen every left sock in your house');
  t.ingest(2, 'you must whisper a secret plan to catch it because monsters have super ears');
  t.ingest(3, 'show us your best sneaky tip toe then shout your big monster move');
  const s = t.snapshot();
  assert.ok(s.progress >= 0.9, `progress ${s.progress}`);
  assert.ok(s.unlocked);
});

test('a missed keyword holds the reading there until it is said (or the say-it helper is used)', () => {
  const t = new ReadingTracker(sock.text, sock.keywords);
  t.ingest(1, sock.text.replace('because', 'cos'));
  let s = t.snapshot();
  assert.equal(t.tokens[s.nextIndex].norm, 'because');
  assert.equal(s.unlocked, false);
  t.forceKeyword('because');
  t.ingest(2, 'monsters have super ears show us your best sneaky tiptoe then shout your big monster move');
  s = t.snapshot();
  assert.ok(s.unlocked);
});

test('skipping a word stops the tracker and flags the word until it is read', () => {
  const t = new ReadingTracker('The big dragon was very hungry today.', []);
  t.ingest(1, 'the big was very hungry');
  let s = t.snapshot();
  assert.equal(t.tokens[s.nextIndex].norm, 'dragon', 'still waiting for "dragon"');
  assert.equal(s.stuck, s.nextIndex, 'flashes red');
  assert.equal(s.status[3], 'unread', 'words after the skipped one are not counted');
  assert.equal(s.unlocked, false);
  t.ingest(2, 'dragon was very hungry today');
  s = t.snapshot();
  assert.equal(s.stuck, null);
  assert.equal(s.unlocked, true);
});

test('word help on the next word counts it, but not on a word further on', () => {
  const t = new ReadingTracker('Suddenly the gravity switches off.', []);
  assert.equal(t.helpedWith(2), false, 'cannot skip ahead with help');
  assert.equal(t.helpedWith(0), true);
  t.ingest(1, 'the gravity switches off');
  assert.ok(t.snapshot().unlocked);
});

test('random chatter does not light up the brief', () => {
  const t = new ReadingTracker(sock.text, sock.keywords);
  t.ingest(1, 'mummy can I have a biscuit please I am hungry and the dog is barking');
  assert.ok(t.snapshot().progress < 0.15, `progress ${t.snapshot().progress}`);
});

test('reading only half does not unlock', () => {
  const t = new ReadingTracker(gravity.text, gravity.keywords);
  t.ingest(1, 'Suddenly, gravity switches off in your bedroom! Your teddy, your toys and even your snacks start to float away.');
  const s = t.snapshot();
  assert.ok(s.progress < 0.6);
  assert.equal(s.unlocked, false);
});

test('going back to re-read then carrying on', () => {
  const t = new ReadingTracker(gravity.text, gravity.keywords);
  t.ingest(1, 'suddenly gravity switches off in your bedroom your teddy your toys');
  assert.equal(t.snapshot().stuck, null);
  t.ingest(2, 'your teddy your toys and even your snacks start to float away show us how you swim through the air to grab them then gravity comes back on what happens next');
  assert.ok(t.snapshot().unlocked);
});

test('numbers as digits match words', () => {
  assert.ok(wordsMatch('two', '2'.replace('2', 'two')));
  const t = new ReadingTracker('I have two cats and 3 dogs.', []);
  t.ingest(1, 'I have 2 cats and three dogs');
  assert.equal(t.snapshot().progress, 1);
});

test('single-word helper is forgiving', () => {
  assert.ok(heardWord('because', 'be cause'));
  assert.ok(heardWord('because', 'becuz'));
  assert.ok(heardWord('whisper', 'whisperer'));
  assert.ok(heardWord('bug', 'a bug'));
  assert.equal(heardWord('gravity', 'banana'), false);
});

test('hyphenated words become two tokens', () => {
  const tokens = tokenizeBrief('A monster-catching move!');
  assert.deepEqual(tokens.map((t) => t.norm), ['a', 'monster', 'catching', 'move']);
});

test('phonics chunks', () => {
  const cases = {
    monster: ['mon', 'ster'],
    robot: ['ro', 'bot'],
    float: ['fl', 'oat'],
    suddenly: ['sud', 'den', 'ly'],
    whisper: ['whis', 'per'],
    because: ['be', 'cause'],
    table: ['ta', 'ble'],
    rocket: ['rock', 'et'],
    cat: ['c', 'at'],
    jumped: ['j', 'umped'],
    disaster: ['di', 'sas', 'ter'],
    breakfast: ['break', 'fast'],
  };
  for (const [w, want] of Object.entries(cases)) assert.deepEqual(chunkWord(w), want, w);
});

test('does not unlock before the last sentence is read', () => {
  const t = new ReadingTracker(sock.text, sock.keywords);
  // Everything except the final sentence: well over 80% of words, all keywords.
  t.ingest(1, 'Breaking news! A sneaky monster has stolen every left sock in your house. You must whisper a secret plan to catch it, because monsters have super ears. Show us your best sneaky tiptoe.');
  const s = t.snapshot();
  assert.ok(s.progress >= 0.75, `progress ${s.progress}`);
  assert.equal(s.unlocked, false);
  t.ingest(2, 'then shout your big monster move');
  assert.ok(t.snapshot().unlocked);
});

test('two close tries at a misheard word count it; three tries ask for word help', () => {
  const t = new ReadingTracker('The enormous dragon sneezed.', []);
  t.ingest(1, 'the enemies');
  assert.equal(t.snapshot().nextIndex, 1, 'one close try is not enough yet');
  t.ingest(2, 'enemas');
  assert.equal(t.snapshot().status[1], 'read', 'second close try counts');
  t.ingest(3, 'banana');
  t.ingest(4, 'pizza');
  assert.equal(t.snapshot().needsHelp, null, 'two tries so far');
  t.ingest(5, 'table');
  assert.equal(t.snapshot().needsHelp, 2, 'three tries: help pops up for "dragon"');
  assert.equal(t.helpedWith(2), true);
  t.ingest(6, 'sneezed');
  assert.ok(t.snapshot().unlocked);
});

test('words further on never count as tries at the skipped word', () => {
  const t = new ReadingTracker('Tiptoe past the sleeping giant quietly.', []);
  t.ingest(1, 'past the sleeping giant');
  const s = t.snapshot();
  assert.equal(s.status[0], 'unread');
  assert.equal(s.stuck, 0);
});
