// Renders the home-screen icons from client/public/dob.svg. Run: node scripts/make-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'public');
const svg = await loadImage(fs.readFileSync(path.join(pub, 'dob.svg')));
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  const c = createCanvas(size, size);
  const g = c.getContext('2d');
  g.fillStyle = '#0a0a10';
  g.fillRect(0, 0, size, size);
  const s = size * 0.74;
  g.drawImage(svg, (size - s) / 2, (size - s) / 2, s, s);
  fs.writeFileSync(path.join(pub, name), await c.encode('png'));
  console.log('wrote', name);
}
