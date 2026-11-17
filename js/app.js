// App shell: routing with continuous transitions (no blank screens), layered rendering, theme/sound/snow.
import * as THREE from 'three';
import { renderer, isTouch, matchPose, capPixelRatio } from './core.js';
import * as sound from './sound.js';
import * as backdrop from './backdrop.js';
import * as comp from './compositor.js';
import * as home from './home.js';
import * as gallery from './gallery.js';
import * as match from './match.js';
import * as book from './book.js';
import * as puzzle from './puzzle.js';
import * as solitaire from './solitaire.js';
import * as gofish from './gofish.js';
import * as crazy8 from './crazy8.js';
import { setManifest } from './cardtable.js';

const body = document.body;
const root = document.documentElement;
let manifest, view = null, ready = false;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

// ---------- Views ----------
// kind: 'home' | 'gallery' (DOM grid + 3D overlay) | 'stage' (full 3D scene)
// product groups the sub-navigation; modules for later sections register here too.
const VIEWS = {
  home: { kind: 'home', dom: 'view-home' },
  cards: { kind: 'gallery', dom: 'view-gallery', set: 'playing', product: 'cards', label: 'Look' },
  memory: { kind: 'gallery', dom: 'view-gallery', set: 'memory', product: 'memory', label: 'Look' },
  match: { kind: 'stage', dom: 'view-match', mod: match, product: 'memory', label: 'Play' },
  solitaire: { kind: 'stage', dom: 'view-solitaire', mod: solitaire, product: 'cards', label: 'Solitaire' },
  gofish: { kind: 'stage', dom: 'view-gofish', mod: gofish, product: 'cards', label: 'Go Fish' },
  crazy8: { kind: 'stage', dom: 'view-crazy8', mod: crazy8, product: 'cards', label: 'Crazy Eights' },
  book: { kind: 'stage', dom: 'view-book', mod: book, product: 'book' },
  puzzle: { kind: 'stage', dom: 'view-puzzle', mod: puzzle, product: 'puzzle' },
};
function register(name, def) { VIEWS[name] = def; buildSubnav(); }
const PRODUCTS = { cards: 'cards', memory: 'memory' };

// ---------- Layers ----------
const L = { home: 0, stage: 0 };       // opacities of the home scene and the current stage scene
let stageMod = null;                   // module rendered in the stage layer
const tweens = [];
function tween(obj, key, to, dur, delay = 0) {
  return new Promise((res) => tweens.push({ obj, key, from: null, to, dur, t: -delay, res }));
}
function runTweens(dt) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const w = tweens[i]; w.t += dt;
    if (w.t < 0) continue;
    if (w.from === null) w.from = w.obj[w.key];
    const k = Math.min(1, w.t / w.dur), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    w.obj[w.key] = w.from + (w.to - w.from) * e;
    if (k >= 1) { tweens.splice(i, 1); w.res(); }
  }
}

// ---------- Sub-navigation (modes of a product) ----------
const subnav = document.getElementById('subnav');
// plain tooltips, on controls only (never on the cards and products themselves)
const TIPS = { cards: 'See every card up close', memory: 'See every tile up close', match: 'Play Memory Match', solitaire: 'Play Klondike Solitaire', gofish: 'Play Go Fish', crazy8: 'Play Crazy Eights' };
const tip = (el, t) => { if (el) { el.setAttribute('aria-label', t); el.title = t; } };
function buildSubnav() {
  subnav.innerHTML = '';
  const back = document.createElement('a'); back.href = '#home'; back.className = 'sub-back'; back.setAttribute('aria-label', 'Back to the collection'); back.title = 'Back to the collection';
  back.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  subnav.appendChild(back);
  const pills = document.createElement('div'); pills.className = 'sub-pills'; subnav.appendChild(pills);
  for (const [name, v] of Object.entries(VIEWS)) {
    if (!v.product || !v.label) continue;
    const a = document.createElement('a'); a.href = '#' + name; a.textContent = v.label; a.dataset.view = name; a.dataset.product = v.product; a.title = TIPS[name] || v.label;
    pills.appendChild(a);
  }
  syncSubnav();
}
function syncSubnav() {
  const v = VIEWS[view] || {};
  subnav.classList.toggle('on', view !== 'home');
  subnav.querySelector('.sub-pills').hidden = !v.label;
  subnav.dataset.product = v.product || '';
  subnav.querySelectorAll('.sub-pills a').forEach((a) => {
    a.hidden = a.dataset.product !== v.product;
    a.setAttribute('aria-current', a.dataset.view === view ? 'page' : 'false');
  });
}

// ---------- Theme / sound / snow ----------
function applyTheme(t, fade = false) {
  root.dataset.theme = t;
  try { localStorage.setItem('jm-theme', t); } catch (e) {}
  document.querySelector('meta[name=theme-color]').setAttribute('content', t === 'dark' ? '#0f0d0b' : '#e3dccf');
  tip(document.getElementById('btn-theme'), t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  backdrop.setTheme(t, fade); home.setTheme(t); gallery.setTheme(t);
  for (const v of Object.values(VIEWS)) if (v.mod && v.mod.setTheme) v.mod.setTheme(t);
}
// ---------- About panel ----------
const info = document.getElementById('info'), infoBtn = document.getElementById('btn-info');
// the credits rise in with a little spring, and a few flakes puff off the card as it lands; the snow plays in front of
// the blurred page while they're open
function openInfo() {
  info.hidden = false; document.body.classList.add('info-open'); requestAnimationFrame(() => info.classList.add('on'));
  setTimeout(() => { if (info.classList.contains('on')) backdrop.puff(info.querySelector('.info-card').getBoundingClientRect(), 16); }, 220); sound.unlock(); sound.play('slide', { vol: 0.16, rate: 1.1 }); info.querySelector('a:not(.info-logo-link)').focus({ preventScroll: true }); }
function closeInfo() { if (info.hidden) return; info.classList.remove('on'); sound.play('slide', { vol: 0.12, rate: 1.3 }); setTimeout(() => { if (!info.classList.contains('on')) { info.hidden = true; document.body.classList.remove('info-open'); } }, 540); infoBtn.focus({ preventScroll: true }); }
infoBtn.addEventListener('click', () => (info.hidden ? openInfo() : closeInfo()));
info.addEventListener('click', (e) => { if (e.target === info) closeInfo(); });
// switching themes works like a dimmer: everything eases over ~0.8 s together. The page and controls fade their
// colours (css), the backdrop and snow cross-fade (backdrop.js), and the 3D scenes cross-fade from a snapshot of the
// last frame in the old light to the live frame in the new one.
const DIM = 800;
const dimCv = document.createElement('canvas'); dimCv.id = 'dim-shot';
Object.assign(dimCv.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '1', opacity: '0' });
document.getElementById('gl').after(dimCv);
let themeSwap = null, dimT = 0;
// Full screen: shown only where the browser allows it for a page (not on iPhone or iPad). F toggles it too.
const fullBtn = document.getElementById('btn-full'), page = document.documentElement;
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
const canFull = !!(page.requestFullscreen || page.webkitRequestFullscreen) && (document.fullscreenEnabled || document.webkitFullscreenEnabled);
function toggleFull() {
  sound.unlock(); sound.toggle(!fsEl());
  if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else { const r = (page.requestFullscreen || page.webkitRequestFullscreen).call(page); if (r && r.catch) r.catch(() => {}); }
}
function syncFull() { const on = !!fsEl(); fullBtn.classList.toggle('on', on); tip(fullBtn, on ? 'Exit full screen (F)' : 'Full screen (F)'); fullBtn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen'); }
if (canFull) {
  fullBtn.hidden = false; syncFull();
  fullBtn.addEventListener('click', toggleFull);
  document.addEventListener('fullscreenchange', syncFull); document.addEventListener('webkitfullscreenchange', syncFull);
  addEventListener('keydown', (e) => {
    if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.target.closest('input, textarea, [contenteditable]')) { e.preventDefault(); toggleFull(); }
  });
}
document.getElementById('btn-theme').addEventListener('click', () => {
  sound.unlock(); sound.toggle(root.dataset.theme === 'dark'); // (light on)
  themeSwap = root.dataset.theme === 'dark' ? 'light' : 'dark'; // applied right after the next frame is drawn
});
function swapTheme() {
  const gl = renderer.domElement;
  dimCv.width = gl.width; dimCv.height = gl.height; dimCv.style.zIndex = getComputedStyle(gl).zIndex;
  dimCv.getContext('2d').drawImage(gl, 0, 0); // the frame just drawn, in the old light
  dimCv.style.opacity = '1'; dimK = 0;
  root.classList.add('theme-fade'); clearTimeout(dimT); dimT = setTimeout(() => root.classList.remove('theme-fade'), DIM + 120);
  applyTheme(themeSwap, true); themeSwap = null;
}
// the snapshot fades on the same clock as the sky and snow, frame by frame, so the three stay in step
let dimK = 1;
function stepDim(dt) {
  if (dimK >= 1) return;
  dimK = Math.min(1, dimK + dt * 1000 / DIM); const e = dimK * dimK * (3 - 2 * dimK);
  dimCv.style.opacity = (1 - e).toFixed(4);
}
const sbtn = document.getElementById('btn-sound');
function syncSound() { sbtn.classList.toggle('off', !sound.isOn()); tip(sbtn, sound.isOn() ? 'Mute sound (hover for volume)' : 'Turn sound on'); }
const snowBtn = document.getElementById('btn-snow');
function syncSnow() { snowBtn.classList.toggle('off', !backdrop.snow()); tip(snowBtn, backdrop.snow() ? 'Stop the snow (hover for amount)' : 'Let it snow'); }
// A button with a little slider under it (the snow amount, the volume): it opens on hover (or press-and-hold on touch),
// stays while the pointer is on it, closes a beat after it leaves. Arrow down from the button reaches it by keyboard.
const sliders = []; // only one slider is ever open: opening one closes the other at once
function slider(ctl, btn, el, get, set, onClick) {
  const track = el.querySelector('.track');
  let closeT = 0, holdT = 0, held = false, step = -1;
  // closed for the other one: gone in that same frame (no fade), so the two never show together
  const shut = () => { if (!ctl.classList.contains('open')) return; clearTimeout(closeT); el.classList.remove('drag'); ctl.classList.add('instant'); ctl.classList.remove('open'); requestAnimationFrame(() => requestAnimationFrame(() => ctl.classList.remove('instant'))); };
  sliders.push(shut);
  const show = () => { for (const s of sliders) if (s !== shut) s(); clearTimeout(closeT); ctl.classList.add('open'); };
  const hide = (ms = 500) => { clearTimeout(closeT); closeT = setTimeout(() => { if (!el.classList.contains('drag')) ctl.classList.remove('open'); }, ms); };
  const paint = () => { const v = get(); el.style.setProperty('--v', v.toFixed(3)); el.setAttribute('aria-valuenow', Math.round(v * 100)); };
  paint();
  btn.addEventListener('click', () => { if (held) { held = false; return; } onClick(); });
  ctl.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') show(); });
  ctl.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  btn.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') { clearTimeout(holdT); holdT = setTimeout(() => { held = true; show(); }, 420); } });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((k) => btn.addEventListener(k, () => clearTimeout(holdT)));
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerdown', (e) => { if (!ctl.contains(e.target)) { clearTimeout(closeT); ctl.classList.remove('open'); } });
  const at = (x) => { const r = track.getBoundingClientRect(); set((x - r.left) / r.width); paint(); const st = Math.round(get() * 10); if (st !== step) { step = st; sound.tick(0.15); } }; // a faint tick every tenth
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('drag'); at(e.clientX); show(); });
  el.addEventListener('pointermove', (e) => { if (el.classList.contains('drag')) at(e.clientX); });
  const end = (e) => { if (!el.classList.contains('drag')) return; el.classList.remove('drag'); if (e.pointerType === 'mouse' && !ctl.matches(':hover')) hide(); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('keydown', (e) => { const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.05 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.05 : 0; if (d) { set(get() + d); paint(); e.preventDefault(); } });
  btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { show(); el.tabIndex = 0; el.focus(); e.preventDefault(); } });
  el.addEventListener('blur', () => hide(300));
}
slider(document.getElementById('snow-ctl'), snowBtn, document.getElementById('snow-amt'), backdrop.amount, backdrop.setAmount, () => { sound.unlock(); backdrop.setSnow(!backdrop.snow()); syncSnow(); sound.toggle(backdrop.snow()); });
// the volume: moving it also turns the sound on (it's what anyone dragging it wants)
slider(document.getElementById('vol-ctl'), sbtn, document.getElementById('vol-amt'), sound.getVolume, (v) => { sound.setVolume(v); if (!sound.isOn() && v > 0.02) { sound.setOn(true); syncSound(); } }, () => { const on = !sound.isOn(); if (!on) sound.toggle(false); sound.setOn(on); syncSound(); if (on) sound.toggle(true); }); // (the off click plays just before it goes quiet)
syncSound(); syncSnow();
addEventListener('pointerdown', () => sound.unlock(), { once: true, capture: true });
// touch: a long press never brings up the browser's menu or starts a selection (holding a button opens its slider)
const touchOnly = matchMedia('(hover: none), (pointer: coarse)');
for (const k of ['contextmenu', 'selectstart']) addEventListener(k, (e) => { if (touchOnly.matches && !e.target.closest?.('input, textarea')) e.preventDefault(); });

// ---------- Routing ----------
function routeFromHash() { const h = location.hash.replace('#', ''); return VIEWS[h] ? h : 'home'; }
let busy = null, queued = null;
async function go(next) {
  if (next === view) return;
  if (busy) { queued = next; return; }
  busy = true;
  try { await transition(view, next); } finally {
    busy = false;
    if (queued && queued !== view) { const q = queued; queued = null; go(q); } else queued = null;
  }
}
function showDom(name) {
  backdrop.allowGold(!(VIEWS[name].kind === 'stage' && name !== 'book'));
  const id = VIEWS[name].dom;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === id));
  body.className = body.className.replace(/\bv-\w+/g, '').trim(); body.classList.add('v-' + name);
}
async function prepare(name) {
  const v = VIEWS[name];
  if (v.kind === 'gallery') await gallery.preloadThumbs(v.set);
  if (v.kind === 'stage' && v.mod.prepare) await v.mod.prepare(manifest);
}
const ORDER = Object.keys(VIEWS);
const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const clamp01 = (x) => Math.max(0, Math.min(1, x));
// the real memory tiles in the box, as the gallery sees them
// the playing cards inside the tuck box, the same way: they slide out of its top end and back in
const TUCK = { seq: true, hideAtEnd: true, liftTime: 0.22, count: () => 54, tile: (k) => home.tuckTile(k), lift: (k, a) => home.tuckSlide(k, a), show: (k, v) => home.tuckShow(k, v), get camera() { return home.camera; } };
const TRAY = { count: () => home.trayCount(), tile: (k) => home.trayTile(k), lift: (k, a) => home.trayLift(k, a), show: (k, v) => home.trayShow(k, v), get camera() { return home.camera; } };
const lerpPose = (A, B, e) => ({ pos: A.pos.clone().lerp(B.pos, e), look: A.look.clone().lerp(B.look, e) });
// The storybook and the puzzle box on the home table are drawn by their own scenes, through the home camera
// (matched on the piece), so moving between home and them never swaps one object for another.
const COMP = { book: { mod: book, anchor: () => book.anchorClosed(), on: false }, puzzle: { mod: puzzle, anchor: () => puzzle.anchor(), on: false } };
// back on the home table, the book is shut and the puzzle's board is off to the side, whatever was left open
function restCompanions() { for (const c of Object.values(COMP)) if (c.on && stageMod !== c.mod) c.mod.companion(); }
async function companionsReady() {
  for (const [id, c] of Object.entries(COMP)) {
    if (c.on) continue;
    await c.mod.prepare(manifest); c.mod.companion(); home.useCompanion(id); c.on = true;
  }
}
const Sh = { home: 0, stage: 0, prev: 0 }; // sideways push of each 3D layer during a slide (in screen widths)
let prevMod = null, slideBlur = 0;
const anims = [];
// a timed animation with an eased value and its speed (screens per second), driven by the render loop
function animate(dur, fn) { return new Promise((res) => anims.push({ t: 0, dur, fn, res, last: 0 })); }
function runAnims(dt) {
  for (let i = anims.length - 1; i >= 0; i--) {
    const a = anims[i]; a.t = Math.min(a.dur, a.t + dt);
    const k = a.t / a.dur, e = k * k * k * (k * (k * 6 - 15) + 10);
    const v = (e - a.last) / Math.max(dt, 1e-3); a.last = e; a.fn(e, v);
    if (k >= 1) { anims.splice(i, 1); a.res(); }
  }
}
// Between any two views without a shared object: both scenes are live and push sideways together, like turning
// to the next table, with a little motion blur at speed. The controls stay put and simply change over in place.
// Order follows the sub-navigation.
async function slideTo(from, to, ready) {
  const F = VIEWS[from], T = VIEWS[to];
  const dir = ORDER.indexOf(to) >= ORDER.indexOf(from) ? 1 : -1;
  await ready;
  if (F.kind === 'home') home.leave();
  if (F.kind === 'stage') { F.mod.leave && F.mod.leave(); prevMod = F.mod; stageMod = null; L.stage = 0; Sh.prev = 0; }
  if (T.kind === 'stage') { stageMod = T.mod; T.mod.enter && T.mod.enter(); L.stage = 1; Sh.stage = dir; }
  if (T.kind === 'home') { restCompanions(); home.enter(null); home.settle(); L.home = 1; Sh.home = dir; }
  if (T.kind === 'gallery') { gallery.show(T.set); if (F.kind === 'stage') { await gallery.preloadThumbs(T.set); gallery.sweepIn(dir, 0.3); } } // the cards fly in one by one
  body.classList.toggle('gl-passive', T.kind === 'gallery');
  view = to; showDom(to); syncSubnav();
  await animate(0.85, (e, v) => {
    const out = -dir * e, inn = dir * (1 - e);
    if (F.kind === 'home') Sh.home = out; if (F.kind === 'stage') Sh.prev = out;
    if (T.kind === 'home') Sh.home = inn; if (T.kind === 'stage') Sh.stage = inn;
    slideBlur = Math.min(40, Math.abs(v) * innerWidth * 0.012);
  });
  if (F.kind === 'home') L.home = 0;
  prevMod = null; slideBlur = 0; Sh.home = Sh.stage = Sh.prev = 0;
}
async function transition(from, to) {
  const F = VIEWS[from] || {}, T = VIEWS[to];
  if (gallery.isOpen()) { gallery.close(); await wait(650); }
  const ready = prepare(to);
  // --- home -> a product gallery: the box opens, its cards fly out into the grid ---
  if (F.kind === 'home' && T.kind === 'gallery') {
    await ready;
    home.leave(); home.focus(T.product); home.clearFor(T.product);
    gallery.show(T.set);
    await wait(T.product === 'memory' ? 560 : T.product === 'cards' ? 120 : 380); // memory: the lid is well open first; cards stream out while the rest of the table is still clearing
    const origin = home.screenOf(T.product);
    view = to; showDom(to); syncSubnav(); body.classList.add('gl-passive');
    // playing cards stream out of the far (top) end of the tuck box, and the box is pushed off the bottom of the view as
    // they go; memory tiles lift out of the open box, which then slides away
    const tuck = T.product === 'cards';
    const mem = T.product === 'memory';
    // the box leaves once its contents are out (the tuck box is pushed away as the cards stream out of it). Tied to the
    // flights themselves, not to a clock, so a slow device keeps the same order of events
    const leave = () => { if (view === to) home.dropFocus(); };
    // the tuck box starts to drift away as the first card shoots out of it (and speeds up as the rest follow)
    const fly = mem ? gallery.trayIn(TRAY, leave) : tuck ? gallery.trayIn(TUCK, null, leave) : gallery.flyIn(origin);
    if (!mem && !tuck) wait(650).then(leave);
    Promise.all([fly, wait(1300)]).then(() => wait(1000)).then(() => { if (view === to) L.home = 0; });
    await fly;
    return;
  }
  // --- gallery -> home: one move. The camera flies straight out to the wide view while the table and the open box
  // slide back into place, and the cards on screen fly home into the box, following it as it moves. ---
  if (F.kind === 'gallery' && T.kind === 'home') {
    restCompanions(); home.returnFrom(F.product); L.home = 1;
    const P0 = home.zoomPose(F.product), P1 = home.widePose();
    home.drive(P0); home.update(0);
    let fly;
    if (F.product === 'memory') { home.trayFill(1); home.trayOut(true); home.holdLid('memory'); fly = gallery.trayOut(TRAY, () => home.releaseLid('memory')); } // the lid comes back as the last tile heads in
    else if (F.product === 'cards') { const n = gallery.visibleCount(); home.riseWhileReceiving(0.2, 0.04 * n + 0.72 + 0.1); fly = gallery.trayOut(TUCK); } // back into the tuck box through its top end, as it rises
    else fly = gallery.flyOut(() => home.screenOf(F.product));
    view = to; showDom(to); syncSubnav(); body.classList.remove('gl-passive');
    await animate(1.05, (e) => home.drive(lerpPose(P0, P1, e)));
    home.drive(null); home.finishReturn();
    await fly;
    return;
  }
  // --- home -> storybook / puzzle: one camera move. The book and the box on the home table are already drawn by their
  // own scenes, so the camera simply flies from the wide view to the working view; nothing is swapped. The puzzle's
  // board and pieces slide in beside the box as the camera arrives. ---
  if (F.kind === 'home' && T.kind === 'stage' && T.mod.companion) {
    await ready; await companionsReady();
    home.leave(); home.clearFor(T.product); // the rest of the table slides away as the camera flies in
    const c = COMP[T.product], hA = home.anchor(T.product), sA = c.anchor();
    const goal = T.mod.homePose(), gcam = T.mod.camera.clone(); gcam.position.copy(goal.pos); gcam.lookAt(goal.look); gcam.updateMatrixWorld();
    const P0 = home.currentPose(), P1 = matchPose(gcam, sA, hA), cam = T.mod.camera.clone();
    stageMod = T.mod; L.stage = 1;
    view = to; showDom(to); syncSubnav(); body.classList.remove('gl-passive');
    let waveOn = false;
    await animate(1.15, (e) => {
      const pose = lerpPose(P0, P1, e); home.drive(pose);
      cam.position.copy(pose.pos); cam.lookAt(pose.look); cam.updateMatrixWorld();
      T.mod.drive(matchPose(cam, hA, sA));
      if (T.mod.slideIn && e > 0.06 && !waveOn) { waveOn = true; T.mod.slideIn(1.3); } // finishes just after the camera arrives
    });
    L.home = 0; home.drive(null); T.mod.enterDone();
    return;
  }
  // --- storybook / puzzle -> home: one camera move straight back to the wide view. The book shuts from wherever it
  // is open (the puzzle's board and pieces slide away) on the way; the piece simply stays on the table. ---
  if (F.kind === 'stage' && T.kind === 'home' && F.mod.companion) {
    view = to; showDom(to); syncSubnav(); body.classList.remove('gl-passive');
    home.enter(null); home.settle(); home.slideBackFor(F.product);
    const c = COMP[F.product], hA = home.anchor(F.product), sA = c.anchor();
    const P0 = matchPose(F.mod.camera, sA, hA), P1 = home.widePose(), cam = F.mod.camera.clone();
    if (F.mod.beginClose) F.mod.beginClose(); else F.mod.beginLeave();
    home.drive(P0); L.home = 1;
    if (F.mod.slideOut) F.mod.slideOut(0.98); // done just as the camera arrives home
    await animate(1.0, (e) => {
      const pose = lerpPose(P0, P1, e); home.drive(pose);
      cam.position.copy(pose.pos); cam.lookAt(pose.look); cam.updateMatrixWorld();
      F.mod.drive(matchPose(cam, hA, sA));
      if (F.mod.closeTo) F.mod.closeTo(Math.min(1, e * 1.3));
    });
    home.drive(null);
    if (F.mod.endClose) F.mod.endClose();
    F.mod.leave && F.mod.leave(); F.mod.companion(); L.stage = 0; stageMod = null;
    return;
  }
  // --- Memory Match -> home: the tiles slide quickly off to the left while the camera pulls straight back from the
  // open box to the whole collection, in one move ---
  if (F.kind === 'stage' && T.kind === 'home' && F.mod.slideAway) {
    view = to; showDom(to); syncSubnav(); body.classList.remove('gl-passive');
    restCompanions(); home.returnFrom(F.product); home.trayFill(1); home.closeLidIn(0.35); L.home = 1;
    const P0 = home.zoomPose(F.product), P1 = home.widePose();
    home.drive(P0); F.mod.slideAway();
    await animate(1.05, (e) => home.drive(lerpPose(P0, P1, e)));
    home.drive(null); home.finishReturn();
    F.mod.leave && F.mod.leave(); L.stage = 0; stageMod = null;
    return;
  }
  // --- two looks at the same grid ---
  if (F.dom === T.dom) { await ready; view = to; showDom(to); syncSubnav(); gallery.show(T.set); return; }
  // --- everything else: push sideways to the next table ---
  await slideTo(from, to, ready);
}
addEventListener('hashchange', () => go(routeFromHash()));

// ---------- Up one level: Back, Esc, the back arrow ----------
// The browser history mirrors the levels: home, then a product (one entry, whichever of its modes you're in; switching
// modes replaces it), then the close-up. So the browser's Back (and a phone's swipe back), Esc and the back arrow all
// go up exactly one level: close-up, then the product, then home.
const depth = () => (history.state && history.state.d) || 0;
function enter(name) { history.pushState({ d: depth() + 1 }, '', '#' + name); go(name); }
function sideways(name) {
  const swap = () => { history.replaceState({ d: depth() }, '', '#' + name); go(name); };
  if (!insp) return swap();
  insp = false; gallery.close(); // out of the close-up first (its history entry goes), then across
  addEventListener('popstate', swap, { once: true }); history.back();
}
function toHome() { const d = depth(); if (d > 0) history.go(-d); else { history.replaceState({ d: 0 }, '', '#home'); go('home'); } }
function up() {
  if (gallery.isOpen()) { gallery.close(); return; }
  if (view === 'home') return;
  if (depth() > 0) history.back(); else { history.replaceState({ d: 0 }, '', '#home'); go('home'); }
}
let insp = false;
gallery.onInspect((open) => {
  if (open) { insp = true; history.pushState({ d: depth() + 1, insp: 1 }, '', location.hash); }
  else if (insp) { insp = false; if (history.state && history.state.insp) history.back(); }
});
addEventListener('popstate', () => { if (insp && !(history.state && history.state.insp)) { insp = false; gallery.close(); } });
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!info.hidden) closeInfo();
  else if (gallery.isOpen()) gallery.close();
  else if (view === 'book' && book.isZoomed()) return; // the book steps out of its zoom first
  else up();
});
subnav.addEventListener('click', (e) => {
  const a = e.target.closest('a'); if (!a) return;
  e.preventDefault(); sound.unlock();
  if (a.classList.contains('sub-back')) return up();
  if (a.dataset.view && a.dataset.view !== view) sideways(a.dataset.view);
});
// the logo goes home; five quick clicks on it (within two seconds) whip up a little snowstorm
let logoClicks = [];
document.querySelector('.brand').addEventListener('click', (e) => {
  e.preventDefault();
  const now = performance.now(); logoClicks = logoClicks.filter((t) => now - t < 2000); logoClicks.push(now);
  if (logoClicks.length >= 5) { logoClicks = []; backdrop.snowstorm(); syncSnow(); sound.unlock(); sound.play('storm', { vol: 0.35, dur: 6800 }); } // (the storm lasts 7 s; kept quiet)
  if (view !== 'home' || gallery.isOpen()) toHome();
});
// the golden flake: caught by a click or tap right on it (and that tap does nothing else). It only drifts by outside
// the games.
addEventListener('pointerdown', (e) => {
  if (!backdrop.catchGold(e.clientX, e.clientY, e.pointerType === 'mouse' ? 30 : 44)) return;
  e.stopPropagation(); e.preventDefault();
  const eat = (c) => { c.stopPropagation(); c.preventDefault(); };
  for (const k of ['pointerup', 'click']) { addEventListener(k, eat, { capture: true, once: true }); setTimeout(() => removeEventListener(k, eat, true), 600); }
  sound.unlock(); sound.chime([0, 4, 7, 11, 14], { vol: 0.3, gap: 0.07 });
}, true);
home.onSelect((route) => enter(route.replace('#', '')));
home.setRouteReady((route) => !!VIEWS[route.replace('#', '')]);
// a piece pointed at on the table starts loading its section right away (ahead of the background warm-up)
const warmed = new Set();
home.onHover((route) => { const name = route.replace('#', ''); if (!VIEWS[name] || warmed.has(name)) return; warmed.add(name); prepare(name).catch(() => warmed.delete(name)); });

// ---------- Device tilt (live site only; needs permission on iOS) ----------
let gyroOn = false;
function enableGyro() {
  if (gyroOn || !isTouch) return;
  const start = () => {
    gyroOn = true; let base = null;
    addEventListener('deviceorientation', (e) => {
      if (e.beta == null) return;
      if (!base) base = { b: e.beta, g: e.gamma };
      base.b += (e.beta - base.b) * 0.01; base.g += (e.gamma - base.g) * 0.01;
      const x = Math.max(-1, Math.min(1, (e.gamma - base.g) / 25)), y = Math.max(-1, Math.min(1, (e.beta - base.b) / 25));
      home.setGyro(x * 0.6, y * 0.6);
    });
  };
  const D = window.DeviceOrientationEvent;
  if (D && typeof D.requestPermission === 'function') D.requestPermission().then((s) => { if (s === 'granted') start(); }).catch(() => {});
  else if (D) start();
}
addEventListener('pointerup', enableGyro, { once: true });

// ---------- Resize ----------
function resize() {
  renderer.setSize(innerWidth, innerHeight, false); comp.resize();
  home.resize(); gallery.resize();
  for (const v of Object.values(VIEWS)) if (v.mod && v.mod.resize) v.mod.resize();
}
addEventListener('resize', resize);

// ---------- Loop ----------
let last = performance.now(), dim = 1;
const PAPER_GAIN = gallery.PAPER_GAIN; // calibrated so a face-on card's paper renders at the printed colour
const TABLE_GAIN = { dark: [1.18, 1.28, 1.45], light: [0.86, 0.877, 0.94] }; // calibrated per theme (face-up card on a table)
const tableGain = (dark) => TABLE_GAIN[dark ? 'dark' : 'light'];
// Adaptive quality: if frames keep coming slowly (under ~36 fps for 3 s straight), step down once: first no
// supersampling, lighter depth of field and fewer flakes; then fewer pixels. It only ever steps down, so it never
// flickers between levels.
let quality = 0, slowFor = 0, settleFor = 4, ema = 1 / 60;
function watchSpeed(raw) {
  if (raw > 0.25) return; // a hitch (tab switch, a long load) isn't the device being slow
  ema += (raw - ema) * 0.1;
  if ((settleFor -= raw) > 0 || quality >= 2) return;
  slowFor = ema > 1 / 36 ? slowFor + raw : 0;
  if (slowFor < 3) return;
  quality++; slowFor = 0; settleFor = 4;
  comp.setQuality(quality); backdrop.setQuality(quality);
  if (quality === 2) { capPixelRatio(1.25); resize(); }
}
// a hidden tab: drawing, the snow and the sound all stop, and pick up again as if no time passed
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { renderer.setAnimationLoop(null); sound.pause(); }
  else { last = performance.now(); settleFor = 2; sound.resume(); renderer.setAnimationLoop(loop); }
});
renderer.setAnimationLoop(loop);
function loop() {
  const now = performance.now(), raw = (now - last) / 1000, dt = Math.min(0.05, raw); last = now;
  if (ready) watchSpeed(raw);
  backdrop.frame(dt);
  if (!ready) return;
  runTweens(dt); runAnims(dt);
  const dark = root.dataset.theme === 'dark';
  const layers = [];
  if (L.home > 0.001) {
    home.update(dt); layers.push({ scene: home.scene, camera: home.camera, opacity: L.home, slot: 'A', linear: true, gain: tableGain(dark), shift: Sh.home, blur: slideBlur });
    for (const [id, c] of Object.entries(COMP)) {
      if (!c.on || stageMod === c.mod || prevMod === c.mod) continue;
      c.mod.drive(matchPose(home.camera, home.anchor(id), c.anchor())); c.mod.update(dt);
      layers.push({ scene: c.mod.scene, camera: c.mod.camera, opacity: L.home, slot: 'A', linear: true, gain: tableGain(dark), shift: Sh.home, blur: slideBlur });
    }
  }
  if (prevMod) { prevMod.update(dt); layers.push({ scene: prevMod.scene, camera: prevMod.camera, opacity: 1, slot: 'A', linear: true, gain: tableGain(dark), shift: Sh.prev, blur: slideBlur }); }
  dim += ((gallery.isOpen() && stageMod && VIEWS[view] && VIEWS[view].kind === 'stage' ? 0.25 : 1) - dim) * (1 - Math.exp(-dt * 8));
  if (stageMod && L.stage > 0.001) { stageMod.update(dt); layers.push({ scene: stageMod.scene, camera: stageMod.camera, opacity: L.stage * dim, slot: 'A', linear: true, gain: tableGain(dark), shift: Sh.stage, blur: slideBlur }); }
  const g = gallery.update(dt);
  if (g || gallery.active()) layers.push({ scene: gallery.scene, camera: gallery.camera, opacity: 1, slot: 'B', blur: gallery.blur, linear: true, gain: PAPER_GAIN, lens: gallery.lens() });
  comp.render(layers);
  stepDim(dt);
  if (themeSwap) swapTheme();
  snowFollow(layers);
}

// ---------- The snow is in the same space as the scene ----------
// Each frame, find how the camera of the main 3D layer moved: a point it was looking at a frame ago (where its centre
// ray met the table) is projected again, so its slide on screen is the pan and the change in distance is the zoom.
// The snow layer then moves the same way (backdrop.camMotion), gentler during the long moves between views.
const sf = { cam: null, P: new THREE.Vector3(), pos: new THREE.Vector3(), ok: false }, _v = new THREE.Vector3(), _d = new THREE.Vector3();
function snowFollow(layers) {
  let lay = null;
  for (const l of layers) if (l.slot === 'A' && l.opacity > 0.5 && (!lay || l.camera === (stageMod && stageMod.camera))) lay = l;
  const cam = lay && lay.camera;
  if (!cam) { sf.ok = false; sf.cam = null; return; }
  cam.updateMatrixWorld();
  if (sf.ok && sf.cam === cam) {
    _v.copy(sf.P).project(cam);
    const sx = (_v.x * 0.5 + 0.5) * innerWidth, sy = (-_v.y * 0.5 + 0.5) * innerHeight;
    const d0 = sf.pos.distanceTo(sf.P), d1 = cam.position.distanceTo(sf.P);
    if (_v.z < 1 && d1 > 1e-3) backdrop.camMotion(sx - innerWidth / 2, sy - innerHeight / 2, d0 / d1, sx, sy, busy ? 0.6 : 1);
  }
  // the point under the middle of the screen, on the table (or a fixed way ahead if the camera looks above it)
  cam.getWorldDirection(_d);
  const t = _d.y < -0.05 ? -cam.position.y / _d.y : 40;
  sf.P.copy(cam.position).addScaledVector(_d, Math.min(400, Math.max(5, t)));
  sf.pos.copy(cam.position); sf.cam = cam; sf.ok = true;
}


// a gentle start: nothing moves. The page (logo in its place, the products, the snow) is simply revealed by a slow fade
// of the cover once everything is ready to draw.
const reveal = { ready() {
  const L = document.getElementById('loader');
  requestAnimationFrame(() => { L.classList.add('done'); setTimeout(() => { body.classList.remove('booting'); L.classList.add('gone'); }, 1150); });
} };
// ---------- Boot ----------
(async function boot() {
  manifest = await (await fetch('assets/manifest.json')).json(); setManifest(manifest);
  gallery.init(manifest);
  await home.build(manifest);
  buildSubnav();
  applyTheme(root.dataset.theme || 'dark');
  resize();
  const first = routeFromHash();
  history.replaceState({ d: 0 }, '', '#' + first);
  view = first; showDom(first); syncSubnav();
  if (first === 'home') { home.enter(); home.settle(); L.home = 1; } // no dolly on arrival: it fades in where it rests
  else if (VIEWS[first].kind === 'gallery') { body.classList.add('gl-passive'); await gallery.preloadThumbs(VIEWS[first].set); gallery.show(VIEWS[first].set); }
  else { await prepare(first); stageMod = VIEWS[first].mod; stageMod.enter(); L.stage = 1; }
  await companionsReady().catch(() => {});
  if (VIEWS[first].kind === 'stage' && COMP[VIEWS[first].product] && COMP[VIEWS[first].product].mod === stageMod) stageMod.enter();
  await renderer.compileAsync(home.scene, home.camera).catch(() => {});
  ready = true;
  reveal.ready();
  // warm up the other sections while the visitor looks around
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 800));
  idle(async () => {
    await gallery.preloadThumbs('playing'); await gallery.preloadThumbs('memory');
    for (const v of Object.values(VIEWS)) if (v.mod && v.mod.prepare) { try { await v.mod.prepare(manifest); } catch (e) {} }
  });
})();
