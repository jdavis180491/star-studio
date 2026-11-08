// The automatic daily briefs: one idea per day, with an older (age 7+) and a young (age 5 and below)
// version. Everyone gets the same one; the app works through the list in order, then starts again.
// The admin can replace any day from the grown-ups' Daily briefs tab.
import part1 from './briefBank1.js';
import part2 from './briefBank2.js';
import part3 from './briefBank3.js';

export const BRIEF_BANK = [...part1, ...part2, ...part3].map(([emoji, title, older, young], i) => ({
  id: `bank-${i + 1}`,
  emoji,
  title,
  older,
  young,
}));
