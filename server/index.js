import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sampleBriefs } from './data/sampleBriefs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// Basic safety headers. The microphone (and later the camera) may only be used by our own pages.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(self), geolocation=()');
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, phase: 1 });
});

app.get('/api/briefs/samples', (req, res) => {
  res.json({ briefs: sampleBriefs });
});

// One challenge per day: everyone in the group gets the same brief.
// (Phase 2 replaces this with a Claude-written, parent-approved brief per group per day.)
app.get('/api/briefs/today', (req, res) => {
  const main = sampleBriefs.filter((b) => b.ageGroup === 'star');
  const day = Math.floor(Date.now() / 86400000);
  res.json({ brief: main[day % main.length], date: new Date().toISOString().slice(0, 10) });
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
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
});
