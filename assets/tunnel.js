/* SPACE JUNK tunnel walls.
   Two looks that cross-fade with a colour phase:
     LOOK A "CAGE"  (phase 0..0.45)  square corridor, thin grid lines, ~1500 flickering additive blocks.
     LOOK B "TESSELLATION" (phase 0.5..0.9) octagonal corridor whose walls carry a morphing wireframe tessellation
                          (cube lattice, triangles, 45 degree squares, honeycomb) lit by travelling waves, plus tumbling wireframe solids in the wall band.
   Walls are BACKGROUND: thin lines, low fill, black core, nothing in the corridor volume.
   Everything recycles along z so the tunnel is infinite. The camera moves toward -Z.

   Public API:
     import {makeTunnel} from './assets/tunnel.js';
     const tunnel = makeTunnel(THREE, opts);       // opts: {slow, reduced, fogDensity}  fogDensity must match scene.fog
     scene.add(tunnel.group);
     tunnel.update({camZ, v, sp, phase, dt, slow, reduced, viewportHeight, open, levels});
       // viewportHeight = renderer.domElement.height (glint sizing); open 0..1 fades the walls out at the end of the fall
       // v may be negative (scrolling back); recycling works both ways, stretch uses |v|
       // levels (optional) = {bass, mid, high, rms, beat} all 0..1; absent = no audio reaction
     tunnel.kick(strength);          // fire a one-shot block ripple ahead of the camera (strength 0..1)
     tunnel.setMirror(zStart);       // place the 420-unit mirror room starting at world z = zStart (null removes it). OFF unless called.
     tunnel.nextPattern();           // start a tessellation morph now (page rate-limits this on strong beats)
     tunnel.setPattern(i, holdSecs); // jump to pattern i (0..9); optional hold override
     tunnel.setDim(d);               // 0..1, pulls the whole lattice down while a logo is near the camera
     tunnel.setBeatMorph(on, gap);   // beats above 0.85 change the universe, at most once per gap seconds (default off)
     tunnel.inverse                  // 0..1 current weight of the 'inverse' look; page drops bloom/RGB shift and inverts its chrome above 0.5
     tunnel.runLog()                 // dealt universes so far: [{pattern, pair}]
     tunnel.setMemories([{texture, kind: 'video' | 'photo'}, ...])   // memory look panels; empty = NO SIGNAL cards; max 12 textures live
     tunnel.plungeStage(name, cutSecs)   // plunge cut list: cubes | lattice | stairs | inverse | rings | shards | cubes-wave | collapse; hard cut by default
     tunnel.deal()                   // plunge: morph every solid to the next shape (180 ms) and snap the colour pair from the deck
     tunnel.impact(strength)         // landing: floor ring 0 -> 90 units over 700 ms, grid brightens with a damped bounce
     tunnel.landingY()               // -12, the floor height
     tunnel.setBend({ax, lx, ay, ly, py}, easeSecs)   // curve the corridor: offset(z) = (ax sin(z/lx), ay sin(z/ly + py)); null straightens over 2 s
     tunnel.curve(z) -> {x, y}      // corridor centre offset at z; place the camera and page objects on it
     tunnel.tangent(z) -> {x, y, z} // unit direction of travel along the curve at z
     tunnel.setLook(name, fadeSecs); // override the phase blend: 'cage' | 'tessellation' | 'starfield' | 'nebula' | 'wiregrid' | 'blackout'; null = back to phase
     tunnel.dispose();

   No per-frame allocation except a handful of scratch objects created once. */

import {Reflector} from 'three/addons/objects/Reflector.js';

/* ---------- constants ---------- */
const HALF_W = 85;                       // cage half-width, square section
const CELLS_ACROSS = 6;                  // grid cells per wall
const CELL = (HALF_W * 2) / CELLS_ACROSS; // 20 units
const GRID_LEN = 940;                    // grid length ahead of the camera
const BEHIND = 40;                       // anything further behind the camera than this recycles
const GRID_OP = [0.24, 0.49];
const GRID_HDR = 1.2;                    // line colour multiplier so the lattice itself blooms            // grid line opacity at sp 0 and sp 1
const FINE_DIV = 3;                      // fine sub-lines per cell
const FINE_OP = 0.30; 
const STRAY_N = 200;                     // stray off-grid lines per wall per GRID_LEN, for lattice chaos
const STRAY_OP = 0.6;                    // relative to GRID_OP
const STRAY_LEN = [6, 70];                   // fine sub-line layer, relative to GRID_OP

const BLOCK_N = 2800;
const CORE_CLEAR = 0.55;                 // nothing of the cage sits closer than this fraction of HALF_W to the centre
const GLOW_INSET = 4;                    // glow fog planes sit this far inside each wall
const GLOW_OP = [0.10, 0.20];            // glow plane opacity at sp 0 and 1
const GLOW_TILE = 220;                   // world units per noise tile along z (planes snap by this, so no pop)
const BLOCK_SEG = 620;                   // recycle length for blocks (shorter = denser)
const BLOCK_UNIT = 2.5;                  // one "cell" for block lengths
const BLOCK_TH = 0.4;                    // block thickness
const BLOCK_LIFT_FRAC = 0.35;            // fraction floated off the wall plane, for depth chaos
const BLOCK_LIFT_MAX = 9;                // how far off the wall they float
const BLOCK_CLUSTER_FRAC = 0.40;         // fraction of blocks gathered into clusters
const BLOCK_CLUSTERS = 28;               // cluster centres per BLOCK_SEG
const BLOCK_CLUSTER_R = 11;              // cluster radius
const BLOCK_WHITE_EVERY = 6;             // one in N blocks is pulled toward white
const BLOCK_THICK_FRAC = 0.22;           // fraction of blocks that are double thickness
const BLOCK_LONG_FRAC = 0.62;            // fraction that run along z (rest run across the wall)
const BLOCK_OFFGRID = 0.25;              // fraction nudged off their grid line for chaos
const BLOCK_COMP_EVERY = 12;             // one in N blocks takes the complementary colour
const BLOCK_BASE = 0.85;                 // dim floor brightness
const BLOCK_FLASH = 2.6;                 // added brightness at full flicker
const FLICKER_DECAY = 3.2;               // damped decay rate of a flash (per second)
const FLICKER_EDGE = [0.55, 1.75];       // smoothstep window over the sum of two sines
const STRETCH = 6;                       // z stretch = 1 + v * STRETCH
const STRETCH_MAX = 8;                   // visual stretch cap; v itself stays unbounded
const STRETCH_DIM = 0.6;                 // stretched blocks dim by stretch^-STRETCH_DIM so full speed does not blow out to white
const DOUBLE_OP = 0.30;                  // second cage copy opacity above v 1.0
const DOUBLE_ANGLE = Math.PI / 4;
const DOUBLE_RAMP = [1.0, 1.35];         // v range over which the double image fades in

const OCT_APOTHEM = 85;                  // octagonal corridor, wall distance from the axis
const OCT_R = OCT_APOTHEM / Math.cos(Math.PI / 8);   // corner radius
const OCT_HALF = OCT_APOTHEM * Math.tan(Math.PI / 8); // half wall width
const WALL_INSET = 0.4;                  // pattern lines sit this far inside the wall plane

// tessellation patterns: cell sizes chosen so each pattern lands near 4000 to 6000 segments over the corridor
const PAT_CUBE_R = 16;                   // isometric cube lattice: hexagon circumradius
const PAT_TRI_A = 18;                    // triangle grid side
const PAT_DIA_D = 22;                    // 45 degree square grid diagonal
const PAT_HEX_R = 14;                    // honeycomb circumradius
const PAT_KAGOME_D = 15;                 // kagome (trihexagonal) lattice spacing
const PAT_RHOMB_R = 14;                  // rhombille: cube illusion again, smaller and turned 30 degrees
const PAT_CHEV = {spacing: 9, step: 16, amp: 5};    // nested chevron stripes
const PAT_SCOPE = {ring: 14, spokes: 5};            // concentric octagon rings plus radial spokes
const PAT_TRUCHET = {cell: 32, arcSegs: 6};         // Truchet quarter arcs
const PAT_VORONOI = {seeds: 80, nearest: 3};        // cracked-glass cell net
const PAT_HASHED_LEN = 520;              // hashed patterns are generated over this length and laid out twice, so they can snap by it
const PAT_PIECE = 16;                    // long straight lines are cut into pieces this long so brightness can vary along them
const PAT_CAP = 1.5;                     // per-vertex brightness cap: the lattice never outshines a logo halo
const PAT_SWEEP_SOFT = 70;               // wavefront softness, units
const PALETTE = [0x6fcfd2, 0xc78fc4, 0xd8b46e, 0x8fcfa6, 0xa493d3, 0x7f93a6, 0xe0a0b0, 0x9ad0e8];   // muted neon: teal, dusty magenta, amber, mint, violet, slate, rose, ice
const PALETTE_NAMES = ['teal', 'dusty-magenta', 'amber', 'mint', 'violet', 'slate', 'rose', 'ice'];
const PAT_PAIRS = [[0, 4], [1, 7], [2, 5], [3, 1], [4, 2], [5, 0], [6, 3], [7, 6]];   // the 8 colour pairs in the deck, [primary, secondary]
const PAT_HOLD = [6, 11];                // seconds a pattern holds
const PAT_FADE = 1.4;                    // cross-fade seconds
const PAT_OP = [0.55, 0.15];             // accent lines, complementary lines
const PAT_COMP_FRAC = 0.22;              // fraction of cells that take the complementary colour
const PAT_BASE = 0.62;                   // resting brightness
const PAT_HDR = 3.1;                     // overall line gain so thin lines still register through fog and bloom
const PAT_WAVE = 0.55;                   // travelling wave amplitude
const PAT_FLICKER = 0.7;                 // hashed per-cell flicker amplitude
const PAT_BASS = 0.25;                   // brightness added by bass
const PAT_REDUCED = 0.55;                // static brightness under reduced motion
const PULSE_SPEED = 400;                 // beat pulse band travels ahead at this, units per second
const PULSE_WIDTH = 45;
const PULSE_GAIN = 1.4;
const PULSE_DECAY = 1.1;                 // per second
const PULSE_MAX = 4;

const EDGE_OP = [0.30, 0.65];            // corridor edge line opacity at sp 0 and 1
const EDGE_HDR = 1.3;
const SPLIT_SP = [0.80, 0.95];           // sp range over which the doubled edges and chromatic split come in
const SPLIT_OFFSET = 0.6;                // chromatic split offset, units
const SPLIT_OP = 0.55;
const DOUBLE_EDGE_ANGLE = Math.PI / 8;   // the doubled corridor edge copy (45 degrees maps an octagon onto itself, so half of that)

const SOLID_N = 600;                     // small tumbling wireframe solids in the wall band
const SOLID_SEG = 900;
const SOLID_BAND = [60, 80];             // centre radius from the axis; with size 9 nothing reaches inside 55
const SOLID_SIZE = [3, 9];
const SOLID_SPIN = [0.15, 0.55];         // rad/s
const SOLID_OP = 0.5;

const FOG_DENSITY = 0.0028;              // default for the glint shader; pass opts.fogDensity to match the host scene fog

const PHASE_STOPS = [                    // [phase, accent, complement]
  [0.00, 0x3cf2ff, 0xffb347],            // cyan
  [0.10, 0xffb347, 0x3cf2ff],            // amber
  [0.24, 0x4dff9a, 0xf5ff45],            // mint
  [0.60, 0xff3fb6, 0x40f0ff],            // magenta
  [0.82, 0xb06cff, 0xc8ff3c],            // violet
  [1.00, 0x3cf2ff, 0xffb347],            // cyan again
];
const FADE_OUT = [0.42, 0.52];           // cage hands over to shards
const FADE_IN = [0.90, 0.99];            // shards hand back to cage
const SCALE_IN = 0.92;                   // groups scale from this to 1 as they fade in
const REDUCED_LEVEL = 0.45;              // static flicker level under prefers-reduced-motion

const AUDIO_BASS_GAIN = 0.35;            // added to block base brightness by bass
const BEAT_THRESHOLD = 0.7;              // beat rising edge that fires a ripple and a lattice pulse
const RIPPLE_MS = 0.6;                   // ripple lifetime, seconds
const RIPPLE_HALF = 26;                  // half-width in z of the ring of blocks a ripple brightens
const RIPPLE_GAIN = 2.2;                 // peak brightness added by a full-strength ripple
const RIPPLE_AHEAD = [90, 420];          // random z range ahead of the camera for a ripple
const RIPPLE_MAX = 4;                    // concurrent ripples

const LOOK_NAMES = ['cage', 'tessellation', 'starfield', 'nebula', 'wiregrid', 'blackout', 'inverse', 'memory', 'plunge', 'landing'];

const MEM_PER_FACE = 1;                  // panels per wall face per MEM_PITCH units (about 8 on screen)
const MEM_PITCH = 160;
const MEM_SEG = 960;                     // recycle length (6 pitches, 144 panels)
const MEM_W = 64, MEM_H = 36;            // panel size, long side along z
const MEM_INSET = 2.5;
const MEM_TILT = 4 * Math.PI / 180;      // tilt toward the axis
const MEM_JITTER = 2 * Math.PI / 180;
const MEM_MAX_TEX = 12;                  // textures live at once (one InstancedMesh each)
const MEM_KEN_BURNS = 0.08;              // photo zoom over a panel's on-screen life
const MEM_LIFE = MEM_SEG / 90;           // seconds a panel is on screen at a typical speed, for the zoom
const MEM_GLOW = 0.22;                   // glow plane brightness, fraction of the texture's average colour
const MEM_SCAN = 0.08;                   // scanline depth
const MEM_LATTICE = 0.15;                // tessellation weight behind the panels
const MEM_BEZEL = 1.2;                   // bezel width, units

const PLUNGE_N = 2400;
const PLUNGE_R = [20, 260];              // shell around the camera
const PLUNGE_SEG = 1400;                 // z extent of the field (world z, recycled)
const PLUNGE_SIZE = [4, 40];
const PLUNGE_SPIRAL = {omega: 0.12, inward: 7};   // rad/s about the axis, units/s inward
const PLUNGE_BAKE_Z = 520;               // solids within this z distance of the camera are baked
const PLUNGE_MORPH = 0.18;               // shape cross-fade, seconds
const PLUNGE_SECOND_FRAC = 0.25;         // solids that take the second colour
const PLUNGE_SMEAR_SP = 0.85;            // above this sp: streak plus radial RGB smear on the outer 30%
const PLUNGE_SMEAR_OFF = 0.6;
const PLUNGE_STREAK_MAX = 3;             // z stretch cap in the plunge so solids still read as solids at speed
const PLUNGE_OUTER = 0.7;                // outer 30% starts at this fraction of the shell radius
const PLUNGE_CAP = 1000;                 // baked solids capacity per shape set (plus smear copies)
const PLUNGE_STAGES = ['cubes', 'lattice', 'stairs', 'inverse', 'rings', 'shards', 'cubes-wave', 'collapse'];
const PLUNGE_HUGE_FRAC = 0.06;           // solids that are huge (60+ units) and ride the outer shell
const PLUNGE_HUGE_MUL = 3.2;
const PLUNGE_INK_MUL = 1.8;              // heavier cubes in the inverse stage
const PLUNGE_INK_FRAC = 0.4;             // fraction of the field baked in the inverse stage
const PLUNGE_DEPTH_FADE = 620;           // brightness falls with distance over this
const PLUNGE_BEAT_INV = 0.12;            // seconds the pair is inverted after a kick
const PLUNGE_SHARD_STREAK = 14;          // z stretch of the glass shards
const PLUNGE_SHARD_SET = 4;              // index of the shard shape set
const PLUNGE_WAVE = {amp: 30, len: 200, speed: 120};       // cubes-wave displacement
const PLUNGE_COLLAPSE_SECS = 1.25;
const PLUNGE_COLLAPSE_Z = 220;           // the point everything is sucked toward, ahead of the camera
const PLUNGE_LATTICE = {pitch: 40, half: 240, depth: 640, wave: 12};
const PLUNGE_STAIRS = {steps: 24, radius: 58, rise: 4.6, tread: [26, 3.5, 15], turnZ: 24 * 4.6};
const PLUNGE_RINGS = {pitch: 30, half: 72, depth: 720, rate: 0.7};

const LAND_Y = -12;
const LAND_CELL = 12;
const LAND_SIZE = 1400;                  // floor square (fog takes it to black well before the edge)
const LAND_PIECE = 24;
const LAND_FADE = [260, 620];            // distance fade of the floor lines
const LAND_OP = 0.55;
const LAND_HORIZON = {dist: 650, width: 1400, height: 7, op: 0.6};
const LAND_DUST = 400;
const LAND_KEY = {color: 0xffd9a8, intensity: 0.85};     // warm key from front-left
const LAND_FILL = {color: 0x9ab8ff, intensity: 0.35};    // cool fill from behind
const IMPACT_RING = {radius: 90, secs: 0.7, width: 6};
const IMPACT_BOUNCE = 0.25;              // damped bounce period on the grid brightening
const INVERSE_BG = 0xf2f1ec;             // paper white background and fog under the inverse look
const INVERSE_INK = 0x101218;            // line ink under the inverse look
const INVERSE_TINT = 0.25;               // how much of the run's colour pair tints the ink
const BEND_DEFAULT = {ax: 140, lx: 900, ay: 70, ly: 1300, py: 1.7};   // offset(z) = (ax sin(z/lx), ay sin(z/ly + py))
const BEND_EASE = 2;                     // seconds to ease amplitudes when setBend changes or straightens
const BEAT_MORPH_LEVEL = 0.85;           // beat level that can trigger a universe change (when enabled)
const LOOK_FADE = 1.5;                   // default setLook cross-fade, seconds

const STAR_N = 6000;
const STAR_SEG = 1400;
const STAR_R = [30, 300];                // cylinder around the axis (inner radius keeps the core clear)
const STAR_SIZE = [1.2, 3.2];            // point size, units at distance 1 (attenuated)
const STAR_MAX_PX = 96;
const BRIGHT_N = 40;
const BRIGHT_SIZE = [10, 18];
const BRIGHT_R = [140, 300];
const STAR_BACKDROP = 0x030616;          // deep blue-black tube behind the stars
const STAR_BACKDROP_R = 330;
const NEB_N = 400;
const NEB_SEG = 1600;
const NEB_R = [190, 420];                // inner radius keeps the soft edges off the axis, so the core stays dark
const NEB_SIZE = [180, 420];
const NEB_OP = [0.18, 0.55];
const NEB_CLUMP = 0.6;                   // opacity is shaped by a hashed clump factor so the cloud has structure
const NEB_DRIFT = 6;                     // units of slow drift
const NEB_BASS = 0.3;                    // opacity gain by bass
const DUST_N = 1500;
const DUST_SEG = 1200;
const DUST_R = [30, 380];
const DUST_SIZE = 0.9;
const GRID_Y = 85;                       // wiregrid floor and ceiling height
const GRID_CELL = 12;
const GRID_HALF = 300;                   // half width of the planes
const GRID_PULSE_SPEED = 260;            // bands travel toward the camera at this
const GRID_STAR_W = 0.25;                // faint stars behind the wiregrid
const BLACKOUT_LIGHT = {dist: 40, intensity: 900};
const BLACKOUT_DUST = 200;

const MIRROR_LEN = 420;                  // mirror room length
const MIRROR_FADE = 60;                  // entry and exit fade, units of camera travel
const MIRROR_DIM = 0.15;                 // cage and shard weight inside the room
const MIRROR_ACTIVE = 300;               // reflectors render only while camZ is within this of the room
const MIRROR_TEX = [512, 256];           // reflector texture size, normal and slow
const MIRROR_CLIP = 0.003;
const MIRROR_COLOR = 0x667788;           // dark smoked glass
const MIRROR_INSET = 0.6;                // mirror planes sit this far inside the wall
const MIRROR_EDGE_OP = 0.85;             // accent edge line opacity
const MIRROR_LIGHTS = 6;
const MIRROR_LIGHT_I = 5200;             // point light intensity (decay 2), lights the figure at the centre
const MIRROR_LIGHT_OFF = 22;             // lights sit this far off the axis, alternating sides

/* ---------- helpers ---------- */
const hash = (i, s) => { const x = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453; return x - Math.floor(x); };
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function glowTexture(THREE, size) {
  // soft blotchy noise: many overlapping radial blobs at three scales
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'lighter';
  const blob = (x, y, r, a) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
  };
  for (let i = 0; i < 40; i++) blob(hash(i, 61) * size, hash(i, 62) * size, size * (0.18 + hash(i, 63) * 0.2), 0.10);
  for (let i = 0; i < 160; i++) blob(hash(i, 64) * size, hash(i, 65) * size, size * (0.04 + hash(i, 66) * 0.08), 0.16);
  for (let i = 0; i < 500; i++) blob(hash(i, 67) * size, hash(i, 68) * size, size * (0.01 + hash(i, 69) * 0.02), 0.22);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// bend: applied in world space after the model and instance transforms, z untouched so fog and recycling are unaffected
const BEND_GLSL = /* glsl */`
  uniform vec4 uBend;            // ax, lx, ay, ly
  uniform float uBendPy;
  vec2 bendOffset(float z) { return vec2(uBend.x * sin(z / uBend.y), uBend.z * sin(z / uBend.w + uBendPy)); }
`;
const PAT_VERT = /* glsl */`
  ${BEND_GLSL}
  attribute float aCell;
  uniform float uTime, uFog, uOp, uBass, uHigh, uReduced, uFront, uSweep;   // uSweep: 1 incoming, -1 outgoing, 0 none
  uniform vec3 uAccent, uComp, uInk;
  uniform vec3 uPulse[4];        // z centre, amplitude, width (world z)
  varying vec3 vCol; varying vec3 vInk; varying float vInkA;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    wp.xy += bendOffset(wp.z);
    vec4 mv = viewMatrix * wp;
    float dist = -mv.z;
    float f = uFog * dist; float fog = exp(-f * f);
    float b;
    if (uReduced > 0.5) b = ${PAT_REDUCED.toFixed(3)};
    else {
      float wave = 0.5 + 0.5 * sin(wp.z * 0.02 + uTime * 3.0);        // travels toward -z, 150 units/s
      float wave2 = 0.5 + 0.5 * sin(wp.z * 0.0071 - uTime * 1.3);
      float r = 1.5 + aCell * 3.0;
      float fl = smoothstep(0.6, 1.6, sin(uTime * r * (1.0 + uHigh) + aCell * 40.0) + sin(uTime * r * 1.7 + aCell * 17.0));
      b = ${PAT_BASE.toFixed(3)} + ${PAT_WAVE.toFixed(3)} * wave * wave2 + ${PAT_FLICKER.toFixed(3)} * fl + ${PAT_BASS.toFixed(3)} * uBass;
      for (int k = 0; k < 4; k++) { float d = (wp.z - uPulse[k].x) / uPulse[k].z; b += uPulse[k].y * exp(-d * d); }
    }
    b = min(b, ${PAT_CAP.toFixed(2)});
    // morph wavefront: sweeps from the vanishing point toward the camera; incoming lights up behind it, outgoing goes dark behind it
    float swept = smoothstep(uFront + ${PAT_SWEEP_SOFT.toFixed(1)}, uFront - ${PAT_SWEEP_SOFT.toFixed(1)}, wp.z);
    if (uSweep > 0.5) b *= swept; else if (uSweep < -0.5) b *= 1.0 - swept;
    bool isComp = fract(aCell * 7.31) < ${PAT_COMP_FRAC.toFixed(3)};
    vec3 c = isComp ? uComp * ${PAT_OP[1].toFixed(3)} : uAccent * ${PAT_OP[0].toFixed(3)};
    vCol = c * b * fog * uOp * ${PAT_HDR.toFixed(2)};
    // inverse: dark ink with a thin tint, alpha-blended over the paper, fading into the pale fog
    vInk = mix(uInk, isComp ? uComp : uAccent, ${INVERSE_TINT.toFixed(2)});
    vInkA = min(1.0, b * 0.9) * fog * uOp;
    gl_Position = projectionMatrix * mv;
  }`;
const PAT_FRAG = /* glsl */`
  uniform float uInv;
  varying vec3 vCol; varying vec3 vInk; varying float vInkA;
  void main(){ if (uInv > 0.5) gl_FragColor = vec4(vInk, vInkA); else gl_FragColor = vec4(vCol, 1.0); }`;

const STAR_VERT = /* glsl */`
  ${BEND_GLSL}
  attribute float aSize; attribute vec3 aSeed;     // twinkle phase, rate, colour pick
  uniform float uTime, uHeight, uStretch, uFog, uWeight, uCamZ, uSeg, uReduced, uHigh, uMaxPx;
  uniform vec3 uTintA, uTintB;
  varying vec3 vCol; varying vec2 vDir;
  void main(){
    vec3 p = position;
    p.z = uCamZ + ${BEHIND.toFixed(1)} - mod(uCamZ + ${BEHIND.toFixed(1)} - p.z, uSeg);   // wrap along z, both directions
    vec4 wp = modelMatrix * vec4(p, 1.0);
    wp.xy += bendOffset(wp.z);
    vec4 mv = viewMatrix * wp;
    float dist = -mv.z;
    float tw = uReduced > 0.5 ? 0.7 : 0.45 + 0.55 * (0.5 + 0.5 * sin(uTime * aSeed.y * (1.0 + uHigh) + aSeed.x));
    vec3 c = aSeed.z < 0.5 ? uTintA : uTintB;
    float f = uFog * dist; float fog = exp(-f * f);
    vCol = c * tw * fog * uWeight / sqrt(1.0 + uStretch);
    gl_Position = projectionMatrix * mv;
    vec2 ndc = gl_Position.xy / max(gl_Position.w, 0.0001);
    vDir = length(ndc) > 0.001 ? normalize(-ndc) : vec2(0.0, 1.0);
    float px = aSize * (uHeight * 0.5) / max(dist, 1.0) * (1.0 + uStretch);
    gl_PointSize = min(px, uMaxPx);
  }`;
const STAR_FRAG = /* glsl */`
  uniform float uStretch, uSpike;
  varying vec3 vCol; varying vec2 vDir;
  void main(){
    vec2 d = vec2(gl_PointCoord.x * 2.0 - 1.0, 1.0 - gl_PointCoord.y * 2.0);
    float along = dot(d, vDir);
    float perp = dot(d, vec2(-vDir.y, vDir.x)) * (1.0 + uStretch);
    float r2 = along * along + perp * perp;
    float a = pow(max(0.0, 1.0 - sqrt(r2)), 1.8) + 0.8 * exp(-r2 * 16.0);
    if (uSpike > 0.5) {
      float sx = exp(-abs(d.x) * 5.0) * exp(-abs(d.y) * 40.0), sy = exp(-abs(d.y) * 5.0) * exp(-abs(d.x) * 40.0);
      a = 0.5 * a + 0.9 * max(sx, sy) + 0.6 * exp(-dot(d, d) * 30.0);
    }
    gl_FragColor = vec4(vCol * a, 1.0);
  }`;

function radialTexture(THREE, size) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  grad.addColorStop(0.65, 'rgba(255,255,255,0.12)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* ---------- module ---------- */
export function makeTunnel(THREE, opts = {}) {
  const group = new THREE.Group();
  group.name = 'tunnel';
  const cage = new THREE.Group(); cage.name = 'cage';
  const truss = new THREE.Group(); truss.name = 'tessellation';
  group.add(cage, truss);

  const disposables = [];
  const beatState = {lastBeat: 0, lastBeatGrid: 0};
  const accent = new THREE.Color(), comp = new THREE.Color();
  const tmpA = new THREE.Color(), tmpB = new THREE.Color();
  const state = {t: 0, gt: 0, slow: !!opts.slow, reduced: !!opts.reduced, camZ: 0, lastBeat: 0};
  // one shared uniform set drives the bend in every material the module owns
  const bendU = {uBend: {value: new THREE.Vector4(0, BEND_DEFAULT.lx, 0, BEND_DEFAULT.ly)}, uBendPy: {value: BEND_DEFAULT.py}};
  const bend = {from: {ax: 0, ay: 0, lx: BEND_DEFAULT.lx, ly: BEND_DEFAULT.ly, py: BEND_DEFAULT.py}, to: null, t0: 0, cur: null, ease: BEND_EASE};
  bend.to = {...bend.from}; bend.cur = {...bend.from};
  const bendCompile = sh => {
    sh.uniforms.uBend = bendU.uBend; sh.uniforms.uBendPy = bendU.uBendPy;
    sh.vertexShader = BEND_GLSL + sh.vertexShader.replace('#include <project_vertex>', `
      vec4 mvPosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      vec4 bentWorld = modelMatrix * mvPosition;
      bentWorld.xy += bendOffset(bentWorld.z);
      mvPosition = viewMatrix * bentWorld;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  const bendable = m => { m.onBeforeCompile = bendCompile; m.customProgramCacheKey = () => 'bend'; return m; };
  function curve(z) { const c = bend.cur; return {x: c.ax * Math.sin(z / c.lx), y: c.ay * Math.sin(z / c.ly + c.py)}; }
  function tangent(z) {                  // unit direction of travel (toward -z) along the curve
    const c = bend.cur, dx = c.ax / c.lx * Math.cos(z / c.lx), dy = c.ay / c.ly * Math.cos(z / c.ly + c.py);
    const l = Math.hypot(dx, dy, 1); return {x: -dx / l, y: -dy / l, z: -1 / l};
  }
  function setBend(params, easeSecs) {
    bend.from = {...bend.cur}; bend.t0 = state.t; bend.ease = easeSecs == null ? BEND_EASE : Math.max(0, easeSecs);
    bend.to = params == null ? {...bend.cur, ax: 0, ay: 0} : {...BEND_DEFAULT, ...params};
  }
  function tickBend() {
    const k = bend.ease > 0 ? smooth(0, bend.ease, state.t - bend.t0) : 1;
    for (const key of ['ax', 'ay', 'lx', 'ly', 'py']) bend.cur[key] = bend.from[key] + (bend.to[key] - bend.from[key]) * k;
    bendU.uBend.value.set(bend.cur.ax, bend.cur.lx, bend.cur.ay, bend.cur.ly); bendU.uBendPy.value = bend.cur.py;
  }
  const ripples = [];                    // {z, age, strength}
  const mirror = {zStart: null, planes: [], edges: [], lights: [], mats: [], group: null};
  let mirrorBusy = false;                // recursion guard: mirrors never re-render while one is rendering

  /* ---- LOOK A: grid ---- */
  function gridGeometry(div, skipCoarse) {
    // lines along z at every cell boundary on all four walls, plus transverse squares
    const p = [];
    const step = CELL / div;
    const n = CELLS_ACROSS * div;
    for (let i = 0; i <= n; i++) {
      if (skipCoarse && i % div === 0) continue;
      const u = -HALF_W + i * step;
      p.push(HALF_W, u, 0, HALF_W, u, -GRID_LEN);
      p.push(-HALF_W, u, 0, -HALF_W, u, -GRID_LEN);
      p.push(u, HALF_W, 0, u, HALF_W, -GRID_LEN);
      p.push(u, -HALF_W, 0, u, -HALF_W, -GRID_LEN);
    }
    const nz = Math.floor(GRID_LEN / step);
    for (let k = 0; k <= nz; k++) {
      if (skipCoarse && k % div === 0) continue;
      const z = -k * step;
      p.push(-HALF_W, -HALF_W, z, HALF_W, -HALF_W, z,
             HALF_W, -HALF_W, z, HALF_W, HALF_W, z,
             HALF_W, HALF_W, z, -HALF_W, HALF_W, z,
             -HALF_W, HALF_W, z, -HALF_W, -HALF_W, z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    disposables.push(g);
    return g;
  }
  function strayGeometry() {
    // random short lines on the walls; the pattern repeats every GRID_LEN so the mesh can jump by GRID_LEN without a pop
    const p = [];
    for (let copy = 0; copy < 2; copy++) {
      const zo = -copy * GRID_LEN;
      for (let wall = 0; wall < 4; wall++) for (let i = 0; i < STRAY_N; i++) {
        const k = wall * STRAY_N + i;
        const u = -HALF_W + hash(k, 41) * HALF_W * 2;
        const z = -hash(k, 42) * GRID_LEN + zo;
        const len = STRAY_LEN[0] + hash(k, 43) * (STRAY_LEN[1] - STRAY_LEN[0]);
        const alongZ = hash(k, 44) < 0.7;
        const u2 = alongZ ? u : Math.max(-HALF_W, Math.min(HALF_W, u + len * (hash(k, 45) < 0.5 ? -1 : 1)));
        const z2 = alongZ ? z - len : z;
        const lift = hash(k, 46) < 0.5 ? hash(k, 47) * 12 : 0;
        const n = HALF_W - lift;
        if (wall === 0) p.push(n, u, z, n, u2, z2);
        else if (wall === 1) p.push(u, n, z, u2, n, z2);
        else if (wall === 2) p.push(-n, u, z, -n, u2, z2);
        else p.push(u, -n, z, u2, -n, z2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    disposables.push(g);
    return g;
  }
  const coarseGeo = gridGeometry(1, false);
  const strayGeo = strayGeometry();
  const fineGeo = gridGeometry(FINE_DIV, true);
  const lineMat = () => {
    const m = bendable(new THREE.LineBasicMaterial({color: 0xffffff, transparent: true, opacity: GRID_OP[0],
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}));
    disposables.push(m); return m;
  };
  const gridMat = lineMat(), fineMat = lineMat(), gridMat2 = lineMat(), fineMat2 = lineMat(), strayMat = lineMat(), strayMat2 = lineMat();
  const strayA = new THREE.LineSegments(strayGeo, strayMat), strayB = new THREE.LineSegments(strayGeo, strayMat2);
  const gridA = new THREE.LineSegments(coarseGeo, gridMat);
  const fineA = new THREE.LineSegments(fineGeo, fineMat);
  const gridB = new THREE.LineSegments(coarseGeo, gridMat2);   // double image
  const fineB = new THREE.LineSegments(fineGeo, fineMat2);
  for (const l of [gridA, fineA, gridB, fineB, strayA, strayB]) { l.frustumCulled = false; cage.add(l); }
  const cageDouble = new THREE.Group(); cageDouble.rotation.z = DOUBLE_ANGLE; cageDouble.visible = false;
  cage.add(cageDouble);
  cageDouble.add(gridB, fineB, strayB);

  /* ---- LOOK A: glow fog planes, one per wall, so the wall glow reads as volume ---- */
  const GLOW_LEN = GRID_LEN + GLOW_TILE;
  const glowTexSide = glowTexture(THREE, 256); disposables.push(glowTexSide);
  const glowTexTop = glowTexSide.clone(); glowTexTop.needsUpdate = true; disposables.push(glowTexTop);
  glowTexSide.repeat.set(GLOW_LEN / GLOW_TILE, HALF_W * 2 / GLOW_TILE);
  glowTexTop.repeat.set(HALF_W * 2 / GLOW_TILE, GLOW_LEN / GLOW_TILE);
  const glowMatSide = bendable(new THREE.MeshBasicMaterial({map: glowTexSide, color: 0xffffff, transparent: true, opacity: GLOW_OP[0],
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false}));
  const glowMatTop = bendable(glowMatSide.clone()); glowMatTop.map = glowTexTop;
  disposables.push(glowMatSide, glowMatTop);
  const sideGeo = new THREE.PlaneGeometry(GLOW_LEN, HALF_W * 2); sideGeo.rotateY(Math.PI / 2); sideGeo.translate(0, 0, -GLOW_LEN / 2);
  const topGeo = new THREE.PlaneGeometry(HALF_W * 2, GLOW_LEN); topGeo.rotateX(Math.PI / 2); topGeo.translate(0, 0, -GLOW_LEN / 2);
  disposables.push(sideGeo, topGeo);
  const gi = HALF_W - GLOW_INSET;
  const glowPlanes = [[sideGeo, glowMatSide, gi, 0], [sideGeo, glowMatSide, -gi, 0], [topGeo, glowMatTop, 0, gi], [topGeo, glowMatTop, 0, -gi]]
    .map(([g, m, x, y]) => { const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, 0); mesh.frustumCulled = false; mesh.renderOrder = -1; cage.add(mesh); return mesh; });

  /* ---- LOOK A: blocks ---- */
  const blockGeo = new THREE.BoxGeometry(1, 1, 1); disposables.push(blockGeo);
  const blockMat = bendable(new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false}));
  const blockMat2 = bendable(blockMat.clone()); blockMat2.opacity = DOUBLE_OP;
  disposables.push(blockMat, blockMat2);
  const blocks = new THREE.InstancedMesh(blockGeo, blockMat, BLOCK_N);
  blocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  blocks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BLOCK_N * 3), 3);
  blocks.instanceColor.setUsage(THREE.DynamicDrawUsage);
  blocks.frustumCulled = false;
  cage.add(blocks);
  const blocks2 = new THREE.InstancedMesh(blockGeo, blockMat2, BLOCK_N);   // double image shares buffers
  blocks2.instanceMatrix = blocks.instanceMatrix;
  blocks2.instanceColor = blocks.instanceColor;
  blocks2.frustumCulled = false;
  cageDouble.add(blocks2);

  const bPos = new Float32Array(BLOCK_N * 3), bScl = new Float32Array(BLOCK_N * 3);
  const bPh = new Float32Array(BLOCK_N), bRate = new Float32Array(BLOCK_N), bLevel = new Float32Array(BLOCK_N);
  const bComp = new Uint8Array(BLOCK_N);   // 0 accent, 1 complement, 2 white-ish
  for (let i = 0; i < BLOCK_N; i++) {
    const wall = hash(i, 14) < BLOCK_CLUSTER_FRAC ? Math.floor(hash(i, 15) * BLOCK_CLUSTERS) % 4 : i % 4;
    const longi = hash(i, 1) < BLOCK_LONG_FRAC;
    const len = (1 + Math.floor(hash(i, 3) * 4)) * BLOCK_UNIT;
    const th = hash(i, 4) < BLOCK_THICK_FRAC ? BLOCK_TH * 2 : BLOCK_TH;
    let u, z;
    const clustered = hash(i, 14) < BLOCK_CLUSTER_FRAC;
    if (longi) {
      u = -HALF_W + Math.floor(hash(i, 2) * (CELLS_ACROSS + 1)) * CELL;
      z = -hash(i, 5) * BLOCK_SEG;
      if (hash(i, 7) < BLOCK_OFFGRID) u += (hash(i, 8) - 0.5) * CELL * 0.6;
    } else {
      u = -HALF_W + hash(i, 6) * HALF_W * 2;
      z = -Math.round(hash(i, 5) * BLOCK_SEG / CELL) * CELL;
      if (hash(i, 7) < BLOCK_OFFGRID) z += (hash(i, 8) - 0.5) * CELL * 0.6;
    }
    if (clustered) {
      const c = Math.floor(hash(i, 15) * BLOCK_CLUSTERS);
      const cu = -HALF_W + hash(c, 16) * HALF_W * 2, cz = -hash(c, 17) * BLOCK_SEG;
      u = Math.max(-HALF_W, Math.min(HALF_W, cu + (hash(i, 18) - 0.5) * 2 * BLOCK_CLUSTER_R));
      z = cz + (hash(i, 19) - 0.5) * 2 * BLOCK_CLUSTER_R;
    }
    const lift = hash(i, 12) < BLOCK_LIFT_FRAC ? hash(i, 13) * BLOCK_LIFT_MAX : 0;
    const n = Math.max(HALF_W * CORE_CLEAR, HALF_W - th * 0.5 + 0.3 - lift);   // on the wall plane, or floated off it
    let px, py, sx, sy;
    if (wall === 0 || wall === 2) { px = wall === 0 ? n : -n; py = u; sx = th; sy = longi ? th : len; }
    else { py = wall === 1 ? n : -n; px = u; sy = th; sx = longi ? th : len; }
    const sz = longi ? len : th;
    bPos[i * 3] = px; bPos[i * 3 + 1] = py; bPos[i * 3 + 2] = z;
    bScl[i * 3] = sx; bScl[i * 3 + 1] = sy; bScl[i * 3 + 2] = sz;
    bPh[i] = hash(i, 9) * Math.PI * 2;
    bRate[i] = 0.5 + hash(i, 10) * 2.4;
    bLevel[i] = hash(i, 11) * 0.3;
    bComp[i] = (i % BLOCK_COMP_EVERY) === 5 ? 1 : ((i % BLOCK_WHITE_EVERY) === 2 ? 2 : 0);
  }
  const mArr = blocks.instanceMatrix.array, cArr = blocks.instanceColor.array;
  mArr.fill(0);
  for (let i = 0; i < BLOCK_N; i++) mArr[i * 16 + 15] = 1;

  /* ---- LOOK B: tessellation patterns, one LineSegments each, on an octagonal corridor ---- */
  const W = OCT_HALF * 2;
  // wall-local 2D generators: return segments [u0, s0, u1, s1, cell] with s = distance along the corridor (>= 0),
  // periodic in s with the returned period so the mesh can snap along z without a pop
  function genCube(L) {          // isometric cube lattice: pointy-top hexagons plus a Y of spokes
    const R = PAT_CUBE_R, dx = Math.sqrt(3) * R, dy = 1.5 * R, per = 3 * R, out = [];
    const rows = Math.ceil(L / dy / 2) * 2, cols = Math.ceil(W / dx) + 1;
    for (let r = 0; r < rows; r++) for (let c = -1; c < cols; c++) {
      const cx = -W / 2 + c * dx + (r & 1 ? dx / 2 : 0), cy = r * dy, cell = hash(r * 97 + c, 91);
      const v = k => [cx + R * Math.cos(Math.PI / 6 + k * Math.PI / 3), cy + R * Math.sin(Math.PI / 6 + k * Math.PI / 3)];
      for (let k = 0; k < 3; k++) { const a = v(k), b = v(k + 1); out.push(a[0], a[1], b[0], b[1], cell); }
      for (let k = 0; k < 6; k += 2) { const a = v(k); out.push(cx, cy, a[0], a[1], cell); }
    }
    return {seg: out, period: per};
  }
  function genTri(L) {           // triangle grid: from each lattice point, three edges
    const a = PAT_TRI_A, h = a * Math.sqrt(3) / 2, per = 2 * h, out = [];
    const rows = Math.ceil(L / h / 2) * 2, cols = Math.ceil(W / a) + 1;
    for (let r = 0; r < rows; r++) for (let c = -1; c < cols; c++) {
      const x = -W / 2 + c * a + (r & 1 ? a / 2 : 0), y = r * h, cell = hash(r * 89 + c, 92);
      out.push(x, y, x + a, y, cell, x, y, x + a / 2, y + h, cell, x, y, x - a / 2, y + h, cell);
    }
    return {seg: out, period: per};
  }
  function genDiamond(L) {       // square grid rotated 45 degrees
    const d = PAT_DIA_D, per = d, out = [];
    const rows = Math.ceil(L / (d / 2) / 2) * 2, cols = Math.ceil(W / d) + 1;
    for (let r = 0; r < rows; r++) for (let c = -1; c < cols; c++) {
      const x = -W / 2 + c * d + (r & 1 ? d / 2 : 0), y = r * d / 2, cell = hash(r * 83 + c, 93);
      out.push(x, y, x + d / 2, y + d / 2, cell, x, y, x - d / 2, y + d / 2, cell);
    }
    return {seg: out, period: per};
  }
  function genHex(L) {           // honeycomb: three edges per cell (the other three belong to the neighbours)
    const R = PAT_HEX_R, dx = Math.sqrt(3) * R, dy = 1.5 * R, per = 3 * R, out = [];
    const rows = Math.ceil(L / dy / 2) * 2, cols = Math.ceil(W / dx) + 1;
    for (let r = 0; r < rows; r++) for (let c = -1; c < cols; c++) {
      const cx = -W / 2 + c * dx + (r & 1 ? dx / 2 : 0), cy = r * dy, cell = hash(r * 79 + c, 94);
      const v = k => [cx + R * Math.cos(Math.PI / 6 + k * Math.PI / 3), cy + R * Math.sin(Math.PI / 6 + k * Math.PI / 3)];
      for (let k = 0; k < 3; k++) { const a = v(k), b = v(k + 1); out.push(a[0], a[1], b[0], b[1], cell); }
    }
    return {seg: out, period: per};
  }
  // cut a long wall-local line into PAT_PIECE-long pieces (so the per-vertex wave can vary along it)
  function pieces(out, u0, s0, u1, s1, cell) {
    const n = Math.max(1, Math.ceil(Math.hypot(u1 - u0, s1 - s0) / PAT_PIECE));
    for (let j = 0; j < n; j++) { const a = j / n, b = (j + 1) / n; out.push(u0 + (u1 - u0) * a, s0 + (s1 - s0) * a, u0 + (u1 - u0) * b, s0 + (s1 - s0) * b, cell); }
  }
  function genKagome(L) {        // trihexagonal: a triangle grid with one vertex in four removed, edges touching it dropped
    const a = PAT_KAGOME_D, h = a * Math.sqrt(3) / 2, per = 4 * h, out = [];
    const rows = Math.ceil(L / h / 4) * 4, cols = Math.ceil(W / a) + 2;
    const removed = (r, c) => (r & 1) === 0 && (((c - r / 2) % 2) + 2) % 2 === 0;
    const pt = (r, c) => [-W / 2 + c * a + (r & 1 ? a / 2 : 0), r * h];
    for (let r = 0; r < rows; r++) for (let c = -1; c < cols; c++) {
      if (removed(r, c)) continue;
      const P = pt(r, c), cell = hash(r * 73 + c, 96);
      const nb = [[r, c + 1], [r + 1, (r & 1) ? c + 1 : c], [r + 1, (r & 1) ? c : c - 1]];
      for (const [rr, cc] of nb) { if (removed(rr, cc)) continue; const Q = pt(rr, cc); out.push(P[0], P[1], Q[0], Q[1], cell); }
    }
    return {seg: out, period: per};
  }
  function genRhombille(L) {     // flat-top hexagons with a Y of spokes, small scale
    const R = PAT_RHOMB_R, dx = 1.5 * R, dy = Math.sqrt(3) * R, per = dy, out = [];
    const rows = Math.ceil(L / dy) + 1, cols = Math.ceil(W / dx) + 2;
    for (let c = -1; c < cols; c++) for (let r = -1; r < rows; r++) {
      const cx = -W / 2 + c * dx, cy = r * dy + (c & 1 ? dy / 2 : 0), cell = hash(r * 67 + c, 97);
      const v = k => [cx + R * Math.cos(k * Math.PI / 3), cy + R * Math.sin(k * Math.PI / 3)];
      for (let k = 0; k < 3; k++) { const a = v(k), b = v(k + 1); out.push(a[0], a[1], b[0], b[1], cell); }
      for (let k = 1; k < 6; k += 2) { const a = v(k); out.push(cx, cy, a[0], a[1], cell); }
    }
    return {seg: out, period: per};
  }
  function genChevron(L) {       // zigzag stripes across the wall
    const {spacing, step, amp} = PAT_CHEV, per = spacing, out = [];
    const rows = Math.ceil(L / spacing / 2) * 2, n = Math.ceil(W / step);
    for (let r = 0; r < rows; r++) {
      const s = r * spacing, cell = hash(r, 98), flip = 1;   // same orientation every row: nested chevrons, not diamonds
      for (let j = 0; j < n; j++) {
        const u0 = -W / 2 + j * step, u1 = u0 + step;
        out.push(u0, s + flip * (j & 1 ? amp : -amp), u1, s + flip * (j & 1 ? -amp : amp), cell);
      }
    }
    return {seg: out, period: per};
  }
  function genScope(L) {         // concentric octagon rings every 14 units plus radial spokes
    const {ring, spokes} = PAT_SCOPE, per = ring, out = [];
    const rows = Math.ceil(L / ring) + 1;
    for (let r = 0; r < rows; r++) { const s = r * ring; pieces(out, -W / 2, s, W / 2, s, hash(r, 99)); }
    for (let j = 0; j < spokes; j++) {
      const u = -W / 2 + (j + 0.5) * W / spokes;
      for (let r = 0; r < rows; r++) out.push(u, r * ring, u, (r + 1) * ring, hash(r * 31 + j, 100));
    }
    return {seg: out, period: per};
  }
  function genTruchet(L) {       // quarter circles on a square grid, hashed orientation per cell; hashed, so laid out twice
    const {cell: c, arcSegs} = PAT_TRUCHET, P = PAT_HASHED_LEN, out = [];
    const rows = Math.round(P / c), cols = Math.ceil(W / c) + 1;
    for (let r = 0; r < rows; r++) for (let q = -1; q < cols; q++) {
      const x0 = -W / 2 + q * c, y0 = r * c, cellH = hash(r * 61 + q, 101), flip = hash(r * 61 + q, 102) < 0.5;
      const corners = flip ? [[x0, y0], [x0 + c, y0 + c]] : [[x0 + c, y0], [x0, y0 + c]];
      for (const [cx, cy] of corners) {
        // quarter arc of radius c/2 around this corner, the quadrant that lies inside the cell
        const a0 = Math.atan2((y0 + c / 2) - cy, (x0 + c / 2) - cx) - Math.PI / 4;
        for (let k = 0; k < arcSegs; k++) {
          const t0 = a0 + (k / arcSegs) * Math.PI / 2, t1 = a0 + ((k + 1) / arcSegs) * Math.PI / 2;
          out.push(cx + c / 2 * Math.cos(t0), cy + c / 2 * Math.sin(t0), cx + c / 2 * Math.cos(t1), cy + c / 2 * Math.sin(t1), cellH);
        }
      }
    }
    return {seg: out, period: P, copies: 2};
  }
  function genVoronoi(L) {       // cracked glass: seeds connected to their nearest neighbours (s wraps so the tile is periodic)
    const {seeds, nearest} = PAT_VORONOI, P = PAT_HASHED_LEN, out = [];
    const pts = []; for (let i = 0; i < seeds; i++) pts.push([(hash(i, 103) - 0.5) * W, hash(i, 104) * P]);
    const wrap = d => d - P * Math.round(d / P);
    const seen = new Set();
    for (let i = 0; i < seeds; i++) {
      const d = pts.map((q, j) => [j === i ? Infinity : Math.hypot(q[0] - pts[i][0], wrap(q[1] - pts[i][1])), j]).sort((a, b) => a[0] - b[0]);
      for (let k = 0; k < nearest; k++) {
        const j = d[k][1], key = i < j ? i * 1000 + j : j * 1000 + i;
        if (seen.has(key)) continue; seen.add(key);
        const ds = wrap(pts[j][1] - pts[i][1]);
        pieces(out, pts[i][0], pts[i][1], pts[j][0], pts[i][1] + ds, hash(key, 105));
      }
    }
    return {seg: out, period: P, copies: 2};
  }
  // clip a wall-local segment to the wall width, then lift it onto wall k in 3D
  const wallBasis = k => { const ak = (k + 0.5) * Math.PI / 4; return [Math.cos(ak), Math.sin(ak), -Math.sin(ak), Math.cos(ak)]; };
  function buildPattern(gen) {
    const L0 = GRID_LEN + 80;
    const {seg, period, copies} = gen(L0);
    const L = copies ? period * copies : Math.ceil(L0 / period) * period;   // generated length rounded up to whole periods
    const pos = [], cellA = [];
    const dist = OCT_APOTHEM - WALL_INSET, hw = W / 2;
    for (let k = 0; k < 8; k++) {
      const [nx, ny, tx, ty] = wallBasis(k);
      for (let cp = 0; cp < (copies || 1); cp++) for (let i = 0; i < seg.length; i += 5) {
        let u0 = seg[i], s0 = seg[i + 1] + cp * period, u1 = seg[i + 2], s1 = seg[i + 3] + cp * period;
        if (s0 >= L && s1 >= L) continue;
        if (copies && (s0 > L || s1 > L)) continue;   // hashed tiles: drop pieces that spill past the second copy
        // clip in u to the wall
        if ((u0 < -hw && u1 < -hw) || (u0 > hw && u1 > hw)) continue;
        const clip = (ua, sa, ub, sb, lim) => { const t = (lim - ua) / (ub - ua); return [lim, sa + (sb - sa) * t]; };
        if (u0 < -hw) [u0, s0] = clip(u0, s0, u1, s1, -hw); else if (u0 > hw) [u0, s0] = clip(u0, s0, u1, s1, hw);
        if (u1 < -hw) [u1, s1] = clip(u1, s1, u0, s0, -hw); else if (u1 > hw) [u1, s1] = clip(u1, s1, u0, s0, hw);
        const cell = hash(Math.floor(seg[i + 4] * 4096) + k * 7919, 95);
        pos.push(nx * dist + tx * u0, ny * dist + ty * u0, -s0, nx * dist + tx * u1, ny * dist + ty * u1, -s1);
        cellA.push(cell, cell);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aCell', new THREE.Float32BufferAttribute(cellA, 1));
    disposables.push(g);
    return {geo: g, period, segments: pos.length / 6};
  }
  const patMatBase = {
    vertexShader: PAT_VERT, fragmentShader: PAT_FRAG, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false,
  };
  const patterns = [genCube, genTri, genDiamond, genHex, genKagome, genRhombille, genChevron, genScope, genTruchet, genVoronoi].map((gen, idx) => {
    const built = buildPattern(gen);
    const mat = new THREE.ShaderMaterial({...patMatBase, uniforms: {
      uBend: bendU.uBend, uBendPy: bendU.uBendPy,
      uTime: {value: 0}, uFog: {value: opts.fogDensity || FOG_DENSITY}, uOp: {value: 0}, uBass: {value: 0}, uHigh: {value: 0},
      uReduced: {value: 0}, uFront: {value: 0}, uSweep: {value: 0}, uInv: {value: 0}, uInk: {value: new THREE.Color(INVERSE_INK)},
      uAccent: {value: new THREE.Color()}, uComp: {value: new THREE.Color()},
      uPulse: {value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]}}});
    disposables.push(mat);
    const mesh = new THREE.LineSegments(built.geo, mat); mesh.frustumCulled = false; mesh.visible = false;
    truss.add(mesh);
    return {mesh, mat, period: built.period, segments: built.segments, w: 0, name: gen.name.slice(3).toLowerCase()};
  });
  // non-repeating decks: shuffled, dealt in order, reshuffled only when exhausted, never the same card twice in a row
  function makeDeck(n, seed) {
    const d = {cards: [], pos: 0, last: -1, n, seed, shuffles: 0};
    d.deal = () => {
      if (d.pos >= d.cards.length) {
        let tries = 0;
        do {
          d.cards = Array.from({length: n}, (_, i) => i);
          for (let i = n - 1; i > 0; i--) { const j = Math.floor(hash(i + d.shuffles * 131 + tries * 17, seed) * (i + 1)); [d.cards[i], d.cards[j]] = [d.cards[j], d.cards[i]]; }
          tries++;
        } while (d.cards[0] === d.last && tries < 8);
        d.shuffles++; d.pos = 0;
      }
      d.last = d.cards[d.pos++]; return d.last;
    };
    return d;
  }
  const patternDeck = makeDeck(patterns.length, 141), pairDeck = makeDeck(PAT_PAIRS.length, 142);
  const runLog = [];                     // dealt runs, for the page and for tests
  function dealRun() { const r = {pattern: patternDeck.deal(), pair: pairDeck.deal()}; runLog.push(r); return r; }
  const pat = {cur: dealRun(), next: null, hold: 7, age: 0, fading: false, n: 0, dim: 0, lastMorphT: -99, beatMorph: false, beatGap: 5};
  pat.next = dealRun();
  const tessA = new THREE.Color(), tessB = new THREE.Color();   // live colour pair, lerped through the morph
  const pairColour = (pair, which) => PALETTE[PAT_PAIRS[pair][which]];
  const _h0 = {h: 0, s: 0, l: 0}, _h1 = {h: 0, s: 0, l: 0};
  function lerpHue(a, b, t) {            // HSL lerp along the shortest hue arc (three's lerpHSL takes the long way round)
    a.getHSL(_h0); b.getHSL(_h1);
    let dh = _h1.h - _h0.h; if (dh > 0.5) dh -= 1; else if (dh < -0.5) dh += 1;
    return a.setHSL(((_h0.h + dh * t) % 1 + 1) % 1, _h0.s + (_h1.s - _h0.s) * t, _h0.l + (_h1.l - _h0.l) * t);
  }
  function nextPattern() { if (!pat.fading) { pat.fading = true; pat.age = 0; pat.lastMorphT = state.t; } }
  function setPattern(i, holdSecs) {
    // force a pattern for the current run (tests); the deck keeps dealing normally after it
    pat.cur = {pattern: ((i % patterns.length) + patterns.length) % patterns.length, pair: pat.cur.pair};
    pat.fading = false; pat.age = 0; if (holdSecs != null) pat.hold = holdSecs;
  }
  function setBeatMorph(enabled, minGapSecs) { pat.beatMorph = !!enabled; if (minGapSecs != null) pat.beatGap = Math.max(0, minGapSecs); }
  function setDim(d) { pat.dim = clamp01(d); }
  const pulses = [];                     // {z0, age}

  /* ---- LOOK B: corridor edges ---- */
  const octCorner = (k, r) => [r * Math.cos(k * Math.PI / 4), r * Math.sin(k * Math.PI / 4)];
  const edgeGeo = (() => {
    const p = [];
    for (let k = 0; k < 8; k++) { const [x, y] = octCorner(k, OCT_R); p.push(x, y, 0, x, y, -GRID_LEN); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); disposables.push(g); return g;
  })();
  const edgeMat = lineMat(), edgeMat2 = lineMat(), edgeMatR = lineMat(), edgeMatC = lineMat();
  const edges = new THREE.LineSegments(edgeGeo, edgeMat);
  const edges2 = new THREE.LineSegments(edgeGeo, edgeMat2); edges2.rotation.z = DOUBLE_EDGE_ANGLE;
  const edgesR = new THREE.LineSegments(edgeGeo, edgeMatR); edgesR.position.x = SPLIT_OFFSET;
  const edgesC = new THREE.LineSegments(edgeGeo, edgeMatC); edgesC.position.x = -SPLIT_OFFSET;
  for (const l of [edges, edges2, edgesR, edgesC]) { l.frustumCulled = false; truss.add(l); }

  /* ---- LOOK B: tumbling wireframe solids in the wall band, edges baked into 3 LineSegments each frame ---- */
  const SOLID_DEFS = [
    {v: [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(p => p.map(x => x * 0.5)),
     e: [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]]},                                   // cube
    {v: [[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]].map(p => p.map(x => x * 0.5)), e: [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]]},   // tetrahedron
    {v: [[0.6,0,0],[-0.6,0,0],[0,0.6,0],[0,-0.6,0],[0,0,0.6],[0,0,-0.6]], e: [[0,2],[0,3],[0,4],[0,5],[1,2],[1,3],[1,4],[1,5],[2,4],[2,5],[3,4],[3,5]]}, // octahedron
  ];
  const solidMat = bendable(new THREE.LineBasicMaterial({color: 0xffffff, transparent: true, opacity: SOLID_OP, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false}));
  disposables.push(solidMat);
  const perType = Math.ceil(SOLID_N / SOLID_DEFS.length);
  const solidSets = SOLID_DEFS.map((def, ty) => {
    const arr = new Float32Array(perType * def.e.length * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3).setUsage(THREE.DynamicDrawUsage));
    disposables.push(g);
    const mesh = new THREE.LineSegments(g, solidMat); mesh.frustumCulled = false; truss.add(mesh);
    return {def, mesh, arr};
  });
  const sPos = new Float32Array(SOLID_N * 3), sAxis = new Float32Array(SOLID_N * 3), sSize = new Float32Array(SOLID_N);
  const sSpin = new Float32Array(SOLID_N), sPh = new Float32Array(SOLID_N);
  for (let i = 0; i < SOLID_N; i++) {
    const r = SOLID_BAND[0] + hash(i, 101) * (SOLID_BAND[1] - SOLID_BAND[0]), an = hash(i, 102) * Math.PI * 2;
    sPos[i * 3] = r * Math.cos(an); sPos[i * 3 + 1] = r * Math.sin(an); sPos[i * 3 + 2] = -hash(i, 103) * SOLID_SEG;
    const ax = hash(i, 104) - 0.5, ay = hash(i, 105) - 0.5, az = hash(i, 106) - 0.5, al = Math.hypot(ax, ay, az) || 1;
    sAxis[i * 3] = ax / al; sAxis[i * 3 + 1] = ay / al; sAxis[i * 3 + 2] = az / al;
    sSize[i] = SOLID_SIZE[0] + hash(i, 107) * (SOLID_SIZE[1] - SOLID_SIZE[0]);
    sSpin[i] = SOLID_SPIN[0] + hash(i, 108) * (SOLID_SPIN[1] - SOLID_SPIN[0]);
    sPh[i] = hash(i, 109) * Math.PI * 2;
  }
  const _q = new THREE.Quaternion(), _ax = new THREE.Vector3(), _rm = new THREE.Matrix3(), _rq = new THREE.Matrix4(), _o = new THREE.Object3D();

  /* ---- extra looks: starfield, nebula, wiregrid, blackout ---- */
  const looks = {};
  for (const n of LOOK_NAMES) looks[n] = {w: n === 'cage' ? 1 : 0, group: null};
  looks.cage.group = cage; looks.tessellation.group = truss;
  const lookCtl = {name: null, fade: LOOK_FADE};
  const starGroup = new THREE.Group(), nebGroup = new THREE.Group(), gridGroup = new THREE.Group(), blackGroup = new THREE.Group();
  const memGroup = new THREE.Group(), plungeGroup = new THREE.Group(), landGroup = new THREE.Group();
  looks.memory.group = memGroup; looks.plunge.group = plungeGroup; looks.landing.group = landGroup;
  looks.starfield.group = starGroup; looks.nebula.group = nebGroup; looks.wiregrid.group = gridGroup; looks.blackout.group = blackGroup;
  for (const g of [starGroup, nebGroup, gridGroup, blackGroup, memGroup, plungeGroup, landGroup]) { g.visible = false; group.add(g); }

  function starMaterial(spike, maxPx) {
    const m = new THREE.ShaderMaterial({vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false,
      uniforms: {uBend: bendU.uBend, uBendPy: bendU.uBendPy, uTime: {value: 0}, uHeight: {value: 620}, uStretch: {value: 0}, uFog: {value: opts.fogDensity || FOG_DENSITY},
        uWeight: {value: 0}, uCamZ: {value: 0}, uSeg: {value: 1000}, uReduced: {value: 0}, uHigh: {value: 0}, uMaxPx: {value: maxPx},
        uSpike: {value: spike ? 1 : 0}, uTintA: {value: new THREE.Color(1, 1, 1)}, uTintB: {value: new THREE.Color(1, 1, 1)}}});
    disposables.push(m); return m;
  }
  function pointCloud(n, seg, rRange, sizeRange, mat, seedBase) {
    const pos = new Float32Array(n * 3), size = new Float32Array(n), seed = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = rRange[0] + hash(i + seedBase, 1) * (rRange[1] - rRange[0]), an = hash(i + seedBase, 2) * Math.PI * 2;
      pos[i * 3] = r * Math.cos(an); pos[i * 3 + 1] = r * Math.sin(an); pos[i * 3 + 2] = -hash(i + seedBase, 3) * seg;
      size[i] = sizeRange[0] + hash(i + seedBase, 4) * (sizeRange[1] - sizeRange[0]);
      seed[i * 3] = hash(i + seedBase, 5) * Math.PI * 2; seed[i * 3 + 1] = 0.6 + hash(i + seedBase, 6) * 3.5; seed[i * 3 + 2] = hash(i + seedBase, 7);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    disposables.push(g);
    mat.uniforms.uSeg.value = seg;
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false;
    return {pts, mat, n};
  }
  // starfield: 6000 stars, 40 bright diffraction stars, a deep blue-black tube behind
  const stars = pointCloud(STAR_N, STAR_SEG, STAR_R, STAR_SIZE, starMaterial(false, STAR_MAX_PX), 5000);
  const bright = pointCloud(BRIGHT_N, STAR_SEG, BRIGHT_R, BRIGHT_SIZE, starMaterial(true, 160), 9000);
  const backdropGeo = new THREE.CylinderGeometry(STAR_BACKDROP_R, STAR_BACKDROP_R, 1600, 24, 1, true); backdropGeo.rotateX(Math.PI / 2);
  const backdropMat = bendable(new THREE.MeshBasicMaterial({color: STAR_BACKDROP, side: THREE.BackSide, transparent: true, opacity: 0, fog: false, depthWrite: false}));
  disposables.push(backdropGeo, backdropMat);
  const backdrop = new THREE.Mesh(backdropGeo, backdropMat); backdrop.renderOrder = -5; backdrop.frustumCulled = false;
  starGroup.add(backdrop, stars.pts, bright.pts);
  // nebula: 400 big soft billboards plus dust
  const nebTex = radialTexture(THREE, 256); disposables.push(nebTex);
  const nebMat = bendable(new THREE.MeshBasicMaterial({map: nebTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: false, toneMapped: false}));
  const nebGeo = new THREE.PlaneGeometry(1, 1); disposables.push(nebMat, nebGeo);
  const neb = new THREE.InstancedMesh(nebGeo, nebMat, NEB_N);
  neb.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  neb.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NEB_N * 3), 3); neb.instanceColor.setUsage(THREE.DynamicDrawUsage);
  neb.frustumCulled = false; neb.renderOrder = -2;
  const nPos = new Float32Array(NEB_N * 3), nSize = new Float32Array(NEB_N), nOp = new Float32Array(NEB_N), nCls = new Uint8Array(NEB_N), nPh = new Float32Array(NEB_N);
  for (let i = 0; i < NEB_N; i++) {
    const r = NEB_R[0] + hash(i, 121) * (NEB_R[1] - NEB_R[0]), an = hash(i, 122) * Math.PI * 2;
    nPos[i * 3] = r * Math.cos(an); nPos[i * 3 + 1] = r * Math.sin(an); nPos[i * 3 + 2] = -hash(i, 123) * NEB_SEG;
    nSize[i] = NEB_SIZE[0] + hash(i, 124) * (NEB_SIZE[1] - NEB_SIZE[0]);
    const clump = Math.pow(hash(i, 128), 1.4);      // most sprites faint, a few dense
    nOp[i] = (NEB_OP[0] + clump * (NEB_OP[1] - NEB_OP[0])) * (1 - NEB_CLUMP + NEB_CLUMP * hash(i, 125));
    nCls[i] = hash(i, 126) < 0.6 ? 0 : 1; nPh[i] = hash(i, 127) * Math.PI * 2;
  }
  const nArr = neb.instanceMatrix.array, nCol = neb.instanceColor.array; nArr.fill(0);
  const dust = pointCloud(DUST_N, DUST_SEG, DUST_R, [DUST_SIZE, DUST_SIZE * 1.6], starMaterial(false, 24), 13000);
  nebGroup.add(neb, dust.pts);
  // wiregrid: floor and ceiling, 12-unit cells, reuses the pattern shader with its own pulse list
  const gridGeoW = (() => {
    const p = [], c = [], L = GRID_LEN + GRID_CELL;
    for (const y of [GRID_Y, -GRID_Y]) {
      for (let x = -GRID_HALF; x <= GRID_HALF; x += GRID_CELL) for (let z = 0; z < L; z += GRID_CELL) {   // subdivided so brightness can vary along z
        p.push(x, y, -z, x, y, -z - GRID_CELL); const h = hash(x * 3 + z + y, 131); c.push(h, h); }
      for (let z = 0; z <= L; z += GRID_CELL) { p.push(-GRID_HALF, y, -z, GRID_HALF, y, -z); c.push(hash(z + y, 132), hash(z + y, 132)); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('aCell', new THREE.Float32BufferAttribute(c, 1));
    disposables.push(g); return g;
  })();
  const gridMatW = new THREE.ShaderMaterial({...patMatBase, uniforms: {
    uBend: bendU.uBend, uBendPy: bendU.uBendPy,
    uTime: {value: 0}, uFog: {value: opts.fogDensity || FOG_DENSITY}, uOp: {value: 0}, uBass: {value: 0}, uHigh: {value: 0},
    uReduced: {value: 0}, uAccent: {value: new THREE.Color()}, uComp: {value: new THREE.Color()},
    uPulse: {value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]}}});
  disposables.push(gridMatW);
  const wiregrid = new THREE.LineSegments(gridGeoW, gridMatW); wiregrid.frustumCulled = false;
  gridGroup.add(wiregrid);
  const gridPulses = [];
  // blackout: one soft accent light ahead, a little dust
  const blackLight = new THREE.PointLight(0xffffff, BLACKOUT_LIGHT.intensity, 0, 2);
  const blackDust = pointCloud(BLACKOUT_DUST, DUST_SEG, DUST_R, [DUST_SIZE, DUST_SIZE * 1.4], starMaterial(false, 20), 17000);
  blackGroup.add(blackLight, blackDust.pts);

  /* ---- memory: the walls become monitors ---- */
  const MEM_N = 8 * MEM_PER_FACE * (MEM_SEG / MEM_PITCH);
  const memPanelGeo = new THREE.PlaneGeometry(MEM_W, MEM_H);          // local x runs along the corridor, y across the wall, z faces the axis
  const memBezelGeo = new THREE.PlaneGeometry(MEM_W + MEM_BEZEL * 2, MEM_H + MEM_BEZEL * 2);
  const memGlowGeo = new THREE.PlaneGeometry(MEM_W * 1.9, MEM_H * 2.4);
  disposables.push(memPanelGeo, memBezelGeo, memGlowGeo);
  const memBase = new Float32Array(MEM_N * 16), memZ = new Float32Array(MEM_N), memBorn = new Float32Array(MEM_N), memTex = new Uint8Array(MEM_N);
  const memWall = new Uint8Array(MEM_N), memU = new Float32Array(MEM_N), memTilt = new Float32Array(MEM_N);
  for (let i = 0; i < MEM_N; i++) {
    const slot = Math.floor(i / 8), k = i % 8;
    memWall[i] = k; memU[i] = (hash(i, 151) - 0.5) * 30; memTilt[i] = MEM_TILT + (hash(i, 152) - 0.5) * 2 * MEM_JITTER;
    // staggered around the ring: each face's panel sits at a different depth within the pitch, so only two or three faces carry one at any depth
    memZ[i] = -(slot + ((k * 3) % 8 + 0.5 + (hash(i, 154) - 0.5) * 0.4) / 8) * (MEM_PITCH / MEM_PER_FACE);
  }
  const _mx = new THREE.Vector3(), _my = new THREE.Vector3(), _mz = new THREE.Vector3(), _mm = new THREE.Matrix4();
  function memMatrix(i, inset, out, off) {
    const ak = (memWall[i] + 0.5) * Math.PI / 4, nx = Math.cos(ak), ny = Math.sin(ak), tx = -ny, ty = nx;
    const dist = OCT_APOTHEM - inset, u = memU[i], z = memZ[i];
    // y: across the wall, chosen up-ish so images are never upside down; z: toward the axis; x = y cross z keeps the front face inward
    _my.set(tx, ty, 0); if (ty < -0.05 || (Math.abs(ty) <= 0.05 && tx < 0)) _my.negate();
    _mz.set(-nx, -ny, 0); _mx.crossVectors(_my, _mz);
    _mm.makeBasis(_mx, _my, _mz);
    _o.quaternion.setFromRotationMatrix(_mm); _o.rotateY(memTilt[i]);     // lean the far edge in toward the axis
    _o.position.set(nx * dist + tx * u, ny * dist + ty * u, z); _o.scale.set(1, 1, 1); _o.updateMatrix();
    _o.matrix.toArray(out, off);
  }
  const memTexMats = [], memPanels = [];
  const memPanelCompile = sh => {
    bendCompile(sh);
    sh.uniforms.uMemTime = memU_time; sh.uniforms.uKen = {value: 0};
    sh.vertexShader = sh.vertexShader.replace('void main() {', 'attribute float aBorn; uniform float uMemTime, uKen; varying float vLife;\nvoid main() {\n vLife = clamp((uMemTime - aBorn) / ' + MEM_LIFE.toFixed(2) + ', 0.0, 1.0);');
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'varying float vLife; uniform float uKen;\nvoid main() {')
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          float ks = 1.0 / (1.0 + uKen * vLife);
          vec2 kuv = (vMapUv - 0.5) * ks + 0.5;
          vec4 sampledDiffuseColor = texture2D( map, kuv );
          float scan = ${(1 - MEM_SCAN).toFixed(2)} + ${MEM_SCAN.toFixed(2)} * step(0.5, fract(kuv.y * 90.0));
          diffuseColor *= sampledDiffuseColor * scan;
        #endif`);
  };
  const memU_time = {value: 0};
  const memBornAttrs = [];
  for (let t = 0; t < MEM_MAX_TEX; t++) {
    const m = new THREE.MeshBasicMaterial({color: 0xffffff, toneMapped: false});
    m.onBeforeCompile = sh => { memPanelCompile(sh); m.userData.shader = sh; }; m.customProgramCacheKey = () => 'mem';
    disposables.push(m);
    const im = new THREE.InstancedMesh(memPanelGeo.clone(), m, MEM_N);
    const born = new THREE.InstancedBufferAttribute(new Float32Array(MEM_N), 1); born.setUsage(THREE.DynamicDrawUsage);
    im.geometry.setAttribute('aBorn', born); disposables.push(im.geometry);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.frustumCulled = false; im.count = 0;
    memGroup.add(im); memTexMats.push(m); memPanels.push(im); memBornAttrs.push(born);
  }
  const memBezelMat = bendable(new THREE.MeshBasicMaterial({color: 0x07080c, toneMapped: false})); disposables.push(memBezelMat);
  const memBezel = new THREE.InstancedMesh(memBezelGeo, memBezelMat, MEM_N); memBezel.instanceMatrix.setUsage(THREE.DynamicDrawUsage); memBezel.frustumCulled = false;
  const memGlowTex = radialTexture(THREE, 128); disposables.push(memGlowTex);
  const memGlowMat = bendable(new THREE.MeshBasicMaterial({map: memGlowTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}));
  disposables.push(memGlowMat);
  const memGlow = new THREE.InstancedMesh(memGlowGeo, memGlowMat, MEM_N); memGlow.instanceMatrix.setUsage(THREE.DynamicDrawUsage); memGlow.frustumCulled = false;
  memGlow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MEM_N * 3), 3); memGlow.instanceColor.setUsage(THREE.DynamicDrawUsage);
  memGlow.renderOrder = -1;
  memGroup.add(memBezel, memGlow);
  const memItems = {list: [], avg: []};
  function noSignalTexture() {
    // broadcast slate: big mono NO SIGNAL over a dark field, colour bars along the bottom
    const c = document.createElement('canvas'); c.width = 512; c.height = 288;
    const g = c.getContext('2d');
    g.fillStyle = '#0b0d12'; g.fillRect(0, 0, 512, 288);
    for (let y = 0; y < 288; y += 4) { g.fillStyle = y % 8 ? '#0e1117' : '#0b0d12'; g.fillRect(0, y, 512, 2); }
    g.strokeStyle = '#2a3140'; g.lineWidth = 2; g.strokeRect(14, 14, 484, 214);
    g.fillStyle = '#c9d2de'; g.font = 'bold 64px ui-monospace, Menlo, monospace'; g.textAlign = 'center';
    g.fillText('NO SIGNAL', 256, 128);
    g.fillStyle = '#5a6473'; g.font = '16px ui-monospace, Menlo, monospace'; g.fillText('MEMORY BUS  //  AWAITING CLIPS', 256, 172);
    const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
    bars.forEach((col, i) => { g.fillStyle = col; g.fillRect(i * 512 / 7, 238, 512 / 7 + 1, 50); });
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; disposables.push(t); return t;
  }
  const memNoSignal = noSignalTexture();
  function averageColour(tex) {
    try {
      const img = tex.image; if (!img || (img.readyState != null && img.readyState < 2)) return new THREE.Color(0x445566);
      const c = document.createElement('canvas'); c.width = c.height = 4;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, 4, 4);
      const d = g.getImageData(0, 0, 4, 4).data; let r = 0, gg = 0, b = 0;
      for (let i = 0; i < 64; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
      return new THREE.Color(r / 16 / 255, gg / 16 / 255, b / 16 / 255);
    } catch (e) { return new THREE.Color(0x445566); }
  }
  function setMemories(items) {
    const list = (items && items.length ? items : [{texture: memNoSignal, kind: 'photo'}]).slice(0, MEM_MAX_TEX);
    memItems.list = list; memItems.avg = list.map(it => averageColour(it.texture));
    for (let t = 0; t < MEM_MAX_TEX; t++) {
      const it = list[t]; const m = memTexMats[t];
      m.map = it ? it.texture : null; m.needsUpdate = true;
      memPanels[t].visible = !!it;
    }
    for (let i = 0; i < MEM_N; i++) memTex[i] = (i + Math.floor(hash(i, 153) * 3)) % list.length;
  }
  setMemories([]);

  /* ---- plunge: a spherical field of hard wireframe solids around the camera ---- */
  const ICO = (() => { const t = (1 + Math.sqrt(5)) / 2, v = [[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]].map(p => p.map(x => x * 0.26));
    const e = []; for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) { const d = Math.hypot(v[i][0]-v[j][0], v[i][1]-v[j][1], v[i][2]-v[j][2]); if (d < 0.6) e.push([i, j]); } return {v, e}; })();
  const SHARD_DEF = {v: [[0, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0]].map(p => [p[0] * 0.18, p[1] * 0.18, p[2]]), e: [[0, 1], [1, 2], [2, 0]]};   // thin triangle, stretched along z at bake time
  const PLUNGE_DEFS = [SOLID_DEFS[0], SOLID_DEFS[2], SOLID_DEFS[1], ICO, SHARD_DEF];   // cube, octa, tetra, icosa, shard
  const plungeSets = PLUNGE_DEFS.map(def => {
    const cap = PLUNGE_CAP * 1.6, arr = new Float32Array(cap * def.e.length * 6), col = new Float32Array(cap * def.e.length * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    const m = bendable(new THREE.LineBasicMaterial({vertexColors: true, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}));
    disposables.push(g, m);
    const mesh = new THREE.LineSegments(g, m); mesh.frustumCulled = false; mesh.visible = false; plungeGroup.add(mesh);
    return {def, mesh, arr, col, cap};
  });
  const pR = new Float32Array(PLUNGE_N), pTh = new Float32Array(PLUNGE_N), pZ = new Float32Array(PLUNGE_N), pSize = new Float32Array(PLUNGE_N);
  const pAxis = new Float32Array(PLUNGE_N * 3), pSpin = new Float32Array(PLUNGE_N), pPh = new Float32Array(PLUNGE_N), pSecond = new Uint8Array(PLUNGE_N);
  for (let i = 0; i < PLUNGE_N; i++) {
    pR[i] = PLUNGE_R[0] + Math.sqrt(hash(i, 161)) * (PLUNGE_R[1] - PLUNGE_R[0]); pTh[i] = hash(i, 162) * Math.PI * 2;
    pZ[i] = -hash(i, 163) * PLUNGE_SEG;
    pSize[i] = PLUNGE_SIZE[0] + Math.pow(hash(i, 164), 1.6) * (PLUNGE_SIZE[1] - PLUNGE_SIZE[0]);
    const ax = hash(i, 165) - 0.5, ay = hash(i, 166) - 0.5, az = hash(i, 167) - 0.5, al = Math.hypot(ax, ay, az) || 1;
    pAxis[i * 3] = ax / al; pAxis[i * 3 + 1] = ay / al; pAxis[i * 3 + 2] = az / al;
    pSpin[i] = 0.2 + hash(i, 168) * 0.6; pPh[i] = hash(i, 169) * Math.PI * 2; pSecond[i] = hash(i, 170) < PLUNGE_SECOND_FRAC ? 1 : 0;
  }
  const plunge = {shape: 0, prev: 0, morph: 9, pair: pairDeck.last, colA: new THREE.Color(), colB: new THREE.Color(), stage: null, stageT0: 0, cut: 0, invT: 9, flashT: 9};
  const _inkA = new THREE.Color(), _inkB = new THREE.Color(), _pc2 = new THREE.Color();
  const pInkSkip = new Uint8Array(PLUNGE_N); for (let i = 0; i < PLUNGE_N; i++) pInkSkip[i] = hash(i, 174) > PLUNGE_INK_FRAC ? 1 : 0;
  const pHuge = new Uint8Array(PLUNGE_N); for (let i = 0; i < PLUNGE_N; i++) pHuge[i] = hash(i, 173) < PLUNGE_HUGE_FRAC ? 1 : 0;
  function plungeStage(name, cutSecs) {
    if (name != null && !PLUNGE_STAGES.includes(name)) throw new Error('unknown plunge stage ' + name);
    plunge.stage = name; plunge.stageT0 = state.t; plunge.cut = cutSecs == null ? 0 : Math.max(0, cutSecs);
  }
  function bakedLines(cap) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 6), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cap * 6), 3).setUsage(THREE.DynamicDrawUsage));
    const m = bendable(new THREE.LineBasicMaterial({vertexColors: true, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}));
    disposables.push(g, m);
    const mesh = new THREE.LineSegments(g, m); mesh.frustumCulled = false; mesh.visible = false; plungeGroup.add(mesh); return mesh;
  }
  const latticeMesh = bakedLines(12000), ringsMesh = bakedLines(400);
  // stairs are static: a square helix of wireframe treads, periodic per turn
  const stairsMat = bendable(new THREE.LineBasicMaterial({color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}));
  const stairsMesh = (() => {
    const {steps, radius, rise, tread, turnZ} = PLUNGE_STAIRS, p = [], L = GRID_LEN + turnZ, n = Math.ceil(L / rise);
    const [tw, th, td] = tread;
    for (let i = 0; i < n; i++) {
      const a = (i % steps) * Math.PI * 2 / steps, z = -i * rise, c = Math.cos(a), sn = Math.sin(a);
      const P = (u, v, w) => [c * (radius + u) - sn * v, sn * (radius + u) + c * v, z + w];   // u radial, v tangential, w along z
      const corners = [[-td / 2, -tw / 2, 0], [td / 2, -tw / 2, 0], [td / 2, tw / 2, 0], [-td / 2, tw / 2, 0]].map(q => P(q[0], q[1], q[2]));
      const lower = corners.map(q => [q[0], q[1], q[2] - th]);
      const seg = (A, B) => p.push(A[0], A[1], A[2], B[0], B[1], B[2]);
      for (let k = 0; k < 4; k++) { seg(corners[k], corners[(k + 1) % 4]); seg(lower[k], lower[(k + 1) % 4]); seg(corners[k], lower[k]); }
      for (let k = 1; k < 4; k++) { const f = k / 4; seg(P(-td / 2 + f * td, -tw / 2, 0), P(-td / 2 + f * td, tw / 2, 0)); }   // tread lines, so the slab reads solid
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); disposables.push(g, stairsMat);
    const mesh = new THREE.LineSegments(g, stairsMat); mesh.frustumCulled = false; mesh.visible = false; plungeGroup.add(mesh); return mesh;
  })();
  function plungeColours() { plunge.colA.setHex(pairColour(plunge.pair, 0)); plunge.colB.setHex(pairColour(plunge.pair, 1)); }
  plunge.pair = Math.max(0, plunge.pair); plungeColours();
  function deal() {                      // shape morph + colour snap, from the same no-repeat decks
    plunge.prev = plunge.shape; plunge.shape = (plunge.shape + 1) % PLUNGE_SHARD_SET; plunge.morph = 0;   // cycles the four solids, never the shard set
    plunge.pair = pairDeck.deal(); plungeColours();
  }
  function bakeSolid(set, off, cx, cy, cz, size, e, col, stretchZ) {
    const arr = set.arr, carr = set.col, def = set.def; let o = off;
    for (const [ia, ib] of def.e) for (const iv of [ia, ib]) {
      const v = def.v[iv], x = v[0] * size, y = v[1] * size, w = v[2] * size;
      arr[o] = e[0] * x + e[3] * y + e[6] * w + cx; arr[o + 1] = e[1] * x + e[4] * y + e[7] * w + cy; arr[o + 2] = (e[2] * x + e[5] * y + e[8] * w) * stretchZ + cz;
      carr[o] = col.r; carr[o + 1] = col.g; carr[o + 2] = col.b; o += 3;
    }
    return o;
  }
  const _rgb = [new THREE.Color(1, 0.05, 0.05), new THREE.Color(0.05, 1, 0.05), new THREE.Color(0.05, 0.05, 1)], _pc = new THREE.Color();

  /* ---- landing: a floor, a horizon, dust ---- */
  const LAND_VERT = /* glsl */`
    ${BEND_GLSL}
    attribute float aCell;
    uniform float uOp, uFog, uCamZ, uTime;
    uniform vec4 uImpact;          // x, z, age, strength
    uniform vec3 uCol;
    varying vec3 vCol;
    void main(){
      vec4 wp = modelMatrix * vec4(position, 1.0);
      float dxy = length(vec2(wp.x, wp.z - uCamZ));
      float fade = 1.0 - smoothstep(${LAND_FADE[0].toFixed(1)}, ${LAND_FADE[1].toFixed(1)}, dxy);
      float b = ${LAND_OP.toFixed(2)} * fade * (0.85 + 0.15 * sin(uTime * 1.3 + aCell * 20.0));
      if (uImpact.w > 0.0) {
        float age = uImpact.z;
        float ring = ${IMPACT_RING.radius.toFixed(1)} * min(1.0, age / ${IMPACT_RING.secs.toFixed(2)});
        float d = length(vec2(wp.x - uImpact.x, wp.z - uImpact.y));
        float near = exp(-pow((d - ring) / 22.0, 2.0)) + 0.5 * exp(-d / 40.0);
        b += uImpact.w * near * exp(-age * 2.2) * (1.0 + ${IMPACT_BOUNCE.toFixed(2)} * cos(6.2832 * age / 0.25)) * 1.6;
      }
      wp.xy += bendOffset(wp.z);
      vec4 mv = viewMatrix * wp;
      float f = uFog * (-mv.z); float fog = exp(-f * f);
      vCol = uCol * b * fog * uOp;
      gl_Position = projectionMatrix * mv;
    }`;
  const LAND_FRAG = /* glsl */`varying vec3 vCol; void main(){ gl_FragColor = vec4(vCol, 1.0); }`;
  const landGeo = (() => {
    const p = [], c = [], H = LAND_SIZE / 2;
    for (let x = -H; x <= H; x += LAND_CELL) for (let z = 0; z < LAND_SIZE; z += LAND_PIECE) { p.push(x, LAND_Y, -z, x, LAND_Y, -z - LAND_PIECE); const h = hash(x + z * 3, 171); c.push(h, h); }
    for (let z = 0; z <= LAND_SIZE; z += LAND_CELL) for (let x = -H; x < H; x += LAND_PIECE) { p.push(x, LAND_Y, -z, x + LAND_PIECE, LAND_Y, -z); const h = hash(x * 3 + z, 172); c.push(h, h); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('aCell', new THREE.Float32BufferAttribute(c, 1));
    disposables.push(g); return g;
  })();
  const landMat = new THREE.ShaderMaterial({vertexShader: LAND_VERT, fragmentShader: LAND_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    uniforms: {uBend: bendU.uBend, uBendPy: bendU.uBendPy, uOp: {value: 0}, uFog: {value: opts.fogDensity || FOG_DENSITY}, uCamZ: {value: 0}, uTime: {value: 0},
      uImpact: {value: new THREE.Vector4(0, 0, 0, 0)}, uCol: {value: new THREE.Color()}}});
  disposables.push(landMat);
  const landFloor = new THREE.LineSegments(landGeo, landMat); landFloor.frustumCulled = false; landGroup.add(landFloor);
  const horizonGeo = new THREE.PlaneGeometry(LAND_HORIZON.width, LAND_HORIZON.height); disposables.push(horizonGeo);
  const horizonMat = bendable(new THREE.MeshBasicMaterial({map: memGlowTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false}));
  disposables.push(horizonMat);
  const horizon = new THREE.Mesh(horizonGeo, horizonMat); horizon.frustumCulled = false; landGroup.add(horizon);
  const landDust = pointCloud(LAND_DUST, DUST_SEG, [4, 200], [DUST_SIZE, DUST_SIZE * 1.6], starMaterial(false, 20), 21000);
  landGroup.add(landDust.pts);
  // lights so a figure standing on the plane is lit: the blackout accent light ahead, a warm key from front-left, a cool fill from behind
  const landLight = new THREE.PointLight(0xffffff, BLACKOUT_LIGHT.intensity, 0, 2);
  const landKey = new THREE.DirectionalLight(LAND_KEY.color, LAND_KEY.intensity); landKey.position.set(-1, 0.8, 1);
  const landFill = new THREE.DirectionalLight(LAND_FILL.color, LAND_FILL.intensity); landFill.position.set(0.4, 0.5, -1);
  landGroup.add(landLight, landKey, landFill);
  const ringGeo = new THREE.RingGeometry(0.9, 1, 64); ringGeo.rotateX(-Math.PI / 2); disposables.push(ringGeo);
  const ringMat = bendable(new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false}));
  disposables.push(ringMat);
  const impactRing = new THREE.Mesh(ringGeo, ringMat); impactRing.visible = false; landGroup.add(impactRing);
  const impactState = {age: 99, strength: 0, x: 0, z: 0};
  function impact(strength, atZ) {
    impactState.age = 0; impactState.strength = clamp01(strength == null ? 1 : strength);
    impactState.z = atZ == null ? state.camZ - 35 : atZ; impactState.x = 0;
  }
  const landingY = () => LAND_Y;

  function setLook(name, fadeSecs) {
    if (name != null && !looks[name]) throw new Error('unknown look ' + name);
    lookCtl.name = name; lookCtl.fade = fadeSecs == null ? LOOK_FADE : Math.max(0, fadeSecs);
  }

  /* ---- colour ---- */
  function setPhaseColours(phase) {
    const p = ((phase % 1) + 1) % 1;
    let i = 0;
    while (i < PHASE_STOPS.length - 2 && p > PHASE_STOPS[i + 1][0]) i++;
    const [p0, a0, c0] = PHASE_STOPS[i], [p1, a1, c1] = PHASE_STOPS[i + 1];
    const t = clamp01((p - p0) / (p1 - p0));
    accent.setHex(a0).lerp(tmpA.setHex(a1), t);
    comp.setHex(c0).lerp(tmpB.setHex(c1), t);
  }

  /* ---- update ---- */
  const stats = {blocks: BLOCK_N, patternSegments: patterns.map(p => p.segments), solids: SOLID_N, stars: STAR_N + BRIGHT_N, nebula: NEB_N, dust: DUST_N};

  function update(s) {
    const camZ = s.camZ || 0, v = Math.abs(s.v || 0), sp = clamp01(s.sp || 0), phase = s.phase || 0;
    const L = s.levels || null;
    const bass = L ? clamp01(L.bass || 0) : 0, high = L ? clamp01(L.high || 0) : 0, beat = L ? clamp01(L.beat || 0) : 0;
    const dt = Math.min(0.1, Math.max(0, s.dt == null ? 1 / 60 : s.dt));
    tickBend();
    const slow = !!s.slow, reduced = !!s.reduced;
    state.slow = slow; state.reduced = reduced; state.camZ = camZ;
    if (!reduced) { state.t += dt; state.gt += dt * (1 + high); }
    const t = state.t;
    // beat: fire on the rising edge only, so a decaying spike fires once
    if (L && !reduced && beat > BEAT_THRESHOLD && state.lastBeat <= BEAT_THRESHOLD) kick(beat, camZ);
    state.lastBeat = beat;
    for (let i = ripples.length - 1; i >= 0; i--) { ripples[i].age += dt; if (ripples[i].age > RIPPLE_MS) ripples.splice(i, 1); }
    const mW = mirrorWeight(camZ);
    const wallK = 1 - (1 - MIRROR_DIM) * mW;
    const stretch = Math.min(STRETCH_MAX, 1 + v * STRETCH);

    setPhaseColours(phase);
    const openK = 1 - clamp01(s.open || 0);        // walls dissolve as the tunnel opens out
    const trussRaw = smooth(FADE_OUT[0], FADE_OUT[1], phase) * (1 - smooth(FADE_IN[0], FADE_IN[1], phase));
    // look weights: phase drives cage/tessellation unless setLook() overrides; every weight moves linearly over the fade
    const want = {};
    for (const n of LOOK_NAMES) want[n] = lookCtl.name ? (n === lookCtl.name ? 1 : 0) : (n === 'cage' ? 1 - trussRaw : (n === 'tessellation' ? trussRaw : 0));
    if (lookCtl.name === 'inverse') want.tessellation = 1;    // inverse is the tessellation drawn as ink on paper
    if (lookCtl.name === 'memory') want.tessellation = MEM_LATTICE;   // the lattice runs dim between the monitors
    const rate = lookCtl.fade > 0 ? dt / lookCtl.fade : 1;
    // plunge cut list: the 'inverse' stage drives the inverse weight itself, at the cut's rate
    const stageInv = looks.plunge.w > 0.5 && plunge.stage;
    if (stageInv) want.inverse = plunge.stage === 'inverse' ? 1 : 0;
    for (const n of LOOK_NAMES) { const lk = looks[n], d = want[n] - lk.w, r = (n === 'inverse' && stageInv) ? (plunge.cut > 0 ? dt / plunge.cut : 1) : rate; lk.w += Math.abs(d) <= r ? d : Math.sign(d) * r; }
    const trussW = looks.tessellation.w * openK * wallK;
    const cageW = looks.cage.w * openK * wallK;
    const starW = looks.starfield.w * openK + looks.wiregrid.w * openK * GRID_STAR_W;
    const nebW = looks.nebula.w * openK, gridW = looks.wiregrid.w * openK, blackW = looks.blackout.w * openK;
    const invW = looks.inverse.w;
    const memW = looks.memory.w * openK, plungeW = looks.plunge.w * openK, landW = looks.landing.w * openK;
    // inverse wipes the host scene's fog and background toward paper white (captured once, restored as the weight returns to 0)
    const sc = group.parent;
    if (sc && sc.fog && sc.fog.color) {
      if (!state.fog0) { state.fog0 = sc.fog.color.clone(); state.bg0 = sc.background && sc.background.isColor ? sc.background.clone() : null; }
      sc.fog.color.copy(state.fog0).lerp(tmpB.setHex(INVERSE_BG), invW);
      if (state.bg0 && sc.background && sc.background.isColor) sc.background.copy(state.bg0).lerp(tmpB.setHex(INVERSE_BG), invW);
    }
    updateMirror(camZ, mW, slow, reduced);
    group.visible = openK > 0.004;

    /* ---------- cage ---------- */
    cage.visible = cageW > 0.004;
    if (cage.visible) {
      const sc = SCALE_IN + (1 - SCALE_IN) * cageW;
      cage.scale.set(sc, sc, 1);
      // grid: periodic in CELL, so snap to the cell in front of the recycle line
      const gz = Math.ceil((camZ + BEHIND) / CELL) * CELL;
      gridA.position.z = fineA.position.z = gridB.position.z = fineB.position.z = gz;
      strayA.position.z = strayB.position.z = Math.ceil((camZ + BEHIND) / GRID_LEN) * GRID_LEN;
      const glz = Math.ceil((camZ + BEHIND) / GLOW_TILE) * GLOW_TILE;
      for (const m of glowPlanes) m.position.z = glz;
      glowMatSide.color.copy(accent); glowMatTop.color.copy(accent);
      glowMatSide.opacity = glowMatTop.opacity = (GLOW_OP[0] + (GLOW_OP[1] - GLOW_OP[0]) * sp) * cageW;
      const op = (reduced ? (GRID_OP[0] + GRID_OP[1]) * 0.5 : GRID_OP[0] + (GRID_OP[1] - GRID_OP[0]) * sp) * cageW;
      tmpA.copy(accent).lerp(tmpB.set(1, 1, 1), 0.35).multiplyScalar(GRID_HDR);
      for (const m of [gridMat, fineMat, gridMat2, fineMat2, strayMat, strayMat2]) m.color.copy(tmpA);
      gridMat.opacity = op; fineMat.opacity = op * FINE_OP; strayMat.opacity = op * STRAY_OP;
      const dbl = smooth(DOUBLE_RAMP[0], DOUBLE_RAMP[1], v) * DOUBLE_OP;
      cageDouble.visible = dbl > 0.004;
      gridMat2.opacity = op * dbl; fineMat2.opacity = op * FINE_OP * dbl; strayMat2.opacity = op * STRAY_OP * dbl; blockMat2.opacity = dbl;

      const n = slow ? BLOCK_N >> 1 : BLOCK_N;
      blocks.count = n; blocks2.count = n;
      const decay = Math.exp(-dt * FLICKER_DECAY);
      const dim = Math.pow(stretch, -STRETCH_DIM);
      const base = BLOCK_BASE + AUDIO_BASS_GAIN * bass;
      const nr = ripples.length;
      const ar = accent.r, ag = accent.g, ab = accent.b, cr = comp.r, cg = comp.g, cb = comp.b;
      tmpA.copy(accent).lerp(tmpB.set(1, 1, 1), 0.65);
      const wr = tmpA.r, wg = tmpA.g, wb = tmpA.b;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3, i16 = i * 16;
        let z = bPos[i3 + 2];
        const sz = bScl[i3 + 2];
        while (z - sz * 0.5 > camZ + BEHIND) z -= BLOCK_SEG;
        while (z + sz * 0.5 < camZ + BEHIND - BLOCK_SEG) z += BLOCK_SEG;
        bPos[i3 + 2] = z;
        mArr[i16] = bScl[i3]; mArr[i16 + 5] = bScl[i3 + 1]; mArr[i16 + 10] = sz * stretch;
        mArr[i16 + 12] = bPos[i3]; mArr[i16 + 13] = bPos[i3 + 1]; mArr[i16 + 14] = z;
        let level;
        if (reduced) level = REDUCED_LEVEL;
        else {
          const raw = Math.sin(t * bRate[i] + bPh[i]) + Math.sin(t * bRate[i] * 1.73 + bPh[i] * 2.1);
          const env = smooth(FLICKER_EDGE[0], FLICKER_EDGE[1], raw);
          level = Math.max(env, bLevel[i] * decay);
          bLevel[i] = level;
        }
        let rip = 0;
        for (let r = 0; r < nr; r++) {
          const rp = ripples[r], dz = Math.abs(z - rp.z);
          if (dz < RIPPLE_HALF) rip += rp.strength * (1 - dz / RIPPLE_HALF) * rippleEnv(rp.age);
        }
        const b = (base + BLOCK_FLASH * level + RIPPLE_GAIN * rip) * cageW * dim;
        if (bComp[i] === 1) { cArr[i3] = cr * b; cArr[i3 + 1] = cg * b; cArr[i3 + 2] = cb * b; }
        else if (bComp[i] === 2) { cArr[i3] = wr * b; cArr[i3 + 1] = wg * b; cArr[i3 + 2] = wb * b; }
        else { cArr[i3] = ar * b; cArr[i3 + 1] = ag * b; cArr[i3 + 2] = ab * b; }
      }
      blocks.instanceMatrix.needsUpdate = true;
      blocks.instanceColor.needsUpdate = true;
    }

    /* ---------- tessellation ---------- */
    truss.visible = trussW > 0.004;
    // pattern schedule: hold 6 to 11 s (incommensurate sine sum), cross-fade 1.4 s
    pat.age += dt;
    if (!pat.fading && pat.age >= pat.hold) { pat.fading = true; pat.age = 0; }
    if (pat.beatMorph && L && !reduced && beat > BEAT_MORPH_LEVEL && beatState.lastBeat <= BEAT_MORPH_LEVEL && state.t - pat.lastMorphT >= pat.beatGap) nextPattern();
    if (pat.fading && pat.age >= PAT_FADE) {
      pat.fading = false; pat.age = 0; pat.cur = pat.next; pat.next = dealRun(); pat.n++;
      const m = 0.5 + 0.5 * (0.6 * Math.sin(pat.n * 1.7) + 0.4 * Math.sin(pat.n * 2.9));
      pat.hold = PAT_HOLD[0] + (PAT_HOLD[1] - PAT_HOLD[0]) * m;
    }
    const fadeT = pat.fading ? smooth(0, PAT_FADE, pat.age) : 0;
    for (let i = 0; i < patterns.length; i++) patterns[i].w = i === pat.cur.pattern ? 1 - fadeT : (i === pat.next.pattern ? fadeT : 0);
    // HSL lerp so the pair slides through hue, never through grey-white
    lerpHue(tessA.setHex(pairColour(pat.cur.pair, 0)), tmpA.setHex(pairColour(pat.next.pair, 0)), fadeT);
    lerpHue(tessB.setHex(pairColour(pat.cur.pair, 1)), tmpB.setHex(pairColour(pat.next.pair, 1)), fadeT);
    // the cage takes the same deck, so consecutive universes never share a colour
    accent.copy(tessA); comp.copy(tessB);
    const front = camZ - GRID_LEN + (GRID_LEN + BEHIND) * (pat.fading ? pat.age / PAT_FADE : 1);   // wavefront z, vanishing point to camera
    const dimK = 1 - 0.85 * pat.dim;
    // beat pulses (real levels: rising edge; kick() also pushes one)
    if (L && !reduced && beat > BEAT_THRESHOLD && beatState.lastBeat <= BEAT_THRESHOLD) pushPulse(camZ, beat);
    beatState.lastBeat = beat;
    for (let i = pulses.length - 1; i >= 0; i--) { pulses[i].age += dt; if (pulses[i].age > 3.5) pulses.splice(i, 1); }

    if (truss.visible) {
      const sc = SCALE_IN + (1 - SCALE_IN) * trussW;
      truss.scale.set(sc, sc, 1);
      for (const p of patterns) {
        p.mesh.visible = p.w > 0.004;
        if (!p.mesh.visible) continue;
        p.mesh.position.z = Math.ceil((camZ + BEHIND) / p.period) * p.period;
        const u = p.mat.uniforms;
        u.uTime.value = state.gt; u.uOp.value = p.w * trussW * dimK; u.uBass.value = bass; u.uHigh.value = high;
        u.uReduced.value = reduced ? 1 : 0;
        u.uFront.value = front; u.uSweep.value = pat.fading ? (p === patterns[pat.next.pattern] ? 1 : -1) : 0;
        u.uInv.value = invW; p.mat.blending = invW > 0.5 ? THREE.NormalBlending : THREE.AdditiveBlending;
        u.uAccent.value.copy(tessA); u.uComp.value.copy(tessB);
        for (let k = 0; k < PULSE_MAX; k++) {
          const pv = u.uPulse.value[k];
          if (k < pulses.length) { const q = pulses[k]; pv.set(q.z0 - PULSE_SPEED * q.age, q.amp * Math.exp(-q.age * PULSE_DECAY) * PULSE_GAIN, PULSE_WIDTH); }
          else pv.set(0, 0, 1);
        }
      }
      // corridor edges: continuous along z, snap by any step
      const ez = Math.ceil((camZ + BEHIND) / 20) * 20;
      edges.position.z = edges2.position.z = edgesR.position.z = edgesC.position.z = ez;
      const eop = (reduced ? (EDGE_OP[0] + EDGE_OP[1]) * 0.5 : EDGE_OP[0] + (EDGE_OP[1] - EDGE_OP[0]) * sp) * trussW * dimK;
      const inv = invW > 0.5;
      if (inv) tmpA.setHex(INVERSE_INK).lerp(tessA, INVERSE_TINT); else tmpA.copy(tessA).multiplyScalar(EDGE_HDR);
      edgeMat.color.copy(tmpA); edgeMat2.color.copy(tmpA);
      for (const m of [edgeMat, edgeMat2, edgeMatR, edgeMatC, solidMat]) m.blending = inv ? THREE.NormalBlending : THREE.AdditiveBlending;
      const split = smooth(SPLIT_SP[0], SPLIT_SP[1], sp);
      edgeMat.opacity = eop;
      edgeMat2.opacity = eop * split * 0.5; edges2.visible = split > 0.004;
      edgeMatR.color.setRGB(1.2, 0.1, 0.1); edgeMatC.color.setRGB(0.1, 1.0, 1.2);
      edgeMatR.opacity = edgeMatC.opacity = eop * split * SPLIT_OP; edgesR.visible = edgesC.visible = split > 0.004;

      // tumbling solids: recycle, rotate, bake edges
      if (inv) solidMat.color.setHex(INVERSE_INK).lerp(tessA, INVERSE_TINT); else solidMat.color.copy(tessA);
      solidMat.opacity = SOLID_OP * trussW * dimK;
      for (let i = 0; i < SOLID_N; i++) {
        let z = sPos[i * 3 + 2];
        while (z > camZ + BEHIND) z -= SOLID_SEG;
        while (z < camZ + BEHIND - SOLID_SEG) z += SOLID_SEG;
        sPos[i * 3 + 2] = z;
        const ty = i % SOLID_DEFS.length, set = solidSets[ty], def = set.def, j = Math.floor(i / SOLID_DEFS.length);
        const ang = sPh[i] + (reduced ? 0 : t * sSpin[i]);
        _ax.set(sAxis[i * 3], sAxis[i * 3 + 1], sAxis[i * 3 + 2]);
        _q.setFromAxisAngle(_ax, ang); _rq.makeRotationFromQuaternion(_q); _rm.setFromMatrix4(_rq);
        const e = _rm.elements, sz = sSize[i], px = sPos[i * 3], py = sPos[i * 3 + 1];
        const arr = set.arr; let o = j * def.e.length * 6;
        for (const [ia, ib] of def.e) {
          for (const iv of [ia, ib]) {
            const v = def.v[iv], x = v[0] * sz, y = v[1] * sz, w = v[2] * sz;
            arr[o++] = e[0] * x + e[3] * y + e[6] * w + px;
            arr[o++] = e[1] * x + e[4] * y + e[7] * w + py;
            arr[o++] = e[2] * x + e[5] * y + e[8] * w + z;
          }
        }
      }
      for (const set of solidSets) set.mesh.geometry.attributes.position.needsUpdate = true;
    }

    /* ---------- starfield (also faint behind the wiregrid) ---------- */
    starGroup.visible = starW > 0.004;
    if (starGroup.visible) {
      backdrop.position.z = camZ; backdropMat.opacity = looks.starfield.w * openK;
      for (const c of [stars, bright]) {
        const u = c.mat.uniforms;
        u.uTime.value = state.gt; u.uHeight.value = s.viewportHeight || u.uHeight.value; u.uStretch.value = stretch - 1;
        u.uWeight.value = starW; u.uCamZ.value = camZ; u.uReduced.value = reduced ? 1 : 0; u.uHigh.value = high;
        u.uTintA.value.setRGB(0.85, 0.9, 1.0); u.uTintB.value.copy(accent).lerp(tmpB.set(1, 1, 1), 0.6);
        c.pts.geometry.setDrawRange(0, slow ? c.n >> 1 : c.n);
      }
    }

    /* ---------- nebula ---------- */
    nebGroup.visible = nebW > 0.004;
    if (nebGroup.visible) {
      const n = slow ? NEB_N >> 1 : NEB_N;
      neb.count = n;
      const gain = (1 + NEB_BASS * bass) * nebW;
      tmpA.copy(accent); tmpB.copy(comp);
      for (let i = 0; i < n; i++) {
        let z = nPos[i * 3 + 2];
        while (z > camZ + BEHIND) z -= NEB_SEG;
        while (z < camZ + BEHIND - NEB_SEG) z += NEB_SEG;
        nPos[i * 3 + 2] = z;
        const drift = reduced ? 0 : NEB_DRIFT;
        const px = nPos[i * 3] + drift * Math.sin(t * 0.11 + nPh[i]), py = nPos[i * 3 + 1] + drift * Math.cos(t * 0.09 + nPh[i] * 1.3);
        const sz = nSize[i], i16 = i * 16;
        nArr[i16] = sz; nArr[i16 + 5] = sz; nArr[i16 + 10] = 1; nArr[i16 + 15] = 1;
        nArr[i16 + 12] = px; nArr[i16 + 13] = py; nArr[i16 + 14] = z;
        const c = nCls[i] ? tmpB : tmpA, o = nOp[i] * gain;
        nCol[i * 3] = c.r * o; nCol[i * 3 + 1] = c.g * o; nCol[i * 3 + 2] = c.b * o;
      }
      neb.instanceMatrix.needsUpdate = true; neb.instanceColor.needsUpdate = true;
      const u = dust.mat.uniforms;
      u.uTime.value = state.gt; u.uHeight.value = s.viewportHeight || u.uHeight.value; u.uStretch.value = stretch - 1;
      u.uWeight.value = nebW * 0.6; u.uCamZ.value = camZ; u.uReduced.value = reduced ? 1 : 0; u.uHigh.value = high;
      u.uTintA.value.copy(accent); u.uTintB.value.copy(comp);
      dust.pts.geometry.setDrawRange(0, slow ? dust.n >> 1 : dust.n);
    }

    /* ---------- wiregrid ---------- */
    gridGroup.visible = gridW > 0.004;
    if (gridGroup.visible) {
      wiregrid.position.z = Math.ceil((camZ + BEHIND) / GRID_CELL) * GRID_CELL;
      if (L && !reduced && beat > BEAT_THRESHOLD && beatState.lastBeatGrid <= BEAT_THRESHOLD) gridPulses.push({z0: camZ - 640, age: 0, amp: beat});
      beatState.lastBeatGrid = beat;
      if (gridPulses.length > PULSE_MAX) gridPulses.shift();
      for (let i = gridPulses.length - 1; i >= 0; i--) { gridPulses[i].age += dt; if (gridPulses[i].age > 4) gridPulses.splice(i, 1); }
      const u = gridMatW.uniforms;
      u.uTime.value = state.gt; u.uOp.value = gridW; u.uBass.value = bass; u.uHigh.value = high; u.uReduced.value = reduced ? 1 : 0;
      u.uAccent.value.copy(accent); u.uComp.value.copy(comp);
      for (let k = 0; k < PULSE_MAX; k++) {
        const pv = u.uPulse.value[k];
        if (k < gridPulses.length) { const q = gridPulses[k]; pv.set(q.z0 + GRID_PULSE_SPEED * q.age, q.amp * Math.exp(-q.age * 0.8) * PULSE_GAIN, PULSE_WIDTH); }
        else pv.set(0, 0, 1);
      }
    }

    /* ---------- blackout ---------- */
    blackGroup.visible = blackW > 0.004;
    if (blackGroup.visible) {
      { const bz = camZ - BLACKOUT_LIGHT.dist, c = curve(bz); blackLight.position.set(c.x, c.y, bz); }
      blackLight.color.copy(accent).lerp(tmpB.set(1, 1, 1), 0.3);
      blackLight.intensity = BLACKOUT_LIGHT.intensity * blackW * (1 + 0.5 * bass);
      const u = blackDust.mat.uniforms;
      u.uTime.value = state.gt; u.uHeight.value = s.viewportHeight || u.uHeight.value; u.uStretch.value = stretch - 1;
      u.uWeight.value = blackW * 0.35; u.uCamZ.value = camZ; u.uReduced.value = reduced ? 1 : 0; u.uHigh.value = high;
      u.uTintA.value.copy(accent); u.uTintB.value.setRGB(0.7, 0.7, 0.8);
    }

    /* ---------- memory ---------- */
    memGroup.visible = memW > 0.004;
    if (memGroup.visible) {
      memU_time.value = state.t;
      const counts = new Array(MEM_MAX_TEX).fill(0);
      const bArr = memBezel.instanceMatrix.array, gArr = memGlow.instanceMatrix.array, gCol = memGlow.instanceColor.array;
      let bornDirty = false;
      for (let i = 0; i < MEM_N; i++) {
        let z = memZ[i], moved = false;
        while (z > camZ + BEHIND) { z -= MEM_SEG; moved = true; }
        while (z < camZ + BEHIND - MEM_SEG) { z += MEM_SEG; moved = true; }
        if (moved) { memZ[i] = z; memBorn[i] = state.t; bornDirty = true; }
        const t = memTex[i], panel = memPanels[t];
        if (!panel.visible) continue;
        const slot = counts[t]++;
        memMatrix(i, MEM_INSET, panel.instanceMatrix.array, slot * 16);
        memBornAttrs[t].array[slot] = memBorn[i];
        memMatrix(i, MEM_INSET - 0.3, bArr, i * 16);
        memMatrix(i, MEM_INSET - 0.9, gArr, i * 16);
        const av = memItems.avg[t] || memItems.avg[0]; const gk = MEM_GLOW * memW;
        gCol[i * 3] = av.r * gk; gCol[i * 3 + 1] = av.g * gk; gCol[i * 3 + 2] = av.b * gk;
      }
      for (let t = 0; t < MEM_MAX_TEX; t++) { const pm = memPanels[t]; pm.count = counts[t]; if (counts[t]) { pm.instanceMatrix.needsUpdate = true; memBornAttrs[t].needsUpdate = true; } }
      memBezel.instanceMatrix.needsUpdate = true; memGlow.instanceMatrix.needsUpdate = true; memGlow.instanceColor.needsUpdate = true;
      for (let t = 0; t < MEM_MAX_TEX; t++) {
        const m = memTexMats[t], it = memItems.list[t];
        m.opacity = memW; m.transparent = memW < 0.999;
        const sh = m.userData.shader; if (sh) sh.uniforms.uKen.value = it && it.kind === 'photo' && !reduced ? MEM_KEN_BURNS : 0;
      }
      memBezelMat.opacity = memW; memBezelMat.transparent = memW < 0.999;
    }

    /* ---------- plunge ---------- */
    plungeGroup.visible = plungeW > 0.004;
    if (plungeGroup.visible) {
      plunge.morph += dt; plunge.invT += dt; plunge.flashT += dt;
      const stage = plunge.stage || 'cubes', st = state.t - plunge.stageT0;
      const cutK = plunge.cut > 0 && st < plunge.cut ? 0.35 + 0.65 * (st / plunge.cut) : 1;     // soft cut: a brief dip instead of a double bake
      const morphT = Math.min(1, plunge.morph / PLUNGE_MORPH), morphing = morphT < 1;
      const inv = looks.inverse.w > 0.5;
      const invSwap = plunge.invT < PLUNGE_BEAT_INV;                                                 // beat: pair swapped for 120 ms
      const colA = invSwap ? plunge.colB : plunge.colA, colB = invSwap ? plunge.colA : plunge.colB;
      if (inv) { _inkA.setHex(INVERSE_INK).lerp(colA, INVERSE_TINT); _inkB.setHex(INVERSE_INK).lerp(colB, INVERSE_TINT); }
      const cA = inv ? _inkA : colA, cB = inv ? _inkB : colB;
      const smear = (sp > PLUNGE_SMEAR_SP && !reduced) || stage === 'shards';
      const streak = stage === 'shards' ? PLUNGE_SHARD_STREAK : (smear ? Math.min(PLUNGE_STREAK_MAX, stretch) : 1);
      const spin = reduced ? 0 : 1;
      const rOuter = PLUNGE_R[0] + (PLUNGE_R[1] - PLUNGE_R[0]) * PLUNGE_OUTER;
      const collapse = stage === 'collapse' ? smooth(0, PLUNGE_COLLAPSE_SECS, st) : 0;   // 0 -> 1 over the stage
      const useField = stage !== 'lattice' && stage !== 'stairs' && stage !== 'rings';
      const offs = plungeSets.map(() => 0);
      const shapeIdx = stage === 'shards' ? PLUNGE_SHARD_SET : plunge.shape, prevIdx = stage === 'shards' ? PLUNGE_SHARD_SET : plunge.prev;
      if (useField) for (let i = 0; i < PLUNGE_N; i++) {
        let z = pZ[i];
        while (z > camZ + BEHIND + 300) z -= PLUNGE_SEG;
        while (z < camZ + BEHIND + 300 - PLUNGE_SEG) z += PLUNGE_SEG;
        pZ[i] = z;
        if (!reduced) { pTh[i] += PLUNGE_SPIRAL.omega * dt * (1 + 40 / pR[i]); pR[i] -= PLUNGE_SPIRAL.inward * dt; if (pR[i] < PLUNGE_R[0]) pR[i] = PLUNGE_R[1]; }
        if (Math.abs(z - camZ) > PLUNGE_BAKE_Z) continue;
        if (stage === 'inverse' && pInkSkip[i]) continue;          // fewer, heavier cubes on the paper
        // scale hierarchy: a few huge solids ride the outer shell, the many small ones sit deeper
        const huge = pHuge[i];
        let r = pR[i], size = huge ? pSize[i] * PLUNGE_HUGE_MUL : pSize[i];
        if (stage === 'inverse') size *= PLUNGE_INK_MUL;
        let cx = r * Math.cos(pTh[i]), cy = r * Math.sin(pTh[i]), cz = z;
        if (stage === 'cubes-wave') cy += PLUNGE_WAVE.amp * Math.sin((z - state.t * PLUNGE_WAVE.speed) * Math.PI * 2 / PLUNGE_WAVE.len);
        if (collapse > 0) {                                 // suck everything toward a point ahead
          const k = 1 - collapse, fz = camZ - PLUNGE_COLLAPSE_Z;
          cx *= k; cy *= k; cz = fz + (cz - fz) * k; size *= Math.max(0.02, k);
        }
        _ax.set(pAxis[i * 3], pAxis[i * 3 + 1], pAxis[i * 3 + 2]);
        _q.setFromAxisAngle(_ax, pPh[i] + t * pSpin[i] * spin); _rq.makeRotationFromQuaternion(_q); _rm.setFromMatrix4(_rq);
        const e = _rm.elements;
        // depth fog: near solids bright, far ones dim (the fog in the scene does the rest)
        const dz = Math.abs(cz - camZ), depthK = inv ? 1 : Math.max(0.18, 1.25 - dz / PLUNGE_DEPTH_FADE);
        _pc.copy(pSecond[i] ? cB : cA); if (!inv) _pc.multiplyScalar(depthK * cutK);
        const targets = morphing ? [shapeIdx, prevIdx] : [shapeIdx];
        for (const si of targets) {
          const set = plungeSets[si];
          if (offs[si] + set.def.e.length * 6 * 3 > set.arr.length) continue;
          if (smear && !inv && (stage === 'shards' || r > rOuter)) {
            const rx = Math.cos(pTh[i]), ry = Math.sin(pTh[i]);
            for (let k = 0; k < 3; k++) { const d = (k - 1) * PLUNGE_SMEAR_OFF; offs[si] = bakeSolid(set, offs[si], cx + rx * d, cy + ry * d, cz, size, e, _pc2.copy(_rgb[k]).multiply(_pc).multiplyScalar(1.6), streak); }
          } else offs[si] = bakeSolid(set, offs[si], cx, cy, cz, size, e, _pc, streak);
        }
      }
      plungeSets.forEach((set, si) => {
        set.mesh.visible = offs[si] > 0;
        set.mesh.geometry.setDrawRange(0, offs[si] / 3);
        if (offs[si] > 0) { set.mesh.geometry.attributes.position.needsUpdate = true; set.mesh.geometry.attributes.color.needsUpdate = true; }
        set.mesh.material.blending = inv ? THREE.NormalBlending : THREE.AdditiveBlending;
        set.mesh.material.opacity = plungeW * (si === shapeIdx ? (stage === 'shards' ? 1 : morphT) : (morphing && si === prevIdx ? 1 - morphT : 0));
      });

      // lattice: infinite cubic lattice, pitch 40, vertices breathing on a sin(x + z) wave, two colours split by depth
      latticeMesh.visible = stage === 'lattice';
      if (latticeMesh.visible) {
        const P = PLUNGE_LATTICE.pitch, H = PLUNGE_LATTICE.half, z0 = Math.ceil((camZ + 60) / P) * P, zn = PLUNGE_LATTICE.depth / P;
        const arr = latticeMesh.geometry.attributes.position.array, carr = latticeMesh.geometry.attributes.color.array;
        let o = 0; const wave = (x, z) => reduced ? 0 : PLUNGE_LATTICE.wave * Math.sin((x + z) * 0.02 + state.t * 2.6);
        const put = (x, y, z, g) => { const dz = Math.abs(z - camZ), k = Math.max(0.15, 1.2 - dz / 520) * cutK * g * 0.7, far = smooth(120, 360, dz);
          _pc.copy(cA).lerp(cB, far).multiplyScalar(k); arr[o] = x; arr[o + 1] = y + wave(x, z); arr[o + 2] = z; carr[o] = _pc.r; carr[o + 1] = _pc.g; carr[o + 2] = _pc.b; o += 3; };
        const h2 = P / 2;
        for (let iz = 0; iz <= zn; iz++) { const z = z0 - iz * P;
          for (let x = -H + h2; x <= H; x += P) for (let y = -H + h2; y <= H; y += P) {
            if (x < H - P) { put(x, y, z, 0.55); put(x + P, y, z, 0.55); }
            if (y < H - P) { put(x, y, z, 0.55); put(x, y + P, z, 0.55); }
            if (iz < zn) { put(x, y, z, 1); put(x, y, z - P, 1); }
          } }
        latticeMesh.geometry.setDrawRange(0, o / 3);
        latticeMesh.geometry.attributes.position.needsUpdate = true; latticeMesh.geometry.attributes.color.needsUpdate = true;
        latticeMesh.material.opacity = plungeW; latticeMesh.material.blending = inv ? THREE.NormalBlending : THREE.AdditiveBlending;
      }
      // stairs: a square helix of wireframe steps, static geometry snapped by its turn pitch
      stairsMesh.visible = stage === 'stairs';
      if (stairsMesh.visible) {
        stairsMesh.position.z = Math.ceil((camZ + BEHIND) / PLUNGE_STAIRS.turnZ) * PLUNGE_STAIRS.turnZ;
        stairsMat.color.copy(cA).multiplyScalar(cutK); stairsMat.opacity = plungeW; stairsMat.blending = inv ? THREE.NormalBlending : THREE.AdditiveBlending;
      }
      // rings: concentric square frames every 30 units, rotating alternately, radial pulse on the beat
      ringsMesh.visible = stage === 'rings';
      if (ringsMesh.visible) {
        const P = PLUNGE_RINGS.pitch, z0 = Math.ceil((camZ + BEHIND) / (P * 2)) * (P * 2), n = Math.ceil(PLUNGE_RINGS.depth / P);
        const arr = ringsMesh.geometry.attributes.position.array, carr = ringsMesh.geometry.attributes.color.array;
        let o = 0;
        for (let j = 0; j < n; j++) {
          const z = z0 - j * P, idx = Math.round(-z / P), alt = idx & 1 ? -1 : 1;
          const ang = reduced ? 0 : alt * state.t * PLUNGE_RINGS.rate + idx * 0.15;
          let pulse = 0; for (const q of pulses) { const d = (z - (q.z0 - PULSE_SPEED * q.age)) / 40; pulse += q.amp * Math.exp(-d * d) * Math.exp(-q.age * PULSE_DECAY); }
          const dz = Math.abs(z - camZ), k = Math.max(0.15, 1.2 - dz / 520) * cutK;
          for (let ring = 0; ring < 2; ring++) {
            const half = (ring ? PLUNGE_RINGS.half * 0.62 : PLUNGE_RINGS.half) * (1 + 0.25 * pulse), c = Math.cos(ang + ring * 0.4), sn = Math.sin(ang + ring * 0.4);
            _pc.copy(ring ^ (idx & 1) ? cB : cA).multiplyScalar(k * (1 + pulse));
            const corner = m => [half * (Math.cos(m * Math.PI / 2 + Math.PI / 4) * c - Math.sin(m * Math.PI / 2 + Math.PI / 4) * sn) * Math.SQRT2,
                                 half * (Math.cos(m * Math.PI / 2 + Math.PI / 4) * sn + Math.sin(m * Math.PI / 2 + Math.PI / 4) * c) * Math.SQRT2];
            for (let m = 0; m < 4; m++) { const a = corner(m), b = corner(m + 1);
              arr[o] = a[0]; arr[o + 1] = a[1]; arr[o + 2] = z; carr[o] = _pc.r; carr[o + 1] = _pc.g; carr[o + 2] = _pc.b; o += 3;
              arr[o] = b[0]; arr[o + 1] = b[1]; arr[o + 2] = z; carr[o] = _pc.r; carr[o + 1] = _pc.g; carr[o + 2] = _pc.b; o += 3; }
          }
        }
        ringsMesh.geometry.setDrawRange(0, o / 3);
        ringsMesh.geometry.attributes.position.needsUpdate = true; ringsMesh.geometry.attributes.color.needsUpdate = true;
        ringsMesh.material.opacity = plungeW; ringsMesh.material.blending = inv ? THREE.NormalBlending : THREE.AdditiveBlending;
      }
      // beat flash: the background takes the pair's colour at 25% for the swap window
      const sc2 = group.parent;
      if (sc2 && sc2.background && sc2.background.isColor && plunge.flashT < PLUNGE_BEAT_INV) sc2.background.lerp(tmpB.copy(plunge.colA), 0.25 * (1 - plunge.flashT / PLUNGE_BEAT_INV));
    }

    /* ---------- landing ---------- */
    landGroup.visible = landW > 0.004;
    if (landGroup.visible) {
      landFloor.position.z = Math.ceil((camZ + 200) / LAND_CELL) * LAND_CELL;
      const u = landMat.uniforms;
      u.uOp.value = landW; u.uCamZ.value = camZ; u.uTime.value = reduced ? 0 : state.t; u.uCol.value.copy(accent).lerp(tmpB.set(1, 1, 1), 0.25);
      impactState.age += dt;
      u.uImpact.value.set(impactState.x, impactState.z, impactState.age, impactState.age < 3 ? impactState.strength : 0);
      const rt = Math.min(1, impactState.age / IMPACT_RING.secs), rr = IMPACT_RING.radius * rt;
      impactRing.visible = impactState.age < IMPACT_RING.secs * 1.6;
      if (impactRing.visible) {
        const c = curve(impactState.z);
        impactRing.position.set(impactState.x, LAND_Y + 0.2, impactState.z);
        impactRing.scale.set(rr + 0.01, 1, rr + 0.01);
        ringMat.color.copy(accent).lerp(tmpB.set(1, 1, 1), 0.4);
        ringMat.opacity = impactState.strength * (1 - rt) * landW;
      }
      { const hz = camZ - LAND_HORIZON.dist, c = curve(hz); horizon.position.set(c.x, LAND_Y + c.y, hz); }
      { const lz = camZ - BLACKOUT_LIGHT.dist, c = curve(lz); landLight.position.set(c.x, c.y + 6, lz); landLight.color.copy(accent).lerp(tmpB.set(1, 1, 1), 0.3); landLight.intensity = BLACKOUT_LIGHT.intensity * landW; }
      landKey.intensity = LAND_KEY.intensity * landW; landFill.intensity = LAND_FILL.intensity * landW;
      horizonMat.color.copy(accent); horizonMat.opacity = LAND_HORIZON.op * landW;
      const du = landDust.mat.uniforms;
      du.uTime.value = state.gt; du.uHeight.value = s.viewportHeight || du.uHeight.value; du.uStretch.value = 0;
      du.uWeight.value = landW * 0.3; du.uCamZ.value = camZ; du.uReduced.value = reduced ? 1 : 0; du.uHigh.value = high;
      du.uTintA.value.copy(accent); du.uTintB.value.setRGB(0.7, 0.7, 0.8);
    }
  }

  function pushPulse(z0, amp) { if (pulses.length >= PULSE_MAX) pulses.shift(); pulses.push({z0, age: 0, amp: clamp01(amp == null ? 1 : amp)}); }

  /* ---- audio ripple ---- */
  const rippleEnv = age => Math.exp(-age * 5) * (1 + 0.3 * Math.cos(Math.PI * 2 * age / 0.18));
  function kick(strength, atZ) {
    const camZ = atZ == null ? state.camZ : atZ;
    const k = ripples.length;
    if (ripples.length >= RIPPLE_MAX) ripples.shift();
    const z = camZ - (RIPPLE_AHEAD[0] + hash(k + Math.floor(state.t * 1000), 71) * (RIPPLE_AHEAD[1] - RIPPLE_AHEAD[0]));
    ripples.push({z, age: 0, strength: clamp01(strength == null ? 1 : strength)});
    pushPulse(camZ, strength);
    if (looks.plunge.w > 0.5) { plunge.invT = 0; plunge.flashT = 0; }   // plunge: invert the pair and flash the background for 120 ms
  }

  /* ---- mirror room ---- */
  function mirrorWeight(camZ) {
    if (mirror.zStart == null) return 0;
    const z0 = mirror.zStart, z1 = z0 - MIRROR_LEN, h = MIRROR_FADE * 0.5;
    return smooth(z0 + h, z0 - h, camZ) * (1 - smooth(z1 + h, z1 - h, camZ));
  }
  function clearMirror() {
    if (!mirror.group) return;
    mirror.group.removeFromParent();
    for (const r of mirror.planes) { r.dispose(); r.geometry.dispose(); }
    for (const e of mirror.edges) e.geometry.dispose();
    for (const m of mirror.mats) m.dispose();
    Object.assign(mirror, {zStart: null, planes: [], edges: [], lights: [], mats: [], group: null});
  }
  function setMirror(zStart) {
    clearMirror();
    if (zStart == null) return;
    const slow = state.slow;
    const tex = slow ? MIRROR_TEX[1] : MIRROR_TEX[0];
    const g = new THREE.Group(); g.name = 'mirror';
    const zMid = zStart - MIRROR_LEN * 0.5, wi = HALF_W - MIRROR_INSET, W = HALF_W * 2;
    const edgeMat = bendable(new THREE.LineBasicMaterial({color: 0xffffff, transparent: true, opacity: MIRROR_EDGE_OP,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}));
    mirror.mats.push(edgeMat);
    // [geometry, rotation.x, rotation.y, position x, position y]
    const walls = [
      [new THREE.PlaneGeometry(MIRROR_LEN, W), 0, -Math.PI / 2, wi, 0],
      [new THREE.PlaneGeometry(MIRROR_LEN, W), 0, Math.PI / 2, -wi, 0],
      [new THREE.PlaneGeometry(W, MIRROR_LEN), Math.PI / 2, 0, 0, wi],
      [new THREE.PlaneGeometry(W, MIRROR_LEN), -Math.PI / 2, 0, 0, -wi],
    ];
    for (const [geo, rx, ry, x, y] of walls) {
      const r = new Reflector(geo, {clipBias: MIRROR_CLIP, textureWidth: tex, textureHeight: tex, color: MIRROR_COLOR, multisample: 0});
      const cm = curve(zMid);
      r.rotation.set(rx, ry, 0); r.position.set(x + cm.x, y + cm.y, zMid);
      const inner = r.onBeforeRender;
      r.onBeforeRender = function (renderer, scene, camera, geometry, material, grp) {
        if (mirrorBusy) return;              // a mirror seen in another mirror shows its last frame, never recurses
        mirrorBusy = true;
        try { inner.call(r, renderer, scene, camera, geometry, material, grp); } finally { mirrorBusy = false; }
      };
      g.add(r); mirror.planes.push(r);
      // accent edge: a rectangle drawn around the plane
      const e = new THREE.EdgesGeometry(geo);
      const line = new THREE.LineSegments(e, edgeMat);
      line.rotation.copy(r.rotation); line.position.copy(r.position);
      g.add(line); mirror.edges.push(line);
    }
    for (let i = 0; i < MIRROR_LIGHTS; i++) {
      const l = new THREE.PointLight(0xffffff, MIRROR_LIGHT_I, 0, 2);
      const side = i % 2 ? 1 : -1;
      const lz = zStart - MIRROR_LEN * (i + 0.5) / MIRROR_LIGHTS, cl = curve(lz);
      l.position.set(side * MIRROR_LIGHT_OFF + cl.x, (i % 3 - 1) * MIRROR_LIGHT_OFF * 0.6 + cl.y, lz);
      g.add(l); mirror.lights.push(l);
    }
    mirror.zStart = zStart; mirror.group = g;
    group.add(g);
  }
  function updateMirror(camZ, mW, slow, reduced) {
    if (!mirror.group) return;
    const z0 = mirror.zStart, z1 = z0 - MIRROR_LEN;
    const near = camZ < z0 + MIRROR_ACTIVE && camZ > z1 - MIRROR_ACTIVE;
    mirror.group.visible = near;
    if (!near) return;
    const pulse = reduced ? 1 : 0.85 + 0.15 * Math.sin(state.t * 2.1);
    mirror.mats[0].color.copy(accent).multiplyScalar(1.3);
    mirror.mats[0].opacity = MIRROR_EDGE_OP * pulse;
    for (const l of mirror.lights) { l.color.copy(accent).lerp(tmpB.set(1, 1, 1), 0.4); l.intensity = MIRROR_LIGHT_I; }
    for (const r of mirror.planes) r.visible = true;
  }

  function dispose() {
    clearMirror();
    group.removeFromParent();
    for (const d of disposables) d.dispose();
    group.traverse(o => { if (o.isInstancedMesh) o.dispose(); });
  }

  return {group, update, dispose, kick: strength => kick(strength), setMirror, setLook, nextPattern, setPattern, setDim, setBeatMorph, setBend, curve, tangent, setMemories, deal, impact, landingY, plungeStage, get inverse() { return looks.inverse.w; },
    runLog: () => runLog.map(r => ({pattern: patterns[r.pattern].name, pair: PALETTE_NAMES[PAT_PAIRS[r.pair][0]] + '/' + PALETTE_NAMES[PAT_PAIRS[r.pair][1]]})), patterns: () => patterns.map(p => ({name: p.name, segments: p.segments})), looks: () => Object.fromEntries(LOOK_NAMES.map(n => [n, looks[n].w])), stats, constants: {HALF_W, CELL, FOG_DENSITY, OCT_APOTHEM, SOLID_BAND, MIRROR_LEN}};
}
