// Gallery: DOM grid with momentum scrolling + a 3D overlay for inspecting cards.
// Inspect is a carousel: one card on screen; the wheel/trackpad/swipe spins through the deck with inertia,
// fast spins blur the cards past, and it settles softly onto one card.
import * as THREE from 'three';
import { envFor, tex, texAsync, STOCK, paperMaterial, edgeMaterial, cardGeometry, softShadow, spring, clamp, lerp, ease, isTouch, renderer } from './core.js';
import * as sound from './sound.js';
import { hint, learn } from './ui.js';
hint(document.getElementById('insp-hint'), 'inspect');
import * as backdrop from './backdrop.js';

const A = 'assets/';
export const scene = new THREE.Scene();
const FOV = 26, CAMZ = 60;
export const camera = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, 1, 300);
camera.position.set(0, 0, CAMZ);
// cards are always inspected under neutral studio light, so they read like the printed piece
let env = envFor('neutral');
scene.environment = env;
// neutral white studio light, identical in both themes: the paper must read exactly as printed
const key = new THREE.DirectionalLight(0xffffff, 1.7); key.position.set(-20, 30, 40); scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.35); fill.position.set(25, -10, 20); scene.add(fill);

const SETS = {
  playing: { stock: STOCK.playing, dir: 'pc', title: 'Holiday Playing Cards', ar: '5 / 7', rad: '5%' },
  memory: { stock: STOCK.memory, dir: 'mm', title: 'Memory Match', ar: '1 / 1', rad: '7.7%' },
};
let set = 'playing', list = [], manifest;
const grid = document.getElementById('grid');
const scroller = document.getElementById('gallery-scroll');
const ui = document.getElementById('inspect-ui');
const nameEl = document.getElementById('insp-name');
const hintEl = document.getElementById('insp-hint');
const HINT = isTouch ? 'Swipe to browse · Tap to flip' : 'Scroll to browse · Drag to turn · Click to flip';
hintEl.textContent = HINT;

export function init(man) { manifest = man; }
export function show(which) {
  dropHover(true);
  set = which;
  const S = SETS[set];
  list = set === 'playing' ? manifest.playing : manifest.memory;
  document.getElementById('gallery-title').textContent = S.title;
  grid.className = 'grid ' + set;
  grid.innerHTML = list.map((c, i) => `<button class="thumb" data-i="${i}" aria-label="${c.name}" style="--ar:${S.ar};--rad:${S.rad};--i:${i % 24}"><span class="face"><img src="${A}${S.dir}/thumb/${c.id}.webp" alt="" decoding="async"></span></button>`).join('');
  scroller.scrollTop = 0; scrollTarget = 0; scrollCur = 0;
  grid.classList.add('fresh');
}
export function preloadThumbs(which) {
  const S = SETS[which]; const L = which === 'playing' ? manifest.playing : manifest.memory;
  return Promise.all([...L.map((c) => texAsync(`${A}${S.dir}/thumb/${c.id}.webp`)), texAsync(`${A}${S.dir}/thumb/back.webp`)]);
}

// ---------- Momentum scrolling for the grid (wheel / trackpad) ----------
let scrollTarget = 0, scrollCur = 0, scrolling = false;
scroller.addEventListener('wheel', (e) => {
  if (cur) return;
  e.preventDefault();
  const d = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaMode === 2 ? e.deltaY * innerHeight : e.deltaY;
  const max = scroller.scrollHeight - scroller.clientHeight;
  if (!scrolling) { scrollCur = scroller.scrollTop; scrollTarget = scrollCur; }
  scrollTarget = clamp(scrollTarget + d * 1.15, 0, max);
  scrolling = true;
}, { passive: false });
scroller.addEventListener('scroll', () => { if (!scrolling) { scrollCur = scrollTarget = scroller.scrollTop; } }, { passive: true });
function updateScroll(dt) {
  if (!scrolling) return;
  scrollCur = lerp(scrollCur, scrollTarget, 1 - Math.exp(-dt * 5));
  if (Math.abs(scrollTarget - scrollCur) < 0.4) { scrollCur = scrollTarget; scrolling = false; }
  scroller.scrollTop = scrollCur;
}

// ---------- Snow in the close-up: real flakes in the card's space ----------
// When a card is opened, the flakes on screen move into this 3D scene: each one is placed exactly where it was on
// screen, at a real distance from the camera (from its depth: distant flakes far behind the card, near ones close to
// the lens), at the size that keeps it looking the same. They keep falling (the snow layer still moves them). The
// layer is then rendered with its depth and blurred by a lens focused on the card (compositor.js), so flakes behind
// the card are hidden by it, and every flake is as sharp or soft as its real distance makes it.
const MAXF = 900;
let atlasTex = null, atlasLight = null;
const snowVS = /* glsl */`attribute vec3 aInfo; varying vec2 vUv; varying vec3 vInfo;
  void main(){ vUv = uv; vInfo = aInfo; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`;
const snowFS = /* glsl */`uniform sampler2D atlas; uniform float shapes; uniform float gainInv; varying vec2 vUv; varying vec3 vInfo;
  void main(){
    vec4 t = texture2D(atlas, vec2((vInfo.x + vUv.x) / shapes, vUv.y));
    vec3 col = t.rgb * mix(vec3(1.0), vec3(0.87, 0.93, 1.0), vInfo.z);
    // a pixel is either flake (its colour and its depth) or not flake at all, so the lens always knows how far it is
    if (t.a < 0.3) discard; float a = t.a * vInfo.y;
    gl_FragColor = vec4(col * gainInv * a, a); // premultiplied
  }`;
const snowUniforms = { atlas: { value: null }, shapes: { value: 14 }, gainInv: { value: 1 } };
// every flake is a real object in the card's space, writing its depth (alpha-to-coverage keeps its edge soft), so the
// lens in the compositor blurs it by its real distance and the card hides the ones behind it
const snowMat = new THREE.ShaderMaterial({ uniforms: snowUniforms, vertexShader: snowVS, fragmentShader: snowFS, transparent: false, depthWrite: true, blending: THREE.NoBlending });
const snowGeo = new THREE.PlaneGeometry(1, 1), snowInfo = new THREE.InstancedBufferAttribute(new Float32Array(MAXF * 3), 3);
snowGeo.setAttribute('aInfo', snowInfo);
const snow3 = new THREE.InstancedMesh(snowGeo, snowMat, MAXF); snow3.frustumCulled = false; snow3.count = 0; snow3.layers.set(1); scene.add(snow3);
camera.layers.enable(3); // card shadows live on layer 3: drawn with the cards, but they hide no snow
const _o = new THREE.Object3D();
function updateSnow3() {
  const amt = backdrop.focusAmount();
  if (amt < 0.001) { snow3.count = 0; return 0; }
  const v = backdrop.snowView(), light = !v.dark;
  if (atlasLight !== light) { atlasTex && atlasTex.dispose(); atlasTex = new THREE.CanvasTexture(backdrop.flakeAtlas(light)); atlasTex.colorSpace = THREE.SRGBColorSpace; atlasTex.anisotropy = 4; snowUniforms.atlas.value = atlasTex; snowUniforms.shapes.value = backdrop.shapeCount(); atlasLight = light; }
  snowUniforms.gainInv.value = 1 / PAPER_GAIN; // this layer is brightened for the paper; the snow stays white
  const tanH = Math.tan(THREE.MathUtils.degToRad(FOV) / 2), n = Math.min(MAXF, v.flakes.length);
  for (let i = 0; i < n; i++) {
    const f = v.flakes[i], L = backdrop.flakeLook(f, v.dark);
    // exactly where it is on screen, at a real distance: far flakes well behind the card, near ones by the lens
    const D = CAMZ * lerp(2.6, 0.3, f.z), nx = (f.x / v.W) * 2 - 1, ny = 1 - (f.y / v.H) * 2, wpp = (2 * D * tanH) / v.H;
    _o.position.set(nx * D * tanH * camera.aspect, ny * D * tanH, CAMZ - D);
    // the big 'by the lens' flakes are drawn smaller as the lens takes over, so they read as round out-of-focus
    // snow (a blur much larger than the flake) rather than a blurred outline of a large shape
    const sz = L.size * (f.z > 0.86 ? lerp(1, 0.4, amt) : 1);
    _o.rotation.set(0, 0, -f.rot); _o.scale.set(2 * sz * wpp, 2 * sz * wpp * L.sq, 1);
    // flakes just off screen are sent round to the other side by the snow layer; out there they fade, so a blurred
    // flake that reaches past the edge never vanishes at once
    const ef = Math.min(1, (f.x + 80) / 70, (v.W + 80 - f.x) / 70, (f.y + 90) / 70, (v.H + 90 - f.y) / 70);
    _o.updateMatrix(); snow3.setMatrixAt(i, _o.matrix); snowInfo.setXYZ(i, f.shape, L.alpha * amt * Math.max(0, ef), f.ice ? 1 : 0);
  }
  snow3.count = n; snow3.instanceMatrix.needsUpdate = true; snowInfo.needsUpdate = true;
  return amt;
}
// the lens for the compositor: focused on the card in front, its aperture opening with the focus pull
export function lens() {
  const amt = backdrop.focusAmount(); if (amt < 0.001) return null;
  const c = cur && cur.cards.get(Math.round(cur.pos)), z = c ? c.g.position.z : 0;
  return { focus: CAMZ - z, A: 1500 * amt, maxNear: 46, maxFar: 15, layer: 1 }; // a wide aperture: near flakes melt into soft discs
}

// ---------- Hover on thumbnails: the real card ----------
// The hovered thumbnail is swapped for the actual 3D card (same stock, varnish and studio light as the close-up). It
// lifts toward you and tilts toward the cursor, so the light really moves across its surface; a few snowflakes lift
// off its edges into the weather. Moving off, it settles back into its slot and swaps back to the image.
let hv = null, puffT = 0; // hv: the card under the pointer; hovs: it plus any cards still settling back
const hovs = [];
const SETTLE = 0.25; // seconds to settle back (lifting takes about 0.4)
function light(b) {
  if (cur || flights.length || (hv && hv.el === b && !hv.out)) return;
  if (hv) unlight(hv.el); // the card left behind settles on its own while this one lifts
  const old = hovs.find((h) => h.el === b); if (old) { old.out = false; hv = old; return; } // back onto one still settling
  const i = +b.dataset.i, c = makeCard(set, i), S = SETS[set];
  const p = rectPose(b.getBoundingClientRect(), S.stock);
  c.g.position.set(p.x, p.y, 0); c.g.scale.setScalar(p.s); c.shadow.material.opacity = 0; addRest(c, b, 0, false);
  hv = { c, el: b, lift: 0, liftV: 0, rx: 0, rxV: 0, ry: 0, ryV: 0, gx: 0.5, gy: 0.5, out: false, frames: 0 };
  hovs.push(hv);
  document.body.classList.add('overlay3d');
  backdrop.puff(b.getBoundingClientRect(), 7); puffT = performance.now();
  sound.play('slide', { vol: 0.08, rate: 1.5, gap: 120 });
}
function unlight(b) {
  const h = hovs.find((x) => x.el === b); if (!h || h.out) return;
  h.out = true; h.st = 0; h.from = { lift: h.lift, rx: h.rx, ry: h.ry, sh: h.c.shOp || 0 }; // settle back from wherever it is
  if (hv === h) hv = null;
  sound.play('slide', { vol: 0.05, rate: 1.8, gap: 120 });
}
function dropOne(h) {
  h.el.classList.remove('hov'); dispose(h.c); hovs.splice(hovs.indexOf(h), 1); if (hv === h) hv = null;
  if (!hovs.length && !cur && !flights.length) document.body.classList.remove('overlay3d');
}
function dropHover() { while (hovs.length) dropOne(hovs[0]); }
function updateHover(dt) {
  if (!hovs.length) return false;
  const S = SETS[set];
  for (const h of hovs.slice()) {
    if (!h.el.isConnected || cur) { dropOne(h); continue; }
    if (!h.out) {
      [h.lift, h.liftV] = spring(h.lift, h.liftV, 1, 70, 14, dt);
      // tilting toward the cursor turns the face into the studio key light (upper left), so the varnish catches it
      [h.rx, h.rxV] = spring(h.rx, h.rxV, (h.gy - 0.5) * 0.62, 90, 15, dt); [h.ry, h.ryV] = spring(h.ry, h.ryV, (h.gx - 0.5) * 0.62, 90, 15, dt);
    } else { // back into its slot: quicker than the lift, easing out, no bounce
      h.st = Math.min(1, h.st + dt / SETTLE); var k = 1 - Math.pow(1 - h.st, 3);
      h.lift = h.from.lift * (1 - k); h.rx = h.from.rx * (1 - k); h.ry = h.from.ry * (1 - k); h.liftV = h.rxV = h.ryV = 0;
    }
    const p = rectPose(h.el.getBoundingClientRect(), S.stock), L = Math.max(0, h.lift);
    h.c.g.position.set(p.x, p.y, L * 4.2); h.c.g.scale.setScalar(p.s);
    h.c.mesh.rotation.set(h.rx, h.ry, 0, 'YXZ'); // the corner under the cursor dips away, like a press
    shade(h.c, 0.5 * L, 1.2 + h.ry * 2 + L * 0.8, -1.6 + h.rx * 2 - L * 1.4, 1, h.out ? dt * 8 : dt * 3);
    if (h.out) { h.c.shOp = h.from.sh * (1 - k); h.c.shadow.material.opacity = h.c.shOp; } // gone exactly as it lands
    if (++h.frames === 2) h.el.classList.add('hov'); // the 3D card has been drawn once: hide the image under it
    setRest(h.c, h.frames >= 2 ? 1 - 0.7 * L : 0); // takes over from the page's shadow in that same frame
    if (h.out && h.st >= 1) dropOne(h); // flat in its slot: the image takes over, unseen
  }
  return hovs.length > 0;
}
grid.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const b = e.target.closest('.thumb'); if (!b) return;
  light(b); if (!hv || hv.el !== b) return;
  const r = b.getBoundingClientRect(); hv.gx = clamp((e.clientX - r.left) / r.width, 0, 1); hv.gy = clamp((e.clientY - r.top) / r.height, 0, 1);
  const now = performance.now();
  if (now - puffT > 420) { puffT = now; backdrop.puff(r, 1); }
});
grid.addEventListener('pointerout', (e) => {
  const b = e.target.closest('.thumb'); if (!b || b.contains(e.relatedTarget)) return;
  unlight(b);
});
grid.addEventListener('click', (e) => {
  const b = e.target.closest('.thumb'); if (!b || cur || flights.length) return;
  dropHover(true); sound.unlock(); open(+b.dataset.i, b);
});
// arrow keys move around the grid (Enter opens a card, as a click does)
grid.addEventListener('keydown', (e) => {
  const b = e.target.closest('.thumb'); if (!b || cur) return;
  const all = [...grid.querySelectorAll('.thumb')], i = all.indexOf(b), w = all.findIndex((x) => x.offsetTop !== all[0].offsetTop);
  const cols = w > 0 ? w : all.length; // tiles in a row
  const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
  if (!d) return;
  const n = all[i + d]; if (!n) return;
  e.preventDefault(); n.focus(); n.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});

// ---------- Screen <-> world helpers ----------
function wpp() { return (2 * CAMZ * Math.tan(THREE.MathUtils.degToRad(FOV) / 2)) / innerHeight; }
function rectPose(r, stock) {
  const k = wpp();
  return { x: (r.left + r.width / 2 - innerWidth / 2) * k, y: -(r.top + r.height / 2 - innerHeight / 2) * k, s: (r.width * k) / stock.w };
}
function centerPose(stock) {
  const k = wpp(), small = innerWidth < 640;
  const availH = innerHeight * (small ? 0.58 : 0.7), availW = innerWidth * (small ? 0.8 : 0.6);
  const s = Math.min((availH * k) / stock.h, (availW * k) / stock.w);
  return { x: 0, y: small ? 0.9 * s : 0.4 * s, s };
}

// ---------- The grid's own shadow, in 3D ----------
// Every card in the grid casts the page's shadow (css --card-shadow). A 3D card standing in for a grid card carries
// exactly that shadow, drawn from the same numbers the page uses (offset, blur, spread, colour, the card's corner
// radius, cut out wherever a later card in the grid sits on top of it, as on the page), so swapping one for the other
// can't be seen. From there it only ever eases: out as the card lifts off its slot, in as a card settles into one.
export const PAPER_GAIN = 1.47; // the gallery layer's gain (app.js): calibrated so a face-on card's paper renders at the printed colour
const sm = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
function cssShadow() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--card-shadow');
  return [...v.matchAll(/(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s+rgba\(([^)]+)\)/g)].map((m) => {
    const c = m[5].split(',').map(Number); return { x: +m[1], y: +m[2], blur: +m[3], spread: +m[4], rgb: c.slice(0, 3), a: c[3] };
  });
}
function rrect(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2)); g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
const restCache = new Map();
function restTexture(W, H, rad, holes) {
  const L = cssShadow(), d = Math.min(devicePixelRatio || 1, 2);
  const key = [W, H, rad, d, JSON.stringify(L), holes.join(';')].join('|');
  let e = restCache.get(key);
  if (!e) {
    const pad = Math.ceil(Math.max(0, ...L.map((q) => Math.max(Math.abs(q.x), Math.abs(q.y)) + q.blur * 1.5 + Math.max(0, q.spread))) + 2);
    const cw = W + pad * 2, ch = H + pad * 2, cv = document.createElement('canvas');
    cv.width = Math.ceil(cw * d); cv.height = Math.ceil(ch * d);
    const g = cv.getContext('2d'), OFF = cw + 50;
    // canvas shadows follow the same blur law as css box-shadow (sigma = blur / 2); the shape itself is drawn off the
    // canvas so only its shadow lands
    for (const q of L) {
      g.save(); g.setTransform(d, 0, 0, d, 0, 0);
      g.shadowColor = `rgba(${q.rgb.join(',')},${q.a})`; g.shadowBlur = q.blur * d; g.shadowOffsetX = (OFF + q.x) * d; g.shadowOffsetY = q.y * d;
      rrect(g, pad - q.spread - OFF, pad - q.spread, W + q.spread * 2, H + q.spread * 2, rad + q.spread); g.fillStyle = '#000'; g.fill(); g.restore();
    }
    // like the page: an outer shadow never darkens its own card, and later cards in the grid sit on top of it
    g.setTransform(d, 0, 0, d, 0, 0); g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
    rrect(g, pad, pad, W, H, rad); g.fill();
    for (const h of holes) { rrect(g, pad + h[0], pad + h[1], h[2], h[3], h[4]); g.fill(); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.NoColorSpace; t.premultiplyAlpha = false; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;
    e = { t, cw, ch, n: 0, key }; restCache.set(key, e);
  }
  e.n++; return e;
}
function releaseRest(e) {
  if (--e.n > 0 || restCache.size < 40) return;
  restCache.delete(e.key); e.t.dispose();
}
// the page blends its shadow in sRGB; the gallery layer is linear, gained and encoded on the way out, so the shadow
// is written as the linear value that comes out as exactly the page's colour
const restMat = new THREE.ShaderMaterial({
  uniforms: { map: { value: null }, opacity: { value: 0 }, gain: { value: PAPER_GAIN } },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D map; uniform float opacity; uniform float gain; varying vec2 vUv;
    vec3 lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
    void main(){ vec4 s = texture2D(map, vUv); float a = s.a * opacity; gl_FragColor = vec4(lin(s.rgb * a) / gain, a); }`,
  transparent: true, depthWrite: false, toneMapped: false,
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
});
const shown = (el) => !el.classList.contains('away') && !el.classList.contains('pending');
// gives card c the shadow its grid slot el casts on the page (starting at strength v)
function addRest(c, el, v = 1, punch = true) {
  dropRest(c);
  if (!el || !el.classList || !el.classList.contains('thumb')) return;
  const r = el.getBoundingClientRect(); if (r.width < 2) return;
  const S = SETS[c.set], rad = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, holes = [];
  if (punch && !el.matches(':hover')) { // a hovered card is raised above its neighbours, shadow and all
    for (let n = el.nextElementSibling; n; n = n.nextElementSibling) {
      const q = n.getBoundingClientRect(); if (q.top > r.bottom + 160) break;
      if (!shown(n) || q.left > r.right + 160 || q.right < r.left - 160) continue;
      holes.push([q.left - r.left, q.top - r.top, q.width, q.height, parseFloat(getComputedStyle(n).borderTopLeftRadius) || 0].map((x) => Math.round(x * 2) / 2));
    }
  }
  const e = restTexture(Math.round(r.width * 2) / 2, Math.round(r.height * 2) / 2, rad, holes), u = S.stock.w / r.width;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(e.cw * u, e.ch * u), restMat.clone());
  m.material.uniforms.map.value = e.t; m.material.uniforms.gain.value = PAPER_GAIN;
  m.position.z = -S.stock.t - 0.01; m.layers.set(3); m.userData.e = e;
  c.g.add(m); c.rest = m; setRest(c, v);
}
function setRest(c, v) { if (!c.rest) return; c.rest.material.uniforms.opacity.value = v; c.rest.visible = v > 0.001; }
function dropRest(c) {
  if (!c.rest) return;
  c.g.remove(c.rest); c.rest.geometry.dispose(); c.rest.material.dispose(); releaseRest(c.rest.userData.e); c.rest = null;
}
// a card settling into its slot: its page shadow builds up over the last part of the trip and is whole as it lands
function arrive(c, el, t) {
  const v = sm((t - 0.65) / 0.35);
  if (v > 0 && !c.rest) addRest(c, el, 0); // (cut against the cards already in place at that moment)
  setRest(c, v);
}
const leave = (t) => 1 - sm(t / 0.35); // and lifting off: it melts over the first part

// ---------- Card meshes ----------
const shadowBase = new THREE.MeshBasicMaterial({ map: softShadow(), transparent: true, depthWrite: false, opacity: 0 });
function makeCard(whichSet, i) {
  const S = SETS[whichSet], L = whichSet === 'playing' ? manifest.playing : manifest.memory, c = L[i];
  const front = paperMaterial(S.stock, tex(`${A}${S.dir}/thumb/${c.id}.webp`), env, true);
  const back = paperMaterial(S.stock, tex(`${A}${S.dir}/thumb/back.webp`), env);
  // under the studio light the matte memory board comes out a touch brighter than its print; measured against the grid
  // image it stands in for, this brings it back so the swap between the two can't be seen
  if (whichSet === 'memory') { front.color.setScalar(0.87); back.color.setScalar(0.87); }
  const mesh = new THREE.Mesh(cardGeometry(S.stock), [front, back, edgeMaterial(S.stock, env)]);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(S.stock.w * 1.5, S.stock.h * 1.45), shadowBase.clone());
  shadow.position.set(1.2, -1.6, -4); shadow.layers.set(3);
  const g = new THREE.Group(); g.add(shadow); g.add(mesh); scene.add(g);
  return { g, mesh, shadow, rest: null, i, set: whichSet, front, back, full: false, yaw: 0, yawV: 0, pitch: 0, pitchV: 0, roll: 0, rollV: 0 };
}
function upgrade(c) {
  if (c.full) return; c.full = true;
  const S = SETS[c.set], L = c.set === 'playing' ? manifest.playing : manifest.memory;
  texAsync(`${A}${S.dir}/full/${L[c.i].id}.webp`).then((t) => { if (c.front) { c.front.map = t; c.front.needsUpdate = true; } });
  texAsync(`${A}${S.dir}/full/back.webp`).then((t) => { if (c.back) { c.back.map = t; c.back.needsUpdate = true; } });
}
function dispose(c) {
  dropRest(c); scene.remove(c.g);
  [].concat(c.mesh.material).forEach((m) => { if (m.normalMap) m.normalMap.dispose(); m.dispose(); });
  c.shadow.geometry.dispose(); c.shadow.material.dispose(); c.front = c.back = null;
}

// ---------- Inspect carousel ----------
let cur = null;           // { phase: 'in'|'idle'|'out', t, from, to, cards: Map<idx, card>, ... }
export const isOpen = () => !!cur;
// the app keeps the browser history in step with the close-up (so Back closes it)
let onInsp = null;
export function onInspect(fn) { onInsp = fn; }
const mod = (n, m) => ((n % m) + m) % m;

// open a single card from anywhere (e.g. a tile on the game table). proxy: { getBoundingClientRect(), classList: { add, remove } }
export function openExternal(whichSet, i, proxy) {
  if (cur) return;
  set = whichSet; list = whichSet === 'playing' ? manifest.playing : manifest.memory;
  document.body.classList.add('insp-single');
  hintEl.textContent = isTouch ? 'Drag to turn · Tap to flip' : 'Drag to turn · Click to flip';
  open(i, proxy, true);
}
function open(i, el, external = false) {
  const S = SETS[set];
  const c = makeCard(set, i); upgrade(c);
  const from = rectPose(el.getBoundingClientRect(), S.stock), to = centerPose(S.stock);
  c.g.position.set(from.x, from.y, 0); c.g.scale.setScalar(from.s);
  if (!external) addRest(c, el);
  cur = { phase: 'in', t: 0, from, to, pos: i, vel: 0, snapTo: null, cards: new Map([[i, c]]), lastIdx: i, flipYaw: 0, el, external };
  el.classList.add('away');
  nameEl.textContent = list[i].name;
  ui.setAttribute('aria-hidden', 'false');
  document.body.classList.add('inspecting', 'overlay3d');
  backdrop.setFocus(true); // the snow's focus pulls to the card
  onInsp && onInsp(true);
  sound.play('slide', { vol: 0.5, rate: 1.05 });
}
export function close() {
  if (!cur || cur.phase === 'out') return;
  onInsp && onInsp(false);
  const idx = mod(Math.round(cur.pos), list.length);
  // keep only the front card
  for (const [k, c] of cur.cards) if (k !== Math.round(cur.pos)) { dispose(c); cur.cards.delete(k); }
  const c = cur.cards.get(Math.round(cur.pos));
  const el = cur.external ? cur.el : grid.children[idx];
  if (el && !cur.external) { // bring its grid slot into view instantly, so the card can land in it
    const r = el.getBoundingClientRect(), sr = scroller.getBoundingClientRect();
    if (r.top < sr.top + 80 || r.bottom > sr.bottom - 40) { scroller.scrollTop += r.top - sr.top - sr.height / 2 + r.height / 2; scrollCur = scrollTarget = scroller.scrollTop; }
  }
  if (cur.el && cur.el !== el) cur.el.classList.remove('away');
  if (el) el.classList.add('away');
  cur.el = el; cur.closingCard = c; cur.shFrom = c.shOp || 0;
  if (el && !cur.external) addRest(c, el, 0); else dropRest(c);
  cur.from = { x: c.g.position.x, y: c.g.position.y, s: c.g.scale.x };
  cur.to = el ? rectPose(el.getBoundingClientRect(), SETS[set].stock) : cur.from;
  c.targetYaw = Math.round(c.yaw / (2 * Math.PI)) * 2 * Math.PI;
  cur.phase = 'out'; cur.t = 0; backdrop.setFocus(false);
  // the 3D layer stays above the grid until the card has landed (body.overlay3d)
  document.body.classList.remove('inspecting');
  ui.setAttribute('aria-hidden', 'true');
  sound.whoosh(0);
  sound.play('place', { vol: 0.35, delay: 420 });
}
function go(dir) { if (!cur || cur.phase !== 'idle' || cur.external) return; cur.snapTo = Math.round(cur.snapTo ?? cur.pos) + dir; cur.vel = 0; }
function flip() { if (!cur || cur.phase !== 'idle') return; learn('inspect'); cur.flipYaw += Math.PI; sound.play('slide', { vol: 0.35, rate: 1.25 }); }
document.getElementById('insp-close').addEventListener('click', close);
document.getElementById('insp-prev').addEventListener('click', () => go(-1));
document.getElementById('insp-next').addEventListener('click', () => go(1));
addEventListener('keydown', (e) => {
  if (!cur) return;
  if (e.key === 'ArrowRight') go(1);
  if (e.key === 'ArrowLeft') go(-1);
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
});

// wheel / trackpad spins the deck with inertia
const cv = renderer.domElement;
addEventListener('wheel', (e) => {
  if (!cur || cur.phase !== 'idle') return;
  e.preventDefault();
  if (cur.external) return;
  let d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (e.deltaMode === 1) d *= 32; else if (e.deltaMode === 2) d *= innerHeight;
  cur.snapTo = null;
  cur.vel = clamp(cur.vel + d * 0.011, -70, 70);
}, { passive: false });

// pointer: mouse drag turns the card; touch swipe spins the deck; tap flips; tap outside closes
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let drag = null, hover = { px: -1, py: -1, mouse: false };
function spacingPx() { return innerWidth * 1.05 + 40; }
cv.addEventListener('pointerdown', (e) => {
  if (!cur || cur.phase !== 'idle') return;
  drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), moved: 0, vx: 0, touch: e.pointerType !== 'mouse', hit: hitFront(e), axis: null };
  cv.setPointerCapture(e.pointerId);
});
cv.addEventListener('pointermove', (e) => {
  hover.px = e.clientX; hover.py = e.clientY; hover.mouse = e.pointerType === 'mouse';
  if (!drag || !cur || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.lx, dy = e.clientY - drag.ly, now = performance.now(), dt = Math.max(1, now - drag.t);
  drag.moved += Math.abs(dx) + Math.abs(dy);
  drag.vx = lerp(drag.vx, dx / dt, 0.45);
  drag.lx = e.clientX; drag.ly = e.clientY; drag.t = now;
  if (drag.moved < 6) return;
  learn('inspect');
  const c = front();
  if (drag.touch && cur.external) { if (c) { c.dragYaw = (c.dragYaw || 0) + dx * 0.012; } }
  else if (drag.touch) { // swipe moves the deck under the finger
    cur.pos -= dx / spacingPx(); cur.vel = 0; cur.snapTo = null;
  } else if (c) { // mouse drag turns the card in the hand
    c.dragYaw = (c.dragYaw || 0) + dx * 0.012; c.pitchGoal = clamp((c.pitchGoal ?? c.pitch) + dy * 0.006, -0.6, 0.6);
  }
});
cv.addEventListener('pointerup', (e) => {
  if (!drag || !cur) { drag = null; return; }
  const d = drag; drag = null;
  if (d.moved <= 6) { if (d.hit) flip(); else close(); return; }
  if (d.touch && cur.external) { const c = front(); if (c) { cur.flipYaw += Math.round((c.dragYaw || 0) / Math.PI) * Math.PI; c.dragYaw = 0; } }
  else if (d.touch) { cur.vel = clamp((-d.vx * 1000) / spacingPx() * 1.1, -40, 40); if (Math.abs(cur.vel) < 1.5) cur.snapTo = Math.round(cur.pos + cur.vel * 0.3); }
  else { const c = front(); if (c) { cur.flipYaw += Math.round((c.dragYaw || 0) / Math.PI) * Math.PI; c.yaw += 0; c.dragYaw = 0; } }
});
cv.addEventListener('pointercancel', () => { drag = null; });
cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hover.mouse = false; });
function front() { return cur && cur.cards.get(Math.round(cur.pos)); }
function hitFront(e) {
  const c = front(); if (!c) return false;
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  return ray.intersectObject(c.mesh, false).length > 0;
}

// ---------- Flights between a box on the table and the grid (section transitions) ----------
let flights = [];
// origin: { x, y } screen px of the box, w: px width of the box
// origin: a point on screen ({x, y, w}) the cards burst from, or a function giving the top end of the tuck box as it
// moves ({x, y, dx, dy, w}): then the cards stream out of that end one after another, each sliding straight out along
// the box before it curves off to its place, turning face up on the way
export function flyIn(origin) {
  const S = SETS[set];
  if (typeof origin === 'function') return streamIn(origin);
  const els = [...grid.children].filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
  const k = wpp();
  const o = { x: (origin.x - innerWidth / 2) * k, y: -(origin.y - innerHeight / 2) * k, s: ((origin.w || 60) * k) / S.stock.w * 0.45 };
  grid.classList.add('arriving'); grid.classList.remove('fresh');
  document.body.classList.add('overlay3d');
  const jobs = els.map((el, n) => new Promise((res) => {
    const i = +el.dataset.i; const c = makeCard(set, i);
    el.classList.add('pending');
    c.g.position.set(o.x, o.y, 0); c.g.scale.setScalar(o.s); c.mesh.rotation.y = Math.PI; // starts face down, like out of the box
    flights.push({ c, el, from: { ...o }, toEl: el, t: -n * 0.035 - 0.05, dur: 0.95, mode: 'in', res, spin: (n % 2 ? 1 : -1) * 0.25, lane: (els.length - n) * 0.45 });
  }));
  return Promise.all(jobs).then(() => { grid.classList.remove('arriving'); if (!cur) document.body.classList.remove('overlay3d'); });
}
export function flyOut(dest, streamEdge = null) {
  dropHover(true);
  const S = SETS[set];
  if (streamEdge) {
    const k = wpp(), els = [...grid.children].filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
    document.body.classList.add('overlay3d');
    els.forEach((el) => el.classList.add('away'));
    const jobs = els.map((el, n) => new Promise((res) => {
      const c = makeCard(set, +el.dataset.i), p = rectPose(el.getBoundingClientRect(), S.stock);
      c.g.position.set(p.x, p.y, 0); c.g.scale.setScalar(p.s); addRest(c, el);
      flights.push({ c, el, from: p, edge: () => edgePose(streamEdge(), k, S), t: -(els.length - 1 - n) * 0.026, dur: 0.8, mode: 'streamOut', res, lane: n * 0.4 });
    }));
    return Promise.all(jobs).then(() => { document.body.classList.remove('overlay3d'); els.forEach((el) => el.classList.remove('away')); });
  }
  const els = [...grid.children].filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
  const k = wpp();
  // dest may be a function: the box is moving (the camera flies out as the cards fly in), so aim at it every frame
  const toPose = (d) => ({ x: (d.x - innerWidth / 2) * k, y: -(d.y - innerHeight / 2) * k, s: ((d.w || 60) * k) / S.stock.w * 0.45 });
  const o = toPose(typeof dest === 'function' ? dest() : dest), track = typeof dest === 'function' ? () => toPose(dest()) : null;
  document.body.classList.add('overlay3d');
  els.forEach((el) => el.classList.add('away'));
  const jobs = els.map((el, n) => new Promise((res) => {
    const i = +el.dataset.i; const c = makeCard(set, i);
    const p = rectPose(el.getBoundingClientRect(), S.stock);
    c.g.position.set(p.x, p.y, 0); c.g.scale.setScalar(p.s); addRest(c, el);
    flights.push({ c, el, from: p, to: o, track, t: -(els.length - n) * 0.02, dur: 0.75, mode: 'out', res, spin: (n % 2 ? 1 : -1) * 0.25, lane: n * 0.45 });
  }));
  return Promise.all(jobs).then(() => { document.body.classList.remove('overlay3d'); els.forEach((el) => el.classList.remove('away')); });
}
// coming back to Look from a game: the grid's cards come in one by one from the side the game is leaving toward,
// each on a short arc that lands softly in its slot (reading order, 25 ms apart), starting once the game is partly away
export function sweepIn(dir, wait = 0.3) {
  const S = SETS[set], k = wpp();
  const els = [...grid.children].filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
  grid.classList.add('arriving'); grid.classList.remove('fresh');
  document.body.classList.add('overlay3d');
  const dur = 0.72;
  const jobs = els.map((el, n) => new Promise((res) => {
    const c = makeCard(set, +el.dataset.i), p = rectPose(el.getBoundingClientRect(), S.stock);
    el.classList.add('pending');
    const from = { x: p.x + dir * innerWidth * k * 0.8, y: p.y - 1.5, s: p.s };
    c.g.position.set(from.x, from.y, 0); c.g.scale.setScalar(p.s); c.g.visible = false;
    flights.push({ c, el, from, toEl: el, t: -(wait + n * 0.025) / dur, dur, mode: 'in', res, spin: (n % 2 ? 1 : -1) * 0.12, lane: (els.length - n) * 0.3, faceUp: true });
  }));
  return Promise.all(jobs).then(() => { grid.classList.remove('arriving'); if (!cur) document.body.classList.remove('overlay3d'); });
}
const edgePose = (E, k, S) => { const s = (E.w * k) / S.stock.w * 0.97; return { x: (E.x - innerWidth / 2) * k, y: -(E.y - innerHeight / 2) * k, s, dx: E.dx, dy: -E.dy }; };
function streamIn(edge) {
  const S = SETS[set], k = wpp();
  const els = [...grid.children].filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
  grid.classList.add('arriving'); grid.classList.remove('fresh');
  document.body.classList.add('overlay3d');
  const jobs = els.map((el, n) => new Promise((res) => {
    const c = makeCard(set, +el.dataset.i);
    el.classList.add('pending'); c.mesh.rotation.y = Math.PI; c.g.visible = false;
    flights.push({ c, el, toEl: el, edge: () => edgePose(edge(), k, S), t: -n * 0.028 - 0.02, dur: 0.82, mode: 'stream', res, lane: (els.length - n) * 0.4, bi: n, bn: els.length });
  }));
  return Promise.all(jobs).then(() => { grid.classList.remove('arriving'); if (!cur) document.body.classList.remove('overlay3d'); });
}
// a point on a curve that leaves p0 heading along (dx, dy) and arrives at p2
function curve(p0, dx, dy, p2, u, out) {
  const D = Math.hypot(p2.x - p0.x, p2.y - p0.y) * 0.45, cx = p0.x + dx * D, cy = p0.y + dy * D, a = 1 - u;
  out.x = a * a * p0.x + 2 * a * u * cx + u * u * p2.x; out.y = a * a * p0.y + 2 * a * u * cy + u * u * p2.y; return out;
}
const _cp = { x: 0, y: 0 };
function stepStream(f, t) {
  if (!f.from) { // leaves the box now: from wherever its top end is at this moment
    const E = f.edge(), L = (SETS[f.c.set].stock.h * E.s) / 2;
    f.from = { x: E.x + E.dx * L * 0.15, y: E.y + E.dy * L * 0.15, s: E.s }; f.dx = E.dx; f.dy = E.dy; f.c.g.visible = true;
    f.c.g.rotation.z = Math.atan2(E.dy, E.dx) - Math.PI / 2; f.rot0 = f.c.g.rotation.z;
    patter('slide', f.bi, f.bn, f.toEl, 0.12, 1.4);
  }
  if (!f.to) f.to = rectPose(f.toEl.getBoundingClientRect(), SETS[f.c.set].stock);
  // out of the slot first (straight, quick), then a smooth curve into its place, slowing as it arrives
  const u = ease.outCubic(t);
  curve(f.from, f.dx, f.dy, f.to, u, _cp);
  const arc = Math.sin(Math.PI * t);
  f.c.g.position.set(_cp.x, _cp.y, arc * 8 + f.lane * Math.min(1, t * 4) * (1 - t));
  f.c.g.scale.setScalar(lerp(f.from.s, f.to.s, ease.inOutCubic(t)));
  f.c.g.rotation.z = f.rot0 * (1 - ease.inOutCubic(clamp(t / 0.7, 0, 1))); // straightens to the grid
  const flipT = ease.inOutCubic(clamp((t - 0.25) / 0.5, 0, 1));
  f.c.mesh.rotation.set(arc * 0.08, Math.PI * (1 - flipT), 0);
  f.c.shadow.material.opacity = 0.3 * arc;
}
// a burst of cards or tiles (out of the box, back in, across the grid) is heard as one gesture, the way a real deck
// sounds: not every item makes a sound, fewer as it goes on, each a moment off the beat, quieter toward the end, and
// each placed where it lands
function patter(kind, i, n, el, vol, rate = 1) {
  const u = n > 1 ? i / (n - 1) : 0;
  if (i > 0 && Math.random() > 0.6 - 0.4 * u) return;
  const r = el && el.getBoundingClientRect();
  sound.play(kind, { vol: vol * (1 - 0.45 * u) * (0.7 + Math.random() * 0.3), rate, pan: r ? Math.max(-0.6, Math.min(0.6, ((r.left + r.width / 2) / innerWidth - 0.5) * 1.1)) : 0, delay: Math.random() * 35, gap: 0 });
}
function stepStreamOut(f, t) {
  const E = f.edge(), L = (SETS[f.c.set].stock.h * E.s) / 2;
  const to = { x: E.x + E.dx * L * 0.15, y: E.y + E.dy * L * 0.15, s: E.s };
  // the reverse: lifts out of the grid, curves round and arrives along the box's own line, sliding into the slot
  const u = ease.inOutCubic(t);
  curve(to, E.dx, E.dy, f.from, 1 - u, _cp);
  const arc = Math.sin(Math.PI * t);
  f.c.g.position.set(_cp.x, _cp.y, arc * 8 + f.lane * Math.min(1, t * 6) * (1 - t));
  f.c.g.scale.setScalar(lerp(f.from.s, to.s, u));
  const rot = Math.atan2(E.dy, E.dx) - Math.PI / 2; f.c.g.rotation.z = rot * ease.inOutCubic(clamp((t - 0.3) / 0.7, 0, 1));
  const flipT = ease.inOutCubic(clamp((t - 0.12) / 0.5, 0, 1));
  f.c.mesh.rotation.set(arc * 0.08, Math.PI * flipT, 0);
  f.c.shadow.material.opacity = 0.3 * arc;
  f.c.g.visible = t < 0.985; // gone into the box
}
// ---------- Memory tiles to and from their real places in the box ----------
// Each tile on the grid is one real tile in the box (tray.tile(k)). Out: it lifts straight up out of its stack in the
// 3D table scene; once clear of the walls the card here takes over at exactly the pose it has on screen, and flies to
// its grid place, turning face up. Back: the reverse, ending just above its own stack, where the real tile takes over
// again and drops onto the stack.
// The hand-over is exact: a flight runs in the table camera's own space, and is drawn here through the same projection
// (the two cameras differ only in field of view, so x and y are scaled by the ratio of their lens widths).
const _M = new THREE.Matrix4(), _M2 = new THREE.Matrix4(), _S = new THREE.Matrix4(), _sc = new THREE.Vector3(), _qI = new THREE.Quaternion();
const lensRatio = (hcam) => Math.tan(THREE.MathUtils.degToRad(FOV) / 2) / Math.tan(THREE.MathUtils.degToRad(hcam.fov) / 2);
function camPoseOf(mesh, hcam) {
  hcam.updateMatrixWorld(); mesh.updateMatrixWorld();
  _M.multiplyMatrices(hcam.matrixWorldInverse, mesh.matrixWorld);
  const p = { pos: new THREE.Vector3(), q: new THREE.Quaternion(), s: 1 }; _M.decompose(p.pos, p.q, _sc); p.s = _sc.x; return p;
}
// where the grid image is, in the table camera's space, facing the camera. depth: how far in front of the camera to
// put it. Any depth looks identical on screen (position and size scale together); it is kept well in front of the
// box, so a tile in flight is always nearer than the box and lid and can never seem to pass through them.
function gridPoseOf(el, stock, hcam, depth = CAMZ) {
  const r = rectPose(el.getBoundingClientRect(), stock), k = lensRatio(hcam), m = depth / CAMZ;
  return { pos: new THREE.Vector3((r.x / k) * m, (r.y / k) * m, -CAMZ * m), q: _qI.clone(), s: (r.s / k) * m };
}
const nearDepth = (from) => Math.min(CAMZ, -from.pos.z * 0.6);
function drawAt(c, pos, q, s, hcam) {
  const k = lensRatio(hcam);
  _S.makeScale(k, k, 1); _M.compose(pos, q, _sc.set(s, s, s));
  c.g.matrixAutoUpdate = false; c.g.matrix.multiplyMatrices(camera.matrixWorld, _M2.multiplyMatrices(_S, _M)); c.g.matrixWorldNeedsUpdate = true;
  c.mesh.rotation.set(0, 0, 0); c.shadow.visible = false;
}
const _p = new THREE.Vector3(), _q = new THREE.Quaternion();
// out = leaving the box: it carries on at the speed it was lifted with and slows into its place, turning face up
// over the whole trip; back = the reverse
// into = going into the tuck box: it doesn't stop at the opening, it reaches it still moving and slides straight in
function tweenPose(c, A, B, t, lane, hcam, out = false, into = false) {
  const e = out ? 1 - Math.pow(1 - t, 3) : into ? t * t * (2.2 - 1.2 * t) : ease.inOutCubic(t), arc = Math.sin(Math.PI * t);
  _p.lerpVectors(A.pos, B.pos, e); _p.z += arc * (3 + lane);
  _q.slerpQuaternions(A.q, B.q, out ? ease.inOutCubic(t) : ease.inOutCubic(clamp((t - 0.08) / 0.8, 0, 1)));
  drawAt(c, _p, _q, lerp(A.s, B.s, e), hcam);
}
// which tile in the box goes to which grid spot: by position, so paths fan out and never cross. The four stacks
// (back-left, back-right, front-left, front-right) fill the four quarters of the grid (top-left, top-right,
// bottom-left, bottom-right); within a quarter, in reading order, top of the stack first.
function trayOrder(els, n, seq) {
  if (seq) return els.slice(0, n).map((el, g) => g); // the tuck box: one after another, in reading order
  const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length || 6, rows = Math.ceil(n / cols), seen = [0, 0, 0, 0];
  return els.slice(0, n).map((el, g) => { const r = Math.floor(g / cols), c = g % cols, st = (r < rows / 2 ? 0 : 2) + (c < cols / 2 ? 0 : 1); return seen[st]++ * 4 + st; });
}
export const visibleCount = () => [...grid.children].filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }).length;
const onScreen = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };
export function trayIn(tray, onOut, onFirst) {
  const S = SETS[set], all = [...grid.children], els = tray.seq ? all.filter(onScreen) : all, n = Math.min(els.length, tray.count()), K = trayOrder(els, n, tray.seq);
  grid.classList.add('arriving'); grid.classList.remove('fresh');
  document.body.classList.add('overlay3d');
  const jobs = els.slice(0, n).map((el, g) => new Promise((res) => {
    const k = K[g]; el.classList.add('pending');
    flights.push({ mode: 'trayIn', el, k, tray, res, t: -k * TRAY_GAP, c: null, lane: (k % 4) * 0.6, last: k === n - 1, onOut, first: k === 0 ? onFirst : null, bi: k, bn: n });
  }));
  return Promise.all(jobs).then(() => { grid.classList.remove('arriving'); if (!cur) document.body.classList.remove('overlay3d'); });
}
export function trayOut(tray, onLastStart) {
  dropHover(true);
  const S = SETS[set], all = [...grid.children], els = tray.seq ? all.filter(onScreen) : all, n = Math.min(els.length, tray.count()), K = trayOrder(els, n, tray.seq);
  document.body.classList.add('overlay3d');
  els.slice(0, n).forEach((el) => el.classList.add('away'));
  const jobs = els.slice(0, n).map((el, g) => new Promise((res) => {
    const k = K[g], c = makeCard(set, +el.dataset.i); addRest(c, el);
    const f = { mode: 'trayOut', el, k, tray, res, c, t: -(n - 1 - k) * TRAY_GAP, lane: (k % 4) * 0.6, from: gridPoseOf(el, S.stock, tray.camera), last: k === 0 ? onLastStart : null, bi: n - 1 - k, bn: n };
    drawAt(c, f.from.pos, f.from.q, f.from.s, tray.camera);
    flights.push(f);
  }));
  return Promise.all(jobs).then(() => { document.body.classList.remove('overlay3d'); els.forEach((el) => el.classList.remove('away')); });
}
const TRAY_GAP = 0.04, TRAY_LIFT = 0.15, TRAY_FLY = 0.72;
function stepTray(f, dt) {
  f.t += dt; if (f.t < 0) return false;
  const S = SETS[set], T = f.tray, cam = T.camera;
  if (f.mode === 'trayIn') {
    const LT = T.liftTime || TRAY_LIFT;
    if (!f.started) { f.started = true; T.lift(f.k, 0); T.show(f.k, true); }
    if (f.t < LT) { const u = f.t / LT; T.lift(f.k, u * u); return false; } // straight out of its place, gathering speed
    if (!f.c) { // clear of the walls: the card here takes over at exactly the tile's pose
      T.lift(f.k, 1); f.c = makeCard(set, +f.el.dataset.i); f.from = camPoseOf(T.tile(f.k), cam); T.show(f.k, false);
      if (f.last && f.onOut) f.onOut(); // the box is empty now
      if (f.first) f.first(); // the first card is out
      // out of the tuck box: one slide as the deck comes out, then a soft patter as the cards spread; off the tile stacks:
      // a light patter of lifts
      patter('slide', f.bi, f.bn, f.el, 0.1, 1.35);
    }
    const u = clamp((f.t - LT) / TRAY_FLY, 0, 1);
    tweenPose(f.c, f.from, gridPoseOf(f.el, S.stock, cam, nearDepth(f.from)), u, f.lane, cam, true); arrive(f.c, f.el, u);
    if (u >= 1) { f.el.classList.remove('pending'); dispose(f.c); f.res(); return true; }
    return false;
  }
  // back: from the grid to just above its own stack (which may be moving with the box), then the real tile drops in
  if (f.last && f.t >= 0) { f.last(); f.last = null; } // the last one is on its way
  const u = clamp(f.t / TRAY_FLY, 0, 1);
  if (u < 1) {
    T.lift(f.k, 1); const to = camPoseOf(T.tile(f.k), cam);
    if (!f.near) { f.near = true; const g = gridPoseOf(f.el, S.stock, cam, nearDepth(to)); f.from = g; } // start well in front of the box
    tweenPose(f.c, f.from, to, u, f.lane, cam, false, T.seq); setRest(f.c, leave(u)); return false; // (tuck: arrives still moving, straight on in)
  }
  if (f.c) { dispose(f.c); f.c = null; T.show(f.k, true); T.lift(f.k, 1); }
  if (!f.clack && f.t - TRAY_FLY > (T.liftTime || TRAY_LIFT) * 0.8) { f.clack = true; // back: brushes as they gather, then the last one home settles the lot (a slide-in, a soft square-up / a stack)
    if (f.bi === f.bn - 1) { if (T.seq) sound.play('slide', { vol: 0.12, rate: 1.5, gap: 0 }); else sound.play('chipLay', { vol: 0.16, rate: 1.1, gap: 0 }); }
    else patter(T.seq ? 'slide' : 'chipLay', f.bi, f.bn, f.el, T.seq ? 0.12 : 0.16, T.seq ? 1.5 : 1.1); } // lands on its stack / slides home
  const d = clamp((f.t - TRAY_FLY) / (T.liftTime || TRAY_LIFT), 0, 1); T.lift(f.k, T.seq ? 1 - d * (2 - d) * 0.5 - d * 0.5 : 1 - d * d); // tuck: carries on at speed
  if (d >= 1) { if (T.hideAtEnd) T.show(f.k, false); f.res(); return true; } // (tuck: fully inside, gone)
  return false;
}
function updateFlights(dt) {
  for (let j = flights.length - 1; j >= 0; j--) {
    const f = flights[j];
    if (f.mode === 'trayIn' || f.mode === 'trayOut') { if (stepTray(f, dt)) flights.splice(j, 1); continue; }
    f.t += dt / f.dur;
    const t = clamp(f.t, 0, 1);
    if (f.mode === 'stream' || f.mode === 'streamOut') {
      if (f.t >= 0) { (f.mode === 'stream' ? stepStream : stepStreamOut)(f, t); if (f.mode === 'stream') arrive(f.c, f.el, t); else setRest(f.c, leave(t)); }
      else if (f.mode === 'streamOut') f.c.g.visible = true;
      if (f.t >= 1) { if (f.mode === 'stream') f.el.classList.remove('pending'); dispose(f.c); flights.splice(j, 1); f.res(); }
      continue;
    }
    if (f.mode === 'in' && !f.to) f.to = rectPose(f.toEl.getBoundingClientRect(), SETS[f.c.set].stock);
    if (f.track) f.to = f.track();
    const k = f.mode === 'in' ? ease.outCubic(t) : ease.inOutCubic(t);
    const arc = Math.sin(Math.PI * t);
    // each card keeps its own depth lane, so crossing paths never pass through each other
    f.c.g.position.set(lerp(f.from.x, f.to.x, k), lerp(f.from.y, f.to.y, k) + arc * 2.5, arc * 9 + f.lane * (f.mode === 'in' ? Math.min(1, arc * 3) : Math.min(1, t * 6)));
    f.c.g.scale.setScalar(lerp(f.from.s, f.to.s, k));
    // turn over only once the card is clear of its neighbours (mid-flight), never while bunched at the box
    const flipT = f.mode === 'in' ? ease.inOutCubic(clamp((t - 0.3) / 0.45, 0, 1)) : ease.inOutCubic(clamp((t - 0.12) / 0.45, 0, 1));
    f.c.mesh.rotation.set(arc * 0.1, f.faceUp ? 0 : f.mode === 'in' ? Math.PI * (1 - flipT) : Math.PI * flipT, f.spin * arc * 0.6);
    f.c.shadow.material.opacity = 0.35 * arc;
    if (f.mode === 'out') setRest(f.c, f.t < 0 ? 1 : leave(t)); else arrive(f.c, f.el, t);
    f.c.g.visible = f.t >= 0 || f.mode === 'out'; // a card waiting its turn to fly home stays exactly where its grid image was
    if (f.t >= 1) {
      if (f.mode === 'in') f.el.classList.remove('pending');
      dispose(f.c); flights.splice(j, 1); f.res();
    }
  }
}

export function setTheme(t) {}
export function resize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); if (cur) cur.to = centerPose(SETS[set].stock); }

// ---------- Frame ----------
export let blur = 0; // px, for the compositor
// A card's shadow never switches on or jumps: its strength and place ease toward where they should be, building up
// as the card settles in front of you and melting away as it leaves.
function shade(c, op, x, y, sx, dt) {
  const k = 1 - Math.exp(-dt * 4.5);
  c.shOp = (c.shOp ?? 0) + (op - (c.shOp ?? 0)) * k;
  c.shadow.position.x += (x - c.shadow.position.x) * k; c.shadow.position.y += (y - c.shadow.position.y) * k; c.shadow.position.z = -4;
  c.shadow.scale.x += (sx - c.shadow.scale.x) * k;
  c.shadow.material.opacity = c.shOp;
}
export function update(dt) {
  updateScroll(dt);
  updateFlights(dt);
  const hov = updateHover(dt);
  const sn = updateSnow3() > 0;
  blur = 0;
  if (!cur) return flights.length > 0 || hov || sn;
  const S = SETS[set], c0 = cur;
  if (c0.phase === 'in') {
    const c = c0.cards.get(c0.lastIdx);
    // a straight, soft move from its grid spot to the middle, growing to size, turning once around its upright axis on
    // the way and ending face on: no tilt, no roll, no arc
    c0.t = Math.min(1, c0.t + dt / 0.6); const k = ease.inOutCubic(c0.t);
    c.g.position.set(lerp(c0.from.x, c0.to.x, k), lerp(c0.from.y, c0.to.y, k), 0);
    c.g.scale.setScalar(lerp(c0.from.s, c0.to.s, k));
    c.roll = 0; c.yaw = 0; c.yawV = 0; c.mesh.rotation.set(0, -Math.PI * 2 * (1 - k), 0);
    shade(c, 0.55 * ease.inOutCubic(Math.max(0, (c0.t - 0.35) / 0.65)), 1.2, -1.6, 1, dt); // grows in as the card arrives
    setRest(c, leave(c0.t)); // while the page's shadow melts away from the slot
    if (c0.t >= 1) c0.phase = 'idle';
    return true;
  }
  if (c0.phase === 'out') {
    const c = c0.closingCard;
    c0.t = Math.min(1, c0.t + dt / 0.45); const k = ease.inOutCubic(c0.t);
    c.g.position.set(lerp(c0.from.x, c0.to.x, k), lerp(c0.from.y, c0.to.y, k), 0);
    c.g.scale.setScalar(lerp(c0.from.s, c0.to.s, k));
    [c.yaw, c.yawV] = spring(c.yaw, c.yawV, c.targetYaw, 30, 10, dt);
    [c.pitch, c.pitchV] = spring(c.pitch, c.pitchV, 0, 30, 10, dt);
    c.mesh.rotation.set(c.pitch, c.yaw, 0, 'YXZ'); // only undoes a turn the visitor gave it
    shade(c, 0, c.shadow.position.x, c.shadow.position.y, c.shadow.scale.x, dt * 2.2);
    c.shOp = c0.shFrom * (1 - k); c.shadow.material.opacity = c.shOp; // gone exactly as it lands
    setRest(c, sm((c0.t - 0.55) / 0.45)); // and the page's shadow is whole by then
    if (c0.t >= 1) {
      // swap 3D card for the grid image in the same frame, then drop the 3D layer
      if (c0.el) c0.el.classList.remove('away');
      dispose(c); cur = null; document.body.classList.remove('insp-single'); hintEl.textContent = HINT;
      if (!flights.length) document.body.classList.remove('overlay3d');
    }
    return true;
  }
  // ---- idle: carousel physics ----
  if (!(drag && drag.touch && drag.moved > 6 && !c0.external)) {
    if (c0.snapTo != null) {
      [c0.pos, c0.vel] = spring(c0.pos, c0.vel, c0.snapTo, 34, 11.2, dt);
      if (Math.abs(c0.pos - c0.snapTo) < 0.0005 && Math.abs(c0.vel) < 0.01) { c0.pos = c0.snapTo; c0.vel = 0; }
    } else {
      c0.pos += c0.vel * dt;
      c0.vel *= Math.exp(-dt * (Math.abs(c0.vel) > 8 ? 1.6 : 2.6));
      if (Math.abs(c0.vel) < 2.2) c0.snapTo = Math.round(c0.pos + c0.vel * 0.18);
    }
  }
  const speed = Math.abs(c0.vel);
  // which cards are on screen: neighbours of pos
  const lo = Math.floor(c0.pos) - (speed > 3 ? 1 : 0), hi = Math.ceil(c0.pos) + (speed > 3 ? 1 : 0);
  for (let k = lo; k <= hi; k++) if (!c0.cards.has(k)) { const c = makeCard(set, mod(k, list.length)); c.slot = k; c0.cards.set(k, c); }
  for (const [k, c] of c0.cards) if (k < lo - 1 || k > hi + 1) { dispose(c); c0.cards.delete(k); }
  const ri = Math.round(c0.pos);
  if (ri !== c0.lastIdx) {
    c0.lastIdx = ri; c0.flipYaw = 0;
    nameEl.textContent = list[mod(ri, list.length)].name;
    sound.tick(Math.min(1, speed / 30));
  }
  const to = c0.to, k = (2 * CAMZ * Math.tan(THREE.MathUtils.degToRad(FOV) / 2)) / innerHeight;
  const spacing = spacingPx() * k;
  let spinL = 0;
  for (const [kk, c] of c0.cards) {
    const off = kk - c0.pos;
    const isFront = kk === ri;
    const lean = clamp(-c0.vel * 0.02, -0.55, 0.55);
    c.g.position.set(to.x + off * spacing, to.y - Math.abs(off) * 0.6, -Math.min(6, Math.abs(off) * 6) - Math.min(4, speed * 0.12));
    c.g.scale.setScalar(to.s * (1 - Math.min(0.12, speed * 0.004)));
    // a resting card tips a little toward the cursor over it (mouse only): the side under the cursor dips away, at
    // most about 8 degrees, eased, and back to flat when the cursor leaves. A drag takes over from wherever it is.
    let tu = 0, tv = 0;
    if (isFront && hover.mouse && !drag && speed < 0.3) {
      const hw = (SETS[set].stock.w * c.g.scale.x) / 2 / k, hh = (SETS[set].stock.h * c.g.scale.x) / 2 / k;
      const cx = innerWidth / 2 + c.g.position.x / k, cy = innerHeight / 2 - c.g.position.y / k;
      const u = (hover.px - cx) / hw, v = (hover.py - cy) / hh;
      if (Math.abs(u) <= 1.04 && Math.abs(v) <= 1.04) { tu = clamp(u, -1, 1); tv = clamp(v, -1, 1); }
    }
    // the tilt rides on top of the card's own turn: the cursor is followed within about 0.1 s and the tilt itself on
    // a stiff, nearly critically damped spring (quick, no wobble). Up to ~12 degrees at the card's edges.
    const ke = 1 - Math.exp(-dt * 12);
    c.tu = (c.tu || 0) + (tu - (c.tu || 0)) * ke; c.tv = (c.tv || 0) + (tv - (c.tv || 0)) * ke;
    const flipped = Math.cos(c0.flipYaw) < 0 ? -1 : 1; // (turned over, its own x axis points the other way)
    [c.tiltY, c.tiltYV] = spring(c.tiltY || 0, c.tiltYV || 0, c.tu * 0.21, 80, 17, dt);
    [c.tiltX, c.tiltXV] = spring(c.tiltX || 0, c.tiltXV || 0, c.tv * 0.21 * flipped, 80, 17, dt);
    const targetYaw = (isFront ? c0.flipYaw + (c.dragYaw || 0) : 0) + lean;
    if (isFront && drag && (!drag.touch || c0.external) && drag.moved > 6) [c.yaw, c.yawV] = spring(c.yaw, c.yawV, c0.flipYaw + (c.dragYaw || 0), 60, 13, dt); // follows the hand, with a little weight
    else [c.yaw, c.yawV] = spring(c.yaw, c.yawV, targetYaw, 30, 10, dt);
    if (isFront && drag && !drag.touch && drag.moved > 6) [c.pitch, c.pitchV] = spring(c.pitch, c.pitchV, c.pitchGoal ?? c.pitch, 60, 13, dt);
    else { c.pitchGoal = undefined; [c.pitch, c.pitchV] = spring(c.pitch, c.pitchV, 0, 30, 10, dt); }
    c.mesh.rotation.set(c.pitch + c.tiltX, c.yaw + c.tiltY, 0, 'YXZ');
    if (isFront) { // turning it in the hand: only a faint tick each time its edge passes edge-on
      spinL = clamp((Math.abs(c.yawV) + Math.abs(c.pitchV) * 0.6 - 0.8) / 14, 0, 1);
      const side = Math.cos(c.yaw) < 0 ? -1 : 1; if (c.edgeSide && side !== c.edgeSide && spinL > 0.05) sound.tick(0.1 + spinL * 0.25); // a faint, light tick c.edgeSide = side;
    }
    c.mesh.position.y = 0;
    const edgeOn = Math.abs(Math.cos(c.yaw));
    shade(c, 0.55 * clamp(1 - Math.abs(off) * 1.5, 0, 1) * clamp(1 - speed / 12, 0.2, 1), -c.yaw * 0.4 + 1.2, -1.6 - c.pitch * 2, 0.35 + 0.65 * edgeOn, dt);
    if (isFront && speed < 0.6) upgrade(c);
  }
  sound.whoosh(clamp((speed - 2) / 28, 0, 1));
  // motion blur: how far the deck moves on screen this frame (px)
  blur = Math.min(220, speed * spacingPx() / 60 * 0.9);
  if (blur < 3) blur = 0;
  return true;
}
export const active = () => !!cur || flights.length > 0 || hovs.length > 0 || backdrop.focusAmount() > 0.001;
