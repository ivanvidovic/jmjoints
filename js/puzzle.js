// 100 Piece Puzzle: pieces cut from the real die-line, extruded to 2mm board.
// Pour them from the box lid, drag them home (they straighten as you lift them), click into place when close.
import * as THREE from 'three';
import { envFor, tex, texAsync, grain, clamp, lerp, renderer, isTouch, handCam } from './core.js';
import { confirmTap, hint, learn } from './ui.js';
import * as sound from './sound.js';
import { artBox } from './home.js';

const A = 'assets/';
const T = 0.2;               // board thickness (cm)
export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 2, 800);
let env = envFor(document.documentElement.dataset.theme);
scene.environment = env;
const hemi = new THREE.HemisphereLight(0xfff4e6, 0x1a1a2a, 0.35); scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff5ec, 2.2);
key.position.set(-20, 60, 30); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 5, far: 160 });
key.shadow.radius = 3; key.shadow.bias = -0.0002; key.shadow.normalBias = 0.01;
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

let data, built = false, pieces = [], BW = 25.4, BH = 20.32;
const world = new THREE.Group(); scene.add(world); // board + pieces: slides in and out as one table
const board = new THREE.Group(); world.add(board);
let artMat, backMat, sideMat, guide, lid, matMesh, lidH = 1, lidW = 17.59, lidD = 12.89;
let portrait = innerWidth / innerHeight < 1;

// ---------- Geometry: extrude a piece outline; front cap gets the art, back is grey board, sides raw board ----------
function pieceGeometry(p) {
  const s = new THREE.Shape(p.pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const bev = 0.018;
  const ex = new THREE.ExtrudeGeometry(s, { depth: T - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev * 0.8, bevelSegments: 1, curveSegments: 1 });
  ex.translate(0, 0, -(T - 2 * bev) / 2);
  const pos = ex.attributes.position, nrm = ex.attributes.normal;
  const buckets = [[], [], []];
  for (let i = 0; i < pos.count / 3; i++) {
    let nz = 0, zmin = Infinity, zmax = -Infinity;
    for (let k = 0; k < 3; k++) { nz += nrm.getZ(i * 3 + k); const z = pos.getZ(i * 3 + k); zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
    const flat = zmax - zmin < 1e-5;
    buckets[flat && nz > 0 ? 0 : flat && nz < 0 ? 1 : 2].push(i);
  }
  const P = [], N = [], U = [], g = new THREE.BufferGeometry(); let start = 0;
  buckets.forEach((list, gi) => {
    for (const i of list) for (let k = 0; k < 3; k++) {
      const v = i * 3 + k, x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
      P.push(x, y, z); N.push(nrm.getX(v), nrm.getY(v), nrm.getZ(v));
      // art coordinates: slot centre + local offset, over the whole 10x8in image
      U.push((p.x + x) / BW + 0.5, 0.5 - (p.z - y) / BH);
    }
    g.addGroup(start, list.length * 3, gi); start += list.length * 3;
  });
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.rotateX(-Math.PI / 2); // lie flat: art up, image top toward the far side
  g.computeBoundingSphere(); ex.dispose();
  return g;
}

export async function prepare(man) {
  if (built) return; built = true;
  data = await (await fetch(`${A}puzzle/pieces.json`)).json();
  BW = data.w; BH = data.h;
  const art = await texAsync(`${A}puzzle/art.webp`);
  artMat = new THREE.MeshPhysicalMaterial({ map: art, roughness: 0.55, clearcoat: 0.2, clearcoatRoughness: 0.45, normalMap: grain, normalScale: new THREE.Vector2(0.07, 0.07) });
  backMat = new THREE.MeshStandardMaterial({ color: 0x8e96a3, roughness: 0.9, normalMap: grain, normalScale: new THREE.Vector2(0.3, 0.3) });
  sideMat = new THREE.MeshStandardMaterial({ color: 0xd9ccb4, roughness: 0.92 });
  // board: a soft recessed mat with a ghost of the picture
  matMesh = new THREE.Mesh(new THREE.BoxGeometry(BW + 1.2, 0.12, BH + 1.2), new THREE.MeshStandardMaterial({ color: 0x100e0c, roughness: 0.95 }));
  const mat = matMesh; matMesh.material.color.set(document.documentElement.dataset.theme === 'dark' ? 0x100e0c : 0xcfc7b8);
  mat.position.y = -0.06; mat.receiveShadow = true; board.add(mat);
  guide = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), new THREE.MeshBasicMaterial({ map: art, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  guide.rotation.x = -Math.PI / 2; guide.position.y = 0.002; board.add(guide);
  // the box lid sits beside the board as the picture to work from
  lid = new THREE.Group();
  // the very same box as on the home table, so the hand-off between the two scenes is seamless
  const B = man.boxes.puz; lidH = B.d + 0.15; lidW = B.w; lidD = B.h;
  lid.add(artBox({ w: B.w, h: B.h, d: lidH, wallH: B.d, top: A + 'boxes/puz_top.webp', n: A + 'boxes/puz_n.webp', s: A + 'boxes/puz_s.webp', e: A + 'boxes/puz_e.webp', wst: A + 'boxes/puz_w.webp', base: true }));
  scene.add(lid);
  for (const p of data.pieces) {
    const mesh = new THREE.Mesh(pieceGeometry(p), [artMat, backMat, sideMat]);
    mesh.castShadow = true; mesh.receiveShadow = true; world.add(mesh);
    const pc = { p, mesh, id: p.r * 10 + p.c, edge: p.r === 0 || p.r === 9 || p.c === 0 || p.c === 9, placed: false, pos: new THREE.Vector3(), yaw: 0, anim: null, home: new THREE.Vector3(p.x, T / 2, p.z) };
    mesh.userData.pc = pc; pieces.push(pc);
  }
  layout();
  if (!restore()) { pendingPour = true; for (const pc of pieces) pc.mesh.visible = false; }
  syncHud();
}

// ---------- Layout: board, lid, and the loose-piece area around them ----------
let area = { x0: -40, x1: 40, z0: -26, z1: 26 };
function layout() {
  portrait = innerWidth / innerHeight < 1;
  if (portrait) { board.position.set(0, 0, -12); lid.position.set(0, 0, -36); lid.visible = false; area = { x0: -15.5, x1: 15.5, z0: 1.5, z1: 30 }; }
  else { board.position.set(-6, 0, 0); lid.position.set(22, 0, -8.5); lid.rotation.y = -0.06; lid.visible = true; area = { x0: -34, x1: 30, z0: -18, z1: 18 }; }
  for (const pc of pieces) { pc.home.set(board.position.x + pc.p.x, T / 2, board.position.z + pc.p.z); if (pc.placed && !pc.anim) placeMesh(pc, pc.home, 0); }
  frameCamera();
}
const REACH = 3.9; // a piece plus its knobs: centres closer than this would overlap
function inBlocked(x, z) {
  const onBoard = Math.abs(x - board.position.x) < BW / 2 + 2.4 && Math.abs(z - board.position.z) < BH / 2 + 2.4;
  // the box, plus a margin, plus the strip behind it that its height hides from the camera: pieces never land
  // where the player can't see them
  const dz = z - lid.position.z, hd = lidD / 2, hidden = lidH / Math.tan(ELEV) + 1.5;
  const onLid = lid.visible && Math.abs(x - lid.position.x) < lidW / 2 + 2.5 && dz > -hd - 2.5 - hidden && dz < hd + 2.5;
  return onBoard || onLid;
}
// pick a free spot: first try somewhere with clear space; otherwise the least crowded place (it will stack)
function freeSpot(taken = [], avoid = null) {
  let best = null, bestD = -1;
  for (let tries = 0; tries < 140; tries++) {
    const x = lerp(area.x0, area.x1, Math.random()), z = lerp(area.z0, area.z1, Math.random());
    if (inBlocked(x, z) || (avoid && avoid(new THREE.Vector3(x, 0, z)))) continue;
    let dmin = Infinity;
    for (const q of taken) dmin = Math.min(dmin, Math.hypot(q.x - x, q.z - z));
    if (dmin >= REACH) return new THREE.Vector3(x, 0, z);
    if (dmin > bestD) { bestD = dmin; best = new THREE.Vector3(x, 0, z); }
  }
  return best || new THREE.Vector3(area.x1, 0, area.z1);
}
function restingSpots(except) { return pieces.filter((o) => o !== except && o !== held && !o.anim).map((o) => o.mesh.position); }
// height a piece lands at: on top of anything (loose or placed) whose footprint it would overlap
function heightAt(x, z, self, planned = [], onlyPlanned = false) {
  // the box is solid: anything set down over it rests on its lid (its footprint plus a piece's reach)
  let h = lid && lid.visible && Math.abs(x - lid.position.x) < lidW / 2 + 1.6 && Math.abs(z - lid.position.z) < lidD / 2 + 1.6 ? lidH : 0;
  if (!onlyPlanned) for (const o of pieces) {
    if (o === self || o === held || o.anim) continue;
    const p = o.mesh.position, dx = p.x - x, dz = p.z - z;
    if (dx * dx + dz * dz < REACH * REACH) h = Math.max(h, p.y + T / 2);
  }
  for (const q of planned) { const dx = q.x - x, dz = q.z - z; if (dx * dx + dz * dz < REACH * REACH) h = Math.max(h, q.y + T / 2); }
  return h;
}
// lifting a piece: whatever was resting on it settles down onto what's beneath
function settleAbove(pc) {
  const p = pc.mesh.position;
  pieces.filter((o) => o !== pc && !o.placed && !o.anim && o.mesh.position.y > p.y + 0.01 && Math.hypot(o.mesh.position.x - p.x, o.mesh.position.z - p.z) < REACH)
    .sort((a, b) => a.mesh.position.y - b.mesh.position.y)
    .forEach((o) => { const to = o.mesh.position.clone(); to.y = heightAt(to.x, to.z, o) + T / 2; animate(o, { to, yaw: o.yaw, dur: 0.18, arc: 0 }); o.restY = undefined; });
}
function placeMesh(pc, p, yaw) { pc.mesh.position.copy(p); pc.mesh.rotation.set(0, yaw, 0); pc.yaw = yaw; }

// ---------- Pour from the box ----------
function pour() {
  // the pieces burst out of the top of the box, one after another, and scatter across the table
  const from = lid.visible ? lid.position.clone().add(new THREE.Vector3(0, lidH + 0.3, 0)) : new THREE.Vector3(0, 6, 34);
  sound.play('shove', { vol: 0.5 });
  const planned = [];
  shuffle(pieces.slice()).forEach((pc, k) => {
    pc.placed = false;
    const spot = freeSpot(planned);
    spot.y = heightAt(spot.x, spot.z, pc, planned, true) + T / 2; planned.push(spot.clone());
    pc.mesh.position.copy(from).add(new THREE.Vector3((Math.random() - 0.5) * lidW * 0.5, 0, (Math.random() - 0.5) * lidD * 0.5));
    pc.mesh.visible = false; // appears as it leaves the box
    animate(pc, { to: spot, yaw: (Math.random() - 0.5) * 1.2, dur: 0.8, delay: k * 0.012, arc: 3 + Math.random() * 2.5, tumble: false, done: () => { if (k % 4 === 0) sound.play('chipLay', { vol: 0.12, rate: 1.1, gap: 30 }); } });
  });
  save();
}
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
function animate(pc, { to, yaw = 0, dur = 0.5, delay = 0, arc = 2, tumble = false, done }) {
  pc.anim = { from: pc.mesh.position.clone(), fromYaw: pc.mesh.rotation.y, to: to.clone(), toYaw: yaw, dur, t: -delay, arc, tumble, done, spin: (Math.random() - 0.5) * 6 };
}


// ---------- Tools ----------
function sortEdges() {
  // bring every loose edge piece out to the nearest open margin, in a tidy band
  const loose = pieces.filter((pc) => !pc.placed && pc.edge);
  // move whatever is lying in the sorting area out of the way first
  const step = 3.9;
  const slots = [];
  if (portrait) { for (let r = 0; r < 6; r++) for (let c = 0; c < 8; c++) slots.push(new THREE.Vector3(area.x0 + 1.5 + c * step, 0, area.z0 + 1.8 + r * step)); }
  else { const x1 = board.position.x - BW / 2 - 3; for (let r = 0; r < 9; r++) for (let c = 0; c < 4; c++) slots.push(new THREE.Vector3(x1 - c * step, 0, board.position.z - BH / 2 - 3 + r * step)); }
  const zone = (v) => slots.some((s) => Math.abs(v.x - s.x) < step && Math.abs(v.z - s.z) < step);
  const planned = pieces.filter((pc) => !pc.placed && !pc.edge && !zone(pc.mesh.position)).map((pc) => pc.mesh.position.clone());
  pieces.filter((pc) => !pc.placed && !pc.edge && zone(pc.mesh.position)).forEach((pc, k) => { const to = freeSpot(planned, zone); to.y = heightAt(to.x, to.z, pc, planned) + T / 2; planned.push(to.clone()); animate(pc, { to, yaw: pc.yaw, dur: 0.5, delay: k * 0.01, arc: 2.5 + k * 0.05 }); });
  loose.forEach((pc, k) => {
    const to = slots[k % slots.length].clone(); to.y = T / 2 + Math.floor(k / slots.length) * T;
    animate(pc, { to, yaw: 0, dur: 0.55, delay: 0.25 + k * 0.02, arc: 3 + k * 0.05 });
  });
  sound.play('shove', { vol: 0.4 }); save();
}
let guideOn = false;
function toggleGuide() { guideOn = !guideOn; syncHud(); }
function restart() {
  for (const pc of pieces) pc.placed = false;
  try { localStorage.removeItem('jm-puzzle'); } catch (e) {}
  done = false; startedAt = 0; pour(); syncHud();
}

// ---------- Persistence ----------
let saveT = 0, startedAt = 0, done = false;
function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem('jm-puzzle', JSON.stringify({ v: 2, t: startedAt ? Date.now() - startedAt : 0, p: pieces.map((pc) => { if (pc.placed) return 1; const at = pc.anim ? pc.anim.to : pc.mesh.position.clone().setX(pc.mesh.position.x - (pc._sdx || 0)), yaw = pc.anim ? pc.anim.toYaw : pc.yaw; return [+(at.x - board.position.x).toFixed(2), +(at.z - board.position.z).toFixed(2), +yaw.toFixed(2)]; }) })); } catch (e) {} }, 300); } // pieces in flight are saved where they will land, never mid-air
function restore() {
  let s; try { s = JSON.parse(localStorage.getItem('jm-puzzle') || 'null'); } catch (e) {}
  if (!s || s.v !== 2 || !s.p || s.p.length !== pieces.length) return false; // v1 saves could hold the pour mid-flight (a pile at the box)
  const loose = s.p.filter((v) => v !== 1), cells = new Set(loose.map((v) => `${Math.round(v[0] / 2)},${Math.round(v[1] / 2)}`));
  if (loose.length > 12 && cells.size < loose.length * 0.4) return false; // a heap, not a table: start fresh
  const restored = [];
  pieces.forEach((pc, i) => {
    const v = s.p[i];
    if (v === 1) { pc.placed = true; placeMesh(pc, pc.home, 0); }
    else { const p = new THREE.Vector3(board.position.x + v[0], 0, board.position.z + v[1]); p.y = heightAt(p.x, p.z, pc, restored, true) + T / 2; restored.push(p.clone()); placeMesh(pc, p, v[2]); pc.mesh.position.y = -100; }
  });
  // second pass: real positions (heights were computed against each other, not against the hidden ones)
  let ri = 0; pieces.forEach((pc, i) => { if (s.p[i] !== 1) pc.mesh.position.copy(restored[ri++]); });
  startedAt = s.t ? Date.now() - s.t : 0;
  done = pieces.every((pc) => pc.placed);
  return true;
}

// ---------- HUD ----------
const hud = {};
function syncHud() {
  if (!hud.count) {
    hint(document.querySelector('#view-puzzle .view-hint'), 'puzzle');
    hud.count = document.getElementById('pz-count'); hud.guide = document.getElementById('pz-guide'); hud.done = document.getElementById('pz-done');
    document.getElementById('pz-edges').onclick = () => { sound.unlock(); sortEdges(); };
    hud.guide.onclick = () => { sound.unlock(); toggleGuide(); };
    confirmTap(document.getElementById('pz-restart'), () => !done && pieces.some((pc) => pc.placed), () => { sound.unlock(); restart(); });
    document.getElementById('pz-fit').onclick = () => fit();
    document.getElementById('pz-again').onclick = () => { sound.unlock(); restart(); };
  }
  const n = pieces.filter((pc) => pc.placed).length;
  hud.count.textContent = `${n} / ${pieces.length}`;
  hud.guide.setAttribute('aria-pressed', String(guideOn));
  hud.done.classList.toggle('on', done);
}

// ---------- Camera: always on the table, follows you softly when zoomed in, recentres when zoomed out ----------
const cam = { x: 0, z: 0, dist: 80, tx: 0, tz: 0, tdist: 80, min: 18, max: 120 };
let bounds = { x0: -40, x1: 36, z0: -24, z1: 24 };
function frameCamera() {
  const aspect = innerWidth / innerHeight;
  const spanW = portrait ? 33 : 76, spanH = portrait ? 66 : 46;
  const vf = THREE.MathUtils.degToRad(camera.fov);
  const d = Math.max((spanH / 2) / Math.tan(vf / 2), (spanW / 2) / (Math.tan(vf / 2) * aspect)) * 1.05;
  cam.home = { x: portrait ? 0 : -2, z: portrait ? 2 : 0.5, dist: d };
  cam.tx = cam.home.x; cam.tz = cam.home.z; cam.tdist = d; cam.max = d; cam.min = d * 0.3;
  bounds = portrait ? { x0: -17, x1: 17, z0: -25, z1: 31 } : { x0: -37, x1: 33, z0: -21, z1: 21 };
}
export function fit() { if (!cam.home) return; cam.tx = cam.home.x; cam.tz = cam.home.z; cam.tdist = cam.home.dist; }
const ELEV = THREE.MathUtils.degToRad(72);
function zoomed() { return cam.home && cam.tdist < cam.home.dist * 0.92; }
function clampTarget() {
  // keep what you see inside the table: the visible half-size shrinks as you zoom in
  const vf = THREE.MathUtils.degToRad(camera.fov), aspect = innerWidth / innerHeight;
  const hh = Math.tan(vf / 2) * cam.tdist * 0.95, hw = hh * aspect;
  const cx = (bounds.x0 + bounds.x1) / 2, cz = (bounds.z0 + bounds.z1) / 2;
  cam.tx = hw >= (bounds.x1 - bounds.x0) / 2 ? cam.home.x : clamp(cam.tx, bounds.x0 + hw, bounds.x1 - hw);
  cam.tz = hh >= (bounds.z1 - bounds.z0) / 2 ? cam.home.z : clamp(cam.tz, bounds.z0 + hh, bounds.z1 - hh);
  if (!zoomed() && !pan) { cam.tx = lerp(cam.tx, cam.home.x, 0.08); cam.tz = lerp(cam.tz, cam.home.z, 0.08); }
}
const follow = { x: 0, z: 0, on: false };
function applyCamera(dt) {
  if (!cam.home) return;
  // when zoomed in, drift toward where you're looking (pointer) or what you're carrying (held piece)
  if (zoomed() && !pan) {
    let fx = null, fz = null, w = 0;
    if (held) { fx = held.mesh.position.x; fz = held.mesh.position.z; w = 0.9; }
    else if (follow.on) { fx = follow.x; fz = follow.z; w = 0.35; }
    if (fx !== null) { cam.tx = lerp(cam.tx, fx, 1 - Math.exp(-dt * w)); cam.tz = lerp(cam.tz, fz, 1 - Math.exp(-dt * w)); }
    // carrying a piece toward the screen edge eases the view that way
    if (held && edge.x) cam.tx += edge.x * dt * cam.tdist * 0.35;
    if (held && edge.y) cam.tz += edge.y * dt * cam.tdist * 0.35;
  }
  clampTarget();
  const k = 1 - Math.exp(-dt * 2.5), kd = 1 - Math.exp(-dt * 2.8);
  cam.x = lerp(cam.x, cam.tx, k); cam.z = lerp(cam.z, cam.tz, k); cam.dist = lerp(cam.dist, cam.tdist, kd);
  hand.place(new THREE.Vector3(cam.x, Math.sin(ELEV) * cam.dist, cam.z + Math.cos(ELEV) * cam.dist), new THREE.Vector3(cam.x, 0, cam.z), dt);
}
const edge = { x: 0, y: 0 };

// ---------- Input ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let active = false, held = null, grab = null, pan = null;
const pointers = new Map();
function onPlane(x, y, h = 0) {
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); plane.constant = -h;
  const o = new THREE.Vector3(); return ray.ray.intersectPlane(plane, o) ? o : null;
}
function pickPiece(x, y) {
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(pieces.filter((pc) => !pc.placed && !pc.anim).map((pc) => pc.mesh), false);
  return hits.length ? hits[0].object.userData.pc : null;
}
const cv = renderer.domElement;
cv.addEventListener('pointerdown', (e) => {
  if (!active || !built) return;
  sound.unlock();
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  cv.setPointerCapture(e.pointerId);
  if (pointers.size === 2) { // second finger: pinch/pan, drop whatever was held
    if (held) dropHeld(); const [a, b] = [...pointers.values()];
    pan = { pinch: true, d0: Math.hypot(a.x - b.x, a.y - b.y), dist0: cam.tdist, mid: onPlane((a.x + b.x) / 2, (a.y + b.y) / 2), tx0: cam.tx, tz0: cam.tz }; return;
  }
  const pc = pickPiece(e.clientX, e.clientY);
  if (pc) {
    settleAbove(pc);
    held = pc; if (!startedAt) startedAt = Date.now(); learn('puzzle');
    const p = onPlane(e.clientX, e.clientY, pc.mesh.position.y) || pc.mesh.position.clone();
    grab = { id: e.pointerId, off: pc.mesh.position.clone().sub(p).setY(0), target: pc.mesh.position.clone(), prev: pc.mesh.position.clone(), v: new THREE.Vector3() };
    grab.target.y = 1.4;
    sound.play('chipsHandle', { vol: 0.12, rate: 1.2, gap: 60 });
  } else {
    pan = { id: e.pointerId, start: onPlane(e.clientX, e.clientY), tx0: cam.tx, tz0: cam.tz, x0: e.clientX, y0: e.clientY, moved: 0 };
  }
});
cv.addEventListener('pointermove', (e) => {
  if (!active) return;
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pan && pan.pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
    cam.tdist = clamp(pan.dist0 * pan.d0 / Math.max(20, d), cam.min, cam.max);
    return;
  }
  if (held && grab && e.pointerId === grab.id) {
    const p = onPlane(e.clientX, e.clientY, 1.4);
    if (p) { grab.off.multiplyScalar(0.9); grab.target.set(p.x + grab.off.x, 1.4 + heightAt(p.x + grab.off.x, p.z + grab.off.z, held, [], true), p.z + grab.off.z); } // carried over the box, it rides above it
    return;
  }
  if (pan && !pan.pinch && e.pointerId === pan.id && pan.start) {
    pan.moved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
    // drag the table: the point you grabbed stays under the pointer
    const now = onPlane(e.clientX, e.clientY);
    if (now) { cam.tx -= (now.x - pan.start.x) * 0.6; cam.tz -= (now.z - pan.start.z) * 0.6; }
  }
  if (!held && e.pointerType === 'mouse') { const pc = pickPiece(e.clientX, e.clientY); cv.style.cursor = pc ? 'grab' : 'default'; hoverPc = pc; }
  const fp = onPlane(e.clientX, e.clientY); if (fp) { follow.x = fp.x; follow.z = fp.z; follow.on = e.pointerType === 'mouse'; }
  const ex = e.clientX / innerWidth, ey = e.clientY / innerHeight;
  edge.x = ex < 0.1 ? -(0.1 - ex) / 0.1 : ex > 0.9 ? (ex - 0.9) / 0.1 : 0;
  edge.y = ey < 0.14 ? -(0.14 - ey) / 0.14 : ey > 0.86 ? (ey - 0.86) / 0.14 : 0;
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (held && grab && e.pointerId === grab.id) dropHeld();
  if (pan && (pan.pinch ? pointers.size < 2 : e.pointerId === pan.id)) pan = null;
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('dblclick', () => { if (active) fit(); });
cv.addEventListener('pointerleave', () => { follow.on = false; edge.x = edge.y = 0; });
addEventListener('wheel', (e) => {
  if (!active || !built) return;
  if (e.target !== cv) return;
  e.preventDefault();
  const d = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
  const before = onPlane(e.clientX, e.clientY);
  const nd = clamp(cam.tdist * Math.exp(clamp(d, -120, 120) * 0.0011), cam.min, cam.max);
  // zoom toward the cursor
  if (before && nd < cam.tdist) { const f = 1 - nd / cam.tdist; cam.tx = lerp(cam.tx, before.x, f); cam.tz = lerp(cam.tz, before.z, f); }
  cam.tdist = nd;
}, { passive: false });
let hoverPc = null;

function dropHeld() {
  const pc = held, g = grab; held = null; grab = null; if (!pc) return;
  const d = Math.hypot(pc.mesh.position.x - pc.home.x, pc.mesh.position.z - pc.home.z);
  if (d < 1.15) { // close enough: it clicks into its slot
    pc.placed = true;
    animate(pc, { to: pc.home, yaw: 0, dur: 0.22, arc: 0.3, done: () => { sound.play('chipLay', { vol: 0.5, rate: 1.05 }); pc.flash = 1; checkDone(); } });
  } else {
    const to = pc.mesh.position.clone(); to.y = heightAt(to.x, to.z, pc) + T / 2; settleAbove(pc);
    animate(pc, { to, yaw: pc.yaw, dur: 0.18, arc: 0.2, done: () => sound.play('chipLay', { vol: 0.18, rate: 1.15, gap: 30 }) });
  }
  syncHud(); save();
}
function checkDone() {
  syncHud(); save();
  if (!done && pieces.every((pc) => pc.placed)) {
    done = true; sweep = 0; sound.play('fan', { vol: 0.6 }); sound.play('shuffle', { vol: 0.4, delay: 300, dur: 900 });
    const s = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
    document.getElementById('pz-done-text').textContent = s ? `Complete in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : 'Complete';
    setTimeout(syncHud, 900);
  }
}

// ---------- View ----------
export function enter() { active = true; layout(); cam.x = cam.tx; cam.z = cam.tz; cam.dist = cam.tdist; syncHud(); hand.release(); slide.manual = false; setSlide(0); if (pendingPour) { pendingPour = false; pour(); } }
// ---------- Hand-off with the home table: the box is the shared object ----------
let pendingPour = false, hideLidLater = false;
const hand = handCam(camera);
const slide = { v: 0, goal: 0, manual: false }; // the board and pieces slide in from / out to the left // the board and pieces slide in from / out to the left
// ---------- On the home table ----------
// The puzzle box on the home table IS this scene's box, so going in or out is one camera move. At home the board
// and pieces wait off to the side; on the way in they slide over as the camera arrives, and the reverse on the way out.
export function companion() { layout(); active = false; if (held) dropHeld(); lid.visible = true; hideLidLater = false; slide.manual = true; slide.anim = null; slide.doneLater = null; setSlide(1); }
// v: 0 in place .. 1 away to the left. Not one block: the board and the loose pieces travel as a wave. Coming in, the
// far (right) side arrives first and each piece slides in fast and slows to rest where it was left; going out, the
// near (left) side leaves first and each piece speeds away. Every piece moves the same way (+x/-x) and anything to
// the left of another is always at least as far away as it, so no piece ever passes through another.
const SLIDE = 90, LAG = 0.42;
function slideOff(x, v, coming) {
  const u = clamp((x - area.x0) / Math.max(1, area.x1 - area.x0), 0, 1);
  if (coming) { const k = clamp(((1 - v) - (1 - u) * LAG) / (1 - LAG), 0, 1); return -SLIDE * Math.pow(1 - k, 4); }
  const k = clamp((v - u * LAG) / (1 - LAG), 0, 1); return -SLIDE * k * k * k;
}
function setSlide(v) {
  if (v !== slide.v) slide.coming = v < slide.v;
  slide.v = v; slide.goal = v; world.visible = v < 0.999; // fully away = not drawn at all
  world.position.x = v <= 0 ? 0 : v >= 1 ? -SLIDE : slideOff(board.position.x, v, slide.coming);
}
// the wave runs on its own clock (in 1.3 s, out 1.1 s: each piece takes about 0.75 s), so it can finish just after
// the camera has arrived
export function slideIn(dur = 1.3) { slide.anim = { from: slide.v, to: 0, t: 0, dur }; sound.play('shove', { vol: 0.3, rate: 0.9, dur: 1100 }); sound.play('chipsHandle', { vol: 0.2, delay: 380, dur: 800 }); }
export function slideOut(dur = 1.1) { slide.anim = { from: slide.v, to: 1, t: 0, dur }; sound.play('shove', { vol: 0.25, rate: 1.05, dur: 900 }); }
function stepSlide(dt) {
  const a = slide.anim; if (!a) return;
  a.t = Math.min(1, a.t + dt / a.dur); setSlide(lerp(a.from, a.to, a.t));
  if (a.t >= 1) { slide.anim = null; if (slide.doneLater) { const f = slide.doneLater; slide.doneLater = null; f(); } }
}
function unSlidePieces() { for (const pc of pieces) if (pc._sdx) { pc.mesh.position.x -= pc._sdx; pc._sdx = 0; } }
function slidePieces() {
  if (slide.v <= 0 || slide.v >= 1) return;
  for (const pc of pieces) {
    if (pc.placed) continue; // on the board: it travels with the board
    const dx = slideOff(pc.mesh.position.x, slide.v, slide.coming) - world.position.x;
    pc.mesh.position.x += dx; pc._sdx = dx;
  }
}
export function homePose() {
  layout(); cam.x = cam.tx; cam.z = cam.tz; cam.dist = cam.tdist;
  return { pos: new THREE.Vector3(cam.x, Math.sin(ELEV) * cam.dist, cam.z + Math.cos(ELEV) * cam.dist), look: new THREE.Vector3(cam.x, 0, cam.z) };
}
export function drive(pose) { hand.drive(pose); }
export function enterDone() {
  if (slide.anim && slide.anim.to === 0) { slide.doneLater = enterDone; return; } // the last pieces are still sliding home
  slide.manual = false; setSlide(0); active = true; hand.release(); syncHud();
  hideLidLater = portrait;
  if (pendingPour) { pendingPour = false; pour(); }
}
export function anchor() {
  lid.updateMatrixWorld(true);
  return { pos: lid.position.clone().add(new THREE.Vector3(0, lidH, 0)), yaw: lid.rotation.y, size: lidW };
}
// leaving for home: stop play; the app slides the table away (setSlide) while it flies the camera out
export function beginLeave() { active = false; if (held) dropHeld(); cv.style.cursor = ''; lid.visible = true; hideLidLater = false; slide.manual = true; }
export function leave() { active = false; if (held) dropHeld(); cv.style.cursor = ''; }
export function resize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); if (built) layout(); }
export function exposure(dark) { return dark ? 1.06 : 1.05; }
export function setTheme(t) {
  env = envFor(t); scene.environment = env;
  const dark = t === 'dark';
  table.visible = false; catcher.visible = true; catcher.material.color.set(dark ? 0x000000 : 0x5a4632); catcher.material.opacity = dark ? 0.55 : 0.22; // no table top: the pieces cast soft shadows straight onto the scene behind
  if (matMesh) matMesh.material.color.set(dark ? 0x100e0c : 0xcfc7b8);
  hemi.intensity = dark ? 0.3 : 0.95; hemi.groundColor.set(dark ? 0x161514 : 0xc9bfb0);
  key.intensity = dark ? 1.9 : 2.2; key.color.set(dark ? 0xfff5ec : 0xfffaf2);
}

let tm = 0, sweep = 1;
export function update(dt) {
  tm += dt; dt = Math.min(dt, 1 / 30);
  unSlidePieces(); // positions below are always the real resting ones
  stepSlide(dt);
  applyCamera(dt);
  if (hideLidLater && !hand.busy && !pieces.some((pc) => pc.anim)) { hideLidLater = false; lid.visible = false; }
  if (slide.manual) lid.visible = true; // on the home table the box is always there
  if (guide) guide.material.opacity = lerp(guide.material.opacity, guideOn ? (document.documentElement.dataset.theme === 'dark' ? 0.22 : 0.42) : 0, 1 - Math.exp(-dt * 5));
  if (held && grab) {
    const pc = held;
    grab.prev.copy(pc.mesh.position);
    pc.mesh.position.lerp(grab.target, 1 - Math.exp(-dt * 11));
    grab.v.lerp(pc.mesh.position.clone().sub(grab.prev).multiplyScalar(1 / Math.max(dt, 1e-3)), 1 - Math.exp(-dt * 12));
    pc.yaw = lerp(pc.yaw, 0, 1 - Math.exp(-dt * 10)); // straightens as it's lifted
    pc.mesh.rotation.set(clamp(grab.v.z * 0.004, -0.25, 0.25), pc.yaw, clamp(-grab.v.x * 0.004, -0.25, 0.25));
    // magnetism: within reach of its slot it leans home
    const d = Math.hypot(pc.mesh.position.x - pc.home.x, pc.mesh.position.z - pc.home.z);
    if (d < 1.15) pc.mesh.position.lerp(new THREE.Vector3(pc.home.x, pc.mesh.position.y, pc.home.z), 1 - Math.exp(-dt * 6));
  }
  for (const pc of pieces) {
    const a = pc.anim;
    if (a) {
      a.t += dt; if (a.t < 0) continue;
      if (!pc.mesh.visible) pc.mesh.visible = true;
      const k = clamp(a.t / a.dur, 0, 1), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      pc.mesh.position.lerpVectors(a.from, a.to, e); pc.mesh.position.y += Math.sin(Math.PI * k) * a.arc;
      const yaw = lerp(a.fromYaw, a.toYaw, e) + (a.tumble ? a.spin * (1 - e) * 0.3 : 0);
      pc.mesh.rotation.set(a.tumble ? Math.sin(k * Math.PI * 2) * (1 - k) * 0.8 : 0, yaw, a.tumble ? Math.cos(k * Math.PI * 1.5) * (1 - k) * 0.6 : 0);
      if (k >= 1) { pc.anim = null; pc.yaw = a.toYaw; pc.mesh.position.copy(a.to); pc.mesh.rotation.set(0, a.toYaw, 0); a.done && a.done(); }
    } else if (!pc.placed && pc !== held) {
      const lift = pc === hoverPc ? 0.25 : 0; const base = pc.restY ?? pc.mesh.position.y;
      if (pc.restY === undefined) pc.restY = pc.mesh.position.y;
      pc.mesh.position.y = lerp(pc.mesh.position.y, pc.restY + lift, 1 - Math.exp(-dt * 14));
    }
    if (pc.anim || pc === held) pc.restY = undefined;
    if (pc.flash > 0) { pc.flash = Math.max(0, pc.flash - dt * 2.2); }
  }
  // completion: a slow light sweep across the finished picture
  if (done && sweep < 1) { sweep = Math.min(1, sweep + dt * 0.35); key.position.x = lerp(-60, 60, sweep); } else key.position.x = -20;
  slidePieces();
  return true;
}

