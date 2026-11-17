// Shared parts of the two-player card games (Go Fish, Crazy Eights): a game clock that only runs while the table is
// on screen (so a turn never races ahead of its own animation), hands fanned like they're held, a speech bubble for
// what each side says, soft dimming of cards you can't use, and hover lifts on your own cards.
import * as THREE from 'three';
import { S, Y } from './cardtable.js';
import * as sound from './sound.js';

export const RANK1 = (r) => ({ 1: 'Ace', 11: 'Jack', 12: 'Queen', 13: 'King' })[r] || String(r);
export const RANKS = (r) => ({ 1: 'Aces', 11: 'Jacks', 12: 'Queens', 13: 'Kings' })[r] || `${r}s`;
// (\uFE0E: always the plain text suit, never a colour emoji)
export const SUIT = { S: { glyph: '♠\uFE0E', name: 'Spades', red: false }, H: { glyph: '♥\uFE0E', name: 'Hearts', red: true }, C: { glyph: '♣\uFE0E', name: 'Clubs', red: false }, D: { glyph: '♦\uFE0E', name: 'Diamonds', red: true } };
export const a1 = (r) => (r === 1 || r === 8 ? 'an' : 'a'); // "an Ace", "an 8"
export const portrait = () => innerWidth / innerHeight < 1;

// The computer's pace: relaxed (the default) or quick, kept between visits; shared by both games.
let quick = false;
try { quick = localStorage.getItem('jm-pace') === 'quick'; } catch (e) {}
function setQuick(v) { quick = v; try { localStorage.setItem('jm-pace', v ? 'quick' : 'relaxed'); } catch (e) {} dispatchEvent(new Event('jm-pace')); }
// the Quick toggle in each game's bar (both stay in step)
export function paceButton(b) {
  const sync = () => { b.setAttribute('aria-pressed', String(quick)); b.title = quick ? 'The computer plays quickly' : 'The computer takes its time'; };
  b.addEventListener('click', () => { sound.unlock(); setQuick(!quick); sound.play('place', { vol: 0.2, rate: 1.2 }); });
  addEventListener('jm-pace', sync); sync();
}

export function duel(T, { bubble }) {
  // ---------- clock ----------
  // hurry: a tap during the computer's turn speeds the rest of that turn along (cleared when it's your turn again)
  let now = 0, gen = 0, hurried = false;
  const hurry = () => { hurried = true; };
  const calm = () => { hurried = false; };
  const rate = () => (hurried ? 2.6 : 1) * (quick ? 1.7 : 1);
  const waits = [];
  const sleep = (s) => new Promise((r) => waits.push({ at: now + s, r, g: gen }));
  const idle = () => new Promise((r) => waits.push({ idle: true, r, g: gen, at: now + 0.02 }));
  // a new game cancels every wait still pending from the last one
  const fresh = () => { gen++; waits.length = 0; return gen; };
  const live = (g) => g === gen;

  // ---------- hands ----------
  // A hand fans out like it's held: spread along a gentle arc, each card turned a little away from the middle.
  // mine = the near side, face up; otherwise the far side (the other player's), face down.
  function fanPoses(n, z, maxW, mine) {
    const step = n > 1 ? Math.min(S.w * 0.74, maxW / (n - 1)) : 0, half = Math.max(1, ((n - 1) * step) / 2);
    return Array.from({ length: n }, (_, i) => {
      const x = (i - (n - 1) / 2) * step, u = x / Math.max(half, S.w * 2);
      return { pos: new THREE.Vector3(x, Y(i), z + (mine ? 1 : -1) * u * u * 1.4), yaw: (mine ? -1 : 1) * u * 0.16 };
    });
  }
  // move a card only if it isn't already there (or on its way there)
  function go(cd, pos, faceUp, yaw = 0, o = {}) {
    if (cd.pos.distanceTo(pos) < 0.001 && cd.faceUp === faceUp && Math.abs((cd.yaw || 0) - yaw) < 1e-4 && (cd.anim || cd.mesh.visible)) return false;
    T.place(cd, pos, { faceUp, yaw, dur: 0.36, arc: 1.2, snd: null, ...o });
    return true;
  }

  // ---------- dimming (cards you can't play now) ----------
  const dimOf = new Map();
  function dim(cd, on) { dimOf.set(cd, on ? 1 : 0); }
  function stepDim(dt) {
    for (const [cd, goal] of dimOf) {
      const m = cd.mesh.material[0]; if (m.userData.base == null) m.userData.base = m.color.r;
      const cur = m.userData.dim || 0, v = cur + (goal - cur) * (1 - Math.exp(-dt * 10));
      m.userData.dim = v; m.color.setScalar(m.userData.base * (1 - 0.38 * v));
    }
  }

  // ---------- speech ----------
  // one line at a time: who's talking ("you", "them" or the table itself) and what they say
  let sayT = 0;
  function say(text, who = 'table') {
    if (!bubble) return;
    bubble.dataset.who = who; bubble.textContent = text;
    bubble.classList.remove('pop'); void bubble.offsetWidth; bubble.classList.add('pop', 'on');
    sayT = now;
  }
  function hush() { if (bubble) bubble.classList.remove('on'); }

  function tick(dt) {
    now += dt * rate();
    for (let i = waits.length - 1; i >= 0; i--) {
      const w = waits[i];
      if (w.g !== gen) { waits.splice(i, 1); continue; }
      if (now >= w.at && (!w.idle || !T.busy())) { waits.splice(i, 1); w.r(); }
    }
    stepDim(dt);
  }
  // ---------- a win ----------
  // the winner's cards rise and open into a wide fan across the middle of the table, one after another, with a chime
  function celebrate(cards, at) {
    const n = cards.length, span = Math.min(2.4, 2.1 + n * 0.01), R = 15;
    cards.forEach((cd, i) => {
      const a = n > 1 ? -span / 2 + (span * i) / (n - 1) : 0;
      const pos = new THREE.Vector3(at.x + Math.sin(a) * R, Y(i) + 1.2, at.z + R * 0.55 - Math.cos(a) * R * 0.55);
      T.place(cd, pos, { faceUp: true, yaw: -a * 0.9, dur: 0.6, delay: 0.25 + i * 0.035, arc: 3.2, snd: i % 5 ? null : 'slide', vol: 0.18 });
    });
    sound.chime([0, 4, 7, 12], { vol: 0.24, gap: 0.12 });
  }
  return { sleep, idle, fresh, live, fanPoses, go, dim, say, hush, tick, hurry, calm, rate, celebrate, get hurried() { return hurried; }, get gen() { return gen; } };
}
