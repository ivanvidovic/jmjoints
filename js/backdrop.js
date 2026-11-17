// Backdrop (behind everything) and snow (in front of everything).
// Dark: a neutral charcoal with a soft centre and fine grain. Light: the same in a slightly warm off-white.
// Snow: irregular clumps and broken crystals that tumble as they fall, with depth of field. Each flake has its own
// weight and momentum and is carried by the air: a slowly changing weather of calm spells, light wind and passing
// flurries, plus whatever the pointer does to it (its wake sheds swirling eddies that fling flakes about). Turning snow
// off sends a gust across the screen that carries every flake away; turning it on, a softer one brings them in.

const bg = document.getElementById('bg');
const fx = document.getElementById('fx');
const bctx = bg.getContext('2d');
const fctx = fx.getContext('2d');
// the close-up: the same flakes are handed to the 3D scene there (they keep falling here; only the drawing moves over)
const dof = { amt: 0, goal: 0 };
export function setFocus(on) { dof.goal = on ? 1 : 0; }
export const focusAmount = () => dof.amt;
// what the 3D snow needs to draw each flake exactly where, and as, this layer would
export function snowView() { return { flakes, W, H, dark: theme === 'dark' }; }
export function flakeLook(f, dark) {
  const base = dark ? [0.42, 0.5, 0.26][f.focus] + f.z * 0.25 : [0.85, 0.7, 0.45][f.focus] + f.z * 0.15;
  const sq = f.crystal ? 0.25 + 0.75 * Math.abs(Math.cos(f.tum)) : 0.7 + 0.3 * Math.abs(Math.cos(f.tum));
  return { alpha: Math.min(1, base) * (f.fade !== undefined ? Math.max(0, f.fade) : 1), sq, size: f.size * (f.zs || 1) };
}
// every flake shape in one strip (crisp), for the 3D snow; the strip is built once per theme
export function flakeAtlas(light) {
  return memo(`atlas|${light}`, () => { const c = canvas(64 * SHAPES, 64), g = c.getContext('2d'); for (let i = 0; i < SHAPES; i++) g.drawImage(flakeSprite(i, 1, light, false), i * 64, 0); return c; });
}
export const shapeCount = () => SHAPES;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
let W = 0, H = 0, dpr = 1, theme = document.documentElement.dataset.theme;
let snowOn = !reduce;
try { const s = localStorage.getItem('jm-snow'); if (s) snowOn = s === 'on'; } catch (e) {}
// how much snow the visitor wants (the slider under the snow button): 0 a light scatter .. 1 a heavy snowfall
let amt = 0.474; // the usual sky
try { const a = parseFloat(localStorage.getItem('jm-snow-amt')); if (a >= 0 && a <= 1) amt = a; } catch (e) {}
const amtMul = () => 0.25 + amt * amt * 2.6 + amt * 0.35; // 0.25x .. ~3.2x the usual sky

const rnd = (a, b) => a + Math.random() * (b - a);
const canvas = (w, h = w) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const cache = new Map();
const memo = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };

// ---------- Backdrop ----------
// Dark: a quiet, neutral charcoal with a soft pool of light in the middle and a fine paper-like grain.
// Light: the same idea in a slightly warm off-white.
let grainTile = null;
function grain() {
  if (grainTile) return grainTile;
  const n = 192, c = canvas(n), g = c.getContext('2d'), img = g.createImageData(n, n);
  for (let i = 0; i < n * n; i++) { const v = (Math.random() * 255) | 0; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0); return (grainTile = c);
}
function drawSky() {
  const g = bctx, dark = theme === 'dark', R = Math.hypot(W, H) * 0.62;
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  const grd = g.createRadialGradient(W / 2, H * 0.44, 0, W / 2, H * 0.44, R);
  if (dark) { grd.addColorStop(0, '#1d1a17'); grd.addColorStop(0.55, '#141210'); grd.addColorStop(1, '#0b0908'); }
  else { grd.addColorStop(0, '#ebe5da'); grd.addColorStop(0.6, '#e3dccf'); grd.addColorStop(1, '#d9d1c3'); }
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.globalAlpha = dark ? 0.045 : 0.03; g.globalCompositeOperation = dark ? 'screen' : 'multiply';
  g.fillStyle = g.createPattern(grain(), 'repeat'); g.fillRect(0, 0, W, H);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
}
function resize() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  for (const c of [bg, fx]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.style.width = W + 'px'; c.style.height = H + 'px'; }
  bctx.setTransform(dpr, 0, 0, dpr, 0, 0); fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawSky(); if (snowOn) seedSnow();
}
let t = 0;
export function frame(dt) { t += dt; drawSnow(dt, theme === 'dark'); stepGold(dt); }

// ---------- Snow ----------
// Sprites: irregular clumps (most real snowfall) and broken six-armed crystals, each at three focus levels.
const SHAPES = 14, CRYSTALS = 5;
function shapeSeeds() {
  return Array.from({ length: SHAPES }, (_, i) => {
    if (i < CRYSTALS) return { crystal: true, arms: Array.from({ length: 6 }, () => ({ len: Math.random() < 0.2 ? rnd(0.35, 0.6) : rnd(0.75, 1), br: [rnd(0.35, 0.5), rnd(0.6, 0.75)].map((p) => ({ p, l: rnd(0.18, 0.34) })) })) };
    const n = 4 + ((Math.random() * 6) | 0);
    return { crystal: false, blobs: Array.from({ length: n }, (_, k) => { const a = rnd(0, Math.PI * 2), d = k ? rnd(0.12, 0.42) : 0; return { x: Math.cos(a) * d, y: Math.sin(a) * d * rnd(0.6, 1), r: rnd(0.16, 0.34) * (k ? 1 : 1.25), sq: rnd(0.75, 1), rot: rnd(0, 3) }; }) };
  });
}
const seeds = shapeSeeds();
function drawShape(g, sd, R, n) {
  if (sd.crystal) {
    g.lineCap = 'round'; g.lineWidth = n * 0.035;
    sd.arms.forEach((arm, k) => {
      const a = (k / 6) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), L = R * arm.len;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(ca * L, sa * L); g.stroke();
      for (const b of arm.br) { if (b.p > arm.len) continue; const px = ca * R * b.p, py = sa * R * b.p, bl = R * b.l;
        for (const sgn of [-1, 1]) { const ba = a + sgn * 1.0; g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(ba) * bl, py + Math.sin(ba) * bl); g.stroke(); } }
    });
    g.beginPath(); g.arc(0, 0, R * 0.14, 0, Math.PI * 2); g.fill();
  } else {
    for (const b of sd.blobs) { g.beginPath(); g.ellipse(b.x * R, b.y * R, b.r * R, b.r * R * b.sq, b.rot, 0, Math.PI * 2); g.fill(); }
  }
}
// white or icy-blue flakes; on the light background each carries a faint soft shadow so it still reads as white
function flakeSprite(i, focus, light, ice) {
  return memo(`f${i}|${focus}|${light}|${ice}`, () => {
    const n = 64, c = canvas(n), g = c.getContext('2d'), sd = seeds[i], R = n * 0.36, cx = n / 2;
    const blur = [0.7, 2.6, 6][focus];
    // draw off-canvas and let the shadow land in place: a blur that works in every browser
    g.translate(cx - 1000, cx);
    if (light) {
      const sh = 'rgba(52,66,92,0.42)';
      g.shadowColor = sh; g.shadowBlur = blur + 2.2; g.shadowOffsetX = 1000 + 0.5; g.shadowOffsetY = 1.1; g.fillStyle = sh; g.strokeStyle = sh;
      drawShape(g, sd, R, n);
    }
    const col = ice ? (light ? 'rgba(214,234,255,1)' : 'rgba(226,240,255,1)') : 'rgba(255,255,255,1)';
    g.shadowColor = col; g.shadowBlur = blur; g.shadowOffsetX = 1000; g.shadowOffsetY = 0; g.fillStyle = col; g.strokeStyle = col;
    drawShape(g, sd, R, n);
    return c;
  });
}
let flakes = [];
// fewer flakes on a device that struggles (adaptive quality, app.js)
let qualityMul = 1;
export function setQuality(q) { qualityMul = [1, 0.75, 0.5][q]; }
const baseCount = () => Math.min(300, (W * H) / 5600) * qualityMul;
const targetCount = () => Math.round(baseCount() * weather.density * amtMul());
function seedSnow() { flakes = Array.from({ length: targetCount() }, () => newFlake('anywhere')); }
// a flake: depth z (0 far .. 1 by the lens), its own fall speed and how quickly the air can move it (drag)
function newFlake(where) {
  const spin = rnd(-1.4, 1.4);
  const z = Math.pow(Math.random(), 1.5);
  const near = z > 0.86, crystal = !near && z > 0.45 && Math.random() < 0.12;
  const size = near ? rnd(14, 26) : 2.2 + z * 9;
  const f = {
    x: Math.random() * W, y: -size - Math.random() * 30, z, size,
    shape: crystal ? (Math.random() * CRYSTALS) | 0 : CRYSTALS + ((Math.random() * (SHAPES - CRYSTALS)) | 0),
    focus: near ? 2 : (z < 0.12 || crystal) ? 1 : 0, crystal, ice: Math.random() < 0.4,
    fall: (14 + z * 40 + size * 0.5) * rnd(0.8, 1.2), drag: rnd(1.3, 2.4) / (0.7 + size * 0.04),
    vx: 0, vy: 0, sw: rnd(0, 6.3), sws: rnd(0.5, 1.3), swa: rnd(6, 14) * (0.5 + z),
    rot: rnd(0, 6.3), spin0: spin, spin, tum: rnd(0, 6.3), tums: rnd(0.6, 2.2),
  };
  if (where === 'anywhere') f.y = Math.random() * H;
  else if (where === 'side') { f.x = breeze.dir > 0 ? -f.size - Math.random() * 160 : W + f.size + Math.random() * 160; f.y = Math.random() * H * 0.75 - H * 0.1; }
  else if (where === 'blizz') { f.x = blizz.dir > 0 ? -f.size - Math.random() * 120 : W + f.size + Math.random() * 120; f.y = rnd(-0.1, 1) * H; }
  else if (where === 'upwind') { // a whole screen's worth waiting just upwind, ragged, so the breeze carries in a full sky at once
    const back = Math.pow(Math.random(), 0.85) * W * 0.85 + f.size + Math.random() * 40;
    f.x = breeze.dir > 0 ? -back : W + back; f.y = rnd(-0.05, 1.2) * H;
  }
  else f.y -= Math.random() * H * 0.4; // a ragged front, never a line
  f.vy = f.fall;
  return f;
}
// ---------- Weather ----------
// Smoothly varying: calm spells, a light steady wind that changes direction now and then, and passing flurries
// (stronger gusty wind, a little more snow, swirling eddies across the screen). Never strong enough to drown out the
// pointer, whose effect also grows with the wind so it always shows.
const weather = { wind: 0, windGoal: 0, gust: 0, flurry: 0, flurryGoal: 0, next: rnd(6, 12), density: 1, ambient: [], pace: 1, paceV: 0, paceGoal: 1, paceNext: rnd(8, 16) };
const vnoise = (x) => Math.sin(x) * 0.5 + Math.sin(x * 2.17 + 1.3) * 0.3 + Math.sin(x * 4.31 + 0.7) * 0.2;
function stepWeather(dt) {
  const w = weather;
  w.next -= dt;
  if (w.next <= 0) {
    if (w.flurryGoal > 0) { w.flurryGoal = 0; w.next = rnd(10, 22); w.windGoal = rnd(-18, 18); } // calm down
    else if (Math.random() < 0.55) { w.flurryGoal = rnd(0.55, 1); w.next = rnd(4, 8); w.windGoal = (Math.random() < 0.5 ? -1 : 1) * rnd(40, 85); } // a flurry
    else { w.windGoal = rnd(-35, 35); w.next = rnd(6, 14); } // the wind shifts
  }
  w.flurry += (w.flurryGoal - w.flurry) * (1 - Math.exp(-dt * 0.6));
  w.wind += (w.windGoal - w.wind) * (1 - Math.exp(-dt * 0.35));
  w.gust = vnoise(t * 0.7) * (8 + 45 * w.flurry); // gusts ride on top of the wind
  w.density = 0.85 + 0.35 * w.flurry;
  if (blizz.on) { blizz.t += dt; blizz.e = blizzEnv(blizz.t); if (blizz.t >= BLIZZ_LEN) { blizz.on = false; blizz.e = 0; } w.density *= 1 + 2.2 * blizz.e; }
  // how fast the snow comes down drifts on its own: lazy lulls, brisker spells and everything between. Each new pace
  // is reached on a soft, critically damped ease (no overshoot, starts and stops gently) that takes some 10-20 s.
  w.paceNext -= dt;
  if (w.paceNext <= 0) {
    const r = Math.random();
    w.paceGoal = r < 0.25 ? rnd(0.6, 0.8) : r < 0.7 ? rnd(0.85, 1.15) : rnd(1.25, 1.6);
    w.paceNext = rnd(14, 30);
  }
  w.paceV += ((w.paceGoal - w.pace) * 0.05 - w.paceV * 0.45) * dt; w.pace += w.paceV * dt;
  // during a flurry the air fills with slow, wide eddies that drift with the wind
  if (snowOn && w.flurry > 0.25 && Math.random() < dt * 1.4 * w.flurry && w.ambient.length < 6)
    w.ambient.push({ x: rnd(0, W), y: rnd(-H * 0.1, H * 0.9), g: (Math.random() < 0.5 ? -1 : 1) * rnd(9000, 20000), rc: rnd(110, 200), age: 0, life: rnd(2.5, 4.5) });
  for (let i = w.ambient.length - 1; i >= 0; i--) { const v = w.ambient[i]; v.age += dt; v.x += (w.wind + w.gust) * dt * 0.8; if (v.age > v.life) w.ambient.splice(i, 1); }
}
// ---------- Air ----------
// The pointer leaves a trail of vortices (alternating spin, like the wake behind a hand) and pushes the air near it.
const ptr = { x: -999, y: -999, vx: 0, vy: 0, t: 0, trail: 0, flip: 1 };
const eddies = []; // { x, y, g (circulation, px^2/s), rc (core radius), age, life }
// anything that moves through the air (the pointer, the edge of a turning page) pushes it and sheds eddies
function moveThrough(m, x, y, gain = 1) {
  const now = performance.now(), dt = Math.max(8, now - m.t) / 1000;
  if (m.t && now - m.t < 120) {
    const vx = (x - m.x) / dt, vy = (y - m.y) / dt;
    m.vx = m.vx * 0.4 + vx * 0.6 * gain; m.vy = m.vy * 0.4 + vy * 0.6 * gain;
    const sp = Math.hypot(m.vx, m.vy);
    m.trail += Math.hypot(x - m.x, y - m.y);
    if (sp > 70 && m.trail > 55) {
      m.trail = 0; m.flip = -m.flip;
      const rc = rnd(60, 110), nx = -m.vy / sp, ny = m.vx / sp, side = m.flip * rc * rnd(0.3, 0.6);
      eddies.push({ x: x + nx * side, y: y + ny * side, g: m.flip * Math.min(sp, 2400) * rc * rnd(1.6, 2.4), rc, age: 0, life: rnd(1.3, 1.9) });
      if (eddies.length > 32) eddies.shift();
    }
  }
  m.x = x; m.y = y; m.t = now;
}
addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') moveThrough(ptr, e.clientX, e.clientY); else ptr.t = 0; }, { passive: true });
// a turning page: called each frame with the screen position of its moving edge (id keeps one mover per page)
const movers = new Map();
export function stir(id, x, y, gain = 1) {
  let m = movers.get(id); if (!m) { m = { x, y, vx: 0, vy: 0, t: 0, trail: 0, flip: 1 }; movers.set(id, m); }
  moveThrough(m, x, y, gain);
}
function vortex(v, x, y, boost, out) { // a Lamb-Oseen vortex with a soft outer edge, swelling then dying away
  const dx = x - v.x, dy = y - v.y, r2 = dx * dx + dy * dy, reach = v.rc * 3.2; if (r2 > reach * reach) return;
  const a = v.age / v.life, fade = Math.min(1, a * 5) * (1 - a) * (1 - a), c2 = v.rc * v.rc;
  const edge = 1 - r2 / (reach * reach), soft = edge * edge;
  const k = boost * soft * (v.g * fade / (2 * Math.PI)) * (1 - Math.exp(-r2 / c2)) / Math.max(r2, 1);
  out[0] += -dy * k; out[1] += dx * k; out[2] += boost * soft * (v.g * fade / (Math.PI * c2)) * Math.exp(-r2 / c2);
}
function air(x, y, out) { // velocity of the air at a point (px/s), plus its spin
  out[0] = weather.wind + weather.gust * (0.6 + 0.4 * Math.sin(y * 0.004 + t * 0.9)); out[1] = 0; out[2] = 0;
  const boost = 1 + 0.8 * weather.flurry; // the hand stays visible in any weather
  for (const v of eddies) vortex(v, x, y, boost, out);
  for (const v of weather.ambient) vortex(v, x, y, 1, out);
  for (const m of [ptr, ...movers.values()]) {
    const dx = x - m.x, dy = y - m.y, d2 = dx * dx + dy * dy, R = 280;
    if (d2 < R * R) { const f = 1 - d2 / (R * R), w2 = f * f * f; out[0] += m.vx * w2 * 0.8 * boost; out[1] += m.vy * w2 * 0.8 * boost; }
  }
  if (blizz.e > 0) { // the blizzard: a hard, ragged wind across the whole sky, driving the snow down and sideways
    const turb = Math.sin(y * 0.009 + t * 3.1) * 0.35 + Math.sin(x * 0.005 - t * 2.3) * 0.25;
    out[0] += blizz.dir * 620 * blizz.e * (1 + turb); out[1] += 110 * blizz.e * (0.7 + 0.5 * Math.sin(x * 0.008 + t * 2.7));
  }
  // a gust front (toggle): once it has passed a point, a strong gusty current carries everything off that side
  if (breeze.on) {
    const passed = breeze.dir > 0 ? x < breeze.front : x > breeze.front;
    if (passed) {
      const turb = Math.sin(y * 0.012 + t * 2.6) * 0.3 + Math.sin(x * 0.006 - t * 1.9) * 0.2;
      out[0] += breeze.dir * breeze.speed * breeze.k * (1 + turb);
      out[1] += breeze.speed * breeze.k * (Math.sin(x * 0.01 + t * 3.3) * 0.25 - 0.2);
    }
  }
}
const A3 = [0, 0, 0];
// the toggle's breeze: a front that crosses the screen; it keeps blowing until there is nothing left to carry
const breeze = { on: false, front: 0, dir: 1, speed: 0, k: 0, t: 0, until: 0 };
function gust(dir, speed, minDur) { Object.assign(breeze, { on: true, dir, speed, front: dir > 0 ? -200 : W + 200, k: 0, t: 0, until: minDur }); }
function stepBreeze(dt) {
  if (!breeze.on) return;
  breeze.t += dt; breeze.front += breeze.dir * dt * Math.max(900, W * 0.9);
  const done = snowOn ? breeze.t > breeze.until : !flakes.length && breeze.t > 0.6;
  breeze.k = done ? Math.max(0, breeze.k - dt * 1.5) : Math.min(1, breeze.k + dt * 3);
  if (done && breeze.k <= 0) breeze.on = false;
}

function drawSnow(dt, dark) {
  const g = fctx;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  dof.amt += (dof.goal - dof.amt) * (1 - Math.exp(-dt * 6)); if (Math.abs(dof.goal - dof.amt) < 0.003) dof.amt = dof.goal; // about half a second
  stepSkyFade(dt); stepWeather(dt); stepBreeze(dt);
  for (let i = eddies.length - 1; i >= 0; i--) { eddies[i].age += dt; if (eddies[i].age >= eddies[i].life) eddies.splice(i, 1); }
  ptr.vx *= Math.exp(-dt * 7); ptr.vy *= Math.exp(-dt * 7);
  for (const [id, m] of movers) { m.vx *= Math.exp(-dt * 7); m.vy *= Math.exp(-dt * 7); if (performance.now() - m.t > 1500) movers.delete(id); }
  // keep the air topped up while snow is on: new flakes drift in from above (or on the breeze), never pop in
  if (snowOn) {
    const need = targetCount() - flakes.length;
    if (need > 0 && blizz.e > 0.05) for (let k = 0; k < Math.min(need, Math.ceil(baseCount() * dt * 4)); k++) flakes.push(newFlake('blizz')); // pouring in on the blizzard
    else if (need > 0) for (let k = 0; k < Math.min(need, Math.ceil(baseCount() * dt * 0.45 * rnd(0.3, 1.7))); k++) flakes.push(newFlake(breeze.on && Math.random() < 0.55 ? 'side' : 'top'));
  }
  if (!flakes.length) return;
  const keep = [];
  let excess = flakes.length - targetCount(); // above the wanted amount: flakes that fall out are not sent round again
  for (const f of flakes) {
    // each flake has momentum: the air pulls it along (lighter ones more), and it keeps going a while after a gust
    air(f.x, f.y, A3);
    const carry = 1.3 - f.z * 0.55, k = 1 - Math.exp(-dt * f.drag);
    f.sw += dt * f.sws;
    const tx = A3[0] * carry + Math.sin(f.sw) * f.swa, ty = A3[1] * carry + f.fall * Math.pow(weather.pace, 0.7 + 0.6 * f.z) * (1 + 0.15 * Math.sin(f.sw * 0.7)); // nearer flakes feel the pace a little more
    f.vx += (tx - f.vx) * k; f.vy += (ty - f.vy) * k;
    f.spin += (A3[2] * 0.5 + f.spin0 - f.spin) * Math.min(1, dt * 2.5); // eddies set flakes spinning
    f.rot += dt * f.spin; f.tum += dt * (f.tums + Math.abs(A3[2]) * 0.35 + Math.hypot(f.vx, f.vy - f.fall) * 0.006);
    f.x += f.vx * dt; f.y += f.vy * dt;
    if (f.y > H + f.size + 10) { if (snowOn && !breeze.on && excess-- <= 0) keep.push(Object.assign(newFlake('top'), { x: Math.random() * W })); continue; }
    if (f.fade !== undefined) { f.fade -= dt * 2.2; if (f.fade <= 0) continue; } // a flake that came too close to the lens
    if (f.y < -H) f.y = -H;
    // off a side: blown away if the snow is off; otherwise round again (unless still on its way in)
    if ((f.x < -80 && f.vx < 0) || (f.x > W + 80 && f.vx > 0)) { if (!snowOn) continue; f.x = f.x < 0 ? f.x + W + 160 : f.x - W - 160; }
    keep.push(f);
    const base = dark ? [0.42, 0.5, 0.26][f.focus] + f.z * 0.25 : [0.85, 0.7, 0.45][f.focus] + f.z * 0.15;
    const sq = f.crystal ? 0.25 + 0.75 * Math.abs(Math.cos(f.tum)) : 0.7 + 0.3 * Math.abs(Math.cos(f.tum)); // tumbling flakes turn edge-on
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.translate(f.x, f.y); g.rotate(f.rot); g.scale(1, sq);
    g.globalAlpha = Math.min(1, base) * (f.fade !== undefined ? Math.max(0, f.fade) : 1) * (f.grow !== undefined ? (f.grow = Math.min(1, f.grow + dt * 2.5)) : 1);
    if (f.zs !== undefined) { f.zs += (1 - f.zs) * (1 - Math.exp(-dt * 3)); if (Math.abs(f.zs - 1) < 0.002) f.zs = undefined; }
    const sz = f.size * (f.zs || 1);
    if (dof.amt > 0.999) continue; // drawn by the close-up's 3D snow, with a real lens blur (gallery.js)
    g.globalAlpha *= 1 - dof.amt;
    if (skyFade) { // the flakes change colour with the light too
      const e = skyFade.t * skyFade.t * (3 - 2 * skyFade.t), a = g.globalAlpha;
      g.globalAlpha = a * (1 - e); g.drawImage(flakeSprite(f.shape, f.focus, !skyFade.oldDark, f.ice), -sz, -sz, sz * 2, sz * 2); g.globalAlpha = a * e;
    }
    g.drawImage(flakeSprite(f.shape, f.focus, !dark, f.ice), -sz, -sz, sz * 2, sz * 2);
    g.globalAlpha = 1;
  }
  flakes = keep;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.globalAlpha = 1;
}

// fade: cross-fade the sky and the snow from the old theme to the new one over 0.8 s
let skyFade = null;
export function setTheme(tm, fade = false) {
  if (fade && W) { const old = canvas(bg.width, bg.height); old.getContext('2d').drawImage(bg, 0, 0); skyFade = { old, oldDark: theme === 'dark', t: 0 }; }
  theme = tm; drawSky(); stepSkyFade(0); // the old sky goes straight back over the new one, so no frame shows the new sky alone
}
function stepSkyFade(dt) {
  if (!skyFade) return;
  skyFade.t = Math.min(1, skyFade.t + dt / 0.8); const k = skyFade.t, e = k * k * (3 - 2 * k);
  drawSky(); bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.globalAlpha = 1 - e; bctx.drawImage(skyFade.old, 0, 0); bctx.globalAlpha = 1; bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (k >= 1) { skyFade = null; drawSky(); }
}
export function amount() { return amt; }
// a new amount only changes what keeps coming in: nothing on screen disappears, extra flakes arrive from off screen
export function setAmount(v) { amt = Math.max(0, Math.min(1, v)); try { localStorage.setItem('jm-snow-amt', amt.toFixed(3)); } catch (e) {} }
// a few flakes lift off the edges of a hovered card and drift out into the weather
export function puff(r, n = 7) {
  if (reduce) return;
  for (let i = 0; i < n; i++) {
    const f = newFlake('anywhere'), side = (Math.random() * 4) | 0, u = Math.random();
    f.z = 0.35 + Math.random() * 0.4; f.size = 2.2 + f.z * 9; f.focus = f.crystal ? 1 : 0; // the same flakes as the falling snow
    f.x = r.left + (side === 1 ? r.width : side === 3 ? 0 : u * r.width); f.y = r.top + (side === 2 ? r.height : side === 0 ? 0 : u * r.height);
    const ang = Math.atan2(f.y - (r.top + r.height / 2), f.x - (r.left + r.width / 2)) + rnd(-0.5, 0.5), sp = rnd(70, 150);
    f.vx = Math.cos(ang) * sp; f.vy = Math.sin(ang) * sp - rnd(50, 110); f.drag = rnd(1.6, 2.6); f.grow = 0;
    flakes.push(f);
  }
}
// the camera moved: the snow is in the same space, so it moves too. zoom > 1 = moving in (flakes spread out from the
// focus point and grow, nearer ones more), pan = how far the scene slid on screen (nearer flakes slide more)
export function camMotion(px, py, zoom, fx0, fy0, k = 1) {
  if (!flakes.length || reduce) return;
  zoom = Math.max(0.8, Math.min(1.25, zoom));
  if (Math.abs(zoom - 1) < 1e-4 && Math.abs(px) + Math.abs(py) < 0.01) return;
  let lost = 0;
  for (const f of flakes) {
    const w = (0.3 + 0.9 * f.z) * k, zf = 1 + (zoom - 1) * w, wasIn = f.x > -20 && f.x < W + 20 && f.y > -20 && f.y < H + 20;
    f.x = fx0 + (f.x - fx0) * zf + px * w * 0.7; f.y = fy0 + (f.y - fy0) * zf + py * w * 0.7;
    // a flake's own size never changes (that is what keeps every flake looking as it should); moving in only swells it
    // a little for a moment, and it eases straight back
    f.zs = Math.max(0.85, Math.min(1.18, (f.zs || 1) * (1 + (zf - 1) * 0.35)));
    if (wasIn && (f.x < -40 || f.x > W + 40 || f.y < -40 || f.y > H + 40)) { f.gone = true; lost++; }
  }
  if (lost) flakes = flakes.filter((f) => !f.gone);
  // fill what opened up: the middle when moving in, the edges when moving out
  if (!snowOn) return;
  for (let i = 0; i < lost; i++) {
    const f = newFlake('anywhere'); f.grow = 0;
    if (zoom >= 1) { const s = 1 / zoom; f.x = fx0 + (Math.random() - 0.5) * W * s * 1.1; f.y = fy0 + (Math.random() - 0.5) * H * s * 1.1; }
    else { const a = Math.random() * Math.PI * 2; f.x = fx0 + Math.cos(a) * W * 0.55; f.y = fy0 + Math.sin(a) * H * 0.55; }
    flakes.push(f);
  }
}
export function snow() { return snowOn; }
// off: a gust sweeps across and carries every flake away; on: a softer breeze brings new snow in, unevenly
export function setSnow(v) {
  if (v !== snowOn) {
    const dir = Math.random() < 0.5 ? -1 : 1;
    if (v) { // in at the same brisk pace the off-gust clears it: a breeze sweeps a full sky across, then eases off
      gust(dir, Math.max(760, W * 0.72), 1.15);
      const n = targetCount() - flakes.length;
      for (let k = 0; k < n; k++) { const f = newFlake('upwind'); f.vx = dir * Math.max(760, W * 0.72) * 0.6; flakes.push(f); }
    } else gust(dir, 1100, 0);
  }
  snowOn = v; try { localStorage.setItem('jm-snow', v ? 'on' : 'off'); } catch (e) {}
}
addEventListener('resize', resize);
resize();

// ---------- A golden snowflake ----------
// Every minute or two, while it's snowing (and not during a game or a close-up), one shimmering golden crystal drifts
// down, slower than the rest. Catch it (click or tap it) and it bursts into a little shower of sparkles with a chime.
let gold = null, goldNext = rnd(50, 100), goldOk = true;
const sparks = [];
export function allowGold(on) { goldOk = on; }
function goldSprite() {
  return memo('gold', () => {
    const c = canvas(64, 64), g = c.getContext('2d');
    g.drawImage(flakeSprite(1, 1, false, false), 0, 0);
    g.globalCompositeOperation = 'source-in';
    const gr = g.createLinearGradient(8, 8, 56, 56); gr.addColorStop(0, '#fff3c4'); gr.addColorStop(0.5, '#f2c35b'); gr.addColorStop(1, '#d99a2b');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return c;
  });
}
function stepGold(dt) {
  const g = fctx;
  if (!gold && snowOn && goldOk && !reduce && dof.goal === 0 && (goldNext -= dt) <= 0) {
    gold = { x: rnd(W * 0.15, W * 0.85), y: -30, vx: 0, vy: 0, size: 18, rot: rnd(0, 6.3), sw: 0, a: 0 };
  }
  if (gold) {
    const f = gold; air(f.x, f.y, A3);
    f.sw += dt * 0.9;
    f.vx += (A3[0] * 0.7 + Math.sin(f.sw) * 22 - f.vx) * (1 - Math.exp(-dt * 1.5)); f.vy += (26 - f.vy) * (1 - Math.exp(-dt * 1.5));
    f.x += f.vx * dt; f.y += f.vy * dt; f.rot += dt * 0.5; f.a = Math.min(1, f.a + dt * 1.5);
    if (f.y > H + 40 || !snowOn || dof.goal) { f.a -= dt * 3; if (f.y > H + 40 || f.a <= 0) { gold = null; goldNext = rnd(60, 120); } }
    if (gold) {
      const tw = 0.75 + 0.25 * Math.sin(t * 5.3) * Math.sin(t * 3.1); // it glints
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.globalAlpha = Math.max(0, f.a) * 0.75 * tw;
      const halo = g.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.size * 2.4); halo.addColorStop(0, 'rgba(255,214,120,0.9)'); halo.addColorStop(1, 'rgba(255,200,90,0)');
      g.fillStyle = halo; g.beginPath(); g.arc(f.x, f.y, f.size * 2.4, 0, 6.2832); g.fill();
      g.globalAlpha = Math.max(0, f.a); g.translate(f.x, f.y); g.rotate(f.rot);
      g.drawImage(goldSprite(), -f.size, -f.size, f.size * 2, f.size * 2);
    }
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const p = sparks[i]; p.age += dt; if (p.age > p.life) { sparks.splice(i, 1); continue; }
    p.vy += 160 * dt; p.vx *= Math.exp(-dt * 1.5); p.x += p.vx * dt; p.y += p.vy * dt;
    const k = 1 - p.age / p.life;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.globalAlpha = k * (0.6 + 0.4 * Math.sin(p.age * 30 + p.ph));
    g.fillStyle = p.c; g.beginPath(); g.arc(p.x, p.y, p.r * (0.5 + k * 0.5), 0, 6.2832); g.fill();
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.globalAlpha = 1;
}
// a tap or click at (x, y): if it's on the golden flake, it's caught (returns true)
export function catchGold(x, y, reach = 30) {
  if (!gold || gold.a < 0.3 || Math.hypot(x - gold.x, y - gold.y) > reach) return false;
  for (let i = 0; i < 34; i++) {
    const a = rnd(0, 6.2832), sp = rnd(60, 260);
    sparks.push({ x: gold.x, y: gold.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, age: 0, life: rnd(0.7, 1.4), r: rnd(1.2, 3), ph: rnd(0, 6), c: ['#fff3c4', '#f2c35b', '#ffe08a', '#ffffff'][i % 4] });
  }
  gold = null; goldNext = rnd(70, 140);
  return true;
}

// ---------- A snowstorm, on request (the logo easter egg) ----------
// the snow thickens for a few seconds on a strong gust, then settles back to what it was
// A blizzard that blows straight through, in step with its sound (snowstorm_swell, 6.6 s): it hits at once, at about
// half strength, swells to full as the sound peaks (~3 s), holds, then dies away with it. The sky fills in the same
// moment (flakes appear everywhere, already moving), a hard wind drives across from one side, picked at random, and
// new snow keeps pouring in from that side while it lasts.
const BLIZZ_LEN = 6.6, blizz = { on: false, t: 0, dir: 1, e: 0 };
const ss = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const blizzEnv = (t) => t < 0.15 ? 0.55 * t / 0.15 : t < 3 ? 0.55 + 0.45 * ss((t - 0.15) / 2.85) : t < 3.9 ? 1 : 1 - ss((t - 3.9) / (BLIZZ_LEN - 3.9));
export function snowstorm() {
  if (reduce) return;
  const dir = Math.random() < 0.5 ? -1 : 1;
  if (!snowOn) { setSnow(true); breeze.dir = dir; }
  Object.assign(blizz, { on: true, t: 0, dir, e: 0 });
  weather.flurry = weather.flurryGoal = 1; weather.wind = weather.windGoal = dir * 110; weather.next = BLIZZ_LEN;
  const extra = Math.round(baseCount() * amtMul() * 1.2);
  for (let k = 0; k < extra; k++) { const f = newFlake('anywhere'); f.grow = 0; f.vx = dir * rnd(200, 420); flakes.push(f); }
}
