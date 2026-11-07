// Starter phonics / spelling word bank by year group (England's national curriculum).
// Reception & Year 1 lean on phonics phases; Years 2–6 use the statutory spelling lists.
// Little Stars keywords come from `cvc` (simple consonant-vowel-consonant words).

export const YEAR_GROUPS = ['R', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'];

export const YEAR_LABELS = {
  R: 'Reception',
  Y1: 'Year 1',
  Y2: 'Year 2',
  Y3: 'Year 3',
  Y4: 'Year 4',
  Y5: 'Year 5',
  Y6: 'Year 6',
};

const cvc = [
  'cat', 'dog', 'sun', 'hat', 'pig', 'bug', 'red', 'map', 'hop', 'bed', 'fan', 'net',
  'pot', 'cup', 'jam', 'zip', 'web', 'fox', 'box', 'leg', 'bus', 'rug', 'hen', 'log',
  'mud', 'pen', 'sit', 'tap', 'van', 'wet', 'run', 'jet', 'mop', 'nap', 'pin', 'tub',
  'wig', 'yak', 'kit', 'dig', 'hug', 'bat', 'cub', 'fin', 'hum', 'lip', 'top', 'vet',
];

const y34 = [
  'accident', 'actual', 'address', 'answer', 'appear', 'arrive', 'believe', 'bicycle',
  'breath', 'breathe', 'build', 'busy', 'calendar', 'caught', 'centre', 'century',
  'certain', 'circle', 'complete', 'consider', 'continue', 'decide', 'describe',
  'different', 'difficult', 'disappear', 'early', 'earth', 'eight', 'enough', 'exercise',
  'experience', 'experiment', 'extreme', 'famous', 'favourite', 'forward', 'fruit',
  'group', 'guard', 'guide', 'heard', 'heart', 'height', 'history', 'imagine',
  'important', 'increase', 'interest', 'island', 'knowledge', 'learn', 'length',
  'library', 'material', 'medicine', 'mention', 'minute', 'natural', 'naughty', 'notice',
  'occasion', 'often', 'opposite', 'ordinary', 'particular', 'peculiar', 'perhaps',
  'popular', 'position', 'possible', 'potatoes', 'pressure', 'probably', 'promise',
  'purpose', 'quarter', 'question', 'recent', 'regular', 'remember', 'sentence',
  'separate', 'special', 'straight', 'strange', 'strength', 'suppose', 'surprise',
  'therefore', 'though', 'although', 'thought', 'through', 'various', 'weight', 'woman',
  'women',
];

export const WORD_BANK = {
  R: {
    cvc,
    tricky: ['the', 'to', 'go', 'no', 'into', 'he', 'she', 'we', 'me', 'be', 'was', 'my', 'you', 'they', 'her', 'all', 'are', 'said', 'have', 'like', 'some', 'come', 'little', 'one', 'do', 'when', 'out', 'what'],
  },
  Y1: {
    words: [
      'rain', 'night', 'boat', 'shout', 'chair', 'green', 'light', 'team', 'coin', 'purple',
      'shark', 'storm', 'crown', 'snail', 'spoon', 'dream', 'cloud', 'thunder', 'jump',
      'crash', 'splash', 'frog', 'brush', 'thing', 'king', 'shell', 'chip', 'quick',
      'friend', 'school', 'push', 'pull', 'full', 'house', 'our', 'once', 'ask', 'love',
      'here', 'there', 'where', 'today', 'were', 'says', 'your', 'pull',
    ],
  },
  Y2: {
    words: [
      'because', 'children', 'people', 'water', 'again', 'every', 'everybody', 'great',
      'break', 'pretty', 'beautiful', 'after', 'fast', 'last', 'father', 'class', 'grass',
      'plant', 'path', 'bath', 'hour', 'move', 'improve', 'sure', 'sugar', 'eye', 'could',
      'should', 'would', 'who', 'whole', 'any', 'many', 'clothes', 'busy', 'money',
      'parents', 'kind', 'mind', 'behind', 'child', 'wild', 'climb', 'most', 'only',
      'both', 'old', 'cold', 'gold', 'hold', 'told', 'even', 'door', 'floor', 'poor',
    ],
  },
  Y3: { words: y34 },
  Y4: { words: y34 },
  Y5: {
    words: [
      'accommodate', 'accompany', 'according', 'achieve', 'aggressive', 'amateur', 'ancient',
      'apparent', 'appreciate', 'attached', 'available', 'average', 'awkward', 'bargain',
      'bruise', 'category', 'committee', 'communicate', 'community', 'competition',
      'conscience', 'conscious', 'controversy', 'convenience', 'correspond', 'criticise',
      'curiosity', 'definite', 'desperate', 'determined', 'develop', 'dictionary',
      'disastrous', 'embarrass', 'environment', 'equip', 'especially', 'exaggerate',
      'excellent', 'existence', 'explanation', 'familiar', 'foreign', 'forty', 'frequently',
      'government', 'guarantee', 'identity', 'immediately', 'individual', 'interfere',
      'interrupt', 'language', 'leisure', 'lightning', 'marvellous', 'mischievous', 'muscle',
      'necessary', 'neighbour', 'nuisance', 'occupy', 'occur', 'opportunity', 'parliament',
      'persuade', 'physical', 'prejudice', 'privilege', 'profession', 'programme',
      'pronunciation', 'queue', 'recognise', 'recommend', 'relevant', 'restaurant', 'rhyme',
      'rhythm', 'sacrifice', 'secretary', 'shoulder', 'signature', 'sincere', 'soldier',
      'stomach', 'sufficient', 'suggest', 'symbol', 'system', 'temperature', 'thorough',
      'twelfth', 'variety', 'vegetable', 'vehicle', 'yacht',
    ],
  },
};
WORD_BANK.Y6 = WORD_BANK.Y5;

export function wordsFor(yearGroup, { little = false } = {}) {
  if (little) return WORD_BANK.R.cvc;
  const g = WORD_BANK[yearGroup] || WORD_BANK.Y3;
  return [...new Set(g.words || [...g.cvc, ...g.tricky])];
}

/** Pick n words at random, avoiding recently used ones where possible. */
export function pickWords(pool, n, avoid = []) {
  const avoidSet = new Set(avoid.map((w) => w.toLowerCase()));
  const fresh = pool.filter((w) => !avoidSet.has(w.toLowerCase()));
  const source = fresh.length >= n ? fresh : pool;
  const copy = [...new Set(source)];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}
