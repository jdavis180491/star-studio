// Postgres connection + schema migrations (run automatically at start-up).
import pg from 'pg';

// DATE columns come back as 'YYYY-MM-DD' strings, not shifted JS Dates.
pg.types.setTypeParser(1082, (v) => v);

let pool = null;

export function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set. In Replit, add a PostgreSQL database (Database tool).');
    const local = /localhost|127\.0\.0\.1|host=\//.test(url) || url.includes('sslmode=disable');
    pool = new pg.Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 8 });
  }
  return pool;
}

export const q = (text, params) => getPool().query(text, params);
export const one = async (text, params) => (await q(text, params)).rows[0] || null;
export const many = async (text, params) => (await q(text, params)).rows;

/** Run fn(client) inside a transaction. */
export async function tx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

const MIGRATIONS = [
  // 1: tables from the first builds (kept so older databases upgrade cleanly)
  `
  CREATE TABLE IF NOT EXISTS app_settings (id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS briefs (
    id SERIAL PRIMARY KEY, brief_date DATE NOT NULL, track TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
    title TEXT NOT NULL, body TEXT NOT NULL, keywords JSONB NOT NULL DEFAULT '[]', chunks JSONB NOT NULL DEFAULT '{}',
    picture TEXT, source TEXT NOT NULL DEFAULT 'claude', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), approved_at TIMESTAMPTZ
  );
  `,
  // 2: accounts, crews, videos, rewards
  `
  ALTER TABLE briefs ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'legacy';
  ALTER TABLE briefs DROP CONSTRAINT IF EXISTS briefs_brief_date_track_key;
  CREATE UNIQUE INDEX IF NOT EXISTS briefs_scope_date_track ON briefs (scope, brief_date, track);

  CREATE TABLE IF NOT EXISTS families (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    consent_at TIMESTAMPTZ NOT NULL,
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS kids (
    id SERIAL PRIMARY KEY,
    family_id INT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    channel_name TEXT NOT NULL,
    track TEXT NOT NULL DEFAULT 'star',
    year_group TEXT NOT NULL DEFAULT 'Y3',
    pin_hash TEXT NOT NULL,
    avatar JSONB NOT NULL DEFAULT '{}',
    owned JSONB NOT NULL DEFAULT '[]',
    decor JSONB NOT NULL DEFAULT '[]',
    followers INT NOT NULL DEFAULT 0,
    coins INT NOT NULL DEFAULT 20,
    streak INT NOT NULL DEFAULT 0,
    best_streak INT NOT NULL DEFAULT 0,
    last_post_date DATE,
    pin_fails INT NOT NULL DEFAULT 0,
    pin_locked_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    family_id INT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    kid_id INT REFERENCES kids(id) ON DELETE SET NULL,
    parent_until TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS crews (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    invite_code TEXT UNIQUE NOT NULL,
    owner_family_id INT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS crew_members (
    crew_id INT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
    kid_id INT NOT NULL UNIQUE REFERENCES kids(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (crew_id, kid_id)
  );
  CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    kid_id INT NOT NULL REFERENCES kids(id) ON DELETE CASCADE,
    scope TEXT NOT NULL,
    brief_date DATE NOT NULL,
    brief JSONB NOT NULL DEFAULT '{}',
    title TEXT,
    plan JSONB NOT NULL DEFAULT '{}',
    edit JSONB,
    status TEXT NOT NULL DEFAULT 'new',
    raw_key TEXT, raw_mime TEXT, final_key TEXT, thumb_key TEXT,
    seconds INT,
    remixes INT NOT NULL DEFAULT 0,
    transcript TEXT,
    keywords_said JSONB NOT NULL DEFAULT '[]',
    viral BOOLEAN NOT NULL DEFAULT false,
    followers_awarded INT NOT NULL DEFAULT 0,
    render_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    submitted_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS videos_scope_date ON videos (scope, brief_date);
  CREATE INDEX IF NOT EXISTS videos_kid ON videos (kid_id, brief_date);
  CREATE TABLE IF NOT EXISTS reactions (
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    kid_id INT NOT NULL REFERENCES kids(id) ON DELETE CASCADE,
    sticker TEXT NOT NULL,
    PRIMARY KEY (video_id, kid_id, sticker)
  );
  CREATE TABLE IF NOT EXISTS awards (
    id SERIAL PRIMARY KEY,
    scope TEXT NOT NULL,
    award_date DATE NOT NULL,
    from_kid INT NOT NULL REFERENCES kids(id) ON DELETE CASCADE,
    to_kid INT NOT NULL REFERENCES kids(id) ON DELETE CASCADE,
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    award TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (from_kid, award_date)
  );
  CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    kid_id INT NOT NULL REFERENCES kids(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    followers INT NOT NULL DEFAULT 0,
    coins INT NOT NULL DEFAULT 0,
    meta JSONB NOT NULL DEFAULT '{}',
    event_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS events_kid_date ON events (kid_id, event_date);
  CREATE TABLE IF NOT EXISTS reading_logs (
    id SERIAL PRIMARY KEY,
    kid_id INT NOT NULL REFERENCES kids(id) ON DELETE CASCADE,
    brief_title TEXT,
    words_read INT NOT NULL DEFAULT 0,
    total_words INT NOT NULL DEFAULT 0,
    helped JSONB NOT NULL DEFAULT '[]',
    keywords JSONB NOT NULL DEFAULT '[]',
    keywords_read JSONB NOT NULL DEFAULT '[]',
    keywords_forced JSONB NOT NULL DEFAULT '[]',
    grown_up_skip BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS reels (
    scope TEXT NOT NULL,
    week_start DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'rendering',
    media_key TEXT,
    video_ids JSONB NOT NULL DEFAULT '[]',
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, week_start)
  );
  `,
];

export async function migrate() {
  await q(`CREATE TABLE IF NOT EXISTS schema_migrations (id INT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const done = new Set((await many(`SELECT id FROM schema_migrations`)).map((r) => r.id));
  for (let i = 0; i < MIGRATIONS.length; i++) {
    const id = i + 1;
    if (done.has(id)) continue;
    await tx(async (c) => {
      await c.query(MIGRATIONS[i]);
      await c.query(`INSERT INTO schema_migrations (id) VALUES ($1)`, [id]);
    });
    console.log(`🗄️  Database migration ${id} applied`);
  }
}
