import pg from 'pg';
import { withDefaults } from './defaults.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS briefs (
  id SERIAL PRIMARY KEY,
  brief_date DATE NOT NULL,
  track TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  keywords JSONB NOT NULL DEFAULT '[]',
  chunks JSONB NOT NULL DEFAULT '{}',
  picture TEXT,
  source TEXT NOT NULL DEFAULT 'claude',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  UNIQUE (brief_date, track)
);
`;

const toBrief = (r) =>
  r && {
    id: r.id,
    date: r.brief_date instanceof Date ? r.brief_date.toISOString().slice(0, 10) : String(r.brief_date).slice(0, 10),
    track: r.track,
    status: r.status,
    title: r.title,
    text: r.body,
    keywords: r.keywords,
    chunks: r.chunks,
    picture: r.picture,
    source: r.source,
  };

export async function createPgStore(url) {
  const pool = new pg.Pool({
    connectionString: url,
    ssl: /localhost|127\.0\.0\.1|host=\//.test(url) || url.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
    max: 5,
  });
  // DATE columns come back as plain strings, not shifted JS Dates.
  pg.types.setTypeParser(1082, (v) => v);
  await pool.query(SCHEMA);

  return {
    kind: 'postgres',
    async getSettings() {
      const { rows } = await pool.query(`SELECT data FROM app_settings WHERE id = 'family'`);
      return withDefaults(rows[0]?.data);
    },
    async saveSettings(data) {
      const merged = withDefaults(data);
      await pool.query(
        `INSERT INTO app_settings (id, data) VALUES ('family', $1)
         ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = now()`,
        [merged]
      );
      return merged;
    },
    async getBrief(date, track) {
      const { rows } = await pool.query(`SELECT * FROM briefs WHERE brief_date = $1 AND track = $2`, [date, track]);
      return toBrief(rows[0]);
    },
    async saveBrief(b) {
      const { rows } = await pool.query(
        `INSERT INTO briefs (brief_date, track, status, title, body, keywords, chunks, picture, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (brief_date, track) DO UPDATE SET
           status = EXCLUDED.status, title = EXCLUDED.title, body = EXCLUDED.body,
           keywords = EXCLUDED.keywords, chunks = EXCLUDED.chunks, picture = EXCLUDED.picture,
           source = EXCLUDED.source,
           approved_at = CASE WHEN EXCLUDED.status = 'approved' THEN now() ELSE NULL END
         RETURNING *`,
        [b.date, b.track, b.status, b.title, b.text, JSON.stringify(b.keywords || []), JSON.stringify(b.chunks || {}), b.picture || null, b.source || 'claude']
      );
      return toBrief(rows[0]);
    },
    async recentKeywords(track, beforeDate, days = 6) {
      const { rows } = await pool.query(
        `SELECT keywords FROM briefs WHERE track = $1 AND brief_date < $2 AND brief_date >= ($2::date - $3::int)`,
        [track, beforeDate, days]
      );
      return rows.flatMap((r) => r.keywords);
    },
  };
}
