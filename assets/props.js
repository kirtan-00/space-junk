/* SPACE JUNK: the three production props for the "SOME OF IT NEEDED A LENS" ring.
   What he makes with a crew, built the way the L.I.S.A. figure in crt.js is built:
   brushed silver bevels, dark charcoal, thin white and accent emissive lines, canvas
   screens. Self-contained: only uses the THREE namespace passed in. No lights inside
   (the page scales group freely; emissives and additive sprites scale with it).

   makeProp(THREE, { kind, accent, slate }) -> { group, update(dt, t), setDim, setHover, poke, dispose, kind, size }
     kind     "screen" (THE DVCs)  a 16:9 monitor in a silver bezel playing a procedural DVC
                                    (light leaks, letterbox, play triangle, running timecode),
                                    with a clapperboard slate held in front of its lower left:
                                    chalk-white slate type on black, the two slate lines, then
                                    ROLL / SCENE / TAKE fields, striped sticks on top that clap.
              "phone"  (THE REELS) a 9:19.5 phone, silver frame, black glass, a vertical
                                    reel feed scrolling up, IG glyph, heart / comment / share.
              "camera" (THE SHOOTS) a cinema camera: boxy body on 15 mm rods, matte box with a
                                    top flag, big lens with a glass disc, top handle, viewfinder,
                                    a swung-out side monitor playing the DVC, a battery block
                                    behind. Floats with a slow zero-g tumble inside a cloud of
                                    confetti (120 instanced rectangles, six colours) that drifts
                                    outward, tumbles and recycles so the cloud never empties.
              "truck"  alias of "camera", kept so older callers do not break.
     accent   hex string for the emissive edge, halo and indicator. Default '#3fe9ff'.
     slate    string for the slate, default "PRODUCED BY TRULY YOURS". Laid out as two lines:
              split on a newline or "|" if present, else after the word BY, else at the middle
              word. Line one small, line two big and shrunk to fit the board.

   Geometry: each prop is centred on its own origin and fits a 2.2 wide by 1.6 tall box
   (size holds the measured Box3 extents; the confetti cloud and halo are excluded).
   Front faces +Z. The camera carries a baked 52 degree yaw so body, matte box and
   monitor silhouette from the front; its tumble oscillates around that.

   group        yours to place, aim and scale; the module never writes to it. All motion
                (idle wobble, recoil, tumble, confetti) runs on an inner rig.
   update(dt,t) seconds. Call every frame. Canvas screens redraw at most every 100 ms;
                the slate redraws only when fonts land or a poke flashes it.
   setDim(d)    0..1. 1 is the dead state: screens fall to 10 percent, emissives, glows
                and confetti to near nothing. Eased over 300 ms.
   setHover(b)  screens brighten a third, emissives half again, the lens glint flares.
   poke()       a small recoil away from the viewer with a spring back, a one-redraw white
                flash on the screens, the slate sticks clap, the confetti throws a fresh burst.
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

/* the slate copy as two lines: explicit break, else after BY, else the middle word */
function slateLines(s) {
  const raw = (typeof s === 'string' && s.trim()) ? s.trim() : 'PRODUCED BY TRULY YOURS';
  let a, b;
  const brk = raw.split(/\s*(?:\n|\|)\s*/).filter(Boolean);
  if (brk.length >= 2) { a = brk[0]; b = brk.slice(1).join(' '); }
  else {
    const words = raw.split(/\s+/);
    const by = words.findIndex(w => /^by$/i.test(w));
    const cut = by > 0 && by < words.length - 1 ? by + 1 : Math.max(1, Math.floor(words.length / 2));
    if (words.length === 1) { a = ''; b = words[0]; }
    else { a = words.slice(0, cut).join(' '); b = words.slice(cut).join(' '); }
  }
  return [a.toUpperCase(), b.toUpperCase()];
}

/* the DVC screen: 512 x 288. play sits at playAt (fractions), off centre on the monitor so the slate does not hide it */
function drawDVC(g, W, H, t, accentRgb, flash, playAt) {
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
  const cx = W * (playAt ? playAt[0] : 0.5), cy = H * (playAt ? playAt[1] : 0.5);
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

/* the slate face: 672 x 400. chalk white on black, two lines of copy, ROLL / SCENE / TAKE under a rule */
function drawSlate(g, W, H, lines, flash) {
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#08080a';
  g.fillRect(0, 0, W, H);
  /* chalk dust: a faint haze in the middle and a few wiped strokes */
  const rg = g.createRadialGradient(W * 0.5, H * 0.42, 10, W * 0.5, H * 0.42, W * 0.65);
  rg.addColorStop(0, 'rgba(255,255,255,0.055)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,0.022)';
  g.lineWidth = 26;
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.moveTo(W * (0.05 + 0.22 * i), H * (0.12 + 0.18 * (i % 2)));
    g.quadraticCurveTo(W * (0.25 + 0.22 * i), H * 0.55, W * (0.18 + 0.22 * i), H * 0.92);
    g.stroke();
  }

  const chalk = 'rgba(242,240,233,0.94)';
  const soft = 'rgba(242,240,233,0.62)';
  const rule = 'rgba(242,240,233,0.55)';
  const yDiv = Math.round(H * 0.615);
  g.fillStyle = rule;
  g.fillRect(0, yDiv, W, 2);
  g.fillRect(Math.round(W / 3), yDiv, 2, H - yDiv);
  g.fillRect(Math.round(2 * W / 3), yDiv, 2, H - yDiv);

  const spaced = (px) => { try { g.letterSpacing = px + 'px'; } catch (e) { /* older canvas */ } };
  g.textAlign = 'center';
  g.textBaseline = 'middle';

  /* line one, small and tracked */
  if (lines[0]) {
    let fs = Math.round(H * 0.105);
    g.font = `700 ${fs}px ${MONO}`;
    spaced(fs * 0.18);
    while (g.measureText(lines[0]).width > W * 0.88 && fs > 14) { fs -= 1; g.font = `700 ${fs}px ${MONO}`; spaced(fs * 0.18); }
    g.fillStyle = soft;
    g.fillText(lines[0], W / 2 + fs * 0.09, H * 0.17);
    spaced(0);
  }
  /* line two, the big one, shrunk to the board */
  let fs = Math.round(H * 0.235);
  g.font = `700 ${fs}px ${MONO}`;
  while (g.measureText(lines[1]).width > W * 0.92 && fs > 18) { fs -= 2; g.font = `700 ${fs}px ${MONO}`; }
  const y2 = lines[0] ? H * 0.415 : H * 0.32;
  g.fillStyle = 'rgba(242,240,233,0.35)';
  g.fillText(lines[1], W / 2 + 1.5, y2 + 1.5);
  g.fillStyle = chalk;
  g.fillText(lines[1], W / 2, y2);

  /* fields */
  const fields = [['ROLL', 'A001'], ['SCENE', '14'], ['TAKE', '3']];
  const labFs = Math.round(H * 0.052), valFs = Math.round(H * 0.15);
  fields.forEach(([lab, val], i) => {
    const cx = W * (i + 0.5) / 3;
    g.font = `400 ${labFs}px ${MONO}`;
    spaced(labFs * 0.18);
    g.fillStyle = soft;
    g.fillText(lab, cx + labFs * 0.09, yDiv + H * 0.075);
    spaced(0);
    g.font = `700 ${valFs}px ${MONO}`;
    g.fillStyle = chalk;
    g.fillText(val, cx, yDiv + (H - yDiv) * 0.64);
  });

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
  const kind = opts.kind === 'phone' ? 'phone' : (opts.kind === 'camera' || opts.kind === 'truck') ? 'camera' : 'screen';
  const accentHex = pickAccent(opts.accent);
  const accent = new THREE.Color(accentHex);
  const accentRgb = hexToRgb(accentHex);
  const slateText = slateLines(opts.slate);

  const group = new THREE.Group();
  group.name = 'prop-' + kind;
  const rig = new THREE.Group();
  rig.name = 'prop-rig';
  group.add(rig);

  const M = {
    silver: new THREE.MeshStandardMaterial({ color: 0xcfcfca, roughness: 0.55, metalness: 0.1 }),
    silverUnder: new THREE.MeshStandardMaterial({ color: 0x9a948c, roughness: 0.5, metalness: 0.1 }),
    charcoal: new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.6, metalness: 0.05 }),
    charcoal2: new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide }),
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
  const screens = [];   /* { mat, tex, ctx, draw, W, H, fixed } */
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
  const RX = Math.PI / 2;

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

  /* draw(ctx, W, H, t, accentRgb, flash). fixed screens redraw only when dirty (fonts landed, a flash) */
  const makeScreen = (W, H, draw, fixed) => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    textures.push(tex);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
    screens.push({ mat, tex, ctx: c.getContext('2d'), draw, W, H, fixed: !!fixed });
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
  let clapper = null;      /* pivot group for the slate's top stick */
  let camRig = null;       /* the camera's yaw group, for the tumble */
  let confetti = null;     /* { mesh, n, dir, r, v, drift, rot, av, sc, radii } */
  let lensGlow = null;

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

    /* the DVC, its play ring moved up and right so the slate does not sit on it */
    const scrMat = makeScreen(512, 288, (g, w, h, t, a, f) => drawDVC(g, w, h, t, a, f, [0.74, 0.40]));
    const scr = mesh(new THREE.PlaneGeometry(W - 2 * RIM + 0.012, H - 2 * RIM + 0.012), scrMat, [0, 0, 0.012]);
    rig.add(scr);

    /* indicator dot, bottom right of the bezel */
    const dot = mesh(cyl(0.011, 0.011, 0.006, 12), M.accentEm, [W / 2 - RIM / 2, -H / 2 + RIM / 2, 0.052], [RX, 0, 0]);
    rig.add(dot);

    /* the slate: a black board in a thin silver frame held in front of the lower left of the
       monitor, turned a few degrees toward the viewer; striped sticks on top, the upper one hinged left */
    const SW = 1.34, SH = 0.80, SD = 0.03, SR = 0.024;
    const S = new THREE.Group();
    S.name = 'slate';
    S.position.set(-0.27, -0.22, 0.19);
    S.rotation.set(0, -9 * D2R, 2.5 * D2R);
    rig.add(S);
    S.add(mesh(slab(THREE, SW, SH, SD, SR, { bevel: 0.004, curve: 8 }), M.dark, [0, 0, 0]));
    const frameGeo = slab(THREE, SW + 0.04, SH + 0.04, SD + 0.004, SR + 0.01, { hole: [SW - 0.02, SH - 0.02, SR], bevel: 0.006, curve: 8 });
    S.add(mesh(frameGeo, [M.silver, M.silverUnder], [0, 0, 0.004]));
    const slateMat = makeScreen(672, 400, (g, w, h, t, a, f) => drawSlate(g, w, h, slateText, f), true);
    S.add(mesh(new THREE.PlaneGeometry(SW - 0.05, SH - 0.05), slateMat, [0, 0, SD / 2 + 0.009]));

    const stripes = stripeTexture(THREE);
    textures.push(stripes);
    const stripeMat = new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.6, metalness: 0.05 });
    extraMats.push(stripeMat);
    stripes.repeat.set(6, 1);
    const barH = 0.085, stickH = 0.08, D = SD + 0.05;
    const sixMats = [M.dark, M.dark, stripeMat, M.dark, stripeMat, stripeMat];
    S.add(mesh(box(SW + 0.04, barH, D), sixMats, [0, SH / 2 + 0.02 + barH / 2, 0]));
    clapper = new THREE.Group();
    clapper.position.set(-SW / 2 + 0.03, SH / 2 + 0.02 + barH, 0);
    const stick = mesh(box(SW + 0.04, stickH, D * 0.95), sixMats, [SW / 2 - 0.03 + 0.02, stickH / 2 + 0.004, 0]);
    clapper.add(stick);
    clapper.add(mesh(cyl(0.05, 0.05, D + 0.03, 18), M.silver, [0, 0, 0], [RX, 0, 0]));
    clapper.add(mesh(cyl(0.02, 0.02, D + 0.05, 12), M.accentEm, [0, 0, 0], [RX, 0, 0]));
    clapper.rotation.z = 8 * D2R;
    S.add(clapper);

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
      { geo: cyl(0.045, 0.045, 0.016, 18), m: mat4(THREE, [-PW / 2 + 0.115, PH / 2 - 0.115, -0.062], [RX, 0, 0]) },
      { geo: cyl(0.045, 0.045, 0.016, 18), m: mat4(THREE, [-PW / 2 + 0.205, PH / 2 - 0.205, -0.062], [RX, 0, 0]) },
    ]);
    rig.add(mesh(lenses, M.glass));
    halo.scale.set(1.7, 2.3, 1);
    halo.position.set(0, 0, -0.2);
  }

  /* ================= CAMERA ================= */
  if (kind === 'camera') {
    /* built at unit scale with the lens down +z, then yawed 52 degrees and scaled up to the box.
       The -x side faces the viewer: side panel, swung-out monitor. */
    const C = new THREE.Group();
    C.name = 'camera-yaw';
    C.rotation.y = 52 * D2R;
    C.scale.setScalar(1.42);
    rig.add(C);
    camRig = C;

    /* body: charcoal block between two silver plates, a proud side panel with lit details */
    C.add(mesh(box(0.44, 0.44, 0.72), M.charcoal, [0, 0, -0.02]));
    const plates = merge(THREE, [
      { geo: box(0.46, 0.025, 0.74), m: mat4(THREE, [0, 0.232, -0.02]) },
      { geo: box(0.46, 0.025, 0.74), m: mat4(THREE, [0, -0.232, -0.02]) },
      { geo: box(0.02, 0.36, 0.56), m: mat4(THREE, [0.225, 0, -0.06]) },        /* far side cheese plate */
      { geo: new THREE.TorusGeometry(0.17, 0.02, 8, 28), m: mat4(THREE, [0, 0, 0.35]) },   /* lens mount */
      { geo: box(0.22, 0.03, 0.10), m: mat4(THREE, [0, -0.26, 0.10]) },         /* riser to the rod clamp */
      { geo: box(0.24, 0.06, 0.05), m: mat4(THREE, [0, -0.33, 0.58]) },         /* front rod bracket */
      { geo: box(0.05, 0.16, 0.06), m: mat4(THREE, [0, 0.32, -0.26]) },         /* handle posts */
      { geo: box(0.05, 0.16, 0.06), m: mat4(THREE, [0, 0.32, 0.12]) },
      { geo: box(0.05, 0.05, 0.62), m: mat4(THREE, [0, 0.425, -0.07]) },        /* handle bar */
      { geo: box(0.04, 0.05, 0.04), m: mat4(THREE, [0, 0.225, 0.88]) },         /* flag arm */
      { geo: box(0.36, 0.32, 0.015), m: mat4(THREE, [0, -0.02, -0.387]) },      /* battery V plate */
      { geo: box(0.04, 0.04, 0.10), m: mat4(THREE, [0.20, 0.30, -0.30]) },      /* viewfinder arm */
    ]);
    C.add(mesh(plates, M.silver));
    C.add(mesh(box(0.02, 0.30, 0.50), M.dark, [-0.23, 0.0, -0.05]));
    const lit = merge(THREE, [
      { geo: box(0.006, 0.012, 0.36), m: mat4(THREE, [-0.243, 0.10, -0.05]) },  /* the accent line along the side */
      { geo: box(0.005, 0.02, 0.02), m: mat4(THREE, [-0.172, 0.08, -0.455]) },  /* battery LED */
    ]);
    C.add(mesh(lit, M.accentEm));
    const buttons = merge(THREE, [-0.20, -0.14, -0.08].map(z => ({ geo: box(0.006, 0.028, 0.028), m: mat4(THREE, [-0.243, -0.06, z]) })));
    C.add(mesh(buttons, M.whiteEm));
    /* rods, clamp, rubber bits */
    const rods = merge(THREE, [
      { geo: cyl(0.012, 0.012, 1.05, 12), m: mat4(THREE, [0.06, -0.33, 0.13], [RX, 0, 0]) },
      { geo: cyl(0.012, 0.012, 1.05, 12), m: mat4(THREE, [-0.06, -0.33, 0.13], [RX, 0, 0]) },
    ]);
    C.add(mesh(rods, M.silver));
    C.add(mesh(box(0.22, 0.07, 0.10), M.charcoal, [0, -0.29, 0.10]));
    C.add(mesh(box(0.056, 0.056, 0.26), M.rubber, [0, 0.425, -0.07]));       /* handle grip */
    C.add(mesh(box(0.06, 0.02, 0.08), M.dark, [0, 0.46, -0.07]));            /* cold shoe */

    /* lens: dark barrel, silver focus ring and front rim, glass, an accent coating ring, a glint */
    C.add(mesh(cyl(0.15, 0.15, 0.42, 28), M.dark, [0, 0, 0.63], [RX, 0, 0]));
    const rings = merge(THREE, [
      { geo: cyl(0.162, 0.162, 0.06, 28), m: mat4(THREE, [0, 0, 0.52], [RX, 0, 0]) },
      { geo: cyl(0.156, 0.156, 0.03, 28), m: mat4(THREE, [0, 0, 0.835], [RX, 0, 0]) },
    ]);
    C.add(mesh(rings, M.silver));
    C.add(mesh(new THREE.CircleGeometry(0.135, 32), M.glass, [0, 0, 0.852]));
    C.add(mesh(new THREE.TorusGeometry(0.075, 0.007, 8, 32), M.accentEm, [0, 0, 0.856]));
    lensGlow = makeGlow(accent.getHex(), 0.55, 0.35);
    lensGlow.position.set(0, 0, 0.90);
    C.add(lensGlow);

    /* matte box: rectangular filter stage, a flared hood open at the front, silver front rail, top flag */
    C.add(mesh(box(0.44, 0.34, 0.08), M.charcoal, [0, 0, 0.655]));
    const hoodGeo = new THREE.CylinderGeometry(0.26 * Math.SQRT2, 0.19 * Math.SQRT2, 0.20, 4, 1, true, Math.PI / 4);
    hoodGeo.rotateX(RX);
    const hood = mesh(hoodGeo, M.charcoal2, [0, 0, 0.80]);
    hood.scale.y = 0.78;
    C.add(hood);
    const rail = mesh(new THREE.TorusGeometry(0.26 * Math.SQRT2, 0.014, 6, 4), M.silver, [0, 0, 0.90], [0, 0, Math.PI / 4]);
    rail.scale.set(1, 0.78, 1);
    C.add(rail);
    const rail2 = mesh(new THREE.TorusGeometry(0.19 * Math.SQRT2, 0.012, 6, 4), M.silver, [0, 0, 0.70], [0, 0, Math.PI / 4]);
    rail2.scale.set(1, 0.78, 1);
    C.add(rail2);
    C.add(mesh(box(0.54, 0.006, 0.18), M.charcoal2, [0, 0.255, 0.98], [-28 * D2R, 0, 0]));

    /* viewfinder on the far top corner, eyecup to the back */
    C.add(mesh(box(0.11, 0.11, 0.20), M.charcoal, [0.20, 0.24, -0.40]));
    C.add(mesh(cyl(0.055, 0.045, 0.05, 18), M.rubber, [0.20, 0.24, -0.525], [RX, 0, 0]));
    /* tally, top front near side */
    C.add(mesh(cyl(0.02, 0.02, 0.02, 12), M.redEm, [-0.12, 0.255, 0.28]));
    /* battery block behind */
    C.add(mesh(box(0.34, 0.30, 0.13), M.dark, [0, -0.02, -0.455]));

    /* side monitor, swung out on the near side and turned to face the viewer, playing the DVC */
    C.add(mesh(cyl(0.015, 0.015, 0.26, 10), M.silver, [-0.34, 0.16, 0.05], [0, 0, RX]));
    C.add(mesh(cyl(0.03, 0.03, 0.05, 14), M.dark, [-0.46, 0.16, 0.05], [0, 0, RX]));
    const MN = new THREE.Group();
    MN.position.set(-0.50, 0.13, 0.13);
    MN.rotation.y = -34 * D2R;
    C.add(MN);
    const MW = 0.42, MH = 0.26, MF = 0.018;
    MN.add(mesh(slab(THREE, MW, MH, 0.03, 0.02, { hole: [MW - 2 * MF, MH - 2 * MF, 0.01], bevel: 0.004, curve: 8 }), [M.silver, M.silverUnder], [0, 0, 0]));
    MN.add(mesh(slab(THREE, MW - 0.02, MH - 0.02, 0.04, 0.018, { bevel: 0 }), M.dark, [0, 0, -0.022]));
    const monMat = makeScreen(512, 288, drawDVC);
    MN.add(mesh(new THREE.PlaneGeometry(MW - 2 * MF + 0.006, MH - 2 * MF + 0.006), monMat, [0, 0, 0.012]));

    /* confetti: 120 flat rectangles in six colours, instanced, drifting out of the body and recycling.
       Lives on the rig, not on the camera, so the cloud stays put while the body tumbles. */
    const NC = 120;
    const cfGeo = new THREE.PlaneGeometry(0.085, 0.055);
    geos.push(cfGeo);
    const cfMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, toneMapped: false });
    extraMats.push(cfMat);
    const cf = new THREE.InstancedMesh(cfGeo, cfMat, NC);
    cf.userData.noBox = true;
    cf.frustumCulled = false;
    cf.name = 'confetti';
    const palette = ['#ff2d78', accentHex, '#ffc247', '#8dff4a', '#b06bff', '#ffffff'].map(h => new THREE.Color(h));
    for (let i = 0; i < NC; i++) cf.setColorAt(i, palette[i % palette.length]);
    cf.instanceColor.needsUpdate = true;
    rig.add(cf);
    confetti = {
      mesh: cf, n: NC,
      dir: new Float32Array(NC * 3), r: new Float32Array(NC), v: new Float32Array(NC), drift: new Float32Array(NC),
      rot: new Float32Array(NC * 3), av: new Float32Array(NC * 3), sc: new Float32Array(NC),
      radii: [1.30, 0.95, 0.70],
    };
    for (let i = 0; i < NC; i++) spawn(i, 0.30 + Math.random() * 0.70, false);

    halo.scale.set(3.0, 2.1, 1);
    halo.position.set(0, 0, -0.9);
  }

  /* a confetti piece: a fresh direction, a radius, a speed (burst speeds decay to the drift) and a tumble */
  function spawn(i, r, burst) {
    const c = confetti;
    let x, y, z, l;
    do { x = Math.random() * 2 - 1; y = Math.random() * 2 - 1; z = Math.random() * 2 - 1; l = x * x + y * y + z * z; } while (l < 0.04 || l > 1);
    l = Math.sqrt(l);
    c.dir[i * 3] = x / l; c.dir[i * 3 + 1] = y / l; c.dir[i * 3 + 2] = z / l;
    c.r[i] = r;
    c.drift[i] = 0.05 * (0.7 + Math.random() * 0.7);
    c.v[i] = burst ? 1.0 + Math.random() * 1.0 : c.drift[i];
    c.rot[i * 3] = Math.random() * TAU; c.rot[i * 3 + 1] = Math.random() * TAU; c.rot[i * 3 + 2] = Math.random() * TAU;
    const spin = burst ? 5 : 2.2;
    for (let k = 0; k < 3; k++) c.av[i * 3 + k] = (Math.random() * 2 - 1) * spin * (0.5 + Math.random());
    c.sc[i] = 0.8 + Math.random() * 0.55;
  }

  /* centre the prop on its origin from the measured box (halo, sprites and confetti excluded) */
  const bbox = new THREE.Box3();
  {
    rig.updateMatrixWorld(true);
    const b = new THREE.Box3();
    const tmp = new THREE.Box3();
    rig.traverse(o => {
      if (!o.isMesh || o.userData.noBox) return;
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
  const wob = kind === 'phone' ? 1.3 : kind === 'camera' ? 0.5 : 0.9;
  const tmpM = new THREE.Matrix4();
  const tmpP = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpE = new THREE.Euler();
  const tmpS = new THREE.Vector3();

  function redraw(t, all) {
    for (const s of screens) {
      if (s.fixed && !all) continue;
      s.draw(s.ctx, s.W, s.H, t, accentRgb, flash);
      s.tex.needsUpdate = true;
    }
  }

  function update(dt, t) {
    dt = Math.min(dt || 0, 0.1);
    if (!fontsHooked && typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      fontsHooked = true;
      /* ready can resolve before the face is even requested; load() starts the download and resolves
         when it is usable, which is what the fixed slate canvas needs to redraw out of the fallback */
      document.fonts.ready.then(() => { dirty = true; });
      try { document.fonts.load("700 20px 'Space Mono'").then(() => { dirty = true; }).catch(() => {}); } catch (e) { /* no FontFaceSet.load */ }
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
    if (camRig) {
      /* the zero-g tumble: a slow swing around the baked yaw, a nod and a roll on other periods */
      camRig.rotation.y = (52 + 13 * Math.sin(t / 11.3 * TAU)) * D2R;
      camRig.rotation.x = 6 * Math.sin(t / 8.1 * TAU + 1.2) * D2R;
      camRig.rotation.z = 4 * Math.sin(t / 13.7 * TAU + 0.4) * D2R;
      /* the tally breathes, the lens glint holds */
      M.redEm.emissiveIntensity *= 0.75 + 0.25 * Math.sin(t * 2.4);
    }
    if (confetti) {
      const cf = confetti, R = cf.radii;
      for (let i = 0; i < cf.n; i++) {
        cf.v[i] += (cf.drift[i] - cf.v[i]) * Math.min(1, dt * 1.6);
        cf.r[i] += cf.v[i] * dt;
        if (cf.r[i] > 1) spawn(i, 0.28 + Math.random() * 0.06, false);
        cf.rot[i * 3] += cf.av[i * 3] * dt; cf.rot[i * 3 + 1] += cf.av[i * 3 + 1] * dt; cf.rot[i * 3 + 2] += cf.av[i * 3 + 2] * dt;
        const rr = cf.r[i];
        tmpP.set(cf.dir[i * 3] * rr * R[0], cf.dir[i * 3 + 1] * rr * R[1], cf.dir[i * 3 + 2] * rr * R[2]);
        tmpQ.setFromEuler(tmpE.set(cf.rot[i * 3], cf.rot[i * 3 + 1], cf.rot[i * 3 + 2]));
        tmpS.setScalar(cf.sc[i]);
        cf.mesh.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
      }
      cf.mesh.instanceMatrix.needsUpdate = true;
      cf.mesh.material.color.setScalar((1 - 0.88 * dim) * (1 + 0.15 * hover));
    }

    acc += dt;
    if (dirty || acc >= 0.1) {
      redraw(t, dirty);
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
    if (confetti) {
      /* pieces still near the body get kicked outward from where they are, the far third comes back
         as a fresh burst from the body, the middle band keeps drifting so the cloud never empties */
      const cf = confetti;
      for (let i = 0; i < cf.n; i++) {
        if (cf.r[i] < 0.45) { cf.v[i] = 0.9 + Math.random() * 0.9; for (let k = 0; k < 3; k++) cf.av[i * 3 + k] *= 2.2; }
        else if (cf.r[i] > 0.78) spawn(i, 0.26 + Math.random() * 0.08, true);
      }
    }
  }
  function dispose() {
    for (const g of geos) g.dispose();
    for (const t of textures) t.dispose();
    for (const m of Object.values(M)) m.dispose();
    haloMat.dispose();
    for (const s of screens) s.mat.dispose();
    for (const sp of sprites) sp.s.material.dispose();
    for (const m of extraMats) m.dispose();
    if (confetti) confetti.mesh.dispose();
  }

  update(0, 0);
  return { group, update, setDim, setHover, poke, dispose, kind, size };
}
