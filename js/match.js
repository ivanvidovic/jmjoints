// Memory Match: tiles dealt face-down on the table; flip two, keep the pairs.
// Easy 6 pairs, Medium 12, Full 24. Hold a face-up tile to admire it in the close-up view.
import * as THREE from 'three';
import { envFor, tex, STOCK, paperMaterial, edgeMaterial, cardGeometry, clamp, lerp, renderer, isTouch, clearFlights, qBackUpright, qFaceUp, yawQ } from './core.js';
import { confirmTap } from './ui.js';
import * as sound from './sound.js';
import * as gallery from './gallery.js';

const A = 'assets/';
const S = STOCK.memory;
const HALF = [S.w / 2 - 0.1, S.h / 2 - 0.1, S.t / 2]; // a tile as a box (corners rounded off)
export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 5, 600);
let env = envFor(document.documentElement.dataset.theme);
scene.environment = env;
const hemi = new THREE.HemisphereLight(0xfff4e6, 0x1a1a2a, 0.4); scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff5ec, 2.1);
key.position.set(-25, 80, 35); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 10, far: 200 });
key.shadow.radius = 5; key.shadow.bias = -0.0002; key.shadow.normalBias = 0.01;
scene.add(key);
function vignette() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const r = g.createRadialGradient(128, 128, 30, 128, 128, 128); r.addColorStop(0, '#fff'); r.addColorStop(0.22, '#c8c8c8'); r.addColorStop(0.5, '#3a3a3a'); r.addColorStop(1, '#000');
  g.fillStyle = r; g.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c);
}
const tableMat = new THREE.MeshStandardMaterial({ color: 0x0e0e0d, roughness: 0.95, transparent: true, alphaMap: vignette(), envMapIntensity: 0.25 });
const table = new THREE.Mesh(new THREE.CircleGeometry(90, 96), tableMat); table.rotation.x = -Math.PI / 2; table.receiveShadow = true; scene.add(table);
const catcher = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.ShadowMaterial({ color: 0x5a4632, opacity: 0.22 }));
catcher.rotation.x = -Math.PI / 2; catcher.position.y = 0.0005; catcher.receiveShadow = true; scene.add(catcher);

const LEVELS = { easy: { pairs: 6, cols: 4, rows: 3 }, medium: { pairs: 12, cols: 6, rows: 4 }, full: { pairs: 24, cols: 8, rows: 6 } };
let manifest, built = false, level = 'medium';
try { level = localStorage.getItem('jm-mm-level') || 'medium'; } catch (e) {}
let fronts = [], backMat, edgeMat;
let tiles = [], leaving = [], open = [], game = null;
const GAP = 0.9;
const X = new THREE.Vector3(0, 0, 1); // flip left-to-right about the art's vertical axis, so both sides stay upright

export async function prepare(man) {
  if (built) return; built = true; manifest = man;
  backMat = paperMaterial(S, tex(`${A}mm/thumb/back.webp`), env); edgeMat = edgeMaterial(S, env);
  fronts = man.memory.map((c) => paperMaterial(S, tex(`${A}mm/full/${c.id}.webp`), env));
  buildHud();
}

// ---------- HUD ----------
const hud = {};
function buildHud() {
  const root = document.getElementById('view-match');
  root.querySelectorAll('.lvl button').forEach((b) => b.addEventListener('click', () => { sound.unlock(); setLevel(b.dataset.level); }));
  confirmTap(root.querySelector('#mm-new'), () => game && game.moves > 0 && !game.won, () => { sound.unlock(); newGame(); });
  root.querySelector('#mm-again').addEventListener('click', () => { sound.unlock(); newGame(); });
  Object.assign(hud, { pairs: root.querySelector('#mm-pairs'), moves: root.querySelector('#mm-moves'), time: root.querySelector('#mm-time'), best: root.querySelector('#mm-best'), win: root.querySelector('#mm-win'), winText: root.querySelector('#mm-win-text') });
  syncLevel();
}
function syncLevel() { document.querySelectorAll('#view-match .lvl button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.level === level))); }
function setLevel(l) { if (l === level && game) return; level = l; try { localStorage.setItem('jm-mm-level', l); } catch (e) {} syncLevel(); newGame(); }
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function bestOf(l) { try { return JSON.parse(localStorage.getItem('jm-mm-best-' + l) || 'null'); } catch (e) { return null; } }
function renderHud() {
  if (!game) return;
  hud.pairs.textContent = `${game.found} / ${game.pairs}`;
  hud.moves.textContent = game.moves;
  const el = game.start ? ((game.end || performance.now()) - game.start) / 1000 : 0;
  hud.time.textContent = fmt(el);
  const b = bestOf(level); hud.best.textContent = b ? `${b.moves} moves · ${fmt(b.time)}` : '—';
}

// ---------- Layout ----------
let portrait = false;
function dims() {
  const L = LEVELS[level]; portrait = innerWidth / innerHeight < 1;
  return portrait ? { cols: L.rows, rows: L.cols } : { cols: L.cols, rows: L.rows };
}
function slot(i) {
  const { cols, rows } = dims(); const c = i % cols, r = Math.floor(i / cols), step = S.w + GAP;
  return new THREE.Vector3((c - (cols - 1) / 2) * step, S.t / 2 + 0.003, (r - (rows - 1) / 2) * step - 1);
}
function pileSpot(k) {
  const { cols, rows } = dims(); const step = S.w + GAP;
  const p = portrait ? new THREE.Vector3(0, 0, ((rows - 1) / 2) * step + step * 1.15 - 1) : new THREE.Vector3(((cols - 1) / 2) * step + step * 1.35, 0, 0);
  p.y = S.t / 2 + 0.003 + k * (S.t + 0.004); p.x += Math.sin(k * 2.1) * 0.25; p.z += Math.cos(k * 1.3) * 0.25;
  return p;
}
function frameCamera() {
  const { cols, rows } = dims(); const step = S.w + GAP;
  // the grid sits dead centre on screen; on wide screens the matched pile beside it is kept in frame by leaving the
  // same margin on both sides
  const w = cols * step + (portrait ? 2 : step * 3.2), h = rows * step + (portrait ? step * 2.4 : 4);
  const vf = THREE.MathUtils.degToRad(camera.fov), aspect = innerWidth / innerHeight;
  const availH = portrait ? 0.7 : 0.74; // leave room for the bar and the hud
  const dist = Math.max((h / 2) / Math.tan(vf / 2) / availH, (w / 2) / (Math.tan(vf / 2) * aspect) / 0.92) * 1.02;
  const elev = THREE.MathUtils.degToRad(76);
  camTarget.set(0, 0, portrait ? step * 0.55 : -1);
  camGoal.set(camTarget.x, Math.sin(elev) * dist, camTarget.z + Math.cos(elev) * dist);
}
const camTarget = new THREE.Vector3(), camGoal = new THREE.Vector3(), camPos = new THREE.Vector3(0, 120, 60), camLook = new THREE.Vector3();

// ---------- Game ----------
function newGame() {
  if (!built) return;
  const L = LEVELS[level];
  // gather old tiles back off the table first, then deal a fresh shuffled set
  const old = tiles; tiles = []; open = [];
  // the old tiles are swept up: each flips face-down, gathers into one stack, and the stack slides away
  const gather = new THREE.Vector3(0, 0, portrait ? 30 : 22);
  const n = old.length;
  old.forEach((t, k) => {
    t.matched = false; t.leaving = true; leaving.push(t);
    const q = yawQ(0).multiply(qBackUpright);
    const stackPos = gather.clone(); stackPos.y = S.t / 2 + 0.003 + k * (S.t + 0.004);
    tweenTile(t, { pos: stackPos, q, dur: 0.5, delay: k * 0.018, lift: 3 + (k % 5) * 0.3, done: () => {
      if (k === n - 1) leaving.forEach((x) => tweenTile(x, { pos: x.mesh.position.clone().add(new THREE.Vector3(0, 0, 40)), q: x.mesh.quaternion.clone(), dur: 0.45, lift: 0.5, done: () => { scene.remove(x.mesh); leaving = leaving.filter((y) => y !== x); } }));
    } });
  });
  if (n) sound.play('shove', { vol: 0.4 });
  const dealDelay = n ? 0.55 + n * 0.018 + 0.5 : 0.25; // only once the old stack has slid away
  const ids = shuffle(manifest.memory.map((_, i) => i)).slice(0, L.pairs);
  const deck = shuffle([...ids, ...ids]);
  game = { pairs: L.pairs, found: 0, moves: 0, start: 0, end: 0, lock: 0, won: false };
  hud.win.classList.remove('on');
  frameCamera();
  deck.forEach((id, i) => {
    const mesh = new THREE.Mesh(cardGeometry(S), [fronts[id], backMat, edgeMat]);
    mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
    const yaw = (Math.random() - 0.5) * 0.05;
    const t = { mesh, id, i, up: false, matched: false, yaw, home: slot(i), anim: null };
    mesh.position.set(-70, S.t / 2 + (deck.length - i) * (S.t + 0.004), portrait ? 30 : 22); mesh.quaternion.copy(yawQ(yaw)).multiply(qBackUpright); mesh.visible = true; // the new set waits off to the side
    tiles.push(t);
    tweenTile(t, { pos: t.home, q: mesh.quaternion.clone(), dur: 0.62, delay: dealDelay + i * 0.03, lift: 4, done: () => { if (i % 3 === 0) sound.play('chipLay', { vol: 0.25, rate: 0.95, gap: 30 }); } });
  });
  sound.play('shuffle', { vol: 0.55, delay: dealDelay * 1000 - 100, dur: (0.62 + deck.length * 0.03) * 1000 }); // as long as the deal
  renderHud();
}
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

// tween a tile to a pose along an arc; flips are done by giving a target quaternion
let flightNo = 0;
function tweenTile(t, { pos, q, dur, delay = 0, lift = 2, axisFlip = null, done }) {
  t.order = ++flightNo;
  t.anim = { from: t.mesh.position.clone(), fromQ: t.mesh.quaternion.clone(), to: pos.clone(), toQ: q.clone(), dur, t: -delay, lift, axisFlip, done };
}
function flip(t, up) {
  if (away) return; // already swept off the table
  t.up = up;
  const start = t.mesh.quaternion.clone();
  const sign = up ? 1 : -1;
  const target = new THREE.Quaternion().setFromAxisAngle(X, sign * Math.PI).multiply(start); // exact half turn: no end pop
  t.yaw = -t.yaw;
  // turn top-over-bottom about the table's left-right axis (keeps the art upright when it lands)
  tweenTile(t, { pos: t.home, q: target, dur: 0.46, lift: 2.4, axisFlip: { start, sign } });
  sound.play('slide', { vol: 0.32, rate: up ? 1.2 : 1.05, gap: 20 });
}
function choose(t) {
  if (!game || game.won || t.up || t.matched || t.anim || open.length >= 2) return;
  if (!game.start) game.start = performance.now();
  flip(t, true); open.push(t);
  if (open.length === 2) {
    game.moves++;
    const [a, b] = open;
    setTimeout(() => {
      if (a.id === b.id) {
        a.matched = b.matched = true; game.found++;
        // the pair does a little happy hop together, then lifts and is set on the pile
        [a, b].forEach((x, k) => {
          const p = pileSpot((game.found - 1) * 2 + k);
          const q = yawQ((Math.random() - 0.5) * 0.4).multiply(qFaceUp);
          tweenTile(x, { pos: x.home, q: x.mesh.quaternion, dur: 0.34, delay: k * 0.05, lift: 1.6, done: () => {
            tweenTile(x, { pos: p, q, dur: 0.7, delay: 0.08 + k * 0.1, lift: 5, done: () => { x.home = p; x.yaw = 0; sound.play('chipLay', { vol: 0.4, rate: 0.92 }); } });
          } });
        });
        sound.chime([0, 7], { vol: 0.14, gap: 0.07, base: 1318.5 });
        sound.play('fan', { vol: 0.35, delay: 380 });
        open = [];
        if (game.found === game.pairs) win();
      } else {
        setTimeout(() => { flip(a, false); flip(b, false); open = []; }, 780);
      }
      renderHud();
    }, 480);
  }
  renderHud();
}
function win() {
  game.won = true; game.end = performance.now();
  const time = (game.end - game.start) / 1000;
  const prev = bestOf(level);
  const better = !prev || game.moves < prev.moves || (game.moves === prev.moves && time < prev.time);
  if (better) try { localStorage.setItem('jm-mm-best-' + level, JSON.stringify({ moves: game.moves, time })); } catch (e) {}
  // once the last pair is on its pile, every tile turns a full somersault, one after another, in a wave across the
  // piles; then the result. A tap skips straight to it.
  const g = game, wave = tiles.slice().sort((p, q) => p.home.x - q.home.x || p.home.z - q.home.z), lead = 1.35;
  setTimeout(() => {
    if (game !== g) return;
    sound.chime([0, 4, 7, 12], { vol: 0.22, gap: 0.11 });
    wave.forEach((t, i) => { const start = t.mesh.quaternion.clone(); tweenTile(t, { pos: t.home, q: start, dur: 0.75, delay: i * 0.03, lift: 2.6, axisFlip: { start, sign: 2 }, done: i % 6 ? null : () => sound.play('slide', { vol: 0.12, rate: 1.3, gap: 20 }) }); });
  }, lead * 1000);
  const show = () => {
    if (game !== g || hud.win.classList.contains('on')) return;
    hud.winText.textContent = `All ${game.pairs} pairs in ${game.moves} moves · ${fmt(time)}${better && prev ? ' · New best' : ''}`;
    hud.win.classList.add('on'); sound.play('shuffle', { vol: 0.5, dur: 1100 });
    renderHud();
  };
  celebrating = show;
  setTimeout(show, (lead + 0.8 + wave.length * 0.03) * 1000);
}
let celebrating = null; // a tap during the win wave skips to the result
addEventListener('pointerdown', () => { if (active && celebrating) { const s = celebrating; celebrating = null; s(); } }, true);

// ---------- Input: tap to flip, hold a face-up tile to admire it ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let active = false, press = null;
function pick(e) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(tiles.map((t) => t.mesh), false)[0];
  return hit ? tiles.find((t) => t.mesh === hit.object) : null;
}
const cv = renderer.domElement;
cv.addEventListener('pointerdown', (e) => {
  if (!active || gallery.isOpen()) return;
  sound.unlock();
  const t = pick(e); if (!t) return;
  press = { t, x: e.clientX, y: e.clientY, timer: setTimeout(() => { if (press && press.t === t && t.up && !t.anim) { press.held = true; admire(t); } }, 430) };
});
cv.addEventListener('pointermove', (e) => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) { clearTimeout(press.timer); press = null; } if (!press && e.pointerType === 'mouse' && active) hoverAt(e); });
cv.addEventListener('pointerup', () => { if (!press) return; clearTimeout(press.timer); const p = press; press = null; if (!p.held) choose(p.t); });
let hovered = null;
function hoverAt(e) { const t = pick(e); hovered = t && !t.up && !t.matched && !t.anim ? t : null; cv.style.cursor = t ? 'pointer' : ''; }
// keys: the arrows move to the nearest face-down tile in that direction (it rises), Enter or Space turns it
addEventListener('keydown', (e) => {
  if (!active || !game || game.won || e.target.closest('button, input, a')) return;
  const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key];
  const free = tiles.filter((t) => !t.up && !t.matched);
  if (dir) {
    e.preventDefault();
    if (!hovered || !free.includes(hovered)) { hovered = free.sort((a, b) => a.home.z - b.home.z || a.home.x - b.home.x)[0] || null; return; }
    let best = null, bd = 1e9;
    for (const t of free) {
      const dx = t.home.x - hovered.home.x, dz = t.home.z - hovered.home.z, along = dx * dir[0] + dz * dir[1];
      if (along < 0.5) continue;
      const d = along + Math.abs(dx * dir[1] + dz * dir[0]) * 2.5; // straight ahead first
      if (d < bd) { bd = d; best = t; }
    }
    if (best) { hovered = best; sound.tick(0.3); }
  } else if ((e.key === 'Enter' || e.key === ' ') && hovered) { e.preventDefault(); const t = hovered; hovered = null; choose(t); }
});
function admire(t) {
  const proxy = {
    getBoundingClientRect() {
      const b = new THREE.Box3().setFromObject(t.mesh); const pts = [b.min, b.max].map((p) => p.clone().project(camera));
      const xs = pts.map((p) => (p.x * 0.5 + 0.5) * innerWidth), ys = pts.map((p) => (-p.y * 0.5 + 0.5) * innerHeight);
      const w = Math.abs(xs[1] - xs[0]), h = Math.abs(ys[1] - ys[0]), s = Math.min(w, h);
      return { left: (xs[0] + xs[1]) / 2 - s / 2, top: (ys[0] + ys[1]) / 2 - s / 2, width: s, height: s };
    },
    classList: { add: () => { t.mesh.visible = false; }, remove: () => { t.mesh.visible = true; } },
  };
  gallery.openExternal('memory', t.id, proxy);
}

// ---------- View ----------
let away = false;
export function enter() {
  active = true; if (!game) { newGame(); return; } frameCamera();
  if (away) { // the tiles come back in from the left, just as they left
    away = false;
    [...tiles].sort((p, q) => p.home.x - q.home.x).reverse().forEach((t, k) => tweenTile(t, { pos: t.home, q: t.mesh.quaternion.clone(), dur: 0.55, delay: k * 0.008, lift: 0.8 }));
  }
}
// leaving for home: every tile slides quickly off to the left (leftmost first), so the table empties in one move
export function slideAway() {
  active = false; cv.style.cursor = ''; away = true; open = [];
  leaving.forEach((x) => scene.remove(x.mesh)); leaving = [];
  [...tiles].sort((p, q) => p.mesh.position.x - q.mesh.position.x).forEach((t, k) => { const q = t.up && !t.matched ? yawQ(t.yaw).multiply(qBackUpright) : t.mesh.quaternion.clone(); if (!t.matched) t.up = false; tweenTile(t, { pos: t.mesh.position.clone().add(new THREE.Vector3(-120, 0, 0)).setY(t.home.y), q, dur: 0.5, delay: k * 0.006, lift: 0.8 }); });
}
export function leave() { active = false; cv.style.cursor = ''; }
export function resize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); if (built && game) { frameCamera(); tiles.forEach((t) => { if (!t.matched) { t.home = slot(t.i); if (!t.anim && !away) t.mesh.position.copy(t.home); } }); } }
export function exposure(dark) { return dark ? 1.08 : 1.06; }
export function setTheme(t) {
  env = envFor(t); scene.environment = env;
  const dark = t === 'dark';
  table.visible = false; catcher.visible = true; catcher.material.color.set(dark ? 0x000000 : 0x5a4632); catcher.material.opacity = dark ? 0.55 : 0.22; // no table top: the pieces cast soft shadows straight onto the scene behind
  hemi.intensity = dark ? 0.32 : 0.95; hemi.groundColor.set(dark ? 0x161514 : 0xc9bfb0);
  key.intensity = dark ? 1.9 : 2.2; key.color.set(dark ? 0xfff5ec : 0xfffaf2);
  [backMat, edgeMat, ...fronts].forEach((m) => { if (m) m.envMap = env; });
}

let tm = 0;
const qA = new THREE.Quaternion();
export function update(dt) {
  tm += dt;
  camPos.lerp(camGoal, 1 - Math.exp(-dt * 2.3)); camLook.lerp(camTarget, 1 - Math.exp(-dt * 2.3));
  camera.position.copy(camPos); camera.lookAt(camLook);
  for (const t of [...tiles, ...leaving]) {
    const a = t.anim;
    if (!a) { // hover: a face-down tile rises a hair under the cursor
      if (t.leaving) continue; // swept-up tiles rest in their stack
      const target = t === hovered ? t.home.y + 0.45 : t.home.y;
      t.mesh.position.y = lerp(t.mesh.position.y, target, 1 - Math.exp(-dt * 14));
      continue;
    }
    a.t += dt; if (a.t < 0) continue;
    const k = clamp(a.t / a.dur, 0, 1), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    t.mesh.position.lerpVectors(a.from, a.to, e); t.mesh.position.y += Math.sin(Math.PI * k) * a.lift;
    if (a.axisFlip) { qA.setFromAxisAngle(X, a.axisFlip.sign * Math.PI * e); t.mesh.quaternion.copy(qA).multiply(a.axisFlip.start); }
    else t.mesh.quaternion.slerpQuaternions(a.fromQ, a.toQ, e);
    if (k >= 1) { t.mesh.quaternion.copy(a.toQ); t.anim = null; a.done && a.done(); }
  }
  // tiles in the air never cut through tiles on the table or tiles that took off before them
  const items = [...tiles, ...leaving].filter((t) => t.mesh.parent);
  for (const t of items) { t.half = HALF; t.flying = !!(t.anim && t.anim.t >= 0); }
  clearFlights(items, dt);
  if (game && game.start && !game.won) { const s = Math.floor((performance.now() - game.start) / 1000); if (s !== game._s) { game._s = s; renderHud(); } }
  return true;
}

