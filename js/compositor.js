// Two-layer compositor: each 3D layer renders into its own HDR target, then is tone-mapped onto the canvas
// with its own opacity. The top layer can carry a horizontal motion blur (for fast card flipping).
import * as THREE from 'three';
import { renderer } from './core.js';

const size = new THREE.Vector2();
// Smooth edges: on standard-density screens each layer is rendered at twice the resolution (plus 4x MSAA) and the
// bilinear lookup at each screen pixel averages the 2x2 block under it; high-density screens already have the pixels.
// quality: 0 full .. 2 lightest (adaptive quality, app.js). Supersampling and the depth-of-field taps are what it trims.
let quality = 0;
const TAPS = [128, 64, 40];
const ss = () => (quality === 0 && renderer.getPixelRatio() < 1.5 ? 2 : 1);
function makeRT() {
  renderer.getDrawingBufferSize(size);
  const rt = new THREE.WebGLRenderTarget(size.x * ss(), size.y * ss(), { type: THREE.HalfFloatType, samples: 4, colorSpace: THREE.LinearSRGBColorSpace });
  rt.texture.minFilter = THREE.LinearFilter; rt.texture.magFilter = THREE.LinearFilter; rt.texture.generateMipmaps = false;
  return rt;
}
const rtA = makeRT(), rtB = makeRT();


const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const mat = new THREE.ShaderMaterial({
  uniforms: { tex: { value: null }, opacity: { value: 1 }, blur: { value: 0 }, texel: { value: new THREE.Vector2() }, gain: { value: new THREE.Vector3(1, 1, 1) }, shift: { value: 0 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tex; uniform float opacity; uniform float blur; uniform vec2 texel; uniform vec3 gain; uniform float shift; varying vec2 vUv;
    void main(){
      vec4 c; vec2 uv = vUv - vec2(shift, 0.0); // a sideways push between scenes
      if (abs(blur) < 0.5) c = texture2D(tex, uv);
      else {
        // 15-tap box blur along x, length = blur pixels
        c = vec4(0.0);
        for (int i = 0; i < 15; i++) { float o = (float(i) / 14.0 - 0.5) * blur; vec2 q = uv + vec2(o * texel.x, 0.0); c += (q.x < 0.0 || q.x > 1.0) ? vec4(0.0) : texture2D(tex, q); }
        c /= 15.0;
      }
      if (abs(blur) < 0.5 && (uv.x < 0.0 || uv.x > 1.0)) c = vec4(0.0);
      gl_FragColor = vec4(c.rgb * gain, c.a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      gl_FragColor *= opacity; // premultiplied output
    }`,
  transparent: true, depthTest: false, depthWrite: false, toneMapped: true,
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
});
// a second quad material without the filmic curve: colour-true output for card close-ups
const matLinear = mat.clone(); matLinear.toneMapped = false;
matLinear.uniforms = mat.uniforms;
// ---------- Depth of field (card close-ups) ----------
// A real lens on the rendered scene, from its depth buffer, in the way modern game engines do it (Jimenez, "Next
// generation post-processing in Call of Duty: AW"): every pixel's blur circle comes from its real distance (thin lens
// focused on the card); the far field and the near field are blurred separately at half size, so the sharp card never
// bleeds onto what's behind it while blurred flakes in front of it do spread over its edges, as a lens shows them.
// Blurs are lens-shaped (a disc), cleaned by a small fill pass, and laid back over the sharp image with ordinary
// alpha blending.
// The flakes are rendered into their own target, together with the depth of the cards (so a card hides the flakes
// behind it); that target is what the lens works on. The blurred snow is then laid under the card (what is beyond the
// focus) and over it (what is in front), so the card itself is never touched by the blur.
const rtS = makeRT(); rtS.depthTexture = new THREE.DepthTexture(rtS.width, rtS.height); rtS.depthTexture.type = THREE.UnsignedIntType;
const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
const half = () => { renderer.getDrawingBufferSize(size); return [Math.max(1, size.x >> 1), Math.max(1, size.y >> 1)]; };
const mkHalf = () => { const [w, h] = half(); const t = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: false }); t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter; t.texture.generateMipmaps = false; return t; };
const H = { col: mkHalf(), coc: mkHalf(), d1: mkHalf(), d2: mkHalf(), far: mkHalf(), near: mkHalf(), f1: mkHalf(), f2: mkHalf() };
const VS = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const LENS = /* glsl */`uniform float near; uniform float far; uniform float focus; uniform float A;
  float dist(float z){ return near * far / (far - z * (far - near)); }
  float coc(float z){ return A * (1.0 / focus - 1.0 / dist(z)); } // >0 beyond the focus, <0 in front (half-res px)`;
const pass = (fs, u) => new THREE.ShaderMaterial({ uniforms: u, vertexShader: VS, fragmentShader: fs, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
const U = () => ({ near: { value: 1 }, far: { value: 300 }, focus: { value: 60 }, A: { value: 0 } });
// 1. colour to half size (2x2 average of the premultiplied colour)
const pDownCol = pass(/* glsl */`uniform sampler2D tex; uniform vec2 tx; varying vec2 vUv;
  void main(){ gl_FragColor = 0.25 * (texture2D(tex, vUv + tx * vec2(-0.5, -0.5)) + texture2D(tex, vUv + tx * vec2(0.5, -0.5)) + texture2D(tex, vUv + tx * vec2(-0.5, 0.5)) + texture2D(tex, vUv + tx * vec2(0.5, 0.5))); }`,
  { tex: { value: null }, tx: { value: new THREE.Vector2() } });
// 2. blur circles to half size: far = the smallest of the 2x2 (so focus edges stay crisp), near = the largest
const pDownCoc = pass(/* glsl */`uniform sampler2D depth; uniform vec2 tx; varying vec2 vUv; ${LENS}
  void main(){ float f = 1e5; float n = 0.0;
    for (int i = 0; i < 4; i++) { vec2 o = vec2(float(i - (i / 2) * 2) - 0.5, float(i / 2) - 0.5); float c = coc(texture2D(depth, vUv + tx * o).x); f = min(f, max(c, 0.0)); n = max(n, max(-c, 0.0)); }
    gl_FragColor = vec4(f, n, 0.0, 1.0); }`, { depth: { value: null }, tx: { value: new THREE.Vector2() }, ...U() });
// 3. near blur circles spread outward (max filter, one axis at a time) then softened: a blurred flake in front covers
//    what lies around it, not only its own pixels
const pMax = pass(/* glsl */`uniform sampler2D src; uniform vec2 dir; uniform float R; varying vec2 vUv;
  void main(){ float m = 0.0; for (int i = -48; i <= 48; i++) { float o = float(i); if (abs(o) > R) continue; vec2 q = vUv + dir * o; if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) continue; m = max(m, texture2D(src, q).g); }
    gl_FragColor = vec4(texture2D(src, vUv).r, m, 0.0, 1.0); }`, { src: { value: null }, dir: { value: new THREE.Vector2() }, R: { value: 1 } });
const pSoft = pass(/* glsl */`uniform sampler2D src; uniform vec2 dir; varying vec2 vUv;
  void main(){ vec4 c = vec4(0.0); float n = 0.0; for (int i = -6; i <= 6; i++) { vec2 q = vUv + dir * float(i); if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) continue; c += texture2D(src, q); n += 1.0; } c /= max(n, 1.0); gl_FragColor = vec4(texture2D(src, vUv).r, c.g, 0.0, 1.0); }`,
  { src: { value: null }, dir: { value: new THREE.Vector2() } });
// 4/5. lens-shaped gathers (64 taps on a golden-angle disc). Far: a neighbour counts if its own circle reaches here
//      and it is not in front. Near: averaged over the spread circle; taps that miss count as clear, so the result is
//      the flake's colour with its true coverage.
// the disc is turned per pixel (interleaved gradient noise), so the taps never line up into a visible pattern
const DISC = /* glsl */`const int N = 128; uniform float taps;
  float inside(vec2 q){ return step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0); } // past the screen edge is empty
  float hrot(){ return 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); }
  vec2 tap(int i, float R, float rot){ float fi = float(i) + 0.5; float r = sqrt(fi / taps) * R; float a = fi * 2.39996323 + rot; return vec2(cos(a), sin(a)) * r; }`;
const pFar = pass(/* glsl */`uniform sampler2D col; uniform sampler2D coc; uniform vec2 tx; uniform float R; varying vec2 vUv; ${DISC}
  void main(){ float rot = hrot();
    vec2 cc = texture2D(coc, vUv).rg; float c0 = cc.r, own = step(cc.g, 0.25); // a pixel touched by a flake in front is not part of the far field
    vec4 acc = texture2D(col, vUv) * own; float w = own;
    if (c0 < 0.5) { gl_FragColor = acc; return; }
    for (int i = 0; i < N; i++) { if (float(i) >= taps) break; vec2 o = tap(i, R, rot); float r = length(o); vec2 q = vUv + o * tx; vec2 cs = texture2D(coc, q).rg;
      float hit = smoothstep(r - 1.0, r, cs.r) * step(cs.g, 0.25) * inside(q); acc += texture2D(col, q) * hit; w += hit; }
    gl_FragColor = w > 0.0 ? acc / w : vec4(0.0); }`, { col: { value: null }, coc: { value: null }, tx: { value: new THREE.Vector2() }, R: { value: 8 }, taps: { value: 128 } });
const pNear = pass(/* glsl */`uniform sampler2D col; uniform sampler2D coc; uniform sampler2D dil; uniform vec2 tx; varying vec2 vUv; ${DISC}
  void main(){ float rot = hrot();
    float Rn = texture2D(dil, vUv).g; if (Rn < 0.5) { gl_FragColor = vec4(0.0); return; }
    vec4 acc = vec4(0.0);
    for (int i = 0; i < N; i++) { if (float(i) >= taps) break; vec2 o = tap(i, Rn, rot); float r = length(o); vec2 q = vUv + o * tx; float cn = texture2D(coc, q).g;
      acc += texture2D(col, q) * smoothstep(r - 1.0, r, cn) * step(0.5, cn) * inside(q); }
    gl_FragColor = acc / taps; }`, { col: { value: null }, coc: { value: null }, dil: { value: null }, tx: { value: new THREE.Vector2() }, taps: { value: 128 } });
// 6. fill: a small tent filter closes the gaps between taps
const pFill = pass(/* glsl */`uniform sampler2D src; uniform vec2 tx; varying vec2 vUv;
  void main(){ vec4 c = vec4(0.0); float w = 0.0; for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) { float k = (3.0 - abs(float(x))) * (3.0 - abs(float(y))); c += texture2D(src, vUv + tx * vec2(float(x), float(y))) * k; w += k; } gl_FragColor = c / w; }`,
  { src: { value: null }, tx: { value: new THREE.Vector2() } });
// 7. laying the snow back: 'under' (before the card is drawn) = everything beyond the focus, sharp where it is in focus
//    and the far field where it is not; 'over' (after the card) = the near field, plus the in-focus flakes just in
//    front. Ordinary "over" blending of premultiplied colour throughout.
const pComp = new THREE.ShaderMaterial({
  uniforms: { tex: { value: null }, depth: { value: null }, farT: { value: null }, nearT: { value: null }, gain: { value: new THREE.Vector3(1, 1, 1) }, opacity: { value: 1 }, over: { value: 0 }, ...U() },
  vertexShader: VS,
  fragmentShader: /* glsl */`uniform sampler2D tex; uniform sampler2D depth; uniform sampler2D farT; uniform sampler2D nearT; uniform vec3 gain; uniform float opacity; uniform float over; varying vec2 vUv; ${LENS}
    void main(){
      vec4 sharp = texture2D(tex, vUv); float c = coc(texture2D(depth, vUv).x); vec4 o;
      if (over < 0.5) o = c > 0.0 ? mix(sharp, texture2D(farT, vUv), smoothstep(0.4, 1.6, c)) : vec4(0.0);
      else { vec4 nr = texture2D(nearT, vUv); vec4 inf = c <= 0.0 ? sharp * (1.0 - smoothstep(0.4, 1.6, -c)) : vec4(0.0); o = nr + inf * (1.0 - nr.a); }
      gl_FragColor = vec4(o.rgb * gain, o.a) * opacity;
      #include <colorspace_fragment>
    }`,
  transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
});
function run(m, target) { quad.material = m; renderer.setRenderTarget(target); renderer.render(qScene, quadCam); }
function setLens(u, L, hScale) { u.near.value = L.camera.near; u.far.value = L.camera.far; u.focus.value = L.lens.focus; u.A.value = L.lens.A * hScale; }
function renderSnow(L) {
  const cam = L.camera, mask = cam.layers.mask, ac = renderer.autoClear;
  renderer.setRenderTarget(rtS); renderer.setClearColor(0x000000, 0); renderer.clear();
  cam.layers.set(0); L.scene.overrideMaterial = depthOnly; renderer.render(L.scene, cam); L.scene.overrideMaterial = null; // the cards' depth
  cam.layers.set(L.lens.layer); renderer.autoClear = false; renderer.render(L.scene, cam); renderer.autoClear = ac;     // the flakes
  cam.layers.mask = mask;
}
function drawLens(rt0, L, drawCard) {
  renderSnow(L); const rt = rtS;
  const hw = H.col.width, hh = H.col.height, hs = hw / innerWidth; // half-res px per css px
  const tx = new THREE.Vector2(1 / hw, 1 / hh), ftx = new THREE.Vector2(1 / rt.width, 1 / rt.height);
  pDownCol.uniforms.tex.value = rt.texture; pDownCol.uniforms.tx.value.copy(ftx); run(pDownCol, H.col);
  pDownCoc.uniforms.depth.value = rt.depthTexture; pDownCoc.uniforms.tx.value.copy(ftx); setLens(pDownCoc.uniforms, L, hs); run(pDownCoc, H.coc);
  const Rn = Math.min(48, L.lens.maxNear * hs), Rf = Math.min(30, L.lens.maxFar * hs); // (half-res px; the max filter reaches 48)
  pMax.uniforms.R.value = Rn;
  pMax.uniforms.src.value = H.coc.texture; pMax.uniforms.dir.value.set(1 / hw, 0); run(pMax, H.d1);
  pMax.uniforms.src.value = H.d1.texture; pMax.uniforms.dir.value.set(0, 1 / hh); run(pMax, H.d2);
  pSoft.uniforms.src.value = H.d2.texture; pSoft.uniforms.dir.value.set(1 / hw, 0); run(pSoft, H.d1);
  pSoft.uniforms.src.value = H.d1.texture; pSoft.uniforms.dir.value.set(0, 1 / hh); run(pSoft, H.d2);
  pFar.uniforms.col.value = H.col.texture; pFar.uniforms.coc.value = H.coc.texture; pFar.uniforms.tx.value.copy(tx); pFar.uniforms.R.value = Rf; run(pFar, H.f1);
  pFill.uniforms.tx.value.copy(tx); pFill.uniforms.src.value = H.f1.texture; run(pFill, H.far);
  pNear.uniforms.col.value = H.col.texture; pNear.uniforms.coc.value = H.coc.texture; pNear.uniforms.dil.value = H.d2.texture; pNear.uniforms.tx.value.copy(tx); run(pNear, H.f2);
  pFill.uniforms.src.value = H.f2.texture; run(pFill, H.near);
  renderer.setRenderTarget(null);
  const u = pComp.uniforms, g = Array.isArray(L.gain) ? L.gain : [L.gain || 1, L.gain || 1, L.gain || 1];
  u.tex.value = rt.texture; u.depth.value = rt.depthTexture; u.farT.value = H.far.texture; u.nearT.value = H.near.texture; u.gain.value.set(g[0], g[1], g[2]); u.opacity.value = L.opacity; setLens(u, L, hs);
  u.over.value = 0; quad.material = pComp; renderer.render(qScene, quadCam);  // snow beyond the focus
  drawCard();                                                                 // the card, sharp
  u.over.value = 1; quad.material = pComp; renderer.render(qScene, quadCam);  // snow in front of it
}
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
const qScene = new THREE.Scene(); qScene.add(quad);

export function setQuality(q) {
  quality = q; pFar.uniforms.taps.value = pNear.uniforms.taps.value = TAPS[q];
  resize();
}
export function resize() {
  renderer.getDrawingBufferSize(size);
  rtA.setSize(size.x * ss(), size.y * ss()); rtB.setSize(size.x * ss(), size.y * ss()); rtS.setSize(size.x * ss(), size.y * ss());
  const [hw, hh] = half(); for (const t of Object.values(H)) t.setSize(hw, hh);
}
function draw(rt, opacity, blur, linear, gain = 1, shift = 0) {
  mat.uniforms.shift.value = shift;
  quad.material = linear ? matLinear : mat;
  const g = Array.isArray(gain) ? gain : [gain, gain, gain]; mat.uniforms.gain.value.set(g[0], g[1], g[2]);
  mat.uniforms.tex.value = rt.texture; mat.uniforms.opacity.value = opacity;
  mat.uniforms.blur.value = blur; mat.uniforms.texel.value.set(1 / size.x, 1 / size.y);
  renderer.render(qScene, quadCam);
}
// layers: [{ scene, camera, opacity, blur, lens? { focus, A (css px), maxNear, maxFar } }]
export function render(layers) {
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 0); renderer.clear();
  for (const L of layers) {
    if (!L || !L.scene || L.opacity <= 0.001) continue;
    const rt = L.slot === 'B' ? rtB : rtA;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0); renderer.clear();
    renderer.render(L.scene, L.camera);
    renderer.setRenderTarget(null);
    const ex = renderer.toneMappingExposure; if (L.exposure) renderer.toneMappingExposure = L.exposure;
    const drawIt = () => draw(rt, L.opacity, (L.blur || 0) * renderer.getPixelRatio(), !!L.linear, L.gain || 1, L.shift || 0);
    if (L.lens) drawLens(rt, L, drawIt); else drawIt();
    renderer.toneMappingExposure = ex;
  }
}
