// Maths question sets: addition, subtraction, number bonds, times tables.
// Addition/subtraction difficulty follows the child's year group; times tables and
// number bonds follow what the grown-up picked in the portal.

export const MATHS_TYPES = [
  { id: 'addition', name: 'Addition', icon: '➕' },
  { id: 'subtraction', name: 'Subtraction', icon: '➖' },
  { id: 'bonds', name: 'Number bonds', icon: '🔗' },
  { id: 'times', name: 'Times tables', icon: '✖️' },
];
export const TIMES_TABLES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
export const BOND_TARGETS = [5, 10, 20, 50, 100];
export const QUESTIONS_PER_SET = 5;

export const DEFAULT_MATHS = { timesTables: [2, 5, 10], bonds: [10] };

const r = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

export function mathsSettings(kidSettings = {}) {
  const m = { ...DEFAULT_MATHS, ...(kidSettings.maths || {}) };
  m.timesTables = (m.timesTables || []).map(Number).filter((n) => TIMES_TABLES.includes(n));
  m.bonds = (m.bonds || []).map(Number).filter((n) => BOND_TARGETS.includes(n));
  if (!m.timesTables.length) m.timesTables = DEFAULT_MATHS.timesTables;
  if (!m.bonds.length) m.bonds = DEFAULT_MATHS.bonds;
  return m;
}

// [smallest, largest] operand ranges for + and − by year group.
const RANGES = {
  R: () => {
    const a = r(1, 5);
    return [a, r(1, 10 - a)];
  },
  Y1: () => {
    const a = r(2, 12);
    return [a, r(1, 20 - a)];
  },
  Y2: () => (Math.random() < 0.5 ? [r(11, 89), r(1, 9)] : [r(1, 8) * 10 + r(1, 9), r(1, 4) * 10]),
  Y3: () => [r(20, 99), r(11, 99)],
  Y4: () => [r(100, 999), r(10, 999)],
  Y5: () => [r(1000, 9999), r(100, 999)],
  Y6: () => [r(1000, 99999), r(100, 9999)],
};

function question(type, yearGroup, settings) {
  if (type === 'addition') {
    const [a, b] = (RANGES[yearGroup] || RANGES.Y2)();
    return { q: `${a} + ${b}`, answer: a + b, a, b, op: '+' };
  }
  if (type === 'subtraction') {
    let [a, b] = (RANGES[yearGroup] || RANGES.Y2)();
    if (yearGroup === 'R' || yearGroup === 'Y1') a += b; // keep answers within 10 / 20
    if (b > a) [a, b] = [b, a];
    return { q: `${a} − ${b}`, answer: a - b, a, b, op: '−' };
  }
  if (type === 'bonds') {
    const target = settings.bonds[r(0, settings.bonds.length - 1)];
    const step = target >= 50 ? (Math.random() < 0.6 ? 5 : 1) : 1;
    const a = Math.floor(r(0, target) / step) * step;
    return { q: `${a} + ? = ${target}`, answer: target - a, a, b: target, op: 'bond' };
  }
  const table = settings.timesTables[r(0, settings.timesTables.length - 1)];
  const n = r(1, 12);
  return Math.random() < 0.5 ? { q: `${n} × ${table}`, answer: n * table, a: n, b: table, op: '×' } : { q: `${table} × ${n}`, answer: n * table, a: table, b: n, op: '×' };
}

/** Five questions, no repeats. */
export function makeSet(type, yearGroup, kidSettings) {
  const settings = mathsSettings(kidSettings);
  const out = [];
  const seen = new Set();
  for (let tries = 0; out.length < QUESTIONS_PER_SET && tries < 60; tries++) {
    const q = question(type, yearGroup, settings);
    if (seen.has(q.q)) continue;
    seen.add(q.q);
    out.push(q);
  }
  return out;
}
