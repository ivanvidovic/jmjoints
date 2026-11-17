// Go Fish against the computer. Seven cards each, the rest scattered face down in the middle as the pond. On your turn
// tap one of your cards to ask for that rank: if the computer has any, it hands them all over and you go again; if not,
// "Go fish!": tap a card in the pond. Fish the rank you asked for and you go again too. Four of a kind is a book.
// When all thirteen books are made, whoever has more wins.
import * as THREE from 'three';
import { createTable, S, Y } from './cardtable.js';
import { duel, RANK1, RANKS, a1, portrait, paceButton } from './duel.js';
import * as sound from './sound.js';
import { confirmTap, saveGame, loadGame } from './ui.js';

const T = createTable();
export const scene = T.scene, camera = T.camera;
const hud = {};
const D = duel(T, { bubble: document.getElementById('gf-say') });
let built = false, active = false, st = null, hover = null;

// ---------- where things go ----------
function G() {
  return portrait()
    ? { me: 13, them: -19.5, handW: 21, pond: { x: 0, z: -3.2, rx: 8.5, rz: 5.2 }, deck: new THREE.Vector3(0, 0, -3.2),
        book: (side, b, n) => { const step = n > 1 ? Math.min(2.3, 20 / (n - 1)) : 0; return new THREE.Vector3(-10 + b * step, 0, side === 'me' ? 23 : -29.5); } }
    : { me: 12.5, them: -14, handW: 34, pond: { x: 0, z: -1.2, rx: 11.5, rz: 2.7 }, deck: new THREE.Vector3(0, 0, -1),
        book: (side, b, n) => { const step = n > 1 ? Math.min(2.6, 15 / (n - 1)) : 0; return new THREE.Vector3(side === 'me' ? 27.5 : -27.5, 0, (side === 'me' ? -1.5 : -14) + b * step); } };
}
// the pond: a loose scatter, every card turned its own way, later cards lying over earlier ones
function pondSpots(n) {
  const g = G().pond, out = [];
  for (let k = 0; k < n; k++) {
    let best = null;
    for (let t = 0; t < 14; t++) { // keep spots a little apart so the pond reads as many cards, not a heap
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random());
      const p = { x: g.x + Math.cos(a) * r * g.rx, z: g.z + Math.sin(a) * r * g.rz };
      const d = out.reduce((m, q) => Math.min(m, Math.hypot(q.x - p.x, (q.z - p.z) * 1.4)), 99);
      if (!best || d > best.d) best = { ...p, d };
    }
    out.push({ x: best.x, z: best.z, yaw: (Math.random() - 0.5) * 1.6 });
  }
  return out;
}

export async function prepare() {
  if (built) return; built = true;
  frameIt();
  T.shuffled().forEach((cd, k) => T.snapTo(cd, G().deck.clone().setY(Y(k)), false));
  Object.assign(hud, { mine: document.getElementById('gf-mine'), theirs: document.getElementById('gf-theirs'), pond: document.getElementById('gf-pond'), end: document.getElementById('gf-end'), endText: document.getElementById('gf-end-text') });
  confirmTap(document.getElementById('gf-new'), () => st && st.played && st.phase !== 'over', () => { sound.unlock(); deal(); });
  document.getElementById('gf-again').onclick = () => { sound.unlock(); deal(); };
  paceButton(document.getElementById('gf-pace'));
  resume();
}

// ---------- kept between visits ----------
// the whole table is saved whenever it changes; an unfinished game comes back exactly as it was, at the start of
// whoever's turn it was
const ids = (a) => a.map((c) => c.id);
function save() {
  if (!st || st.phase === 'deal') return;
  if (st.phase === 'over') return saveGame('gofish', null);
  saveGame('gofish', { me: ids(st.me), them: ids(st.them), pond: st.pond.map((c) => [c.id, +c._spot.x.toFixed(2), +c._spot.z.toFixed(2), +c._spot.yaw.toFixed(3), c._spot.y]),
    books: { me: st.books.me.map(ids), them: st.books.them.map(ids) }, knows: [...st.knows], noHave: [...st.noHave], turn: st.turn, phase: st.phase, ask: st.ask, played: st.played });
}
function resume() {
  const o = loadGame('gofish'); if (!o) return;
  try {
    const C = (id) => T.card(id);
    st = { me: o.me.map(C), them: o.them.map(C), pond: o.pond.map(([id, x, z, yaw, y]) => { const c = C(id); c._spot = { x, z, yaw, y }; return c; }),
      books: { me: o.books.me.map((b) => b.map(C)), them: o.books.them.map((b) => b.map(C)) }, raised: new Set(), knows: new Set(o.knows), noHave: new Set(o.noHave),
      turn: o.turn, phase: 'busy', ask: o.ask, played: o.played };
    if ([...st.me, ...st.them, ...st.pond, ...st.books.me.flat(), ...st.books.them.flat()].some((c) => !c)) throw new Error('bad save');
  } catch (e) { st = null; saveGame('gofish', null); return; }
  D.fresh(); layout();
  T.cards.forEach((cd) => T.snapTo(cd, cd.pos.clone(), cd.faceUp, cd.yaw || 0));
  if (o.turn === 'me' && (o.phase === 'fish' || o.phase === 'refill')) { st.phase = o.phase; D.say(o.phase === 'fish' ? 'Go fish! Tap a card in the pond.' : 'Your hand is empty. Tap a card in the pond to draw.', o.phase === 'fish' ? 'them' : 'table'); }
  else if (o.turn === 'them') theirTurn();
  else myTurn();
}

// ---------- layout: every card to where it belongs ----------
const byRank = (a, b) => a.rank - b.rank || 'SHCD'.indexOf(a.suit) - 'SHCD'.indexOf(b.suit);
function layout(o = {}) {
  if (!st) return;
  const g = G();
  st.me.sort(byRank);
  D.fanPoses(st.me.length, g.me, g.handW, true).forEach((p, i) => {
    const cd = st.me[i], up = st.raised.has(cd) ? 1.4 : hover === cd && st.phase === 'ask' ? 0.8 : 0;
    p.pos.y += up * 0.9; p.pos.z -= up * 1.3;
    D.go(cd, p.pos, true, p.yaw, { dur: up || hover ? 0.22 : 0.36, ...o });
  });
  D.fanPoses(st.them.length, g.them, g.handW * 0.8, false).forEach((p, i) => D.go(st.them[i], p.pos, false, p.yaw, o));
  for (const side of ['me', 'them']) st.books[side].forEach((bk, b) => bk.forEach((cd, j) => {
    const p = g.book(side, b, st.books[side].length).add(new THREE.Vector3(j * 0.06, Y(b * 4 + j), -j * 0.06));
    D.go(cd, p, true, 0, o);
  }));
  st.pond.forEach((cd) => D.go(cd, new THREE.Vector3(cd._spot.x, cd._spot.y, cd._spot.z), false, cd._spot.yaw, o));
  sync(); save();
}

// ---------- a game ----------
function deal() {
  const g0 = D.fresh();
  hud.end.classList.remove('on'); saveGame('gofish', null); celebrating = null;
  st = { me: [], them: [], pond: [], books: { me: [], them: [] }, phase: 'deal', raised: new Set(), ask: 0, knows: new Set(), noHave: new Set(), played: false };
  hover = null;
  D.say('Shuffling…');
  const deck = G().deck;
  T.gather((k) => deck.clone().setY(Y(k)), async (order) => {
    if (!D.live(g0)) return;
    const pile = order.slice(); // bottom first: deal from the end
    // seven each, one at a time, you first
    for (let i = 0; i < 14; i++) {
      const cd = pile.pop(); (i % 2 ? st.them : st.me).push(cd);
      layout({ snd: 'place', vol: 0.12, dur: 0.4, arc: 2 });
      await D.sleep(0.11);
    }
    // the rest spread out into the pond
    const spots = pondSpots(pile.length);
    pile.reverse().forEach((cd, k) => { cd._spot = { ...spots[k], y: Y(k) }; st.pond.push(cd); });
    st.pond.forEach((cd, k) => T.place(cd, new THREE.Vector3(cd._spot.x, cd._spot.y, cd._spot.z), { faceUp: false, yaw: cd._spot.yaw, dur: 0.5, delay: k * 0.018, arc: 2.2, snd: k % 6 ? null : 'slide', vol: 0.12 }));
    sync();
    await D.idle();
    await books('me'); await books('them');
    myTurn();
  });
  sound.play('shuffle', { vol: 0.5, dur: 900 });
  sync();
}
const NUM = ['no', 'one', 'two', 'three', 'four'];
const over = () => st.books.me.length + st.books.them.length === 13;

// any four of a kind in a hand is laid down as a book
async function books(side) {
  const hand = st[side], counts = {};
  hand.forEach((c) => (counts[c.rank] = (counts[c.rank] || 0) + 1));
  for (const r of Object.keys(counts).map(Number)) {
    if (counts[r] < 4) continue;
    const bk = hand.filter((c) => c.rank === r);
    st[side] = hand.filter((c) => c.rank !== r);
    st.books[side].push(bk); st.knows.delete(r); st.noHave.delete(r);
    D.say(side === 'me' ? `You made a book of ${RANKS(r)}!` : `The computer made a book of ${RANKS(r)}.`, side === 'me' ? 'you' : 'them');
    sound.play('fan', { vol: 0.4, dur: 700 });
    layout({ dur: 0.5, arc: 2.5 });
    await D.idle(); await D.sleep(0.7);
    return books(side);
  }
}

// ---------- your turn ----------
function myTurn() {
  if (over()) return finish();
  st.turn = 'me'; D.calm();
  if (!st.me.length) {
    if (st.pond.length) { st.phase = 'refill'; D.say('Your hand is empty. Tap a card in the pond to draw.'); }
    else return theirTurn();
  } else { st.phase = 'ask'; D.say('Your turn · tap a card to ask for its rank'); }
  layout();
}
async function ask(r) {
  const g = D.gen;
  st.phase = 'busy'; st.played = true; st.ask = r; st.knows.add(r); hover = null; layout();
  D.say(`Do you have any ${RANKS(r)}?`, 'you');
  await D.sleep(1.0); if (!D.live(g)) return;
  const got = st.them.filter((c) => c.rank === r);
  if (got.length) {
    D.say(got.length === 1 ? `Yes, here's one ${RANK1(r)}.` : `Yes, here are ${NUM[got.length]} ${RANKS(r)}.`, 'them');
    st.them = st.them.filter((c) => c.rank !== r); st.me.push(...got); st.noHave.clear();
    layout({ dur: 0.5, arc: 2.5, snd: 'slide', vol: 0.3 });
    await D.idle(); await D.sleep(0.4);
    await books('me');
    D.say('You go again!'); await D.sleep(0.6);
    return myTurn();
  }
  D.say('Go fish! Tap a card in the pond.', 'them');
  sound.play('shove', { vol: 0.15, rate: 1.2 });
  st.phase = st.pond.length ? 'fish' : 'busy'; save(); // (a reload now still owes the pond a fish)
  if (!st.pond.length) { await D.sleep(0.8); D.say('The pond is empty.'); await D.sleep(0.8); return theirTurn(); }
}
async function fish(cd) {
  const g = D.gen, refill = st.phase === 'refill';
  st.phase = 'busy'; st.played = true;
  st.pond.splice(st.pond.indexOf(cd), 1); st.me.push(cd); st.noHave.clear();
  layout({ dur: 0.5, arc: 2.6, snd: 'slide', vol: 0.3 });
  await D.idle(); if (!D.live(g)) return;
  if (refill) { await books('me'); return myTurn(); }
  if (cd.rank === st.ask) {
    D.say(`You fished ${a1(cd.rank)} ${RANK1(cd.rank)}, just what you asked for! Go again.`, 'you');
    await D.sleep(1.1); await books('me'); return myTurn();
  }
  D.say(`You drew ${a1(cd.rank)} ${RANK1(cd.rank)}.`, 'you');
  await D.sleep(0.9); await books('me');
  return theirTurn();
}

// ---------- the computer's turn ----------
function choose() {
  const ranks = [...new Set(st.them.map((c) => c.rank))];
  const known = ranks.filter((r) => st.knows.has(r) && !st.noHave.has(r));
  if (known.length && Math.random() < 0.75) return known[(Math.random() * known.length) | 0]; // it remembers what you asked for
  const fresh = ranks.filter((r) => !st.noHave.has(r)), pool = fresh.length ? fresh : ranks;
  const n = (r) => st.them.filter((c) => c.rank === r).length + Math.random() * 0.9;
  return pool.sort((a, b) => n(b) - n(a))[0];
}
async function theirTurn() {
  const g = D.gen;
  if (over()) return finish();
  st.turn = 'them'; st.phase = 'busy'; hover = null; layout();
  if (!st.them.length) {
    if (!st.pond.length) return myTurn();
    D.say('The computer draws from the pond.', 'them');
    await D.sleep(0.6); if (!D.live(g)) return;
    takeFromPond(); await D.idle(); await books('them'); if (over()) return finish();
    if (!st.them.length) return myTurn();
  }
  D.say('The computer is thinking…', 'them');
  await D.sleep(0.9); if (!D.live(g)) return;
  const r = choose(); st.ask = r;
  D.say(`Do you have any ${RANKS(r)}?`, 'them');
  await D.sleep(1.0); if (!D.live(g)) return;
  const got = st.me.filter((c) => c.rank === r);
  if (got.length) {
    got.forEach((c) => st.raised.add(c)); layout({ dur: 0.25, arc: 0 }); // your matching cards come up so you can see them go
    D.say(got.length === 1 ? `Yes, here's one ${RANK1(r)}.` : `Yes, here are ${NUM[got.length]} ${RANKS(r)}.`, 'you');
    await D.sleep(0.9); if (!D.live(g)) return;
    st.raised.clear(); st.me = st.me.filter((c) => c.rank !== r); st.them.push(...got); st.knows.delete(r);
    layout({ dur: 0.5, arc: 2.5, snd: 'slide', vol: 0.3 });
    await D.idle(); await D.sleep(0.3);
    await books('them');
    return theirTurn();
  }
  st.noHave.add(r);
  D.say('Go fish!', 'you'); sound.play('shove', { vol: 0.15, rate: 1.2 });
  await D.sleep(0.8); if (!D.live(g)) return;
  if (!st.pond.length) { D.say('The pond is empty.'); await D.sleep(0.8); return myTurn(); }
  const cd = takeFromPond();
  await D.idle(); if (!D.live(g)) return;
  if (cd.rank === r) {
    D.say(`The computer fished the ${RANK1(r)} it asked for. It goes again.`, 'them');
    await D.sleep(1.2); await books('them'); return theirTurn();
  }
  await books('them');
  return myTurn();
}
function takeFromPond() {
  const cd = st.pond.splice((Math.random() * st.pond.length) | 0, 1)[0];
  st.them.push(cd);
  layout({ dur: 0.5, arc: 2.6, snd: 'slide', vol: 0.28 });
  return cd;
}

// ---------- the end ----------
// a win: your books open into a fan across the table, then the result (a tap skips straight to it)
let celebrating = null;
async function finish() {
  const g = D.gen;
  st.phase = 'over'; hover = null; layout();
  const a = st.books.me.length, b = st.books.them.length;
  D.say(a > b ? 'All thirteen books are made. You win!' : 'All thirteen books are made. The computer wins this one.');
  const show = () => { if (!D.live(g) || hud.end.classList.contains('on')) return; celebrating = null; hud.endText.textContent = a > b ? `You win, ${a} books to ${b}!` : `The computer wins, ${b} books to ${a}. Play again?`; hud.end.classList.add('on'); };
  if (a > b) { celebrating = show; D.celebrate(st.books.me.flat(), G().deck); await D.idle(); await D.sleep(0.9); show(); }
  else { sound.play('shove', { vol: 0.45, dur: 800 }); await D.sleep(0.9); show(); }
}
function sync() {
  if (!hud.mine || !st) return;
  hud.mine.textContent = st.books.me.length; hud.theirs.textContent = st.books.them.length; hud.pond.textContent = st.pond.length;
}

// ---------- input ----------
const cv = T.canvas;
const mineAt = (e) => T.pick(e.clientX, e.clientY, (c) => st.me.includes(c));
cv.addEventListener('pointermove', (e) => {
  if (!active || !st || e.pointerType !== 'mouse') return;
  const cd = st.phase === 'ask' ? mineAt(e) : null;
  if (cd !== hover) { hover = cd; layout(); }
  cv.style.cursor = cd || ((st.phase === 'fish' || st.phase === 'refill') && T.pick(e.clientX, e.clientY, (c) => st.pond.includes(c))) ? 'pointer' : '';
});
// a tap while the computer plays hurries its turn along; a tap during the win skips to the result
cv.addEventListener('pointerdown', () => { if (!active || !st) return; if (celebrating) celebrating(); else if (st.turn === 'them') D.hurry(); });
cv.addEventListener('pointerup', (e) => {
  if (!active || !st) return;
  sound.unlock();
  if (st.phase === 'ask') {
    const cd = mineAt(e); if (!cd) return;
    if (e.pointerType !== 'mouse' && cd !== hover) { hover = cd; layout(); sound.play('slide', { vol: 0.12, rate: 1.3, gap: 60 }); return; } // on a touch screen the first tap lifts it, the second asks
    return ask(cd.rank);
  }
  if (st.phase === 'fish' || st.phase === 'refill') { const cd = T.pick(e.clientX, e.clientY, (c) => st.pond.includes(c)); if (cd) fish(cd); }
});
// keys: left / right choose a card, Enter or Space asks for it (or fishes from the pond); any key hurries the computer
addEventListener('keydown', (e) => {
  if (!active || !st || e.target.closest('button, input, a')) return;
  if (st.turn === 'them') { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); D.hurry(); } return; }
  if (st.phase === 'ask' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault(); const i = st.me.indexOf(hover), n = st.me.length;
    hover = st.me[i < 0 ? (e.key === 'ArrowLeft' ? n - 1 : 0) : (i + (e.key === 'ArrowLeft' ? -1 : 1) + n) % n]; layout(); sound.tick(0.3); return;
  }
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  if (st.phase === 'ask' && hover) ask(hover.rank);
  else if (st.phase === 'fish' || st.phase === 'refill') fish(st.pond[(Math.random() * st.pond.length) | 0]);
});

// ---------- view ----------
function frameIt() { T.frame(portrait() ? 31 : 66, portrait() ? 74 : 56, portrait() ? -5 : -2.6, 64); } // room above for the speech line, below for the bar
export function enter() { active = true; frameIt(); if (!st) { T.snapCamera(); deal(); } else layout(); }
export function leave() { active = false; hover = null; cv.style.cursor = ''; }
export function resize() {
  T.resize(); if (!built) return; frameIt();
  if (st && st.pond.length) { const spots = pondSpots(st.pond.length); st.pond.forEach((cd, k) => (cd._spot = { ...spots[k], y: cd._spot.y })); }
  layout({ dur: 0.3, arc: 0.5 });
}
export function setTheme(t) { T.setTheme(t); }
export function exposure(dark) { return dark ? 1.08 : 1.05; }
export function update(dt) { T.update(dt * (D.hurried ? 1.8 : 1)); D.tick(dt); return true; }
