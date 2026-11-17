// Shared renderer, lighting environment, paper materials, card geometry, loaders.
import * as THREE from 'three';

const DPR = Math.min(window.devicePixelRatio || 1, 2);
export const isTouch = matchMedia('(pointer: coarse)').matches;

// ---------- Renderer ----------
export const canvas = document.getElementById('gl');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(DPR);
// a device that struggles gets fewer pixels (adaptive quality, app.js)
export function capPixelRatio(c) { renderer.setPixelRatio(Math.min(DPR, c)); }
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.autoClear = false;
renderer.shadowMap.type = THREE.PCFShadowMap;
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();

// ---------- Studio environment: dark room + two soft boxes, so paper catches clean highlights ----------
const pmrem = new THREE.PMREMGenerator(renderer);
function studio(theme) {
  const s = new THREE.Scene();
  if (theme === 'neutral') { // colour-true: neutral grey room, white soft boxes (for card close-ups)
    s.add(new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), new THREE.MeshBasicMaterial({ color: 0x808080, side: THREE.BackSide })));
    const b = (w, h, i, pos) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(i), side: THREE.DoubleSide })); m.position.set(...pos); m.lookAt(0, 0, 0); s.add(m); };
    b(9, 5, 5, [-8, 9, 6]); b(2.5, 12, 2.5, [11, 3, 2]); b(14, 14, 1.2, [0, 16, 0]);
    return pmrem.fromScene(s, 0.02).texture;
  }
  const dark = theme === 'dark';
  const room = new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16),
    new THREE.MeshBasicMaterial({ color: dark ? 0x141826 : 0x8a8478, side: THREE.BackSide }));
  s.add(room);
  const box = (w, h, color, intensity, pos, look) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(...look); s.add(m);
  };
  // key softbox upper-left (warm), fill strip right (cool), top skylight
  box(9, 5, dark ? 0xfff2e4 : 0xfff3e2, dark ? 5 : 6, [-8, 9, 6], [0, 0, 0]);
  box(2.5, 12, dark ? 0xd2dcff : 0xe6efff, dark ? 2.2 : 3, [11, 3, 2], [0, 0, 0]);
  box(14, 14, 0xffffff, dark ? 0.6 : 1.4, [0, 16, 0], [0, 0, 0]);
  const rt = pmrem.fromScene(s, 0.02);
  return rt.texture;
}
const envCache = {};
export function envFor(theme) { return envCache[theme] || (envCache[theme] = studio(theme)); }

// ---------- Textures ----------
const loader = new THREE.TextureLoader();
const texCache = new Map();
export function tex(url, { srgb = true } = {}) {
  if (texCache.has(url)) return texCache.get(url);
  const t = loader.load(url);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, MAX_ANISO);
  texCache.set(url, t);
  return t;
}
export function texAsync(url) {
  return new Promise((res, rej) => {
    if (texCache.has(url) && texCache.get(url).image) return res(texCache.get(url));
    loader.load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, MAX_ANISO); texCache.set(url, t); res(t); }, undefined, rej);
  });
}

// Fine paper grain + faint fibre as a normal map (generated once).
function makeGrain(size = 512) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = Math.random();
  // blur a touch + add long fibres
  const b = new Float32Array(h.length);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let s = 0;
    for (let k = -1; k <= 1; k++) s += h[((y + size) % size) * size + ((x + k + size) % size)] + h[((y + k + size) % size) * size + x];
    b[y * size + x] = s / 6;
  }
  for (let f = 0; f < 900; f++) {
    let x = Math.random() * size, y = Math.random() * size; const a = Math.random() * Math.PI, len = 6 + Math.random() * 18;
    for (let t = 0; t < len; t++) { const xi = (x | 0) % size, yi = (y | 0) % size; b[yi * size + xi] += 0.35; x += Math.cos(a); y += Math.sin(a); if (x < 0) x += size; if (y < 0) y += size; x %= size; y %= size; }
  }
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const dx = b[y * size + (x + 1) % size] - b[y * size + (x - 1 + size) % size];
    const dy = b[((y + 1) % size) * size + x] - b[((y - 1 + size) % size) * size + x];
    const n = new THREE.Vector3(-dx * 2.2, -dy * 2.2, 1).normalize();
    img.data[i * 4] = (n.x * 0.5 + 0.5) * 255; img.data[i * 4 + 1] = (n.y * 0.5 + 0.5) * 255; img.data[i * 4 + 2] = (n.z * 0.5 + 0.5) * 255; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace;
  return t;
}
export const grain = makeGrain();

// ---------- Paper stock presets ----------
// Each product has its own thickness, edge colour and coating.
export const STOCK = {
  playing: { w: 6.35, h: 8.89, t: 0.035, r: 0.32, edge: 0xf6f1e6, rough: 0.5, coat: 0.3, coatRough: 0.25, faceCoat: 0.9, faceCoatRough: 0.09, grainRepeat: 3, grainScale: 0.06 },
  memory:  { w: 6.0, h: 6.0, t: 0.15, r: 0.46, edge: 0x8f8a82, rough: 0.55, spec: 0.25, coat: 0.07, coatRough: 0.35, grainRepeat: 2.5, grainScale: 0.1 },
  puzzle:  { t: 0.2, edge: 0xe9e1d0, rough: 0.6, coat: 0.12, coatRough: 0.5, grainRepeat: 6, grainScale: 0.22 },
};

// face = true: the printed face side, which on the playing cards has a glossier varnish than the cream back
export function paperMaterial(stock, map, env, face = false) {
  const g = grain.clone(); g.repeat.set(stock.grainRepeat, stock.grainRepeat * (stock.h ? stock.h / stock.w : 1)); g.needsUpdate = true;
  const gloss = face && stock.faceCoat != null, cs = stock.grainScale * (gloss ? 0.15 : 0.5);
  return new THREE.MeshPhysicalMaterial({
    map, roughness: stock.rough, metalness: 0, specularIntensity: stock.spec ?? 1, // matte board: little grey sheen over the print
    clearcoat: gloss ? stock.faceCoat : stock.coat, clearcoatRoughness: gloss ? stock.faceCoatRough : stock.coatRough,
    normalMap: g, normalScale: new THREE.Vector2(stock.grainScale, stock.grainScale),
    clearcoatNormalMap: g, clearcoatNormalScale: new THREE.Vector2(cs, cs),
    envMap: env, envMapIntensity: 0.55,
  });
}
export function edgeMaterial(stock, env) {
  return new THREE.MeshStandardMaterial({ color: stock.edge, roughness: 0.85, metalness: 0, envMap: env, envMapIntensity: 0.8 });
}

// ---------- Card geometry: rounded-rect slab with soft bevelled edge ----------
// Groups: 0 = front (+z), 1 = back (-z, u mirrored so the art reads correctly), 2 = edge.
const geoCache = new Map();
export function cardGeometry(stock) {
  const key = `${stock.w}x${stock.h}x${stock.t}x${stock.r}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const { w, h, t, r } = stock;
  const bev = Math.min(t * 0.35, 0.012);
  const s = new THREE.Shape();
  const x0 = -w / 2 + bev, y0 = -h / 2 + bev, x1 = w / 2 - bev, y1 = h / 2 - bev, rr = r - bev;
  s.moveTo(x0 + rr, y0); s.lineTo(x1 - rr, y0); s.quadraticCurveTo(x1, y0, x1, y0 + rr);
  s.lineTo(x1, y1 - rr); s.quadraticCurveTo(x1, y1, x1 - rr, y1); s.lineTo(x0 + rr, y1);
  s.quadraticCurveTo(x0, y1, x0, y1 - rr); s.lineTo(x0, y0 + rr); s.quadraticCurveTo(x0, y0, x0 + rr, y0);
  const ex = new THREE.ExtrudeGeometry(s, { depth: t - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: 10 });
  ex.translate(0, 0, -(t - 2 * bev) / 2);
  const pos = ex.attributes.position, nrm = ex.attributes.normal;
  const buckets = [[], [], []];
  const tri = pos.count / 3;
  for (let i = 0; i < tri; i++) {
    let nz = 0, zmin = Infinity, zmax = -Infinity;
    for (let k = 0; k < 3; k++) { nz += nrm.getZ(i * 3 + k); const z = pos.getZ(i * 3 + k); zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
    const flat = zmax - zmin < 1e-5;
    buckets[flat && nz > 0 ? 0 : flat && nz < 0 ? 1 : 2].push(i);
  }
  const P = [], N = [], U = [], g = new THREE.BufferGeometry();
  let start = 0;
  buckets.forEach((list, gi) => {
    for (const i of list) for (let k = 0; k < 3; k++) {
      const v = i * 3 + k, x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
      P.push(x, y, z); N.push(nrm.getX(v), nrm.getY(v), nrm.getZ(v));
      let u = (x + w / 2) / w; const vv = (y + h / 2) / h;
      if (gi === 1) u = 1 - u;
      U.push(u, vv);
    }
    g.addGroup(start, list.length * 3, gi); start += list.length * 3;
  });
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.computeBoundingSphere(); g.computeBoundingBox();
  ex.dispose();
  geoCache.set(key, g);
  return g;
}

// ---------- Soft contact shadow texture ----------
let shadowTex;
export function softShadow() {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(0.55, 'rgba(0,0,0,0.22)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

// ---------- Small animation helpers ----------
export const ease = {
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t) => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
};
// critically-damped-ish spring toward target (per scalar)
export function spring(cur, vel, target, k, d, dt) {
  const a = (target - cur) * k - vel * d;
  vel += a * dt; cur += vel * dt;
  return [cur, vel];
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;

// ---------- Camera hand-off between scenes ----------
// An anchor is a shared object (the storybook's cover, the puzzle box) described in its own scene: top-centre
// position, yaw and width. matchPose puts a camera in the destination scene where it sees the destination anchor
// exactly as the source camera sees the source anchor, so a cut between the two scenes is invisible.
export function matchPose(srcCam, src, dst) {
  srcCam.updateMatrixWorld();
  const A = new THREE.Matrix4().compose(src.pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), src.yaw), new THREE.Vector3(1, 1, 1));
  const rel = A.invert().multiply(srcCam.matrixWorld);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); rel.decompose(p, q, s);
  p.multiplyScalar(dst.size / src.size);
  const B = new THREE.Matrix4().compose(dst.pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dst.yaw), new THREE.Vector3(1, 1, 1))
    .multiply(new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)));
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(); B.decompose(pos, quat, s);
  const look = pos.clone().add(new THREE.Vector3(0, 0, -1).applyQuaternion(quat).multiplyScalar(p.length()));
  return { pos, look };
}
// A camera that can blend from a matched pose into its own framing ('in'), or from its framing into one ('out').
export function handCam(camera) {
  const h = { mode: null, t: 1, dur: 1, pose: null, done: null, drive: null };
  const sm = (x) => x * x * x * (x * (x * 6 - 15) + 10);
  return {
    from(pose, dur = 1.5) { Object.assign(h, { mode: 'in', t: 0, dur, pose }); },
    to(pose, dur = 0.9) { return new Promise((r) => Object.assign(h, { mode: 'out', t: 0, dur, pose, done: r })); },
    get busy() { return h.t < 1; },
    get driving() { return h.drive; },
    // call last in the scene's update with its normal camera position and look point
    // drive: an outside animation owns the camera completely (one continuous move across two scenes)
    drive(pose) { h.drive = pose; },
    place(pos, look, dt) {
      if (h.drive) { pos = h.drive.pos; look = h.drive.look; }
      else if (h.t < 1 && h.pose) {
        h.t = Math.min(1, h.t + dt / h.dur); const s = sm(h.t);
        const a = h.mode === 'in' ? 1 - s : s;
        pos = pos.clone().lerp(h.pose.pos, a); look = look.clone().lerp(h.pose.look, a);
        if (h.t >= 1 && h.done) { const d = h.done; h.done = null; d(); }
      } else if (h.mode === 'out' && h.pose) { pos = h.pose.pos; look = h.pose.look; }
      camera.position.copy(pos); camera.lookAt(look); camera.updateMatrixWorld();
    },
    release() { h.mode = null; h.t = 1; h.pose = null; h.drive = null; },
  };
}

// ---------- Nothing in flight passes through anything else ----------
// items: [{ mesh, half: [x, y, z] (local half sizes of a flat box), flying, order, lift }]. Each flying item, in
// order of departure, is lifted just clear of everything resting and of every item that left before it; its lift
// then eases away once it is no longer needed. Call after the frame's animation has placed the meshes.
const _UP = new THREE.Vector3(0, 1, 0), _tv = new THREE.Vector3();
function _box(it) {
  it.mesh.updateMatrixWorld(); const e = it.mesh.matrixWorld.elements;
  return { c: it.mesh.position.clone(), ax: [0, 1, 2].map((i) => new THREE.Vector3(e[i * 4], e[i * 4 + 1], e[i * 4 + 2]).normalize()), h: it.half };
}
const _pj = (o, a) => o.h[0] * Math.abs(o.ax[0].dot(a)) + o.h[1] * Math.abs(o.ax[1].dot(a)) + o.h[2] * Math.abs(o.ax[2].dot(a));
function boxesOverlap(A, B) {
  const axes = [...A.ax, ...B.ax]; for (const a of A.ax) for (const b of B.ax) { const x = _tv.crossVectors(a, b); if (x.lengthSq() > 1e-6) axes.push(x.clone().normalize()); }
  const d = new THREE.Vector3().subVectors(B.c, A.c);
  for (const a of axes) if (_pj(A, a) + _pj(B, a) - Math.abs(d.dot(a)) <= 0.002) return false;
  return true;
}
export function clearFlights(items, dt) {
  const flying = items.filter((it) => it.flying).sort((p, q) => p.order - q.order);
  for (const it of items) if (!it.flying) it.lift = 0;
  if (!flying.length) return;
  const boxes = new Map(items.map((it) => [it, _box(it)]));
  for (const f of flying) {
    const F = boxes.get(f), base = F.c.y;
    F.c.y = base + (f.lift || 0) * Math.exp(-dt * 8);
    const others = items.filter((o) => o !== f).sort((p, q) => boxes.get(p).c.y - boxes.get(q).c.y); // bottom up
    for (let pass = 0; pass < 40; pass++) {
      let hit = false;
      for (const o of others) {
        if (o === f || (o.flying && o.order > f.order)) continue;
        const O = boxes.get(o);
        if (!boxesOverlap(F, O)) continue;
        const up = O.c.y + _pj(O, _UP) - (F.c.y - _pj(F, _UP)) + 0.004;
        if (up > 0) { F.c.y += up; hit = true; }
      }
      if (!hit) break;
    }
    f.lift = F.c.y - base; f.mesh.position.y = F.c.y;
  }
}

// ---------- Card poses on a table ----------
const _UPY = new THREE.Vector3(0, 1, 0);
export const qFaceUp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const qFaceDown = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
export const yawQ = (a) => new THREE.Quaternion().setFromAxisAngle(_UPY, a);
// face down with the back art upright to someone looking across the table
export const qBackUpright = new THREE.Quaternion().setFromAxisAngle(_UPY, Math.PI).multiply(qFaceDown);
