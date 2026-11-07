// Fallback store for running without a database (local development).
// Data lives in .data/store.json. On Replit, add the Postgres database instead.
import fs from 'node:fs';
import path from 'node:path';
import { withDefaults } from './defaults.js';

export function createFileStore(file = path.join(process.cwd(), '.data', 'store.json')) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const load = () => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return { settings: {}, briefs: {} };
    }
  };
  const save = (db) => fs.writeFileSync(file, JSON.stringify(db, null, 2));
  let nextId = 1;

  return {
    kind: 'file',
    async getSettings() {
      return withDefaults(load().settings);
    },
    async saveSettings(data) {
      const db = load();
      db.settings = withDefaults(data);
      save(db);
      return db.settings;
    },
    async getBrief(date, track) {
      return load().briefs[`${date}:${track}`] || null;
    },
    async saveBrief(b) {
      const db = load();
      const key = `${b.date}:${b.track}`;
      const brief = { id: db.briefs[key]?.id || Date.now() + nextId++, ...b };
      db.briefs[key] = brief;
      save(db);
      return brief;
    },
    async recentKeywords(track, beforeDate, days = 6) {
      const from = new Date(`${beforeDate}T12:00:00Z`);
      from.setUTCDate(from.getUTCDate() - days);
      const fromISO = from.toISOString().slice(0, 10);
      return Object.values(load().briefs)
        .filter((b) => b.track === track && b.date < beforeDate && b.date >= fromISO)
        .flatMap((b) => b.keywords);
    },
  };
}
