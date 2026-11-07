// Shop items, avatar parts and trophies. Prices are in coins.

export const HELP_COST = 2;

export const AVATAR_DEFAULT = {
  skin: 's3',
  hair: 'short',
  hairColor: 'brown',
  eyes: 'happy',
  top: 'hoodie',
  topColor: 'pink',
  hat: null,
  glasses: null,
  bg: 'sunset',
};

// Free choices.
export const AVATAR_OPTIONS = {
  skin: ['s1', 's2', 's3', 's4', 's5', 's6'],
  hair: ['short', 'curly', 'long', 'bun', 'spiky', 'bald'],
  hairColor: ['black', 'brown', 'blonde', 'ginger', 'blue', 'pink'],
  eyes: ['happy', 'wide', 'wink'],
  topColor: ['pink', 'lime', 'cyan', 'orange', 'purple', 'black'],
  bg: ['sunset', 'ocean', 'galaxy', 'lime'],
};

// Paid items. type decides which avatar slot (or the studio) they go in.
export const SHOP = [
  { id: 'top-tee', type: 'top', name: 'Tee', price: 0 },
  { id: 'top-hoodie', type: 'top', name: 'Hoodie', price: 0 },
  { id: 'top-jacket', type: 'top', name: 'Bomber jacket', price: 30 },
  { id: 'top-sport', type: 'top', name: 'Sports kit', price: 20 },
  { id: 'top-sparkle', type: 'top', name: 'Sparkle suit', price: 50 },
  { id: 'hat-cap', type: 'hat', name: 'Cap', price: 15 },
  { id: 'hat-beanie', type: 'hat', name: 'Beanie', price: 15 },
  { id: 'hat-headphones', type: 'hat', name: 'Headphones', price: 30 },
  { id: 'hat-wizard', type: 'hat', name: 'Wizard hat', price: 40 },
  { id: 'hat-crown', type: 'hat', name: 'Crown', price: 60 },
  { id: 'glasses-shades', type: 'glasses', name: 'Shades', price: 20 },
  { id: 'glasses-hearts', type: 'glasses', name: 'Heart specs', price: 25 },
  { id: 'glasses-stars', type: 'glasses', name: 'Star specs', price: 35 },
  { id: 'glasses-visor', type: 'glasses', name: 'Cyber visor', price: 45 },
  { id: 'decor-plant', type: 'decor', name: 'Plant', price: 10 },
  { id: 'decor-poster', type: 'decor', name: 'Space poster', price: 15 },
  { id: 'decor-rug', type: 'decor', name: 'Neon rug', price: 15 },
  { id: 'decor-lava', type: 'decor', name: 'Lava lamp', price: 20 },
  { id: 'decor-fairy', type: 'decor', name: 'Fairy lights', price: 20 },
  { id: 'decor-neon', type: 'decor', name: 'Neon star sign', price: 25 },
  { id: 'decor-ringlight', type: 'decor', name: 'Ring light', price: 30 },
  { id: 'decor-chair', type: 'decor', name: 'Gamer chair', price: 40 },
  { id: 'decor-cat', type: 'decor', name: 'Studio cat', price: 50 },
  { id: 'decor-disco', type: 'decor', name: 'Disco ball', price: 60 },
];

export const FREE_ITEMS = SHOP.filter((i) => i.price === 0).map((i) => i.id);

export const TROPHIES = [
  { at: 100, id: 'rising', name: 'Rising Star', bonus: 20 },
  { at: 1000, id: 'hitmaker', name: 'Hit Maker', bonus: 50 },
  { at: 10000, id: 'mega', name: 'Mega Star', bonus: 100 },
];

export const trophiesFor = (followers) => TROPHIES.filter((t) => followers >= t.at).map((t) => t.id);

export const STICKERS = ['🔥', '😂', '😮', '👏', '💖', '🤯'];
export const AWARDS = [
  { id: 'funniest', name: 'Funniest' },
  { id: 'dance', name: 'Best Dance' },
  { id: 'creative', name: 'Most Creative' },
];

/** Keep only valid avatar fields; equipped paid items must be owned. */
export function cleanAvatar(input = {}, owned = []) {
  const ownedSet = new Set([...owned, ...FREE_ITEMS]);
  const out = { ...AVATAR_DEFAULT };
  for (const [k, opts] of Object.entries(AVATAR_OPTIONS)) if (opts.includes(input[k])) out[k] = input[k];
  for (const slot of ['top', 'hat', 'glasses']) {
    const v = input[slot];
    if (v === null) out[slot] = slot === 'top' ? 'hoodie' : null;
    else if (typeof v === 'string' && ownedSet.has(`${slot}-${v}`)) out[slot] = v;
  }
  return out;
}
