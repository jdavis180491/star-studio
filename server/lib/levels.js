// Each child has a reading level (their year group). Writing, spelling and maths follow it
// unless a grown-up sets a different level for that subject.
import { YEAR_GROUPS } from '../data/wordBank.js';

export const SUBJECTS = ['writing', 'spelling', 'maths'];

/** Keep only real year groups; anything else means "same as reading". */
export function cleanLevels(input = {}) {
  const out = {};
  for (const s of SUBJECTS) if (YEAR_GROUPS.includes(input?.[s])) out[s] = input[s];
  return out;
}

export function levelFor(kid, subject) {
  if (subject !== 'reading') {
    const own = kid.settings?.levels?.[subject];
    if (YEAR_GROUPS.includes(own)) return own;
  }
  return kid.year_group || (kid.track === 'little' ? 'R' : 'Y3');
}
