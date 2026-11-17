// Storybook: a hardcover you open and page through by grabbing pages.
// Each paper leaf is a strip whose angle varies along its length (so it bends without stretching), with a
// diagonal twist when held by a corner. Released pages swing over with the free edge trailing, like paper in air.
import * as THREE from 'three';
import { envFor, tex, texAsync, grain, clamp, lerp, renderer, isTouch, handCam } from './core.js';
import * as sound from './sound.js';
import { hint, learn } from './ui.js';
hint(document.querySelector('#view-book .view-hint'), 'book');
import * as backdrop from './backdrop.js';

const A = 'assets/';
export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 5, 600);
let env = envFor(document.documentElement.dataset.theme);
scene.environment = env;
const hemi = new THREE.HemisphereLight(0xfff4e6, 0x1a1a2a, 0.35); scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff5ec, 2.3);
key.position.set(-18, 46, 26); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 5, far: 120 });
key.shadow.radius = 4; key.shadow.bias = -0.0003; key.shadow.normalBias = 0.02;
scene.add(key);
function vignette() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const r = g.createRadialGradient(128, 128, 30, 128, 128, 128); r.addColorStop(0, '#fff'); r.addColorStop(0.22, '#c8c8c8'); r.addColorStop(0.5, '#3a3a3a'); r.addColorStop(1, '#000');
  g.fillStyle = r; g.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c);
}
const tableMat = new THREE.MeshStandardMaterial({ color: 0x0e0e0d, roughness: 0.95, transparent: true, alphaMap: vignette(), envMapIntensity: 0.25 });
const table = new THREE.Mesh(new THREE.CircleGeometry(60, 96), tableMat); table.rotation.x = -Math.PI / 2; table.receiveShadow = true; scene.add(table);
const catcher = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.ShadowMaterial({ color: 0x5a4632, opacity: 0.25 }));
catcher.rotation.x = -Math.PI / 2; catcher.position.y = 0.0005; catcher.receiveShadow = true; scene.add(catcher);

// ---------- Dimensions (cm): 7 x 5 in landscape pages ----------
const W = 17.78, D = 12.7, NS = 56, NV = 14;
const TB = 0.17, TL = 0.04, BW = W + 0.35, BD = D + 0.6;
const book = new THREE.Group(); scene.add(book);

// ---------- Materials ----------
function pageMat(url, flip) {
  const t = tex(url);
  const m = new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.62, sheen: 0.35, sheenRoughness: 0.7, sheenColor: new THREE.Color(0xffffff), normalMap: grain, normalScale: new THREE.Vector2(0.09, 0.09), vertexColors: true, side: flip ? THREE.BackSide : THREE.FrontSide, envMapIntensity: 0.9 });
  if (flip) { m.map = t.clone(); m.map.repeat.x = -1; m.map.offset.x = 1; m.map.wrapS = THREE.RepeatWrapping; m.map.needsUpdate = true; }
  return m;
}
const clothMat = new THREE.MeshPhysicalMaterial({ color: 0x18214d, roughness: 0.6, clearcoat: 0.25, clearcoatRoughness: 0.5, normalMap: grain, normalScale: new THREE.Vector2(0.25, 0.25) });

// ---------- Paper leaf ----------
function makeLeaf(front, back) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array((NS + 1) * (NV + 1) * 3), uv = new Float32Array((NS + 1) * (NV + 1) * 2), col = new Float32Array((NS + 1) * (NV + 1) * 3);
  const idx = [];
  for (let j = 0; j <= NV; j++) for (let i = 0; i <= NS; i++) {
    const k = j * (NS + 1) + i; uv[k * 2] = i / NS; uv[k * 2 + 1] = 1 - j / NV;
    const s = (i / NS) * W, gutter = 1 - 0.28 * Math.exp(-s / 0.9) - 0.08 * Math.exp(-s / 3);
    col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = gutter;
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NS; i++) { const a = j * (NS + 1) + i, b = a + 1, c = a + NS + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  geo.setIndex(idx);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const g = new THREE.Group();
  const mf = new THREE.Mesh(geo, pageMat(front, false)), mb = new THREE.Mesh(geo, pageMat(back, true));
  for (const m of [mf, mb]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
  return { kind: 'leaf', g, geo, meshes: [mf, mb], t: TL, theta: 0, vel: 0, bend: 0, twist: 0, dirty: true };
}
// shape a leaf: angle along the strip theta(s) = th0 + bend*(s/W)^1.6 + twist*(v-.5)*(s/W)^2 + gutter rise
// Every sheet is described by its angle at each point of a (NS+1) x (NV+1) grid. Neighbouring sheets are then
// kept apart point by point (see separate()), so a page can never pass through another, however fast it moves.
const FN = (NS + 1) * (NV + 1);
function computeField(L) {
  const f = L.field || (L.field = new Float32Array(FN)), ds = W / NS;
  if (L.kind === 'board') { f.fill(L.theta); return; }
  const side = Math.cos(L.theta); // +1 on the right, -1 on the left
  for (let j = 0; j <= NV; j++) {
    const v = j / NV;
    for (let i = 0; i <= NS; i++) {
      const s = i * ds, u = s / W;
      const th = L.theta + L.bend * Math.pow(u, 1.6) + L.twist * (v - 0.5) * u * u + side * 0.12 * Math.exp(-s / 1.1);
      f[j * (NS + 1) + i] = clamp(th, -0.02, Math.PI + 0.02);
    }
  }
}
// integrate a sheet's angle field into its cross-section points (x, y) along each row, starting at its hinge
function integrate(L, y0) {
  const f = L.field, ds = W / NS;
  if (!L.px) { L.px = new Float32Array(FN); L.py = new Float32Array(FN); }
  for (let j = 0; j <= NV; j++) {
    let x = 0, y = y0; const r = j * (NS + 1);
    L.px[r] = x; L.py[r] = y;
    for (let i = 0; i < NS; i++) { const th = f[r + i]; x += Math.cos(th) * ds; y += Math.sin(th) * ds; L.px[r + i + 1] = x; L.py[r + i + 1] = y; }
  }
}
// Keep sheet M on one side of sheet F, at least `need` away, point by point along every row. Where it would come
// closer, M is bent around F instead (its angle there is changed and the rest of the row follows), so paper wraps
// over paper and boards instead of passing through. side -1: M lies on F's lower-angle side, +1: the other side.
function keepApart(F, M, side, need) {
  const ds = W / NS;
  for (let j = 0; j <= NV; j++) {
    const r = j * (NS + 1); let x = M.px[r], y = M.py[r];
    for (let i = 0; i < NS; i++) {
      const q = r + i; let th = M.field[q];
      let cx = x + Math.cos(th) * ds, cy = y + Math.sin(th) * ds;
      const fth = F.field[q], nx = -Math.sin(fth), ny = Math.cos(fth);
      const ex = cx - F.px[q + 1], ey = cy - F.py[q + 1];
      const d = (ex * nx + ey * ny) * side, along = ex * ny - ey * nx; // across and along the other sheet
      if (d < need && Math.abs(along) < ds * 1.5 && d > -2) {
        cx += nx * side * (need - d); cy += ny * side * (need - d);
        th = Math.atan2(cy - y, cx - x); M.field[q] = th;
        cx = x + Math.cos(th) * ds; cy = y + Math.sin(th) * ds;
      }
      M.px[q + 1] = cx; M.py[q + 1] = cy; x = cx; y = cy;
    }
  }
}
function separate(ys) {
  leaves.forEach((L, i) => integrate(L, ys[i]));
  const need = (A, B) => (A.t + B.t) / 2 + 0.01, last = leaves.length - 1;
  for (let pass = 0; pass < 3; pass++) {
    // down from the front board: each sheet stays on its side of the one before it ...
    for (let k = 1; k < last; k++) keepApart(leaves[k - 1], leaves[k], -1, need(leaves[k - 1], leaves[k]));
    // ... and up from the back board: each sheet stays on its side of the one after it
    for (let k = last - 1; k >= 1; k--) keepApart(leaves[k + 1], leaves[k], 1, need(leaves[k + 1], leaves[k]));
  }
}
function shapeLeaf(L) {
  const p = L.geo.attributes.position.array;
  for (let j = 0; j <= NV; j++) {
    const z = (j / NV - 0.5) * D;
    for (let i = 0; i <= NS; i++) { const q = j * (NS + 1) + i, k = q * 3; p[k] = L.px[q]; p[k + 1] = L.py[q]; p[k + 2] = z; }
  }
  L.geo.attributes.position.needsUpdate = true; L.geo.computeVertexNormals(); L.geo.computeBoundingSphere();
}

// ---------- Hard boards ----------
function makeBoard(topUrl, bottomUrl) {
  const g = new THREE.Group(); const pivot = new THREE.Group(); g.add(pivot);
  const core = new THREE.Mesh(new THREE.BoxGeometry(BW, TB, BD), clothMat); core.position.x = BW / 2 - 0.15; core.castShadow = true; core.receiveShadow = true; pivot.add(core);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(BW - 0.1, BD - 0.1), new THREE.MeshPhysicalMaterial({ map: tex(topUrl), roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.28, normalMap: grain, normalScale: new THREE.Vector2(0.06, 0.06) }));
  top.rotation.x = -Math.PI / 2; top.position.set(BW / 2 - 0.15, TB / 2 + 0.002, 0); top.receiveShadow = true; pivot.add(top);
  // underside: half-turned in its own plane first, so it reads upright (edge at the spine) once the board is turned over
  const bot = new THREE.Mesh(new THREE.PlaneGeometry(BW - 0.1, BD - 0.1), new THREE.MeshPhysicalMaterial({ map: tex(bottomUrl), roughness: 0.6, normalMap: grain, normalScale: new THREE.Vector2(0.05, 0.05) }));
  bot.rotation.set(Math.PI / 2, 0, Math.PI); bot.position.set(BW / 2 - 0.15, -TB / 2 - 0.002, 0); bot.receiveShadow = true; pivot.add(bot);
  return { kind: 'board', g, pivot, t: TB, theta: 0, vel: 0, bend: 0, twist: 0, meshes: [core, top, bot] };
}

let leaves = [], built = false, n = 0, offset = 0, offV = 0; // n = how many leaves are turned to the left
const spineMat = clothMat.clone(); spineMat.side = THREE.DoubleSide; spineMat.shadowSide = THREE.FrontSide; spineMat.normalMap = null; // a strip this thin gets no weave texture (it only sparkled)
const spine = new THREE.Mesh(new THREE.BufferGeometry(), spineMat); spine.castShadow = true; book.add(spine);
let spineGeo = null;
export async function prepare() {
  if (built) return; built = true;
  const P = (k) => `${A}book/${String(k).padStart(2, '0')}.webp`;
  await Promise.all([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((k) => texAsync(P(k))));
  leaves = [makeBoard(P(1), P(2)), makeLeaf(P(3), P(4)), makeLeaf(P(5), P(6)), makeLeaf(P(7), P(8)), makeLeaf(P(9), P(10)), makeBoard(P(11), P(12))];
  for (const L of leaves) { book.add(L.g); L.meshes.forEach((m) => (m.userData.leaf = L)); }
  layoutHeights(); updateAll(0, true);
}

// stack heights: right stack (unturned) builds up from the back board; left stack from the front board
function heightOn(i, side) {
  let h = 0;
  if (side > 0) { for (let k = leaves.length - 1; k > i; k--) if (leaves[k].theta < Math.PI / 2) h += leaves[k].t + 0.012; }
  else { for (let k = 0; k < i; k++) if (leaves[k].theta >= Math.PI / 2) h += leaves[k].t + 0.012; }
  return h;
}
function layoutHeights() { for (let i = 0; i < leaves.length; i++) { const L = leaves[i]; L.hR = heightOn(i, 1); L.hL = heightOn(i, -1); } }

// ---------- Interaction ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1);
let tapT = 0;
let drag = null, hoverPeel = 0, hoverV = 0.5, hoverSide = 0, active = false;
function planePoint(e) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  const o = new THREE.Vector3(); if (!ray.ray.intersectPlane(plane, o)) return null; return book.worldToLocal(o);
}
const cv = renderer.domElement;
cv.addEventListener('pointerdown', (e) => {
  if (active) learn('book');
  if (!active || !built) return;
  sound.unlock();
  if (zoom.on) { zoomPointerDown(e); return; }
  const p = planePoint(e); if (!p || Math.abs(p.z) > BD / 2 + 3 || Math.abs(p.x) > BW + 3) return;
  const side = p.x >= 0 ? 1 : -1;
  const i = side > 0 ? n : n - 1;
  if (i < 0 || i >= leaves.length) return;
  const L = leaves[i];
  const s0 = clamp(Math.abs(p.x), W * 0.25, W);
  drag = { id: e.pointerId, L, i, side, s0, v0: clamp(p.z / D + 0.5, 0, 1), x0: e.clientX, y0: e.clientY, moved: 0, hist: [], t0: performance.now() };
  L.closeSound = false; // caught again on its way down
  cv.setPointerCapture(e.pointerId);
  sound.paper(0.25, 0.25);
});
cv.addEventListener('pointermove', (e) => {
  if (!active) return;
  const p = planePoint(e);
  if (!drag && zoom.on) return;
  if (!drag) { // hover near the outer edge of the top right page: its corner lifts a little, inviting a grab
    if (p && e.pointerType === 'mouse') { const inZ = Math.abs(p.z) < BD / 2 + 1, nearR = p.x > W * 0.62 && p.x < BW + 1 && inZ, nearL = p.x < -W * 0.62 && p.x > -BW - 1 && inZ; hoverSide = nearR ? 1 : nearL ? -1 : 0; hoverPeel = nearR ? clamp((p.x - W * 0.62) / (W * 0.38), 0, 1) : nearL ? clamp((-p.x - W * 0.62) / (W * 0.38), 0, 1) : 0; hoverV = clamp(p.z / D + 0.5, 0, 1); cv.style.cursor = nearR || nearL ? 'grab' : ''; }
    return;
  }
  if (e.pointerId !== drag.id || !p) return;
  drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0));
  // the grabbed point follows the hand horizontally: x = s0 * cos(theta)
  const th = Math.acos(clamp(p.x / drag.s0, -1, 1));
  drag.target = th;
  drag.hist.push({ t: performance.now(), th }); if (drag.hist.length > 8) drag.hist.shift();
});
cv.addEventListener('pointerup', (e) => { if (drag && e.pointerId === drag.id) release(); });
cv.addEventListener('pointercancel', () => { if (drag) release(); });
function release() {
  const d = drag; drag = null; const L = d.L;
  let vel = 0; if (d.hist.length > 1) { const a = d.hist[0], b = d.hist[d.hist.length - 1]; vel = (b.th - a.th) / Math.max(d.wheel ? 0.06 : 0.016, (b.t - a.t) / 1000); }
  if (d.moved < 8) { const dir = d.side > 0 ? 1 : -1; clearTimeout(tapT); tapT = setTimeout(() => turn(dir), 260); return; } // a tap turns, unless it is the first half of a double-click (zoom)
  const th = d.wheel ? (d.target ?? L.theta) : L.theta; // scrolling: go by where the fingers took it, not where the sheet has caught up to
  const goLeft = th + vel * 0.18 > Math.PI / 2;
  settleLeaf(d.i, goLeft, vel);
}
function settleLeaf(i, toLeft, vel = 0) {
  const L = leaves[i]; L.target = toLeft ? Math.PI : 0; L.vel = vel; L.free = true;
  const wasLeft = i < n;
  if (toLeft && !wasLeft) n = i + 1; if (!toLeft && wasLeft) n = i;
  // a cover swings on its board (opening the book is the front going left, or the back going right); a page turns,
  // and a flicked page whips over
  sound.paper(L.kind === 'board' ? 0.5 : 0.75, 0.45);
  if (L.kind === 'board' && (i === 0) !== toLeft) L.closeSound = true; // a closing cover settles as it meets the book (coverLands)
  L.landSound = true;
  syncUi();
}
export function turn(dir) {
  learn('book');
  if (!built) return;
  if (dir > 0 && n < leaves.length) { const L = leaves[n]; L.vel = 2.6; settleLeaf(n, true, 2.6); }
  if (dir < 0 && n > 0) { const L = leaves[n - 1]; settleLeaf(n - 1, false, -2.6); }
}
addEventListener('keydown', (e) => { if (!active) return; if (e.key === 'ArrowRight') turn(1); if (e.key === 'ArrowLeft') turn(-1); });

// ---------- Zooming in on a page ----------
// Scroll (or pinch) over the book, double-click a page, or press the magnifier: the camera moves to that one page and
// looks almost straight down on it, filling the screen. Scroll / pinch zooms 1x..3x toward the pointer, dragging pans
// (never past the page's edges), turning keeps you on the same side of the new spread. Esc, a double-click, or
// scrolling back out past 1x returns to the whole book.
const zoom = { on: false, side: 1, z: 1, zGoal: 1, pan: new THREE.Vector3(), drag: null, pinch: null };
const pageSideAt = (p) => (n === 0 ? 1 : n === leaves.length ? -1 : p && p.x < 0 ? -1 : 1);
function pageCentre(side) { return new THREE.Vector3(book.position.x + side * BW / 2, 0.6, 0); }
export const isZoomed = () => zoom.on;
function zoomIn(side, z = 1) { zoom.on = true; zoom.side = side; zoom.zGoal = Math.max(zoom.zGoal, z); if (!zoom.wasOn) { zoom.z = Math.min(zoom.z, 1); zoom.pan.set(0, 0, 0); } zoom.wasOn = true; hoverPeel = 0; cv.style.cursor = 'grab'; sound.play('slide', { vol: 0.14, rate: 0.9, gap: 120 }); syncZoomUi(); }
function zoomOut() { if (!zoom.on) return; zoom.on = false; zoom.wasOn = false; zoom.zGoal = 1; zoom.drag = null; cv.style.cursor = ''; sound.play('slide', { vol: 0.12, rate: 1.15, gap: 120 }); syncZoomUi(); }
function clampPan() {
  // an open spread: anywhere across both pages and the spine between them; a closed book: just the one page
  const k = 1 - 1 / zoom.z, hx = (BW / 2) * k, hz = (BD / 2) * k, spread = n > 0 && n < leaves.length;
  const lo = spread ? -BW / 2 - zoom.side * BW / 2 - hx : -hx, hi = spread ? BW / 2 - zoom.side * BW / 2 + hx : hx;
  zoom.pan.x = clamp(zoom.pan.x, lo, hi); zoom.pan.z = clamp(zoom.pan.z, -hz, hz);
}
// zoom by a factor toward a point on the page (world): that point stays under the pointer
function zoomBy(f, at) {
  const z0 = zoom.zGoal, z1 = clamp(z0 * f, 1, 3);
  if (at) { const c = pageCentre(zoom.side).add(zoom.pan); zoom.pan.addScaledVector(at.clone().sub(c).setY(0), 1 - z0 / z1); }
  zoom.zGoal = z1; zoom.z = z1; clampPan();
}
// the page camera when zoomed: how far it sits from the page, how steeply it looks down, and page units per pixel there
function zoomView() {
  const aspect = innerWidth / innerHeight, tn = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const fit = Math.max((BD / 2) / tn, (BW / 2) / (tn * aspect)) * 1.06, dist = fit / zoom.z;
  return { dist, elev: THREE.MathUtils.degToRad(80), upp: (2 * dist * tn) / innerHeight };
}
function worldAt(e) { ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); const o = new THREE.Vector3(); return ray.ray.intersectPlane(plane, o) ? o : null; }
addEventListener('wheel', (e) => {
  if (!active || !built) return;
  e.preventDefault(); sound.unlock();
  const d = (e.deltaMode === 1 ? 32 : 1) * e.deltaY * (e.ctrlKey ? 3 : 1); // ctrlKey: a trackpad pinch
  if (!zoom.on) { if (d < 0) { const p = planePoint(e); zoomIn(pageSideAt(p)); zoomBy(Math.exp(-d * 0.004), worldAt(e)); } return; }
  if (d > 0 && zoom.zGoal <= 1.001) { zoomOut(); return; }
  zoomBy(Math.exp(-d * 0.004), worldAt(e));
}, { passive: false });
cv.addEventListener('dblclick', (e) => {
  if (!active || !built) return;
  clearTimeout(tapT);
  if (zoom.on) { zoomOut(); return; }
  const p = planePoint(e); if (!p || Math.abs(p.z) > BD / 2 + 1 || Math.abs(p.x) > BW + 1) return;
  zoomIn(pageSideAt(p), 1.6); zoomBy(1, worldAt(e));
});
addEventListener('keydown', (e) => { if (active && e.key === 'Escape' && zoom.on) zoomOut(); });
// while zoomed, a drag pans (two fingers pinch)
const touches = new Map();
function zoomPointerDown(e) {
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2) { const [a, b] = [...touches.values()]; zoom.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; zoom.drag = null; return true; }
  zoom.drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; return true;
}
cv.addEventListener('pointermove', (e) => {
  if (!zoom.on) return;
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (zoom.pinch && touches.size === 2) { const [a, b] = [...touches.values()], d = Math.hypot(a.x - b.x, a.y - b.y); zoomBy(d / zoom.pinch.d, worldAt({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 })); zoom.pinch.d = d; return; }
  if (!zoom.drag) return;
  // the page follows the hand exactly: the pointer's move on screen, in page units at the distance the camera is
  // settling to. (Measuring it against the moving camera instead fed the camera's own lag back in, and the page
  // shuddered as it caught up.)
  const dx = e.clientX - zoom.drag.x, dy = e.clientY - zoom.drag.y; zoom.drag.x = e.clientX; zoom.drag.y = e.clientY;
  const { upp, elev } = zoomView();
  zoom.pan.x -= dx * upp; zoom.pan.z -= (dy * upp) / Math.sin(elev); clampPan();
});
const endZoomDrag = (e) => { touches.delete(e.pointerId); if (touches.size < 2) zoom.pinch = null; if (zoom.drag) { zoom.drag = null; if (zoom.on) cv.style.cursor = 'grab'; } };
cv.addEventListener('pointerup', endZoomDrag); cv.addEventListener('pointercancel', endZoomDrag);
function syncZoomUi() { const b = document.getElementById('bk-zoom'); if (b) { b.classList.toggle('on', zoom.on); b.setAttribute('aria-pressed', zoom.on ? 'true' : 'false'); b.title = zoom.on ? 'Zoom out' : 'Zoom in on the page'; } }
export function zoomed() { return zoom.on; }

// ---------- UI ----------
const ui = {};
function syncUi() {
  if (!ui.label) { ui.label = document.getElementById('bk-label'); ui.prev = document.getElementById('bk-prev'); ui.next = document.getElementById('bk-next'); ui.prev.onclick = () => turn(-1); ui.next.onclick = () => turn(1);
    // the magnifier: in on the page (the left one of an open spread, where reading starts), out again on a second press
    document.getElementById('bk-zoom').onclick = () => { sound.unlock(); learn('book'); if (zoom.on) zoomOut(); else zoomIn(n === 0 ? 1 : n === leaves.length ? -1 : -1, 1.6); };
  }
  const names = ['Front cover', 'Pages 1–2', 'Pages 3–4', 'Pages 5–6', 'Pages 7–8', 'About the author', 'Back cover'];
  ui.label.textContent = names[n];
  ui.prev.disabled = n === 0; ui.next.disabled = n === leaves.length;
}

// ---------- Contacts ----------
// Sheets keep their order: a faster sheet catches up with the one ahead and carries it along (momentum is shared,
// a board weighs more than paper); a sheet in the hand pushes whatever it meets.
const massOf = (L) => (L.kind === 'board' ? 4 : 1);
function resolveContacts() {
  if (closing) return;
  let changed = false;
  for (let pass = 0; pass < 4; pass++) for (let k = 1; k < leaves.length; k++) {
    const A = leaves[k - 1], B = leaves[k];
    if (B.theta <= A.theta) continue;
    const aHeld = drag && drag.L === A, bHeld = drag && drag.L === B;
    if (aHeld && bHeld) continue;
    if (bHeld) { A.theta = B.theta; carry(A, B.vel); }
    else if (aHeld) { B.theta = A.theta; carry(B, A.vel); }
    else {
      const ma = massOf(A), mb = massOf(B), th = (A.theta * ma + B.theta * mb) / (ma + mb), v = (A.vel * ma + B.vel * mb) / (ma + mb);
      A.theta = B.theta = th; carry(A, v); carry(B, v);
    }
    changed = true;
  }
  if (changed) { // which side each sheet is heading for decides the page count
    const m = leaves.filter((L) => (drag && drag.L === L ? L.theta > Math.PI / 2 : L.free ? L.target === Math.PI : L.theta > Math.PI / 2)).length;
    if (m !== n) { n = m; syncUi(); }
  }
}
function carry(L, v) {
  L.vel = v; L.free = true;
  L.target = Math.abs(v) > 0.3 ? (v > 0 ? Math.PI : 0) : (L.theta > Math.PI / 2 ? Math.PI : 0);
}

// ---------- Frame ----------
let tm = 0, closing = null;
function updateAll(dt, force) {
  layoutHeights();
  for (let i = 0; i < leaves.length; i++) {
    const L = leaves[i];
    if (drag && drag.L === L) {
      const tgt = drag.target ?? L.theta;
      const prev = L.theta; L.theta = lerp(L.theta, tgt, 1 - Math.exp(-dt * 11)); L.vel = (L.theta - prev) / Math.max(dt, 1e-3);
      // held by the hand: the edge leads a little and the held corner twists the sheet
      const lead = L.kind === 'leaf' ? 0.85 * Math.sin(L.theta) * (drag.side > 0 ? 1 : -1) : 0;
      L.bend = lerp(L.bend, lead, 1 - Math.exp(-dt * 7));
      // the corner in the hand rises first: held at the top, the top lifts; held at the bottom, the bottom does
      L.twist = lerp(L.twist, L.kind === 'leaf' ? (drag.v0 - 0.5) * 1.3 * Math.sin(L.theta) * (drag.side > 0 ? 1 : -1) : 0, 1 - Math.exp(-dt * 10));
    } else if (L.free) {
      // free swing: a spring toward the side it was sent to; the edge trails the motion (air drag)
      const k = L.kind === 'board' ? 60 : 38, c = L.kind === 'board' ? 12 : 8.5;
      const acc = (L.target - L.theta) * k - L.vel * c;
      L.vel += acc * dt; L.theta += L.vel * dt;
      if (L.theta < 0) { L.theta = 0; L.vel *= -0.15; } if (L.theta > Math.PI) { L.theta = Math.PI; L.vel *= -0.15; }
      if (L.closeSound && Math.abs(L.target - L.theta) < 0.05) coverLands(L);
      // paper flexes: the free edge trails well behind a fast turn and only slowly relaxes flat
      const trail = L.kind === 'leaf' ? clamp(-L.vel * 0.2, -1.45, 1.45) : 0;
      L.bend = lerp(L.bend, trail, 1 - Math.exp(-dt * 6.5)); L.twist *= Math.exp(-dt * 3.5);
      if (Math.abs(L.target - L.theta) < 0.002 && Math.abs(L.vel) < 0.02 && Math.abs(L.bend) < 0.01) { L.theta = L.target; L.vel = 0; L.free = false; L.bend = 0; L.twist = 0; if (L.landSound) { L.landSound = false; if (L.closeSound) coverLands(L); else sound.play('place', { vol: L.kind === 'board' ? 0.35 : 0.12, rate: 0.8 }); if (L === leaves[leaves.length - 1] && L.target > 1) closedPuff(); } }
    } else if (i === n - 1 && L.kind === 'leaf' && !drag) {
      // hover peel on the left page (to turn back): the corner under the pointer lifts off the left stack
      const pk = hoverSide < 0 ? hoverPeel : 0, target = Math.PI - pk * 0.09;
      L.theta = lerp(L.theta, target, 1 - Math.exp(-dt * 7)); L.twist = lerp(L.twist, -pk * (hoverV - 0.5) * 0.5, 1 - Math.exp(-dt * 10)); L.bend = lerp(L.bend, -pk * 0.12, 1 - Math.exp(-dt * 10));
    } else if (i === n && L.kind === 'leaf' && !drag) {
      // hover peel on the next page to turn
      const target = (hoverSide > 0 ? hoverPeel : 0) * 0.09;
      L.theta = lerp(L.theta, target, 1 - Math.exp(-dt * 7)); L.twist = lerp(L.twist, (hoverSide > 0 ? hoverPeel : 0) * (hoverV - 0.5) * 0.5, 1 - Math.exp(-dt * 10)); L.bend = lerp(L.bend, (hoverSide > 0 ? hoverPeel : 0) * 0.12, 1 - Math.exp(-dt * 10));
    }
  }
  resolveContacts();
  layoutHeights();
  const ys = leaves.map((L) => lerp(L.hR, L.hL, clamp(L.theta / Math.PI, 0, 1)) + L.t / 2);
  leaves.forEach(computeField);
  separate(ys);
  leaves.forEach((L, i) => {
    if (L.kind === 'leaf') shapeLeaf(L);
    else { L.g.position.set(0, ys[i], 0); L.pivot.rotation.z = L.theta; }
  });
  // spine cloth: a half-round strip joining the outer hinge edges of the two boards, bowed away from the pages
  const fb = leaves[0], bb = leaves[leaves.length - 1];
  const edge = (B, face) => { const c = Math.cos(B.theta), sn = Math.sin(B.theta), lx = -0.15, ly = face * B.t / 2; return new THREE.Vector2(lx * c - ly * sn, B.g.position.y + lx * sn + ly * c); };
  const P0 = edge(bb, -1), P1 = edge(fb, 1), mid = P0.clone().add(P1).multiplyScalar(0.5), chord = P1.clone().sub(P0), len = chord.length();
  // direction the pages run (average of the two boards), and its opposite is where the spine bows
  const run = new THREE.Vector2(Math.cos(fb.theta) + Math.cos(bb.theta), Math.sin(fb.theta) + Math.sin(bb.theta));
  let out = new THREE.Vector2(-chord.y, chord.x).normalize(); if (len < 1e-4) out.set(0, -1);
  if (run.lengthSq() > 1e-4 ? out.dot(run) > 0 : out.y > 0) out.negate();
  spine.visible = len > 0.05;
  if (spine.visible) {
    // one surface (drawn from both sides by the material) with normals worked out exactly, so its shading is smooth
    // and steady; a bow that would dip below the table is flattened onto it instead
    const segs = 24, r = len / 2, dir = chord.clone().normalize();
    let bow = Math.min(r, 0.6) * 0.9;
    if (out.y < -0.05) bow = Math.min(bow, Math.max(0, (Math.min(P0.y, P1.y) - 0.004) / -out.y));
    if (!spineGeo) {
      spineGeo = new THREE.BufferGeometry(); const I = [];
      for (let i = 0; i < segs; i++) { const a = i, b = i + 1, c = i + segs + 1, d = c + 1; I.push(a, c, b, b, c, d); }
      spineGeo.setIndex(I);
      spineGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((segs + 1) * 2 * 3), 3));
      spineGeo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array((segs + 1) * 2 * 3), 3));
      spineGeo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((segs + 1) * 2 * 2), 2));
      spine.geometry.dispose(); spine.geometry = spineGeo;
    }
    const P = spineGeo.attributes.position.array, N = spineGeo.attributes.normal.array, U = spineGeo.attributes.uv.array;
    for (let j = 0; j <= 1; j++) for (let i = 0; i <= segs; i++) {
      const a = Math.PI * (i / segs), along = -Math.cos(a) * r, off = Math.sin(a) * bow, k = (j * (segs + 1) + i);
      P[k * 3] = mid.x + dir.x * along + out.x * off; P[k * 3 + 1] = mid.y + dir.y * along + out.y * off; P[k * 3 + 2] = (j - 0.5) * BD;
      // outward normal of the half-ellipse (along = -r cos a, off = bow sin a): the tangent turned a quarter
      const tx = r * Math.sin(a), ty = bow * Math.cos(a), tl = Math.hypot(tx, ty) || 1; // tangent in (dir, out)
      const na = -ty / tl, no = tx / tl; // rotate the tangent: points away from the chord's centre
      N[k * 3] = dir.x * na + out.x * no; N[k * 3 + 1] = dir.y * na + out.y * no; N[k * 3 + 2] = 0;
      U[k * 2] = i / segs; U[k * 2 + 1] = j;
    }
    spineGeo.attributes.position.needsUpdate = true; spineGeo.attributes.normal.needsUpdate = true; spineGeo.attributes.uv.needsUpdate = true;
    spineGeo.computeBoundingSphere();
  }
}

function frameCamera() {
  const aspect = innerWidth / innerHeight, portrait = aspect < 1;
  const spanW = portrait ? BW * 1.12 : BW * 2.18, spanH = BD * (portrait ? 2.1 : 1.45);
  const vf = THREE.MathUtils.degToRad(camera.fov);
  const dist = Math.max((spanH / 2) / Math.tan(vf / 2), (spanW / 2) / (Math.tan(vf / 2) * aspect));
  const elev = THREE.MathUtils.degToRad(portrait ? 64 : 56);
  camGoal.set(0, Math.sin(elev) * dist, Math.cos(elev) * dist + 1.5);
}
const camGoal = new THREE.Vector3(0, 60, 40), camPos = new THREE.Vector3(0, 70, 55);
export function enter() { active = true; closing = null; frameCamera(); syncUi(); hand.release(); }
// ---------- Hand-off with the home table: the cover is the shared object ----------
const hand = handCam(camera);
function snapClosed() {
  for (const L of leaves) { L.theta = 0; L.target = 0; L.vel = 0; L.free = false; L.bend = 0; L.twist = 0; L.landSound = false; }
  n = 0; offset = -BW / 2; book.position.x = offset; if (built && leaves.length) updateAll(1 / 60, true); syncUi();
}
// leave for home: the whole book closes in one movement from wherever it is open, while the app flies the camera
// back to the wide view. closeTo(e) is driven with the same easing as the camera, e from 0 to 1.
export function beginClose() {
  zoom.on = false; zoom.wasOn = false; zoom.z = zoom.zGoal = 1; syncZoomUi();
  active = false; cv.style.cursor = ''; if (drag) { drag = null; }
  closing = { th: leaves.map((L) => L.theta), off: offset };
  for (const L of leaves) { L.free = false; L.vel = 0; L.landSound = false; }
  hoverPeel = 0;
}
export function closeTo(e) {
  if (!closing) return;
  const k = 1 - e;
  leaves.forEach((L, i) => { L.theta = closing.th[i] * k; L.bend *= k; L.twist *= k; L.target = 0; });
  offset = lerp(closing.off, -BW / 2, e); book.position.x = offset;
  if (e >= 1) { n = 0; syncUi(); }
}
export function endClose() { closing = null; n = 0; }
// where the closed book's cover sits (top centre), without having to close it first
export function anchorClosed() { const H = 2 * TB + 4 * TL + 5 * 0.012; return { pos: new THREE.Vector3(-0.15 - H / 4, H, 0), yaw: 0, size: BW }; }
export function drive(pose) { hand.drive(pose); }
// ---------- On the home table ----------
// The storybook on the home table IS this book (drawn by this scene, seen through the home camera), so going in or
// out is one camera move with nothing swapped. companion() puts it in its home state: shut and not interactive.
export function companion() { active = false; closing = null; drag = null; if (n !== 0 || offset !== -BW / 2) snapClosed(); }
// the reading view the camera settles on when the book is opened from home
export function homePose() {
  frameCamera(); camTarget.set(0, 0, 0); camPos.copy(camGoal);
  return { pos: camPos.clone(), look: new THREE.Vector3(0, 0, 0.5) };
}
export function enterDone() { active = true; closing = null; hand.release(); syncUi(); }
export function leave() { active = false; cv.style.cursor = ''; if (drag) release(); zoom.on = false; zoom.wasOn = false; zoom.z = zoom.zGoal = 1; syncZoomUi(); }
export function resize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); frameCamera(); }
export function exposure(dark) { return dark ? 1.08 : 1.05; }
export function setTheme(t) {
  env = envFor(t); scene.environment = env;
  const dark = t === 'dark';
  table.visible = false; catcher.visible = true; catcher.material.color.set(dark ? 0x000000 : 0x5a4632); catcher.material.opacity = dark ? 0.55 : 0.22; // no table top: the pieces cast soft shadows straight onto the scene behind
  hemi.intensity = dark ? 0.3 : 0.95; hemi.groundColor.set(dark ? 0x161514 : 0xc9bfb0);
  key.intensity = dark ? 2.0 : 2.3; key.color.set(dark ? 0xfff5ec : 0xfffaf2);
}
export function update(dt) {
  tm += dt;
  if (built) updateAll(Math.min(dt, 1 / 30));
  if (built && active) stirSnow();
  // keep whatever is open centred: a closed book sits where its cover is; an open book centres on the spine
  const portrait = innerWidth / innerHeight < 1;
  let target = 0;
  if (n === 0) target = -BW / 2; else if (n === leaves.length) target = BW / 2;
  else if (portrait) target = -BW / 2 * 0; // portrait shows the spread zoomed; see camera
  if (!closing) { offset = offset + (target - offset) * (1 - Math.exp(-dt * 3)); book.position.x = offset; }
  // portrait phones: frame the page you're reading (right page when opening, left when going back)
  if (portrait && n > 0 && n < leaves.length) { const focus = drag ? (drag.side > 0 ? BW / 2 : -BW / 2) : lastFocus; lastFocus = focus; camTarget.x = lerp(camTarget.x, focus * 0.5, 1 - Math.exp(-dt * 3)); }
  else camTarget.x = lerp(camTarget.x, 0, 1 - Math.exp(-dt * 3));
  // the page camera: almost straight down onto one page, the page filling the view at 1x
  if (zoom.on) {
    const one = n === 0 ? 1 : n === leaves.length ? -1 : 0; // a closed book: only one page to look at
    if (one && one !== zoom.side) { zoom.pan.x += (zoom.side - one) * BW / 2; zoom.side = one; } // same spot, measured from the other page
    clampPan();
    const { dist, elev } = zoomView();
    const c = pageCentre(zoom.side).add(zoom.pan);
    camLookGoal.copy(c); camPosGoal.set(c.x, c.y + Math.sin(elev) * dist, c.z + Math.cos(elev) * dist);
  } else { camLookGoal.set(camTarget.x, 0, 0.5); camPosGoal.copy(camGoal).add(new THREE.Vector3(camTarget.x, 0, 0)); }
  const kz = 1 - Math.exp(-dt * (zoom.on ? (zoom.drag ? 14 : 6) : 2.3)); // held: it keeps right up with the hand
  camPos.lerp(camPosGoal, kz); camLook.lerp(camLookGoal, kz);
  hand.place(camPos, camLook, dt);
  return true;
}
// a cover meets the book: a soft, heavy close, louder the faster it came down
function coverLands(L) { L.closeSound = false; sound.play('place', { vol: 0.35, rate: 0.8 }); }
// the story's done: the back cover comes down and a soft puff of snow lifts off the book (quietly: no chime)
function closedPuff() {
  if (!active) return;
  const bb = new THREE.Box3().setFromObject(book), r = { left: 1e9, top: 1e9, right: -1e9, bottom: -1e9 };
  for (const x of [bb.min.x, bb.max.x]) for (const z of [bb.min.z, bb.max.z]) {
    _e.set(x, bb.max.y, z).project(camera);
    const sx = (_e.x * 0.5 + 0.5) * innerWidth, sy = (-_e.y * 0.5 + 0.5) * innerHeight;
    r.left = Math.min(r.left, sx); r.right = Math.max(r.right, sx); r.top = Math.min(r.top, sy); r.bottom = Math.max(r.bottom, sy);
  }
  r.width = r.right - r.left; r.height = r.bottom - r.top;
  backdrop.puff(r, 22);
}
// a turning page moves the air: its free edge drags the snow and sheds swirls, like the pointer does
const _e = new THREE.Vector3();
function stirSnow() {
  leaves.forEach((L, i) => {
    if (Math.abs(L.vel || 0) < 0.6) return; // pages and covers alike
    _e.set(Math.cos(L.theta) * W, (L.g ? L.g.position.y : 0) + Math.sin(L.theta) * W, 0); book.localToWorld(_e); _e.project(camera);
    backdrop.stir('page' + i, (_e.x * 0.5 + 0.5) * innerWidth, (-_e.y * 0.5 + 0.5) * innerHeight, 1.2);
  });
}
let lastFocus = BW / 2; const camTarget = new THREE.Vector3(), camPosGoal = new THREE.Vector3(), camLookGoal = new THREE.Vector3(), camLook = new THREE.Vector3(0, 0, 0.5);
