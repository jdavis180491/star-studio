// Phase 1 keeps coins and reading logs on this device only.
// From Phase 5 they move to the server database with proper accounts.

const KEY_COINS = 'ss.coins';
const KEY_LOG = 'ss.readingLog';
export const START_COINS = 20;
export const HELP_COST = 2;

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private browsing: fine, just not saved */
  }
}

export const loadCoins = () => read(KEY_COINS, START_COINS);
export const saveCoins = (n) => write(KEY_COINS, n);

export function logReading(entry) {
  const log = read(KEY_LOG, []);
  log.push({ ...entry, at: new Date().toISOString() });
  write(KEY_LOG, log.slice(-100));
}
