// Iron Hawk - mobile web FPS prototype (mission 1)
import * as THREE from './three.module.min.js';

const $ = id => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const wrapAng = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
if (isTouch) document.body.classList.add('touch');

// =====================================================================
//  STORAGE (safe fallback if localStorage is blocked)
// =====================================================================
const store = {
  get(k, d) { try { const v = localStorage.getItem('ironhawk.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('ironhawk.' + k, JSON.stringify(v)); } catch (e) {} }
};
const settings = Object.assign({ sens: 1, quality: 'auto', sound: true, assist: true, fire2: true, invert: false }, store.get('settings', {}));
const saveSettings = () => store.set('settings', settings);

// =====================================================================
//  ADS - placeholder hooks; wired to a real ad network in a later milestone
// =====================================================================
const Ads = {
  interstitial(done) { done(); },          // between missions
  rewarded(onReward, onSkip) { onSkip(); } // e.g. "watch an ad to revive"
};

// =====================================================================
//  AUDIO (all procedural, nothing to download)
// =====================================================================
const AU = {
  ctx: null, master: null, noise: null,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
      this.master.gain.value = settings.sound ? 0.8 : 0;
      const len = this.ctx.sampleRate, buf = this.ctx.createBuffer(1, len, len), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
    } catch (e) { this.ctx = null; }
  },
  setOn(on) { if (this.master) this.master.gain.value = on ? 0.8 : 0; },
  burst(vol, freq, q, dur, type = 'lowpass') {
    const c = this.ctx, t = c.currentTime, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; s.playbackRate.value = rand(0.9, 1.1);
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random() * 0.5, dur + 0.05);
  },
  tone(vol, f0, f1, dur, type = 'sine', delay = 0) {
    const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  },
  shot() { if (!this.ctx) return; this.burst(0.9, 2600, 0.7, 0.16); this.burst(0.5, 600, 1, 0.3); this.tone(0.6, 140, 40, 0.14, 'triangle'); },
  enemyShot(dist) {
    if (!this.ctx) return; const v = clamp(1 - dist / 70, 0.08, 0.8);
    this.burst(v * 0.7, 2000 - Math.min(dist, 60) * 25, 0.7, 0.14); this.tone(v * 0.35, 120, 40, 0.12, 'triangle');
  },
  click() { if (!this.ctx) return; this.tone(0.25, 1800, 900, 0.03, 'square'); },
  reload(step) { if (!this.ctx) return; this.burst(0.35, step ? 3500 : 1500, 4, 0.06, 'bandpass'); this.tone(0.15, step ? 900 : 500, 300, 0.05, 'square'); },
  hit(kill) { if (!this.ctx) return; this.tone(0.25, kill ? 1500 : 2400, kill ? 700 : 1800, kill ? 0.12 : 0.05, 'square'); },
  hurt() { if (!this.ctx) return; this.burst(0.5, 400, 1, 0.18); this.tone(0.3, 90, 50, 0.2); },
  step() { if (!this.ctx) return; this.burst(0.08, 700, 1, 0.07); },
  whiz() { if (!this.ctx) return; this.burst(0.2, 4000, 6, 0.09, 'bandpass'); },
  pickup() { if (!this.ctx) return; this.tone(0.2, 600, 900, 0.08, 'square'); this.tone(0.2, 900, 1300, 0.1, 'square', 0.08); },
  win() { if (!this.ctx) return; [523, 659, 784, 1046].forEach((f, i) => this.tone(0.2, f, f, 0.25, 'triangle', i * 0.13)); },
  lose() { if (!this.ctx) return; [392, 330, 262].forEach((f, i) => this.tone(0.22, f, f * 0.98, 0.35, 'triangle', i * 0.2)); }
};

// =====================================================================
//  RENDERER / QUALITY
// =====================================================================
const canvas = $('cv');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.autoClear = false;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;          // the level is static: bake shadows once

const scene = new THREE.Scene();
const SKY = 0xb9c9cf;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 35, 130);
const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 260);
camera.rotation.order = 'YXZ';

// the gun is drawn in its own pass so it never pokes through walls
const gunScene = new THREE.Scene();
const gunCam = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
gunScene.add(new THREE.HemisphereLight(0xffffff, 0x554433, 2.2));
const gunSun = new THREE.DirectionalLight(0xffffff, 1.4); gunSun.position.set(1, 2, 1); gunScene.add(gunSun);

scene.add(new THREE.HemisphereLight(0xe8f2ff, 0x6b5a40, 1.5));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
sun.position.set(40, 70, 25);
sun.shadow.camera.left = -60; sun.shadow.camera.right = 60; sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
sun.shadow.camera.near = 10; sun.shadow.camera.far = 180; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0008;
scene.add(sun);

function qualityLevel() { return settings.quality === 'auto' ? (isTouch ? 'med' : 'high') : settings.quality; }
function applyQuality() {
  const q = qualityLevel(), dpr = window.devicePixelRatio || 1;
  renderer.setPixelRatio(q === 'low' ? Math.min(dpr, 1) * 0.7 : q === 'med' ? Math.min(dpr, 1.25) : Math.min(dpr, 1.75));
  const sh = q === 'high';
  if (renderer.shadowMap.enabled !== sh) {
    renderer.shadowMap.enabled = sh; sun.castShadow = sh;
    scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  }
  renderer.shadowMap.needsUpdate = true;
  scene.fog.far = q === 'low' ? 95 : 130;
  resize();
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = gunCam.aspect = w / h;
  camera.updateProjectionMatrix(); gunCam.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// =====================================================================
//  PROCEDURAL TEXTURES
// =====================================================================
function makeTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function speckle(g, s, base, n, spread) {
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  for (let i = 0; i < n; i++) {
    const l = rand(-spread, spread);
    g.fillStyle = l > 0 ? `rgba(255,255,255,${l})` : `rgba(0,0,0,${-l})`;
    g.fillRect(Math.random() * s, Math.random() * s, rand(1, 3), rand(1, 3));
  }
}
const TEX = {
  sand: makeTex(128, (g, s) => { speckle(g, s, '#c8ad7f', 2600, 0.12); }),
  plaster: makeTex(128, (g, s) => { speckle(g, s, '#d6c39b', 1800, 0.08); g.fillStyle = 'rgba(80,60,30,.15)'; g.fillRect(0, s - 10, s, 10); }),
  concrete: makeTex(128, (g, s) => {
    speckle(g, s, '#a9a49a', 2000, 0.1);
    g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 2;
    for (let y = 0; y <= s; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke(); }
    for (let x = 0; x <= s; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, s); g.stroke(); }
  }),
  crate: makeTex(64, (g, s) => {
    speckle(g, s, '#8a6a3e', 500, 0.1);
    g.strokeStyle = '#5a4122'; g.lineWidth = 5; g.strokeRect(3, 3, s - 6, s - 6);
    g.beginPath(); g.moveTo(4, 4); g.lineTo(s - 4, s - 4); g.stroke();
    g.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 16; y < s; y += 16) g.fillRect(0, y, s, 1);
  }),
  sandbag: makeTex(64, (g, s) => {
    speckle(g, s, '#a8956a', 600, 0.1);
    g.strokeStyle = 'rgba(50,40,20,.45)'; g.lineWidth = 2;
    for (let y = 0; y < s; y += 16) for (let x = (y / 16) % 2 ? -16 : 0; x < s; x += 32) { g.beginPath(); g.roundRect(x + 1, y + 1, 30, 14, 6); g.stroke(); }
  }),
  metal: makeTex(64, (g, s) => { speckle(g, s, '#56603f', 500, 0.08); g.fillStyle = 'rgba(0,0,0,.2)'; for (let x = 0; x < s; x += 8) g.fillRect(x, 0, 1, s); })
};
const MAT = {
  sand: new THREE.MeshLambertMaterial({ map: TEX.sand }),
  bld: new THREE.MeshLambertMaterial({ map: TEX.plaster }),
  wall: new THREE.MeshLambertMaterial({ map: TEX.concrete }),
  crate: new THREE.MeshLambertMaterial({ map: TEX.crate }),
  sandbag: new THREE.MeshLambertMaterial({ map: TEX.sandbag }),
  metal: new THREE.MeshLambertMaterial({ map: TEX.metal }),
  dark: new THREE.MeshLambertMaterial({ color: 0x2a2a28 }),
  roof: new THREE.MeshLambertMaterial({ color: 0x8c7a5c }),
  window: new THREE.MeshLambertMaterial({ color: 0x1d2226 }),
  barrel: new THREE.MeshLambertMaterial({ color: 0x3f5a6b })
};
const TEXSCALE = { bld: 4, wall: 4, crate: 1.3, sandbag: 2, metal: 2 };

// =====================================================================
//  LEVEL  (all collision is axis-aligned boxes; that keeps rays cheap)
// =====================================================================
const colliders = [];   // {mn:[x,y,z], mx:[x,y,z]}
const level = new THREE.Group(); scene.add(level);

function boxGeo(w, h, d, ts) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ts) {   // world-sized UVs so textures do not stretch
    const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
      const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / ts, uv.getY(k) * dims[f][1] / ts);
    }
  }
  return g;
}
function addBox(x, z, w, d, h, type, y0 = 0, solid = true) {
  const m = new THREE.Mesh(boxGeo(w, h, d, TEXSCALE[type]), MAT[type]);
  m.position.set(x, y0 + h / 2, z); m.castShadow = m.receiveShadow = true;
  level.add(m);
  if (solid) colliders.push({ mn: [x - w / 2, y0, z - d / 2], mx: [x + w / 2, y0 + h, z + d / 2] });
  return m;
}
function addBuilding(x, z, w, d, h) {
  addBox(x, z, w, d, h, 'bld');
  addBox(x, z, w + 0.4, d + 0.4, 0.35, 'bld', h, false);   // roof lip
  // dark windows on all sides (decoration only)
  const rows = Math.max(1, Math.floor(h / 3));
  for (let r = 0; r < rows; r++) {
    const y = 1.6 + r * 3;
    for (let i = 1; i < Math.floor(w / 3); i++) {
      const wx = x - w / 2 + i * 3;
      for (const s of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.2, 0.08), MAT.window); m.position.set(wx, y, z + s * (d / 2 + 0.02)); level.add(m); }
    }
    for (let i = 1; i < Math.floor(d / 3); i++) {
      const wz = z - d / 2 + i * 3;
      for (const s of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 1.1), MAT.window); m.position.set(x + s * (w / 2 + 0.02), y, wz); level.add(m); }
    }
  }
}
function addCrate(x, z, stack = 1, s = 1.3) {
  for (let i = 0; i < stack; i++) {
    const m = addBox(x, z, s, s, s, 'crate', i * s, false);
    m.rotation.y = i ? rand(-0.15, 0.15) : 0;
  }
  colliders.push({ mn: [x - s / 2, 0, z - s / 2], mx: [x + s / 2, s * stack, z + s / 2] });
}
function addTruck(x, z, alongX) {
  const L = 5.6, W = 2.3, w = alongX ? L : W, d = alongX ? W : L;
  const g = new THREE.Group(); g.position.set(x, 0, z); if (alongX) g.rotation.y = Math.PI / 2;
  const part = (px, py, pz, sx, sy, sz, mat) => { const m = new THREE.Mesh(boxGeo(sx, sy, sz, 2), mat); m.position.set(px, py, pz); m.castShadow = m.receiveShadow = true; g.add(m); };
  part(0, 1.0, 0.6, 2.2, 0.5, 4.2, MAT.metal);          // bed floor
  part(0, 1.75, 0.6, 2.2, 1.0, 4.2, MAT.metal);        // cargo box
  part(0, 1.55, -2.05, 2.1, 1.5, 1.4, MAT.metal);      // cab
  part(0, 1.9, -2.76, 1.9, 0.6, 0.05, MAT.window);
  for (const wz of [-1.9, 1.6]) for (const wx of [-1.05, 1.05]) {
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.35, 12), MAT.dark);
    wh.rotation.z = Math.PI / 2; wh.position.set(wx, 0.45, wz); g.add(wh);
  }
  level.add(g);
  colliders.push({ mn: [x - w / 2, 0, z - d / 2], mx: [x + w / 2, 2.3, z + d / 2] });
}
function addBarrels(x, z) {
  for (const [ox, oz] of [[0, 0], [0.75, 0.1], [0.35, 0.68]]) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 1.0, 12), MAT.barrel);
    m.position.set(x + ox, 0.5, z + oz); m.castShadow = m.receiveShadow = true; level.add(m);
  }
  colliders.push({ mn: [x - 0.35, 0, z - 0.35], mx: [x + 1.1, 1.0, z + 1.05] });
}

const MAP = 45;
function buildLevel() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), MAT.sand);
  TEX.sand.repeat.set(100, 100);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; level.add(ground);
  // distant dunes, purely visual
  const duneMat = new THREE.MeshLambertMaterial({ color: 0xc9ae80 });
  for (let i = 0; i < 26; i++) {
    const a = i / 26 * Math.PI * 2, r = rand(75, 110), s = rand(10, 22);
    const m = new THREE.Mesh(new THREE.SphereGeometry(s, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), duneMat);
    m.scale.y = rand(0.25, 0.45); m.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); level.add(m);
  }
  // perimeter wall
  const H = 3.4, T = 0.8;
  addBox(0, -MAP, MAP * 2 + T, T, H, 'wall'); addBox(0, MAP, MAP * 2 + T, T, H, 'wall');
  addBox(-MAP, 0, T, MAP * 2, H, 'wall'); addBox(MAP, 0, T, MAP * 2, H, 'wall');
  // buildings
  addBuilding(-28, -28, 14, 12, 7);
  addBuilding(26, -30, 12, 10, 6);
  addBuilding(-30, 10, 10, 14, 5);
  addBuilding(30, 8, 10, 12, 6);
  addBuilding(0, -38, 16, 8, 5);
  addBuilding(-8, 30, 8, 6, 4);
  // central courtyard (x -10..10, z -16..0) with gaps
  const cw = 2.6, ct = 0.6;
  addBox(-6, -16, 8, ct, cw, 'wall'); addBox(6, -16, 8, ct, cw, 'wall');
  addBox(-7, 0, 6, ct, cw, 'wall'); addBox(7, 0, 6, ct, cw, 'wall');
  addBox(-10, -11, ct, 10, cw, 'wall');
  addBox(10, -5, ct, 10, cw, 'wall');
  // crates
  addCrate(-6, -10, 2); addCrate(-4.6, -10); addCrate(5, -6); addCrate(6.3, -6, 2); addCrate(3, -13);
  addCrate(-17, 4); addCrate(-15.6, 4.2, 2); addCrate(18, -10, 2); addCrate(19.4, -10); addCrate(-20, -6);
  addCrate(14, 33); addCrate(15.4, 33, 2); addCrate(-24, 32); addCrate(36, -16, 2); addCrate(-37, -12);
  addCrate(22, -19); addCrate(-12, -25, 2); addCrate(10, -26); addCrate(38, 30); addCrate(-38, 30, 2);
  // sandbag walls (low cover - you can see and shoot over them)
  const bag = (x, z, w, d) => addBox(x, z, w, d, 1.05, 'sandbag');
  bag(-4, 34, 3.2, 0.8); bag(5, 32, 3.2, 0.8); bag(0, 20, 4, 0.8); bag(-14, 14, 0.8, 3.2); bag(14, 12, 0.8, 3.2);
  bag(-22, -4, 3.2, 0.8); bag(22, -2, 3.2, 0.8); bag(0, -24, 4, 0.8); bag(-30, -14, 3.2, 0.8); bag(32, -20, 3.2, 0.8);
  bag(-34, 24, 0.8, 3.2); bag(34, 22, 0.8, 3.2);
  addTruck(-16, 22, false); addTruck(17, 24, true); addTruck(-20, -40, true);
  addBarrels(8, 16); addBarrels(-36, 0); addBarrels(37, -2); addBarrels(-3, -30); addBarrels(24, 36);
}
buildLevel();

// =====================================================================
//  RAY CASTING / COLLISION
// =====================================================================
let nAxis = 0, nSign = 0;
function rayBox(o, d, mn, mx, maxT) {
  let t0 = 0, t1 = maxT, ax = -1, sg = 0;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) return Infinity; continue; }
    const inv = 1 / d[i]; let ta = (mn[i] - o[i]) * inv, tb = (mx[i] - o[i]) * inv, s = -1;
    if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; s = 1; }
    if (ta > t0) { t0 = ta; ax = i; sg = s; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return Infinity;
  }
  if (ax < 0) return Infinity;      // ray starts inside the box
  nAxis = ax; nSign = sg; return t0;
}
function raySphere(o, d, cx, cy, cz, r, maxT) {
  const ox = o[0] - cx, oy = o[1] - cy, oz = o[2] - cz;
  const b = ox * d[0] + oy * d[1] + oz * d[2], c = ox * ox + oy * oy + oz * oz - r * r, h = b * b - c;
  if (h < 0) return Infinity; const t = -b - Math.sqrt(h);
  return t > 0 && t < maxT ? t : Infinity;
}
const hitInfo = { t: 0, kind: '', enemy: null, head: false, n: [0, 1, 0] };
function castWorld(o, d, maxT) {
  let best = maxT, axis = 1, sign = 1, kind = '';
  if (d[1] < -1e-6) { const t = -o[1] / d[1]; if (t > 0 && t < best) { best = t; axis = 1; sign = 1; kind = 'ground'; } }
  for (const c of colliders) {
    const t = rayBox(o, d, c.mn, c.mx, best);
    if (t < best) { best = t; axis = nAxis; sign = nSign; kind = 'world'; }
  }
  hitInfo.t = best; hitInfo.kind = kind; hitInfo.enemy = null; hitInfo.head = false;
  hitInfo.n[0] = hitInfo.n[1] = hitInfo.n[2] = 0; hitInfo.n[axis] = sign;
  return hitInfo;
}
function castShot(o, d, maxT) {
  castWorld(o, d, maxT);
  for (const e of enemies) {
    if (e.dead) continue;
    const p = e.pos;
    let t = raySphere(o, d, p.x, 1.66, p.z, 0.2, hitInfo.t);
    if (t < hitInfo.t) { hitInfo.t = t; hitInfo.kind = 'enemy'; hitInfo.enemy = e; hitInfo.head = true; continue; }
    t = rayBox(o, d, [p.x - 0.3, 0, p.z - 0.3], [p.x + 0.3, 1.5, p.z + 0.3], hitInfo.t);
    if (t < hitInfo.t) { hitInfo.t = t; hitInfo.kind = 'enemy'; hitInfo.enemy = e; hitInfo.head = false; }
  }
  return hitInfo;
}
function lineOfSight(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
  const d = [dx / L, dy / L, dz / L];
  return castWorld([ax, ay, az], d, L).t >= L - 0.05;
}
// circle vs boxes on the ground plane; only boxes taller than knee height block
function collide(pos, r) {
  for (let pass = 0; pass < 2; pass++) for (const c of colliders) {
    if (c.mx[1] < 0.5) continue;
    const cx = clamp(pos.x, c.mn[0], c.mx[0]), cz = clamp(pos.z, c.mn[2], c.mx[2]);
    let dx = pos.x - cx, dz = pos.z - cz; const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (r - d) / d; pos.x += dx * k; pos.z += dz * k; }
    else {  // centre is inside the box: push out the shortest way
      const opts = [[c.mn[0] - r - pos.x, 0], [c.mx[0] + r - pos.x, 0], [0, c.mn[2] - r - pos.z], [0, c.mx[2] + r - pos.z]];
      opts.sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
      pos.x += opts[0][0]; pos.z += opts[0][1];
    }
  }
}
function insideAny(x, z, r) {
  for (const c of colliders) if (c.mx[1] >= 0.5 && x > c.mn[0] - r && x < c.mx[0] + r && z > c.mn[2] - r && z < c.mx[2] + r) return true;
  return Math.abs(x) > MAP - 1 || Math.abs(z) > MAP - 1;
}

// =====================================================================
//  EFFECTS: particles, bullet holes, tracers, muzzle flash
// =====================================================================
const FX = { parts: [], holes: [], tracers: [], hi: 0, ti: 0 };
{
  const pg = new THREE.BoxGeometry(0.07, 0.07, 0.07);
  for (let i = 0; i < 60; i++) {
    const m = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    m.visible = false; scene.add(m); FX.parts.push({ m, v: new THREE.Vector3(), life: 0 });
  }
  const hg = new THREE.PlaneGeometry(0.12, 0.12), hm = new THREE.MeshBasicMaterial({ color: 0x1a1612, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  for (let i = 0; i < 70; i++) { const m = new THREE.Mesh(hg, hm); m.visible = false; scene.add(m); FX.holes.push(m); }
  const tg = new THREE.BoxGeometry(0.025, 0.025, 1); tg.translate(0, 0, -0.5);
  for (let i = 0; i < 20; i++) {
    const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, depthWrite: false }));
    m.visible = false; scene.add(m); FX.tracers.push({ m, life: 0 });
  }
}
function spawnParts(x, y, z, n, color, speed, nx = 0, ny = 1, nz = 0) {
  for (let k = 0; k < n; k++) {
    const p = FX.parts.find(p => p.life <= 0); if (!p) return;
    p.m.position.set(x, y, z); p.m.material.color.setHex(color); p.m.visible = true; p.life = rand(0.25, 0.5);
    p.v.set(nx * speed + rand(-1, 1) * speed * 0.6, ny * speed + rand(0, 1) * speed * 0.6, nz * speed + rand(-1, 1) * speed * 0.6);
  }
}
const _n = new THREE.Vector3(), _q = new THREE.Vector3();
function addHole(x, y, z, n) {
  const m = FX.holes[FX.hi++ % FX.holes.length];
  _n.set(n[0], n[1], n[2]);
  m.position.set(x + n[0] * 0.01, y + n[1] * 0.01, z + n[2] * 0.01);
  _q.copy(m.position).add(_n); m.lookAt(_q); m.visible = true;
}
function addTracer(a, b) {
  const tr = FX.tracers[FX.ti++ % FX.tracers.length], L = a.distanceTo(b);
  if (L < 1) return;
  tr.m.position.copy(a); tr.m.lookAt(b); tr.m.scale.set(1, 1, Math.min(L, 6));
  tr.m.userData.dir = b.clone().sub(a).normalize(); tr.m.userData.left = L; tr.m.visible = true; tr.life = 0.2;
}
function updateFX(dt) {
  for (const p of FX.parts) if (p.life > 0) {
    p.life -= dt; p.v.y -= 12 * dt; p.m.position.addScaledVector(p.v, dt);
    if (p.life <= 0 || p.m.position.y < 0) { p.life = 0; p.m.visible = false; }
  }
  for (const t of FX.tracers) if (t.life > 0) {   // tracers fly fast along their path
    t.life -= dt; const step = 240 * dt; t.m.position.addScaledVector(t.m.userData.dir, step); t.m.userData.left -= step;
    if (t.life <= 0 || t.m.userData.left < 0) { t.life = 0; t.m.visible = false; }
  }
}
const flashLight = new THREE.PointLight(0xffc070, 0, 9, 2); scene.add(flashLight);

// =====================================================================
//  VIEW MODEL (first-person rifle)
// =====================================================================
const gun = new THREE.Group(); gunScene.add(gun);
const gunBody = new THREE.Group(); gun.add(gunBody);
{
  const blk = new THREE.MeshLambertMaterial({ color: 0x2b2d2a }), tan = new THREE.MeshLambertMaterial({ color: 0x8a7650 }),
    skin = new THREE.MeshLambertMaterial({ color: 0xb98a68 }), glove = new THREE.MeshLambertMaterial({ color: 0x3a3a30 });
  const part = (x, y, z, sx, sy, sz, m) => { const p = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); p.position.set(x, y, z); gunBody.add(p); return p; };
  part(0, 0, -0.05, 0.06, 0.08, 0.36, blk);          // receiver
  part(0, 0.005, -0.33, 0.055, 0.06, 0.24, tan);     // handguard
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 8), blk);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.012, -0.55); gunBody.add(barrel);
  part(0, -0.075, -0.1, 0.045, 0.1, 0.07, blk).rotation.x = 0.25;  // magazine
  part(0, -0.06, 0.06, 0.04, 0.08, 0.04, blk).rotation.x = -0.3;   // grip
  part(0, -0.005, 0.2, 0.05, 0.075, 0.18, tan);     // stock
  part(0, 0.055, -0.05, 0.03, 0.03, 0.1, blk);      // sight body
  part(0, 0.075, -0.02, 0.006, 0.02, 0.006, new THREE.MeshBasicMaterial({ color: 0xff4020 })); // red dot
  part(0.0, -0.055, -0.3, 0.07, 0.06, 0.12, glove);  // front hand
  part(0.04, -0.09, -0.26, 0.06, 0.06, 0.25, skin).rotation.y = -0.3;
  part(0.01, -0.07, 0.05, 0.07, 0.07, 0.09, glove);  // trigger hand
}
const muzzle = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), new THREE.MeshBasicMaterial({
  map: makeTex(64, (g, s) => { const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); gr.addColorStop(0, 'rgba(255,255,220,1)'); gr.addColorStop(0.3, 'rgba(255,190,80,.9)'); gr.addColorStop(1, 'rgba(255,120,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s); }),
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending
}));
muzzle.position.set(0, 0.012, -0.69); muzzle.visible = false; gunBody.add(muzzle);
const HIP = new THREE.Vector3(0.12, -0.13, -0.36), ADS = new THREE.Vector3(0, -0.068, -0.3);
gunBody.scale.setScalar(0.8);

// =====================================================================
//  ENEMIES
// =====================================================================
const SG = {
  leg: new THREE.BoxGeometry(0.2, 0.85, 0.22).translate(0, -0.425, 0),
  torso: new THREE.BoxGeometry(0.5, 0.62, 0.28), vest: new THREE.BoxGeometry(0.55, 0.42, 0.34),
  head: new THREE.BoxGeometry(0.25, 0.27, 0.25), helmet: new THREE.BoxGeometry(0.32, 0.13, 0.33),
  arm: new THREE.BoxGeometry(0.13, 0.13, 0.5), gun: new THREE.BoxGeometry(0.07, 0.1, 0.75)
};
const SM = { vest: new THREE.MeshLambertMaterial({ color: 0x2e3324 }), skin: new THREE.MeshLambertMaterial({ color: 0xb08460 }),
  helmet: new THREE.MeshLambertMaterial({ color: 0x3f4530 }), gun: new THREE.MeshLambertMaterial({ color: 0x1b1b1b }),
  scarf: new THREE.MeshLambertMaterial({ color: 0x7a2a22 }) };
const ammoBoxMat = new THREE.MeshLambertMaterial({ color: 0x4b5a2a, emissive: 0x222a10 });
const ammoStripe = new THREE.MeshBasicMaterial({ color: 0xffd35a });

const enemies = [], pickups = [];
class Enemy {
  constructor(x, z, yaw) {
    this.pos = new THREE.Vector3(x, 0, z); this.home = this.pos.clone(); this.yaw = yaw;
    this.hp = 100; this.dead = false; this.deadT = 0;
    this.state = 'patrol'; this.wp = null; this.waitT = rand(0.5, 3);
    this.thinkT = rand(0, 0.2); this.sees = false; this.lastKnown = new THREE.Vector3(); this.lostT = 0;
    this.reactT = 0; this.burst = 0; this.shotT = 0; this.pauseT = rand(0.3, 0.8);
    this.strafe = 0; this.strafeT = 0; this.walkPh = 0; this.flashT = 0; this.flinch = 0;
    this.stuckT = 0; this.sideT = 0; this.sideDir = 1;
    const g = this.g = new THREE.Group(); g.rotation.order = 'YXZ';
    this.uni = new THREE.MeshLambertMaterial({ color: 0x55593c });
    const add = (geo, mat, x, y, z, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
    this.legL = new THREE.Group(); this.legL.position.set(-0.13, 0.85, 0); g.add(this.legL); add(SG.leg, this.uni, 0, 0, 0, this.legL);
    this.legR = new THREE.Group(); this.legR.position.set(0.13, 0.85, 0); g.add(this.legR); add(SG.leg, this.uni, 0, 0, 0, this.legR);
    this.upper = new THREE.Group(); this.upper.position.y = 0.85; g.add(this.upper);
    add(SG.torso, this.uni, 0, 0.32, 0, this.upper); add(SG.vest, SM.vest, 0, 0.35, 0, this.upper);
    add(SG.head, SM.skin, 0, 0.8, 0, this.upper); add(SG.helmet, SM.helmet, 0, 0.93, 0.01, this.upper);
    add(new THREE.BoxGeometry(0.27, 0.1, 0.27), SM.scarf, 0, 0.7, 0, this.upper);
    const aL = add(SG.arm, this.uni, -0.2, 0.42, -0.2, this.upper); aL.rotation.y = 0.5;
    const aR = add(SG.arm, this.uni, 0.24, 0.4, -0.12, this.upper); aR.rotation.y = 0.15;
    add(SG.gun, SM.gun, 0.1, 0.45, -0.45, this.upper);
    this.flash = new THREE.Mesh(muzzle.geometry, muzzle.material); this.flash.scale.setScalar(2.4);
    this.flash.position.set(0.1, 0.47, -0.9); this.flash.visible = false; this.upper.add(this.flash);
    scene.add(g); this.sync();
  }
  sync() { this.g.position.copy(this.pos); this.g.rotation.y = this.yaw; }
  damage(dmg, head) {
    if (this.dead) return;
    this.hp -= dmg; this.flashT = 0.1; this.flinch = 1;
    if (this.hp <= 0) { this.die(); return; }
    this.lastKnown.copy(P.pos);
    if (this.state === 'patrol') { this.state = 'react'; this.reactT = rand(0.25, 0.45); }
    else if (this.state === 'react') this.reactT += 0.15;      // hits stagger them
    else { this.pauseT = Math.max(this.pauseT, 0.25); }
  }
  die() {
    this.dead = true; this.deadT = 0; this.flash.visible = false; game.kills++;
    spawnPickup(this.pos.x, this.pos.z);
    for (const o of enemies) if (!o.dead) { o.lastKnown.copy(P.pos); if (o.state === 'patrol' && o.pos.distanceTo(this.pos) < 22) { o.state = 'hunt'; } }
    updateEnemyCount();
  }
  canSee() {
    if (!P.alive) return false;
    const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d > 55) return false;
    if (this.state === 'patrol' && d > 5) {   // limited field of view while unaware
      const a = Math.abs(wrapAng(Math.atan2(-dx, -dz) - this.yaw));
      if (a > 1.2 || d > 40) return false;
    }
    return lineOfSight(this.pos.x, 1.62, this.pos.z, P.pos.x, P.eyeY - 0.1, P.pos.z);
  }
  turnTo(target, dt, speed) { this.yaw += clamp(wrapAng(target - this.yaw), -speed * dt, speed * dt); }
  moveDir(dx, dz, speed, dt) {
    const L = Math.hypot(dx, dz); if (L < 1e-4) return 0;
    let vx = dx / L, vz = dz / L;
    if (this.sideT > 0) { const tx = -vz * this.sideDir, tz = vx * this.sideDir; vx = vx * 0.3 + tx; vz = vz * 0.3 + tz; }
    const ox = this.pos.x, oz = this.pos.z;
    this.pos.x += vx * speed * dt; this.pos.z += vz * speed * dt;
    collide(this.pos, 0.38);
    const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
    if (moved < speed * dt * 0.3) { this.stuckT += dt; if (this.stuckT > 0.35) { this.sideT = rand(0.5, 1.1); this.sideDir = Math.random() < 0.5 ? -1 : 1; this.stuckT = 0; } }
    else this.stuckT = Math.max(0, this.stuckT - dt);
    return moved / dt;
  }
  pickWaypoint() {
    for (let i = 0; i < 8; i++) {
      const a = rand(0, Math.PI * 2), r = rand(3, 9), x = this.home.x + Math.cos(a) * r, z = this.home.z + Math.sin(a) * r;
      if (!insideAny(x, z, 0.7)) { this.wp = new THREE.Vector3(x, 0, z); return; }
    }
    this.wp = this.home.clone();
  }
  shoot(dist) {
    this.flash.visible = true; this.flash.rotation.z = Math.random() * 3; this.flashT2 = 0.05;
    AU.enemyShot(dist);
    const moving = P.speedNow > 1.5;
    let chance = clamp(0.7 - dist * 0.013, 0.12, 0.62) * (moving ? 0.65 : 1) * game.diff;
    if (P.ads > 0.5 && !moving) chance *= 1.1;
    const from = new THREE.Vector3(0.1, 0.47, -0.9).applyMatrix4(this.upper.matrixWorld);
    const to = new THREE.Vector3(P.pos.x, P.eyeY - 0.25, P.pos.z);
    if (Math.random() < chance) {
      hurtPlayer(rand(6, 9), this.pos);
    } else {
      to.x += rand(-1, 1) * 1.2; to.y += rand(-0.6, 0.9); to.z += rand(-1, 1) * 1.2;
      if (dist < 25 && Math.random() < 0.5) AU.whiz();
      const d = to.clone().sub(from).normalize(), h = castWorld([from.x, from.y, from.z], [d.x, d.y, d.z], 120);
      if (h.kind) { to.copy(from).addScaledVector(d, h.t); spawnParts(to.x, to.y, to.z, 3, 0xc8b48a, 2, h.n[0], h.n[1], h.n[2]); }
    }
    addTracer(from, to);
  }
  update(dt) {
    if (this.dead) {
      this.deadT += dt;
      const k = Math.min(1, this.deadT / 0.45); this.g.rotation.x = k * k * 1.52;
      this.upper.rotation.x = 0; this.legL.rotation.x = this.legR.rotation.x = 0;
      return;
    }
    if (this.flashT > 0) { this.flashT -= dt; this.uni.emissive.setHex(this.flashT > 0 ? 0x772211 : 0); }
    if (this.flashT2 > 0) { this.flashT2 -= dt; if (this.flashT2 <= 0) this.flash.visible = false; }
    this.flinch = Math.max(0, this.flinch - dt * 6);
    this.sideT -= dt;
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.18 + Math.random() * 0.06;
      this.sees = this.canSee();
      if (this.sees) { this.lastKnown.copy(P.pos); this.lostT = 0; }
    }
    const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, dist = Math.hypot(dx, dz), toP = Math.atan2(-dx, -dz);
    let speed = 0;
    switch (this.state) {
      case 'patrol':
        if (this.sees) {
          this.state = 'react'; this.reactT = rand(0.55, 0.95) / game.diff;
          for (const o of enemies) if (o !== this && !o.dead && o.state === 'patrol' && o.pos.distanceTo(this.pos) < 16) { o.state = 'hunt'; o.lastKnown.copy(P.pos); }
          break;
        }
        if (this.waitT > 0) { this.waitT -= dt; if (this.waitT <= 0) this.pickWaypoint(); break; }
        if (!this.wp) this.pickWaypoint();
        { const wx = this.wp.x - this.pos.x, wz = this.wp.z - this.pos.z;
          if (Math.hypot(wx, wz) < 0.6) { this.wp = null; this.waitT = rand(1.5, 4); break; }
          this.turnTo(Math.atan2(-wx, -wz), dt, 3); speed = this.moveDir(wx, wz, 1.5, dt); }
        break;
      case 'react':
        this.turnTo(toP, dt, 7);
        this.reactT -= dt;
        if (this.reactT <= 0) { this.state = 'engage'; this.burst = 0; this.pauseT = rand(0.05, 0.3); }
        break;
      case 'engage': {
        this.turnTo(toP, dt, 6);
        if (!this.sees) { this.lostT += dt; if (this.lostT > 1.3) { this.state = 'hunt'; break; } }
        // movement: keep a fighting distance and strafe now and then
        this.strafeT -= dt;
        if (this.strafeT <= 0) { this.strafeT = rand(0.8, 2.2); this.strafe = Math.random() < 0.45 ? 0 : (Math.random() < 0.5 ? -1 : 1); }
        let mx = 0, mz = 0;
        const fx = dx / (dist || 1), fz = dz / (dist || 1);
        if (dist > 26) { mx += fx; mz += fz; } else if (dist < 7) { mx -= fx; mz -= fz; }
        if (this.strafe) { mx += -fz * this.strafe; mz += fx * this.strafe; }
        if (mx || mz) speed = this.moveDir(mx, mz, 2.2, dt);
        // shooting in bursts
        const facing = Math.abs(wrapAng(toP - this.yaw)) < 0.25;
        if (this.sees && facing && P.alive) {
          if (this.burst > 0) { this.shotT -= dt; if (this.shotT <= 0) { this.shoot(dist); this.burst--; this.shotT = 0.12; } }
          else { this.pauseT -= dt; if (this.pauseT <= 0) { this.burst = 2 + Math.floor(Math.random() * 4); this.pauseT = rand(0.9, 1.7) / game.diff; this.shotT = 0; } }
        }
        break;
      }
      case 'hunt': {
        if (this.sees) { this.state = 'react'; this.reactT = rand(0.3, 0.55) / game.diff; break; }
        const hx = this.lastKnown.x - this.pos.x, hz = this.lastKnown.z - this.pos.z;
        if (Math.hypot(hx, hz) < 1.5) {
          this.home.copy(this.pos); this.state = 'patrol'; this.waitT = rand(1, 2.5); this.wp = null;
          if (game.left <= 2) this.lastKnown.copy(P.pos), this.state = 'hunt';   // the last ones keep searching
          break;
        }
        this.turnTo(Math.atan2(-hx, -hz), dt, 5); speed = this.moveDir(hx, hz, 3.3, dt);
        break;
      }
    }
    // keep enemies apart from each other and from the player
    for (const o of enemies) if (o !== this && !o.dead) {
      const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z, d = Math.hypot(ox, oz);
      if (d < 0.8 && d > 1e-4) { this.pos.x += ox / d * (0.8 - d) * 0.5; this.pos.z += oz / d * (0.8 - d) * 0.5; }
    }
    if (dist < 0.8 && dist > 1e-4) { this.pos.x -= dx / dist * (0.8 - dist); this.pos.z -= dz / dist * (0.8 - dist); }
    // animation
    if (speed > 0.2) this.walkPh += dt * speed * 3.2; else this.walkPh *= 0.9;
    const sw = Math.sin(this.walkPh) * Math.min(1, speed / 2) * 0.6;
    this.legL.rotation.x = sw; this.legR.rotation.x = -sw;
    this.upper.rotation.x = -this.flinch * 0.35;
    this.sync();
  }
}
function spawnPickup(x, z) {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.25, 0.3), ammoBoxMat); g.add(b);
  const s = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.05, 0.31), ammoStripe); g.add(s);
  g.position.set(x + rand(-0.4, 0.4), 0.3, z + rand(-0.4, 0.4)); scene.add(g);
  pickups.push({ g, t: Math.random() * 6 });
}

// =====================================================================
//  PLAYER & WEAPON
// =====================================================================
const P = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, hp: 100, alive: true, lastHit: -99, eyeY: 1.62, speedNow: 0,
  ads: 0, adsHeld: false, adsToggle: false, bob: 0, stepT: 0, recoil: 0, recoilYaw: 0, shake: 0, deadT: 0 };
const W = { mag: 30, size: 30, reserve: 120, maxRes: 210, cd: 0, rof: 0.1, reload: 0, reloadTime: 1.9, bloom: 0, kick: 0 };
const input = { mx: 0, mz: 0, fire: false, sprint: false, keys: {} };
const game = { state: 'menu', time: 0, kills: 0, shots: 0, hits: 0, heads: 0, left: 0, endT: 0, diff: 0.85, clock: 0 };

const SPAWNS = [[-18, 20, 0.5], [12, 16, -0.3], [-4, -8, 3], [5, -12, 2.5], [-22, -14, 1], [24, -16, -1.2], [0, -28, 3.1], [-36, -6, 1.6]];
function resetMission() {
  for (const e of enemies) scene.remove(e.g);
  enemies.length = 0;
  for (const p of pickups) scene.remove(p.g);
  pickups.length = 0;
  for (const [x, z, y] of SPAWNS) enemies.push(new Enemy(x, z, y));
  for (const h of FX.holes) h.visible = false;
  Object.assign(P, { yaw: 0, pitch: 0, hp: 100, alive: true, lastHit: -99, ads: 0, adsHeld: false, adsToggle: false, recoil: 0, recoilYaw: 0, shake: 0, deadT: 0 });
  P.pos.set(0, 0, 40);
  Object.assign(W, { mag: 30, reserve: 120, cd: 0, reload: 0, bloom: 0, kick: 0 });
  Object.assign(game, { time: 0, kills: 0, shots: 0, hits: 0, heads: 0, endT: 0 });
  input.fire = false;
  updateEnemyCount(); updateHUD(true);
}
function updateEnemyCount() {
  game.left = enemies.filter(e => !e.dead).length;
  $('topC').textContent = game.left ? 'HOSTILES ' + game.left : 'AREA CLEAR';
  if (game.left === 0 && game.state === 'play') game.endT = 1.6;
}

function aimDir(spread) {
  const yaw = P.yaw + P.recoilYaw, pitch = P.pitch + P.recoil;
  const cp = Math.cos(pitch);
  const d = new THREE.Vector3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
  const eye = new THREE.Vector3(P.pos.x, P.eyeY, P.pos.z);
  // touch aim assist: gentle bullet magnetism toward a visible enemy very close to the crosshair
  if (isTouch && settings.assist) {
    const lim = P.ads > 0.5 ? 0.035 : 0.055; let best = null, bestA = lim;
    for (const e of enemies) {
      if (e.dead) continue;
      const t = new THREE.Vector3(e.pos.x, 1.25, e.pos.z).sub(eye), L = t.length(); if (L > 50) continue;
      const a = d.angleTo(t); if (a < bestA && e.sees) { bestA = a; best = t.normalize(); }
    }
    if (best) d.lerp(best, 0.7).normalize();
  }
  if (spread > 0) {
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), up = new THREE.Vector3().crossVectors(right, d);
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
    d.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
  }
  return { eye, d };
}
function currentSpread() {
  const move = Math.min(1, P.speedNow / 5);
  return (P.ads > 0.5 ? 0.003 : 0.022) + move * (P.ads > 0.5 ? 0.008 : 0.03) + W.bloom;
}
function fire() {
  if (W.reload > 0 || W.cd > 0) return;
  if (W.mag <= 0) { W.cd = 0.25; AU.click(); if (W.reserve > 0) startReload(); return; }
  W.mag--; W.cd = W.rof; game.shots++;
  const { eye, d } = aimDir(currentSpread());
  W.bloom = Math.min(0.05, W.bloom + 0.007);
  P.recoil += (P.ads > 0.5 ? 0.009 : 0.014); P.recoilYaw += rand(-0.004, 0.004); W.kick = 1;
  AU.shot();
  muzzle.visible = true; muzzle.rotation.z = Math.random() * 3; muzzle.userData.t = 0.045;
  flashLight.position.set(eye.x + d.x, eye.y, eye.z + d.z); flashLight.intensity = 6;
  const h = castShot([eye.x, eye.y, eye.z], [d.x, d.y, d.z], 200);
  const end = eye.clone().addScaledVector(d, h.kind ? h.t : 200);
  // tracer starts at the gun barrel (roughly) so it reads like it comes from the rifle
  const start = eye.clone().addScaledVector(d, 1.0).add(new THREE.Vector3(Math.cos(P.yaw), 0, -Math.sin(P.yaw)).multiplyScalar(P.ads > 0.5 ? 0 : 0.12)); start.y -= 0.1;
  if (Math.random() < 0.5) addTracer(start, end);
  if (h.kind === 'enemy') {
    const e = h.enemy, dmg = h.head ? 100 : 34;
    game.hits++; if (h.head) game.heads++;
    e.damage(dmg, h.head);
    spawnParts(end.x, end.y, end.z, 6, 0x8a1a12, 2.2, -d.x, 0.3, -d.z);
    hitMarker(e.dead, h.head);
  } else if (h.kind) {
    addHole(end.x, end.y, end.z, h.n);
    spawnParts(end.x, end.y, end.z, 4, h.kind === 'ground' ? 0xc8ad7f : 0xbdb6a6, 2.5, h.n[0], h.n[1], h.n[2]);
  }
  // gunfire alerts nearby enemies
  for (const e of enemies) if (!e.dead && e.state === 'patrol' && e.pos.distanceTo(P.pos) < 32) { e.state = 'hunt'; e.lastKnown.copy(P.pos); }
}
function startReload() {
  if (W.reload > 0 || W.mag >= W.size || W.reserve <= 0 || !P.alive) return;
  W.reload = W.reloadTime; W.reloadStep = 0; AU.reload(0);
}
function hurtPlayer(dmg, from) {
  if (!P.alive || game.state !== 'play') return;
  P.hp -= dmg; P.lastHit = game.clock; P.shake = 0.25; AU.hurt();
  const ang = Math.atan2(-(from.x - P.pos.x), -(from.z - P.pos.z)) - P.yaw;
  dmgIndicator(ang);
  if (P.hp <= 0) { P.hp = 0; P.alive = false; P.deadT = 0; input.fire = false; }
}

// =====================================================================
//  HUD
// =====================================================================
const hud = { mag: -1, res: -1, hp: -1, hitT: 0, toastT: 0, cross: $('cross'), dmgEls: [] };
hud.cross.innerHTML = '<i class="h"></i><i class="h"></i><i class="v"></i><i class="v"></i><i class="dot"></i>';
const crossBars = hud.cross.querySelectorAll('i');
for (let i = 0; i < 4; i++) { const b = document.createElement('b'); $('dmgDir').appendChild(b); hud.dmgEls.push({ el: b, t: 0 }); }
function hitMarker(kill, head) {
  const h = $('hit'); h.style.color = kill ? '#ff4433' : '#fff'; h.style.opacity = 1; hud.hitT = kill ? 0.35 : 0.15;
  AU.hit(kill);
  if (kill) toast(head ? 'HEADSHOT' : 'HOSTILE DOWN');
}
function toast(t) { const el = $('toast'); el.textContent = t; el.style.opacity = 1; hud.toastT = 1.1; }
function dmgIndicator(ang) {
  const d = hud.dmgEls.find(x => x.t <= 0) || hud.dmgEls[0];
  d.t = 1; d.el.style.transform = `rotate(${-ang}rad)`; d.el.style.transformOrigin = '60px 130px'; d.el.style.opacity = 1;
}
function updateHUD(force) {
  if (force || hud.mag !== W.mag) { hud.mag = W.mag; $('mag').textContent = W.mag; $('ammo').classList.toggle('empty', W.mag === 0); }
  if (force || hud.res !== W.reserve) { hud.res = W.reserve; $('res').textContent = '/ ' + W.reserve; }
  const hp = Math.ceil(P.hp);
  if (force || hud.hp !== hp) { hud.hp = hp; $('hpFill').style.width = hp + '%'; $('hpFill').classList.toggle('low', hp < 35); }
}
function updateHUDFrame(dt) {
  updateHUD(false);
  const gap = 6 + currentSpread() * 420, show = P.ads < 0.5;
  const [l, r, u, d, dot] = crossBars;
  l.style.transform = `translate(${-gap - 9}px,0)`; r.style.transform = `translate(${gap}px,0)`;
  u.style.transform = `translate(0,${-gap - 9}px)`; d.style.transform = `translate(0,${gap}px)`;
  for (const b of [l, r, u, d]) b.style.opacity = show ? 1 : 0;
  dot.style.opacity = show ? 0.9 : 0;
  if (hud.hitT > 0) { hud.hitT -= dt; if (hud.hitT <= 0) $('hit').style.opacity = 0; }
  if (hud.toastT > 0) { hud.toastT -= dt; if (hud.toastT <= 0) $('toast').style.opacity = 0; }
  for (const x of hud.dmgEls) if (x.t > 0) { x.t -= dt * 0.8; x.el.style.opacity = Math.max(0, x.t); }
  const hurt = 1 - P.hp / 100, recent = Math.max(0, 1 - (game.clock - P.lastHit) * 2);
  $('vig').style.opacity = Math.min(1, hurt * 0.7 + recent * 0.4);
  $('reloadTip').style.opacity = (W.mag === 0 && W.reserve > 0 && W.reload <= 0) ? 1 : 0;
  $('reloadTip').textContent = W.reload > 0 ? 'Reloading…' : (isTouch ? 'Tap ↻ to reload' : 'Press R to reload');
  if (W.reload > 0) $('reloadTip').style.opacity = 1;
  if (W.mag === 0 && W.reserve === 0) { $('reloadTip').textContent = 'Out of ammo - grab ammo from fallen hostiles'; $('reloadTip').style.opacity = 1; }
}

// =====================================================================
//  INPUT: touch
// =====================================================================
const joy = { id: null, cx: 0, cy: 0 }, looks = new Map(), fires = new Set();
const joyBase = $('joyBase'), joyKnob = $('joyKnob'), JOY_R = 55;
const touchEl = $('touch');
function lookBy(dx, dy, scale) {
  const ads = P.ads > 0.5 ? 0.55 : 1;
  P.yaw -= dx * scale * settings.sens * ads;
  P.pitch = clamp(P.pitch - dy * scale * settings.sens * ads * (settings.invert ? -1 : 1), -1.45, 1.45);
}
touchEl.addEventListener('touchstart', e => {
  e.preventDefault(); AU.init();
  if (game.state !== 'play') return;
  for (const t of e.changedTouches) {
    const btn = t.target.closest && t.target.closest('[data-btn]'), b = btn && btn.dataset.btn;
    if (b === 'fire') { fires.add(t.identifier); looks.set(t.identifier, { x: t.clientX, y: t.clientY, btn }); btn.classList.add('on'); continue; }
    if (b === 'ads') { P.adsToggle = !P.adsToggle; btn.classList.toggle('on', P.adsToggle); continue; }
    if (b === 'reload') { startReload(); continue; }
    if (b === 'pause') { pauseGame(); continue; }
    if (t.clientX < window.innerWidth * 0.42 && joy.id === null) {
      joy.id = t.identifier; joy.cx = t.clientX; joy.cy = t.clientY;
      joyBase.style.display = 'block'; joyBase.style.left = joy.cx + 'px'; joyBase.style.top = joy.cy + 'px';
      joyKnob.style.transform = ''; $('joyHint').style.display = 'none';
    } else looks.set(t.identifier, { x: t.clientX, y: t.clientY });
  }
}, { passive: false });
touchEl.addEventListener('touchmove', e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) {
      let dx = t.clientX - joy.cx, dy = t.clientY - joy.cy; const L = Math.hypot(dx, dy);
      if (L > JOY_R) {   // drag the base along so the stick never "runs out"
        const k = (L - JOY_R) / L; joy.cx += dx * k; joy.cy += dy * k; dx = t.clientX - joy.cx; dy = t.clientY - joy.cy;
        joyBase.style.left = joy.cx + 'px'; joyBase.style.top = joy.cy + 'px';
      }
      joyKnob.style.transform = `translate(${dx}px,${dy}px)`;
      input.mx = dx / JOY_R; input.mz = dy / JOY_R;
      input.sprint = Math.hypot(dx, dy) > JOY_R * 0.95 && dy < -JOY_R * 0.7;
    } else if (looks.has(t.identifier)) {
      const l = looks.get(t.identifier);
      lookBy(t.clientX - l.x, t.clientY - l.y, 0.0052);
      l.x = t.clientX; l.y = t.clientY;
    }
  }
}, { passive: false });
function touchEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) { joy.id = null; input.mx = input.mz = 0; input.sprint = false; joyBase.style.display = 'none'; }
    const l = looks.get(t.identifier); if (l && l.btn) l.btn.classList.remove('on');
    looks.delete(t.identifier); fires.delete(t.identifier);
  }
}
touchEl.addEventListener('touchend', touchEnd); touchEl.addEventListener('touchcancel', touchEnd);
function releaseTouches() {
  joy.id = null; input.mx = input.mz = 0; input.sprint = false; joyBase.style.display = 'none';
  looks.clear(); fires.clear(); document.querySelectorAll('.btn.on').forEach(b => { if (b.id !== 'bAds') b.classList.remove('on'); });
}

// =====================================================================
//  INPUT: keyboard & mouse
// =====================================================================
let mouseFire = false;
window.addEventListener('keydown', e => {
  input.keys[e.code] = true;
  if (game.state === 'play') {
    if (e.code === 'KeyR') startReload();
    if (e.code === 'KeyP') pauseGame();
  }
});
window.addEventListener('keyup', e => { input.keys[e.code] = false; });
canvas.addEventListener('mousedown', e => {
  AU.init();
  if (game.state !== 'play' || isTouch) return;
  if (document.pointerLockElement !== canvas) { canvas.requestPointerLock && canvas.requestPointerLock(); return; }
  if (e.button === 0) mouseFire = true;
  if (e.button === 2) P.adsHeld = true;
});
window.addEventListener('mouseup', e => { if (e.button === 0) mouseFire = false; if (e.button === 2) P.adsHeld = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
let lockT = 0;   // browsers can report one huge jump right after locking the pointer
document.addEventListener('mousemove', e => {
  if (game.state !== 'play' || document.pointerLockElement !== canvas || performance.now() - lockT < 150) return;
  if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
  lookBy(e.movementX, e.movementY, 0.0022);
});
document.addEventListener('pointerlockchange', () => {
  lockT = performance.now();
  if (document.pointerLockElement !== canvas && game.state === 'play' && !isTouch) pauseGame();
});
document.addEventListener('visibilitychange', () => { if (document.hidden && game.state === 'play') pauseGame(); });

// =====================================================================
//  SCREENS
// =====================================================================
let settingsReturn = 'sMenu';
function showScreen(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('show', s.id === id)); }
function setPlaying(on) { document.body.classList.toggle('playing', on); }
function startGame() {
  AU.init(); resetMission(); game.state = 'play'; showScreen(null); setPlaying(true);
  $('bAds').classList.remove('on'); releaseTouches();
  if (isTouch) { $('joyHint').style.display = 'block'; try { document.documentElement.requestFullscreen && document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {}); } catch (e) {} }
  else canvas.requestPointerLock && canvas.requestPointerLock();
  toast('CLEAR THE COMPOUND');
}
function pauseGame() {
  if (game.state !== 'play') return;
  game.state = 'pause'; mouseFire = false; P.adsHeld = false; releaseTouches(); setPlaying(false); showScreen('sPause');
  if (document.pointerLockElement) document.exitPointerLock();
}
function resumeGame() {
  game.state = 'play'; showScreen(null); setPlaying(true);
  if (!isTouch && canvas.requestPointerLock) canvas.requestPointerLock();
}
function endMission(win) {
  game.state = 'end'; setPlaying(false); releaseTouches(); mouseFire = false;
  if (document.pointerLockElement) document.exitPointerLock();
  win ? AU.win() : AU.lose();
  const acc = game.shots ? Math.round(game.hits / game.shots * 100) : 0, t = game.time;
  const fmt = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  let best = store.get('best1', 0);
  if (win && (!best || t < best)) { best = t; store.set('best1', t); }
  $('endTitle').textContent = win ? 'MISSION COMPLETE' : 'MISSION FAILED';
  $('endTitle').style.color = win ? '#9be27a' : '#ff7b6b';
  $('endStats').innerHTML = `<span>Time</span><b>${fmt(t)}</b><span>Hostiles down</span><b>${game.kills} / ${enemies.length}</b>` +
    `<span>Accuracy</span><b>${acc}%</b><span>Headshots</span><b>${game.heads}</b>` + (best ? `<span>Best time</span><b>${fmt(best)}</b>` : '');
  $('endRetry').textContent = win ? 'PLAY AGAIN' : 'RETRY';
  Ads.interstitial(() => showScreen('sEnd'));
  updateBest();
}
function updateBest() { const b = store.get('best1', 0); $('best').textContent = b ? 'Best time: ' + Math.floor(b / 60) + ':' + String(Math.floor(b % 60)).padStart(2, '0') : ''; }
function openSettings() {
  settingsReturn = game.state === 'pause' ? 'sPause' : 'sMenu';
  $('setSens').value = settings.sens; $('setQ').value = settings.quality;
  for (const [id, k] of [['setSound', 'sound'], ['setAssist', 'assist'], ['setFire2', 'fire2'], ['setInvert', 'invert']]) $(id).classList.toggle('on', settings[k]);
  showScreen('sSettings');
}
for (const [id, k] of [['setSound', 'sound'], ['setAssist', 'assist'], ['setFire2', 'fire2'], ['setInvert', 'invert']]) {
  $(id).addEventListener('click', () => {
    settings[k] = !settings[k]; $(id).classList.toggle('on', settings[k]); saveSettings();
    if (k === 'sound') AU.setOn(settings.sound);
    if (k === 'fire2') document.body.classList.toggle('nofire2', !settings.fire2);
  });
}
$('setSens').addEventListener('input', e => { settings.sens = +e.target.value; saveSettings(); });
$('setQ').addEventListener('change', e => { settings.quality = e.target.value; saveSettings(); applyQuality(); });
document.addEventListener('click', e => {
  const a = e.target.closest('[data-act]'); if (!a) return;
  AU.init();
  const act = a.dataset.act;
  if (act === 'play' || act === 'restart') startGame();
  else if (act === 'resume') resumeGame();
  else if (act === 'pause') pauseGame();
  else if (act === 'settings') openSettings();
  else if (act === 'closeSettings') showScreen(settingsReturn);
  else if (act === 'menu') { game.state = 'menu'; setPlaying(false); showScreen('sMenu'); }
});
document.body.classList.toggle('nofire2', !settings.fire2);

// =====================================================================
//  MAIN LOOP
// =====================================================================
const tmpV = new THREE.Vector3();
function updatePlayer(dt) {
  if (!P.alive) {
    P.deadT += dt; P.eyeY = Math.max(0.35, 1.62 - P.deadT * 2.5);
    if (P.deadT > 1.6 && game.state === 'play') endMission(false);
    return;
  }
  // movement input
  let mx = input.mx, mz = input.mz;
  const k = input.keys;
  if (k.KeyW || k.ArrowUp) mz -= 1; if (k.KeyS || k.ArrowDown) mz += 1;
  if (k.KeyA || k.ArrowLeft) mx -= 1; if (k.KeyD || k.ArrowRight) mx += 1;
  let mag = Math.hypot(mx, mz); if (mag > 1) { mx /= mag; mz /= mag; mag = 1; }
  const firing = input.fire;
  const sprint = (input.sprint || k.ShiftLeft || k.ShiftRight) && mz < -0.5 && !firing && P.ads < 0.3 && W.reload <= 0;
  const speed = (sprint ? 7.2 : 4.6) * (P.ads > 0.5 ? 0.55 : 1);
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
  const ox = P.pos.x, oz = P.pos.z;
  P.pos.x += (rx * mx - fx * mz) * speed * dt;
  P.pos.z += (rz * mx - fz * mz) * speed * dt;
  collide(P.pos, 0.38);
  P.speedNow = Math.hypot(P.pos.x - ox, P.pos.z - oz) / dt;
  P.sprinting = sprint && P.speedNow > 5;
  // footsteps & bob
  if (P.speedNow > 0.5) {
    P.bob += dt * P.speedNow * 1.9; P.stepT -= dt * P.speedNow;
    if (P.stepT <= 0) { P.stepT = 2.2; AU.step(); }
  }
  // pickups
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    if (Math.hypot(p.g.position.x - P.pos.x, p.g.position.z - P.pos.z) < 1.3 && W.reserve < W.maxRes) {
      W.reserve = Math.min(W.maxRes, W.reserve + 30); scene.remove(p.g); pickups.splice(i, 1); AU.pickup(); toast('+30 AMMO');
    }
  }
  // health regenerates after 4 s without taking damage
  if (game.clock - P.lastHit > 4 && P.hp < 100) P.hp = Math.min(100, P.hp + 14 * dt);
}
function updateWeapon(dt) {
  W.cd -= dt;
  W.bloom = Math.max(0, W.bloom - dt * (input.fire ? 0.02 : 0.12));
  const wantAds = (P.adsHeld || P.adsToggle) && W.reload <= 0 && !P.sprinting;
  P.ads = clamp(P.ads + (wantAds ? dt : -dt) * 6, 0, 1);
  // recoil recovers most of the way back
  const rec = Math.min(1, dt * 7);
  const back = P.recoil * rec * 0.75; P.recoil -= back; P.pitch += back * 0.25;
  P.recoilYaw -= P.recoilYaw * rec;
  if (W.reload > 0) {
    W.reload -= dt;
    if (W.reloadStep === 0 && W.reload < W.reloadTime * 0.55) { W.reloadStep = 1; AU.reload(1); }
    if (W.reload <= 0) { const n = Math.min(W.size - W.mag, W.reserve); W.mag += n; W.reserve -= n; W.reload = 0; }
  }
  if (input.fire && P.alive && !P.sprinting) fire();
  if (W.mag === 0 && W.reserve > 0 && W.reload <= 0 && W.cd < -0.35 && !input.fire) startReload();   // auto reload when empty
  if (muzzle.visible) { muzzle.userData.t -= dt; if (muzzle.userData.t <= 0) muzzle.visible = false; }
  flashLight.intensity = Math.max(0, flashLight.intensity - dt * 120);
  W.kick = Math.max(0, W.kick - dt * 14);
}
function updateViewModel(dt) {
  const t = P.ads, bobAmt = Math.min(1, P.speedNow / 5) * (1 - t * 0.85);
  tmpV.copy(HIP).lerp(ADS, t);
  tmpV.x += Math.sin(P.bob) * 0.012 * bobAmt; tmpV.y += Math.abs(Math.cos(P.bob)) * 0.012 * bobAmt;
  tmpV.z += W.kick * 0.035;
  gun.position.copy(tmpV);
  let rx = W.kick * 0.06, rz = 0;
  if (W.reload > 0) { const p = 1 - W.reload / W.reloadTime, s = Math.sin(p * Math.PI); rx -= s * 0.7; rz = s * 0.4; gun.position.y -= s * 0.08; }
  if (P.sprinting) { rz += 0.35; rx -= 0.25; gun.position.x -= 0.03; }
  gun.rotation.set(rx, 0, rz);
  gunCam.fov = 60 - t * 12; gunCam.updateProjectionMatrix();
  gun.visible = P.alive;
}
function updateCamera(dt) {
  const shake = P.shake > 0 ? (P.shake -= dt, P.shake * 0.05) : 0;
  camera.position.set(P.pos.x, P.eyeY, P.pos.z);
  camera.rotation.set(P.pitch + P.recoil + rand(-1, 1) * shake, P.yaw + P.recoilYaw + rand(-1, 1) * shake, P.alive ? 0 : Math.min(0.6, P.deadT));
  const fov = 72 - P.ads * 24 - 0 + (P.sprinting ? 4 : 0);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 12); camera.updateProjectionMatrix(); }
}
let menuAng = 0;
function menuCamera(dt) {
  menuAng += dt * 0.06;
  camera.position.set(Math.sin(menuAng) * 34, 14, Math.cos(menuAng) * 34 - 6);
  camera.lookAt(0, 2, -8);
  if (camera.fov !== 60) { camera.fov = 60; camera.updateProjectionMatrix(); }
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.05) dt = 0.05; if (dt <= 0) return;
  game.clock += dt;
  if (game.state === 'play') {
    game.time += dt;
    input.fire = fires.size > 0 || mouseFire;
    updatePlayer(dt); updateWeapon(dt);
    for (const e of enemies) e.update(dt);
    for (const p of pickups) { p.t += dt; p.g.rotation.y = p.t * 1.5; p.g.position.y = 0.3 + Math.sin(p.t * 3) * 0.06; }
    updateFX(dt); updateViewModel(dt); updateCamera(dt); updateHUDFrame(dt);
    if (game.endT > 0) { game.endT -= dt; if (game.endT <= 0) endMission(true); }
  } else if (game.state === 'menu') {
    menuCamera(dt);
  }
  renderer.clear();
  renderer.render(scene, camera);
  if (game.state === 'play' || game.state === 'pause') { renderer.clearDepth(); renderer.render(gunScene, gunCam); }
}

// =====================================================================
//  BOOT
// =====================================================================
applyQuality();
resetMission();
updateBest();
$('loading').style.display = 'none';
requestAnimationFrame(frame);
window.__game = { game, P, W, enemies, settings };   // handy for testing in the console
