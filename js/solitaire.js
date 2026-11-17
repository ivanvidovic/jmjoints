// Klondike Solitaire (draw one). Tap a card to send it to its best spot, or drag runs between columns.
import * as THREE from 'three';
import { createTable, S, Y } from './cardtable.js';
import * as sound from './sound.js';
import { confirmTap, saveGame, loadGame } from './ui.js';
import { clamp } from './core.js';

const T = createTable();
export const scene = T.scene, camera = T.camera;
let GAPX = S.w + 1.15;
const colX = (i) => (i - 3) * GAPX;
let ZTOP = -15, ZTAB = -4.5;
let slots = [], st = null, history = [], built = false, active = false, startT = 0, moves = 0, won = false;
const hud = {};

function anchors() {
  return { stock: new THREE.Vector3(colX(0), 0, ZTOP), waste: new THREE.Vector3(colX(1), 0, ZTOP), found: [0, 1, 2, 3].map((k) => new THREE.Vector3(colX(3 + k), 0, ZTOP)), tab: [0, 1, 2, 3, 4, 5, 6].map((k) => new THREE.Vector3(colX(k), 0, ZTAB)) };
}
export async function prepare() {
  if (built) return; built = true;
  frameIt();
  T.shuffled().forEach((cd, k) => T.snapTo(cd, deckAt(k), false)); // a real stack, card on card
  resume();
  hud.moves = document.getElementById('so-moves'); hud.time = document.getElementById('so-time'); hud.finish = document.getElementById('so-finish'); hud.win = document.getElementById('so-win'); hud.winText = document.getElementById('so-win-text');
  confirmTap(document.getElementById('so-new'), () => st && moves > 0 && !won, () => { sound.unlock(); deal(); });
  document.getElementById('so-undo').onclick = () => { sound.unlock(); undo(); };
  document.getElementById('so-again').onclick = () => { sound.unlock(); deal(); };
  hud.finish.onclick = () => { sound.unlock(); autoFinish(); };
}

// ---------- state ----------
const deckAt = (k) => new THREE.Vector3(colX(0), Y(51 - k), ZTOP);
function deal() {
  // sweep everything into the deck, then deal the columns from the top of it
  if (bounce.on) { bounce.done = null; endBounce(false); }
  history = []; moves = 0; startT = 0; won = false; hud.win.classList.remove('on'); saveGame('solitaire', null);
  st = { stock: [], waste: [], found: [[], [], [], []], tab: [[], [], [], [], [], [], []], dealing: true };
  T.gather((k) => deckAt(51 - k), (order) => {
    const cards = order.slice().reverse(); // cards[0] is the top of the deck
    st = { stock: [], waste: [], found: [[], [], [], []], tab: [[], [], [], [], [], [], []] };
    let k = 0; const faces = new Map();
    for (let row = 0; row < 7; row++) for (let c = row; c < 7; c++) { const cd = cards[k++]; faces.set(cd, row === c); st.tab[c].push(cd); }
    st.stock = cards.slice(k).reverse();
    cards.forEach((cd) => (cd._deal = faces.get(cd))); layout(true, 0.05); cards.forEach((cd) => delete cd._deal);
    syncHud();
  });
  sound.play('shuffle', { vol: 0.5, dur: 900 });
  syncHud();
}
function snapshot() { return JSON.stringify({ stock: st.stock.map((c) => c.id), waste: st.waste.map((c) => c.id), found: st.found.map((p) => p.map((c) => c.id)), tab: st.tab.map((p) => p.map((c) => [c.id, c.faceUp])), moves }); }
function restoreSnap(s) {
  const o = JSON.parse(s), C = (id) => T.card(id);
  st = { stock: o.stock.map(C), waste: o.waste.map(C), found: o.found.map((p) => p.map(C)), tab: o.tab.map((p) => p.map(([id, up]) => { const c = C(id); c._up = up; return c; })) };
  st.stock.forEach((c) => (c._up = false)); st.waste.forEach((c) => (c._up = true)); st.found.flat().forEach((c) => (c._up = true));
  moves = o.moves;
}
// an unfinished game is kept between visits (with its undo steps), and laid back out exactly as it was
function save() { saveGame('solitaire', won ? null : { snap: snapshot(), hist: history.slice(-40), t: startT ? performance.now() - startT : 0 }); }
function resume() {
  const g = loadGame('solitaire'); if (!g) return;
  try { restoreSnap(g.snap); } catch (e) { st = null; saveGame('solitaire', null); return; }
  history = g.hist || []; startT = g.t ? performance.now() - g.t : 0;
  layout(false, 0, true);
  for (const cd of [...st.stock, ...st.waste, ...st.found.flat(), ...st.tab.flat()]) T.snapTo(cd, cd.pos.clone(), cd.faceUp);
  syncHud();
}
function commit() { history.push(snapshot()); if (history.length > 200) history.shift(); }
function undo() { if (!history.length || won) return; restoreSnap(history.pop()); layout(false, 0, true); sound.play('slide', { vol: 0.25, rate: 0.9 }); syncHud(); save(); }

// ---------- layout: where every card belongs right now ----------
function tabOffsets(col) {
  const avail = 34 - (ZTAB - ZTOP); // keep long columns on the table
  let down = 0, up = 0; for (const c of col) (c.faceUp || c._up ? up++ : down++);
  let du = 0.75, uu = 2.0; const need = down * du + Math.max(0, up - 1) * uu;
  if (need > avail) { const k = avail / need; du *= k; uu *= k; }
  return { du, uu };
}
function layout(dealing = false, baseDelay = 0, fromSnap = false) {
  const a = anchors(); let d = baseDelay, i = 0;
  const go = (cd, pos, up, still = false) => {
    if (fromSnap) { up = cd._up; delete cd._up; }
    const same = cd.pos.distanceTo(pos) < 0.001 && up === cd.faceUp; // already there, or already on its way
    if (same) return;
    const dl = dealing && !still;
    T.place(cd, pos, { faceUp: up, dur: dl ? 0.42 : 0.3, delay: dl ? d : 0, arc: dl ? 2.5 : 1.2, snd: dl ? 'place' : (up !== cd.faceUp ? 'slide' : null), vol: dl ? 0.12 : 0.22 });
    if (dl) d += 0.045;
  };
  st.stock.forEach((c, k) => go(c, new THREE.Vector3(a.stock.x, Y(k), a.stock.z), false, true));
  st.waste.forEach((c, k) => go(c, new THREE.Vector3(a.waste.x + Math.min(2, Math.max(0, k - (st.waste.length - 3))) * 0, Y(k), a.waste.z), true));
  st.found.forEach((p, f) => p.forEach((c, k) => go(c, new THREE.Vector3(a.found[f].x, Y(k), a.found[f].z), true)));
  // deal order: row by row
  if (dealing) {
    for (let row = 0; row < 7; row++) for (let col = row; col < 7; col++) { const c = st.tab[col][row]; const o = tabOffsets(st.tab[col]); go(c, posInCol(col, row, o), c._deal ?? c.faceUp); }
  } else st.tab.forEach((col, ci) => { const o = tabOffsets(col); col.forEach((c, k) => go(c, posInCol(ci, k, o), fromSnap ? c._up : c.faceUp)); });
}
function posInCol(ci, k, o) {
  const col = st.tab[ci]; let z = ZTAB;
  for (let j = 0; j < k; j++) z += (col[j].faceUp || col[j]._up || col[j]._deal) ? o.uu : o.du;
  return new THREE.Vector3(colX(ci), Y(k), z);
}

// ---------- rules ----------
const canFound = (c, pile) => (pile.length ? pile[pile.length - 1].suit === c.suit && pile[pile.length - 1].rank === c.rank - 1 : c.rank === 1);
const canTab = (c, col) => (col.length ? (() => { const t = col[col.length - 1]; return t.faceUp && t.red !== c.red && t.rank === c.rank + 1; })() : c.rank === 13);
function where(cd) {
  if (st.stock.includes(cd)) return { pile: 'stock' };
  if (st.waste.includes(cd)) return { pile: 'waste', top: st.waste[st.waste.length - 1] === cd };
  for (let f = 0; f < 4; f++) if (st.found[f].includes(cd)) return { pile: 'found', i: f, top: st.found[f][st.found[f].length - 1] === cd };
  for (let t = 0; t < 7; t++) { const k = st.tab[t].indexOf(cd); if (k >= 0) return { pile: 'tab', i: t, k, run: st.tab[t].slice(k) }; }
  return null;
}
function take(w) {
  if (w.pile === 'waste') return [st.waste.pop()];
  if (w.pile === 'found') return [st.found[w.i].pop()];
  if (w.pile === 'tab') return st.tab[w.i].splice(w.k);
  return [];
}
function after() {
  // turn over any newly exposed column card
  st.tab.forEach((col) => { const t = col[col.length - 1]; if (t && !t.faceUp) { T.place(t, t.pos.clone(), { faceUp: true, dur: 0.32, arc: 1.2, snd: 'slide', vol: 0.2 }); } });
  moves++; if (!startT) startT = performance.now();
  layout(); syncHud(); checkWin(); save();
}
function drawStock() {
  commit();
  if (st.stock.length) { const c = st.stock.pop(); st.waste.push(c); }
  else { if (!st.waste.length) { history.pop(); return; } st.stock = st.waste.reverse(); st.waste = []; sound.play('shove', { vol: 0.35 }); }
  after();
}
function autoMove(cd) {
  const w = where(cd); if (!w || w.pile === 'stock') return false;
  const single = w.pile !== 'tab' || w.run.length === 1;
  if ((w.pile === 'waste' && !w.top) || (w.pile === 'found' && !w.top)) return false;
  if (single && w.pile !== 'found') for (let f = 0; f < 4; f++) if (canFound(cd, st.found[f])) { commit(); const m = take(w); st.found[f].push(...m); sound.play('place', { vol: 0.35 }); after(); return true; }
  // tableau: prefer a column with cards, then an empty one (kings)
  const order = [...Array(7).keys()].filter((t) => !(w.pile === 'tab' && t === w.i)).sort((a, b) => (st.tab[a].length ? 0 : 1) - (st.tab[b].length ? 0 : 1));
  for (const t of order) if (canTab(cd, st.tab[t])) { if (!st.tab[t].length && w.pile === 'tab' && w.k === 0) continue; commit(); const m = take(w); st.tab[t].push(...m); after(); return true; }
  return false;
}
function shake(cards) { cards.forEach((c) => { const p = c.pos.clone(); T.place(c, p.clone().add(new THREE.Vector3(0.6, 0, 0)), { dur: 0.08, arc: 0, snd: null }); setTimeout(() => T.place(c, p, { dur: 0.14, arc: 0, snd: null }), 90); }); sound.play('shove', { vol: 0.18, rate: 1.3 }); }
const allUp = () => !st.stock.length && !st.waste.length && st.tab.every((c) => c.every((x) => x.faceUp));
function autoFinish() {
  if (!allUp()) return;
  const step = () => {
    for (let t = 0; t < 7; t++) { const col = st.tab[t], c = col[col.length - 1]; if (!c) continue; for (let f = 0; f < 4; f++) if (canFound(c, st.found[f])) { col.pop(); st.found[f].push(c); moves++; layout(); syncHud(); sound.play('place', { vol: 0.2, gap: 10 }); if (!checkWin()) setTimeout(step, 90); return; } }
  };
  step();
}
function checkWin() {
  if (won || st.found.some((p) => p.length < 13)) return false;
  won = true; saveGame('solitaire', null); const s = Math.round((performance.now() - startT) / 1000);
  bounce.done = () => { hud.winText.textContent = `Solved in ${moves} moves · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; hud.win.classList.add('on'); sound.play('shuffle', { vol: 0.5, dur: 1100 }); };
  setTimeout(() => { if (won && bounce.done) startBounce(); }, 500);
  return true;
}
// The classic finish: one after another, the cards leap off the foundations (kings first) and bounce away across the
// table, each bounce a little lower, until they've all gone off the side. A tap skips to the result.
const bounce = { on: false, queue: [], live: [], next: 0, done: null };
function startBounce() {
  bounce.queue = []; for (let k = 12; k >= 0; k--) for (let f = 0; f < 4; f++) bounce.queue.push(st.found[f][k]);
  bounce.live = []; bounce.next = 0; bounce.on = true; bounce.n = 0;
  sound.chime([0, 4, 7, 12], { vol: 0.22, gap: 0.11 });
}
function endBounce(skip) {
  if (!bounce.on) return;
  bounce.on = false;
  if (skip) for (const c of [...bounce.live.map((b) => b.cd), ...bounce.queue]) T.snapTo(c, c.pos.clone(), true); // tidy: everything back on its pile
  bounce.live = []; bounce.queue = [];
  const d = bounce.done; bounce.done = null; d && d();
}
function stepBounce(dt) {
  const floor = T.onPlane(innerWidth / 2, innerHeight * 0.9), edgeL = T.onPlane(0, innerHeight / 2), edgeR = T.onPlane(innerWidth, innerHeight / 2);
  if (!floor || !edgeL || !edgeR) return endBounce(true);
  bounce.next -= dt;
  while (bounce.next <= 0 && bounce.queue.length) {
    const cd = bounce.queue.shift(); cd.anim = null;
    const side = bounce.n % 2 ? -1 : 1;
    bounce.live.push({ cd, x: cd.mesh.position.x, z: cd.mesh.position.z, y: 3 + bounce.n * 0.04, vx: side * (9 + Math.random() * 9), vz: -(10 + Math.random() * 10) });
    bounce.n++; bounce.next += 0.07;
  }
  for (let i = bounce.live.length - 1; i >= 0; i--) {
    const b = bounce.live[i];
    b.vz += 70 * dt; b.x += b.vx * dt; b.z += b.vz * dt;
    if (b.z > floor.z) { b.z = floor.z; b.vz = -Math.abs(b.vz) * 0.7; if (Math.abs(b.vz) > 6) sound.play('place', { vol: 0.08, rate: 1.2, gap: 40 }); }
    b.cd.mesh.position.set(b.x, b.y, b.z);
    if (b.x < edgeL.x - S.w || b.x > edgeR.x + S.w) bounce.live.splice(i, 1); // gone off the side
  }
  if (!bounce.queue.length && !bounce.live.length) endBounce(false);
}
function syncHud() {
  if (!hud.moves) return;
  hud.moves.textContent = moves;
  hud.finish.hidden = !(st && allUp() && !won);
}

// ---------- input: tap to auto-move, drag runs ----------
let drag = null;
const cv = T.canvas;
cv.addEventListener('pointerdown', (e) => {
  if (active && bounce.on) { endBounce(true); return; }
  if (!active || !st || won) return;
  sound.unlock();
  const cd = T.pick(e.clientX, e.clientY);
  const p = T.onPlane(e.clientX, e.clientY);
  const a = anchors();
  if (!cd || st.stock.includes(cd)) { if (p && Math.abs(p.x - a.stock.x) < S.w / 2 + 0.5 && Math.abs(p.z - a.stock.z) < S.h / 2 + 0.5) drawStock(); return; }
  if (!cd.faceUp) return;
  const w = where(cd); if (!w) return;
  if ((w.pile === 'waste' || w.pile === 'found') && !w.top) return;
  const run = w.pile === 'tab' ? w.run : [cd];
  drag = { id: e.pointerId, w, run, x0: e.clientX, y0: e.clientY, moved: 0, start: p, homes: run.map((c) => c.pos.clone()) };
  cv.setPointerCapture(e.pointerId);
});
cv.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0));
  if (drag.moved < 6) return;
  const p = T.onPlane(e.clientX, e.clientY); if (!p || !drag.start) return;
  const dx = p.x - drag.start.x, dz = p.z - drag.start.z;
  drag.run.forEach((c, k) => { c.anim = null; c.mesh.position.set(drag.homes[k].x + dx, 2.5 + k * 0.05, drag.homes[k].z + dz); });
});
cv.addEventListener('pointerup', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null;
  if (d.moved < 6) { if (!autoMove(d.run[0])) shake(d.run); return; }
  // drop: nearest legal pile to where the lead card is
  const lead = d.run[0].mesh.position, a = anchors();
  let best = null, bd = 1e9;
  const consider = (kind, i, pos) => { const dd = Math.hypot(lead.x - pos.x, lead.z - pos.z); if (dd < bd) { bd = dd; best = { kind, i }; } };
  a.found.forEach((p, f) => consider('found', f, p));
  st.tab.forEach((col, t) => { const top = col[col.length - 1]; consider('tab', t, top ? top.pos : a.tab[t]); });
  let ok = false;
  if (best && bd < 6) {
    if (best.kind === 'found' && d.run.length === 1 && canFound(d.run[0], st.found[best.i])) { commit(); st.found[best.i].push(...take(d.w)); ok = true; sound.play('place', { vol: 0.35 }); }
    if (best.kind === 'tab' && !(d.w.pile === 'tab' && d.w.i === best.i) && canTab(d.run[0], st.tab[best.i])) { commit(); st.tab[best.i].push(...take(d.w)); ok = true; sound.play('place', { vol: 0.3 }); }
  }
  if (ok) after();
  else d.run.forEach((c, k) => { c.pos.set(1e9, 0, 0); T.place(c, d.homes[k], { dur: 0.28, arc: 0.8, snd: k === 0 ? 'slide' : null, vol: 0.2 }); });
});

// keys: Space draws from the stock, U (or Ctrl/Cmd+Z) undoes, A finishes once every card is showing (F is full screen)
addEventListener('keydown', (e) => {
  if (!active || !st || won || e.target.closest('button, input, a')) return;
  if (e.key === ' ') { e.preventDefault(); sound.unlock(); drawStock(); }
  else if (e.key === 'u' || e.key === 'U' || ((e.metaKey || e.ctrlKey) && e.key === 'z')) { e.preventDefault(); undo(); }
  else if ((e.key === 'a' || e.key === 'A') && allUp()) autoFinish();
});

// ---------- view ----------
function frameIt() {
  const portrait = innerWidth / innerHeight < 1;
  GAPX = S.w + (portrait ? 0.4 : 1.15);
  ZTOP = portrait ? -18 : -15; ZTAB = ZTOP + S.h + 2.2;
  T.frame(7 * GAPX + 2, portrait ? 66 : 52, portrait ? 0 : -1.5, 78);
  // outlines for empty piles, rebuilt for the current spacing
  slots.forEach((m) => T.scene.remove(m)); const a = anchors();
  slots = [a.stock, a.waste, ...a.found, ...a.tab].map((p) => T.slot(p.x, p.z));
}
export function enter() { active = true; frameIt(); if (!st) { T.snapCamera(); deal(); } else layout(); }
export function leave() { active = false; drag = null; }
export function resize() { T.resize(); if (built) { frameIt(); if (st) layout(); } }
// slots were drawn at the first layout; on rotation they're rebuilt lazily by a fresh deal
export function setTheme(t) { T.setTheme(t); }
export function exposure(dark) { return dark ? 1.08 : 1.05; }
let last = 0;
export function update(dt) { T.update(dt); if (bounce.on) stepBounce(dt); if (st && startT && !won) { const s = Math.floor((performance.now() - startT) / 1000); if (s !== last) { last = s; hud.time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; } } return true; }
