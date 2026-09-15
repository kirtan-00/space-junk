/* SPACE JUNK: the three production props for the "SOME OF IT NEEDED A LENS" ring.
   What he makes with a crew, built the way the L.I.S.A. figure in crt.js is built:
   brushed silver bevels, dark charcoal, thin white and accent emissive lines, canvas
   screens. Self-contained: only uses the THREE namespace passed in. No lights inside
   (the page scales group freely; emissives and additive sprites scale with it).

   makeProp(THREE, { kind, accent }) -> { group, update(dt, t), setDim, setHover, poke, dispose, kind, size }
     kind     "screen" (THE DVCs)  a 16:9 slab in a silver bezel with a clapper stick on top,
                                    the screen playing a procedural DVC: light leaks, letterbox,
                                    play triangle, running timecode.
              "phone"  (THE REELS) a 9:19.5 phone, silver frame, black glass, a vertical
                                    reel feed scrolling up, IG glyph, heart / comment / share.
              "truck"  (THE SHOOTS) a flatbed with a cab, six wheels, a camera on a tripod
                                    and two fresnels on stands with barn doors, lit.
     accent   hex string for the emissive edge, halo and indicator. Default '#3fe9ff'.

   Geometry: each prop is centred on its own origin and fits a 2.2 wide by 1.6 tall box
   (size holds the measured Box3 extents). Front faces +Z. The truck carries a baked
   35 degree yaw so bed, camera and lights silhouette from the front.

   group        yours to place, aim and scale; the module never writes to it. All motion
                (idle wobble, recoil, wheel spin) runs on an inner rig.
   update(dt,t) seconds. Call every frame. Canvas screens redraw at most every 100 ms.
   setDim(d)    0..1. 1 is the dead state: screens fall to 10 percent, emissives and
                glows to near nothing. Eased over 300 ms.
   setHover(b)  screens brighten a third, emissives half again, the fresnels flare.
   poke()       a small recoil away from the viewer with a spring back, a one-redraw white
                flash on the screens, the clapper claps, the fresnels burst.
   dispose()    frees geometries, materials and canvas textures.
*/

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;

function pickAccent(v) {
  return typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? v : '#3fe9ff';
}

function roundedRect(THREE, x, y, w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/* a rounded slab: extruded rounded rect with an optional hole, bevelled front and back */
function slab(THREE, w, h, depth, r, opts = {}) {
  const shape = roundedRect(THREE, -w / 2, -h / 2, w, h, r);
  if (opts.hole) {
    const [hw, hh, hr] = opts.hole;
    shape.holes.push(roundedRect(THREE, -hw / 2, -hh / 2, hw, hh, hr));
  }
  const bevel = opts.bevel == null ? 0.01 : opts.bevel;
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.9,
    bevelSegments: bevel > 0 ? 3 : 0, curveSegments: opts.curve || 8,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/* matrix helper: position, euler (radians), uniform or vector scale */
function mat4(THREE, p, e, s) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(e ? e[0] : 0, e ? e[1] : 0, e ? e[2] : 0));
  const sc = typeof s === 'number' ? new THREE.Vector3(s, s, s) : s ? new THREE.Vector3(s[0], s[1], s[2]) : new THREE.Vector3(1, 1, 1);
  m.compose(new THREE.Vector3(p[0], p[1], p[2]), q, sc);
  return m;
}

/* merge indexed geometries (Box, Cylinder, Torus, Plane, Circle) that share a material into one draw call */
function merge(THREE, parts) {
  const pos = [], nor = [], uv = [], idx = [];
  let off = 0;
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  for (const { geo, m } of parts) {
    const p = geo.attributes.position, n = geo.attributes.normal, u = geo.attributes.uv;
    if (m) nm.getNormalMatrix(m);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); if (m) v.applyMatrix4(m); pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i); if (m) v.applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z);
      uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
    }
    const ix = geo.index;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + off);
    off += p.count;
    geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

/* ---------- canvas textures ---------- */

/* soft radial glow, white on transparent, for sprites and the halo plane */
function glowTexture(THREE, N = 96) {
  const c = document.createElement('canvas');
  c.width = N; c.height = N;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  r.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, N, N);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* clapper stripes: black with white diagonals, tiled along x */
function stripeTexture(THREE) {
  const W = 256, H = 32;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#0d0d10';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#e8e6e0';
  const step = 64;
  for (let x = -H; x < W + H; x += step) {
    g.beginPath();
    g.moveTo(x, H); g.lineTo(x + H, 0); g.lineTo(x + H + step / 2, 0); g.lineTo(x + step / 2, H);
    g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  return t;
}

const MONO = "'Space Mono', 'SFMono-Regular', Menlo, monospace";

function hexToRgb(hex) {
  const c = hex.replace('#', '');
  const n = parseInt(c.length === 3 ? c.split('').map(ch => ch + ch).join('') : c.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* the DVC screen: 512 x 288 */
function drawDVC(g, W, H, t, accentRgb, flash) {
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#05060a';
  g.fillRect(0, 0, W, H);

  /* a dim set: a horizon gradient so the leaks have something to sit on */
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#0d1018');
  sky.addColorStop(0.55, '#141a24');
  sky.addColorStop(0.6, '#0a0c12');
  sky.addColorStop(1, '#07080c');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);

  /* light leaks: three slow blobs, warm, accent, magenta, additive */
  g.globalCompositeOperation = 'lighter';
  const leaks = [
    { c: [255, 150, 60], r: 220, x: 0.20 + 0.12 * Math.sin(t * 0.21), y: 0.35 + 0.10 * Math.cos(t * 0.17), a: 0.30 },
    { c: accentRgb, r: 260, x: 0.80 + 0.10 * Math.cos(t * 0.13 + 1), y: 0.60 + 0.12 * Math.sin(t * 0.19 + 2), a: 0.26 },
    { c: [255, 60, 120], r: 170, x: 0.55 + 0.20 * Math.sin(t * 0.09 + 4), y: 0.85 + 0.06 * Math.cos(t * 0.23), a: 0.18 },
  ];
  for (const L of leaks) {
    const cx = L.x * W, cy = L.y * H;
    const rg = g.createRadialGradient(cx, cy, 0, cx, cy, L.r);
    rg.addColorStop(0, `rgba(${L.c[0]},${L.c[1]},${L.c[2]},${L.a})`);
    rg.addColorStop(0.5, `rgba(${L.c[0]},${L.c[1]},${L.c[2]},${L.a * 0.35})`);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, W, H);
  }
  /* a streak of leak along one edge, the classic gate flare */
  const sx = ((t * 0.04) % 1.4) * W - 0.2 * W;
  const st = g.createLinearGradient(sx, 0, sx + 90, 0);
  st.addColorStop(0, 'rgba(255,120,40,0)');
  st.addColorStop(0.5, 'rgba(255,140,60,0.22)');
  st.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = st;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';

  /* letterbox */
  const BAR = 34;
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, BAR);
  g.fillRect(0, H - BAR, W, BAR);

  /* play triangle in a thin ring */
  const cx = W / 2, cy = H / 2;
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 3;
  g.beginPath(); g.arc(cx, cy, 44, 0, TAU); g.stroke();
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(cx - 14, cy - 22); g.lineTo(cx + 24, cy); g.lineTo(cx - 14, cy + 22);
  g.closePath(); g.fill();

  /* timecode, bottom right, ticking at 24 fps; clip name bottom left */
  const fr = 23 * 24 + 14 + Math.floor(t * 24);
  const ff = fr % 24, ss = Math.floor(fr / 24) % 60, mm = Math.floor(fr / 1440) % 60, hh = Math.floor(fr / 86400) % 24;
  const p2 = n => (n < 10 ? '0' : '') + n;
  const tc = `${p2(hh)}:${p2(mm)}:${p2(ss)}:${p2(ff)}`;
  g.font = `700 19px ${MONO}`;
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.textAlign = 'right';
  g.fillText(tc, W - 18, H - BAR / 2 + 1);
  g.textAlign = 'left';
  g.font = `400 13px ${MONO}`;
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.fillText('A001_C014  DVC', 18, H - BAR / 2 + 1);
  /* top bar: a thin progress line with a bright head */
  const prog = (t * 0.03) % 1;
  g.fillStyle = 'rgba(255,255,255,0.22)';
  g.fillRect(18, BAR - 8, W - 36, 2);
  g.fillStyle = '#fff';
  g.fillRect(18, BAR - 8, (W - 36) * prog, 2);
  g.fillText('24 FPS', 18, BAR / 2 + 1);
  g.textAlign = 'right';
  g.fillText('2.39 : 1', W - 18, BAR / 2 + 1);

  if (flash > 0) {
    g.fillStyle = `rgba(255,255,255,${Math.min(1, flash)})`;
    g.fillRect(0, 0, W, H);
  }
}

/* the reel screen: 236 x 512, rounded, transparent corners */
function drawReel(g, W, H, t, accentRgb, flash) {
  g.clearRect(0, 0, W, H);
  g.save();
  const R = 30;
  g.beginPath();
  g.moveTo(R, 0); g.lineTo(W - R, 0); g.quadraticCurveTo(W, 0, W, R);
  g.lineTo(W, H - R); g.quadraticCurveTo(W, H, W - R, H);
  g.lineTo(R, H); g.quadraticCurveTo(0, H, 0, H - R);
  g.lineTo(0, R); g.quadraticCurveTo(0, 0, R, 0);
  g.closePath();
  g.clip();

  g.fillStyle = '#07070b';
  g.fillRect(0, 0, W, H);

  /* the feed: colour cards scrolling up, each a soft two-stop gradient with a caption block */
  const cards = [
    [[accentRgb[0], accentRgb[1], accentRgb[2]], [40, 10, 60]],
    [[63, 233, 255], [10, 30, 70]],
    [[255, 150, 60], [90, 20, 30]],
    [[150, 90, 255], [20, 10, 50]],
    [[80, 240, 170], [10, 50, 50]],
  ];
  const CH = 300, GAP = 14, PITCH = CH + GAP, N = cards.length;
  const scroll = t * 42;
  for (let i = 0; i < N + 2; i++) {
    const k = i % N;
    let y = i * PITCH - (scroll % (N * PITCH)) - PITCH + 60;
    if (y > H || y + CH < -10) continue;
    const [a, b] = cards[k];
    const lg = g.createLinearGradient(0, y, W, y + CH);
    lg.addColorStop(0, `rgba(${a[0]},${a[1]},${a[2]},0.85)`);
    lg.addColorStop(1, `rgba(${b[0]},${b[1]},${b[2]},0.95)`);
    g.fillStyle = lg;
    g.fillRect(10, y, W - 20, CH);
    /* a soft highlight blob drifting inside the card */
    const bx = W * (0.35 + 0.25 * Math.sin(t * 0.5 + k)), by = y + CH * (0.4 + 0.2 * Math.cos(t * 0.4 + k));
    const rg = g.createRadialGradient(bx, by, 0, bx, by, 110);
    rg.addColorStop(0, 'rgba(255,255,255,0.35)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.fillRect(10, y, W - 20, CH);
    /* caption bars */
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.fillRect(24, y + CH - 44, 110, 5);
    g.fillRect(24, y + CH - 30, 70, 5);
  }

  /* dark gradient at the top and bottom so the chrome reads */
  const top = g.createLinearGradient(0, 0, 0, 90);
  top.addColorStop(0, 'rgba(0,0,0,0.75)'); top.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = top; g.fillRect(0, 0, W, 90);
  const bot = g.createLinearGradient(0, H - 120, 0, H);
  bot.addColorStop(0, 'rgba(0,0,0,0)'); bot.addColorStop(1, 'rgba(0,0,0,0.8)');
  g.fillStyle = bot; g.fillRect(0, H - 120, W, 120);

  /* progress bar at the top */
  const prog = (t * 0.07) % 1;
  g.fillStyle = 'rgba(255,255,255,0.28)';
  g.fillRect(14, 12, W - 28, 3);
  g.fillStyle = '#fff';
  g.fillRect(14, 12, (W - 28) * prog, 3);

  /* the Instagram glyph, line geometry, top left */
  g.strokeStyle = '#fff';
  g.lineWidth = 2.6;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const gx = 18, gy = 30, gs = 30, gr = 9;
  g.beginPath();
  g.moveTo(gx + gr, gy); g.lineTo(gx + gs - gr, gy); g.quadraticCurveTo(gx + gs, gy, gx + gs, gy + gr);
  g.lineTo(gx + gs, gy + gs - gr); g.quadraticCurveTo(gx + gs, gy + gs, gx + gs - gr, gy + gs);
  g.lineTo(gx + gr, gy + gs); g.quadraticCurveTo(gx, gy + gs, gx, gy + gs - gr);
  g.lineTo(gx, gy + gr); g.quadraticCurveTo(gx, gy, gx + gr, gy);
  g.closePath(); g.stroke();
  g.beginPath(); g.arc(gx + gs / 2, gy + gs / 2, 7.2, 0, TAU); g.stroke();
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(gx + gs - 7.5, gy + 7.5, 2, 0, TAU); g.fill();
  g.font = `700 13px ${MONO}`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillText('REELS', gx + gs + 12, gy + gs / 2 + 1);

  /* right rail: heart, comment, share, as thin white lines */
  const rx = W - 28;
  g.lineWidth = 2.4;
  /* heart */
  let hy = H - 214;
  g.beginPath();
  g.moveTo(rx, hy + 12);
  g.bezierCurveTo(rx - 16, hy, rx - 12, hy - 14, rx - 1, hy - 5);
  g.bezierCurveTo(rx + 12, hy - 14, rx + 16, hy, rx, hy + 12);
  g.closePath(); g.stroke();
  /* comment bubble */
  hy = H - 158;
  g.beginPath();
  g.arc(rx, hy, 12, Math.PI * 0.62, Math.PI * 2.32);
  g.lineTo(rx - 10, hy + 14);
  g.closePath(); g.stroke();
  /* share, the paper plane */
  hy = H - 104;
  g.beginPath();
  g.moveTo(rx - 13, hy - 2); g.lineTo(rx + 14, hy - 11); g.lineTo(rx + 2, hy + 14); g.lineTo(rx - 2, hy + 3); g.closePath(); g.stroke();
  g.beginPath(); g.moveTo(rx - 2, hy + 3); g.lineTo(rx + 14, hy - 11); g.stroke();
  /* counts under each, tiny bars */
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.fillRect(rx - 8, H - 190, 16, 3);
  g.fillRect(rx - 6, H - 134, 12, 3);
  g.fillRect(rx - 8, H - 80, 16, 3);

  /* bottom: avatar ring and a caption */
  g.strokeStyle = '#fff';
  g.lineWidth = 2;
  g.beginPath(); g.arc(30, H - 56, 11, 0, TAU); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fillRect(50, H - 60, 84, 5);
  g.fillStyle = 'rgba(255,255,255,0.6)';
  g.fillRect(20, H - 34, 120, 4);
  g.fillRect(20, H - 24, 80, 4);

  if (flash > 0) {
    g.fillStyle = `rgba(255,255,255,${Math.min(1, flash)})`;
    g.fillRect(0, 0, W, H);
  }
  g.restore();
}

/* ---------- the factory ---------- */

export function makeProp(THREE, opts = {}) {
  const kind = opts.kind === 'phone' || opts.kind === 'truck' ? opts.kind : 'screen';
  const accentHex = pickAccent(opts.accent);
  const accent = new THREE.Color(accentHex);
  const accentRgb = hexToRgb(accentHex);

  const group = new THREE.Group();
  group.name = 'prop-' + kind;
  const rig = new THREE.Group();
  rig.name = 'prop-rig';
  group.add(rig);

  const M = {
    silver: new THREE.MeshStandardMaterial({ color: 0xcfcfca, roughness: 0.55, metalness: 0.1 }),
    silverUnder: new THREE.MeshStandardMaterial({ color: 0x9a948c, roughness: 0.5, metalness: 0.1 }),
    charcoal: new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.6, metalness: 0.05 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.5, metalness: 0.1 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.55, metalness: 0.0 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0b1420, roughness: 0.15, metalness: 0.7, emissive: 0x16324a, emissiveIntensity: 0.7 }),
    accentEm: new THREE.MeshStandardMaterial({ color: 0x101010, emissive: accent.clone(), emissiveIntensity: 1.6 }),
    whiteEm: new THREE.MeshStandardMaterial({ color: 0x101010, emissive: 0xffffff, emissiveIntensity: 1.3 }),
    warmEm: new THREE.MeshStandardMaterial({ color: 0x101010, emissive: 0xffd9a0, emissiveIntensity: 2.2 }),
    redEm: new THREE.MeshStandardMaterial({ color: 0x101010, emissive: 0xff2a2a, emissiveIntensity: 1.2 }),
  };
  const ems = [M.accentEm, M.whiteEm, M.warmEm, M.redEm, M.glass].map(m => ({ m, base: m.emissiveIntensity }));
  const textures = [];
  const screens = [];   /* { mat, canvas, ctx, draw, W, H } */
  const sprites = [];   /* { s, base, op } */
  const geos = [];
  const extraMats = [];

  const mesh = (geo, mat, p, e) => {
    geos.push(geo);
    const m = new THREE.Mesh(geo, mat);
    if (p) m.position.set(p[0], p[1], p[2]);
    if (e) m.rotation.set(e[0], e[1], e[2]);
    return m;
  };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (r1, r2, h, n = 20) => new THREE.CylinderGeometry(r1, r2, h, n);

  /* the accent halo behind every prop: an additive soft ellipse, the pickup's aura */
  const glowTex = glowTexture(THREE);
  textures.push(glowTex);
  const haloMat = new THREE.MeshBasicMaterial({
    map: glowTex, color: accent.clone(), transparent: true, opacity: 0.22,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const halo = mesh(new THREE.PlaneGeometry(1, 1), haloMat);
  halo.userData.noBox = true;
  halo.renderOrder = -1;
  rig.add(halo);
  const HALO_OP = 0.22;

  const makeScreen = (W, H, draw) => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    textures.push(tex);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
    screens.push({ mat, tex, ctx: c.getContext('2d'), draw, W, H });
    return mat;
  };

  const makeGlow = (color, scale, opacity) => {
    const sm = new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const s = new THREE.Sprite(sm);
    s.scale.set(scale, scale, 1);
    s.userData.noBox = true;
    sprites.push({ s, base: scale, op: opacity });
    return s;
  };

  /* per-kind state the update loop reads */
  let clapper = null;      /* pivot group for the clapper stick */
  let wheels = null;       /* { torus, hub, mats: Matrix4[] } */
  let lamps = [];          /* fresnel heads for the flicker */

  /* ================= SCREEN ================= */
  if (kind === 'screen') {
    const W = 2.0, H = 1.125, RIM = 0.038, DEPTH = 0.04;
    const rimGeo = slab(THREE, W, H, DEPTH, 0.045, { hole: [W - 2 * RIM, H - 2 * RIM, 0.02], bevel: 0.01, curve: 10 });
    const rim = mesh(rimGeo, [M.silver, M.silverUnder], [0, 0, 0.02]);
    rig.add(rim);
    const cabinet = mesh(box(W - 0.02, H - 0.02, 0.10), M.charcoal, [0, 0, -0.06]);
    rig.add(cabinet);
    /* accent lip proud of the cabinet at the back, the lit edge */
    const lipGeo = slab(THREE, W + 0.05, H + 0.05, 0.014, 0.07, { hole: [W - 0.01, H - 0.01, 0.06], bevel: 0 });
    const lip = mesh(lipGeo, M.accentEm, [0, 0, -0.115]);
    rig.add(lip);

    const scrMat = makeScreen(512, 288, drawDVC);
    const scr = mesh(new THREE.PlaneGeometry(W - 2 * RIM + 0.012, H - 2 * RIM + 0.012), scrMat, [0, 0, 0.012]);
    rig.add(scr);

    /* indicator dot, bottom right of the bezel */
    const dot = mesh(cyl(0.011, 0.011, 0.006, 12), M.accentEm, [W / 2 - RIM / 2, -H / 2 + RIM / 2, 0.052], [Math.PI / 2, 0, 0]);
    rig.add(dot);

    /* the clapper: a striped bar fixed along the top edge, a striped stick hinged at the left corner */
    const stripes = stripeTexture(THREE);
    textures.push(stripes);
    const stripeMat = new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.6, metalness: 0.05 });
    extraMats.push(stripeMat);
    stripes.repeat.set(9, 1);
    const barH = 0.075, stickH = 0.07, D = 0.10;
    const sixMats = [M.dark, M.dark, stripeMat, M.dark, stripeMat, stripeMat];
    const bar = mesh(box(W, barH, D), sixMats, [0, H / 2 + barH / 2, -0.055]);
    rig.add(bar);
    clapper = new THREE.Group();
    clapper.position.set(-W / 2 + 0.05, H / 2 + barH, -0.055);
    const stick = mesh(box(W, stickH, D * 0.95), sixMats, [W / 2 - 0.05, stickH / 2 + 0.004, 0]);
    clapper.add(stick);
    const hinge = mesh(cyl(0.05, 0.05, D + 0.03, 18), M.silver, [0, 0, 0], [Math.PI / 2, 0, 0]);
    clapper.add(hinge);
    const hingeCap = mesh(cyl(0.02, 0.02, D + 0.05, 12), M.accentEm, [0, 0, 0], [Math.PI / 2, 0, 0]);
    clapper.add(hingeCap);
    clapper.rotation.z = 8 * D2R;
    rig.add(clapper);

    halo.scale.set(2.8, 2.0, 1);
    halo.position.set(0, 0.1, -0.2);
  }

  /* ================= PHONE ================= */
  if (kind === 'phone') {
    const SW = 236, SH = 512;
    const PW = 0.70, FR = 0.022;
    const GW = PW - 2 * FR, GH = GW * SH / SW;
    const PH = GH + 2 * FR;
    const frameGeo = slab(THREE, PW, PH, 0.07, 0.11, { hole: [GW, GH, 0.09], bevel: 0.005, curve: 10 });
    const frame = mesh(frameGeo, [M.silver, M.silverUnder]);
    rig.add(frame);
    const backGeo = slab(THREE, PW - 0.03, PH - 0.03, 0.06, 0.105, { bevel: 0 });
    const back = mesh(backGeo, M.dark, [0, 0, -0.008]);
    rig.add(back);
    const scrMat = makeScreen(SW, SH, drawReel);
    const scr = mesh(new THREE.PlaneGeometry(GW, GH), scrMat, [0, 0, 0.025]);
    rig.add(scr);
    /* side buttons and the camera island on the back, for the wobble */
    const buttons = merge(THREE, [
      { geo: box(0.012, 0.13, 0.03), m: mat4(THREE, [PW / 2 + 0.004, 0.30, 0]) },
      { geo: box(0.012, 0.08, 0.03), m: mat4(THREE, [-PW / 2 - 0.004, 0.36, 0]) },
      { geo: box(0.012, 0.08, 0.03), m: mat4(THREE, [-PW / 2 - 0.004, 0.24, 0]) },
    ]);
    rig.add(mesh(buttons, M.silver));
    const island = mesh(slab(THREE, 0.22, 0.22, 0.02, 0.06, { bevel: 0.004 }), M.charcoal, [-PW / 2 + 0.16, PH / 2 - 0.16, -0.045]);
    rig.add(island);
    const lenses = merge(THREE, [
      { geo: cyl(0.045, 0.045, 0.016, 18), m: mat4(THREE, [-PW / 2 + 0.115, PH / 2 - 0.115, -0.062], [Math.PI / 2, 0, 0]) },
      { geo: cyl(0.045, 0.045, 0.016, 18), m: mat4(THREE, [-PW / 2 + 0.205, PH / 2 - 0.205, -0.062], [Math.PI / 2, 0, 0]) },
    ]);
    rig.add(mesh(lenses, M.glass));
    halo.scale.set(1.7, 2.3, 1);
    halo.position.set(0, 0, -0.2);
  }

  /* ================= TRUCK ================= */
  if (kind === 'truck') {
    const T = new THREE.Group();
    T.name = 'truck-yaw';
    T.rotation.y = -35 * D2R;
    rig.add(T);
    const R = 0.17;
    /* chassis, deck and rails */
    T.add(mesh(box(2.02, 0.10, 0.60), M.dark, [0, 0.27, 0]));
    T.add(mesh(box(1.42, 0.05, 0.78), M.charcoal, [-0.33, 0.345, 0]));
    const rails = merge(THREE, [
      { geo: box(0.02, 0.10, 0.78), m: mat4(THREE, [-1.03, 0.42, 0]) },
      { geo: box(1.42, 0.10, 0.02), m: mat4(THREE, [-0.33, 0.42, 0.38]) },
      { geo: box(1.42, 0.10, 0.02), m: mat4(THREE, [-0.33, 0.42, -0.38]) },
      { geo: box(0.02, 0.36, 0.78), m: mat4(THREE, [0.37, 0.55, 0]) },       /* headboard */
      { geo: box(0.05, 0.08, 0.76), m: mat4(THREE, [1.055, 0.30, 0]) },      /* bumper */
      { geo: box(0.64, 0.02, 0.76), m: mat4(THREE, [0.72, 0.905, 0]) },      /* roof strip */
      { geo: box(0.02, 0.02, 0.76), m: mat4(THREE, [1.04, 0.62, 0]) },       /* bonnet line */
    ]);
    T.add(mesh(rails, M.silver));
    /* cab */
    T.add(mesh(box(0.64, 0.54, 0.74), M.charcoal, [0.72, 0.63, 0]));
    const windows = merge(THREE, [
      { geo: new THREE.PlaneGeometry(0.66, 0.26), m: mat4(THREE, [1.043, 0.76, 0], [0, Math.PI / 2, 0]) },
      { geo: new THREE.PlaneGeometry(0.30, 0.24), m: mat4(THREE, [0.80, 0.75, 0.373], [0, 0, 0]) },
      { geo: new THREE.PlaneGeometry(0.30, 0.24), m: mat4(THREE, [0.80, 0.75, -0.373], [0, Math.PI, 0]) },
    ]);
    T.add(mesh(windows, M.glass));
    const heads = merge(THREE, [
      { geo: box(0.02, 0.06, 0.16), m: mat4(THREE, [1.05, 0.46, 0.26]) },
      { geo: box(0.02, 0.06, 0.16), m: mat4(THREE, [1.05, 0.46, -0.26]) },
    ]);
    T.add(mesh(heads, M.whiteEm));
    const tails = merge(THREE, [
      { geo: box(0.02, 0.05, 0.10), m: mat4(THREE, [-1.045, 0.30, 0.25]) },
      { geo: box(0.02, 0.05, 0.10), m: mat4(THREE, [-1.045, 0.30, -0.25]) },
    ]);
    T.add(mesh(tails, M.redEm));

    /* six wheels: instanced torus tyres and hubs */
    const tyreGeo = new THREE.TorusGeometry(R - 0.055, 0.055, 10, 22);
    const hubGeo = new THREE.CylinderGeometry(0.095, 0.095, 0.14, 18);
    hubGeo.rotateX(Math.PI / 2);
    geos.push(tyreGeo, hubGeo);
    const tyres = new THREE.InstancedMesh(tyreGeo, M.rubber, 6);
    const hubs = new THREE.InstancedMesh(hubGeo, M.silver, 6);
    const capGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.15, 12);
    capGeo.rotateX(Math.PI / 2);
    geos.push(capGeo);
    const caps = new THREE.InstancedMesh(capGeo, M.dark, 6);
    const wpos = [];
    for (const x of [0.72, -0.34, -0.76]) for (const z of [0.34, -0.34]) wpos.push([x, R, z]);
    wheels = { tyres, hubs, caps, wpos, spin: 0 };
    T.add(tyres, hubs, caps);

    /* camera on a tripod, looking a little off the viewer's line */
    const legs = merge(THREE, [
      { geo: cyl(0.022, 0.022, 0.30, 10), m: mat4(THREE, [-0.05, 0.52, 0.04]) },
      ...[0, 1, 2].map(i => {
        const a = i * TAU / 3 + 0.4;
        const sx = Math.cos(a) * 0.16, sz = Math.sin(a) * 0.16;
        const p = [-0.05 + sx / 2, 0.52, 0.04 + sz / 2];
        const len = Math.hypot(0.30, 0.16);
        const tilt = Math.atan2(0.16, 0.30);
        return { geo: cyl(0.011, 0.011, len, 8), m: mat4(THREE, p, [0, -a, 0]).multiply(mat4(THREE, [0, 0, 0], [0, 0, -tilt])) };
      }),
    ]);
    T.add(mesh(legs, M.silver));
    T.add(mesh(box(0.14, 0.07, 0.12), M.charcoal, [-0.05, 0.705, 0.04]));
    const camG = new THREE.Group();
    camG.position.set(-0.05, 0.845, 0.04);
    camG.rotation.y = 18 * D2R;
    T.add(camG);
    camG.add(mesh(box(0.20, 0.21, 0.30), M.charcoal, [0, 0, 0]));
    camG.add(mesh(cyl(0.08, 0.08, 0.22, 20), M.dark, [0, 0.0, 0.26], [Math.PI / 2, 0, 0]));
    camG.add(mesh(new THREE.TorusGeometry(0.085, 0.012, 8, 24), M.silver, [0, 0, 0.37]));
    camG.add(mesh(new THREE.CircleGeometry(0.072, 24), M.glass, [0, 0, 0.372]));
    const handle = merge(THREE, [
      { geo: box(0.03, 0.03, 0.30), m: mat4(THREE, [0, 0.15, 0.02]) },
      { geo: box(0.03, 0.05, 0.03), m: mat4(THREE, [0, 0.12, -0.11]) },
      { geo: box(0.03, 0.05, 0.03), m: mat4(THREE, [0, 0.12, 0.14]) },
      { geo: box(0.05, 0.02, 0.02), m: mat4(THREE, [-0.12, -0.02, -0.06]) },
    ]);
    camG.add(mesh(handle, M.silver));
    camG.add(mesh(new THREE.PlaneGeometry(0.13, 0.09), M.whiteEm, [-0.14, 0.03, -0.02], [0, -55 * D2R, 0]));
    camG.add(mesh(cyl(0.032, 0.026, 0.06, 12), M.rubber, [0.03, 0.06, -0.18], [Math.PI / 2, 0, 0]));

    /* two fresnels on stands, heads above the cab roofline, aimed a little down at the viewer */
    const fresnel = (x, z, yaw) => {
      const stand = merge(THREE, [
        { geo: cyl(0.018, 0.018, 0.76, 10), m: mat4(THREE, [x, 0.37 + 0.38, z]) },
        { geo: cyl(0.075, 0.09, 0.03, 12), m: mat4(THREE, [x, 0.385, z]) },
        { geo: box(0.05, 0.06, 0.05), m: mat4(THREE, [x, 1.14, z]) },
      ]);
      T.add(mesh(stand, M.silver));
      const head = new THREE.Group();
      head.position.set(x, 1.16, z);
      head.rotation.set(-14 * D2R, yaw, 0, 'YXZ');
      T.add(head);
      head.add(mesh(cyl(0.13, 0.12, 0.16, 22), M.charcoal, [0, 0, 0], [Math.PI / 2, 0, 0]));
      head.add(mesh(new THREE.TorusGeometry(0.128, 0.012, 8, 24), M.silver, [0, 0, 0.08]));
      const disc = mesh(new THREE.CircleGeometry(0.11, 24), M.warmEm, [0, 0, 0.082]);
      head.add(disc);
      /* barn doors: four flaps hinged at the front rim, opened 35 degrees out */
      const F = 35 * D2R, L = 0.20;
      const flap = (axis, sign, w, h) => {
        const e = axis === 'x' ? [sign * F, 0, 0] : [0, sign * F, 0];
        const base = axis === 'x' ? [0, sign * 0.135, 0.085] : [sign * 0.135, 0, 0.085];
        const off = new THREE.Vector3(axis === 'x' ? 0 : sign * L / 2, axis === 'x' ? sign * L / 2 : 0, 0);
        off.applyEuler(new THREE.Euler(e[0], e[1], e[2]));
        const geo = axis === 'x' ? box(w, L, 0.006) : box(L, h, 0.006);
        return { geo, m: mat4(THREE, [base[0] + off.x, base[1] + off.y, base[2] + off.z], e) };
      };
      const doors = merge(THREE, [flap('x', 1, 0.30, 0), flap('x', -1, 0.30, 0), flap('y', -1, 0, 0.22), flap('y', 1, 0, 0.22)]);
      head.add(mesh(doors, M.charcoal));
      const glow = makeGlow(0xffd2a0, 0.95, 0.75);
      glow.position.set(0, 0, 0.16);
      head.add(glow);
      lamps.push({ head, glow, disc });
    };
    fresnel(-0.84, -0.22, 32 * D2R);
    fresnel(0.20, -0.24, -10 * D2R);

    halo.scale.set(3.0, 2.1, 1);
    halo.position.set(0, 0.55, -0.9);
  }

  /* centre the prop on its origin from the measured box (halo and sprites excluded) */
  const bbox = new THREE.Box3();
  {
    rig.updateMatrixWorld(true);
    const b = new THREE.Box3();
    const tmp = new THREE.Box3();
    rig.traverse(o => {
      if (!o.isMesh || o.userData.noBox) return;
      if (o.isInstancedMesh) {
        for (const p of (wheels ? wheels.wpos : [])) {
          const mm = new THREE.Matrix4().makeTranslation(p[0], p[1], p[2]);
          o.geometry.computeBoundingBox();
          tmp.copy(o.geometry.boundingBox).applyMatrix4(mm).applyMatrix4(o.parent.matrixWorld);
          b.union(tmp);
        }
        return;
      }
      o.geometry.computeBoundingBox();
      tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      b.union(tmp);
    });
    const c = b.getCenter(new THREE.Vector3());
    for (const ch of rig.children) ch.position.sub(c);
    bbox.copy(b).translate(c.negate());
  }
  const size = bbox.getSize(new THREE.Vector3());

  /* ---------- state ---------- */
  let dim = 0, dimT = 0, hover = 0, hoverT = 0;
  let flash = 0, dirty = true, acc = 1;
  let vz = 0, pz = 0, vx = 0, px = 0;
  let clap = 0, burst = 0;
  let fontsHooked = false;
  const wob = kind === 'phone' ? 1.3 : kind === 'truck' ? 0.6 : 0.9;
  const tmpM = new THREE.Matrix4();

  function redraw(t) {
    for (const s of screens) {
      s.draw(s.ctx, s.W, s.H, t, accentRgb, flash);
      s.tex.needsUpdate = true;
    }
  }

  function update(dt, t) {
    dt = Math.min(dt || 0, 0.1);
    if (!fontsHooked && typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      fontsHooked = true;
      document.fonts.ready.then(() => { dirty = true; });
    }
    /* eased states */
    dim += (dimT - dim) * Math.min(1, dt / 0.3);
    hover += (hoverT - hover) * Math.min(1, dt / 0.2);
    if (flash > 0) { flash = Math.max(0, flash - dt * 6); dirty = true; }
    burst = Math.max(0, burst - dt * 3);

    /* idle wobble */
    rig.rotation.y = Math.sin(t / 5.1 * TAU) * 5 * D2R * wob;
    rig.rotation.x = Math.sin(t / 7.3 * TAU + 1) * 2.5 * D2R * wob + px;
    rig.rotation.z = Math.sin(t / 9.1 * TAU + 2) * 1.5 * D2R * wob;
    rig.position.y = Math.sin(t / 4.3 * TAU) * 0.015;
    /* recoil spring on z */
    const k = 60, c = 2 * Math.sqrt(k) * 0.55;
    vz += (-k * pz - c * vz) * dt; pz += vz * dt;
    vx += (-k * px - c * vx) * dt; px += vx * dt;
    rig.position.z = pz;

    /* emissives */
    const emK = (1 - 0.94 * dim) * (1 + 0.5 * hover + burst * 0.8);
    for (const e of ems) e.m.emissiveIntensity = e.base * emK;
    haloMat.opacity = HALO_OP * (1 - dim) * (1 + 1.1 * hover + burst);
    const scrK = (1 - 0.90 * dim) * (1 + 0.35 * hover);
    for (const s of screens) s.mat.color.setScalar(scrK);
    for (const sp of sprites) {
      sp.s.material.opacity = sp.op * (1 - 0.97 * dim) * (1 + 0.5 * hover + 0.5 * burst);
      const sc = sp.base * (1 + 0.4 * hover + 0.4 * burst);
      sp.s.scale.set(sc, sc, 1);
    }

    if (clapper) {
      /* breathing open 6..10 deg, snapping shut on a poke */
      clap = Math.max(0, clap - dt * 4);
      const open = 8 + 2 * Math.sin(t / 3.7 * TAU);
      const shut = clap > 0.6 ? (1 - (clap - 0.6) / 0.4) : clap / 0.6;   /* 0..1..0 */
      clapper.rotation.z = open * D2R * (1 - (clap > 0 ? shut : 0)) + (clap > 0 ? 0.5 * D2R * shut : 0);
    }
    if (wheels) {
      wheels.spin += dt * 0.9;
      for (let i = 0; i < 6; i++) {
        const p = wheels.wpos[i];
        tmpM.makeRotationZ(wheels.spin + i * 0.7).setPosition(p[0], p[1], p[2]);
        wheels.tyres.setMatrixAt(i, tmpM);
        wheels.hubs.setMatrixAt(i, tmpM);
        wheels.caps.setMatrixAt(i, tmpM);
      }
      wheels.tyres.instanceMatrix.needsUpdate = true;
      wheels.hubs.instanceMatrix.needsUpdate = true;
      wheels.caps.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < lamps.length; i++) {
        const fl = 1 + 0.05 * Math.sin(t * 17 + i * 3) * Math.sin(t * 5.3 + i);
        lamps[i].glow.material.opacity *= fl;
      }
    }

    acc += dt;
    if (dirty || acc >= 0.1) {
      redraw(t);
      acc = 0; dirty = false;
    }
  }

  function setDim(d) { dimT = Math.max(0, Math.min(1, +d || 0)); }
  function setHover(b) { hoverT = b ? 1 : 0; }
  function poke() {
    vz -= 1.4;
    vx -= 0.9;
    flash = 0.9;
    dirty = true;
    burst = 1;
    if (clapper) clap = 1;
  }
  function dispose() {
    for (const g of geos) g.dispose();
    for (const t of textures) t.dispose();
    for (const m of Object.values(M)) m.dispose();
    haloMat.dispose();
    for (const s of screens) s.mat.dispose();
    for (const sp of sprites) sp.s.material.dispose();
    for (const m of extraMats) m.dispose();
  }

  update(0, 0);
  return { group, update, setDim, setHover, poke, dispose, kind, size };
}
