// Live camera effects, drawn onto a canvas every frame (and recorded as-is).
// weather: particle systems · backdrops: animated scenes (child cut out in front)
// looks: colour grades · frames: TV-style overlays · stickers: draggable emoji.

const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- weather
export function createWeather(id, W, H) {
  const parts = [];
  let flash = 0;
  let nextBolt = 2;
  let bolt = null;
  const add = (n, make) => {
    for (let i = 0; i < n; i++) parts.push(make(true));
  };
  const rain = (init) => ({ x: rand(-100, W), y: init ? rand(-H, H) : rand(-200, -20), v: rand(900, 1300), l: rand(18, 34) });
  const snow = (init) => ({ x: rand(0, W), y: init ? rand(-H, H) : -10, v: rand(40, 110), r: rand(2, 6), s: rand(0, TAU) });
  const confetti = (init) => ({ x: rand(0, W), y: init ? rand(-H, H) : -20, v: rand(90, 200), r: rand(0, TAU), vr: rand(-6, 6), c: ['#ff2e63', '#c6ff3d', '#3de1ff', '#ff8a00', '#ffffff', '#a259ff'][Math.floor(rand(0, 6))], w: rand(8, 14) });
  const leaf = (init) => ({ x: rand(0, W), y: init ? rand(-H, H) : -40, v: rand(50, 110), r: rand(0, TAU), vr: rand(-1.5, 1.5), e: Math.random() < 0.5 ? '🍂' : '🍁', s: rand(26, 44), sw: rand(0, TAU) });
  const heart = (init) => ({ x: rand(0, W), y: init ? rand(0, H * 2) : H + 40, v: rand(50, 120), s: rand(24, 46), sw: rand(0, TAU) });
  const sparkle = () => ({ x: rand(0, W), y: rand(0, H), t: rand(0, TAU), s: rand(6, 14) });

  if (id === 'rain') add(170, rain);
  if (id === 'storm') add(260, rain);
  if (id === 'snow') add(140, snow);
  if (id === 'confetti') add(150, confetti);
  if (id === 'leaves') add(26, leaf);
  if (id === 'hearts') add(24, heart);
  if (id === 'sun') add(40, sparkle);

  function makeBolt() {
    const pts = [[rand(W * 0.2, W * 0.8), 0]];
    while (pts[pts.length - 1][1] < H * rand(0.5, 0.8)) {
      const [x, y] = pts[pts.length - 1];
      pts.push([x + rand(-50, 50), y + rand(30, 70)]);
    }
    return pts;
  }

  return {
    id,
    update(dt) {
      for (const p of parts) {
        if (id === 'rain' || id === 'storm') {
          p.y += p.v * dt;
          p.x += p.v * 0.18 * dt;
          if (p.y > H) Object.assign(p, rain(false));
        } else if (id === 'snow') {
          p.y += p.v * dt;
          p.s += dt;
          p.x += Math.sin(p.s) * 20 * dt;
          if (p.y > H + 10) Object.assign(p, snow(false));
        } else if (id === 'confetti') {
          p.y += p.v * dt;
          p.r += p.vr * dt;
          p.x += Math.sin(p.r) * 30 * dt;
          if (p.y > H + 20) Object.assign(p, confetti(false));
        } else if (id === 'leaves') {
          p.y += p.v * dt;
          p.r += p.vr * dt;
          p.sw += dt;
          p.x += Math.sin(p.sw) * 40 * dt;
          if (p.y > H + 40) Object.assign(p, leaf(false));
        } else if (id === 'hearts') {
          p.y -= p.v * dt;
          p.sw += dt * 2;
          p.x += Math.sin(p.sw) * 30 * dt;
          if (p.y < -50) Object.assign(p, heart(false));
        } else if (id === 'sun') {
          p.t += dt * 3;
        }
      }
      if (id === 'storm') {
        nextBolt -= dt;
        flash = Math.max(0, flash - dt * 2.5);
        if (nextBolt <= 0) {
          flash = 1;
          bolt = makeBolt();
          nextBolt = rand(2.5, 6);
        }
        if (flash < 0.4) bolt = null;
      }
    },
    draw(g) {
      if (id === 'none') return;
      g.save();
      if (id === 'rain' || id === 'storm') {
        g.strokeStyle = 'rgba(190,215,255,0.55)';
        g.lineWidth = 2;
        g.beginPath();
        for (const p of parts) {
          g.moveTo(p.x, p.y);
          g.lineTo(p.x + p.l * 0.18, p.y + p.l);
        }
        g.stroke();
        if (id === 'storm') {
          g.fillStyle = 'rgba(10,15,40,0.25)';
          g.fillRect(0, 0, W, H);
          if (flash > 0) {
            g.fillStyle = `rgba(230,240,255,${flash * 0.45})`;
            g.fillRect(0, 0, W, H);
          }
          if (bolt) {
            g.strokeStyle = `rgba(255,255,255,${flash})`;
            g.lineWidth = 5;
            g.shadowColor = '#9fd3ff';
            g.shadowBlur = 25;
            g.beginPath();
            bolt.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
            g.stroke();
          }
        }
      } else if (id === 'snow') {
        g.fillStyle = 'rgba(255,255,255,0.9)';
        for (const p of parts) {
          g.beginPath();
          g.arc(p.x, p.y, p.r, 0, TAU);
          g.fill();
        }
      } else if (id === 'confetti') {
        for (const p of parts) {
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.r);
          g.fillStyle = p.c;
          g.fillRect(-p.w / 2, -p.w / 4, p.w, (p.w / 2) * Math.abs(Math.cos(p.r * 2)) + 2);
          g.restore();
        }
      } else if (id === 'leaves' || id === 'hearts') {
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        for (const p of parts) {
          g.save();
          g.translate(p.x, p.y);
          if (p.r) g.rotate(p.r);
          g.font = `${p.s}px sans-serif`;
          g.fillText(p.e || '💖', 0, 0);
          g.restore();
        }
      } else if (id === 'sun') {
        const grad = g.createRadialGradient(W * 0.9, 0, 10, W * 0.9, 0, W * 0.7);
        grad.addColorStop(0, 'rgba(255,230,140,0.75)');
        grad.addColorStop(0.4, 'rgba(255,190,90,0.25)');
        grad.addColorStop(1, 'rgba(255,190,90,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, W, H);
        g.fillStyle = 'rgba(255,250,220,0.9)';
        for (const p of parts) {
          const s = p.s * (0.5 + 0.5 * Math.sin(p.t));
          drawSparkle(g, p.x, p.y, s);
        }
      }
      g.restore();
    },
  };
}

function drawSparkle(g, x, y, s) {
  g.beginPath();
  g.moveTo(x, y - s);
  g.quadraticCurveTo(x, y, x + s, y);
  g.quadraticCurveTo(x, y, x, y + s);
  g.quadraticCurveTo(x, y, x - s, y);
  g.quadraticCurveTo(x, y, x, y - s);
  g.fill();
}

// ---------------------------------------------------------------- backdrops
const staticCache = new Map();
function staticLayer(id, W, H, paint) {
  const key = `${id}-${W}x${H}`;
  if (!staticCache.has(key)) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    paint(c.getContext('2d'));
    staticCache.set(key, c);
  }
  return staticCache.get(key);
}

const seeded = (n) => {
  let s = n;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
};

export function drawBackdrop(g, id, t, W, H) {
  if (id === 'space') {
    g.drawImage(
      staticLayer('space', W, H, (c) => {
        const gr = c.createLinearGradient(0, 0, 0, H);
        gr.addColorStop(0, '#050314');
        gr.addColorStop(1, '#1d0b45');
        c.fillStyle = gr;
        c.fillRect(0, 0, W, H);
        const r = seeded(3);
        for (let i = 0; i < 260; i++) {
          c.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`;
          c.fillRect(r() * W, r() * H, r() * 2 + 0.5, r() * 2 + 0.5);
        }
        const neb = c.createRadialGradient(W * 0.25, H * 0.3, 10, W * 0.25, H * 0.3, W * 0.4);
        neb.addColorStop(0, 'rgba(255,46,99,0.35)');
        neb.addColorStop(1, 'rgba(255,46,99,0)');
        c.fillStyle = neb;
        c.fillRect(0, 0, W, H);
      }),
      0,
      0
    );
    // planet + ring
    const px = W * 0.82, py = H * 0.28, pr = H * 0.14;
    const pg = g.createRadialGradient(px - pr / 3, py - pr / 3, 5, px, py, pr);
    pg.addColorStop(0, '#ffb36b');
    pg.addColorStop(1, '#a8322d');
    g.fillStyle = pg;
    g.beginPath();
    g.arc(px, py, pr, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(255,220,180,0.7)';
    g.lineWidth = 6;
    g.beginPath();
    g.ellipse(px, py, pr * 1.8, pr * 0.45, -0.3, 0, TAU);
    g.stroke();
    // shooting star
    const st = (t % 5) / 5;
    if (st < 0.25) {
      const sx = W * (0.1 + st * 2.4), sy = H * (0.1 + st * 0.8);
      const sg = g.createLinearGradient(sx - 120, sy - 40, sx, sy);
      sg.addColorStop(0, 'rgba(255,255,255,0)');
      sg.addColorStop(1, 'rgba(255,255,255,0.9)');
      g.strokeStyle = sg;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(sx - 120, sy - 40);
      g.lineTo(sx, sy);
      g.stroke();
    }
  } else if (id === 'underwater') {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#1aa6c9');
    gr.addColorStop(0.5, '#0b5a86');
    gr.addColorStop(1, '#042540');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    g.save();
    g.globalAlpha = 0.12;
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 5; i++) {
      const x = W * (0.1 + i * 0.2) + Math.sin(t * 0.6 + i) * 40;
      g.beginPath();
      g.moveTo(x - 30, 0);
      g.lineTo(x + 30, 0);
      g.lineTo(x + 140, H);
      g.lineTo(x + 20, H);
      g.fill();
    }
    g.restore();
    g.fillStyle = '#c9a86a';
    g.beginPath();
    g.ellipse(W / 2, H + 40, W * 0.7, 110, 0, 0, TAU);
    g.fill();
    for (let i = 0; i < 7; i++) {
      const x = 60 + i * (W / 7);
      g.strokeStyle = i % 2 ? '#2e9d4d' : '#1f7a3a';
      g.lineWidth = 14;
      g.beginPath();
      g.moveTo(x, H);
      for (let k = 1; k <= 6; k++) g.lineTo(x + Math.sin(t * 1.5 + k + i) * 18, H - k * 40);
      g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 18; i++) {
      const y = H - ((t * 60 + i * 97) % (H + 40));
      g.beginPath();
      g.arc((i * 211) % W + Math.sin(t + i) * 10, y, 4 + (i % 4) * 2, 0, TAU);
      g.fill();
    }
    g.font = '56px sans-serif';
    g.fillText('🐠', ((t * 70) % (W + 200)) - 100, H * 0.3);
    g.fillText('🐟', W - ((t * 50 + 300) % (W + 200)), H * 0.55);
  } else if (id === 'jungle') {
    g.drawImage(
      staticLayer('jungle', W, H, (c) => {
        const gr = c.createLinearGradient(0, 0, 0, H);
        gr.addColorStop(0, '#9fe08a');
        gr.addColorStop(1, '#1d5e2a');
        c.fillStyle = gr;
        c.fillRect(0, 0, W, H);
        const r = seeded(9);
        for (let layer = 0; layer < 3; layer++) {
          c.fillStyle = ['#2f8a3c', '#1f6b2e', '#134d20'][layer];
          for (let i = 0; i < 14; i++) {
            c.save();
            c.translate(r() * W, H * (0.2 + layer * 0.3) + r() * 120);
            c.rotate(r() * TAU);
            c.beginPath();
            c.ellipse(0, 0, 140, 45, 0, 0, TAU);
            c.fill();
            c.restore();
          }
        }
      }),
      0,
      0
    );
    g.strokeStyle = '#3a6b21';
    g.lineWidth = 8;
    for (let i = 0; i < 4; i++) {
      const x = 120 + i * 330;
      g.beginPath();
      g.moveTo(x, 0);
      g.quadraticCurveTo(x + Math.sin(t + i) * 40, H * 0.25, x + Math.sin(t * 0.8 + i) * 20, H * 0.45);
      g.stroke();
    }
    g.fillStyle = 'rgba(250,255,170,0.9)';
    for (let i = 0; i < 14; i++) {
      const a = 0.5 + 0.5 * Math.sin(t * 3 + i);
      g.globalAlpha = a;
      g.beginPath();
      g.arc((i * 173 + Math.sin(t + i) * 30) % W, (i * 97) % H, 4, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  } else if (id === 'city') {
    g.drawImage(
      staticLayer('city', W, H, (c) => {
        const gr = c.createLinearGradient(0, 0, 0, H);
        gr.addColorStop(0, '#0b0930');
        gr.addColorStop(1, '#3a1660');
        c.fillStyle = gr;
        c.fillRect(0, 0, W, H);
        c.fillStyle = '#fff6d0';
        c.beginPath();
        c.arc(W * 0.15, H * 0.18, 50, 0, TAU);
        c.fill();
        const r = seeded(5);
        let x = 0;
        while (x < W) {
          const bw = 70 + r() * 110;
          const bh = H * (0.3 + r() * 0.5);
          c.fillStyle = '#120f2a';
          c.fillRect(x, H - bh, bw, bh);
          for (let wy = H - bh + 16; wy < H - 16; wy += 26) {
            for (let wx = x + 10; wx < x + bw - 14; wx += 22) {
              if (r() < 0.45) {
                c.fillStyle = r() < 0.5 ? '#ffd76a' : '#7fe7ff';
                c.fillRect(wx, wy, 10, 14);
              }
            }
          }
          x += bw + 6;
        }
      }),
      0,
      0
    );
    // blinking aircraft light
    if (Math.sin(t * 4) > 0.6) {
      g.fillStyle = '#ff2e63';
      g.beginPath();
      g.arc(W * 0.62, H * 0.22, 6, 0, TAU);
      g.fill();
    }
  } else if (id === 'stage') {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#1a0610');
    gr.addColorStop(1, '#3d0d1d');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 3; i++) {
      const cx = W * (0.25 + i * 0.25) + Math.sin(t * 0.9 + i * 2) * 120;
      const cg = g.createLinearGradient(cx, 0, cx, H);
      cg.addColorStop(0, 'rgba(255,240,200,0.55)');
      cg.addColorStop(1, 'rgba(255,240,200,0.05)');
      g.fillStyle = cg;
      g.beginPath();
      g.moveTo(cx - 20, 0);
      g.lineTo(cx + 20, 0);
      g.lineTo(cx + 220, H);
      g.lineTo(cx - 220, H);
      g.fill();
    }
    for (const side of [0, 1]) {
      for (let f = 0; f < 6; f++) {
        const x = side ? W - (f + 1) * 30 : f * 30;
        const fg = g.createLinearGradient(x, 0, x + 30, 0);
        fg.addColorStop(0, '#7a0d22');
        fg.addColorStop(0.5, '#c4173a');
        fg.addColorStop(1, '#7a0d22');
        g.fillStyle = fg;
        g.fillRect(x, 0, 30, H);
      }
    }
    g.fillStyle = '#5a1a0a';
    g.fillRect(0, H - 60, W, 60);
  } else if (id === 'haunted') {
    g.drawImage(
      staticLayer('haunted', W, H, (c) => {
        const gr = c.createLinearGradient(0, 0, 0, H);
        gr.addColorStop(0, '#1a0633');
        gr.addColorStop(1, '#4a1a5e');
        c.fillStyle = gr;
        c.fillRect(0, 0, W, H);
        c.fillStyle = '#f4f0c8';
        c.beginPath();
        c.arc(W * 0.75, H * 0.25, 90, 0, TAU);
        c.fill();
        c.fillStyle = '#0b0214';
        c.beginPath();
        c.moveTo(0, H);
        c.quadraticCurveTo(W * 0.3, H * 0.6, W * 0.6, H * 0.8);
        c.quadraticCurveTo(W * 0.85, H * 0.65, W, H * 0.75);
        c.lineTo(W, H);
        c.fill();
        // house
        const hx = W * 0.12, hy = H * 0.45;
        c.fillRect(hx, hy, 220, 260);
        c.beginPath();
        c.moveTo(hx - 20, hy);
        c.lineTo(hx + 110, hy - 120);
        c.lineTo(hx + 240, hy);
        c.fill();
        c.fillRect(hx + 150, hy - 140, 30, 80);
        c.fillStyle = '#ffd34d';
        c.fillRect(hx + 40, hy + 60, 40, 50);
        c.fillRect(hx + 140, hy + 60, 40, 50);
      }),
      0,
      0
    );
    g.fillStyle = '#0b0214';
    for (let i = 0; i < 4; i++) {
      const bx = (t * 90 * (1 + i * 0.3) + i * 300) % (W + 200) - 100;
      const by = H * (0.15 + i * 0.08) + Math.sin(t * 3 + i) * 20;
      const flap = Math.sin(t * 14 + i) * 12;
      g.beginPath();
      g.moveTo(bx, by);
      g.quadraticCurveTo(bx - 20, by - 12 - flap, bx - 40, by + 4);
      g.quadraticCurveTo(bx - 20, by + 2, bx, by + 8);
      g.quadraticCurveTo(bx + 20, by + 2, bx + 40, by + 4);
      g.quadraticCurveTo(bx + 20, by - 12 - flap, bx, by);
      g.fill();
    }
    const fog = g.createLinearGradient(0, H * 0.7, 0, H);
    fog.addColorStop(0, 'rgba(200,180,230,0)');
    fog.addColorStop(1, `rgba(200,180,230,${0.25 + 0.1 * Math.sin(t)})`);
    g.fillStyle = fog;
    g.fillRect(0, H * 0.7, W, H * 0.3);
  }
}

// ---------------------------------------------------------------- looks
export function applyLook(g, id, W, H, t) {
  if (id === 'none') return;
  g.save();
  if (id === 'neon') {
    g.globalCompositeOperation = 'overlay';
    const gr = g.createLinearGradient(0, 0, W, H);
    gr.addColorStop(0, 'rgba(255,46,140,0.75)');
    gr.addColorStop(1, 'rgba(61,225,255,0.75)');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    vignette(g, W, H, 0.5);
  } else if (id === 'retro') {
    g.globalCompositeOperation = 'color';
    g.fillStyle = 'rgba(200,120,50,0.45)';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = (t * 30) % 4; y < H; y += 4) g.fillRect(0, y, W, 1.5);
    const jitter = Math.sin(t * 40) > 0.97 ? 6 : 0;
    if (jitter) {
      g.fillStyle = 'rgba(255,255,255,0.15)';
      g.fillRect(0, (t * 300) % H, W, 12);
    }
    vignette(g, W, H, 0.45);
  } else if (id === 'bw') {
    g.globalCompositeOperation = 'saturation';
    g.fillStyle = '#808080';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = `rgba(255,255,255,${0.04 + 0.04 * Math.random()})`;
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    for (let i = 0; i < 3; i++) g.fillRect(Math.random() * W, 0, 1.5, H);
    vignette(g, W, H, 0.7);
  } else if (id === 'comic') {
    g.globalCompositeOperation = 'saturation';
    g.fillStyle = 'hsl(0,100%,50%)';
    g.globalAlpha = 0.5;
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = halftone(g);
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = '#000';
    g.lineWidth = 14;
    g.strokeRect(7, 7, W - 14, H - 14);
  } else if (id === 'spooky') {
    g.globalCompositeOperation = 'color';
    g.fillStyle = 'rgba(60,255,110,0.4)';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    vignette(g, W, H, 0.85);
  } else if (id === 'sunset') {
    g.globalCompositeOperation = 'soft-light';
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, 'rgba(255,120,60,0.9)');
    gr.addColorStop(1, 'rgba(255,46,140,0.9)');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
  }
  g.restore();
}

function vignette(g, W, H, strength) {
  g.globalCompositeOperation = 'source-over';
  const v = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, `rgba(0,0,0,${strength})`);
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
}

let dotPattern = null;
function halftone(g) {
  if (!dotPattern) {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, 8, 8);
    x.fillStyle = '#d8d8d8';
    x.beginPath();
    x.arc(4, 4, 2, 0, TAU);
    x.fill();
    dotPattern = g.createPattern(c, 'repeat');
  }
  return dotPattern;
}

// ---------------------------------------------------------------- frames
export function drawFrame(g, id, W, H, t, { channelName = '', title = '', viewers = 0 } = {}) {
  if (id === 'none') return;
  g.save();
  g.textBaseline = 'middle';
  if (id === 'news') {
    g.fillStyle = '#ff2e63';
    g.fillRect(40, H - 150, 330, 54);
    g.fillStyle = '#fff';
    g.font = '900 30px "Unbounded", sans-serif';
    g.fillText('BREAKING NEWS', 58, H - 122);
    g.fillStyle = 'rgba(10,10,16,0.88)';
    g.fillRect(40, H - 96, W - 80, 58);
    g.fillStyle = '#c6ff3d';
    g.font = '800 28px "Lexend", sans-serif';
    const ticker = `${channelName.toUpperCase()} · ${title.toUpperCase()} · LIVE FROM THE STUDIO · `;
    const tw = g.measureText(ticker).width;
    g.save();
    g.beginPath();
    g.rect(40, H - 96, W - 80, 58);
    g.clip();
    const off = -((t * 120) % tw);
    for (let x = off; x < W; x += tw) g.fillText(ticker, 60 + x, H - 66);
    g.restore();
  } else if (id === 'live') {
    g.fillStyle = '#ff2e63';
    roundRect(g, 32, 28, 138, 52, 12);
    g.fill();
    g.fillStyle = '#fff';
    g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 6);
    g.beginPath();
    g.arc(60, 54, 9, 0, TAU);
    g.fill();
    g.globalAlpha = 1;
    g.font = '900 28px "Unbounded", sans-serif';
    g.fillText('LIVE', 80, 55);
    g.fillStyle = 'rgba(10,10,16,0.7)';
    roundRect(g, W - 240, 28, 208, 52, 12);
    g.fill();
    g.fillStyle = '#fff';
    g.font = '800 26px "Lexend", sans-serif';
    g.textAlign = 'right';
    g.fillText(`👁 ${viewers.toLocaleString()}`, W - 52, 55);
  } else if (id === 'spotlight') {
    const v = g.createRadialGradient(W / 2, H * 0.45, H * 0.22, W / 2, H * 0.45, H * 0.65);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.88)');
    g.fillStyle = v;
    g.fillRect(0, 0, W, H);
  } else if (id === 'pow') {
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 4;
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * TAU;
      const r1 = Math.min(W, H) * 0.55 + Math.sin(t * 8 + i) * 20;
      g.beginPath();
      g.moveTo(W / 2 + Math.cos(a) * r1, H / 2 + Math.sin(a) * r1);
      g.lineTo(W / 2 + Math.cos(a) * W, H / 2 + Math.sin(a) * W);
      g.stroke();
    }
    const s = 1 + 0.06 * Math.sin(t * 6);
    g.translate(W - 190, 140);
    g.scale(s, s);
    g.rotate(-0.15);
    g.fillStyle = '#ffd400';
    burst(g, 0, 0, 120, 70, 14);
    g.fillStyle = '#ff2e63';
    burst(g, 0, 0, 100, 58, 14);
    g.fillStyle = '#fff';
    g.font = '900 54px "Unbounded", sans-serif';
    g.textAlign = 'center';
    g.fillText('POW!', 0, 4);
  }
  g.restore();
}

function burst(g, x, y, r1, r2, n) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * TAU;
    const r = i % 2 ? r2 : r1;
    g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
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

// ---------------------------------------------------------------- stickers
export function drawStickers(g, stickers, t) {
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const s of stickers) {
    const bob = Math.sin(t * 3 + s.id) * 4;
    g.font = `${s.size}px sans-serif`;
    g.fillText(s.emoji, s.x, s.y + bob);
  }
  g.restore();
}

export function stickerAt(stickers, x, y) {
  for (let i = stickers.length - 1; i >= 0; i--) {
    const s = stickers[i];
    if (Math.abs(s.x - x) < s.size * 0.6 && Math.abs(s.y - y) < s.size * 0.6) return s;
  }
  return null;
}
