// Draws the edit's graphics (intro card, captions, lyric cards, outro) as PNGs.
// ffmpeg then layers them over / around the child's clip.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

const here = path.dirname(fileURLToPath(import.meta.url));
const FONTS = path.join(here, '..', 'assets', 'fonts');
GlobalFonts.registerFromPath(path.join(FONTS, 'Unbounded_900Black.ttf'), 'Unbounded Black');
GlobalFonts.registerFromPath(path.join(FONTS, 'Unbounded_700Bold.ttf'), 'Unbounded Bold');
GlobalFonts.registerFromPath(path.join(FONTS, 'Lexend_800ExtraBold.ttf'), 'Lexend XB');

export const W = 1280;
export const H = 720;
const C = { bg: '#0a0a10', hot: '#ff2e63', orange: '#ff8a00', lime: '#c6ff3d', cyan: '#3de1ff', ink: '#f6f6fb', purple: '#7a1fff' };

const MOOD_COLORS = {
  funny: [C.hot, C.orange],
  dramatic: [C.purple, C.hot],
  spooky: ['#2b0a4a', '#3c8f00'],
  epic: ['#0a3cff', C.purple],
};

function save(canvas, file) {
  fs.writeFileSync(file, canvas.toBuffer('image/png'));
  return file;
}

/** Shrink the font until the text fits the width. */
function fitFont(g, text, family, maxSize, maxWidth) {
  let size = maxSize;
  do {
    g.font = `${size}px "${family}"`;
    if (g.measureText(text).width <= maxWidth) break;
    size -= 4;
  } while (size > 18);
  return size;
}

function wrapLines(g, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

function star(g, cx, cy, r, color) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath();
  g.fillStyle = color;
  g.fill();
}

function backdrop(g, mood) {
  const [a, b] = MOOD_COLORS[mood] || MOOD_COLORS.funny;
  const grad = g.createRadialGradient(W * 0.85, -100, 50, W * 0.6, H * 0.4, W);
  grad.addColorStop(0, a);
  grad.addColorStop(0.45, b);
  grad.addColorStop(1, C.bg);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.globalAlpha = 0.06;
  g.fillStyle = '#fff';
  for (let y = 0; y < H; y += 6) g.fillRect(0, y, W, 2);
  g.globalAlpha = 1;
}

export function introCard(file, { channelName, title, tagline, mood }) {
  const cv = createCanvas(W, H);
  const g = cv.getContext('2d');
  backdrop(g, mood);
  star(g, 120, 120, 44, C.lime);
  g.fillStyle = C.lime;
  g.font = '34px "Unbounded Bold"';
  g.fillText(String(channelName).toUpperCase(), 186, 134);
  const t = String(title).toUpperCase();
  // Big title: try two lines at a large size, otherwise shrink to fit.
  g.font = '120px "Unbounded Black"';
  let lines = wrapLines(g, t, W - 200);
  if (lines.length > 2 || lines.some((l) => g.measureText(l).width > W - 200)) {
    fitFont(g, t, 'Unbounded Black', 110, W - 200);
    lines = [t];
  }
  const size = parseInt(g.font, 10);
  g.fillStyle = C.ink;
  lines.forEach((l, i) => g.fillText(l, 100, 360 + i * size * 1.02));
  if (tagline) {
    g.font = '40px "Lexend XB"';
    g.fillStyle = C.ink;
    g.globalAlpha = 0.85;
    g.fillText(String(tagline), 104, 360 + lines.length * size * 1.02 + 40);
    g.globalAlpha = 1;
  }
  return save(cv, file);
}

export function outroCard(file, { channelName, text, mood }) {
  const cv = createCanvas(W, H);
  const g = cv.getContext('2d');
  backdrop(g, mood);
  star(g, W / 2, 220, 80, C.lime);
  g.textAlign = 'center';
  g.fillStyle = C.ink;
  fitFont(g, String(text || 'See you tomorrow!').toUpperCase(), 'Unbounded Black', 84, W - 160);
  g.fillText(String(text || 'See you tomorrow!').toUpperCase(), W / 2, 420);
  g.font = '40px "Unbounded Bold"';
  g.fillStyle = C.lime;
  g.fillText(String(channelName).toUpperCase(), W / 2, 500);
  return save(cv, file);
}

/** A caption "pill" on a transparent frame. */
export function captionOverlay(file, { text, position = 'bottom', index = 0 }) {
  const cv = createCanvas(W, H);
  const g = cv.getContext('2d');
  const t = String(text).toUpperCase();
  fitFont(g, t, 'Unbounded Black', 56, W - 220);
  const size = parseInt(g.font, 10);
  const tw = g.measureText(t).width;
  const padX = 36;
  const bw = tw + padX * 2;
  const bh = size + 44;
  const x = (W - bw) / 2;
  const y = position === 'top' ? 56 : H - bh - 64;
  const colors = [[C.lime, C.bg], [C.hot, C.ink], [C.cyan, C.bg], [C.orange, C.bg]][index % 4];
  g.save();
  g.translate(W / 2, y + bh / 2);
  g.rotate(((index % 2 ? 1 : -1) * 2.5 * Math.PI) / 180);
  g.translate(-W / 2, -(y + bh / 2));
  g.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(g, x + 8, y + 10, bw, bh, 22);
  g.fill();
  g.fillStyle = colors[0];
  roundRect(g, x, y, bw, bh, 22);
  g.fill();
  g.fillStyle = colors[1];
  g.fillText(t, x + padX, y + bh / 2 + size * 0.36);
  g.restore();
  return save(cv, file);
}

/** Sing-along card: all lyric lines, the current one lit up (more reading practice!). */
export function lyricCard(file, { lines, current, keywords = [], channelName, mood }) {
  const cv = createCanvas(W, H);
  const g = cv.getContext('2d');
  backdrop(g, mood);
  g.fillStyle = C.lime;
  g.font = '28px "Unbounded Bold"';
  g.fillText('♪ SING ALONG', 80, 80);
  g.fillStyle = C.ink;
  g.globalAlpha = 0.7;
  g.textAlign = 'right';
  g.fillText(String(channelName).toUpperCase(), W - 80, 80);
  g.textAlign = 'left';
  g.globalAlpha = 1;
  const shown = lines.slice(0, 8);
  const size = shown.length > 6 ? 40 : 48;
  const top = (H - shown.length * size * 1.45) / 2 + size;
  const kw = keywords.map((k) => k.toLowerCase());
  shown.forEach((line, i) => {
    const y = top + i * size * 1.45;
    const active = i === current;
    let x = 80;
    for (const word of String(line).split(/\s+/)) {
      const clean = word.toLowerCase().replace(/[^a-z']/g, '');
      const isKw = kw.some((k) => clean === k || clean.startsWith(k));
      g.font = `${active ? size + 6 : size}px "Lexend XB"`;
      g.fillStyle = active ? (isKw ? C.lime : C.ink) : isKw ? 'rgba(198,255,61,0.5)' : 'rgba(246,246,251,0.4)';
      g.fillText(word, x, y);
      x += g.measureText(`${word} `).width;
    }
    if (active) {
      g.fillStyle = C.hot;
      g.beginPath();
      g.arc(54, y - size * 0.35, 9, 0, Math.PI * 2);
      g.fill();
    }
  });
  return save(cv, file);
}

/** Title card for the Friday Premiere Night reel. */
export function reelCard(file, { heading, sub }) {
  const cv = createCanvas(W, H);
  const g = cv.getContext('2d');
  backdrop(g, 'epic');
  g.textAlign = 'center';
  g.fillStyle = C.lime;
  g.font = '34px "Unbounded Bold"';
  g.fillText(String(sub || '').toUpperCase(), W / 2, 300);
  g.fillStyle = C.ink;
  fitFont(g, String(heading).toUpperCase(), 'Unbounded Black', 96, W - 160);
  g.fillText(String(heading).toUpperCase(), W / 2, 420);
  return save(cv, file);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
