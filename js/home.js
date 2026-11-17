// Home: a flat-lay of the collection on a softly lit table. Hover lifts a piece, tap opens it.
import * as THREE from 'three';
import { renderer, envFor, tex, grain, STOCK, paperMaterial, edgeMaterial, cardGeometry, spring, clamp, lerp, isTouch, handCam } from './core.js';
import * as sound from './sound.js';

const A = 'assets/';
export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 1, 600);

let theme = document.documentElement.dataset.theme;
let env = envFor(theme);
scene.environment = env;

// ---------- Lights ----------
const hemi = new THREE.HemisphereLight(0xfff4e6, 0x1a1a2a, 0.35);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff5ec, 2.2);
key.position.set(-30, 60, 25);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 10, far: 160 });
key.shadow.radius = 6; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
scene.add(key);
const rim = new THREE.DirectionalLight(0x9db4ff, 0.5); rim.position.set(40, 20, -40); scene.add(rim);

// ---------- Table: soft linen pool that fades into the page ----------
function linen(size = 512) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  g.fillStyle = '#ececec'; g.fillRect(0, 0, size, size);
  for (let i = 0; i < size; i += 2) {
    g.fillStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.05})`; g.fillRect(0, i, size, 1);
    g.fillStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.05})`; g.fillRect(i, 0, 1, size);
  }
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '255,255,255' : '0,0,0'},.05)`; g.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 3, 1); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 10); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function radialAlpha() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const r = g.createRadialGradient(128, 128, 30, 128, 128, 128); r.addColorStop(0, '#fff'); r.addColorStop(0.22, '#c8c8c8'); r.addColorStop(0.5, '#3a3a3a'); r.addColorStop(1, '#000');
  g.fillStyle = r; g.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c);
}
const tableMat = new THREE.MeshStandardMaterial({ map: linen(), roughness: 0.9, metalness: 0, transparent: true, alphaMap: radialAlpha(), envMapIntensity: 0.25 });
const table = new THREE.Mesh(new THREE.CircleGeometry(62, 96), tableMat);
table.rotation.x = -Math.PI / 2; table.receiveShadow = true; scene.add(table);
// light mode: no visible table at all, only soft shadows on the page
const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ color: 0x5a4632, opacity: 0.22 }));
shadowCatcher.rotation.x = -Math.PI / 2; shadowCatcher.position.y = 0.001; shadowCatcher.receiveShadow = true; scene.add(shadowCatcher);

// ---------- Helpers ----------
function boxMat(url) {
  const m = new THREE.MeshPhysicalMaterial({ map: tex(url), roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.4, normalMap: grain, normalScale: new THREE.Vector2(0.08, 0.08), envMapIntensity: 0.9 });
  return m;
}
function face(url, w, h) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), boxMat(url));
  m.castShadow = true; m.receiveShadow = true; return m;
}
// Box with art on top + 4 walls (walls are pre-rotated so their top edge is the fold).
export function artBox({ w, h, d, top, n, s, e, wst, base, baseColor = 0x8f1019, wallH = d }) {
  const g = new THREE.Group(); const lid = new THREE.Group(); g.add(lid); g.userData.lid = lid;
  const H = d; g.userData.hinge = { y: H, z: -h / 2, x: -w / 2 }; g.userData.wallH = wallH; // the lid's top edges (the memory lid hinges on the left)
  const t = face(top, w, h); t.rotation.x = -Math.PI / 2; t.position.y = H; lid.add(t);
  const S = face(s, w, wallH); S.position.set(0, H - wallH / 2, h / 2); lid.add(S);
  const N = face(n, w, wallH); N.rotation.y = Math.PI; N.position.set(0, H - wallH / 2, -h / 2); lid.add(N);
  const E = face(e, h, wallH); E.rotation.y = Math.PI / 2; E.position.set(w / 2, H - wallH / 2, 0); lid.add(E);
  const W = face(wst, h, wallH); W.rotation.y = -Math.PI / 2; W.position.set(-w / 2, H - wallH / 2, 0); lid.add(W);
  // the inside of the lid: plain white board just inside each printed panel, so the lid stays solid when it opens
  const innerM = new THREE.MeshStandardMaterial({ color: 0xf3efe8, roughness: 0.85 }), ins = 0.012;
  const inner = (pw, ph, x, y, z, rx, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), innerM); m.position.set(x, y, z); m.rotation.set(rx, ry, 0, 'YXZ'); m.receiveShadow = true; lid.add(m); };
  inner(w - 2 * ins, h - 2 * ins, 0, H - ins, 0, Math.PI / 2, 0);                         // under the top
  inner(w - 2 * ins, wallH - ins, 0, H - wallH / 2 - ins / 2, h / 2 - ins, 0, Math.PI);   // inside of the front wall
  inner(w - 2 * ins, wallH - ins, 0, H - wallH / 2 - ins / 2, -h / 2 + ins, 0, 0);        // back wall
  inner(h - 2 * ins, wallH - ins, w / 2 - ins, H - wallH / 2 - ins / 2, 0, 0, -Math.PI / 2); // right wall
  inner(h - 2 * ins, wallH - ins, -w / 2 + ins, H - wallH / 2 - ins / 2, 0, 0, Math.PI / 2); // left wall
  if (base) {
    // the bottom of the box is a real tray: a thin floor and four thin walls, open at the top, sitting just inside
    // the lid (the lid's walls slide down over it). Outside in the box colour, inside plain white board.
    const tw = 0.1, iw = w - 0.24, ih = h - 0.24, th = H - 0.12; // wall thickness, tray size (inside the lid), height
    const outM = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.7 });
    const inM = new THREE.MeshStandardMaterial({ color: 0xf3efe8, roughness: 0.85 });
    const part = (bw, bh, bd, x, y, z, mats) => { const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mats); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z
    part(iw, tw, ih, 0, tw / 2, 0, [outM, outM, inM, outM, outM, outM]);                                   // floor
    part(iw, th, tw, 0, th / 2, ih / 2 - tw / 2, [outM, outM, outM, outM, outM, inM]);                     // front wall
    part(iw, th, tw, 0, th / 2, -ih / 2 + tw / 2, [outM, outM, outM, outM, inM, outM]);                    // back wall
    part(tw, th, ih - 2 * tw, iw / 2 - tw / 2, th / 2, 0, [outM, inM, outM, outM, outM, outM]);            // right wall
    part(tw, th, ih - 2 * tw, -iw / 2 + tw / 2, th / 2, 0, [inM, outM, outM, outM, outM, outM]);           // left wall
  }
  // hidden solid for shadows/raycast robustness
  const hit = new THREE.Mesh(new THREE.BoxGeometry(w, H, h), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = H / 2; g.add(hit); g.userData.hit = hit;
  return g;
}

// the resting wide view (with the gentle parallax), written into pos / look
function wideGoal(ip, pos, lk) {
  const px = clamp(pointer.x + gyro.x, -1, 1), py = clamp(pointer.y + gyro.y, -1, 1);
  const elev = THREE.MathUtils.degToRad(portrait ? 68 : 60) - py * 0.04;
  const az = px * 0.07 + Math.sin(t * 0.15) * 0.015;
  const dist = camDist * lerp(1.12, 1, ip);
  pos.set(camTarget.x + Math.sin(az) * Math.cos(elev) * dist, Math.sin(elev) * dist, camTarget.z + Math.cos(az) * Math.cos(elev) * dist);
  lk.copy(camTarget);
}
function hardcover() {
  const g = new THREE.Group();
  const W = 18.13, D = 13.3, board = 0.17, block = 0.22, inset = 0.35; // same slim hardcover as the storybook scene
  const navy = new THREE.MeshPhysicalMaterial({ color: 0x17204a, roughness: 0.55, clearcoat: 0.4, clearcoatRoughness: 0.3 });
  const bot = new THREE.Mesh(new THREE.BoxGeometry(W, board, D), navy); bot.position.y = board / 2;
  const top = new THREE.Mesh(new THREE.BoxGeometry(W, board, D), navy); top.position.y = board * 1.5 + block;
  // page block with fine page lines
  const c = document.createElement('canvas'); c.width = 16; c.height = 256; const x = c.getContext('2d');
  x.fillStyle = '#f4ead8'; x.fillRect(0, 0, 16, 256);
  for (let i = 0; i < 256; i += 3) { x.fillStyle = `rgba(120,100,70,${0.08 + Math.random() * 0.1})`; x.fillRect(0, i, 16, 1); }
  const pt = new THREE.CanvasTexture(c); pt.colorSpace = THREE.SRGBColorSpace; pt.wrapS = THREE.RepeatWrapping;
  const pagesSide = new THREE.MeshStandardMaterial({ map: pt, roughness: 0.9 });
  const pagesTop = new THREE.MeshStandardMaterial({ color: 0xf4ead8, roughness: 0.9 });
  const blockMesh = new THREE.Mesh(new THREE.BoxGeometry(W - inset - 0.1, block, D - inset * 2), [pagesSide, pagesSide, pagesTop, pagesTop, pagesSide, pagesSide]);
  // rotate page-line texture to run horizontally on side faces
  pt.rotation = Math.PI / 2; pt.center.set(0.5, 0.5); pt.repeat.set(1, 1);
  blockMesh.position.set(inset / 2, board + block / 2, 0);
  // rounded spine on the left (binding edge)
  const spine = new THREE.Mesh(new THREE.CylinderGeometry((block + board * 2) / 2, (block + board * 2) / 2, D, 24, 1, false, Math.PI, Math.PI), navy);
  spine.rotation.x = Math.PI / 2; spine.position.set(-W / 2, (block + board * 2) / 2, 0);
  const cover = face(A + 'book/01.webp', W - 0.12, D - 0.12); cover.rotation.x = -Math.PI / 2; cover.position.y = board * 2 + block + 0.002;
  cover.material.roughness = 0.42; cover.material.clearcoat = 0.55;
  for (const m of [bot, top, blockMesh, spine]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
  g.add(cover);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(W, block + board * 2, D), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = (block + board * 2) / 2; g.add(hit); g.userData.hit = hit;
  return g;
}

function card(stock, front, back, env) {
  const m = new THREE.Mesh(cardGeometry(stock), [paperMaterial(stock, tex(front), env), paperMaterial(stock, tex(back), env), edgeMaterial(stock, env)]);
  m.castShadow = true; m.receiveShadow = true; return m;
}

// ---------- Build the collection ----------
const items = [];
let trayStack = [];
// how full the memory box is, 0..1 (top tiles go first)
export function trayFill(f) { const n = Math.round(clamp(f, 0, 1) * trayStack.length); trayStack.forEach((m, i) => { m.visible = i < n; m.position.y = m.userData.y0; }); }
// The 24 tiles that come out to the grid are real tiles in the box: the top six of each of the four stacks, taken in
// turns across the stacks (k = 0 is the first out, the top of the first stack). a = 0 sits in its stack, 1 = lifted
// straight up clear of the box walls.
const TRAY_OUT = 24, TRAY_LIFT_TO = 2.25 + 0.55; // box height + clearance (box-local y of a lifted tile)
export const trayCount = () => TRAY_OUT;
export function trayTile(k) { const level = 11 - Math.floor(k / 4), stack = k % 4; return trayStack[level * 4 + stack]; }
export function trayLift(k, a) { const m = trayTile(k); if (m) m.position.y = lerp(m.userData.y0, TRAY_LIFT_TO, a); }
export function trayShow(k, v) { const m = trayTile(k); if (m) m.visible = v; }
// all 24 out (the grid is showing) or all back in
// the tuck box's cards (k = the card's turn). a = 0 inside the box, 1 = just clear of its top end
let tuckBox = null;
export function tuckTile(k) { return tuckBox.pool[k % tuckBox.pool.length]; }
export function tuckSlide(k, a) {
  const m = tuckTile(k), L = STOCK.playing.h;
  m.position.z = lerp(0, -(tuckBox.h / 2 + L / 2 + 0.15), a); // toward the top end (the box's far side)
}
export function tuckShow(k, v) { tuckTile(k).visible = v; }
export function trayOut(out) { for (let k = 0; k < TRAY_OUT; k++) { trayLift(k, 0); trayShow(k, !out); } }
let manifest;
export async function build(man) {
  manifest = man;
  const B = man.boxes;
  const puzzle = artBox({ w: B.puz.w, h: B.puz.h, d: B.puz.d + 0.15, wallH: B.puz.d, top: A + 'boxes/puz_top.webp', n: A + 'boxes/puz_n.webp', s: A + 'boxes/puz_s.webp', e: A + 'boxes/puz_e.webp', wst: A + 'boxes/puz_w.webp', base: true });
  const memory = artBox({ w: B.mem.w, h: B.mem.h, d: 2.25, wallH: B.mem.d, top: A + 'boxes/mem_top.webp', n: A + 'boxes/mem_n.webp', s: A + 'boxes/mem_s.webp', e: A + 'boxes/mem_e.webp', wst: A + 'boxes/mem_w.webp', base: true, baseColor: 0xf1e4cc });
  // the tiles live inside the memory box: a stack in the tray, seen when the lid comes off; it empties as they fly
  // out into the grid and fills again as they fly home
  const S = STOCK.memory, back = A + 'mm/thumb/back.webp';
  // four stacks of twelve, two by two, like the real game in its box
  trayStack = [];
  for (let i = 0; i < 12; i++) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const m = card(S, back, back, env); m.rotation.set(Math.PI / 2, 0, Math.PI + (Math.random() - 0.5) * 0.05); // back up, reading the right way round
    m.position.set(sx * (S.w / 2 + 0.05) + (Math.random() - 0.5) * 0.04, 0.1 + S.t / 2 + 0.002 + i * (S.t + 0.004), sz * (S.h / 2 + 0.05) + (Math.random() - 0.5) * 0.04);
    m.userData.y0 = m.position.y; memory.add(m); trayStack.push(m);
  }
  const tuck = artBox({ w: B.tuck.w, h: B.tuck.h, d: B.tuck.d, top: A + 'boxes/tuck_front.webp', n: A + 'boxes/tuck_top.webp', s: A + 'boxes/tuck_bottom.webp', e: A + 'boxes/tuck_right.webp', wst: A + 'boxes/tuck_left.webp' });
  // real cards inside the tuck box, slid out of (and back into) its top end; the box itself hides whatever part of a
  // card is still inside. A small pool is enough: only a few are ever sliding at once.
  const PS = STOCK.playing, pcBack = A + 'pc/thumb/back.webp';
  tuckBox = { h: B.tuck.h, d: B.tuck.d, pool: [] };
  for (let i = 0; i < 54; i++) { // one for every card: a card sliding in is never taken over by the next
    const m = card(PS, pcBack, pcBack, env); m.rotation.set(Math.PI / 2, 0, Math.PI); m.visible = false; // face down, its top toward the box's top end
    m.position.set(0, 0.25 + (i % 12) * 0.12, 0); m.userData.y0 = m.position.y; tuck.add(m); tuckBox.pool.push(m);
  }
  const book = hardcover();

  const defs = [
    { id: 'book', obj: book, name: 'Storybook', tag: '12 pages', route: '#book', size: 18.13 },
    { id: 'puzzle', obj: puzzle, name: '100 Piece Puzzle', tag: '100 pieces', route: '#puzzle', size: B.puz.w },
    { id: 'memory', obj: memory, name: 'Memory Match', tag: '24 pairs', route: '#memory' },
    { id: 'cards', obj: tuck, name: 'Holiday Playing Cards', tag: '54 cards', route: '#cards' },
  ];
  for (const d of defs) {
    const root = new THREE.Group(); root.add(d.obj);
    d.obj.traverse((o) => { if (o.isMesh) o.userData.item = d; });
    scene.add(root);
    Object.assign(d, { root, lift: 0, liftV: 0, tilt: 0, tiltV: 0, base: new THREE.Vector3(), yaw: 0, el: null, anchor: new THREE.Vector3(), wiggle: 0 });
    items.push(d);
  }
  const labels = document.getElementById('home-labels');
  labels.innerHTML = '';
  for (const d of items) {
    const el = document.createElement('button'); el.className = 'label'; el.type = 'button'; el.innerHTML = `${d.name}<small>${d.tag}</small>`; labels.appendChild(el); d.el = el;
    el.addEventListener('click', () => openItem(d));
    el.addEventListener('pointerenter', () => { if (active && !busy) { hover = d; onAim && onAim(d.route); } });
    el.addEventListener('pointerleave', () => { if (hover === d) hover = null; });
  }
  layout();
}

// Arrange for the current aspect: a 2x2 on wide screens, one column on phones held upright, one row on phones held
// sideways (short and wide: a 2x2 would be crammed into the height).
let portrait = false, row = false, camTarget = new THREE.Vector3(), camPos = new THREE.Vector3(), camDist = 100;
function layout() {
  const aspect = innerWidth / innerHeight;
  portrait = aspect < 1.05; row = !portrait && innerHeight < 560 && aspect > 1.5;
  const P = row
    ? { book: [-32.5, 0, 0.05], puzzle: [-10.5, 0, -0.04], memory: [11, 0, 0.05], cards: [31, 0, -0.07] } // sideways phones: one row
    : portrait
    ? { book: [0, -35.5, 0.05], puzzle: [0, -11.5, -0.05], memory: [0, 10.5, 0.06], cards: [0, 30, -0.08] } // phones: one column, top to bottom
    : { book: [-11, -9.5, 0.06], puzzle: [11, -9.5, -0.05], memory: [-10.5, 10.5, 0.07], cards: [10.5, 10.5, -0.09] }; // desktop: 2x2
  for (const d of items) {
    const [x, z, yaw] = P[d.id];
    d.base.set(x, 0, z); d.yaw = yaw;
    d.root.position.copy(d.base); d.root.rotation.y = yaw;
  }
  scene.updateMatrixWorld(true);
  for (const d of items) {
    d.box = new THREE.Box3().setFromObject(d.obj);
    d.labelBox = d.box.clone();
  }
  // frame everything: fit width
  const spanW = row ? 92 : portrait ? 24 : 50, spanH = row ? 26 : portrait ? 85 : 41;
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const distH = (spanH / 2) / Math.tan(vFov / 2);
  const distW = (spanW / 2) / (Math.tan(vFov / 2) * aspect);
  camDist = Math.max(distH, distW) * 1.08;
  camTarget.set(0, 0, portrait ? -2.5 : row ? -5 : 1.5);
}

export function resize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); if (items.length) layout(); }

export function setTheme(t) {
  theme = t; env = envFor(t); scene.environment = env;
  const dark = t === 'dark';
  tableMat.color.set(0x0a0e1e).multiplyScalar(0.55);
  table.visible = false; shadowCatcher.visible = true; shadowCatcher.material.color.set(dark ? 0x000000 : 0x5a4632); shadowCatcher.material.opacity = dark ? 0.55 : 0.22;
  hemi.intensity = dark ? 0.3 : 0.95; hemi.groundColor.set(dark ? 0x161514 : 0xc9bfb0);
  key.intensity = dark ? 1.9 : 2.2; key.color.set(dark ? 0xfff5ec : 0xfffaf2);
  scene.traverse((o) => { if (o.isMesh && o.material) [].concat(o.material).forEach((m) => { if (m.envMap !== undefined && 'envMap' in m && m.envMap) m.envMap = env; }); });
}

// ---------- Interaction ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(-9, -9);
let hover = null, pointer = { x: 0, y: 0 }, active = false, onOpen = null, busy = false;
export function onSelect(fn) { onOpen = fn; }
// told as soon as a piece is pointed at, so its section can start loading before it's opened
let onAim = null;
export function onHover(fn) { onAim = fn; }
let routeReady = null;
export function setRouteReady(fn) { routeReady = fn; }
function pick(e) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const meshes = []; for (const d of items) d.root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const hit = ray.intersectObjects(meshes, false)[0];
  return hit ? hit.object.userData.item : null;
}
function onMove(e) {
  if (!active || busy) return;
  pointer.x = (e.clientX / innerWidth) * 2 - 1; pointer.y = (e.clientY / innerHeight) * 2 - 1;
  if (e.pointerType === 'mouse') {
    const h = pick(e);
    if (h !== hover) { hover = h; document.body.style.cursor = h ? 'pointer' : ''; if (h) { sound.play('slide', { vol: 0.12, rate: 1.3, gap: 120 }); onAim && onAim(h.route); } }
  }
}
function onUp(e) {
  if (!active || busy) return;
  if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) return;
  const h = pick(e);
  if (h) openItem(h);
}
function openItem(h) {
  if (!active || busy) return;
  sound.unlock();
  if (!h.route || (routeReady && !routeReady(h.route))) { h.wiggle = 1; sound.play('shove', { vol: 0.35 }); return; }
  busy = true; hover = h;
  sound.play(h.id === 'cards' ? 'takeout' : 'open', { vol: 0.6 });
  zoomTo = h; zoomT = 0; lidT = 0;
  onOpen && onOpen(h.route, h.id);
}
const down = { x: 0, y: 0 };
canvasListen();
function canvasListen() {
  const c = renderer.domElement;
  c.addEventListener('pointermove', onMove);
  c.addEventListener('pointerdown', (e) => { down.x = e.clientX; down.y = e.clientY; if (active) { hover = e.pointerType === 'mouse' ? hover : pick(e); if (hover && onAim) onAim(hover.route); } });
  c.addEventListener('pointerup', onUp);
  c.addEventListener('pointerleave', () => { if (active) { hover = null; document.body.style.cursor = ''; } });
}

let zoomTo = null, zoomT = 0, lidT = 0, intro = 0, returning = null, lidCloseAt = 0;
// enter(fromId): when coming back from a section, start zoomed on that piece (lid open) and pull back out
export function enter(fromId, cleared = false) {
  active = true; busy = false; zoomTo = null; hover = null;
  returning = fromId ? items.find((d) => d.id === fromId) : null;
  intro = returning ? 0.35 : 0;
  if (returning) { zoomTo = returning; zoomT = 1; lidT = 1; first = true; returnT = -0.55; }
  hand.release();
  focusGoal = 0;
  if (returning && cleared) { clearFocus = returning; clearE = 1; clearGoal = 0; focusE = cleared === 'all' ? 1 : 0; } else if (!cleared) { clearFocus = null; clearE = 0; clearGoal = 0; focusE = 0; }
}
let returnT = 1;
let clearFocus = null, clearE = 0, clearGoal = 0, focusE = 0, focusGoal = 0;
// the chosen piece itself slides off toward the viewer once its contents have flown out (and back on return)
export function dropFocus() { focusGoal = 1; sound.play('shove', { vol: 0.22, rate: 0.85, gap: 200, dur: 900 }); } // the box slides away
const hand = handCam(camera);
// a stage is taking over from this piece: the rest of the collection slides off the table
// start the dolly onto a piece (when a section is opened by URL rather than a click)
export function focus(id) { const d = items.find((x) => x.id === id); if (!d) return; if (zoomTo !== d) { zoomTo = d; zoomT = 0; lidT = 0; } busy = true; active = false; hover = null; }
// for a continuous camera move driven from outside (see app.js): the wide view, a camera override, and hiding a piece
export function widePose() { const p = new THREE.Vector3(), l = new THREE.Vector3(); wideGoal(1, p, l); return { pos: p, look: l }; }
// the close view of one piece (as a gallery opens from it)
export function zoomPose(id) {
  const d = items.find((x) => x.id === id), p = new THREE.Vector3(), l = new THREE.Vector3(); wideGoal(1, p, l);
  if (id === 'memory' || id === 'cards') return { pos: p, look: l }; // opened where they stand
  const f = d.base.clone(); f.y += 2; l.copy(f); p.lerp(f.clone().add(new THREE.Vector3(0, 30, 18)), 0.72);
  return { pos: p, look: l };
}
export function currentPose() { return { pos: curPos.clone(), look: curLook.clone() }; }
// no slow re-entry dolly after a transition has already brought the camera to the wide view
export function settle() { intro = 1; }
// back from a gallery: the table (and the open box) return while an outside move flies the camera out
export function returnFrom(id) {
  const d = items.find((x) => x.id === id);
  active = true; busy = false; hover = null; returning = null; intro = 1; hand.release();
  zoomTo = d; zoomT = 1; lidT = 1; lidCloseAt = 0; d.lidAway = d.lidAway ?? 1; clearFocus = d; clearE = 1; clearGoal = 0; focusE = 1; focusGoal = 0;
}
// coming back from a piece's own scene: the rest of the table starts away and slides back in during the move
export function slideBackFor(id) { const d = items.find((x) => x.id === id); if (!d) return; clearFocus = d; clearE = 1; clearGoal = 0; focusE = 0; focusGoal = 0; }
export function finishReturn() { if (zoomTo) zoomTo.lidLeft = lidT; zoomTo = null; lidCloseAt = 0; }
// on the way home the lid starts to close while the last tiles are still settling into the tray
export function closeLidIn(s) { lidCloseAt = t + s; }
// the tuck box coming home: it stays below the view a moment while the first cards head down into it, then rises,
// slowing all the way, and lands as the last card goes in
let returnPace = null;
export function riseWhileReceiving(wait, dur) { returnPace = { wait, dur }; }
// memory box, coming home: the lid stays up out of view until every tile is back in its stack, then comes down and
// swings shut in one move
export function holdLid(id) { const d = items.find((x) => x.id === id); if (d) { d.lidHold = true; d.lidAway = 1; } }
// called as the last tile leaves the grid: the lid is back, open on its hinge, by the time that tile is in, then shuts
export function releaseLid(id) { const d = items.find((x) => x.id === id); if (!d) return; d.lidHold = false; d.closeAt = t + 0.9; if (zoomTo === d) lidCloseAt = t + 0.9; }
// the book and the puzzle box on this table are drawn by their own scenes (see app.js); here they are only an
// invisible stand-in that still takes the pointer, holds the label and casts nothing
export function useCompanion(id) {
  const d = items.find((x) => x.id === id); if (!d) return;
  d.obj.traverse((o) => { if (o.isMesh && o !== d.obj.userData.hit) { o.visible = false; o.castShadow = false; } });
}
export function drive(pose) { hand.drive(pose); }
export function hide(id, v) { const d = items.find((x) => x.id === id); if (d) d.root.visible = !v; }
export function clearFor(id) { clearFocus = items.find((d) => d.id === id) || null; clearGoal = 1; }
// the shared object as this scene sees it: top-centre, yaw, width
export function anchor(id) {
  const d = items.find((x) => x.id === id); scene.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(d.obj), c = b.getCenter(new THREE.Vector3()); c.y = b.max.y;
  return { pos: c, yaw: d.root.rotation.y, size: d.size };
}
export function leave() { active = false; hover = null; document.body.style.cursor = ''; }
// screen position + width (px) of a piece's top face, for card flights
export function screenOf(id) {
  const d = items.find((x) => x.id === id); if (!d) return { x: innerWidth / 2, y: innerHeight / 2, w: 80 };
  const b = new THREE.Box3().setFromObject(d.obj); const c = b.getCenter(new THREE.Vector3()); c.y = b.max.y;
  const p1 = c.clone().project(camera), e = c.clone(); e.x = b.max.x; const p2 = e.project(camera);
  return { x: (p1.x * 0.5 + 0.5) * innerWidth, y: (-p1.y * 0.5 + 0.5) * innerHeight, w: Math.abs(p2.x - p1.x) * innerWidth };
}

// ---------- Frame ----------
const tmp = new THREE.Vector3(), look = new THREE.Vector3(), curLook = new THREE.Vector3(), curPos = new THREE.Vector3();
let first = true, t = 0, gyro = { x: 0, y: 0 };
export function setGyro(x, y) { gyro.x = x; gyro.y = y; }
const corners = Array.from({ length: 8 }, () => new THREE.Vector3());
export function update(dt) {
  t += dt; intro = Math.min(1, intro + dt * 0.9);
  const ip = 1 - Math.pow(1 - intro, 3);
  const dark = document.documentElement.dataset.theme === 'dark';
  // camera: gentle parallax around a high three-quarter view; dolly in on the chosen piece
  wideGoal(ip, camPos, look);
  if (returning) { returnT = Math.min(1, returnT + dt * 1.1); zoomT = 1 - Math.max(0, returnT); lidT = 1 - Math.max(0, returnT * 1.4); if (returnT >= 1) { returning = null; zoomTo = null; } }
  else if (zoomTo) { zoomT = Math.min(1, zoomT + dt * 1.2); lidT = lidCloseAt && t >= lidCloseAt ? Math.max(0, lidT - dt * 1.7) : Math.min(1, lidT + dt / 0.9); }
  if (zoomTo && zoomTo.id !== 'memory' && zoomTo.id !== 'cards') { // the boxes open where they stand: no dolly onto them
    const z = zoomT * zoomT * (3 - 2 * zoomT);
    tmp.copy(zoomTo.base); tmp.y += 2;
    look.lerp(tmp, z);
    camPos.lerp(tmp.clone().add(new THREE.Vector3(0, 30, 18)), z * 0.72);
  }
  if (first) { curPos.copy(camPos); curLook.copy(look); first = false; }
  if (hand.driving) { curPos.copy(hand.driving.pos); curLook.copy(hand.driving.look); } // follow an outside camera move exactly, so it hands back without a jump
  const k = 1 - Math.exp(-dt * (zoomTo ? 4.2 : 2.6));
  curPos.lerp(camPos, k); curLook.lerp(look, k);
  hand.place(curPos, curLook, dt);

  if (clearFocus) {
    const goal = returning && returnT < 0.05 ? 1 : clearGoal;
    clearE = goal > clearE ? Math.min(goal, clearE + dt * 1.25) : Math.max(goal, clearE - dt * 1.1);
    if (focusGoal > focusE) focusE = Math.min(1, focusE + dt * 1.1);
    else if (returnPace) { returnPace.wait -= dt; if (returnPace.wait <= 0) focusE = Math.max(0, focusE - dt / returnPace.dur); if (focusE <= 0) returnPace = null; }
    else focusE = Math.max(0, focusE - dt * 1.6);
    if (clearE <= 0 && !clearGoal && focusE <= 0) clearFocus = null;
  }
  for (const d of items) {
    const hot = d === hover && !zoomTo;
    [d.lift, d.liftV] = spring(d.lift, d.liftV, hot ? 1.4 : 0, 60, 13, dt);
    d.wiggle = Math.max(0, d.wiggle - dt * 1.6);
    d.root.position.y = d.lift;
    // clearing the table for a hand-off: everything else slides away, out of the frame
    if (clearFocus && d !== clearFocus) {
      tmp.set(d.base.x - clearFocus.base.x, 0, d.base.z - clearFocus.base.z); if (tmp.lengthSq() < 1e-6) tmp.set(0, 0, 1); tmp.normalize();
      const e = clearE * clearE * (3 - 2 * clearE);
      d.root.position.x = d.base.x + tmp.x * 95 * e; d.root.position.z = d.base.z + tmp.z * 95 * e;
    } else if (clearFocus && d === clearFocus && focusE > 0) {
      // leaving: in-out (the tuck box is pushed by the stream of cards, so it picks up speed); coming back: slows into place
      const e = focusGoal ? (d.id === 'cards' ? focusE * focusE : focusE * focusE * (3 - 2 * focusE)) : d.id === 'cards' ? focusE * focusE * focusE : focusE * focusE;
      if (d.id === 'cards') d.recoil = -0.1 * e;
      d.root.position.x = d.base.x; d.root.position.z = d.base.z + 70 * e;
    } else { d.root.position.x = d.base.x; d.root.position.z = d.base.z; }
    d.root.rotation.y = d.yaw + Math.sin(d.wiggle * 18) * d.wiggle * 0.06;
    d.root.rotation.x = -d.lift * 0.02 + (clearFocus === d && focusE > 0 ? d.recoil || 0 : 0);
    // the lid lifts off when a box is opened
    const lid = d.obj.userData.lid;
    if (lid && d.id === 'memory') {
      if (d !== zoomTo && d.lidLeft > 0 && !d.lidHold && t >= (d.closeAt || 0)) d.lidLeft = Math.max(0, d.lidLeft - dt * 1.6); // the lid closes
      // opening: smooth in and out. Closing: it starts to swing quickly and slows right down as it meets the box
      const raw = d === zoomTo ? lidT : (d.lidLeft || 0), closing = d === zoomTo ? (lidCloseAt && t >= lidCloseAt) : raw > 0 && !d.lidHold && t >= (d.closeAt || 0);
      if (d.prevClosing && !closing && raw <= 0) { d.seatT = 1e-6; sound.play('place', { vol: 0.35, rate: 0.8 }); } // just seated: one very small settle
      d.prevClosing = closing;
      let l = closing ? Math.pow(raw, 2.2) : ease3(raw); // both are 0 when shut, so switching between them never jumps
      if (d.seatT) { d.seatT += dt / 0.28; if (d.seatT >= 1) d.seatT = 0; else l += 0.012 * Math.sin(Math.PI * d.seatT) * (1 - d.seatT); }
      // hinged on its back top edge: it swings up and over toward the back, rising a little as it goes, so the
      // tiles have a clear way out of the front
      // hinged on its left top edge: it swings up and over to the left, away from the tiles lifting out, rising a little
      // it first lifts straight up until its walls clear the base, so turning can never cut into the box
      const sm = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
      const up = (d.obj.userData.wallH + 0.15) * sm(l / 0.35), th = 2.0 * sm((l - 0.2) / 0.8);
      const hy = d.obj.userData.hinge.y, hx = d.obj.userData.hinge.x, c = Math.cos(th), s = Math.sin(th);
      lid.rotation.set(0, 0, th);
      lid.position.set(hx - (hx * c - hy * s) - 0.5 * sm((l - 0.2) / 0.8), hy - (hx * s + hy * c) + up, 0);
      // while the box is away the lid is out past the left edge of the view (the nearest way out, crossing nothing)
      const opening = d === zoomTo && !returning && !lidCloseAt && lidT > 0.65; // mostly open: it glides off to the left, out of the tiles' way
      const goal = d.lidHold || opening ? 1 : clearFocus === d ? focusGoal : 0; // held out of view while tiles go back in
      d.lidAway = d.lidAway ?? 0;
      d.lidAway = goal > d.lidAway ? Math.min(1, d.lidAway + dt / 0.6) : Math.max(0, d.lidAway - dt * 1.3);
      if (d.lidAway > 0) { const a = d.lidAway, e = goal ? a * a * (3 - 2 * a) : a * a; lid.position.x -= 85 * e; lid.position.y += 3 * e; }
    }
    // label sits just under the piece's on-screen footprint
    let maxY = -Infinity, minX = Infinity, maxX = -Infinity;
    const b = d.labelBox;
    for (let i = 0; i < 8; i++) {
      corners[i].set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(camera);
      const sy = (-corners[i].y * 0.5 + 0.5) * innerHeight; maxY = Math.max(maxY, sy);
    }
    for (let i = 0; i < 8; i++) { // centre the name under the piece itself
      corners[i].set(i & 1 ? d.box.max.x : d.box.min.x, d.box.min.y, i & 4 ? d.box.max.z : d.box.min.z).project(camera);
      const sx = (corners[i].x * 0.5 + 0.5) * innerWidth; minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
    }
    d.el.style.transform = `translate(${((minX + maxX) / 2).toFixed(1)}px, ${(maxY + 6).toFixed(1)}px) translate(-50%, 0)`;
    d.el.style.opacity = (zoomTo ? 0 : ip).toFixed(3);
    d.el.classList.toggle('hot', hot);
  }
}
function ease3(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }

