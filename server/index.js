import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './db.js';
import { loadSession, requireAppHeader } from './auth.js';
import { authRouter } from './routes/auth.js';
import { parentRouter } from './routes/parent.js';
import { kidRouter } from './routes/kid.js';
import { learnRouter } from './routes/learn.js';
import { mediaRouter } from './routes/media.js';
import { sampleBriefs } from './data/sampleBriefs.js';
import { claudeEnabled } from './ai/claude.js';
import { voiceEnabled } from './ai/voice.js';
import { transcribeEnabled } from './ai/transcribe.js';
import { initStorage, storageKind } from './media/storage.js';
import { resumeJobs, queueLength } from './media/render.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');

if (!process.env.SESSION_SECRET) {
  console.warn('⚠️  SESSION_SECRET is not set: video links will stop working after each restart. Add it in Replit Secrets.');
}

await migrate();
await initStorage();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(self), geolocation=()');
  next();
});

app.use('/api', loadSession, requireAppHeader);
// Video uploads stream straight to disk; everything else is small JSON.
app.use('/api', (req, res, next) => (req.path.endsWith('/raw') ? next() : express.json({ limit: '1mb' })(req, res, next)));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    app: 'dibbly-dobs',
    claude: claudeEnabled(),
    voice: voiceEnabled(),
    transcribe: transcribeEnabled(),
    database: 'postgres',
    storage: storageKind(),
    renderQueue: queueLength(),
  });
});
app.get('/api/briefs/samples', (req, res) => res.json({ briefs: sampleBriefs }));

app.use('/api', authRouter());
app.use('/api/parent', parentRouter());
app.use('/api', mediaRouter());
app.use('/api', kidRouter());
app.use('/api', learnRouter());

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status && err.status < 500 ? err.status : 500;
  if (res.headersSent) return;
  res.status(status).json({ error: status === 500 ? 'Something went wrong in the studio. Try again.' : err.message });
});

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.get('/', (req, res) => res.status(503).send('The app has not been built yet. Run "npm run build".'));
}

const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`🟣 Dibbly Dobs is running on port ${port}`);
  console.log(
    `   Claude: ${claudeEnabled() ? 'on' : 'off'} · Voice: ${voiceEnabled() ? 'ElevenLabs' : 'device'} · Transcripts: ${transcribeEnabled() ? 'Whisper' : 'off'} · Storage: ${storageKind()}`
  );
  resumeJobs().catch((e) => console.warn('Could not resume jobs', e.message));
});
