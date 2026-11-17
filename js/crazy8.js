// Crazy Eights against the computer. Seven cards each; one card starts the pile. On your turn play a card that matches
// the top of the pile by suit or by number, or play an 8 (wild) and pick the next suit. No match? Tap the deck to draw
// until you have one. The first to play all their cards wins. When the deck runs out, the pile is shuffled back in.
import * as THREE from 'three';
import { createTable, S, Y } from './cardtable.js';
import { duel, RANK1, SUIT, a1, portrait, paceButton } from './duel.js';
import * as sound from './sound.js';
import { confirmTap, saveGame, loadGame } from './ui.js';

const T = createTable();
export const scene = T.scene, camera = T.camera;
const hud = {};
const D = duel(T, { bubble: document.getElementById('c8-say') });
let built = false, active = false, st = null, hover = null;

// ---------- where things go ----------
function G() {
  return portrait()
    ? { me: 13, them: -19.5, handW: 22, stock: new THREE.Vector3(-4.6, 0, -3.2), pile: new THREE.Vector3(4.6, 0, -3.2) }
    : { me: 12.5, them: -14, handW: 36, stock: new THREE.Vector3(-5.2, 0, -1), pile: new THREE.Vector3(5.2, 0, -1) };
}
export async function prepare() {
  if (built) return; built = true;
  frameIt();
  T.shuffled().forEach((cd, k) => T.snapTo(cd, G().stock.clone().setY(Y(k)), false));
  Object.assign(hud, { mine: document.getElementById('c8-mine'), theirs: document.getElementById('c8-theirs'), deck: document.getElementById('c8-deck'), end: document.getElementById('c8-end'), endText: document.getElementById('c8-end-text'), suits: document.getElementById('c8-suits'), badge: document.getElementById('c8-badge') });
  confirmTap(document.getElementById('c8-new'), () => st && st.played && st.phase !== 'over', () => { sound.unlock(); deal(); });
  paceButton(document.getElementById('c8-pace'));
  document.getElementById('c8-again').onclick = () => { sound.unlock(); deal(); };
  hud.suits.querySelectorAll('[data-suit]').forEach((b) => b.addEventListener('click', () => { sound.unlock(); chooseSuit(b.dataset.suit); }));
  resume();
}

// ---------- kept between visits ----------
// saved whenever the table changes; an unfinished game comes back as it was, at the start of whoever's turn it was
const ids = (a) => a.map((c) => c.id);
function save() {
  if (!st || st.phase === 'deal') return;
  if (st.phase === 'over') return saveGame('crazy8', null);
  saveGame('crazy8', { me: ids(st.me), them: ids(st.them), stock: ids(st.stock), pile: st.pile.map((c) => [c.id, +(c._yaw || 0).toFixed(3)]), suit: st.suit, turn: st.turn, phase: st.phase, played: st.played });
}
function resume() {
  const o = loadGame('crazy8'); if (!o) return;
  try {
    const C = (id) => T.card(id);
    st = { me: o.me.map(C), them: o.them.map(C), stock: o.stock.map(C), pile: o.pile.map(([id, yaw]) => { const c = C(id); c._yaw = yaw; return c; }), suit: o.suit, turn: o.turn, phase: 'busy', drew: false, played: o.played };
    if (!st.pile.length || [...st.me, ...st.them, ...st.stock, ...st.pile].some((c) => !c)) throw new Error('bad save');
  } catch (e) { st = null; saveGame('crazy8', null); return; }
  D.fresh(); layout();
  T.cards.forEach((cd) => T.snapTo(cd, cd.pos.clone(), cd.faceUp, cd.yaw || 0));
  if (o.turn === 'me' && o.phase === 'suit') { st.phase = 'suit'; D.say('Crazy eight! Pick the next suit.', 'you'); hud.suits.classList.add('on'); }
  else if (o.turn === 'them') theirTurn();
  else myTurn();
}

// ---------- rules ----------
const top = () => st.pile[st.pile.length - 1];
const fits = (cd) => cd.rank === 8 || cd.suit === st.suit || cd.rank === top().rank;
const SORT = 'SHCD';
const bySuit = (a, b) => (a.rank === 8) - (b.rank === 8) || SORT.indexOf(a.suit) - SORT.indexOf(b.suit) || a.rank - b.rank;

// ---------- layout ----------
function layout(o = {}) {
  if (!st) return;
  const g = G(), mine = st.turn === 'me' && st.phase === 'play';
  st.me.sort(bySuit);
  D.fanPoses(st.me.length, g.me, g.handW, true).forEach((p, i) => {
    const cd = st.me[i], ok = mine && fits(cd), up = ok ? (hover === cd ? 1.5 : 0.7) : 0;
    p.pos.y += up * 0.9; p.pos.z -= up * 1.2;
    D.go(cd, p.pos, true, p.yaw, { dur: hover ? 0.2 : 0.34, ...o });
    D.dim(cd, mine && !ok);
  });
  D.fanPoses(st.them.length, g.them, g.handW * 0.8, false).forEach((p, i) => D.go(st.them[i], p.pos, false, p.yaw, o));
  st.stock.forEach((cd, k) => D.go(cd, g.stock.clone().setY(Y(k)), false, 0, o));
  st.pile.forEach((cd, k) => D.go(cd, g.pile.clone().setY(Y(k)), true, cd._yaw || 0, o));
  sync(); save();
}
function badge() {
  const b = hud.badge, show = st && st.pile.length && top().rank === 8 && st.phase !== 'suit';
  if (show) { const s = SUIT[st.suit]; b.textContent = s.glyph; b.dataset.red = s.red ? '1' : ''; b.title = `Play ${s.name}`; }
  b.classList.toggle('on', !!show);
}

// ---------- a game ----------
function deal() {
  const g0 = D.fresh();
  hud.end.classList.remove('on'); hud.suits.classList.remove('on'); saveGame('crazy8', null); celebrating = null;
  st = { me: [], them: [], stock: [], pile: [], suit: 'S', turn: 'deal', phase: 'deal', drew: false, played: false };
  hover = null; badge(); D.say('Shuffling…');
  const at = G().stock;
  T.gather((k) => at.clone().setY(Y(k)), async (order) => {
    if (!D.live(g0)) return;
    st.stock = order.slice(); // bottom first: the top card is the last
    for (let i = 0; i < 14; i++) {
      (i % 2 ? st.them : st.me).push(st.stock.pop());
      layout({ snd: 'place', vol: 0.12, dur: 0.4, arc: 2 });
      await D.sleep(0.11);
    }
    await D.idle(); if (!D.live(g0)) return;
    await turnUpStarter(g0); if (!D.live(g0)) return;
    myTurn();
  });
  sound.play('shuffle', { vol: 0.5, dur: 900 });
  sync();
}
// the first card of the pile; an 8 can't start, so it goes back into the deck and the next one is turned up
async function turnUpStarter(g) {
  for (;;) {
    const cd = st.stock.pop(); cd._yaw = (Math.random() - 0.5) * 0.24; st.pile.push(cd); st.suit = cd.suit;
    layout({ dur: 0.45, arc: 2.2, snd: 'slide', vol: 0.3 });
    await D.idle(); if (!D.live(g)) return;
    if (cd.rank !== 8) return;
    D.say('An 8 can’t start the pile. Back in the deck it goes!');
    await D.sleep(0.9); if (!D.live(g)) return;
    st.pile.pop(); st.stock.push(cd); layout({ dur: 0.45, arc: 2.2, snd: 'slide', vol: 0.25 });
    await D.idle(); if (!D.live(g)) return;
    mix(st.stock); st.stock.forEach((c, k) => T.snapTo(c, G().stock.clone().setY(Y(k)), false)); // face down: nobody sees the cut
    sound.play('shuffle', { vol: 0.35, dur: 600 });
    await D.sleep(0.6); if (!D.live(g)) return;
  }
}
function mix(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } }

// the deck is empty: everything under the top of the pile is turned over and shuffled into a new deck
async function refillStock(g) {
  if (st.stock.length || st.pile.length < 2) return st.stock.length > 0;
  D.say('The deck ran out. Shuffling the pile back in…');
  const keep = st.pile.pop(), back = st.pile.splice(0);
  st.pile = [keep]; st.stock = back;
  st.stock.forEach((cd, k) => T.place(cd, G().stock.clone().setY(Y(k)), { faceUp: false, yaw: 0, dur: 0.45, delay: k * 0.02, arc: 2.4, snd: k % 5 ? null : 'slide', vol: 0.15 }));
  T.place(keep, G().pile.clone().setY(Y(0)), { faceUp: true, yaw: keep._yaw || 0, dur: 0.3, arc: 0.6, snd: null });
  await D.idle(); if (!D.live(g)) return false;
  mix(st.stock); st.stock.forEach((c, k) => T.snapTo(c, G().stock.clone().setY(Y(k)), false));
  sound.play('shuffle', { vol: 0.45, dur: 900 });
  await D.sleep(0.8);
  sync(); return true;
}
// a win: the pile you emptied your hand onto opens into a fan across the table, then the result (a tap skips to it)
let celebrating = null;
async function win(side) {
  const g = D.gen;
  st.phase = 'over'; st.turn = 'over'; hover = null; layout(); badge();
  D.say(side === 'me' ? 'You played your last card. You win!' : 'The computer played its last card.');
  const show = () => { if (!D.live(g) || hud.end.classList.contains('on')) return; celebrating = null; hud.endText.textContent = side === 'me' ? 'You win! Every card played.' : 'The computer wins this round. Play again?'; hud.end.classList.add('on'); };
  if (side === 'me') { celebrating = show; D.celebrate(st.pile.slice(-24), new THREE.Vector3(0, 0, G().pile.z)); await D.idle(); await D.sleep(0.9); show(); }
  else { sound.play('shove', { vol: 0.45, dur: 800 }); await D.sleep(0.9); show(); }
}
function lastCard(side) { if (st[side].length === 1) D.say(side === 'me' ? 'Last card!' : 'The computer has one card left!', side === 'me' ? 'you' : 'them'); }

// ---------- your turn ----------
function myTurn() {
  st.turn = 'me'; st.phase = 'play'; st.drew = false; D.calm();
  prompt(); layout(); badge();
}
function prompt() {
  const any = st.me.some(fits), s = SUIT[st.suit];
  if (any) D.say(top().rank === 8 ? `Your turn · play ${s.name} ${s.glyph} or an 8` : `Your turn · match the ${s.name} ${s.glyph} or the ${RANK1(top().rank)}, or play an 8`);
  else D.say(st.stock.length || st.pile.length > 1 ? 'Nothing fits. Tap the deck to draw a card.' : 'Nothing fits and the deck is empty. You pass.');
}
async function play(cd) {
  const g = D.gen;
  if (!fits(cd)) { // a little shake: not this one
    const p = cd.pos.clone(), y = cd.yaw;
    T.place(cd, p.clone().add(new THREE.Vector3(0.5, 0, 0)), { yaw: y, dur: 0.08, arc: 0, snd: null });
    setTimeout(() => T.place(cd, p, { yaw: y, dur: 0.14, arc: 0, snd: null }), 90);
    sound.play('shove', { vol: 0.12, rate: 1.3 }); return;
  }
  st.phase = 'busy'; st.played = true; hover = null;
  st.me.splice(st.me.indexOf(cd), 1); cd._yaw = (Math.random() - 0.5) * 0.24; st.pile.push(cd); st.suit = cd.suit;
  layout({ dur: 0.42, arc: 2.4, snd: 'place', vol: 0.3 }); badge();
  await D.idle(); if (!D.live(g)) return;
  if (!st.me.length) return win('me');
  if (cd.rank === 8) { st.phase = 'suit'; save(); D.say('Crazy eight! Pick the next suit.', 'you'); hud.suits.classList.add('on'); hud.suits.querySelector('button').focus({ preventScroll: true }); return; }
  lastCard('me'); await D.sleep(0.5);
  theirTurn();
}
async function chooseSuit(s) {
  if (!st || st.phase !== 'suit') return;
  hud.suits.classList.remove('on'); st.suit = s; st.phase = 'busy'; badge();
  sound.play('place', { vol: 0.2, rate: 1.2 });
  D.say(`You picked ${SUIT[s].name} ${SUIT[s].glyph}`, 'you');
  lastCard('me'); await D.sleep(0.9);
  theirTurn();
}
async function draw() {
  const g = D.gen;
  if (st.me.some(fits)) { D.say('One of your cards fits. Look for the ones lifted up!'); return; }
  st.phase = 'busy'; st.played = true;
  if (!st.stock.length && !(await refillStock(g))) { if (!D.live(g)) return; D.say('No cards left to draw. You pass.'); await D.sleep(1); return theirTurn(); }
  if (!D.live(g)) return;
  const cd = st.stock.pop(); st.me.push(cd);
  layout({ dur: 0.45, arc: 2.4, snd: 'slide', vol: 0.3 });
  await D.idle(); if (!D.live(g)) return;
  st.phase = 'play';
  if (fits(cd)) D.say(`You drew ${a1(cd.rank)} ${RANK1(cd.rank)}. It fits, play it!`, 'you');
  else prompt();
  layout();
  if (!st.me.some(fits) && !st.stock.length && st.pile.length < 2) { st.phase = 'busy'; await D.sleep(1); return theirTurn(); }
}

// ---------- the computer's turn ----------
// It keeps its options open: matching the suit it holds most of, saving 8s for when nothing else will do.
function pickCard() {
  const ok = st.them.filter(fits), plain = ok.filter((c) => c.rank !== 8);
  if (!ok.length) return null;
  const many = (s) => st.them.filter((c) => c.suit === s && c.rank !== 8).length;
  if (plain.length) return plain.sort((a, b) => many(b.suit) - many(a.suit) + (Math.random() - 0.5) * 0.5)[0];
  return ok[0];
}
function bestSuit() {
  const n = { S: 0, H: 0, C: 0, D: 0 }; st.them.forEach((c) => { if (c.rank !== 8) n[c.suit]++; });
  return Object.keys(n).sort((a, b) => n[b] - n[a] + (Math.random() - 0.5) * 0.5)[0];
}
async function theirTurn() {
  const g = D.gen;
  st.turn = 'them'; st.phase = 'busy'; hover = null; layout(); badge();
  D.say('The computer is thinking…', 'them');
  await D.sleep(0.9); if (!D.live(g)) return;
  let cd = pickCard();
  while (!cd) { // draw until something fits
    if (!st.stock.length && !(await refillStock(g))) { if (!D.live(g)) return; D.say('The computer can’t play or draw. It passes.', 'them'); await D.sleep(1.1); return myTurn(); }
    if (!D.live(g)) return;
    D.say('The computer draws a card.', 'them');
    st.them.push(st.stock.pop()); layout({ dur: 0.45, arc: 2.4, snd: 'slide', vol: 0.28 });
    await D.idle(); await D.sleep(0.35); if (!D.live(g)) return;
    cd = pickCard();
  }
  st.them.splice(st.them.indexOf(cd), 1); cd._yaw = (Math.random() - 0.5) * 0.24; st.pile.push(cd); st.suit = cd.suit;
  layout({ dur: 0.5, arc: 2.6, snd: 'place', vol: 0.3 });
  await D.idle(); if (!D.live(g)) return;
  if (!st.them.length) return win('them');
  if (cd.rank === 8) {
    st.suit = bestSuit(); badge(); sound.play('place', { vol: 0.2, rate: 1.2 });
    D.say(`Crazy eight! The computer picks ${SUIT[st.suit].name} ${SUIT[st.suit].glyph}`, 'them');
    await D.sleep(1.3); if (!D.live(g)) return;
  } else { D.say(`The computer played ${a1(cd.rank)} ${RANK1(cd.rank)} of ${SUIT[cd.suit].name}.`, 'them'); await D.sleep(0.9); if (!D.live(g)) return; }
  if (st.them.length === 1) { lastCard('them'); await D.sleep(1); if (!D.live(g)) return; }
  myTurn();
}

function sync() {
  if (!hud.mine || !st) return;
  hud.mine.textContent = st.me.length; hud.theirs.textContent = st.them.length; hud.deck.textContent = st.stock.length;
}

// ---------- input ----------
const cv = T.canvas;
const mineAt = (e) => T.pick(e.clientX, e.clientY, (c) => st.me.includes(c));
function onDeck(e) {
  if (T.pick(e.clientX, e.clientY, (c) => st.stock.includes(c))) return true;
  const p = T.onPlane(e.clientX, e.clientY), s = G().stock;
  return p && Math.abs(p.x - s.x) < S.w / 2 + 0.5 && Math.abs(p.z - s.z) < S.h / 2 + 0.5;
}
cv.addEventListener('pointermove', (e) => {
  if (!active || !st || e.pointerType !== 'mouse') return;
  const mine = st.phase === 'play' ? mineAt(e) : null, cd = mine && fits(mine) ? mine : null;
  if (cd !== hover) { hover = cd; layout(); }
  cv.style.cursor = cd || (st.phase === 'play' && onDeck(e)) ? 'pointer' : '';
});
// a tap while the computer plays hurries its turn along; a tap during the win skips to the result
cv.addEventListener('pointerdown', () => { if (!active || !st) return; if (celebrating) celebrating(); else if (st.turn === 'them') D.hurry(); });
cv.addEventListener('pointerup', (e) => {
  if (!active || !st || st.phase !== 'play') return;
  sound.unlock();
  const cd = mineAt(e);
  if (cd) {
    if (e.pointerType !== 'mouse' && fits(cd) && cd !== hover) { hover = cd; layout(); sound.play('slide', { vol: 0.12, rate: 1.3, gap: 60 }); return; } // on a touch screen the first tap lifts it, the second plays it
    return play(cd);
  }
  if (onDeck(e)) draw();
});
// keys: left / right choose among the cards that fit, Enter or Space plays it (or draws when nothing fits), 1-4 pick a
// suit after an 8; Enter or Space also hurries the computer
addEventListener('keydown', (e) => {
  if (!active || !st || e.target.closest('button, input, a')) return;
  if (st.turn === 'them') { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); D.hurry(); } return; }
  if (st.phase === 'suit' && '1234'.includes(e.key) && e.key) { chooseSuit('SHCD'[+e.key - 1]); return; }
  if (st.phase !== 'play') return;
  const ok = st.me.filter(fits);
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && ok.length) {
    e.preventDefault(); const i = ok.indexOf(hover), n = ok.length;
    hover = ok[i < 0 ? (e.key === 'ArrowLeft' ? n - 1 : 0) : (i + (e.key === 'ArrowLeft' ? -1 : 1) + n) % n]; layout(); sound.tick(0.3); return;
  }
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  if (hover && fits(hover)) play(hover); else if (!ok.length) draw();
});

// ---------- view ----------
function frameIt() { T.frame(portrait() ? 31 : 66, portrait() ? 74 : 56, portrait() ? -5 : -2.6, 64); } // room above for the speech line, below for the bar
export function enter() { active = true; frameIt(); if (!st) { T.snapCamera(); deal(); } else layout(); }
export function leave() { active = false; hover = null; cv.style.cursor = ''; }
export function resize() { T.resize(); if (!built) return; frameIt(); layout({ dur: 0.3, arc: 0.5 }); }
export function setTheme(t) { T.setTheme(t); }
export function exposure(dark) { return dark ? 1.08 : 1.05; }
export function update(dt) {
  T.update(dt * (D.hurried ? 1.8 : 1)); D.tick(dt);
  // the suit badge sits beside the pile wherever the pile is on screen
  if (hud.badge && st) { const v = G().pile.clone().add(new THREE.Vector3(S.w / 2 + 2.6, 0, 0)).project(camera); hud.badge.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`; hud.badge.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`; }
  return true;
}
