/* SPACE JUNK: the spaceman, after L.I.S.A. (lisa.locomotive.ca).
   A slim person in a ribbed knit turtleneck whose head is a near-square silver monitor,
   black starry tube, cables looping from a side junction box into the collar.
   Self-contained: only uses the THREE namespace passed in.

   makeCRT(THREE, opts) -> { group, update(dt, t), setFace, lookAt, hover, poke, glass,
                             setPose, setTumble, setScreen, setFacing, setScale,
                             setThrust, setSuitTint, setPointer, joints, full }
     opts.accent  hex string, tints the lit indicator, the roll bar and the glow. Default '#3fe9ff'.
     opts.full    full body (default false: chest-up).
     opts.suit    "dark" (default): charcoal knit, near-black trousers, dark sneakers with a
                  light sole line. "light" gives the pale grey knit of the reference.

   Geometry (units match junk3d):
     Set is 0.56 wide, 0.58 tall, cabinet 0.40 deep. Glass 0.45 x 0.42, aspect 1.08.
     Chest-up: set centre at y 0.96 (unchanged), mid-chest at about y 0.30, shoulders
       span 0.60 (0.70 with the arms). The frame should cut the arms below the elbows.
     Full: origin at the PELVIS. Sneakers reach y -0.95, set top y 1.24, about 2.2 tall.
       The set is 0.56 wide against a 0.60 shoulder span, the reference ratio.

   Motion and interaction:
     group        yours to place and aim; the module never writes to it.
     update(dt,t) seconds. Call every frame.
     lookAt(nx,ny) pointer in -1..1. The set turns toward it (total yaw 26 deg, pitch 14 deg,
                  three quarters on the head and a quarter on the body), the whole rig
                  shifts up to 0.12 toward the pointer side, the eyes slide at once and the
                  head follows through a spring (stiffness 14). Eases back 1.5 s after the last call.
     setPointer(u,v)  glass UV of the pointer (intersection.uv from raycasting crt.glass).
     hover(bool)  the picture dithers in a 0.18 disc around the pointer, roll bar speeds up.
     poke(s)      the head snaps square to the pointer (stiffness 40 for 300 ms), the body
                  recoils 0.06 away from the pointer side and springs back, the picture jumps
                  2 px with a one-frame flash, the six indicator dots run a chase.
     setScreen(m) "eyes" (default: two soft glows that look with the pointer, blink, squint,
                  and alternate with the glyph every 8 to 14 s through a 300 ms static
                  cross-fade), "glyph" (holds the mark), "static", "off", "face" (needs setFace).
     setFace(tex) a photo for "face" mode. Safe before the image has loaded.
     setPose(name, blend)  "fall" | "brake" | "tuck" | "stand". Ten sprung joints:
                  spine, head (stiffness 14), shoulderR/L, elbowR/L, hipR/L, kneeR/L (9).
     setTumble(a) 0..1 on the zero-g tumble (9.7 s and 15.3 s, +-25 deg), fall pose only.
     setFacing(q) THREE.Quaternion in group space or null. Springs toward it (stiffness 6),
                  tumble suppressed. The slow drift on rig still sits on top.
     setScale(s)  scales group and rescales every light with it.
     setThrust({main,left,right,up,down,retro})  0..1 each, 90 ms one-pole. Full only.
                  Mains fire from the sneaker soles, retro from the palms (children of the
                  elbows, so they follow the pose), left/right from the hips, up from the
                  hips downward, down from the shoulders upward.
     setSuitTint(hex|null)  light emissive tint on the knit and trousers.
     setIntent(v) 0..1, eased over 300 ms. At 1 the eyes narrow to 35 percent height,
                  slide together, brighten 1.3x with a faint accent tint, and blink less.
     land(s)      touchdown over about 900 ms: brace (knees 55 deg, arms out low, set down
                  8 deg), impact at 180 ms (40 ms squash to 0.94 y / 1.03 xz with a damped
                  bounce, cables whip, set light stutters, eyes blink, dots chase), then a
                  rise into "stand" with a small two-sine settle (0.9 s and 1.4 s).
                  Reduced motion: no squash, straight to stand.
     setGrounded(b)  true turns off the tumble and the zero-g bob and runs a weight-shift
                  idle instead (hips +-1.5 deg on 5.3 s, breathing on the spine).
     setBulk(v)   0..1, eased over 600 ms, default 0. At 1 the proportions go stocky: torso,
                  collar and shoulder spread x1.25, upper arms and thighs x1.35, forearms and
                  shins x1.2, the set x1.2 with a thicker bezel, sneakers x1.3 wide, cables
                  x1.5 thick, stance wider in "stand". Proportions only; group scale is yours.
     setRim(intensity, hex)  a DirectionalLight on the rig from behind-above, default 0.
                  1 is a clear rim on the charcoal knit, 3 is hard. Scaled x8 internally.
     glass        the screen mesh, for raycasting.

   Poses: "fall" is a dive (arrow straight, arms swept back with the palms turned back so the
     retro nozzles point aft, set pitched 12 deg down, tumble +-9 deg). "brake" is the star with
     straight arms and spread fingers, set pitched up 10 deg. "stand" has the feet apart and a
     4 deg lean with the set level. Limb springs are stiffness 15, the head 14.
*/

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;

function pickAccent(v) {
  return typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? v : '#3fe9ff';
}

/* ---------- canvas textures ---------- */

/* vertical knit ribs as a tangent-space normal map. Four ribs per tile, tiled many times around. */
function ribNormal(THREE) {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = N; c.height = N;
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  const d = img.data;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      /* height = rib profile along x, with a faint stitch wobble along y */
      const ph = (x / N) * 4 * TAU;
      const wob = 0.15 * Math.sin((y / N) * 12 * TAU + Math.sin(ph) * 0.5);
      const dhdx = Math.cos(ph) * (4 * TAU / N) * (1 + wob);
      const i = (y * N + x) * 4;
      d[i] = 128 + Math.max(-127, Math.min(127, dhdx * 22));
      d[i + 1] = 128 + Math.max(-40, Math.min(40, wob * 30));
      d[i + 2] = 255;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(14, 5);
  return t;
}

/* the studio glyph: an arc over two crossed asterisk strokes, white on transparent */
function glyphTexture(THREE) {
  const W = 512, H = 480;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.strokeStyle = '#ffffff';
  g.lineCap = 'round';
  g.lineWidth = 22;
  const cx = W / 2, cy = H * 0.52;
  const ast = (x, y, r) => {
    g.beginPath(); g.moveTo(x, y - r); g.lineTo(x, y + r); g.stroke();
    g.beginPath(); g.moveTo(x - r * 1.05, y - r * 0.05); g.lineTo(x + r * 1.05, y - r * 0.05); g.stroke();
    g.beginPath(); g.moveTo(x - r * 0.9, y + r * 0.85); g.lineTo(x + r * 0.9, y - r * 0.85); g.stroke();
  };
  ast(cx - 128, cy, 92);
  ast(cx + 128, cy, 92);
  /* the arc between them, a little lop-sided like a drawn stroke */
  g.beginPath();
  g.moveTo(cx - 96, cy + 40);
  g.bezierCurveTo(cx - 40, cy - 160, cx + 40, cy - 160, cx + 96, cy + 40);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/* a soft streak: bright at the top, fading to nothing along v, feathered across u */
function streakTexture(THREE) {
  const W = 32, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W - 0.5, v = y / H;
      const across = Math.max(0, 1 - Math.abs(u) * 2.2);
      const along = Math.pow(1 - v, 1.6);
      const a = across * across * along;
      const i = (y * W + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* a 1x1 black texture so uMap always has something bound */
function blackTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 4;
  c.getContext('2d').fillRect(0, 0, 4, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* average colour of a texture's image, used to tint the light and the glow */
function averageColor(THREE, tex, out) {
  try {
    const img = tex.image;
    if (!img || !(img.width > 0)) return false;
    const c = document.createElement('canvas');
    c.width = 4; c.height = 4;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 4, 4);
    const d = g.getImageData(0, 0, 4, 4).data;
    let r = 0, gg = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    out.setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------- shaders ---------- */

const SCREEN_VERT = /* glsl */`
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const SCREEN_FRAG = /* glsl */`
  uniform sampler2D uMap;
  uniform float uTime;
  uniform vec3  uAccent;
  uniform float uTexAspect;
  uniform float uScreenAspect;
  uniform float uHasFace;     /* 1 while uMap is a photo: broadcast treatment */
  uniform float uPic;         /* weight of the uMap picture (glyph or face) */
  uniform float uEyes;        /* weight of the eyes */
  uniform vec4  uEyeL;        /* centre x, centre y, radius, squint */
  uniform vec4  uEyeR;
  uniform float uBlink;       /* 0..1 squash */
  uniform float uIntent;      /* 0 soft round eyes, 1 narrowed and hot */
  uniform float uSnow;
  uniform float uOff;
  uniform float uRoll;
  uniform vec2  uPointer;
  uniform float uHover;
  uniform float uFlash;
  uniform vec2  uJump;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;

  float hash(float n) { return fract(sin(n) * 43758.5453123); }
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123); }

  vec2 barrel(vec2 uv, float k) {
    vec2 c = uv * 2.0 - 1.0;
    float r2 = dot(c, c);
    c *= 1.0 + k * r2;
    return c * 0.5 + 0.5;
  }

  float eye(vec2 uv, vec4 e) {
    vec2 d = vec2((uv.x - e.x) * uScreenAspect, uv.y - e.y);
    d.y /= max(1.0 - 0.92 * uBlink, 0.06);
    d.y /= max(1.0 - 0.65 * uIntent, 0.06);
    float r = max(e.z, 0.001);
    float q = length(d) / r;
    float core = smoothstep(1.0, 0.25, q);
    float halo = 0.30 * exp(-max(q - 0.85, 0.0) * 2.6);
    float v = core + halo * (1.0 - core);
    /* squint: a dark crescent over the top */
    vec2 d2 = vec2(d.x, d.y - 0.55 * r);
    float q2 = length(d2) / r;
    v *= 1.0 - e.w * smoothstep(1.02, 0.86, q2);
    return v;
  }

  void main() {
    const float K = 0.075;
    vec2 uv = barrel(vUv, K);
    uv = (uv - 0.5) / (1.0 + K * 0.98) + 0.5;
    uv += uJump;
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);

    /* black tube with faint stars, a few of them twinkling */
    vec2 sc = floor(uv * vec2(170.0, 158.0));
    float sh = hash2(sc);
    float star = smoothstep(0.975, 1.0, sh) * (0.5 + 0.5 * sin(uTime * 2.3 + sh * 40.0));
    vec3 col = vec3(0.004) + vec3(star) * 0.30;

    /* the picture: glyph (white on black) or a photo, cover fit */
    vec2 fuv = uv;
    float ar = uTexAspect / uScreenAspect;
    if (ar > 1.0) fuv.x = (fuv.x - 0.5) / ar + 0.5;
    else          fuv.y = (fuv.y - 0.5) * ar + 0.5;
    vec3 pic = texture2D(uMap, fuv).rgb;
    float lum = dot(pic, vec3(0.299, 0.587, 0.114));
    /* photo: saturation to 0.8, a cool tint, a lift */
    vec3 photo = mix(vec3(lum), pic, 0.8);
    photo = mix(photo, lum * uAccent * 1.15, 0.12) * 1.15;
    pic = mix(pic, photo, uHasFace);
    col += pic * uPic;

    /* eyes */
    float ey = eye(uv, uEyeL) + eye(uv, uEyeR);
    vec3 eyeCol = mix(vec3(0.98, 0.99, 1.0), uAccent, 0.25 * uIntent) * (1.0 + 0.3 * uIntent);
    col += eyeCol * ey * uEyes;

    /* faint scanlines and sub-pixel mask, fading out when the screen is small */
    float lines = 110.0;
    float slw = fwidth(uv.y * lines);
    float slAmt = 0.14 * (1.0 - smoothstep(0.55, 1.1, slw));
    col *= (1.0 - slAmt) + slAmt * (0.5 + 0.5 * sin(uv.y * 3.14159 * 2.0 * lines));
    float cols = 420.0;
    float s = mod(floor(uv.x * cols), 3.0);
    float mw = fwidth(uv.x * cols);
    float mAmt = 0.22 * (1.0 - smoothstep(0.35, 0.9, mw));
    vec3 mask = vec3(step(s, 0.5), step(0.5, s) * step(s, 1.5), step(1.5, s)) * mAmt + (1.0 - mAmt * 0.6);
    col *= mask;

    /* slow roll bar, barely there on a black tube */
    float bp = fract(uRoll + 0.04 * sin(uTime * 0.37));
    float d = abs(uv.y - bp);
    d = min(d, 1.0 - d);
    float bar = smoothstep(0.13, 0.0, d);
    col = col * (1.0 - 0.10 * bar) + uAccent * bar * 0.035;

    /* mains hum */
    col *= 0.975 + 0.025 * sin(uTime * 37.0) * sin(uTime * 23.7);

    /* snow: the cross-fade and the static mode */
    float snow = hash2(floor(uv * vec2(220.0, 160.0)) + floor(uTime * 60.0) * 0.173);
    float snow2 = hash2(floor(uv * vec2(110.0, 80.0)) + floor(uTime * 30.0) * 0.311);
    vec3 snowCol = vec3(0.08 + 0.42 * snow * (0.6 + 0.4 * snow2)) * mix(vec3(1.0), uAccent * 1.3, 0.18);
    col = mix(col, snowCol, uSnow);

    /* hover: ordered dither inside a soft disc around the pointer, in raw glass UV */
    float pd = length((vUv - uPointer) * vec2(uScreenAspect, 1.0));
    float dm = smoothstep(0.18, 0.11, pd) * uHover;
    if (dm > 0.001) {
      vec2 cell = floor(vUv * vec2(96.0, 90.0));
      float bx = mod(cell.x, 4.0), by = mod(cell.y, 4.0);
      /* 4x4 Bayer built from the bit pattern */
      float b = (mod(bx + 2.0 * by, 4.0) * 4.0 + mod(3.0 * bx + by, 4.0)) / 16.0;
      float l2 = dot(col, vec3(0.299, 0.587, 0.114));
      float dith = step(b + 0.04, l2 * 1.25 + 0.06);
      col = mix(col, vec3(dith) * 0.95, dm);
    }

    /* poke flash */
    col += vec3(uFlash);

    /* vignette to the corners, the tube border */
    vec2 q = uv * (1.0 - uv);
    float vig = pow(clamp(16.0 * q.x * q.y, 0.0, 1.0), 0.35);
    col *= vig * inside;

    /* off: dark phosphor */
    col *= 1.0 - 0.97 * uOff;

    /* the glass: a broad soft studio highlight sweeping the top-left, a fresnel rim,
       and a thin bright edge along the bulge */
    float fr = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 3.0);
    float sweep = smoothstep(0.55, -0.15, dot(vUv - vec2(0.0, 1.0), normalize(vec2(1.0, -1.0))));
    float band = smoothstep(0.10, 0.0, abs(dot(vUv - vec2(0.0, 1.0), normalize(vec2(1.0, -1.0))) - 0.16));
    col += vec3(0.16, 0.17, 0.18) * sweep * 0.55;
    col += vec3(0.30, 0.31, 0.32) * band * 0.35;
    col += vec3(0.34, 0.36, 0.40) * fr * 0.6;

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const GLOW_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GLOW_FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    vec2 c = (vUv - 0.5) * 2.0;
    vec2 k = max(abs(c) - vec2(0.72), 0.0);
    float d = length(k) / 0.36;
    float e = d - 0.55;
    float inner = 0.30 + 0.40 * smoothstep(-0.55, 0.0, e);
    float outer = 0.70 * (1.0 - smoothstep(0.0, 0.45, e));
    float a = (e < 0.0 ? inner : outer) * uAlpha;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/* ---------- the figure ---------- */

export function makeCRT(THREE, opts = {}) {
  const accentHex = pickAccent(opts.accent);
  const accent = new THREE.Color(accentHex);
  const full = !!opts.full;
  const darkKnit = opts.suit !== 'light';

  const group = new THREE.Group();
  group.name = 'crt-spaceman';
  const rig = new THREE.Group();
  rig.name = 'crt-rig';
  group.add(rig);
  const tum = new THREE.Group();
  tum.name = 'crt-tumble';
  rig.add(tum);

  /* ----- materials ----- */
  const silver = new THREE.MeshStandardMaterial({ color: 0xcfcfca, roughness: 0.55, metalness: 0.1 });
  const silverUnder = new THREE.MeshStandardMaterial({ color: 0x9a948c, roughness: 0.5, metalness: 0.1 });
  const innerFrame = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.5, metalness: 0.1 });
  const cabinetMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.6, metalness: 0.05 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.55, metalness: 0.0 });
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.45, metalness: 0.1 });
  const dotOff = new THREE.MeshStandardMaterial({ color: 0x9a9aa0, roughness: 0.4, metalness: 0.2 });
  const ribs = ribNormal(THREE);
  const knitColor = new THREE.Color(darkKnit ? 0x1c1e24 : 0xcfc9c4);
  const knit = new THREE.MeshStandardMaterial({
    color: knitColor, roughness: darkKnit ? 0.85 : 0.9, metalness: 0.0,
    normalMap: ribs, normalScale: darkKnit ? new THREE.Vector2(0.6, 0.3) : new THREE.Vector2(1.1, 0.5),
    emissive: knitColor.clone(), emissiveIntensity: 0.04,
  });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd7b9a4, roughness: 0.75, metalness: 0.0 });
  const trouser = new THREE.MeshStandardMaterial({ color: darkKnit ? 0x0f1014 : 0x25252a, roughness: 0.85, metalness: 0.0 });
  const sneaker = new THREE.MeshStandardMaterial({ color: darkKnit ? 0x1a1b20 : 0xe6e4df, roughness: 0.6, metalness: 0.0 });
  const sole = new THREE.MeshStandardMaterial({ color: darkKnit ? 0x121316 : 0x1c1c1e, roughness: 0.7, metalness: 0.0 });
  const soleLine = new THREE.MeshStandardMaterial({ color: 0xd8d5cd, roughness: 0.5, metalness: 0.0 });

  /* ----- helpers ----- */
  const roundedRect = (x, y, w, h, r) => {
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
  };
  /* bulk: parts that widen with setBulk. Each entry: object, base scale, gain per unit bulk. */
  const bulkParts = [];
  let bulkT = 0, bulkAmt = 0;
  function setBulk(v) { bulkT = Math.min(Math.max(+v || 0, 0), 1); }
  const bulkPart = (o, gx, gy, gz) => { bulkParts.push({ o, bx: o.scale.x, by: o.scale.y, bz: o.scale.z, gx, gy, gz }); return o; };
  const J = {};
  const jointOf = (name, parent, x, y, z) => {
    const g = new THREE.Group();
    g.name = 'j-' + name;
    g.position.set(x, y, z);
    parent.add(g);
    J[name] = g;
    return g;
  };

  /* ----- the set. Local origin at the set centre, front face at z 0. ----- */
  const head = new THREE.Group();
  head.name = 'crt-head';
  J.head = head;
  const SET_W = 0.56, SET_H = 0.58, SET_D = 0.40;
  const RIM = 0.034, INNER = 0.045;
  const GL_W = SET_W - 2 * (RIM + INNER) + 0.02, GL_H = SET_H - 2 * (RIM + INNER) - 0.02;   /* 0.42 x 0.40 */
  const GL_Y = 0.03;                                                                     /* glass sits high */
  const SCR_W = GL_W + 0.02, SCR_H = GL_H + 0.02;

  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(SET_W - 0.04, SET_H - 0.04, SET_D), cabinetMat);
  cabinet.position.z = -SET_D / 2;
  head.add(cabinet);

  /* silver front frame, proud of the cabinet, bevel step on the front. Two materials:
     faces silver, extrude sides the warm grey underside. */
  const rimShape = roundedRect(-SET_W / 2, -SET_H / 2, SET_W, SET_H, 0.075);
  rimShape.holes.push(roundedRect(-SET_W / 2 + RIM, -SET_H / 2 + RIM + 0.012, SET_W - 2 * RIM, SET_H - 2 * RIM, 0.06));
  const rimGeo = new THREE.ExtrudeGeometry(rimShape, {
    depth: 0.05, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.012, bevelSegments: 4, curveSegments: 12,
  });
  const rim = new THREE.Mesh(rimGeo, [silver, silverUnder]);
  rim.position.z = 0.0;
  head.add(rim);
  bulkPart(rim, 0.045, 0.045, 0);

  /* dark inner frame, recessed a step behind the silver */
  const innerShape = roundedRect(-SET_W / 2 + RIM - 0.004, -SET_H / 2 + RIM + 0.008, SET_W - 2 * RIM + 0.008, SET_H - 2 * RIM + 0.008, 0.06);
  innerShape.holes.push(roundedRect(-GL_W / 2, GL_Y - GL_H / 2, GL_W, GL_H, 0.05));
  const inner = new THREE.Mesh(new THREE.ExtrudeGeometry(innerShape, { depth: 0.032, bevelEnabled: false, curveSegments: 12 }), innerFrame);
  inner.position.z = 0.004;
  head.add(inner);
  bulkPart(inner, 0.03, 0.03, 0);

  /* the glass: a plane bulged into a dome */
  const SEG = 30;
  const glassGeo = new THREE.PlaneGeometry(SCR_W, SCR_H, SEG, SEG);
  {
    const p = glassGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) / (SCR_W / 2);
      const y = p.getY(i) / (SCR_H / 2);
      const r2 = Math.min(x * x + y * y, 1.0);
      p.setZ(i, 0.052 * (1.0 - r2 * 0.85));
    }
    glassGeo.computeVertexNormals();
  }
  const glyphTex = glyphTexture(THREE);
  const black = blackTexture(THREE);
  const screenU = {
    uMap: { value: glyphTex },
    uTime: { value: 0 },
    uAccent: { value: accent.clone() },
    uTexAspect: { value: 512 / 480 },
    uScreenAspect: { value: SCR_W / SCR_H },
    uHasFace: { value: 0 },
    uPic: { value: 0 },
    uEyes: { value: 1 },
    uEyeL: { value: new THREE.Vector4(0.33, 0.52, 0.135, 0) },
    uEyeR: { value: new THREE.Vector4(0.67, 0.52, 0.150, 0) },
    uBlink: { value: 0 },
    uIntent: { value: 0 },
    uSnow: { value: 0 },
    uOff: { value: 0 },
    uRoll: { value: 0 },
    uPointer: { value: new THREE.Vector2(0.5, 0.5) },
    uHover: { value: 0 },
    uFlash: { value: 0 },
    uJump: { value: new THREE.Vector2(0, 0) },
  };
  const screenMat = new THREE.ShaderMaterial({ uniforms: screenU, vertexShader: SCREEN_VERT, fragmentShader: SCREEN_FRAG });
  const screen = new THREE.Mesh(glassGeo, screenMat);
  screen.name = 'crt-glass';
  screen.position.set(0, GL_Y, 0.008);
  head.add(screen);

  /* phosphor bleed onto the inner frame */
  const glowU = { uColor: { value: new THREE.Color(0x9aa0a6) }, uAlpha: { value: 0.10 } };
  const glowMat = new THREE.ShaderMaterial({
    uniforms: glowU, vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(SCR_W * 1.09, SCR_H * 1.09), glowMat);
  glow.position.set(0, GL_Y, 0.075);
  glow.renderOrder = 10;
  head.add(glow);

  /* six indicator dots along the bottom right of the silver rim, the first one lit */
  const dots = [];
  const dotOnMat = new THREE.MeshStandardMaterial({ color: 0x101010, emissive: accent.clone(), emissiveIntensity: 1.6 });
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.005, 12), i === 0 ? dotOnMat : dotOff.clone());
    m.rotation.x = Math.PI / 2;
    m.position.set(SET_W / 2 - RIM - 0.19 + i * 0.027, -SET_H / 2 + RIM + 0.020, 0.052);
    head.add(m);
    dots.push(m);
  }

  /* junction box on the set's left flank, and a small port at the bottom right */
  const jbox = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.11, 0.09), rubber);
  jbox.position.set(-SET_W / 2 + 0.005, -0.02, -0.16);
  head.add(jbox);
  const jport = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.05), rubber);
  jport.position.set(SET_W / 2 - 0.10, -SET_H / 2 + 0.005, -0.10);
  head.add(jport);

  /* the screen is a light on the collar and the shoulders; the tube is mostly black so it is soft */
  const light = new THREE.PointLight(0xbfc6cc, 1.2, 3.0, 2);
  light.position.set(0, GL_Y - 0.05, 0.42);
  head.add(light);

  /* ----- body ----- */
  const body = new THREE.Group();
  body.name = 'crt-body';
  body.position.y = full ? 0 : 0.01;   /* chest-up: set centre lands at y 0.96 */
  tum.add(body);

  const pelvis = jointOf('pelvis', body, 0, 0, 0);
  const spine = jointOf('spine', pelvis, 0, 0.05, 0);

  /* torso: a slim knit top, sloping shoulders into the turtleneck. Spine-local. */
  const tProfile = [
    [0.170, -0.14], [0.172, 0.02], [0.180, 0.18], [0.195, 0.31], [0.212, 0.38],
    [0.220, 0.425], [0.212, 0.455], [0.180, 0.48], [0.135, 0.50], [0.105, 0.515],
    [0.092, 0.53], [0.088, 0.56],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const torso = new THREE.Mesh(new THREE.LatheGeometry(tProfile, 44), knit);
  torso.scale.set(1.36, 1, 0.56);
  bulkPart(torso, 0.25, 0, 0.25);
  spine.add(torso);
  /* high ribbed collar the set sits into */
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.094, 0.14, 32, 1, true), knit);
  collar.position.set(0, 0.575, 0);
  spine.add(collar);
  bulkPart(collar, 0.15, 0, 0.15);
  const collarTop = new THREE.Mesh(new THREE.TorusGeometry(0.084, 0.012, 8, 32), knit);
  collarTop.rotation.x = Math.PI / 2;
  collarTop.position.set(0, 0.645, 0);
  spine.add(collarTop);
  /* the neck, a sliver of it shows between collar and set */
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.072, 0.14, 24), skin);
  neck.position.set(0, 0.62, 0);
  spine.add(neck);
  bulkPart(neck, 0.15, 0, 0.15);

  /* the set: centre at spine-local 0.90 (world 0.95 full, 0.96 chest-up) */
  head.position.set(0, 0.90, 0.15);   /* forward, so the collar sits inside the cabinet behind the frame */
  spine.add(head);
  bulkPart(head, 0.2, 0.2, 0.2);

  /* arms: shoulder, upper arm, elbow, forearm, hand */
  const hands = {};
  const handMeshes = [];
  const shoulderJoints = [];
  for (const sgn of [-1, 1]) {
    const side = sgn > 0 ? 'R' : 'L';
    const sh = jointOf('shoulder' + side, spine, sgn * 0.245, 0.44, 0);
    shoulderJoints.push([sh, sgn * 0.245]);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.058, 16, 12), knit);
    cap.position.set(-sgn * 0.01, -0.02, 0);
    sh.add(cap);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.18, 6, 16), knit);
    upper.position.set(0, -0.15, 0);
    sh.add(upper);
    bulkPart(upper, 0.35, 0, 0.35);
    bulkPart(cap, 0.3, 0.3, 0.3);
    const el = jointOf('elbow' + side, sh, 0, -0.30, 0);
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.047, 0.16, 6, 16), knit);
    fore.position.set(0, -0.12, 0);
    el.add(fore);
    bulkPart(fore, 0.2, 0, 0.2);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), skin);
    hand.scale.set(0.8, 1.25, 0.5);
    hand.position.set(0, -0.27, 0.01);
    el.add(hand);
    hands[side] = el;
    handMeshes.push(hand);
  }

  /* legs, trousers and sneakers. Full variant only. */
  const shoes = [];
  if (full) {
    for (const sgn of [-1, 1]) {
      const side = sgn > 0 ? 'R' : 'L';
      const hip = jointOf('hip' + side, pelvis, sgn * 0.10, -0.03, 0);
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.076, 0.30, 6, 16), trouser);
      thigh.position.set(0, -0.22, 0);
      hip.add(thigh);
      bulkPart(thigh, 0.35, 0, 0.35);
      const kn = jointOf('knee' + side, hip, 0, -0.44, 0);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.060, 0.28, 6, 16), trouser);
      shin.position.set(0, -0.20, 0);
      kn.add(shin);
      bulkPart(shin, 0.2, 0, 0.2);
      const shoe = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.14, 6, 16), sneaker);
      shoe.rotation.x = Math.PI / 2;
      shoe.scale.set(1.3, 1, 1);
      shoe.position.set(0, -0.43, 0.04);
      kn.add(shoe);
      const soleM = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.25), sole);
      soleM.position.set(0, -0.48, 0.04);
      kn.add(soleM);
      /* a thin light line where the sole meets the upper */
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.146, 0.006, 0.256), soleLine);
      line.position.set(0, -0.468, 0.04);
      kn.add(line);
      shoes.push(shoe, soleM, line);
      bulkPart(shoe, 0.3, 0.1, 0.05); bulkPart(soleM, 0.3, 0, 0.05); bulkPart(line, 0.3, 0, 0.05);
    }
  }
  /* a little hip block so the trousers meet the knit */
  if (full) {
    const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.06, 6, 20), trouser);
    hips.scale.set(1.15, 1, 0.62);
    hips.position.set(0, -0.06, 0);
    pelvis.add(hips);
    bulkPart(hips, 0.25, 0, 0.25);
  }

  /* ----- cables: from the junction box and the bottom-right port into the collar.
     Built in spine space; the head end follows head.matrix, the mid points sag and sway. ----- */
  const cables = [];
  const collarEnd = (ang, r, y) => new THREE.Vector3(Math.sin(ang) * r, y, Math.cos(ang) * r);
  const cableDefs = [
    /* [head-space start, spine-space end, sag, bulge x, bulge z] */
    [new THREE.Vector3(-SET_W / 2 - 0.02, 0.02, -0.14), collarEnd(-1.2, 0.10, 0.62), 0.30, -0.10, 0.05],
    [new THREE.Vector3(-SET_W / 2 - 0.02, -0.01, -0.18), collarEnd(-0.7, 0.10, 0.61), 0.40, -0.14, 0.09],
    [new THREE.Vector3(-SET_W / 2 - 0.02, -0.04, -0.12), collarEnd(-2.0, 0.10, 0.62), 0.34, -0.11, -0.08],
    [new THREE.Vector3(-SET_W / 2 - 0.02, -0.06, -0.16), collarEnd(-0.3, 0.10, 0.60), 0.48, -0.17, 0.12],
    [new THREE.Vector3(-SET_W / 2 - 0.02, 0.00, -0.20), collarEnd(-2.6, 0.10, 0.62), 0.24, -0.07, -0.14],
    [new THREE.Vector3(SET_W / 2 - 0.10, -SET_H / 2 - 0.01, -0.10), collarEnd(0.8, 0.10, 0.61), 0.26, 0.09, 0.07],
    [new THREE.Vector3(SET_W / 2 - 0.08, -SET_H / 2 - 0.01, -0.13), collarEnd(1.6, 0.10, 0.62), 0.34, 0.14, -0.02],
  ];
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
  const sway = new THREE.Vector3();
  for (const [start, end, sag, bx, bz] of cableDefs) {
    const pts = [];
    for (let i = 0; i < 7; i++) pts.push(new THREE.Vector3());
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.6);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.010, 6, false), cableMat);
    mesh.frustumCulled = false;
    spine.add(mesh);
    cables.push({ start, end, sag, bx, bz, pts, curve, mesh });
  }
  function layCables() {
    head.updateMatrix();
    for (const c of cables) {
      _v.copy(c.start).applyMatrix4(head.matrix);          /* head end, in spine space */
      const p = c.pts;
      for (let i = 0; i < 7; i++) {
        const f = i / 6;
        const s = Math.sin(f * Math.PI);
        _v2.lerpVectors(_v, c.end, f);
        _v2.y -= c.sag * s;
        _v2.x += c.bx * s + sway.x * s * (1 - f * 0.5);
        _v2.z += c.bz * s + sway.z * s;
        p[i].copy(_v2);
      }
      /* the curve caches its arc lengths; without this every rebuild maps onto the stale table */
      c.curve.needsUpdate = true;
      const old = c.mesh.geometry;
      c.mesh.geometry = new THREE.TubeGeometry(c.curve, 40, 0.010 * (1 + 0.5 * bulkAmt), 6, false);
      old.dispose();
    }
  }

  /* ----- boosters, full only ----- */
  const plumes = [];
  const thrustT = { main: 0, left: 0, right: 0, up: 0, down: 0, retro: 0 };
  const thrust = { main: 0, left: 0, right: 0, up: 0, down: 0, retro: 0 };
  const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (full) {
    const warm = new THREE.Color(0xffd8bc);
    const plumeCol = accent.clone().lerp(new THREE.Color(0xffffff), 0.35);
    const retroCol = accent.clone().lerp(warm, 0.75);
    const streakTex = streakTexture(THREE);
    const plumeGeo = new THREE.ConeGeometry(1, 1, 18, 1, true);
    plumeGeo.rotateX(Math.PI);
    plumeGeo.translate(0, -0.5, 0);
    const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.4, metalness: 0.7 });
    const _dn = new THREE.Vector3(0, -1, 0);
    const addPlume = (channel, parent, x, y, z, dir, len, rad, o = {}) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.quaternion.setFromUnitVectors(_dn, dir.clone().normalize());
      parent.add(g);
      const col = o.color || plumeCol;
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.8, rad * 1.05, rad * 1.2, 14), nozzleMat);
      nozzle.position.y = rad * 0.3;
      g.add(nozzle);
      const outer = new THREE.Mesh(plumeGeo, new THREE.MeshBasicMaterial({
        color: col, transparent: true, opacity: 0.20, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      outer.renderOrder = 20;
      g.add(outer);
      const core = new THREE.Mesh(plumeGeo, new THREE.MeshBasicMaterial({
        color: col.clone().lerp(new THREE.Color(0xffffff), 0.7), transparent: true, opacity: 0.45,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      core.renderOrder = 21;
      g.add(core);
      const pl = { channel, g, outer, core, len, rad, light: null, sparks: null, sparkPos: null, sparkHash: null, streak: null };
      if (o.streak) {
        /* a faint accent light streak, two crossed additive planes 3 units long behind the boot */
        const sg2 = new THREE.PlaneGeometry(1, 1);
        sg2.translate(0, -0.5, 0);
        const streak = new THREE.Group();
        for (let k = 0; k < 2; k++) {
          const m = new THREE.Mesh(sg2, new THREE.MeshBasicMaterial({
            map: streakTex, color: accent.clone().lerp(new THREE.Color(0xffffff), 0.2), transparent: true, opacity: 0.0,
            blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
          }));
          m.rotation.y = k * Math.PI / 2;
          m.scale.set(0.16, 3.0, 1);
          streak.add(m);
        }
        streak.visible = false;
        streak.renderOrder = 19;
        g.add(streak);
        pl.streak = streak;
      }
      if (o.light) {
        pl.light = new THREE.PointLight(col, 0, 2, 2);
        pl.light.position.y = -0.35;
        g.add(pl.light);
      }
      if (o.sparks) {
        const n = 24;
        pl.sparkPos = new Float32Array(n * 3);
        pl.sparkHash = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) {
          pl.sparkHash[i * 2] = (Math.sin(i * 12.9898) * 43758.5453) % 1 * 0.5 + 0.5;
          pl.sparkHash[i * 2 + 1] = (Math.sin(i * 78.233) * 43758.5453) % 1 * 0.5 + 0.5;
        }
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.BufferAttribute(pl.sparkPos, 3));
        pl.sparks = new THREE.Points(sg, new THREE.PointsMaterial({
          color: col.clone().lerp(new THREE.Color(0xffffff), 0.5), size: 0.03, sizeAttenuation: true,
          transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        pl.sparks.renderOrder = 22;
        pl.sparks.visible = false;
        g.add(pl.sparks);
      }
      outer.visible = core.visible = false;
      plumes.push(pl);
      return pl;
    };
    const F = new THREE.Vector3(0, 0, 1);
    const U = new THREE.Vector3(0, 1, 0), D = new THREE.Vector3(0, -1, 0);
    const Rt = new THREE.Vector3(1, 0, 0), Lf = new THREE.Vector3(-1, 0, 0);
    /* mains from the sneaker soles, splayed 8 deg */
    const SPLAY = 8 * D2R;
    addPlume('main', J.kneeL, 0, -0.49, 0.02, new THREE.Vector3(-Math.sin(SPLAY), -Math.cos(SPLAY), 0), 1.76, 0.055, { light: true, sparks: true, streak: true });
    addPlume('main', J.kneeR, 0, -0.49, 0.02, new THREE.Vector3(Math.sin(SPLAY), -Math.cos(SPLAY), 0), 1.76, 0.055, { light: true, sparks: true, streak: true });
    /* side puffers at the hips: left thrust fires from the right hip */
    addPlume('left', pelvis, 0.19, -0.05, 0, Rt, 0.3, 0.028);
    addPlume('right', pelvis, -0.19, -0.05, 0, Lf, 0.3, 0.028);
    /* up: down from the hips. down: up from the shoulders. */
    addPlume('up', pelvis, -0.13, -0.10, -0.06, D, 0.3, 0.03);
    addPlume('up', pelvis, 0.13, -0.10, -0.06, D, 0.3, 0.03);
    addPlume('down', spine, -0.20, 0.47, -0.02, U, 0.3, 0.028);
    addPlume('down', spine, 0.20, 0.47, -0.02, U, 0.3, 0.028);
    /* retro: from the palms, forward, warmer. Children of the elbows so they follow the pose. */
    addPlume('retro', hands.R, 0, -0.27, 0.04, F, 0.45, 0.032, { color: retroCol });
    addPlume('retro', hands.L, 0, -0.27, 0.04, F, 0.45, 0.032, { color: retroCol });
  }

  /* ----- poses: joint rotation targets, Euler XYZ. Limbs hang along -y:
     -x swings forward, +x back, +z toward +x. Functions take the side sign. ----- */
  const POSES = {
    /* stand: weight on the feet, shoulders squared, a 4 deg lean with the set kept level */
    stand: { spine: [0.07, 0, 0], head: [-0.07, 0, 0],
      shoulder: s => [0.02, 0, s * 0.06], elbow: s => [-0.12, 0, s * 0.02],
      hip: s => [-0.02, 0, s * (0.12 + 0.10 * bulkAmt)], knee: s => [0.04, 0, 0] },
    /* fall is a dive: straight as an arrow, arms swept back along the thighs with the palms
       turned back, legs together, the set pitched 12 deg into the direction of travel */
    fall:  { spine: [0.0, 0, 0], head: [0.21, 0, 0],
      shoulder: s => [0.42, 0, s * 0.04], elbow: s => [0.04, Math.PI, 0],
      hip: s => [0.0, 0, -s * 0.02], knee: s => [0.0, 0, 0] },
    /* brake: the wide star with tension, arms straight, set pitched up 10 deg */
    brake: { spine: [0.25, 0, 0], head: [-0.175, 0, 0],
      shoulder: s => [0.10, s * 0.30, s * 1.40], elbow: s => [0.0, 0, s * 0.05],
      hip: s => [0.28, 0, s * 0.60], knee: s => [0.75, 0, 0] },
    /* brace: the touchdown crouch, knees bent 55 deg, arms out low, set pitched down 8 deg */
    brace: { spine: [0.15, 0, 0], head: [0.14, 0, 0],
      shoulder: s => [0.10, 0, s * 0.60], elbow: s => [-0.20, 0, s * 0.05],
      hip: s => [-0.60, 0, s * 0.10], knee: s => [0.96, 0, 0] },
    tuck:  { spine: [-0.40, 0, 0], head: [-0.35, 0, 0],
      shoulder: s => [-1.30, 0, -s * 0.25], elbow: s => [-1.10, 0, s * 0.35],
      hip: s => [-1.75, 0, s * 0.18], knee: s => [2.25, 0, 0] },
  };
  const poseW = { stand: full ? 0 : 1, fall: full ? 1 : 0, brake: 0, tuck: 0, brace: 0 };
  const JOINT_K = 15, HEAD_K = 14;
  const jointNames = ['spine', 'head', 'shoulderR', 'shoulderL', 'elbowR', 'elbowL', 'hipR', 'hipL', 'kneeR', 'kneeL'];
  const JS = {};
  for (const n of jointNames) JS[n] = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  const _jt = [0, 0, 0];
  const jointTarget = (n, out) => {
    out[0] = out[1] = out[2] = 0;
    const base = n.replace(/[RL]$/, '');
    const sgn = n.endsWith('L') ? -1 : 1;
    for (const k in poseW) {
      const w = poseW[k];
      if (w <= 0) continue;
      const def = POSES[k][base];
      const v = typeof def === 'function' ? def(sgn) : def;
      out[0] += w * v[0]; out[1] += w * v[1]; out[2] += w * v[2];
    }
    return out;
  };
  function setPose(name, blend) {
    if (!POSES[name]) return;
    const b = blend == null ? 1 : Math.min(Math.max(+blend || 0, 0), 1);
    for (const k in poseW) poseW[k] *= 1 - b;
    poseW[name] += b;
  }

  /* ----- landing and grounded idle ----- */
  let landT = Infinity, landS = 0, landStood = false;
  let chaseT = Infinity;
  let groundedOn = false, groundedAmt = 0;
  function land(strength) {
    landS = strength == null ? 1 : Math.min(Math.max(+strength || 0, 0), 1);
    landT = 0;
    landStood = false;
    if (REDUCED) { setPose('stand', 1); landT = Infinity; return; }
    setPose('brace', 1);
  }
  function setGrounded(on) { groundedOn = !!on; }

  /* ----- tumble and facing on tum ----- */
  let tumbleAmt = 1, tumbleW = 0, tumbleWv = 0;
  const TUMBLE_A = 9 * D2R;
  let facing = null;
  const facingQ = new THREE.Quaternion();
  const tumQ = new THREE.Quaternion();
  const tumW = new THREE.Vector3();
  const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _v3 = new THREE.Vector3();
  const FACE_K = 6;
  const springQuat = (cur, target, w, K, dt) => {
    _q1.copy(target).multiply(_q2.copy(cur).invert());
    if (_q1.w < 0) _q1.set(-_q1.x, -_q1.y, -_q1.z, -_q1.w);
    const cw = Math.min(1, _q1.w);
    const ang = 2 * Math.acos(cw);
    const sn = Math.sqrt(Math.max(0, 1 - cw * cw));
    if (sn > 1e-6) _v3.set(_q1.x / sn, _q1.y / sn, _q1.z / sn).multiplyScalar(ang); else _v3.set(0, 0, 0);
    const C = 2 * Math.sqrt(K);
    w.x += (K * _v3.x - C * w.x) * dt;
    w.y += (K * _v3.y - C * w.y) * dt;
    w.z += (K * _v3.z - C * w.z) * dt;
    const wl = w.length() * dt;
    if (wl > 1e-9) { _q1.setFromAxisAngle(_v3.copy(w).normalize(), wl); cur.premultiply(_q1).normalize(); }
  };
  function setTumble(a) { tumbleAmt = Math.min(Math.max(+a || 0, 0), 1); }
  function setFacing(q) {
    if (q && typeof q.w === 'number') { facing = true; facingQ.copy(q).normalize(); }
    else facing = null;
  }

  /* ----- screen modes ----- */
  let screenMode = 'eyes';
  let showGlyph = false;            /* inside the eyes cycle */
  let nextSwap = 9, fadeT = Infinity, fadeSwapped = true;
  let picW = 0, eyesW = 1, snowAmt = 0, offAmt = 0;
  let faceTex = null, faceAspectKnown = true, faceAspect = 1;
  const faceAvg = new THREE.Color(0x8a8a90);
  const tmp = new THREE.Color();
  const glowColor = new THREE.Color();
  function setScreen(mode) {
    if (mode === 'eyes' || mode === 'glyph' || mode === 'static' || mode === 'off' || mode === 'face') screenMode = mode;
    if (mode === 'eyes') showGlyph = false;
  }
  function setFace(texture) {
    if (!texture) { faceTex = null; faceAspectKnown = true; return; }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    faceTex = texture;
    const img = texture.image;
    const aw = img && (img.naturalWidth || img.videoWidth || img.width);
    const ah = img && (img.naturalHeight || img.videoHeight || img.height);
    faceAspectKnown = aw > 0 && ah > 0;
    faceAspect = faceAspectKnown ? aw / ah : 1;
    if (averageColor(THREE, texture, faceAvg)) faceAvg.lerp(tmp.set(0x2a4a8a), 0.25);
  }

  /* eyes: blink and squint timers, offset that follows the pointer at once */
  let nextBlink = 3.5, blinkT = Infinity;
  let intentT = 0, intentAmt = 0;
  function setIntent(v) { intentT = Math.min(Math.max(+v || 0, 0), 1); }
  let nextSquint = 7, squintT = Infinity, squintEye = 0;
  const eyeOff = { x: 0, y: 0 };

  /* ----- look, hover, poke ----- */
  const YAW_MAX = 26 * D2R, PITCH_MAX = 14 * D2R;
  const HEAD_SHARE = 0.75;
  let lookK = 14, lookC = 2 * Math.sqrt(14);
  const look = { yaw: 0, pitch: 0, vy: 0, vp: 0, tx: 0, ty: 0, nx: 0, ny: 0, last: -Infinity };
  const shift = { x: 0, v: 0, recoil: 0, rv: 0 };
  let hoverOn = false, hoverAmt = 0;
  let pokeT = Infinity, pokeS = 0, lastPokeMs = -Infinity, stiffUntil = -Infinity;
  /* chaseT is declared with the landing state above */
  let rollExtra = 0;
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function lookAt(nx, ny) {
    const cx = Math.min(Math.max(+nx || 0, -1), 1);
    const cy = Math.min(Math.max(+ny || 0, -1), 1);
    look.nx = cx; look.ny = cy;
    look.tx = cx * YAW_MAX;
    look.ty = -cy * PITCH_MAX;
    look.last = nowMs();
  }
  function setPointer(u, v) {
    screenU.uPointer.value.set(Math.min(Math.max(+u || 0, 0), 1), Math.min(Math.max(+v || 0, 0), 1));
  }
  function hover(on) { hoverOn = !!on; }
  function poke(strength) {
    const ms = nowMs();
    if (ms - lastPokeMs < 200) return;
    lastPokeMs = ms;
    pokeS = strength == null ? 1 : Math.min(Math.max(+strength || 0, 0), 1);
    pokeT = 0;
    chaseT = 0;
    stiffUntil = ms + 300;
    /* the body recoils away from the pointer side */
    const side = look.nx > 0.02 ? 1 : look.nx < -0.02 ? -1 : 1;
    shift.recoil = -0.06 * side * pokeS;
    shift.rv = 0;
    look.last = ms;
  }

  /* ----- thrust, tint, scale ----- */
  function setThrust(v) {
    v = v || {};
    for (const k in thrustT) thrustT[k] = Math.min(Math.max(+v[k] || 0, 0), 1);
  }
  const tintMats = [knit, trouser];
  function setSuitTint(hex) {
    const ok = typeof hex === 'string' && /^#[0-9a-f]{3,8}$/i.test(hex);
    for (const m of tintMats) {
      if (ok) { m.emissive.set(hex); m.emissiveIntensity = 0.22; }
      else if (m === knit) { m.emissive.copy(knitColor); m.emissiveIntensity = 0.04; }
      else { m.emissive.set(0x000000); m.emissiveIntensity = 1; }
    }
  }
  /* rim: a directional from behind-above, parented to rig, off until the page sets it */
  const rimLight = new THREE.DirectionalLight(0xffffff, 0);
  rimLight.position.set(0.7, 2.2, -2.0);
  rimLight.target.position.set(0, 0.5, 0);
  rig.add(rimLight);
  rig.add(rimLight.target);
  let rimBase = 0;
  function setRim(intensity, hex) {
    rimBase = Math.max(+intensity || 0, 0) * 8;   /* the charcoal knit needs it: 1 reads as a clear rim */
    if (typeof hex === 'string' && /^#[0-9a-f]{3,8}$/i.test(hex)) rimLight.color.set(hex);
  }
  let lightScale = 1;
  function setScale(sc) {
    const v = Math.max(+sc || 0, 1e-4);
    group.scale.setScalar(v);
    lightScale = v;
  }

  /* ----- drift state ----- */
  const rot = { x: 0, y: 0, z: 0 };
  const vel = { x: 0, y: 0, z: 0 };
  const W = 1.3;
  let frame = 0;
  let prevYaw = 0, prevPitch = 0;

  function update(dt, t) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    t = t || 0;
    frame++;
    const ms = nowMs();

    /* drift: sums of incommensurate sines through a damped spring */
    const target = {
      x: 0.06 * Math.sin(t * TAU / 7.3) + 0.025 * Math.sin(t * TAU / 17.9 + 1.3),
      y: 0.10 * Math.sin(t * TAU / 11.1 + 0.7) + 0.035 * Math.sin(t * TAU / 23.3 + 2.4),
      z: 0.02 * Math.sin(t * TAU / 13.7 + 2.1) + 0.008 * Math.sin(t * TAU / 29.0),
    };
    for (const k of ['x', 'y', 'z']) {
      const a = -2 * W * vel[k] - W * W * (rot[k] - target[k]);
      vel[k] += a * dt;
      rot[k] += vel[k] * dt;
    }
    groundedAmt += ((groundedOn ? 1 : 0) - groundedAmt) * Math.min(1, dt / 0.5);
    const zeroG = 1 - groundedAmt;

    /* landing timeline: brace at once, impact at 180 ms, rise into stand from 320 ms, settle */
    let squash = 0, settle = 0, impactNow = false;
    if (landT !== Infinity) {
      const prev = landT;
      landT += dt;
      if (prev < 0.18 && landT >= 0.18) { impactNow = true; chaseT = 0; blinkT = 0; sway.z -= 0.10 * landS; sway.x += 0.05 * landS; }
      if (landT >= 0.32 && !landStood) { landStood = true; setPose('stand', 1); }
      const tau = landT - 0.18;
      if (tau >= 0) {
        squash = (tau < 0.04 ? tau / 0.04 : Math.exp(-(tau - 0.04) * 8) * Math.cos((tau - 0.04) * TAU / 0.2)) * landS;
        settle = Math.exp(-tau * 2.2) * (Math.sin(tau * TAU / 0.9) + 0.6 * Math.sin(tau * TAU / 1.4)) * landS;
      }
      if (landT > 3.0) landT = Infinity;
    }
    rig.rotation.set(rot.x, rot.y, rot.z + 0.022 * settle);
    rig.scale.set(1 + 0.03 * squash, 1 - 0.06 * squash, 1 + 0.03 * squash);
    /* breathing: the zero-g bob fades out when grounded, a weight shift takes over */
    rig.position.y = zeroG * (0.010 * Math.sin(t * TAU / 5.3) + 0.006 * Math.sin(t * TAU / 8.9 + 1.0)) + 0.012 * settle;
    J.pelvis.rotation.z = groundedAmt * 1.5 * D2R * Math.sin(t * TAU / 5.3);

    /* look: the spring, stiffer for 300 ms after a poke */
    const looking = ms - look.last < 1500;
    const wantK = ms < stiffUntil ? 40 : 14;
    if (wantK !== lookK) { lookK = wantK; lookC = 2 * Math.sqrt(lookK); }
    const ty = looking ? look.tx : 0, tp = looking ? look.ty : 0;
    look.vy += (-lookK * (look.yaw - ty) - lookC * look.vy) * dt; look.yaw += look.vy * dt;
    look.vp += (-lookK * (look.pitch - tp) - lookC * look.vp) * dt; look.pitch += look.vp * dt;
    /* parallax shift of the whole rig toward the pointer side, plus the poke recoil */
    const sx = looking ? 0.12 * look.nx : 0;
    shift.v += (-9 * (shift.x - sx) - 6 * shift.v) * dt; shift.x += shift.v * dt;
    shift.rv += (-14 * shift.recoil - 2 * Math.sqrt(14) * shift.rv) * dt; shift.recoil += shift.rv * dt;
    rig.position.x = shift.x + shift.recoil + 0.004 * Math.sin(t * TAU / 9.7 + 0.4);
    /* eyes lead: they slide at once */
    const exT = looking ? 0.12 * look.nx : 0, eyT = looking ? 0.06 * look.ny : 0;
    eyeOff.x += (exT - eyeOff.x) * Math.min(1, dt / 0.06);
    eyeOff.y += (eyT - eyeOff.y) * Math.min(1, dt / 0.06);

    /* tumble or facing on tum */
    const wantTumble = facing ? 0 : tumbleAmt * poseW.fall * zeroG;
    tumbleWv += (-4 * (tumbleW - wantTumble) - 4 * tumbleWv) * dt;
    tumbleW += tumbleWv * dt;
    const tA = TUMBLE_A * tumbleW * Math.sin(t * TAU / 9.7);
    const tB = TUMBLE_A * tumbleW * Math.sin(t * TAU / 15.3 + 1.1);
    const dA = TUMBLE_A * tumbleW * (TAU / 9.7) * Math.cos(t * TAU / 9.7);
    const dB = TUMBLE_A * tumbleW * (TAU / 15.3) * Math.cos(t * TAU / 15.3 + 1.1);
    if (facing) _q2.copy(facingQ); else _q2.setFromEuler(_e.set(tA, 0, tB, 'XYZ'));
    springQuat(tumQ, _q2, tumW, FACE_K, dt);
    tum.quaternion.copy(tumQ);

    /* joints */
    const fw = poseW.fall;
    for (const n of jointNames) {
      const j = JS[n];
      const tg = jointTarget(n, _jt);
      if (fw > 0 && tumbleW > 0.001) {
        const sgn = n.endsWith('L') ? -1 : 1;
        if (n.startsWith('shoulder')) { tg[0] += -0.25 * dA * fw; tg[2] += sgn * 0.12 * dB * fw; }
        else if (n.startsWith('hip')) { tg[0] += -0.17 * dA * fw; tg[2] += sgn * 0.08 * dB * fw; }
        else if (n.startsWith('elbow') || n.startsWith('knee')) { tg[0] += -0.1 * dA * fw; }
        else if (n === 'spine') { tg[0] += -0.06 * dA * fw; tg[2] += 0.05 * dB * fw; }
      }
      /* the brace before a touchdown has to happen in 180 ms, so it runs a much stiffer spring */
      const bracing = landT < 0.32;
      const K = n === 'head' ? (bracing ? 60 : HEAD_K) : (bracing ? 150 : JOINT_K), C = 2 * Math.sqrt(K);
      j.vx += (-K * (j.x - tg[0]) - C * j.vx) * dt; j.x += j.vx * dt;
      j.vy += (-K * (j.y - tg[1]) - C * j.vy) * dt; j.y += j.vy * dt;
      j.vz += (-K * (j.z - tg[2]) - C * j.vz) * dt; j.z += j.vz * dt;
      const g3 = J[n];
      if (g3) g3.rotation.set(j.x, j.y, j.z);
    }
    /* toes point in the dive, fingers spread in the brake */
    const toe = -0.55 * poseW.fall;
    for (const m of shoes) m.rotation.x = Math.PI / 2 * (m.geometry.type === 'CapsuleGeometry' ? 1 : 0) + toe;
    const spread = 1 + 0.15 * poseW.brake;
    for (const m of handMeshes) m.scale.set(0.8 * spread, 1.25 * spread, 0.5);

    /* body takes a quarter of the yaw, the head three quarters plus its own nod and drift */
    J.spine.rotation.y += (1 - HEAD_SHARE) * look.yaw;
    J.spine.rotation.x += groundedAmt * 0.012 * Math.sin(t * TAU / 4.1);
    const nodX = 0.025 * Math.sin(t * TAU / 6.7 + 0.9);
    head.rotation.set(
      nodX + look.pitch + JS.head.x,
      HEAD_SHARE * look.yaw + JS.head.y,
      0.012 * Math.sin(t * TAU / 10.3) + JS.head.z,
    );

    /* bulk: eased over 600 ms, applied to the parts and the shoulder spread */
    const prevBulk = bulkAmt;
    bulkAmt += (bulkT - bulkAmt) * Math.min(1, dt / 0.6);
    if (Math.abs(bulkAmt - prevBulk) > 1e-5 || frame < 3) {
      for (const p of bulkParts) p.o.scale.set(p.bx * (1 + p.gx * bulkAmt), p.by * (1 + p.gy * bulkAmt), p.bz * (1 + p.gz * bulkAmt));
      for (const [sh, bx] of shoulderJoints) sh.position.x = bx * (1 + 0.25 * bulkAmt);
    }

    /* cables: sway from the head's angular velocity with a lag, rebuilt every 3rd frame */
    const yawV = dt > 0 ? (head.rotation.y - prevYaw) / dt : 0;
    const pitchV = dt > 0 ? (head.rotation.x - prevPitch) / dt : 0;
    prevYaw = head.rotation.y; prevPitch = head.rotation.x;
    sway.x += (-yawV * 0.05 - sway.x) * Math.min(1, dt * 5);
    sway.z += (pitchV * 0.03 - sway.z) * Math.min(1, dt * 5);
    if (frame % 3 === 1) layCables();

    /* hover */
    hoverAmt = Math.min(Math.max(hoverAmt + (hoverOn ? dt : -dt) / 0.25, 0), 1);
    const hv = hoverAmt * hoverAmt * (3 - 2 * hoverAmt);
    screenU.uHover.value = hv;
    rollExtra += dt * 0.6 * hv / 6.1;
    screenU.uRoll.value = t / 6.1 + rollExtra;

    /* poke: flash, jump, dot chase */
    pokeT += dt;
    chaseT += dt;
    screenU.uFlash.value = pokeT < 0.04 ? 0.55 * pokeS : 0;
    screenU.uJump.value.set(pokeT < 0.05 ? 2 / 300 : 0, pokeT < 0.05 ? -1 / 300 : 0);
    const chase = chaseT < 0.36 ? Math.floor(chaseT / 0.06) : -1;
    for (let i = 0; i < 6; i++) {
      const on = i === 0 ? chase < 0 || chase === 0 : chase === i;
      dots[i].material = on ? dotOnMat : dots[i].userData.off || (dots[i].userData.off = dotOff.clone());
    }
    if (chase < 0) dots[0].material = dotOnMat;

    /* screen mode weights and the eyes/glyph cycle */
    let wantPic = 0, wantEyes = 0, wantSnow = 0, wantOff = 0;
    if (screenMode === 'eyes') {
      if (t >= nextSwap && fadeT === Infinity) { fadeT = 0; fadeSwapped = false; nextSwap = t + 8 + Math.random() * 6; }
      if (fadeT !== Infinity) {
        fadeT += dt;
        if (!fadeSwapped && fadeT >= 0.15) { showGlyph = !showGlyph; fadeSwapped = true; }
        wantSnow = Math.sin(Math.min(fadeT / 0.3, 1) * Math.PI) * 0.9;
        if (fadeT >= 0.3) fadeT = Infinity;
      }
      wantPic = showGlyph ? 1 : 0; wantEyes = showGlyph ? 0 : 1;
    } else if (screenMode === 'glyph') { wantPic = 1; }
    else if (screenMode === 'face') { wantPic = faceTex ? 1 : 0; wantEyes = faceTex ? 0 : 1; }
    else if (screenMode === 'static') { wantSnow = 1; }
    else if (screenMode === 'off') { wantOff = 1; }
    const useFace = screenMode === 'face' && faceTex;
    const wantMap = useFace ? faceTex : glyphTex;
    if (useFace && !faceAspectKnown) {
      const img = faceTex.image;
      const aw = img && (img.naturalWidth || img.videoWidth || img.width);
      const ah = img && (img.naturalHeight || img.videoHeight || img.height);
      if (aw > 0 && ah > 0) { faceAspect = aw / ah; faceAspectKnown = true; if (averageColor(THREE, faceTex, faceAvg)) faceAvg.lerp(tmp.set(0x2a4a8a), 0.25); }
    }
    screenU.uMap.value = wantMap;
    screenU.uHasFace.value = useFace ? 1 : 0;
    screenU.uTexAspect.value = useFace ? faceAspect : 512 / 480;
    const kf = Math.min(1, dt / 0.12);
    picW += (wantPic - picW) * kf; eyesW += (wantEyes - eyesW) * kf;
    snowAmt += (wantSnow - snowAmt) * Math.min(1, dt / 0.05); offAmt += (wantOff - offAmt) * Math.min(1, dt / 0.33);
    screenU.uPic.value = picW; screenU.uEyes.value = eyesW; screenU.uSnow.value = snowAmt; screenU.uOff.value = offAmt;

    /* eyes: blink together, one squints now and then, both slide with the pointer */
    intentAmt += (intentT - intentAmt) * Math.min(1, dt / 0.3);
    screenU.uIntent.value = intentAmt;
    if (t >= nextBlink) { blinkT = 0; nextBlink = t + (3 + Math.random() * 4) * (1 + 1.2 * intentAmt); }
    let blink = 0;
    if (blinkT !== Infinity) { blinkT += dt; blink = Math.sin(Math.min(blinkT / 0.12, 1) * Math.PI); if (blinkT >= 0.12) blinkT = Infinity; }
    if (t >= nextSquint) { squintT = 0; squintEye = Math.random() < 0.5 ? 0 : 1; nextSquint = t + 6 + Math.random() * 9; }
    let sq = 0;
    if (squintT !== Infinity) { squintT += dt; sq = Math.sin(Math.min(squintT / 1.1, 1) * Math.PI); sq = Math.min(sq * 1.6, 1); if (squintT >= 1.1) squintT = Infinity; }
    screenU.uBlink.value = blink;
    const gap = 0.03 * intentAmt;   /* the eyes slide together as intent rises */
    screenU.uEyeL.value.set(0.33 + gap + eyeOff.x, 0.52 + eyeOff.y, 0.135, squintEye === 0 ? sq * 0.85 : 0);
    screenU.uEyeR.value.set(0.67 - gap + eyeOff.x, 0.52 + eyeOff.y, 0.150, squintEye === 1 ? sq * 0.85 : 0);

    /* screen time and the lights */
    screenU.uTime.value = t;
    const hum = 0.975 + 0.025 * Math.sin(t * 37.0) * Math.sin(t * 23.7);
    /* screen energy: eyes and glyph are white on black, snow is grey, a photo has its average */
    const energy = 0.55 * eyesW + 0.75 * picW * (useFace ? 0.9 : 1) + 0.8 * snowAmt;
    glowColor.set(0xdfe6ea);
    if (useFace) glowColor.lerp(faceAvg, 0.6);
    glowColor.lerp(tmp.copy(accent), 0.10);
    glowU.uColor.value.copy(glowColor);
    glowU.uAlpha.value = 0.08 * energy * hum * (1 - 0.95 * offAmt);
    light.color.copy(glowColor);
    light.intensity = (0.7 + 0.9 * energy) * hum * (1 - 0.95 * offAmt) + (pokeT < 0.04 ? 2 : 0);
    if (landT !== Infinity && landT >= 0.18 && landT < 0.30) {
      /* one stutter of the set light on touchdown */
      const tl = landT - 0.18;
      light.intensity *= 0.55 + 0.45 * Math.abs(Math.cos(tl * 52.0)) * (1 - tl / 0.12) + 0.45 * (tl / 0.12);
    }
    light.distance = 3.0 * lightScale;
    light.intensity *= lightScale * lightScale;
    rimLight.intensity = rimBase;   /* directional: no falloff, nothing to rescale */

    /* boosters */
    if (plumes.length) {
      const k1 = 1 - Math.exp(-dt / 0.09);
      for (const k in thrust) thrust[k] += (thrustT[k] - thrust[k]) * k1;
      const f1 = REDUCED ? 0 : Math.sin(t * TAU * 17.0), f2 = REDUCED ? 0 : Math.sin(t * TAU * 23.0);
      for (const pl of plumes) {
        const a = thrust[pl.channel];
        const on = a > 0.01;
        pl.outer.visible = pl.core.visible = on;
        if (pl.light) { pl.light.intensity = 0.7 * a * lightScale * lightScale; pl.light.distance = 2 * lightScale; }
        if (!on) { if (pl.sparks) pl.sparks.visible = false; continue; }
        const swell = a * a * (3 - 2 * a);
        const lj = 1 + 0.14 * a * (0.5 * f1 + 0.5 * f2);
        const wj = 1 + 0.10 * a * (0.5 * f2 - 0.5 * f1);
        const L = pl.len * (0.25 + 0.75 * swell) * lj;
        const Wd = pl.rad * (0.6 + 0.4 * swell) * wj;
        pl.outer.scale.set(Wd, L, Wd);
        const isMain = pl.channel === 'main';
        pl.core.scale.set(Wd * 0.45, L * (isMain ? 0.55 : 0.4), Wd * 0.45);
        pl.core.material.opacity = isMain ? 0.65 : 0.45;
        pl.outer.material.opacity = 0.20 * (0.5 + 0.5 * a);
        if (pl.streak) {
          const sv = Math.min(Math.max((a - 0.6) / 0.3, 0), 1);
          pl.streak.visible = sv > 0.01;
          for (const m of pl.streak.children) m.material.opacity = 0.22 * sv;
        }
        if (pl.sparks) {
          const show = a > 0.15;
          pl.sparks.visible = show;
          if (show) {
            const P = pl.sparkPos, H = pl.sparkHash;
            for (let i = 0; i < 24; i++) {
              const h0 = H[i * 2], h1 = H[i * 2 + 1];
              const life = ((t * (1.6 + h0 * 1.4) + h1 * 7.0) % 1 + 1) % 1;
              const ang = h1 * TAU + life * 3.0;
              const spread = Wd * (0.3 + 1.4 * life);
              P[i * 3] = Math.cos(ang) * spread;
              P[i * 3 + 1] = -life * L * (isMain ? 2.0 : 1.3);
              P[i * 3 + 2] = Math.sin(ang) * spread;
            }
            pl.sparks.geometry.attributes.position.needsUpdate = true;
          }
        }
      }
    }
  }

  update(0, 0);
  layCables();
  return {
    group, update, setFace, lookAt, hover, poke, glass: screen,
    setPose, setTumble, setScreen, setFacing, setScale,
    setThrust, setSuitTint, setPointer, setIntent, setRim, land, setGrounded, setBulk,
    joints: J, full,
  };
}
