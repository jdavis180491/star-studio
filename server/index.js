import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store/index.js';
import { kidsRouter } from './routes/kids.js';
import { parentRouter } from './routes/parent.js';
import { claudeEnabled } from './ai/claude.js';
import { voiceEnabled } from './ai/voice.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');

const store = await createStore();
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

// Basic safety headers. The microphone and camera may only be used by our own pages.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(self), geolocation=()');
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, phase: 3, claude: claudeEnabled(), voice: voiceEnabled(), database: store.kind });
});

app.use('/api/parent', parentRouter(store));
app.use('/api', kidsRouter(store));

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Errors: log the detail, show a friendly message.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status && err.status < 500 ? err.status : 500;
  res.status(status).json({ error: status === 500 ? 'Something went wrong in the studio. Try again.' : err.message });
});

// Serve the built React app.
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res
      .status(503)
      .send('The app has not been built yet. Run "npm run build" (the Replit Run button does this for you).');
  });
}

const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`⭐ Star Studio is running on port ${port}`);
  console.log(`   Claude: ${claudeEnabled() ? 'on' : 'off (add ANTHROPIC_API_KEY)'} · Director voice: ${voiceEnabled() ? 'ElevenLabs' : 'device voice (add ELEVENLABS_API_KEY)'}`);
});
