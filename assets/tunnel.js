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
     tunnel.setLandingPoint(x, z)    // where the figure comes to rest (impact() sets it to camera z - 40); the flat patch and hills key off it
     tunnel.setPlane('bliss' | 'grid')   // what setLook('landing') resolves to (default bliss); setLook('landing-grid') forces the wire floor
     tunnel.matrixExit(secs)         // glyph rain persists over the landing and drains away over secs, chromatic split at the start
     tunnel.plungeStage(name, cutSecs)   // cut list: cage-dark | vortex | prism-tri | lattice-green | inverse | glyphs | collapse (also prism | cubes | lattice | stairs | rings | shards | cubes-wave)
     tunnel.deal()                   // plunge: morph every solid to the next shape (180 ms) and snap the colour pair from the deck
     tunnel.impact(strength)         // landing: floor ring 0 -> 90 units over 700 ms, grid brightens with a damped bounce
     tunnel.landingY()               // -12, the floor height
     tunnel.setBend({ax, lx, ay, ly, py}, easeSecs)   // curve the corridor: offset(z) = (ax sin(z/lx), ay sin(z/ly + py)); null straightens over 2 s
     tunnel.curve(z) -> {x, y}      // corridor centre offset at z; place the camera and page objects on it
     tunnel.tangent(z) -> {x, y, z} // unit direction of travel along the curve at z
     tunnel.release();               // allow the next phase-mode setLook (null/cage/tessellation/inverse) while an authored look is active
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

const LOOK_NAMES = ['cage', 'tessellation', 'starfield', 'nebula', 'wiregrid', 'blackout', 'inverse', 'memory', 'plunge', 'landing', 'bliss'];

const GLYPH_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ:./#%+-<>*=[]@&';
const GLYPH_ATLAS = [16, 8];             // atlas grid, 512 x 256 canvas
const GLYPH_CELL = 7;                    // rain glyph size, units
const GLYPH_WORD_CELL = 9;               // word glyph size
const GLYPH_LANES = 7;                   // rain lanes per wall
const GLYPH_DROPS = 5;                   // concurrent drops per lane
const GLYPH_SEG = 700;
const GLYPH_SPEED = [60, 240];           // drop speed relative to the camera, units per second
const GLYPH_TAIL = [10, 26];             // tail length in cells
const GLYPH_TAIL_GAIN = 1.5;             // tail brightness
const GLYPH_FLIP = 6;                    // glyph changes per second
const GLYPH_WORDS = ['RENDER', 'TAKE 2', '24 FPS', 'ROLL', 'CUT', 'EXPORT', 'DEPLOY', 'COMMIT', 'ACTION', 'SHIP IT', 'REEL', 'FRAME', 'LIGHT', 'PUSH', 'MERGE', 'LOG',
  '24', '1080', '4K', '00:00:23:14', '2.39:1', '48KHZ'];
const GLYPH_WORD_COPIES = 2;             // placements per word per segment
const GLYPH_MAX = 9000;                  // instance capacity (rain + words, times three for the chromatic split)
const GLYPH_INSET = 1.5;
const EXIT_SPLIT = 0.3;                  // seconds of chromatic split at the start of a matrix exit
const EXIT_SPLIT_OFF = 1.4;              // units

const BLISS = {size: 2400, segs: 160, recentre: 200, base: -12,
  ridge: {z: -520, len: 230, h: 72, saddle: 26, saddleLen: 520, saddleX: 140},   // the big hill sweeping left to right with a gentle saddle
  hills: [[-460, -980, 360, 46], [420, -1120, 420, 54]],                          // two lower ones behind: [x, z, radius, height]
  flat: [30, 150], low: 0x2f7a2a, high: 0x7ccf45, maxLum: 0.8, grassRepeat: 40, farBand: 0.22, haze: [900, 1300], sky: {zenith: 0x1f5fd0, mid: 0x4a90e2, horizon: 0xb7d9f2, radius: 1200, maxLum: 0.85},
  sun: {color: 0xffffff, intensity: 1.6, dir: [0.7, 0.9, 0.5]}, hemi: {sky: 0x9ec5ff, ground: 0x4f7a2f, intensity: 0.6},
  clouds: [[380, 300, -820, 1.0], [720, 350, -900, 1.3], [1060, 290, -760, 0.9], [-180, 330, -940, 0.8]],   // [x, y, z, scale], high and to the right
  cloudOp: 0.96, sunDisc: [520, 480, -900, 90], fogColor: 0xb7d9f2};
const BLISS_PUFF = {radius: 60, secs: 0.8, color: 0x8f9a86, op: 0.35};   // green-grey dust, not a glow

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
const PLUNGE_STAGES = ['cage-dark', 'vortex', 'prism-tri', 'lattice-green', 'inverse', 'glyphs', 'collapse', 'prism', 'cubes', 'lattice', 'stairs', 'rings', 'shards', 'cubes-wave'];   // cut list uses the first seven; the rest stay callable
const SMEAR = {copies: 4, gain: 0.3, base: 6, perV: 14, max: 60};        // motion-blur copies trail along z by base + perV * v units (capped), dimmed by gain
const BEAM = {thick: [0.6, 1.4], split: 0.3, missing: 0.1, tilt: 0.06, tiltDeg: [5, 10], emis: 0.5, capEmis: 1.6, capLen: 2.2, base: 0x2a2e36, rough: 0.85, far: [300, 820], copyAlpha: 0.35};
const ROOM_LIGHT = {intensity: 16000, dist: 12};             // soft light riding with the camera so near beams shade
const ROOM_CAGE = {half: 92, pitch: 36, depth: 1100, keep: 0.75, streaks: 60, roll: 6 * Math.PI / 180, helix: 9, tint: [0x66f0ff, 0xff5a2a], tintK: 0.45, capFrac: 0.14, haze: 0xff7a3a, hazeOp: 0.09, hazeN: 5, base: 0x4a3a2e, thick: [1.0, 2.0]};
const ROOM_VORTEX = {rOut: 88, rIn: 44, rCore: 12, pitch: 30, depth: 1000, nOut: 16, nIn: 12, twist: 0.0045, rot: 25 * Math.PI / 180, jitter: 10, rJit: 12,
  tint: [0xff7fc0, 0x9fc4ff], capFrac: 0.35, coreDist: 520, coreSize: 30, coreOp: 0.45, knot: {rings: 6, r: [5, 14], segs: 12}, frags: 100, fragSpeed: [60, 220], fragLen: [6, 26], haze: 0xff8fd0, hazeOp: 0.08};
const ROOM_LATTICE = {pitch: 40, half: 200, depth: 680, keep: 0.75, jitter: 0.15, core: 34, tint: [0x9ad24a, 0xf2ff4a], capFrac: 0.22, ghosts: 4, ghostCol: 0xa8ff8a, ghostOp: 0.18, haze: 0x7fe86a, hazeOp: 0.10, hazeN: 5};
const HAZE = {n: 4, size: [280, 480], r: [70, 130], drift: 14};
const HALO = {dist: 600, size: 520, width: 0.012, op: 0.11, split: 0.035};
const PRISM = {cell: 18, perRing: 32, depth: 1100, ahead: 80, cube: 7, half: 84, triR: 136, fill: 0.05, fillNear: [60, 200], fadeZ: [160, 520], lineOp: 0.8, twist: 0.012, streakMax: 3, morph: 0.6, flash: 0.22, maxK: 0.9};
const PRISM_RINGS = Math.ceil(PRISM.depth / PRISM.cell) + 2;
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
const LAND_CELL = 6;                     // fine grid
const LAND_MAJOR = 30;                   // second, brighter grid
const LAND_SIZE = 1400;                  // floor square
const LAND_PIECE = 24;
const LAND_FADE = [260, 560];            // major lines: distance fade to black
const LAND_FADE_FINE = [90, 260];        // fine lines fade much earlier so they never pack into a horizon band
const LAND_OP = 0.35;                    // fine lines, white
const LAND_MAJOR_OP = 0.55;
const LAND_CAP = 0.5;                    // alpha cap so stacked far lines never reach white
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
    if (abs(mv.z) < 0.05) mv.z = -0.05;
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

function grassTexture(THREE, size, lowHex, highHex) {
  // tileable: two octaves of value noise on wrapping lattices, plus fine blade streaks, in greens low..high
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), img = g.createImageData(size, size), d = img.data;
  const lo = new THREE.Color(lowHex), hi = new THREE.Color(highHex);
  const lat = (n, seed) => { const a = new Float32Array(n * n); for (let i = 0; i < n * n; i++) a[i] = hash(i, seed); return a; };
  const l1 = lat(8, 211), l2 = lat(32, 212);
  const sm = t => t * t * (3 - 2 * t);
  const noise = (lt, n, u, v) => { const x = u * n, y = v * n, x0 = Math.floor(x) % n, y0 = Math.floor(y) % n, x1 = (x0 + 1) % n, y1 = (y0 + 1) % n, fx = sm(x - Math.floor(x)), fy = sm(y - Math.floor(y));
    const a = lt[y0 * n + x0], b = lt[y0 * n + x1], cc = lt[y1 * n + x0], dd = lt[y1 * n + x1]; return (a + (b - a) * fx) + ((cc + (dd - cc) * fx) - (a + (b - a) * fx)) * fy; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    let t = 0.62 * noise(l1, 8, u, v) + 0.38 * noise(l2, 32, u, v);
    // blade streaks: short vertical dashes keyed to a wrapping hash of the column and a coarse row
    const col = Math.floor(x / 2), row = Math.floor(y / 14), hs = hash(col * 977 + row, 213), phase = (y % 14) / 14;
    if (hs < 0.35 && phase < 0.55) t += (hash(col + row * 31, 214) - 0.4) * 0.35;
    t = Math.min(1, Math.max(0, t));
    const r = lo.r + (hi.r - lo.r) * t, gg = lo.g + (hi.g - lo.g) * t, b = lo.b + (hi.b - lo.b) * t, k = (y * size + x) * 4;
    // vertex colours are linear; the texture is declared sRGB, so encode
    d[k] = Math.round(255 * Math.pow(r, 1 / 2.2)); d[k + 1] = Math.round(255 * Math.pow(gg, 1 / 2.2)); d[k + 2] = Math.round(255 * Math.pow(b, 1 / 2.2)); d[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = true;
  return tex;
}
function cumulusTexture(THREE, w, h) {
  // one cumulus: a cluster of soft-topped lobes with a hard flat bottom, white on transparent
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  const base = h * 0.72;
  const lobes = [[0.22, 0.55, 0.16], [0.36, 0.42, 0.2], [0.5, 0.36, 0.22], [0.64, 0.44, 0.19], [0.78, 0.56, 0.15], [0.3, 0.62, 0.14], [0.6, 0.6, 0.15]];
  for (const [lx, ly, lr] of lobes) {
    const x = lx * w, y = ly * h, r = lr * w;
    const gr = g.createRadialGradient(x, y, r * 0.55, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.8, 'rgba(244,247,252,0.9)'); gr.addColorStop(1, 'rgba(240,244,250,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // shade the underside a touch, then cut a hard flat bottom
  const sh = g.createLinearGradient(0, base - h * 0.2, 0, base); sh.addColorStop(0, 'rgba(180,196,220,0)'); sh.addColorStop(1, 'rgba(170,190,218,0.55)');
  g.globalCompositeOperation = 'source-atop'; g.fillStyle = sh; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; g.fillRect(0, base, w, h - base);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function sunDiscTexture(THREE, size) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, 'rgba(255,250,230,0.95)'); gr.addColorStop(0.12, 'rgba(255,248,220,0.9)'); gr.addColorStop(0.16, 'rgba(255,245,210,0.35)'); gr.addColorStop(0.5, 'rgba(255,240,200,0.08)'); gr.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function haloTexture(THREE, size, width) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const r = size * 0.46, w = Math.max(1.5, size * width);
  g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = w; g.beginPath(); g.arc(size / 2, size / 2, r, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = w * 3; g.beginPath(); g.arc(size / 2, size / 2, r, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* ---------- module ---------- */
export const instances = [];   // every makeTunnel result, for harness inspection

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
  const state = {t: 0, gt: 0, slow: !!opts.slow, reduced: !!opts.reduced, camZ: 0, lastBeat: 0, warm: -1};
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
  function setBeatMorph(enabled, minGapSecs) { if (enabled) releaseAt = state.t; pat.beatMorph = !!enabled; if (minGapSecs != null) pat.beatGap = Math.max(0, minGapSecs); }
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
  const _inkA = new THREE.Color(), _inkB = new THREE.Color(), _pc2 = new THREE.Color(), tmpFog = new THREE.Color();
  const pInkSkip = new Uint8Array(PLUNGE_N); for (let i = 0; i < PLUNGE_N; i++) pInkSkip[i] = hash(i, 174) > PLUNGE_INK_FRAC ? 1 : 0;
  const pHuge = new Uint8Array(PLUNGE_N); for (let i = 0; i < PLUNGE_N; i++) pHuge[i] = hash(i, 173) < PLUNGE_HUGE_FRAC ? 1 : 0;
  function plungeStage(name, cutSecs) {
    callLog.push({f: 'plungeStage', name, cut: cutSecs, t: +state.t.toFixed(2), look: lookCtl.name});
    if (name != null && lookCtl.name !== 'plunge') { lookCtl.name = 'plunge'; lookCtl.fade = 0.12; state.warm = 2; }   // a stage cut always means the plunge look
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
    plunge.pair = pairDeck.deal(); plungeColours(); prismReroll(); plunge.flashT = 0;
  }
  /* ---- prism: a tunnel built of small cubes in rings; each ring band takes a random deck colour, re-rolled on beats and deals ---- */
  const prismLines = bakedLines(PRISM_RINGS * PRISM.perRing * 12);
  const prismFillGeo = new THREE.BoxGeometry(1, 1, 1); disposables.push(prismFillGeo);
  const prismFillMat = bendable(new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: PRISM.fill, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}));
  disposables.push(prismFillMat);
  const prismFill = new THREE.InstancedMesh(prismFillGeo, prismFillMat, PRISM_RINGS * PRISM.perRing);
  prismFill.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  prismFill.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PRISM_RINGS * PRISM.perRing * 3), 3); prismFill.instanceColor.setUsage(THREE.DynamicDrawUsage);
  prismFill.frustumCulled = false; prismFill.visible = false; plungeGroup.add(prismFill);
  const prism = {roll: 0, flashCol: new THREE.Color(), morphT0: -99};
  const prismPalette = PAT_PAIRS.map(pr => new THREE.Color(PALETTE[pr[0]]));
  function prismColour(band) {           // random pick from the whole deck for this band and roll, adjacent bands always differ
    let k = Math.floor(hash(band * 31 + prism.roll * 7, 221) * prismPalette.length);
    const prev = Math.floor(hash((band - 1) * 31 + prism.roll * 7, 221) * prismPalette.length);
    if (k === prev) k = (k + 1) % prismPalette.length;
    return prismPalette[k];
  }
  function prismReroll() { prism.roll++; }
  // cross-section point at perimeter parameter u in [0, 1): square (4 walls) morphing to a triangle (3 walls)
  function prismPoint(u, m, out) {
    const sq = (() => { const side = Math.floor(u * 4), t = u * 4 - side, h = PRISM.half;
      const c = [[-h, -h], [h, -h], [h, h], [-h, h]], a = c[side], b = c[(side + 1) % 4]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; })();
    const tr = (() => { const side = Math.floor(u * 3), t = u * 3 - side, R = PRISM.triR;
      const c = [0, 1, 2].map(k => [R * Math.cos(Math.PI / 2 + k * Math.PI * 2 / 3), R * Math.sin(Math.PI / 2 + k * Math.PI * 2 / 3)]);
      const a = c[side], b = c[(side + 1) % 3]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; })();
    out[0] = sq[0] + (tr[0] - sq[0]) * m; out[1] = sq[1] + (tr[1] - sq[1]) * m;
  }
  const CUBE_E = SOLID_DEFS[0].e, CUBE_V = SOLID_DEFS[0].v, _pp = [0, 0];

  /* ---- lusion rooms: beams as instanced boxes (dark rough base, per-instance emissive tint, bright end caps), broken and tilted,
     drawn SMEAR.copies times trailing along z (motion blur), plus haze planes, a chromatic halo, a camera light and per-room extras ---- */
  const beamGeo = new THREE.BoxGeometry(1, 1, 1); disposables.push(beamGeo);
  const haloGeo = new THREE.PlaneGeometry(1, 1); disposables.push(haloGeo);
  // shared vertex transform for everything in a room: instance, roll/twist, helical bend, z-trailing copy, corridor bend, far fade
  const ROOM_VERT_DECL = 'attribute float aCopy; uniform float uCamZ, uSmearZ, uGain, uRot, uTwist, uHelix, uFar0, uFar1; varying float vK; varying float vCopy;\n';
  const ROOM_PROJECT = `
      vec4 mvPosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      vec4 bentWorld = modelMatrix * mvPosition;
      float dz = uCamZ - bentWorld.z;
      float ang = uRot + uTwist * dz; float c = cos(ang), s = sin(ang);
      bentWorld.xy = vec2(bentWorld.x * c - bentWorld.y * s, bentWorld.x * s + bentWorld.y * c);
      bentWorld.xy += vec2(sin(dz * 0.006), cos(dz * 0.006)) * uHelix;
      bentWorld.z += aCopy * uSmearZ;
      bentWorld.xy += bendOffset(bentWorld.z);
      vK = (aCopy < 0.5 ? 1.0 : uGain) * (1.0 - smoothstep(uFar0, uFar1, dz));
      vCopy = aCopy;
      mvPosition = viewMatrix * bentWorld;
      if (abs(mvPosition.z) < 0.05) mvPosition.z = -0.05;
      gl_Position = projectionMatrix * mvPosition;`;
  // one shared uniform set for every room program (assigned at compile time, so values set before the first render still apply)
  const roomU = {}; for (const [k, v] of Object.entries({uCamZ: 0, uSmearZ: 0, uGain: SMEAR.gain, uRot: 0, uTwist: 0, uHelix: 0, uFar0: BEAM.far[0], uFar1: BEAM.far[1], uEmis: BEAM.emis, uTime: 0})) roomU[k] = {value: v};
  function roomUniforms(sh) { sh.uniforms.uBend = bendU.uBend; sh.uniforms.uBendPy = bendU.uBendPy; for (const k in roomU) sh.uniforms[k] = roomU[k]; }
  const roomShaders = [];
  function beamMaterial(base) {   // dark rough beams; instanceColor is the emissive tint, not the diffuse
    const m = new THREE.MeshStandardMaterial({color: base == null ? BEAM.base : base, roughness: BEAM.rough, metalness: 0.15, transparent: true, depthWrite: true});
    m.onBeforeCompile = sh => {
      roomUniforms(sh); roomShaders.push(sh);
      sh.vertexShader = BEND_GLSL + ROOM_VERT_DECL + sh.vertexShader.replace('#include <project_vertex>', ROOM_PROJECT);
      sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'uniform float uEmis, uTime; varying float vK; varying float vCopy;\nvoid main() {')
        .replace('#include <color_fragment>', '')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n #ifdef USE_COLOR\n totalEmissiveRadiance += vColor * uEmis;\n #endif')
        .replace('#include <fog_fragment>', 'gl_FragColor.rgb *= vK; gl_FragColor.a *= (vCopy < 0.5 ? 1.0 : ' + BEAM.copyAlpha.toFixed(2) + ');\n#include <fog_fragment>');
    };
    m.customProgramCacheKey = () => 'roombeam'; disposables.push(m); return m;
  }
  function capMaterial() {    // hot emissive end caps and glints, additive
    const m = new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false});
    m.onBeforeCompile = sh => {
      roomUniforms(sh); roomShaders.push(sh);
      sh.vertexShader = BEND_GLSL + ROOM_VERT_DECL + sh.vertexShader.replace('#include <project_vertex>', ROOM_PROJECT);
      sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'uniform float uTime; varying float vK; varying float vCopy;\nvoid main() {')
        .replace('#include <fog_fragment>', 'gl_FragColor.rgb *= vK * (vCopy < 0.5 ? 1.0 : 0.5);\n#include <fog_fragment>');
    };
    m.customProgramCacheKey = () => 'roomcap'; disposables.push(m); return m;
  }
  const _ba = new THREE.Vector3(), _bb = new THREE.Vector3(), _bd = new THREE.Vector3(), _bq = new THREE.Quaternion(), _bup = new THREE.Vector3(0, 1, 0), _bm = new THREE.Matrix4(), _bs = new THREE.Vector3();
  function beamMatrix(a, b, thick, tiltRad, seed, out) {
    _ba.set(a[0], a[1], a[2]); _bb.set(b[0], b[1], b[2]); _bd.subVectors(_bb, _ba); const len = _bd.length(); _bd.normalize();
    _bq.setFromUnitVectors(_bup, _bd);
    if (tiltRad) { const ax = new THREE.Vector3(hash(seed, 281) - 0.5, hash(seed, 282) - 0.5, hash(seed, 283) - 0.5).normalize(); _bq.multiply(new THREE.Quaternion().setFromAxisAngle(ax, tiltRad)); }
    _bm.compose(_ba.add(_bb).multiplyScalar(0.5), _bq, _bs.set(thick, len, thick)); return _bm.toArray(out.arr, out.off);
  }
  // build a room from a segment list: [{a, b, tint(0|1), k(brightness), cap(bool)}], applying breakage, tilt and copies
  function buildRoom(segs, tints, capFrac, period, opts) {
    const keep = opts.keep == null ? 1 : opts.keep;
    const beams = [], caps = [];
    segs.forEach((sg, i) => {
      if (hash(i, 291) > keep) return;                          // sparser
      if (hash(i, 292) < BEAM.missing) return;                  // missing beams
      const th = opts.thick || BEAM.thick, thick = th[0] + hash(i, 293) * (th[1] - th[0]);
      const tilt = hash(i, 294) < BEAM.tilt ? (BEAM.tiltDeg[0] + hash(i, 295) * (BEAM.tiltDeg[1] - BEAM.tiltDeg[0])) * Math.PI / 180 : 0;
      const pieces = [];
      if (hash(i, 296) < BEAM.split) {                          // broken into 2 or 3 pieces with gaps and slight offsets
        const n = 2 + (hash(i, 297) < 0.4 ? 1 : 0), d = [sg.b[0] - sg.a[0], sg.b[1] - sg.a[1], sg.b[2] - sg.a[2]];
        for (let q = 0; q < n; q++) {
          const t0 = q / n + 0.06, t1 = (q + 1) / n - 0.06, off = [(hash(i * 3 + q, 298) - 0.5) * 1.6, (hash(i * 3 + q, 299) - 0.5) * 1.6, 0];
          pieces.push([[sg.a[0] + d[0] * t0 + off[0], sg.a[1] + d[1] * t0 + off[1], sg.a[2] + d[2] * t0], [sg.a[0] + d[0] * t1 + off[0], sg.a[1] + d[1] * t1 + off[1], sg.a[2] + d[2] * t1]]);
        }
      } else pieces.push([sg.a, sg.b]);
      for (const [a, b] of pieces) beams.push({a, b, thick, tilt, seed: i, tint: sg.tint, k: sg.k});
      if (hash(i, 300) < capFrac) { const end = hash(i, 301) < 0.5 ? sg.a : sg.b; caps.push({p: end, thick: thick * 1.9, tint: sg.tint, seed: i}); }
    });
    const nB = beams.length, nC = caps.length, C = SMEAR.copies;
    const bm = new THREE.InstancedMesh(beamGeo, beamMaterial(opts.base), nB * C);
    bm.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(nB * C * 3), 3);
    const bCopy = new Float32Array(nB * C);
    const tc = tints.map(h => new THREE.Color(h));
    const out = {arr: bm.instanceMatrix.array, off: 0};
    for (let c = 0; c < C; c++) for (let i = 0; i < nB; i++) {
      const b = beams[i], idx = c * nB + i; out.off = idx * 16; beamMatrix(b.a, b.b, b.thick, b.tilt, b.seed, out);
      const col = tc[b.tint], tk = b.k * (opts.tintK == null ? 1 : opts.tintK); bm.instanceColor.array[idx * 3] = col.r * tk; bm.instanceColor.array[idx * 3 + 1] = col.g * tk; bm.instanceColor.array[idx * 3 + 2] = col.b * tk; bCopy[idx] = c;
    }
    bm.geometry = beamGeo.clone(); bm.geometry.setAttribute('aCopy', new THREE.InstancedBufferAttribute(bCopy, 1)); disposables.push(bm.geometry);
    bm.frustumCulled = false; bm.visible = false; bm.renderOrder = 1; plungeGroup.add(bm);
    const cm = new THREE.InstancedMesh(beamGeo, capMaterial(), Math.max(1, nC * C));
    cm.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, nC * C) * 3), 3);
    const cCopy = new Float32Array(Math.max(1, nC * C));
    for (let c = 0; c < C; c++) for (let i = 0; i < nC; i++) {
      const cp = caps[i], idx = c * nC + i; _bq.identity(); _bm.compose(_ba.set(cp.p[0], cp.p[1], cp.p[2]), _bq, _bs.set(cp.thick, cp.thick, BEAM.capLen)); _bm.toArray(cm.instanceMatrix.array, idx * 16);
      const col = tc[cp.tint]; cm.instanceColor.array[idx * 3] = col.r * BEAM.capEmis; cm.instanceColor.array[idx * 3 + 1] = col.g * BEAM.capEmis; cm.instanceColor.array[idx * 3 + 2] = col.b * BEAM.capEmis; cCopy[idx] = c;
    }
    cm.geometry = beamGeo.clone(); cm.geometry.setAttribute('aCopy', new THREE.InstancedBufferAttribute(cCopy, 1)); disposables.push(cm.geometry);
    cm.count = nC * C; cm.frustumCulled = false; cm.visible = false; cm.renderOrder = 2; plungeGroup.add(cm);
    // haze planes: large soft additive quads around the axis, tinted in the room colour
    const hn = opts.hazeN || HAZE.n;
    const hz = new THREE.InstancedMesh(haloGeo, new THREE.MeshBasicMaterial({map: memGlowTex, color: opts.haze, transparent: true, opacity: opts.hazeOp, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false}), hn);
    disposables.push(hz.material); hz.frustumCulled = false; hz.visible = false; hz.renderOrder = 3; plungeGroup.add(hz);
    return {beams: bm, caps: cm, haze: hz, hazeN: hn, period, opts, nB, nC, mats: [bm.material, cm.material]};
  }
  const segList = (P, C) => { const o = []; for (let i = 0; i < P.length; i += 6) o.push({a: [P[i], P[i + 1], P[i + 2]], b: [P[i + 3], P[i + 4], P[i + 5]], tint: C[i] > 0.5 ? 1 : 0, k: C[i + 1]}); return o; };
  const segPushT = (P, C, a, b, tint, k) => { P.push(a[0], a[1], a[2], b[0], b[1], b[2]); C.push(tint, k, 0, tint, k, 0); };
  // cage-dark: square corridor of girders (corner beams, frames every pitch, mid-wall posts, a few long streak beams)
  const cageRoom = (() => {
    const P = [], C = [], H = ROOM_CAGE.half, L = ROOM_CAGE.depth, corners = [[-H, -H], [H, -H], [H, H], [-H, H]];
    for (const [x, y] of corners) for (let z = 0; z < L; z += 40) segPushT(P, C, [x, y, -z], [x, y, -z - 40], hash(x + y + z, 311) < 0.65 ? 0 : 1, 0.9);
    for (let z = 0; z < L; z += ROOM_CAGE.pitch) for (let k = 0; k < 4; k++) { const a = corners[k], b = corners[(k + 1) % 4];
      segPushT(P, C, [a[0], a[1], -z], [b[0], b[1], -z], hash(z + k, 312) < 0.65 ? 0 : 1, 0.7);
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; segPushT(P, C, [mx, my, -z], [mx, my, -z - ROOM_CAGE.pitch], 0, 0.55); }
    for (let i = 0; i < ROOM_CAGE.streaks; i++) { const k = Math.floor(hash(i, 231) * 4), a = corners[k], b = corners[(k + 1) % 4], t = hash(i, 232), z0 = -hash(i, 233) * L, len = 40 + hash(i, 234) * 120;
      segPushT(P, C, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z0], [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z0 - len], hash(i, 235) < 0.6 ? 0 : 1, 0.9); }
    return buildRoom(segList(P, C), ROOM_CAGE.tint, ROOM_CAGE.capFrac, ROOM_CAGE.pitch, {keep: ROOM_CAGE.keep, haze: ROOM_CAGE.haze, hazeOp: ROOM_CAGE.hazeOp, hazeN: ROOM_CAGE.hazeN, base: ROOM_CAGE.base, thick: ROOM_CAGE.thick, tintK: ROOM_CAGE.tintK});
  })();
  // vortex: rings and spokes with jitter; twist and rotation in the shader; magenta / steel alternating per ring
  const vortexRoom = (() => {
    const P = [], C = [], R = ROOM_VORTEX;
    const ring = (n, r, z, off) => Array.from({length: n}, (_, i) => { const rr = r + (hash(i * 13 + z, 271) - 0.5) * R.jitter + (hash(z, 273) - 0.5) * R.rJit; return [rr * Math.cos(off + i * Math.PI * 2 / n), rr * Math.sin(off + i * Math.PI * 2 / n), z + (hash(i * 7 + z, 272) - 0.5) * R.jitter]; });
    for (let j = 0, z = 0; -z < R.depth; z -= R.pitch, j++) {
      const t = j & 1, o = j * 0.19, outer = ring(R.nOut, R.rOut, z, o), inner = ring(R.nIn, R.rIn, z, o + 0.3), core = ring(R.nIn, R.rCore, z, o + 0.3);
      for (let i = 0; i < R.nOut; i++) { segPushT(P, C, outer[i], outer[(i + 1) % R.nOut], t, 0.9); if (i % 2 === 0) segPushT(P, C, outer[i], inner[Math.floor(i * R.nIn / R.nOut) % R.nIn], t, 0.75); }
      for (let i = 0; i < R.nIn; i++) { segPushT(P, C, inner[i], inner[(i + 1) % R.nIn], t, 0.85); if (i % 3 === 0) segPushT(P, C, inner[i], core[i], t, 0.6); }
      if (t) for (let i = 0; i < R.nOut; i += 4) segPushT(P, C, outer[i], [outer[i][0] * 0.97, outer[i][1] * 0.97, z - R.pitch], t, 0.55);
    }
    return buildRoom(segList(P, C), ROOM_VORTEX.tint, ROOM_VORTEX.capFrac, ROOM_VORTEX.pitch * 2, {haze: ROOM_VORTEX.haze, hazeOp: ROOM_VORTEX.hazeOp});
  })();
  // lattice-green: cubic scaffold with jittered nodes, double girders and braces, 25% dropped
  const latticeRoom = (() => {
    const P = [], C = [], R = ROOM_LATTICE, Pp = R.pitch, H = R.half, h2 = Pp / 2, J = Pp * R.jitter;
    const node = (x, y, z) => [x + (hash(x * 7 + y * 13 + z * 3, 321) - 0.5) * 2 * J, y + (hash(x * 5 + y * 11 + z * 7, 322) - 0.5) * 2 * J, -z + (hash(x * 3 + y * 17 + z * 5, 323) - 0.5) * 2 * J];
    for (let z = 0; z < R.depth; z += Pp) for (let x = -H + h2; x <= H; x += Pp) for (let y = -H + h2; y <= H; y += Pp) {
      if (Math.abs(x) < R.core && Math.abs(y) < R.core) continue;   // clear core: nothing passes through the lens
      const t = hash(x + y * 3 + z, 324) < 0.8 ? 0 : 1, k = 0.55 + hash(x * 7 + y * 13 + z, 241) * 0.45, n0 = node(x, y, z);
      if (x < H - Pp) segPushT(P, C, n0, node(x + Pp, y, z), t, k);
      if (y < H - Pp) segPushT(P, C, n0, node(x, y + Pp, z), t, k);
      segPushT(P, C, n0, node(x, y, z + Pp), t, k);
      if (x < H - Pp && y < H - Pp && hash(x + y * 3 + z * 5, 242) < 0.5) segPushT(P, C, n0, node(x + Pp, y + Pp, z), t, k * 0.7);
      if (y < H - Pp && hash(x * 3 + y + z * 7, 244) < 0.35) segPushT(P, C, n0, node(x, y + Pp, z + Pp), t, k * 0.6);
    }
    return buildRoom(segList(P, C), ROOM_LATTICE.tint, ROOM_LATTICE.capFrac, Pp, {keep: ROOM_LATTICE.keep, haze: ROOM_LATTICE.haze, hazeOp: ROOM_LATTICE.hazeOp, hazeN: ROOM_LATTICE.hazeN});
  })();
  const rooms = [cageRoom, vortexRoom, latticeRoom];
  // always visible while the plunge is: toggling a light's visibility changes the light count and makes three recompile every program (a 200 ms hitch)
  const roomLight = new THREE.PointLight(0xffffff, 0, 0, 2); plungeGroup.add(roomLight);
  // halo: thin ring at the vanishing point, three copies split in R/G/B
  const haloTex = haloTexture(THREE, 512, HALO.width); disposables.push(haloTex);
  const haloMat = new THREE.MeshBasicMaterial({map: haloTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false, toneMapped: false});
  disposables.push(haloMat);
  const halo = new THREE.InstancedMesh(haloGeo, haloMat, 3); halo.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(9), 3); halo.frustumCulled = false; halo.visible = false; halo.renderOrder = 8; plungeGroup.add(halo);
  // vortex extras: a small pink-white knot of twisted rings at the core, a capped core sprite, and torn fragments flying out of the centre
  const coreMat = new THREE.MeshBasicMaterial({map: memGlowTex, color: 0xffd6ee, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false, toneMapped: false});
  disposables.push(coreMat);
  const vortexCore = new THREE.Mesh(haloGeo, coreMat); vortexCore.frustumCulled = false; vortexCore.visible = false; vortexCore.renderOrder = 7; plungeGroup.add(vortexCore);
  const knotGeo = (() => { const K = ROOM_VORTEX.knot, p = []; for (let r = 0; r < K.rings; r++) { const rad = K.r[0] + (K.r[1] - K.r[0]) * r / (K.rings - 1), tilt = r * 0.5;
      for (let i = 0; i < K.segs; i++) { const a0 = i / K.segs * Math.PI * 2, a1 = (i + 1) / K.segs * Math.PI * 2;
        const pt = a => [rad * Math.cos(a), rad * Math.sin(a) * Math.cos(tilt), rad * Math.sin(a) * Math.sin(tilt) + r * 1.5]; const A = pt(a0), B = pt(a1); p.push(...A, ...B); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); disposables.push(g); return g; })();
  const knotMat = bendable(new THREE.LineBasicMaterial({color: 0xffc4e6, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false})); disposables.push(knotMat);
  const knot = new THREE.LineSegments(knotGeo, knotMat); knot.frustumCulled = false; knot.visible = false; knot.renderOrder = 7; plungeGroup.add(knot);
  const fragsMesh = bakedLines(ROOM_VORTEX.frags * 2);
  const fr_a = new Float32Array(ROOM_VORTEX.frags), fr_v = new Float32Array(ROOM_VORTEX.frags), fr_l = new Float32Array(ROOM_VORTEX.frags), fr_t = new Float32Array(ROOM_VORTEX.frags), fr_z = new Float32Array(ROOM_VORTEX.frags);
  for (let i = 0; i < ROOM_VORTEX.frags; i++) { fr_a[i] = hash(i, 261) * 6.28; fr_v[i] = ROOM_VORTEX.fragSpeed[0] + hash(i, 262) * (ROOM_VORTEX.fragSpeed[1] - ROOM_VORTEX.fragSpeed[0]); fr_l[i] = ROOM_VORTEX.fragLen[0] + hash(i, 263) * (ROOM_VORTEX.fragLen[1] - ROOM_VORTEX.fragLen[0]); fr_t[i] = hash(i, 264) * 3; fr_z[i] = 120 + hash(i, 265) * 380; }
  // lattice-green extras: ghost figures, translucent capsules drifting in the scaffold
  const ghostGeo = new THREE.CapsuleGeometry(4, 12, 4, 10); disposables.push(ghostGeo);
  const ghostMat = bendable(new THREE.MeshBasicMaterial({color: ROOM_LATTICE.ghostCol, transparent: true, opacity: ROOM_LATTICE.ghostOp, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}));
  disposables.push(ghostMat);
  const ghosts = new THREE.InstancedMesh(ghostGeo, ghostMat, ROOM_LATTICE.ghosts); ghosts.instanceMatrix.setUsage(THREE.DynamicDrawUsage); ghosts.frustumCulled = false; ghosts.visible = false; plungeGroup.add(ghosts);
  const ROOM_OF = {'cage-dark': cageRoom, 'vortex': vortexRoom, 'lattice-green': latticeRoom};

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
    attribute float aCell;         // 0 fine line, 1 major line
    uniform float uOp, uFog, uCamZ, uTime;
    uniform vec4 uImpact;          // x, z, age, strength
    uniform vec3 uCol;
    varying vec3 vCol;
    void main(){
      vec4 wp = modelMatrix * vec4(position, 1.0);
      float dxy = length(vec2(wp.x, wp.z - uCamZ));
      // fine lines fade out early (they pack into a band near the horizon); major lines carry the distance
      float fadeFine = 1.0 - smoothstep(${LAND_FADE_FINE[0].toFixed(1)}, ${LAND_FADE_FINE[1].toFixed(1)}, dxy);
      float fadeMajor = 1.0 - smoothstep(${LAND_FADE[0].toFixed(1)}, ${LAND_FADE[1].toFixed(1)}, dxy);
      float b = mix(${LAND_OP.toFixed(2)} * fadeFine, ${LAND_MAJOR_OP.toFixed(2)} * fadeMajor, aCell);
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
  const LAND_FRAG = /* glsl */`varying vec3 vCol; void main(){ float m = max(vCol.r, max(vCol.g, vCol.b)); float a = min(${LAND_CAP.toFixed(2)}, m); gl_FragColor = vec4(vCol / max(m, 0.001), a); }`;   // alpha-blended and capped so converging lines never sum to white
  const landGeo = (() => {
    const p = [], c = [], H = LAND_SIZE / 2;
    for (let x = -H; x <= H; x += LAND_CELL) for (let z = 0; z < LAND_SIZE; z += LAND_PIECE) { p.push(x, LAND_Y, -z, x, LAND_Y, -z - LAND_PIECE); const m = (Math.round(x) % LAND_MAJOR === 0) ? 1 : 0; c.push(m, m); }
    for (let z = 0; z <= LAND_SIZE; z += LAND_CELL) for (let x = -H; x < H; x += LAND_PIECE) { p.push(x, LAND_Y, -z, x + LAND_PIECE, LAND_Y, -z); const m = (Math.round(z) % LAND_MAJOR === 0) ? 1 : 0; c.push(m, m); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('aCell', new THREE.Float32BufferAttribute(c, 1));
    disposables.push(g); return g;
  })();
  const landMat = new THREE.ShaderMaterial({vertexShader: LAND_VERT, fragmentShader: LAND_FRAG, transparent: true, blending: THREE.NormalBlending, depthWrite: false, toneMapped: false,
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
  const ringGeo = new THREE.RingGeometry(0.965, 1, 96); ringGeo.rotateX(-Math.PI / 2); disposables.push(ringGeo);   // thin white ring
  const ringMat = bendable(new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false}));
  disposables.push(ringMat);
  const impactRing = new THREE.Mesh(ringGeo, ringMat); impactRing.visible = false; landGroup.add(impactRing);
  const impactState = {age: 99, strength: 0, x: 0, z: 0};
  function impact(strength, atZ) {
    impactState.age = 0; impactState.strength = clamp01(strength == null ? 1 : strength);
    impactState.z = atZ == null ? state.camZ - 35 : atZ; impactState.x = 0;
    setLandingPoint(0, atZ == null ? state.camZ - 40 : atZ);   // the flat patch is where the figure comes to rest
  }
  const landingY = () => planeCtl.plane === 'bliss' ? BLISS.base + blissHeight(landing.x, landing.z) : LAND_Y;

  /* ---- glyph rain: one atlas, one InstancedMesh of character quads on the eight walls ---- */
  const glyphAtlas = (() => {
    const [gc, gr] = GLYPH_ATLAS, cw = 32, c = document.createElement('canvas'); c.width = gc * cw; c.height = gr * cw;
    const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff'; g.font = 'bold 26px ui-monospace, Menlo, Consolas, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < GLYPH_CHARS.length; i++) g.fillText(GLYPH_CHARS[i], (i % gc) * cw + cw / 2, Math.floor(i / gc) * cw + cw / 2 + 1);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearMipmapLinearFilter; disposables.push(t); return t;
  })();
  const GLYPH_UV = {}; for (let i = 0; i < GLYPH_CHARS.length; i++) GLYPH_UV[GLYPH_CHARS[i]] = [(i % GLYPH_ATLAS[0]) / GLYPH_ATLAS[0], 1 - (Math.floor(i / GLYPH_ATLAS[0]) + 1) / GLYPH_ATLAS[1]];
  const glyphCellUV = ch => GLYPH_UV[ch] || GLYPH_UV['0'];
  const glyphGeo = new THREE.PlaneGeometry(1, 1);
  const glyphCellAttr = new THREE.InstancedBufferAttribute(new Float32Array(GLYPH_MAX * 2), 2); glyphCellAttr.setUsage(THREE.DynamicDrawUsage);
  glyphGeo.setAttribute('aCell', glyphCellAttr); disposables.push(glyphGeo);
  const glyphMat = new THREE.MeshBasicMaterial({map: glyphAtlas, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide});
  glyphMat.onBeforeCompile = sh => {
    bendCompile(sh);
    sh.vertexShader = sh.vertexShader.replace('void main() {', 'attribute vec2 aCell;\nvoid main() {')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n vMapUv = uv * vec2(' + (1 / GLYPH_ATLAS[0]).toFixed(5) + ', ' + (1 / GLYPH_ATLAS[1]).toFixed(5) + ') + aCell;');
  };
  glyphMat.customProgramCacheKey = () => 'glyph'; disposables.push(glyphMat);
  const glyphs = new THREE.InstancedMesh(glyphGeo, glyphMat, GLYPH_MAX);
  glyphs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  glyphs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(GLYPH_MAX * 3), 3); glyphs.instanceColor.setUsage(THREE.DynamicDrawUsage);
  glyphs.frustumCulled = false; glyphs.visible = false; glyphs.renderOrder = 20; group.add(glyphs);
  const DROP_N = 8 * GLYPH_LANES * GLYPH_DROPS;
  const dZ0 = new Float32Array(DROP_N), dSpeed = new Float32Array(DROP_N), dTail = new Uint8Array(DROP_N), dSeed = new Float32Array(DROP_N);
  for (let i = 0; i < DROP_N; i++) { dZ0[i] = hash(i, 181) * GLYPH_SEG; dSpeed[i] = GLYPH_SPEED[0] + hash(i, 182) * (GLYPH_SPEED[1] - GLYPH_SPEED[0]); dTail[i] = GLYPH_TAIL[0] + Math.floor(hash(i, 183) * (GLYPH_TAIL[1] - GLYPH_TAIL[0])); dSeed[i] = hash(i, 184) * 100; }
  const wordSlots = [];                  // {word, wall, u, z0}
  GLYPH_WORDS.forEach((w, wi) => { for (let c = 0; c < GLYPH_WORD_COPIES; c++) { const k = wi * 7 + c * 3; wordSlots.push({word: w, wall: Math.floor(hash(k, 185) * 8), u: (hash(k, 186) - 0.5) * 50, z0: -hash(k, 187) * GLYPH_SEG}); } });
  const _gx = new THREE.Vector3(), _gy = new THREE.Vector3(), _gz = new THREE.Vector3(), _gm = new THREE.Matrix4(), _gq = new THREE.Quaternion();
  // per-wall bases, computed once: reading direction along the corridor, up across the wall (up-ish), facing the axis; right-handed so the front face is inward
  const GLYPH_WALLS = Array.from({length: 8}, (_, wall) => {
    const ak = (wall + 0.5) * Math.PI / 4, nx = Math.cos(ak), ny = Math.sin(ak), tx = -ny, ty = nx;
    _gy.set(tx, ty, 0); if (ty < -0.05 || (Math.abs(ty) <= 0.05 && tx < 0)) _gy.negate();
    _gz.set(-nx, -ny, 0); _gx.crossVectors(_gy, _gz);
    return {nx, ny, tx, ty, dirZ: _gx.z, R: [_gx.x, _gx.y, _gx.z, _gy.x, _gy.y, _gy.z, _gz.x, _gz.y, _gz.z]};
  });
  const exitCtl = {t0: -99, secs: 0, active: false};
  function matrixExit(secs) { exitCtl.t0 = state.t; exitCtl.secs = Math.max(0.2, secs == null ? 1.5 : secs); exitCtl.active = true; }
  let glyphCount = 0;
  function putGlyph(W, x, y, z, size, cellUV, col) {
    if (glyphCount >= GLYPH_MAX) return;
    const i = glyphCount++, arr = glyphs.instanceMatrix.array, ca = glyphs.instanceColor.array, cu = glyphCellAttr.array, R = W.R, o = i * 16;
    arr[o] = R[0] * size; arr[o + 1] = R[1] * size; arr[o + 2] = R[2] * size; arr[o + 3] = 0;
    arr[o + 4] = R[3] * size; arr[o + 5] = R[4] * size; arr[o + 6] = R[5] * size; arr[o + 7] = 0;
    arr[o + 8] = R[6]; arr[o + 9] = R[7]; arr[o + 10] = R[8]; arr[o + 11] = 0;
    arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
    ca[i * 3] = col.r; ca[i * 3 + 1] = col.g; ca[i * 3 + 2] = col.b; cu[i * 2] = cellUV[0]; cu[i * 2 + 1] = cellUV[1];
  }
  const _ga = new THREE.Color(), _gb = new THREE.Color(), _gh = new THREE.Color();
  function bakeGlyphs(camZ, gt, primary, secondary, weight, exitT, exitSecs, split) {
    glyphCount = 0;
    const drain = exitT >= 0, dist = OCT_APOTHEM - GLYPH_INSET;
    _gh.copy(primary).lerp(tmpB.set(1, 1, 1), 0.75);
    const copies = split > 0 ? 3 : 1;
    const emit = (wall, u, z, size, cellUV, col, laneSeed) => {
      // matrix exit: cells drop along world -y with a per-lane delay and fade out
      let dy = 0, k = 1;
      if (drain) { const te = exitT - laneSeed * 0.45 * exitSecs; if (te > 0) { dy = -60 * te * te; k = Math.max(0, 1 - te / (0.55 * exitSecs)); } }
      if (k <= 0.01) return;
      const W = GLYPH_WALLS[wall], nx = W.nx, ny = W.ny, tx = W.tx, ty = W.ty;
      const x = nx * dist + tx * u, y = ny * dist + ty * u + dy;
      if (copies === 1) putGlyph(W, x, y, z, size, cellUV, _ga.copy(col).multiplyScalar(k * weight));
      else for (let c = 0; c < 3; c++) { const d = (c - 1) * EXIT_SPLIT_OFF * split; putGlyph(W, x + d * tx, y + d * ty, z, size, cellUV, _ga.copy(_rgb[c]).multiply(col).multiplyScalar(k * weight * 1.5)); }
    };
    for (let i = 0; i < DROP_N; i++) {
      const wall = Math.floor(i / (GLYPH_LANES * GLYPH_DROPS)), lane = Math.floor(i / GLYPH_DROPS) % GLYPH_LANES;
      const u = -30 + lane * 10 + (hash(i, 188) - 0.5) * 3;
      const head = camZ + BEHIND - ((dZ0[i] + dSpeed[i] * gt) % GLYPH_SEG);
      const L = dTail[i], flip = Math.floor(gt * GLYPH_FLIP + dSeed[i]);
      for (let k = 0; k < L; k++) {
        const z = head + k * GLYPH_CELL; if (z > camZ + BEHIND) break;
        const ch = GLYPH_CHARS[Math.floor(hash(i * 131 + k, 190 + (flip % 7)) * GLYPH_CHARS.length)];
        const f = Math.pow(1 - k / L, 1.1);
        const col = k === 0 ? _gh : _gb.copy(k % 4 === 3 ? secondary : primary).multiplyScalar(GLYPH_TAIL_GAIN * f);
        emit(wall, u, z, GLYPH_CELL, glyphCellUV(ch), col, hash(i, 189));
      }
    }
    for (const ws of wordSlots) {
      let z = ws.z0; while (z > camZ + BEHIND) z -= GLYPH_SEG; while (z < camZ + BEHIND - GLYPH_SEG) z += GLYPH_SEG; ws.z0 = z;
      const dir = GLYPH_WALLS[ws.wall].dirZ;   // reading direction along z for this wall
      for (let j = 0; j < ws.word.length; j++) {
        const ch = ws.word[j]; if (ch === ' ') continue;
        const zj = z + dir * j * GLYPH_WORD_CELL; if (zj > camZ + BEHIND) continue;
        emit(ws.wall, ws.u, zj, GLYPH_WORD_CELL, glyphCellUV(ch), _gb.copy(primary).lerp(tmpB.set(1, 1, 1), 0.45).multiplyScalar(1.3), hash(ws.wall * 7 + ws.u, 191));
      }
    }
    glyphs.count = glyphCount;
    glyphs.instanceMatrix.needsUpdate = true; glyphs.instanceColor.needsUpdate = true; glyphCellAttr.needsUpdate = true;
  }

  /* ---- bliss: a rolling green hill, a sky dome, clouds, sun ---- */
  const blissGroup = new THREE.Group(); blissGroup.visible = false; group.add(blissGroup); looks.bliss.group = blissGroup;
  const blissBase = {z: 0};
  // Hills are a function of WORLD x/z placed around the landing point, so the field can be re-centred on the camera without swimming.
  // The landing point is where the camera comes to rest: set by impact() (camera z minus 40) or setLandingPoint(x, z); until then, where setLook('bliss') was called.
  const landing = {x: 0, z: -35, set: false};
  const blissHeight = (wx, wz) => {      // world coordinates; flat within BLISS.flat[0] of the landing point
    const x = wx - landing.x, z = wz - landing.z;
    const R = BLISS.ridge, dz = (z - R.z) / R.len;
    let h = (R.h - R.saddle * Math.exp(-(((x - R.saddleX) / R.saddleLen) ** 2))) * Math.exp(-dz * dz) * (1 + 0.08 * Math.sin(x / 260));   // ridge along x, dip in the middle
    for (const [hx, hz, r, hh] of BLISS.hills) { const d2 = ((x - hx) ** 2 + (z - hz) ** 2) / (r * r); h += hh * Math.exp(-d2 * 1.6); }
    return h * smooth(BLISS.flat[0], BLISS.flat[1], Math.hypot(x, z));
  };
  function setLandingPoint(x, z) { landing.x = x || 0; landing.z = z; landing.set = true; hillCentre.dirty = true; }
  const hillGeo = new THREE.PlaneGeometry(BLISS.size, BLISS.size, BLISS.segs, BLISS.segs); hillGeo.rotateX(-Math.PI / 2);
  hillGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(hillGeo.attributes.position.count * 3), 3));
  hillGeo.attributes.position.setUsage(THREE.DynamicDrawUsage); hillGeo.attributes.color.setUsage(THREE.DynamicDrawUsage);
  const hillBase = hillGeo.attributes.position.array.slice();   // flat template, local x/z
  const hillCentre = {x: 0, z: 0, dirty: true};
  function bakeHills(cx, cz) {
    // Shading is BAKED into the vertex colours (Lambert from the sun plus a sky/ground hemisphere) on an unlit material:
    // the host page runs no-decay key, fill and accent rim lights that push any lit green ground into clipped yellow.
    const pos = hillGeo.attributes.position, col = hillGeo.attributes.color.array;
    let hmax = BLISS.ridge.h; for (const h of BLISS.hills) hmax = Math.max(hmax, h[3]);
    for (let i = 0; i < pos.count; i++) { const x = hillBase[i * 3], z = hillBase[i * 3 + 2]; pos.setXYZ(i, x, BLISS.base + blissHeight(cx + x, cz + z), z); }
    hillGeo.computeVertexNormals();
    const nrm = hillGeo.attributes.normal, sunDir = new THREE.Vector3(...BLISS.sun.dir).normalize();
    const skyC = new THREE.Color(BLISS.hemi.sky), gndC = new THREE.Color(BLISS.hemi.ground), sunC = new THREE.Color(BLISS.sun.color);
    for (let i = 0; i < pos.count; i++) {
      const h = pos.getY(i) - BLISS.base, nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i);
      const lambert = Math.max(0, nx * sunDir.x + ny * sunDir.y + nz * sunDir.z);
      // vertex colour = shading only (the grass texture carries the green): sun Lambert + hemisphere, a touch lighter on the crests,
      // and a darker band on the far side of each hill (slopes facing away from the camera) for a rolling read
      _pc.setRGB(0.92, 1.0, 0.9).lerp(tmpB.set(1.08, 1.06, 0.95), Math.pow(h / hmax, 0.8));
      tmpA.copy(sunC).multiplyScalar(1.0 * lambert).add(tmpB.copy(gndC).lerp(skyC, 0.5 + 0.5 * ny).multiplyScalar(0.5).lerp(tmpB.set(1, 1, 1), 0.6));
      _pc.multiply(tmpA).multiplyScalar(1 - BLISS.farBand * Math.max(0, -nz) * (h > 2 ? 1 : 0));
      const lum = 0.2126 * _pc.r + 0.7152 * _pc.g + 0.0722 * _pc.b; if (lum > BLISS.maxLum) _pc.multiplyScalar(BLISS.maxLum / lum);
      col[i * 3] = _pc.r; col[i * 3 + 1] = _pc.g; col[i * 3 + 2] = _pc.b;
    }
    pos.needsUpdate = true; hillGeo.attributes.color.needsUpdate = true; hillGeo.attributes.normal.needsUpdate = true;
    hillCentre.x = cx; hillCentre.z = cz; hillCentre.dirty = false;
  }
  const grassTex = grassTexture(THREE, 512, BLISS.low, BLISS.high); disposables.push(grassTex);
  grassTex.repeat.set(BLISS.grassRepeat, BLISS.grassRepeat);
  grassTex.anisotropy = opts.renderer && opts.renderer.capabilities ? opts.renderer.capabilities.getMaxAnisotropy() : 16;
  const hillMat = new THREE.MeshBasicMaterial({map: grassTex, vertexColors: true, transparent: true, opacity: 1, toneMapped: false, fog: false});
  // no scene fog on the grass; a haze toward the sky's horizon colour starts only at BLISS.haze[0] units so the near field stays sharp
  hillMat.onBeforeCompile = sh => {
    sh.uniforms.uHaze = {value: new THREE.Color(BLISS.sky.horizon)}; sh.uniforms.uHazeRange = {value: new THREE.Vector2(BLISS.haze[0], BLISS.haze[1])};
    sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying vec3 vWp;\nvoid main() {').replace('#include <fog_vertex>', '#include <fog_vertex>\n vWp = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'varying vec3 vWp; uniform vec3 uHaze; uniform vec2 uHazeRange;\nvoid main() {')
      .replace('#include <fog_fragment>', '#include <fog_fragment>\n gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, smoothstep(uHazeRange.x, uHazeRange.y, distance(vWp, cameraPosition)));');
  };
  hillMat.customProgramCacheKey = () => 'grass';
  const hill = new THREE.Mesh(hillGeo, hillMat); hill.frustumCulled = false; blissGroup.add(hill); disposables.push(hillGeo, hillMat);
  const skyGeo = new THREE.SphereGeometry(BLISS.sky.radius, 32, 16); disposables.push(skyGeo);
  const skyMat = new THREE.ShaderMaterial({side: THREE.BackSide, depthWrite: false, fog: false, transparent: true,
    uniforms: {uZenith: {value: new THREE.Color(BLISS.sky.zenith)}, uMid: {value: new THREE.Color(BLISS.sky.mid)}, uHorizon: {value: new THREE.Color(BLISS.sky.horizon)}, uOp: {value: 1}, uMaxLum: {value: BLISS.sky.maxLum}},
    vertexShader: 'varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    // three-stop gradient; the result is clamped below the bloom threshold so the sky itself never blooms
    fragmentShader: 'uniform vec3 uZenith, uMid, uHorizon; uniform float uOp, uMaxLum; varying float vY; void main(){ float t = clamp(vY, 0.0, 1.0); vec3 c = t < 0.25 ? mix(uHorizon, uMid, t / 0.25) : mix(uMid, uZenith, pow((t - 0.25) / 0.75, 0.7)); float lum = dot(c, vec3(0.2126, 0.7152, 0.0722)); if (lum > uMaxLum) c *= uMaxLum / lum; gl_FragColor = vec4(c, uOp); }'});
  disposables.push(skyMat);
  const sky = new THREE.Mesh(skyGeo, skyMat); sky.renderOrder = -10; sky.frustumCulled = false; blissGroup.add(sky);
  const cloudGeo = new THREE.PlaneGeometry(420, 210); disposables.push(cloudGeo);
  const cloudTex = cumulusTexture(THREE, 512, 256); disposables.push(cloudTex);
  const cloudMat = new THREE.MeshBasicMaterial({map: cloudTex, transparent: true, opacity: BLISS.cloudOp, depthWrite: false, fog: false, toneMapped: false, alphaTest: 0.02});   // normal blending
  const sunGeo = new THREE.PlaneGeometry(1, 1); disposables.push(sunGeo);
  const sunTex = sunDiscTexture(THREE, 256); disposables.push(sunTex);
  const sunMat = new THREE.MeshBasicMaterial({map: sunTex, transparent: true, opacity: 0.9, depthWrite: false, fog: false, toneMapped: false});
  disposables.push(sunMat);
  const sunDisc = new THREE.Mesh(sunGeo, sunMat); sunDisc.frustumCulled = false; blissGroup.add(sunDisc);
  disposables.push(cloudMat);
  const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, BLISS.clouds.length); clouds.frustumCulled = false; blissGroup.add(clouds);
  const cloudPos = BLISS.clouds;
  const sun = new THREE.DirectionalLight(BLISS.sun.color, BLISS.sun.intensity); sun.position.set(0.7, 0.9, 0.5);
  const hemi = new THREE.HemisphereLight(BLISS.hemi.sky, BLISS.hemi.ground, BLISS.hemi.intensity);
  const blissKey = new THREE.DirectionalLight(LAND_KEY.color, LAND_KEY.intensity); blissKey.position.set(-1, 0.8, 1);
  const blissFill = new THREE.DirectionalLight(LAND_FILL.color, LAND_FILL.intensity); blissFill.position.set(0.4, 0.5, -1);
  blissGroup.add(sun, hemi, blissKey, blissFill);
  const puffGeo = new THREE.PlaneGeometry(2, 2); puffGeo.rotateX(-Math.PI / 2); disposables.push(puffGeo);
  const puffMat = new THREE.MeshBasicMaterial({map: memGlowTex, alphaMap: memGlowTex, color: BLISS_PUFF.color, transparent: true, opacity: 0, depthWrite: false, toneMapped: false});
  disposables.push(puffMat);
  const puff = new THREE.Mesh(puffGeo, puffMat); puff.visible = false; blissGroup.add(puff);

  const planeCtl = {plane: 'grid'};
  function setPlane(name) { planeCtl.plane = name === 'grid' || name === 'landing-grid' ? 'grid' : 'bliss'; }
  const callLog = [];
  // Authored looks (memory, plunge, landing, bliss) are sticky: a phase-mode request (null, cage, tessellation, inverse) arriving while one is
  // active is ignored unless the page has just signalled it is leaving Act 2 (setBeatMorph(true) within RELEASE_WINDOW, as leaveAct2 does) or
  // called release(). The host's Act 1 opening-look timers fire on boot time and would otherwise cut into the fall under #act2=0.
  const AUTHORED = new Set(['memory', 'plunge', 'landing', 'bliss']), PHASE_MODE = new Set([null, 'cage', 'tessellation', 'inverse']);
  const RELEASE_WINDOW = 0.6;
  let releaseAt = -99, released = false;
  function release() { released = true; }
  function setLook(name, fadeSecs) {
    callLog.push({f: 'setLook', name, fade: fadeSecs, t: +state.t.toFixed(2), stage: plunge.stage});
    if (AUTHORED.has(lookCtl.name) && PHASE_MODE.has(name) && !released && state.t - releaseAt > RELEASE_WINDOW) { callLog.push({f: 'setLook-ignored', name, t: +state.t.toFixed(2)}); return; }
    released = false;
    if (name === 'landing') name = planeCtl.plane === 'bliss' ? 'bliss' : 'landing';
    else if (name === 'landing-grid') name = 'landing';
    if (name === 'bliss') { blissBase.z = state.camZ; if (!landing.set) { landing.x = 0; landing.z = state.camZ - 35; hillCentre.dirty = true; } }
    if (name != null && !looks[name]) throw new Error('unknown look ' + name);
    lookCtl.name = name; lookCtl.fade = fadeSecs == null ? LOOK_FADE : Math.max(0, fadeSecs);
    if (name === 'plunge') state.warm = 2;   // next frames: every stage mesh renders empty once so programs compile and buffers upload before any cut
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
    const memW = looks.memory.w * openK, plungeW = looks.plunge.w * openK, landW = looks.landing.w * openK, blissW = looks.bliss.w * openK;
    // inverse wipes the host scene's fog and background toward paper white (captured once, restored as the weight returns to 0)
    const sc = group.parent;
    if (sc && sc.fog && sc.fog.color) {
      if (!state.fog0) { state.fog0 = sc.fog.color.clone(); state.bg0 = sc.background && sc.background.isColor ? sc.background.clone() : null; }
      sc.fog.color.copy(state.fog0).lerp(tmpB.setHex(INVERSE_BG), invW).lerp(tmpA.setHex(BLISS.fogColor), blissW * (1 - invW));
      if (state.bg0 && sc.background && sc.background.isColor) sc.background.copy(state.bg0).lerp(tmpB.setHex(INVERSE_BG), invW).lerp(tmpA.setHex(BLISS.sky.horizon), blissW * (1 - invW));
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
      const roomMesh = ROOM_OF[stage] || null;
      const useField = stage !== 'lattice' && stage !== 'stairs' && stage !== 'rings' && stage !== 'glyphs' && stage !== 'prism' && stage !== 'prism-tri' && !roomMesh;
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
      // lusion rooms
      const room = ROOM_OF[stage] || null;
      for (const r of rooms) { const on = r === room; r.beams.visible = on; r.caps.visible = on; r.haze.visible = on; }
      halo.visible = !!room; if (!room) roomLight.intensity = 0; vortexCore.visible = stage === 'vortex'; knot.visible = stage === 'vortex'; fragsMesh.visible = stage === 'vortex'; ghosts.visible = stage === 'lattice-green';
      if (room) {
        const per = room.period, snap = Math.ceil((camZ + BEHIND) / per) * per;
        room.beams.position.z = snap; room.caps.position.z = snap;
        const smearZ = reduced ? 0 : Math.min(SMEAR.max, SMEAR.base + SMEAR.perV * v);
        const rot = stage === 'vortex' ? state.t * ROOM_VORTEX.rot : (stage === 'cage-dark' ? state.t * ROOM_CAGE.roll : 0);
        { const u = roomU; u.uCamZ.value = camZ; u.uSmearZ.value = smearZ; u.uRot.value = reduced ? 0 : rot; u.uTime.value = state.t;
          u.uTwist.value = stage === 'vortex' ? ROOM_VORTEX.twist : 0; u.uHelix.value = stage === 'cage-dark' ? ROOM_CAGE.helix : 0; }
        for (const m of room.mats) m.opacity = plungeW * cutK;
        { const c = curve(camZ); roomLight.position.set(c.x, c.y, camZ - ROOM_LIGHT.dist); roomLight.intensity = ROOM_LIGHT.intensity * plungeW; }
        // haze planes ride with the camera, drifting slowly
        const hArr2 = room.haze.instanceMatrix.array;
        for (let i = 0; i < room.hazeN; i++) {
          const a = i * 2.4 + (reduced ? 0 : state.t * 0.07), r = HAZE.r[0] + (HAZE.r[1] - HAZE.r[0]) * hash(i, 331), sz = HAZE.size[0] + (HAZE.size[1] - HAZE.size[0]) * hash(i, 332);
          const zz = camZ - 120 - hash(i, 333) * 320, c = curve(zz), dr = reduced ? 0 : Math.sin(state.t * 0.13 + i) * HAZE.drift;
          _o.position.set(c.x + (r + dr) * Math.cos(a), c.y + (r + dr) * Math.sin(a), zz); _o.quaternion.identity(); _o.scale.set(sz, sz, 1); _o.updateMatrix(); _o.matrix.toArray(hArr2, i * 16);
        }
        room.haze.count = room.hazeN; room.haze.instanceMatrix.needsUpdate = true; room.haze.material.opacity = room.opts.hazeOp * plungeW;
        // halo: R/G/B split ring at the vanishing point; green-tinted in the lattice room
        const hz = camZ - HALO.dist, hc = curve(hz), hArr = halo.instanceMatrix.array, hCol = halo.instanceColor.array;
        for (let i = 0; i < 3; i++) { const sc2 = HALO.size * (1 + (i - 1) * HALO.split); hArr.fill(0, i * 16, i * 16 + 16); hArr[i * 16] = sc2; hArr[i * 16 + 5] = sc2; hArr[i * 16 + 10] = 1; hArr[i * 16 + 15] = 1; hArr[i * 16 + 12] = hc.x; hArr[i * 16 + 13] = hc.y; hArr[i * 16 + 14] = hz;
          const g = stage === 'lattice-green' ? [0.35, 1.0, 0.45][i] : 1; hCol[i * 3] = (i === 0 ? 1 : 0.05) * g * HALO.op; hCol[i * 3 + 1] = (i === 1 ? 1 : 0.05) * g * HALO.op; hCol[i * 3 + 2] = (i === 2 ? 1 : 0.05) * g * HALO.op; }
        halo.count = 3; halo.instanceMatrix.needsUpdate = true; halo.instanceColor.needsUpdate = true; haloMat.opacity = plungeW;
        if (stage === 'vortex') {
          const cz = camZ - ROOM_VORTEX.coreDist, cc = curve(cz);
          vortexCore.position.set(cc.x, cc.y, cz); vortexCore.scale.set(ROOM_VORTEX.coreSize, ROOM_VORTEX.coreSize, 1); coreMat.opacity = ROOM_VORTEX.coreOp * plungeW * cutK;
          knot.position.set(cc.x, cc.y, cz + 6); knot.rotation.set(state.t * 0.9, state.t * 1.3, state.t * 0.5); knotMat.opacity = 0.9 * plungeW;
          const arr = fragsMesh.geometry.attributes.position.array, carr = fragsMesh.geometry.attributes.color.array; let o = 0;
          const ca = tmpA.setHex(ROOM_VORTEX.tint[0]), cb = tmpB.setHex(ROOM_VORTEX.tint[1]);
          for (let i = 0; i < ROOM_VORTEX.frags; i++) {
            fr_t[i] += dt; const r = 6 + fr_v[i] * fr_t[i]; if (r > 140) { fr_t[i] = 0; fr_a[i] = hash(i + Math.floor(state.t * 7), 266) * 6.28; }
            const a = fr_a[i] + state.t * ROOM_VORTEX.rot, dx = Math.cos(a), dy = Math.sin(a), z = camZ - fr_z[i], c = i & 1 ? ca : cb, k = (1 - r / 140) * 1.4 * plungeW;
            arr[o] = dx * r; arr[o + 1] = dy * r; arr[o + 2] = z; arr[o + 3] = dx * (r + fr_l[i]); arr[o + 4] = dy * (r + fr_l[i]); arr[o + 5] = z;
            for (let q = 0; q < 2; q++) { carr[o + q * 3] = c.r * k; carr[o + q * 3 + 1] = c.g * k; carr[o + q * 3 + 2] = c.b * k; } o += 6;
          }
          fragsMesh.geometry.setDrawRange(0, o / 3); fragsMesh.geometry.attributes.position.needsUpdate = true; fragsMesh.geometry.attributes.color.needsUpdate = true; fragsMesh.material.opacity = 1;
        }
        if (stage === 'lattice-green') {
          const gArr = ghosts.instanceMatrix.array;
          for (let i = 0; i < ROOM_LATTICE.ghosts; i++) {
            const ang = i * 1.7 + state.t * 0.15, r = 60 + 40 * Math.sin(i * 2.1 + state.t * 0.1), z = camZ - 140 - i * 90 - 30 * Math.sin(state.t * 0.3 + i);
            _o.position.set(r * Math.cos(ang), r * Math.sin(ang), z); _o.rotation.set(0.3 * Math.sin(state.t * 0.4 + i), 0, 0.5 + 0.4 * i); _o.scale.set(1, 1, 1); _o.updateMatrix(); _o.matrix.toArray(gArr, i * 16);
          }
          ghosts.count = ROOM_LATTICE.ghosts; ghosts.instanceMatrix.needsUpdate = true; ghostMat.opacity = ROOM_LATTICE.ghostOp * plungeW;
        }
      }

      // prism tunnel
      const prismOn = stage === 'prism' || stage === 'prism-tri';
      prismLines.visible = prismOn; prismFill.visible = prismOn;
      if (prismOn) {
        const m = stage === 'prism-tri' ? smooth(0.05, 0.05 + PRISM.morph, st) * (1 - smooth(1.1, 1.1 + PRISM.morph, st)) : 0;   // square -> triangle -> back
        const streak = Math.min(PRISM.streakMax, stretch), cube = PRISM.cube;
        const arr = prismLines.geometry.attributes.position.array, carr = prismLines.geometry.attributes.color.array;
        const fArr = prismFill.instanceMatrix.array, fCol = prismFill.instanceColor.array;
        const z0 = Math.floor((camZ + PRISM.ahead) / PRISM.cell) * PRISM.cell;
        let o = 0, n = 0;
        for (let r = 0; r < PRISM_RINGS; r++) {
          const z = z0 - r * PRISM.cell, band = Math.round(-z / PRISM.cell), col = prismColour(band);
          const dz = Math.abs(z - camZ), k = PRISM.maxK * (1 - smooth(PRISM.fadeZ[0], PRISM.fadeZ[1], dz)) * cutK;   // far rings fade out before they can stack into a blast
          const tw = band * PRISM.twist, ct = Math.cos(tw), stw = Math.sin(tw);
          if (r === 0) prism.flashCol.copy(col);
          for (let q = 0; q < PRISM.perRing; q++) {
            prismPoint(q / PRISM.perRing, m, _pp);
            const cx = _pp[0] * ct - _pp[1] * stw, cy = _pp[0] * stw + _pp[1] * ct;
            for (const [ia, ib] of CUBE_E) for (const iv of [ia, ib]) { const v = CUBE_V[iv];
              arr[o] = cx + v[0] * cube; arr[o + 1] = cy + v[1] * cube; arr[o + 2] = z + v[2] * cube * streak;
              carr[o] = col.r * k; carr[o + 1] = col.g * k; carr[o + 2] = col.b * k; o += 3; }
            const i16 = n * 16; fArr.fill(0, i16, i16 + 16); fArr[i16] = cube * 0.92; fArr[i16 + 5] = cube * 0.92; fArr[i16 + 10] = cube * 0.92 * streak; fArr[i16 + 15] = 1;
            fArr[i16 + 12] = cx; fArr[i16 + 13] = cy; fArr[i16 + 14] = z;
            const fk = k * smooth(PRISM.fillNear[0], PRISM.fillNear[1], dz);   // no fill on the cubes passing close to the lens, so they never bloom to white
            fCol[n * 3] = col.r * fk; fCol[n * 3 + 1] = col.g * fk; fCol[n * 3 + 2] = col.b * fk; n++;
          }
        }
        prismLines.geometry.setDrawRange(0, o / 3);
        prismLines.geometry.attributes.position.needsUpdate = true; prismLines.geometry.attributes.color.needsUpdate = true;
        prismLines.material.opacity = PRISM.lineOp * plungeW; prismLines.material.blending = THREE.NormalBlending;   // alpha, not additive: stacked far rings saturate at their colour, never white
        prismFill.count = n; prismFill.instanceMatrix.needsUpdate = true; prismFill.instanceColor.needsUpdate = true;
        prismFillMat.opacity = PRISM.fill * plungeW;
        // soft background flash toward the nearest band's colour, following each re-roll
        const sc3 = group.parent;
        if (sc3 && sc3.background && sc3.background.isColor && plunge.flashT < PLUNGE_BEAT_INV * 1.6) sc3.background.lerp(prism.flashCol, PRISM.flash * (1 - plunge.flashT / (PLUNGE_BEAT_INV * 1.6)));
      }
      // beat flash: the background takes the pair's colour at 25% for the swap window
      const sc2 = group.parent;
      if (sc2 && sc2.background && sc2.background.isColor && plunge.flashT < PLUNGE_BEAT_INV) sc2.background.lerp(tmpB.copy(plunge.colA), 0.25 * (1 - plunge.flashT / PLUNGE_BEAT_INV));
    }

    /* ---------- landing ---------- */
    landGroup.visible = landW > 0.004;
    if (landGroup.visible) {
      landFloor.position.z = Math.ceil((camZ + 200) / LAND_MAJOR) * LAND_MAJOR;   // snap by the major cell so both grids stay put
      const u = landMat.uniforms;
      u.uOp.value = landW; u.uCamZ.value = camZ; u.uTime.value = reduced ? 0 : state.t; u.uCol.value.setRGB(1, 1, 1);   // no tint: white lines on black
      impactState.age += dt;
      u.uImpact.value.set(impactState.x, impactState.z, impactState.age, impactState.age < 3 ? impactState.strength : 0);
      const rt = Math.min(1, impactState.age / IMPACT_RING.secs), rr = IMPACT_RING.radius * rt;
      impactRing.visible = impactState.age < IMPACT_RING.secs * 1.6;
      if (impactRing.visible) {
        const c = curve(impactState.z);
        impactRing.position.set(impactState.x, LAND_Y + 0.2, impactState.z);
        impactRing.scale.set(rr + 0.01, 1, rr + 0.01);
        ringMat.color.setRGB(1, 1, 1);
        ringMat.opacity = impactState.strength * (1 - rt) * landW;
      }
      horizon.visible = false;   // black horizon, no glow line
      { const lz = camZ - BLACKOUT_LIGHT.dist, c = curve(lz); landLight.position.set(c.x, c.y + 6, lz); landLight.color.copy(accent).lerp(tmpB.set(1, 1, 1), 0.3); landLight.intensity = BLACKOUT_LIGHT.intensity * landW; }
      landKey.intensity = LAND_KEY.intensity * landW; landFill.intensity = LAND_FILL.intensity * landW;
      landDust.pts.visible = false;   // nothing in the air over the plain grid
      const du = landDust.mat.uniforms;
      du.uTime.value = state.gt; du.uHeight.value = s.viewportHeight || du.uHeight.value; du.uStretch.value = 0;
      du.uWeight.value = landW * 0.3; du.uCamZ.value = camZ; du.uReduced.value = reduced ? 1 : 0; du.uHigh.value = high;
      du.uTintA.value.copy(accent); du.uTintB.value.setRGB(0.7, 0.7, 0.8);
    }

    /* ---------- glyph rain (plunge stage 'glyphs', and the matrix exit overlay) ---------- */
    {
      const stageGlyphs = plungeGroup.visible && (plunge.stage === 'glyphs');
      const exitT = exitCtl.active ? state.t - exitCtl.t0 : -1;
      if (exitCtl.active && exitT > exitCtl.secs * 1.1) exitCtl.active = false;
      glyphs.visible = stageGlyphs || exitCtl.active;
      if (glyphs.visible) {
        const split = exitCtl.active ? Math.max(0, 1 - exitT / EXIT_SPLIT) : 0;
        const w = stageGlyphs ? plungeW * (plunge.cut > 0 && state.t - plunge.stageT0 < plunge.cut ? 0.35 + 0.65 * (state.t - plunge.stageT0) / plunge.cut : 1) : 1;
        bakeGlyphs(camZ, reduced ? 0 : state.gt, plunge.colA, plunge.colB, w, exitCtl.active ? exitT : -1, exitCtl.secs, split);
      }
    }

    /* ---------- bliss ---------- */
    blissGroup.visible = blissW > 0.004;
    if (blissGroup.visible) {
      // the field rides with the camera in steps, ±1200 around it, rebuilt from the world-space height function so nothing swims
      { const c = curve(camZ), cx = Math.round(c.x / BLISS.recentre) * BLISS.recentre, cz = Math.round(camZ / BLISS.recentre) * BLISS.recentre;
        if (hillCentre.dirty || cx !== hillCentre.x || cz !== hillCentre.z) bakeHills(cx, cz);
        hill.position.set(cx, 0, cz); }
      hillMat.opacity = blissW; skyMat.uniforms.uOp.value = blissW;
      sky.position.set(curve(camZ).x, curve(camZ).y, camZ);
      const cArr = clouds.instanceMatrix.array;
      for (let i = 0; i < cloudPos.length; i++) {
        const [cx, cy, cz, sc] = cloudPos[i], drift = reduced ? 0 : Math.sin(state.t * 0.04 + i) * 20;
        _o.position.set(landing.x + cx + drift, cy, landing.z + cz); _o.quaternion.identity(); _o.scale.set(sc, sc, 1); _o.updateMatrix(); _o.matrix.toArray(cArr, i * 16);
      }
      { const [sx, sy, sz, ss] = BLISS.sunDisc; sunDisc.position.set(landing.x + sx, sy, landing.z + sz); sunDisc.scale.set(ss * 2.6, ss * 2.6, 1); sunMat.opacity = 0.9 * blissW; }
      clouds.instanceMatrix.needsUpdate = true; cloudMat.opacity = BLISS.cloudOp * blissW;
      sun.intensity = BLISS.sun.intensity * blissW; hemi.intensity = BLISS.hemi.intensity * blissW;
      blissKey.intensity = LAND_KEY.intensity * blissW; blissFill.intensity = LAND_FILL.intensity * blissW;
      if (planeCtl.plane === 'bliss') {
        impactState.age += landW > 0.004 ? 0 : dt;    // the grid look ticks it otherwise
        const pt = Math.min(1, impactState.age / BLISS_PUFF.secs);
        puff.visible = impactState.age < BLISS_PUFF.secs * 1.5;
        if (puff.visible) {
          const r = BLISS_PUFF.radius * (0.15 + 0.85 * pt);
          puff.position.set(impactState.x, BLISS.base + blissHeight(impactState.x, impactState.z) + 0.6, impactState.z);
          puff.scale.set(r, 1, r); puffMat.opacity = impactState.strength * (1 - pt) * BLISS_PUFF.op * blissW;
        }
      }
    }

    if (state.warm > 0) {
      // warm-up: draw every plunge stage mesh (and the glyph rain) with nothing in it, so shader compiles and buffer uploads happen here, not on a cut
      state.warm--;
      const empties = [latticeMesh, ringsMesh, stairsMesh, prismLines, fragsMesh, knot, ...plungeSets.map(p => p.mesh)];
      for (const im of [halo, ghosts, ...rooms.flatMap(r => [r.beams, r.caps, r.haze])]) if (!im.visible) { im.visible = true; im.userData.warm = true; if (im.userData.count0 == null) im.userData.count0 = im.count; im.count = 0; }   // capture the real count once: the room block re-hides idle rooms every frame
      if (!vortexCore.visible) { vortexCore.visible = true; vortexCore.userData.warm = true; vortexCore.scale.set(0, 0, 0); }
      for (const mm of empties) if (!mm.visible) { mm.visible = true; mm.userData.warm = true; mm.geometry.setDrawRange(0, 0); }
      if (!prismFill.visible) { prismFill.visible = true; prismFill.userData.warm = true; prismFill.count = 0; }
      if (!glyphs.visible) { glyphs.visible = true; glyphs.userData.warm = true; glyphs.count = 0; }
      plungeGroup.visible = true;
    } else if (state.warm === 0) {
      state.warm = -1;
      for (const mm of [latticeMesh, ringsMesh, stairsMesh, prismLines, prismFill, glyphs, fragsMesh, knot, halo, ghosts, vortexCore, ...rooms.flatMap(r => [r.beams, r.caps, r.haze]), ...plungeSets.map(p => p.mesh)]) if (mm.userData.warm) { mm.userData.warm = false; mm.visible = false; if (mm.userData.count0 != null) { mm.count = mm.userData.count0; mm.userData.count0 = null; } if (mm.geometry && mm.geometry.setDrawRange) mm.geometry.setDrawRange(0, Infinity); }
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
    if (looks.plunge.w > 0.5) { plunge.invT = 0; plunge.flashT = 0; prismReroll(); }   // plunge: invert the pair, re-roll the prism bands, flash the background
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

  const api = {group, update, dispose, kick: strength => kick(strength), setMirror, setLook, release, nextPattern, setPattern, setDim, setBeatMorph, setBend, curve, tangent, setMemories, deal, impact, landingY, plungeStage, setPlane, setLandingPoint, matrixExit, get fogColor() { return looks.bliss.w > 0.5 ? tmpFog.setHex(BLISS.fogColor) : null; }, get inverse() { return looks.inverse.w; },
    runLog: () => runLog.map(r => ({pattern: patterns[r.pattern].name, pair: PALETTE_NAMES[PAT_PAIRS[r.pair][0]] + '/' + PALETTE_NAMES[PAT_PAIRS[r.pair][1]]})), patterns: () => patterns.map(p => ({name: p.name, segments: p.segments})), looks: () => Object.fromEntries(LOOK_NAMES.map(n => [n, looks[n].w])), stats, constants: {HALF_W, CELL, FOG_DENSITY, OCT_APOTHEM, SOLID_BAND, MIRROR_LEN}};
  api.debugLog = () => ({calls: callLog.slice(-40), looks: api.looks(), stage: plunge.stage, lookCtl: {...lookCtl}, warm: state.warm,
    rooms: rooms.map(r => ({beams: {vis: r.beams.visible, count: r.beams.count, op: r.beams.material.opacity, z: +r.beams.position.z.toFixed(0), c0: r.beams.userData.count0}, caps: {vis: r.caps.visible, count: r.caps.count}})), light: roomLight.intensity, groupVis: plungeGroup.visible});
  instances.push(api);
  return api;
}
