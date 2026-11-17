// Web Audio sound layer: every play gets slight pitch/volume variation so nothing sounds repeated.
// Everything is kept faint: in the background of what you're doing, never on top of it.
const FAINT = 0.6; // every recorded sound, at this share of the level it's asked for
const NAMES = {
  slide: ['cardSlide1', 'cardSlide2', 'cardSlide3', 'cardSlide4', 'cardSlide5', 'cardSlide6', 'cardSlide7', 'cardSlide8'],
  place: ['cardPlace1', 'cardPlace2', 'cardPlace3', 'cardPlace4'],
  shove: ['cardShove1', 'cardShove2', 'cardShove3', 'cardShove4'],
  fan: ['cardFan1', 'cardFan2'],
  shuffle: ['cardShuffle'],
  open: ['cardOpenPackage1', 'cardOpenPackage2'],
  takeout: ['cardTakeOutPackage1', 'cardTakeOutPackage2'],
  chipLay: ['chipLay1', 'chipLay2', 'chipLay3'],
  chipsHandle: ['chipsHandle1', 'chipsHandle2', 'chipsHandle3', 'chipsHandle4', 'chipsHandle5', 'chipsHandle6'],
  storm: ['snowstorm_swell_01', 'snowstorm_swell_02'], // the logo blizzard
};
let ctx = null, master = null, buffers = {}, enabled = true, loading = null;
try { enabled = localStorage.getItem('jm-sound') !== 'off'; } catch (e) {}
// overall loudness (the slider under the sound button), 0..1, kept between visits
let volume = 0.8;
try { const v = parseFloat(localStorage.getItem('jm-vol')); if (v >= 0 && v <= 1) volume = v; } catch (e) {}
const level = () => volume * volume * 1.25; // a gentle curve: the low end of the slider stays usable

function load() {
  if (loading) return loading;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = level();
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3;
  master.connect(comp).connect(ctx.destination);
  const all = Object.values(NAMES).flat();
  loading = Promise.all(all.map(async (n) => {
    try {
      const r = await fetch(`assets/sfx/${n}.mp3`);
      buffers[n] = await ctx.decodeAudioData(await r.arrayBuffer());
    } catch (e) { /* missing sound is fine */ }
  }));
  return loading;
}
// Must be called from a user gesture at least once.
export function unlock() {
  if (hidden) return;
  if (!ctx) load();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}
export function isOn() { return enabled; }
export const getVolume = () => volume;
export function setVolume(v) {
  volume = Math.max(0, Math.min(1, v)); try { localStorage.setItem('jm-vol', volume.toFixed(3)); } catch (e) {}
  if (master) master.gain.setTargetAtTime(level(), ctx.currentTime, 0.03);
}
// the tab is hidden: everything goes quiet (and the audio thread sleeps) until it's back
let hidden = false;
export function pause() { hidden = true; if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); }
export function resume() { hidden = false; if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); }
export function setOn(v) {
  enabled = v; try { localStorage.setItem('jm-sound', v ? 'on' : 'off'); } catch (e) {}
  if (v) unlock(); else if (wh) wh.g.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
}
const last = {};
// play('place', { vol: 0..1, rate: base pitch, pan: -1..1, gap: min ms between same kind })
// dur (ms): the sound may not outlast the motion it belongs to; it fades out and stops at dur
// take: always this take, exactly as recorded (a switch should sound the same every time)
export function play(kind, { vol = 0.7, rate = 1, pan = 0, gap = 40, delay = 0, dur = 0, take } = {}) {
  if (!enabled || !ctx) return;
  const now = performance.now();
  if (last[kind] && now - last[kind] < gap) return;
  last[kind] = now;
  const list = NAMES[kind]; if (!list) return; const fixed = take !== undefined;
  const buf = buffers[list[fixed ? take % list.length : (Math.random() * list.length) | 0]];
  if (!buf) return;
  const src = ctx.createBufferSource(); src.buffer = buf;
  src.playbackRate.value = rate * (fixed ? 1 : 0.92 + Math.random() * 0.16);
  const g = ctx.createGain(); g.gain.value = Math.max(0, Math.min(1, vol)) * FAINT * (fixed ? 1 : 0.85 + Math.random() * 0.15);
  let node = src.connect(g);
  if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); node = node.connect(p); }
  node.connect(master);
  const t0 = ctx.currentTime + delay / 1000; src.start(t0);
  if (dur > 0 && buf.duration / src.playbackRate.value > dur / 1000) {
    const end = t0 + dur / 1000, fade = Math.min(0.25, dur / 3000);
    g.gain.setValueAtTime(g.gain.value, end - fade); g.gain.linearRampToValueAtTime(0, end); src.stop(end + 0.02);
  }
}

// ---------- Generated sounds (no sample needed) ----------
// Air whoosh: looped noise through a moving band-pass; level follows speed.
let wh = null;
function whooshNode() {
  if (wh || !ctx) return wh;
  const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  let last = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = last * 0.96 + w * 0.04; d[i] = last * 3.2; } // brown-ish noise
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 0.7;
  const g = ctx.createGain(); g.gain.value = 0;
  src.connect(bp).connect(g).connect(master); src.start();
  wh = { bp, g }; return wh;
}
export function whoosh(level) { // level 0..1
  if (!enabled || !ctx) return;
  const w = whooshNode(); if (!w) return;
  const now = ctx.currentTime, l = Math.max(0, Math.min(1, level));
  w.g.gain.setTargetAtTime(l * l * 0.55 * 0.25, now, 0.06); // faint: a breath of air as the deck spins past
  w.bp.frequency.setTargetAtTime(380 + l * 1900, now, 0.08);
}
// Paper tick: a tiny filtered noise burst, like a card edge flicking past a thumb.
let tickBuf = null;
export function tick(speed = 0.5) {
  if (!enabled || !ctx) return;
  if (!tickBuf) {
    const n = Math.round(ctx.sampleRate * 0.03); tickBuf = ctx.createBuffer(1, n, ctx.sampleRate); const d = tickBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
  }
  const s = ctx.createBufferSource(); s.buffer = tickBuf; s.playbackRate.value = 0.8 + speed * 0.9 + Math.random() * 0.15;
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 900 + speed * 1500;
  const g = ctx.createGain(); g.gain.value = (0.18 + speed * 0.22) * FAINT;
  s.connect(f).connect(g).connect(master); s.start();
}

// Page turn: a soft paper swish (filtered noise with a slow swell), plus a light settle when it lands.
let paperBuf = null;
export function paper(strength = 0.6, dur = 0.42) {
  if (!enabled || !ctx) return;
  if (!paperBuf) {
    const n = Math.round(ctx.sampleRate * 0.6); paperBuf = ctx.createBuffer(1, n, ctx.sampleRate); const d = paperBuf.getChannelData(0);
    let a = 0; for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; a = a * 0.6 + w * 0.4; d[i] = a * (0.6 + 0.4 * Math.random()); }
  }
  const s = ctx.createBufferSource(); s.buffer = paperBuf; s.playbackRate.value = 0.85 + Math.random() * 0.25;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.6;
  const g = ctx.createGain(); const now = ctx.currentTime, v = 0.35 * strength * 0.4; // faint: paper, not wind
  bp.frequency.setValueAtTime(900, now); bp.frequency.linearRampToValueAtTime(2600, now + dur * 0.6); bp.frequency.linearRampToValueAtTime(1400, now + dur);
  g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(v, now + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  s.connect(bp).connect(g).connect(master); s.start(now); s.stop(now + dur + 0.05);
}

// A small bell: a few inharmonic partials with soft attacks and long, shimmering decays. Used for little wonders (a
// caught golden flake, a win). notes: semitone steps from the base pitch, played one after another.
export function chime(notes = [0, 7, 12], { vol = 0.35, gap = 0.09, base = 1046.5 } = {}) {
  if (!enabled || !ctx) return;
  const t0 = ctx.currentTime + 0.01;
  notes.forEach((n, i) => {
    const f0 = base * Math.pow(2, n / 12), at = t0 + i * gap;
    [[1, 1, 1.6], [2.76, 0.35, 0.9], [5.4, 0.12, 0.5], [0.5, 0.18, 1.2]].forEach(([m, a, d]) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f0 * m * (1 + (Math.random() - 0.5) * 0.004);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(vol * a * 0.5 * FAINT, at + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, at + d);
      o.connect(g).connect(master); o.start(at); o.stop(at + d + 0.05);
    });
  });
}

// the top buttons (and the game pace switch): one on sound and one off sound, the same every time
export function toggle(on) { play('place', { vol: 0.3, take: 0, rate: on ? 1.15 : 0.9, gap: 0 }); }
