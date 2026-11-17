// Shared card table for the playing-card games: scene, lighting, card meshes, arc moves with mid-air flips, picking.
import * as THREE from 'three';
import { envFor, tex, STOCK, paperMaterial, edgeMaterial, cardGeometry, clamp, lerp, renderer, qFaceUp, qBackUpright, yawQ } from './core.js';
import * as sound from './sound.js';

const A = 'assets/';
export const S = STOCK.playing;
const RANKV = { A: 1, J: 11, Q: 12, K: 13 };
let manifest = null;
export function setManifest(m) { manifest = m; }
const Z = new THREE.Vector3(0, 0, 1);

export function createTable() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 5, 600);
  let env = envFor(document.documentElement.dataset.theme);
  scene.environment = env;
  const hemi = new THREE.HemisphereLight(0xfff4e6, 0x1a1a2a, 0.35); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff5ec, 2.2);
  key.position.set(-20, 70, 35); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 5, far: 180 });
  key.shadow.radius = 4; key.shadow.bias = -0.0002; key.shadow.normalBias = 0.01;
  scene.add(key);
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const r = g.createRadialGradient(128, 128, 30, 128, 128, 128); r.addColorStop(0, '#fff'); r.addColorStop(0.22, '#c8c8c8'); r.addColorStop(0.5, '#3a3a3a'); r.addColorStop(1, '#000'); g.fillStyle = r; g.fillRect(0, 0, 256, 256);
  const tableMat = new THREE.MeshStandardMaterial({ color: 0x0e0e0d, roughness: 0.95, transparent: true, alphaMap: new THREE.CanvasTexture(c), envMapIntensity: 0.25 });
  const table = new THREE.Mesh(new THREE.CircleGeometry(90, 96), tableMat); table.rotation.x = -Math.PI / 2; table.receiveShadow = true; scene.add(table);
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.ShadowMaterial({ color: 0x5a4632, opacity: 0.22 }));
  catcher.rotation.x = -Math.PI / 2; catcher.position.y = 0.0005; catcher.receiveShadow = true; scene.add(catcher);

  // ---------- slot markers: faint rounded outlines where piles live ----------
  const slotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false });
  function slotShape() { const s = new THREE.Shape(), w = S.w / 2, h = S.h / 2, rr = S.r; s.moveTo(-w + rr, -h); s.lineTo(w - rr, -h); s.quadraticCurveTo(w, -h, w, -h + rr); s.lineTo(w, h - rr); s.quadraticCurveTo(w, h, w - rr, h); s.lineTo(-w + rr, h); s.quadraticCurveTo(-w, h, -w, h - rr); s.lineTo(-w, -h + rr); s.quadraticCurveTo(-w, -h, -w + rr, -h); return s; }
  const ringGeo = (() => { const outer = slotShape(); const inner = new THREE.Path(slotShape().getPoints(24).map((p) => p.multiplyScalar(0.93)).reverse()); outer.holes.push(inner); const geo = new THREE.ShapeGeometry(outer, 8); geo.rotateX(-Math.PI / 2); return geo; })();
  function slot(x, z, label) { const m = new THREE.Mesh(ringGeo, slotMat); m.position.set(x, 0.003, z); scene.add(m); return m; }

  // ---------- cards ----------
  const cards = new Map();
  let backMat, edgeMat;
  function card(id) {
    if (cards.has(id)) return cards.get(id);
    if (!backMat) { backMat = paperMaterial(S, tex(`${A}pc/full/back.webp`), env); edgeMat = edgeMaterial(S, env); }
    const mesh = new THREE.Mesh(cardGeometry(S), [paperMaterial(S, tex(`${A}pc/full/${id}.webp`), env, true), backMat, edgeMat]);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.visible = false; scene.add(mesh);
    const rank = id.length === 3 ? 10 : (RANKV[id[0]] || +id[0]), suit = id[id.length - 1];
    const cd = { id, rank, suit, red: suit === 'H' || suit === 'D', mesh, faceUp: false, anim: null, pos: new THREE.Vector3() };
    mesh.quaternion.copy(qBackUpright); mesh.userData.card = cd; cards.set(id, cd);
    return cd;
  }
  const deck52 = () => ['S', 'H', 'C', 'D'].flatMap((s) => ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].map((r) => r + s));
  function shuffled() { const a = deck52(); for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a.map(card); }

  // move a card along an arc to `pos`, optionally flipping on the way (half-turn about its long axis)
  let flightNo = 0;
  // yaw: a turn about the table's upright axis (a fanned hand, a loose pile); a flip always happens about the card's
  // own long axis, whatever way it's turned
  const baseQ = (up, yaw = 0) => (yaw ? yawQ(yaw).multiply(up ? qFaceUp : qBackUpright) : (up ? qFaceUp : qBackUpright).clone());
  function place(cd, pos, { faceUp = cd.faceUp, yaw = 0, dur = 0.38, delay = 0, arc = 1.5, snd = 'slide', vol = 0.3, onDone } = {}) {
    cd.mesh.visible = true;
    const flip = faceUp !== cd.faceUp;
    cd.anim = { order: ++flightNo, from: cd.mesh.position.clone(), to: pos.clone(), fromQ: cd.mesh.quaternion.clone(), toQ: baseQ(faceUp, yaw), flip, sign: faceUp ? 1 : -1, fromUp: cd.faceUp, fromYaw: cd.yaw || 0, toYaw: yaw, dur, t: -delay, arc: arc + (flip ? 2 : 0), snd, vol, onDone, started: false };
    cd.faceUp = faceUp; cd.yaw = yaw; cd.pos.copy(pos);
  }
  function snapTo(cd, pos, faceUp = cd.faceUp, yaw = 0) { cd.anim = null; cd.faceUp = faceUp; cd.yaw = yaw; cd.pos.copy(pos); cd.mesh.visible = true; cd.mesh.position.copy(pos); cd.mesh.quaternion.copy(baseQ(faceUp, yaw)); }
  // ---------- gathering the deck ----------
  // gather(posOf, done): sweep every card into one face-down stack at posOf(0..51) (bottom to top) without any card
  // passing through another. Cards already lying in that stack stay where they are; every other card is picked up
  // top-of-its-pile first and lands on top, in turn. Once they are all face down the deck is shuffled by quietly
  // swapping which card is which (every back looks the same, so nothing visibly jumps). done(order) gets the deck,
  // bottom card first.
  function gather(posOf, done) {
    const base = posOf(0), all = [...cards.values()];
    for (const cd of all) if (!cd.mesh.visible) { cd.mesh.visible = true; cd.mesh.position.copy(posOf(0)).setY(30); } // never seen yet: drops in from above
    const inPile = (cd) => !cd.anim && !cd.faceUp && Math.hypot(cd.mesh.position.x - base.x, cd.mesh.position.z - base.z) < 0.05;
    const stay = all.filter(inPile).sort((p, q) => p.mesh.position.y - q.mesh.position.y);
    const come = all.filter((cd) => !stay.includes(cd)).sort((p, q) => q.mesh.position.y - p.mesh.position.y);
    stay.forEach((cd, i) => { if (cd.mesh.position.distanceTo(posOf(i)) > 0.002) place(cd, posOf(i), { faceUp: false, dur: 0.2, arc: 0, snd: null }); });
    const finish = () => {
      const order = shuffled(); // the new deck, bottom first
      order.forEach((cd, k) => snapTo(cd, posOf(k), false));
      done(order);
    };
    if (!come.length) { setTimeout(finish, stay.some((cd) => cd.anim) ? 220 : 0); return; }
    let left = come.length;
    come.forEach((cd, i) => place(cd, posOf(stay.length + i), { faceUp: false, dur: 0.45, delay: i * 0.03, arc: 1.6, snd: null, onDone: () => { if (--left === 0) finish(); } }));
    sound.play('shove', { vol: 0.25 });
  }
  const busy = () => { for (const cd of cards.values()) if (cd.anim) return true; return false; };

  // ---------- picking ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function pick(x, y, filter = () => true) {
    ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
    const list = [...cards.values()].filter((c) => c.mesh.visible && filter(c)).map((c) => c.mesh);
    const hit = ray.intersectObjects(list, false)[0];
    return hit ? hit.object.userData.card : null;
  }
  function onPlane(x, y, h = 0) { ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); plane.constant = -h; const o = new THREE.Vector3(); return ray.ray.intersectPlane(plane, o) ? o : null; }

  // ---------- camera ----------
  const camGoal = new THREE.Vector3(0, 80, 30), camPos = new THREE.Vector3(0, 110, 60), look = new THREE.Vector3(), lookGoal = new THREE.Vector3();
  function frame(spanW, spanH, cz = 0, elevDeg = 74) {
    const aspect = innerWidth / innerHeight, vf = THREE.MathUtils.degToRad(camera.fov);
    const d = Math.max((spanH / 2) / Math.tan(vf / 2), (spanW / 2) / (Math.tan(vf / 2) * aspect));
    const el = THREE.MathUtils.degToRad(elevDeg);
    camGoal.set(0, Math.sin(el) * d, cz + Math.cos(el) * d); lookGoal.set(0, 0, cz);
  }
  function snapCamera() { camPos.copy(camGoal); look.copy(lookGoal); }

  // ---------- frame ----------
  let tm = 0;
  const qA = new THREE.Quaternion();
  function update(dt) {
    tm += dt;
    camPos.lerp(camGoal, 1 - Math.exp(-dt * 2.5)); look.lerp(lookGoal, 1 - Math.exp(-dt * 2.5));
    camera.position.copy(camPos); camera.lookAt(look);
    for (const cd of cards.values()) {
      const a = cd.anim; if (!a) continue;
      a.t += dt; if (a.t < 0) continue;
      if (!a.started) { a.started = true; a.from.copy(cd.mesh.position); a.fromQ.copy(cd.mesh.quaternion); if (a.snd) sound.play(a.snd, { vol: a.vol, gap: 22 }); }
      const k = clamp(a.t / a.dur, 0, 1), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      cd.mesh.position.lerpVectors(a.from, a.to, e); cd.mesh.position.y += Math.sin(Math.PI * k) * a.arc;
      if (a.flip && (a.fromYaw || a.toYaw)) { qA.setFromAxisAngle(Z, a.sign * Math.PI * e); cd.mesh.quaternion.copy(yawQ(lerp(a.fromYaw, a.toYaw, e))).multiply(qA).multiply(a.fromUp ? qFaceUp : qBackUpright); }
      else if (a.flip) { qA.setFromAxisAngle(Z, a.sign * Math.PI * e); cd.mesh.quaternion.copy(qA).multiply(a.fromQ); }
      else cd.mesh.quaternion.slerpQuaternions(a.fromQ, a.toQ, e);
      if (k >= 1) { cd.mesh.position.copy(a.to); cd.mesh.quaternion.copy(a.toQ); cd.anim = null; a.onDone && a.onDone(); }
    }
    clearFlights(dt);
  }
  // ---------- no card ever passes through another ----------
  // Cards in flight are checked against every other card (as thin oriented boxes). One that would cut into another
  // is lifted just clear of it; the later card always goes over the earlier one, and the lift eases away afterwards.
  const ob = (m) => { const e = m.matrixWorld.elements; const ax = [0, 1, 2].map((i) => new THREE.Vector3(e[i * 4], e[i * 4 + 1], e[i * 4 + 2]).normalize()); return { c: m.position.clone(), ax, h: [S.w / 2 - 0.12, S.h / 2 - 0.12, S.t / 2] }; };
  const pj = (o, a) => o.h[0] * Math.abs(o.ax[0].dot(a)) + o.h[1] * Math.abs(o.ax[1].dot(a)) + o.h[2] * Math.abs(o.ax[2].dot(a));
  const UP = new THREE.Vector3(0, 1, 0), tmpV = new THREE.Vector3();
  function overlaps(A, B) {
    const axes = [...A.ax, ...B.ax]; for (const a of A.ax) for (const b of B.ax) { const x = tmpV.crossVectors(a, b); if (x.lengthSq() > 1e-6) axes.push(x.clone().normalize()); }
    const d = new THREE.Vector3().subVectors(B.c, A.c);
    for (const a of axes) if (pj(A, a) + pj(B, a) - Math.abs(d.dot(a)) <= 0.002) return false;
    return true;
  }
  function clearFlights(dt) {
    const all = [...cards.values()].filter((c) => c.mesh.visible);
    const flying = all.filter((c) => c.anim && c.anim.started).sort((p, q) => (p.anim.order || 0) - (q.anim.order || 0));
    for (const c of all) if (!c.anim) c.lift = 0;
    if (!flying.length) return;
    for (const c of all) c.mesh.updateMatrixWorld();
    const boxes = new Map(all.map((c) => [c, ob(c.mesh)]));
    for (const f of flying) {
      // start from where the card was being held up last frame (easing down), then lift it clear of anything it meets
      const F = boxes.get(f), base = F.c.y;
      F.c.y = base + (f.lift || 0) * Math.exp(-dt * 8);
      const others = all.filter((o) => o !== f).sort((p, q) => boxes.get(p).c.y - boxes.get(q).c.y); // bottom up
      for (let pass = 0; pass < 40; pass++) {
        let hit = false;
        for (const o of others) {
          if (o === f) continue;
          if (o.anim && o.anim.started && (o.anim.order || 0) > (f.anim.order || 0)) continue; // later cards yield to this one
          const O = boxes.get(o);
          if (!overlaps(F, O)) continue;
          const up = O.c.y + pj(O, UP) - (F.c.y - pj(F, UP)) + 0.004;
          if (up > 0) { F.c.y += up; hit = true; }
        }
        if (!hit) break;
      }
      f.lift = F.c.y - base; f.mesh.position.y = F.c.y;
    }
  }
  function setTheme(t) {
    env = envFor(t); scene.environment = env;
    const dark = t === 'dark';
    table.visible = false; catcher.visible = true; catcher.material.color.set(dark ? 0x000000 : 0x5a4632); catcher.material.opacity = dark ? 0.55 : 0.22; slotMat.color.set(dark ? 0xffffff : 0x3a3127); slotMat.opacity = dark ? 0.09 : 0.1; // no table top: the cards cast soft shadows straight onto the scene behind
    hemi.intensity = dark ? 0.3 : 0.95; hemi.groundColor.set(dark ? 0x161514 : 0xc9bfb0);
    key.intensity = dark ? 1.9 : 2.2; key.color.set(dark ? 0xfff5ec : 0xfffaf2);
  }
  setTheme(document.documentElement.dataset.theme);
  function resize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
  const api = { scene, camera, card, cards, shuffled, place, snapTo, gather, busy, pick, onPlane, frame, snapCamera, update, setTheme, resize, slot, canvas: renderer.domElement };
  // calibration helper (tests): a face-up Ace of Spades flat in the middle of the table; returns its screen box
  return api;
}
export const Y = (k) => S.t / 2 + 0.003 + k * 0.045; // height of the k-th card in a pile
