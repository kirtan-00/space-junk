/* SPACE JUNK: the ambient bed.
   A procedural space drone in the spirit of the lusion.co fall. No drums, no melody,
   no loop seam. Everything is synthesised from oscillators and noise at start().

   makeAudio() -> { start(), setState(s), mute(bool), muted, loadTrack(url), unloadTrack(), setTrackVolume(x) }
     start()          builds the graph. Call from a user gesture (autoplay policy). Idempotent.
     setState(s)      { v, ts, hold, shake, dark }, call every frame. Cheap: only params whose
                      target moved are re-scheduled, and everything glides via setTargetAtTime.
     mute(bool)       ramps the master to 0 / back over MUTE_RAMP_S. Covers the track too.
     muted            live boolean.
     loadTrack(url)   async. fetch + decode, then the track loops seamlessly (two alternating
                      sources, equal-power crossfade of TRACK_XF_S at the loop point). The synth
                      SUB, DRONE and PAD fade out under it; WASH drops to WASH_TRACK_SCALE, AIR stays.
                      Resolves to the track duration in seconds.
     unloadTrack()    fades the track out and brings the synth bed back.
     setTrackVolume(x) 0..1, on top of TRACK_GAIN.
     trackLoaded      live boolean.
     tvHover(bool)    END screen: quiet CRT static bed in / out over TV_HOVER_RAMP_S.
     tvPoke(strength) END screen: one-shot static burst + thunk + a short dropout of the program.
                      Both are UI sounds: post-compressor, never tape-slowed, under mute.
     levels()         { bass, mid, high, rms, beat } for the visuals, one reused object. Bands are
                      0..1 with a slow auto-gain (running 95th percentile over LEVELS_AGC_S), rms is
                      raw linear, beat is 1 on a bass onset frame and decays by exp(-dt * LEVELS_BEAT_DECAY).
                      Read from the analyser at most once per frame. All zeros before start().
     loadTrack(url | [urls]) an array tries each URL in order until one fetches and decodes, so
                      pass [opus, mp3]: Chrome decodes Opus in Ogg/WebM, Safari wants the mp3.
     The track sits ahead of the master gain, so mute() and the hidden-tab ramp cover it.

   buildGraph(ctx) is exported too so an OfflineAudioContext can render the same graph.
*/

/* ---------- constants ---------- */

// master
const MASTER_GAIN = 0.8;
const BUS_TRIM = 0.6;                  // pre-compressor trim, sets how hard the bed leans on the compressor
const COMP_OUT_TRIM = 0.5;             // post-compressor trim. Chrome's compressor applies makeup gain, so headroom is made here
const COMP_THRESHOLD_DB = -18;
const COMP_RATIO = 3;
const COMP_KNEE_DB = 6;
const COMP_ATTACK_S = 0.01;
const COMP_RELEASE_S = 0.25;
const MUTE_RAMP_S = 0.3;
const MUTE_TC = MUTE_RAMP_S / 3;       // setTargetAtTime reaches ~95% at 3 time constants
const HIDDEN_TC = MUTE_TC;

// the tape-slow follow (ts) and the general glide
const FOLLOW_TC = 0.35;
const TS_MIN = 0.55;
const TS_MAX = 4;
const V_MAX = 4;
const FILTER_TS_POW = 0.5;             // cutoffs slide by ts^0.5
const NOISE_TAPE_RATIO = 1.0;          // how much of the tape detune the noise buffers follow (1 = same as the oscillators)
const PARAM_EPS = 1e-4;                // skip re-scheduling if the target moved less than this
const ENV_FLOOR = 0.001;               // exponential ramps cannot reach 0
const LFO_DEPTH_HALF = 0.5;            // base + depth for the 0..1 tremolo and wobble shapes

// sub
const SUB_HZ = 41.2;                   // E1
const SUB_TRI_GAIN = 0.22;             // triangle an octave up, low
const SUB_LP_HZ = 140;
const SUB_GAIN = 0.5;

// drone
const DRONE_HZ = 82.4;                 // E2
const DRONE_DETUNE_CENTS = [-7, 5, 11];
const DRONE_LP_LO_HZ = 180;
const DRONE_LP_HI_HZ = 420;
const DRONE_LFO_PERIODS_S = [7.3, 11.9, 19.1];
const DRONE_LP_OPEN_HZ = 300;          // extra cutoff at full speed
const DRONE_LP_HOLD_HZ = 120;          // cutoff target while the mouse brakes
const DRONE_LP_Q = 0.9;
const DRONE_GAIN = 0.22;

// pad
const PAD_NOTES_HZ = [82.41, 123.47, 164.81, 207.65]; // E2 B2 E3 G#3
const PAD_VOICE_DETUNE_CENTS = [3, -4, 2, -3];
const PAD_SINE_GAIN = 0.6;
const PAD_BP_LO_HZ = 300;
const PAD_BP_HI_HZ = 1400;
const PAD_BP_Q = 0.7;
const PAD_BP_LFO_PERIOD_S = 13.7;
const PAD_SWELL_PERIODS_S = [4.1, 6.7];
const PAD_SWELL_BASE = 0.55;
const PAD_SWELL_DEPTHS = [0.2, 0.25];
const PAD_DOPPLER_CENTS = 40;
const PAD_DOPPLER_V_FULL = 1.2;        // speed at which the doppler rise is fully in
const PAD_GAIN = 0.14;

// wash
const WASH_BUFFER_S = 4;
const WASH_SEAM_S = 0.08;              // crossfade length at the loop point
const WASH_PINK_SCALE = 0.11;
const WASH_BP_LO_HZ = 800;
const WASH_BP_HI_HZ = 3000;
const WASH_BP_Q = 0.9;
const WASH_BP_LFO_PERIOD_S = 9.7;
const WASH_BP_REST_SWING_HZ = 350;     // the LFO swing around the rest centre
const WASH_GAIN_REST = 0.05;
const WASH_GAIN_FAST = 0.35;
const WASH_V_FULL = 1.0;               // speed at which the wash is fully up

// air
const AIR_BUFFER_S = 2;
const AIR_HP_HZ = 6000;
const AIR_GAIN = 0.012;

// shimmer (only above v 1.0)
const SHIMMER_HZ = 3200;
const SHIMMER_TREM_HZ = 0.3;
const SHIMMER_GAIN = 0.02;
const SHIMMER_V_START = 1.0;
const SHIMMER_V_FULL = 1.6;

// hold (mouse brake)
const HOLD_RAMP_S = 0.6;
const HOLD_TC = HOLD_RAMP_S / 3;
const HOLD_DIP_DB = -3;

// shake one-shot
const SHAKE_EDGE = 0.4;
const SHAKE_REFRACTORY_S = 0.3;
const SHAKE_NOISE_MS = 120;
const SHAKE_NOISE_LP_HZ = 900;
const SHAKE_NOISE_GAIN = 1.0;          // into the compressed bus, so this is pre-trim
const SHAKE_THUMP_FROM_HZ = 90;
const SHAKE_THUMP_TO_HZ = 35;
const SHAKE_THUMP_MS = 250;
const SHAKE_THUMP_GAIN = 0.28;         // joins after the compressor like the sub, so this is absolute
const SHAKE_ATTACK_S = 0.004;
const SHAKE_TAIL_S = 0.05;             // node stop margin after the envelope ends
const SHAKE_NOISE_OFFSET_MARGIN_S = 0.5; // keep the burst start inside the noise buffer

// dark hum
const HUM_HZ = 50;
const HUM_WOBBLE_HZ = 4;
const HUM_GAIN = 0.03;
const HUM_RAMP_S = 0.4;
const HUM_TC = HUM_RAMP_S / 3;

// track mode (the owner's music file under the synth texture)
const TRACK_GAIN = 0.85;
const TRACK_REVERB_WET = 0.12;
const TRACK_LP_OPEN_HZ = 18000;
const TRACK_LP_SLOW_HZ = 2200;         // lowpass at full tape-slow (ts = TS_MIN)
const TRACK_LP_HOLD_HZ = 900;          // lowpass while the mouse brakes
const TRACK_LP_Q = 0.7;
const TRACK_XF_S = 1.5;                // loop crossfade, in track seconds
const TRACK_XF_STEPS = 64;             // points in the equal-power curves
const TRACK_FADE_S = 2;                // track fade in on load, out on unload
const TRACK_BED_FADE_S = 2;            // SUB, DRONE, PAD fade under the track
const TRACK_BED_FADE_TC = TRACK_BED_FADE_S / 3;
const TRACK_VOL_TC = MUTE_TC;
const TRACK_TICK_MS = 100;             // safety scheduler cadence in the live wrapper
const TRACK_STOP_MARGIN_S = 0.05;
const WASH_TRACK_SCALE = 0.4;

// END screen TV (hover static, poke)
const TV_STATIC_BP_HZ = 1400;
const TV_STATIC_BP_Q = 0.8;
const TV_WHINE_HZ = 15600;             // CRT line whine
const TV_WHINE_GAIN = 0.004;
const TV_HOVER_GAIN = 0.035;
const TV_HOVER_RAMP_S = 0.25;
const TV_HOVER_TC = TV_HOVER_RAMP_S / 3;
const TV_POKE_STATIC_MS = 90;
const TV_POKE_STATIC_GAIN = 0.3;      // coordinator spec was 0.12: too far under the bed to register, see the report
const TV_POKE_THUNK_FROM_HZ = 180;
const TV_POKE_THUNK_TO_HZ = 60;
const TV_POKE_THUNK_MS = 140;
const TV_POKE_THUNK_GAIN = 0.5;       // coordinator spec was 0.18: same
const TV_POKE_ATTACK_S = 0.003;
const TV_POKE_DIP_LEVEL = 0.4;
const TV_POKE_DIP_HOLD_S = 0.03;
const TV_POKE_DIP_RECOVER_S = 0.12;
const TV_POKE_REFRACTORY_S = 0.2;

// levels for the visuals
const LEVELS_FFT_SIZE = 1024;
const LEVELS_SMOOTHING = 0.6;
const LEVELS_BASS_HZ = [40, 160];
const LEVELS_MID_HZ = [300, 2000];
const LEVELS_HIGH_HZ = [3000, 10000];
const LEVELS_AGC_S = 4;                // window for the running 95th percentile
const LEVELS_AGC_SLOTS = 64;           // samples in that window (one every LEVELS_AGC_S / 64 s)
const LEVELS_AGC_PERCENTILE = 0.95;
const LEVELS_AGC_FLOOR = 0.002;        // linear magnitude; never normalise against less than this (silence stays quiet)
const LEVELS_DB_TO_LIN = Math.LN10 / 20;
const LEVELS_BEAT_RATIO = 1.4;         // bass must exceed this times its 1 s moving average
const LEVELS_BEAT_AVG_S = 1;
const LEVELS_BEAT_MIN_GAP_S = 0.18;
const LEVELS_BEAT_REARM_RATIO = 1.0;   // after a beat, bass must dip below this times its average before the next
const LEVELS_BEAT_DECAY = 9;           // per second, exp(-dt * 9)
const LEVELS_MIN_INTERVAL_MS = 4;      // guard: one analyser read per frame

// reverb
const REVERB_S = 4;
const REVERB_DECAY = [5.2, 5.6];       // exponential decay rate per channel
const REVERB_IR_SMOOTH = 0.10;         // one-pole coefficient on the impulse noise, lower = darker tail
const REVERB_IR_FADE_IN_SAMPLES = 200;
const REVERB_LP_HZ = 3500;             // lowpass on the wet return, keeps the tail below the air layer
const REVERB_WET = 0.35;

/* ---------- helpers ---------- */

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const dbToGain = (db) => Math.pow(10, db / 20);
const tapeCents = (ts) => 1200 * Math.log2(ts);

function pinkNoiseBuffer(ctx, seconds) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // Paul Kellet's refined pink filter
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * WASH_PINK_SCALE;
    b6 = w * 0.115926;
  }
  // crossfade the tail into the head so the loop point is silent
  const seam = Math.floor(ctx.sampleRate * WASH_SEAM_S);
  for (let i = 0; i < seam; i++) {
    const w = i / seam;
    const t = n - seam + i;
    d[t] = d[t] * (1 - w) + d[i] * w;
  }
  return buf;
}

function whiteNoiseBuffer(ctx, seconds) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function impulseBuffer(ctx, seconds) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    const k = REVERB_DECAY[c];
    // a two-pole lowpass smooths the noise so the tail is dark, like a big empty room
    let y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const w = Math.random() * 2 - 1;
      y1 += REVERB_IR_SMOOTH * (w - y1);
      y2 += REVERB_IR_SMOOTH * (y1 - y2);
      d[i] = y2 * Math.exp(-k * t) * (1 - Math.exp(-i / REVERB_IR_FADE_IN_SAMPLES));
    }
  }
  return buf;
}

// a param driven by a base (ConstantSource) plus any number of LFOs through depth gains
function modulated(ctx, param, base) {
  param.value = 0;
  const c = ctx.createConstantSource();
  c.offset.value = base;
  c.connect(param);
  c.start();
  const lfos = [];
  return {
    base: c.offset,
    lfos,
    addLFO(periodS, depth, type = 'sine') {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 1 / periodS;
      const g = ctx.createGain();
      g.gain.value = depth;
      o.connect(g).connect(param);
      o.start();
      lfos.push({ osc: o, depth: g, rate: 1 / periodS, amount: depth });
      return o;
    },
  };
}

/* ---------- the graph ---------- */

export function buildGraph(ctx) {
  const now = () => ctx.currentTime;

  // ----- master chain: mix -> compressor -> compOut -> duck (hold) -> tvDip (poke) -> master (mute / hidden) -> out
  //       the sub joins at duck, see below
  const mix = ctx.createGain();
  mix.gain.value = BUS_TRIM;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = COMP_THRESHOLD_DB;
  comp.ratio.value = COMP_RATIO;
  comp.knee.value = COMP_KNEE_DB;
  comp.attack.value = COMP_ATTACK_S;
  comp.release.value = COMP_RELEASE_S;
  const compOut = ctx.createGain();
  compOut.gain.value = COMP_OUT_TRIM;
  const duck = ctx.createGain();
  const analyser = ctx.createAnalyser();   // levels() tap: bed + track + sub, before the TV sounds join
  analyser.fftSize = LEVELS_FFT_SIZE;
  analyser.smoothingTimeConstant = LEVELS_SMOOTHING;
  const tvDip = ctx.createGain();      // the poke dropout: dips the program, not the poke itself
  const master = ctx.createGain();
  master.gain.value = MASTER_GAIN;
  mix.connect(comp).connect(compOut).connect(duck).connect(tvDip).connect(master);
  duck.connect(analyser);

  // ----- reverb send (everything except the sub)
  const send = ctx.createGain();
  send.gain.value = REVERB_WET;
  const verb = ctx.createConvolver();
  verb.buffer = impulseBuffer(ctx, REVERB_S);
  const verbLP = ctx.createBiquadFilter();
  verbLP.type = 'lowpass';
  verbLP.frequency.value = REVERB_LP_HZ;
  send.connect(verb).connect(verbLP).connect(mix);
  const wetBus = ctx.createGain();     // stems land here: dry to mix, and to the send
  wetBus.connect(mix);
  wetBus.connect(send);

  const oscillators = [];              // every pitched oscillator: { osc, base } for the tape-slow
  const lfoList = [];                  // every LFO: { osc, rate } for the ts rate scaling
  const addOsc = (type, hz, cents = 0) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = hz;
    o.detune.value = cents;
    o.start();
    oscillators.push({ osc: o, base: cents });
    return o;
  };
  const trackMod = (m) => { for (const l of m.lfos) lfoList.push({ osc: l.osc, rate: l.rate }); };

  // ----- SUB
  const subLP = ctx.createBiquadFilter();
  subLP.type = 'lowpass';
  subLP.frequency.value = SUB_LP_HZ;
  const subGain = ctx.createGain();
  subGain.gain.value = SUB_GAIN;
  addOsc('sine', SUB_HZ).connect(subLP);
  const subTri = ctx.createGain();
  subTri.gain.value = SUB_TRI_GAIN;
  addOsc('triangle', SUB_HZ * 2).connect(subTri).connect(subLP);
  // the sub joins after the compressor: a fixed sine needs no compression, and when the tape-slow
  // drags it to 4 Hz it would otherwise sidechain the whole bed into a 4 Hz pump
  subLP.connect(subGain).connect(duck);

  // ----- DRONE
  const droneLP = ctx.createBiquadFilter();
  droneLP.type = 'lowpass';
  droneLP.Q.value = DRONE_LP_Q;
  const droneMid = (DRONE_LP_LO_HZ + DRONE_LP_HI_HZ) / 2;
  const droneSwing = (DRONE_LP_HI_HZ - DRONE_LP_LO_HZ) / 2;
  const droneMod = modulated(ctx, droneLP.frequency, droneMid);
  for (const p of DRONE_LFO_PERIODS_S) droneMod.addLFO(p, droneSwing / DRONE_LFO_PERIODS_S.length);
  trackMod(droneMod);
  const droneGain = ctx.createGain();
  droneGain.gain.value = DRONE_GAIN;
  for (const c of DRONE_DETUNE_CENTS) addOsc('sawtooth', DRONE_HZ, c).connect(droneLP);
  droneLP.connect(droneGain).connect(wetBus);

  // ----- PAD
  const padBP = ctx.createBiquadFilter();
  padBP.type = 'bandpass';
  padBP.Q.value = PAD_BP_Q;
  const padMod = modulated(ctx, padBP.frequency, (PAD_BP_LO_HZ + PAD_BP_HI_HZ) / 2);
  padMod.addLFO(PAD_BP_LFO_PERIOD_S, (PAD_BP_HI_HZ - PAD_BP_LO_HZ) / 2);
  trackMod(padMod);
  const padSwell = ctx.createGain();
  const swellMod = modulated(ctx, padSwell.gain, PAD_SWELL_BASE);
  PAD_SWELL_PERIODS_S.forEach((p, i) => swellMod.addLFO(p, PAD_SWELL_DEPTHS[i]));
  trackMod(swellMod);
  const padGain = ctx.createGain();
  padGain.gain.value = PAD_GAIN;
  const padOscs = [];
  PAD_NOTES_HZ.forEach((hz, i) => {
    const tri = addOsc('triangle', hz, PAD_VOICE_DETUNE_CENTS[i]);
    tri.connect(padBP);
    const sine = addOsc('sine', hz, 0);
    const sg = ctx.createGain();
    sg.gain.value = PAD_SINE_GAIN;
    sine.connect(sg).connect(padBP);
    padOscs.push(tri, sine);
  });
  const padSet = new Set(padOscs);
  padBP.connect(padSwell).connect(padGain).connect(wetBus);

  // ----- WASH
  const washSrc = ctx.createBufferSource();
  washSrc.buffer = pinkNoiseBuffer(ctx, WASH_BUFFER_S);
  washSrc.loop = true;
  washSrc.start();
  const washBP = ctx.createBiquadFilter();
  washBP.type = 'bandpass';
  washBP.Q.value = WASH_BP_Q;
  const washRest = WASH_BP_LO_HZ + WASH_BP_REST_SWING_HZ;
  const washMod = modulated(ctx, washBP.frequency, washRest);
  washMod.addLFO(WASH_BP_LFO_PERIOD_S, WASH_BP_REST_SWING_HZ);
  trackMod(washMod);
  const washGain = ctx.createGain();
  washGain.gain.value = WASH_GAIN_REST;
  const washTrim = ctx.createGain();   // drops to WASH_TRACK_SCALE under a track
  washSrc.connect(washBP).connect(washGain).connect(washTrim).connect(wetBus);

  // ----- AIR
  const noiseBuf = whiteNoiseBuffer(ctx, AIR_BUFFER_S);
  const airSrc = ctx.createBufferSource();
  airSrc.buffer = noiseBuf;
  airSrc.loop = true;
  airSrc.start();
  const airHP = ctx.createBiquadFilter();
  airHP.type = 'highpass';
  airHP.frequency.value = AIR_HP_HZ;
  const airGain = ctx.createGain();
  airGain.gain.value = AIR_GAIN;
  airSrc.connect(airHP).connect(airGain).connect(wetBus);

  // ----- SHIMMER (v above 1.0)
  const shimTrem = ctx.createGain();
  const shimMod = modulated(ctx, shimTrem.gain, LFO_DEPTH_HALF);
  shimMod.addLFO(1 / SHIMMER_TREM_HZ, LFO_DEPTH_HALF);
  trackMod(shimMod);
  const shimGain = ctx.createGain();
  shimGain.gain.value = 0;
  addOsc('sine', SHIMMER_HZ).connect(shimTrem).connect(shimGain).connect(wetBus);

  // ----- HUM (dark)
  const humWobble = ctx.createGain();
  const humMod = modulated(ctx, humWobble.gain, LFO_DEPTH_HALF);
  humMod.addLFO(1 / HUM_WOBBLE_HZ, LFO_DEPTH_HALF);
  trackMod(humMod);
  const humGain = ctx.createGain();
  humGain.gain.value = 0;
  addOsc('sine', HUM_HZ).connect(humWobble).connect(humGain).connect(mix);

  // ----- SHAKE one-shot
  let lastShakeAt = -Infinity;
  function fireShake(peak) {
    const t = now();
    const amt = clamp(peak, 0, 1);
    // noise burst
    const ns = ctx.createBufferSource();
    ns.buffer = noiseBuf;
    const nlp = ctx.createBiquadFilter();
    nlp.type = 'lowpass';
    nlp.frequency.value = SHAKE_NOISE_LP_HZ;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(SHAKE_NOISE_GAIN * amt, t + SHAKE_ATTACK_S);
    ng.gain.exponentialRampToValueAtTime(ENV_FLOOR, t + SHAKE_NOISE_MS / 1000);
    ns.connect(nlp).connect(ng).connect(wetBus);
    ns.start(t, Math.random() * (AIR_BUFFER_S - SHAKE_NOISE_OFFSET_MARGIN_S));
    ns.stop(t + SHAKE_NOISE_MS / 1000 + SHAKE_TAIL_S);
    // thump
    const th = ctx.createOscillator();
    th.type = 'sine';
    th.frequency.setValueAtTime(SHAKE_THUMP_FROM_HZ, t);
    th.frequency.exponentialRampToValueAtTime(SHAKE_THUMP_TO_HZ, t + SHAKE_THUMP_MS / 1000);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0, t);
    tg.gain.linearRampToValueAtTime(SHAKE_THUMP_GAIN * amt, t + SHAKE_ATTACK_S);
    tg.gain.exponentialRampToValueAtTime(ENV_FLOOR, t + SHAKE_THUMP_MS / 1000);
    th.connect(tg).connect(duck);       // post-compressor, a low sine would pump the bed otherwise
    th.start(t);
    th.stop(t + SHAKE_THUMP_MS / 1000 + SHAKE_TAIL_S);
  }

  // ----- TRACK: alternating buffer sources -> trackBus -> lowpass -> volume -> TRACK_GAIN -> mix (+ its own reverb send)
  const trackBus = ctx.createGain();
  const trackLP = ctx.createBiquadFilter();
  trackLP.type = 'lowpass';
  trackLP.frequency.value = TRACK_LP_OPEN_HZ;
  trackLP.Q.value = TRACK_LP_Q;
  const trackVol = ctx.createGain();
  const trackOut = ctx.createGain();
  trackOut.gain.value = TRACK_GAIN;
  const trackSend = ctx.createGain();
  trackSend.gain.value = TRACK_REVERB_WET;
  trackBus.connect(trackLP).connect(trackVol).connect(trackOut);
  trackOut.connect(mix);
  trackOut.connect(trackSend).connect(verb);

  const last = new Map();              // param key -> last scheduled target, for dedupe
  const xfIn = new Float32Array(TRACK_XF_STEPS);
  const xfOut = new Float32Array(TRACK_XF_STEPS);
  for (let i = 0; i < TRACK_XF_STEPS; i++) {
    const w = i / (TRACK_XF_STEPS - 1);
    xfIn[i] = Math.sin(w * Math.PI / 2);
    xfOut[i] = Math.cos(w * Math.PI / 2);
  }

  let track = null;                    // { buffer, dur, xf }
  let active = [];                     // { src, env, id } sources currently sounding
  let srcSeq = 0;
  let pos = 0;                         // estimated position of the newest source, in track seconds
  let rateEst = 1, rateTarget = 1;     // rateEst mirrors the one-pole the AudioParam is following
  let lastTick = now();

  function curve(param, shape, scale, t, dur) {
    const c = new Float32Array(TRACK_XF_STEPS);
    for (let i = 0; i < TRACK_XF_STEPS; i++) c[i] = shape[i] * scale;
    try {
      param.setValueCurveAtTime(c, t, dur);
    } catch (e) {
      // a curve was still running on this param (very short buffer, or unload mid fade-in)
      console.warn('audio: crossfade curve rejected, linear fallback', e && e.message);
      param.linearRampToValueAtTime(c[TRACK_XF_STEPS - 1], t + dur);
    }
  }

  function startSource(fadeS) {
    const t = now();
    const src = ctx.createBufferSource();
    src.buffer = track.buffer;
    src.playbackRate.value = rateEst;
    src.playbackRate.setTargetAtTime(rateTarget, t, FOLLOW_TC);
    const env = ctx.createGain();
    env.gain.value = 0;
    curve(env.gain, xfIn, 1, t, fadeS);
    src.connect(env).connect(trackBus);
    const entry = { src, env, id: srcSeq++ };
    active.push(entry);
    src.onended = () => {
      active = active.filter((a) => a !== entry);
      last.delete('trk' + entry.id);
      env.disconnect();
    };
    src.start(t);
    pos = 0;
  }

  function fadeOutSource(entry, fadeS) {
    const t = now();
    const g = entry.env.gain;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else g.cancelScheduledValues(t);
    curve(g, xfOut, g.value, t, fadeS);
    entry.src.stop(t + fadeS + TRACK_STOP_MARGIN_S);
  }

  function bed(on) {
    const tc = TRACK_BED_FADE_TC;
    target(subGain.gain, 'subGain', on ? SUB_GAIN : 0, tc);
    target(droneGain.gain, 'droneGain', on ? DRONE_GAIN : 0, tc);
    target(padGain.gain, 'padGain', on ? PAD_GAIN : 0, tc);
    target(washTrim.gain, 'washTrim', on ? 1 : WASH_TRACK_SCALE, tc);
  }

  function setTrack(buffer) {
    for (const a of active) fadeOutSource(a, TRACK_FADE_S);
    active = [];
    if (!buffer) { track = null; bed(true); return; }
    track = { buffer, dur: buffer.duration, xf: Math.min(TRACK_XF_S, buffer.duration / 3) };
    bed(false);
    startSource(TRACK_FADE_S);
  }

  // the loop scheduler. Runs from setState (every frame live, every step offline) and from the
  // live wrapper's safety interval. Integrates the estimated playback rate to know where the
  // newest source is, and hands over to a fresh one TRACK_XF_S before the end.
  function tick() {
    const t = now();
    const dt = Math.max(0, t - lastTick);
    lastTick = t;
    rateEst += (rateTarget - rateEst) * (1 - Math.exp(-dt / FOLLOW_TC));   // keeps tracking with no track, so a load under Space starts slow
    if (!track) return;
    pos += rateEst * dt;
    if (pos >= track.dur - track.xf) {
      const fadeS = track.xf / Math.max(rateEst, TS_MIN);   // the fade spans the tail in wall time
      const cur = active[active.length - 1];
      if (cur) fadeOutSource(cur, fadeS);
      startSource(fadeS);
    }
  }

  function setTrackVolume(x) {
    target(trackVol.gain, 'trackVol', clamp(x == null ? 1 : x, 0, 1), TRACK_VOL_TC);
  }

  // ----- TV (END screen): static bed on hover, one-shot on poke. UI sounds: post-compressor, post-dip, pre-master
  const tvBP = ctx.createBiquadFilter();
  tvBP.type = 'bandpass';
  tvBP.frequency.value = TV_STATIC_BP_HZ;
  tvBP.Q.value = TV_STATIC_BP_Q;
  const tvStaticSrc = ctx.createBufferSource();
  tvStaticSrc.buffer = noiseBuf;
  tvStaticSrc.loop = true;
  tvStaticSrc.start();
  const tvWhine = ctx.createOscillator();  // deliberately not in `oscillators`: the CRT does not tape-slow
  tvWhine.type = 'sine';
  tvWhine.frequency.value = TV_WHINE_HZ;
  tvWhine.start();
  const tvWhineGain = ctx.createGain();
  tvWhineGain.gain.value = TV_WHINE_GAIN / TV_HOVER_GAIN;   // relative to the static, scaled by the hover envelope
  const tvHoverGain = ctx.createGain();
  tvHoverGain.gain.value = 0;
  tvStaticSrc.connect(tvBP).connect(tvHoverGain);
  tvWhine.connect(tvWhineGain).connect(tvHoverGain);
  tvHoverGain.connect(master);

  let lastPokeAt = -Infinity;

  function tvHover(on) {
    target(tvHoverGain.gain, 'tvHover', on ? TV_HOVER_GAIN : 0, TV_HOVER_TC);
  }

  function tvPoke(strength) {
    const t = now();
    if (t - lastPokeAt < TV_POKE_REFRACTORY_S) return;
    lastPokeAt = t;
    const amt = clamp(strength == null ? 1 : strength, 0, 1);
    // static burst
    const ns = ctx.createBufferSource();
    ns.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = TV_STATIC_BP_HZ;
    bp.Q.value = TV_STATIC_BP_Q;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(TV_POKE_STATIC_GAIN * amt, t + TV_POKE_ATTACK_S);
    ng.gain.exponentialRampToValueAtTime(ENV_FLOOR, t + TV_POKE_STATIC_MS / 1000);
    ns.connect(bp).connect(ng).connect(master);
    ns.start(t, Math.random() * (AIR_BUFFER_S - SHAKE_NOISE_OFFSET_MARGIN_S));
    ns.stop(t + TV_POKE_STATIC_MS / 1000 + SHAKE_TAIL_S);
    // thunk
    const th = ctx.createOscillator();
    th.type = 'triangle';
    th.frequency.setValueAtTime(TV_POKE_THUNK_FROM_HZ, t);
    th.frequency.exponentialRampToValueAtTime(TV_POKE_THUNK_TO_HZ, t + TV_POKE_THUNK_MS / 1000);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0, t);
    tg.gain.linearRampToValueAtTime(TV_POKE_THUNK_GAIN * amt, t + TV_POKE_ATTACK_S);
    tg.gain.exponentialRampToValueAtTime(ENV_FLOOR, t + TV_POKE_THUNK_MS / 1000);
    th.connect(tg).connect(master);
    th.start(t);
    th.stop(t + TV_POKE_THUNK_MS / 1000 + SHAKE_TAIL_S);
    // the picture drops out: dip the program, hold, recover
    const g = tvDip.gain;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(TV_POKE_DIP_LEVEL, t + TV_POKE_ATTACK_S);
    g.setValueAtTime(TV_POKE_DIP_LEVEL, t + TV_POKE_DIP_HOLD_S);
    g.linearRampToValueAtTime(1, t + TV_POKE_DIP_HOLD_S + TV_POKE_DIP_RECOVER_S);
  }

  // ----- LEVELS for the visuals
  const freqData = new Float32Array(analyser.frequencyBinCount);   // dB per bin, turned linear in bandMean
  const timeData = new Float32Array(analyser.fftSize);
  const binHz = ctx.sampleRate / analyser.fftSize;
  const binRange = (hz) => [Math.max(1, Math.floor(hz[0] / binHz)), Math.min(analyser.frequencyBinCount - 1, Math.ceil(hz[1] / binHz))];
  const bands = [
    { key: 'bass', bins: binRange(LEVELS_BASS_HZ) },
    { key: 'mid', bins: binRange(LEVELS_MID_HZ) },
    { key: 'high', bins: binRange(LEVELS_HIGH_HZ) },
  ];
  const ring = bands.map(() => new Float32Array(LEVELS_AGC_SLOTS));
  const sorted = new Float32Array(LEVELS_AGC_SLOTS);
  const agc = [LEVELS_AGC_FLOOR, LEVELS_AGC_FLOOR, LEVELS_AGC_FLOOR];
  let ringPos = 0, ringFilled = 0, lastRingAt = -Infinity;
  const levelsOut = { bass: 0, mid: 0, high: 0, rms: 0, beat: 0 };
  let lastLevelsAt = -Infinity, bassAvg = 0, lastBeatAt = -Infinity, beatArmed = true;

  function bandMean(bins) {
    let sum = 0;
    for (let k = bins[0]; k <= bins[1]; k++) sum += Math.exp(freqData[k] * LEVELS_DB_TO_LIN);   // 10^(dB/20)
    return sum / (bins[1] - bins[0] + 1);
  }

  function levels() {
    const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const dt = (nowMs - lastLevelsAt) / 1000;
    if (dt * 1000 < LEVELS_MIN_INTERVAL_MS) return levelsOut;
    lastLevelsAt = nowMs;
    analyser.getFloatFrequencyData(freqData);
    analyser.getFloatTimeDomainData(timeData);
    const raw = bands.map((b) => bandMean(b.bins));
    // slow auto-gain: one ring slot every LEVELS_AGC_S / LEVELS_AGC_SLOTS seconds, 95th percentile of the window
    if (nowMs - lastRingAt >= (LEVELS_AGC_S / LEVELS_AGC_SLOTS) * 1000) {
      lastRingAt = nowMs;
      for (let i = 0; i < bands.length; i++) ring[i][ringPos] = raw[i];
      ringPos = (ringPos + 1) % LEVELS_AGC_SLOTS;
      ringFilled = Math.min(LEVELS_AGC_SLOTS, ringFilled + 1);
      for (let i = 0; i < bands.length; i++) {
        sorted.set(ring[i].subarray(0, ringFilled));
        const view = sorted.subarray(0, ringFilled);
        view.sort();
        agc[i] = Math.max(LEVELS_AGC_FLOOR, view[Math.min(ringFilled - 1, Math.floor(LEVELS_AGC_PERCENTILE * ringFilled))]);
      }
    }
    const bassNorm = raw[0] / agc[0];    // unclamped, the onset test needs the overshoot
    levelsOut.bass = clamp(bassNorm, 0, 1);
    levelsOut.mid = clamp(raw[1] / agc[1], 0, 1);
    levelsOut.high = clamp(raw[2] / agc[2], 0, 1);
    let sq = 0;
    for (let i = 0; i < timeData.length; i++) sq += timeData[i] * timeData[i];
    levelsOut.rms = clamp(Math.sqrt(sq / timeData.length), 0, 1);
    // beat: bass onset against its 1 s moving average, with a minimum gap
    const safeDt = Math.min(dt, 0.25);
    const a = 1 - Math.exp(-safeDt / LEVELS_BEAT_AVG_S);
    if (!beatArmed && bassNorm < LEVELS_BEAT_REARM_RATIO * bassAvg) beatArmed = true;
    const onset = beatArmed && bassAvg > 0 && bassNorm > LEVELS_BEAT_RATIO * bassAvg && (nowMs - lastBeatAt) / 1000 >= LEVELS_BEAT_MIN_GAP_S;
    bassAvg += (bassNorm - bassAvg) * a;
    if (onset) { lastBeatAt = nowMs; levelsOut.beat = 1; beatArmed = false; }
    else levelsOut.beat *= Math.exp(-safeDt * LEVELS_BEAT_DECAY);
    return levelsOut;
  }

  // ----- per-frame state -> targets, deduped
  function target(param, key, value, tc) {
    const prev = last.get(key);
    if (prev !== undefined && Math.abs(prev - value) < PARAM_EPS) return;
    last.set(key, value);
    param.setTargetAtTime(value, now(), tc);
  }

  let prevShake = 0;
  let masterMuted = false, masterHidden = false;

  function applyMaster(tc) {
    target(master.gain, 'master', (masterMuted || masterHidden) ? 0 : MASTER_GAIN, tc);
  }

  function setState(s) {
    const v = clamp(s.v || 0, 0, V_MAX);
    const ts = clamp(s.ts == null ? 1 : s.ts, TS_MIN, TS_MAX);
    const hold = !!s.hold;
    const dark = !!s.dark;
    const shake = clamp(s.shake || 0, 0, V_MAX);
    const cents = tapeCents(ts);
    const fts = Math.pow(ts, FILTER_TS_POW);

    // tape-slow: every oscillator, every LFO rate, every cutoff
    const doppler = PAD_DOPPLER_CENTS * clamp(v / PAD_DOPPLER_V_FULL, 0, 1);
    oscillators.forEach((o, i) => {
      const extra = padSet.has(o.osc) ? doppler : 0;
      target(o.osc.detune, 'osc' + i, o.base + cents + extra, FOLLOW_TC);
    });
    lfoList.forEach((l, i) => target(l.osc.frequency, 'lfo' + i, l.rate * ts, FOLLOW_TC));
    target(washSrc.detune, 'washTape', cents * NOISE_TAPE_RATIO, FOLLOW_TC);
    target(airSrc.detune, 'airTape', cents * NOISE_TAPE_RATIO, FOLLOW_TC);
    target(subLP.frequency, 'subLP', SUB_LP_HZ * fts, FOLLOW_TC);

    // drone lowpass: base + swing, opened by v, closed by hold
    const open = DRONE_LP_OPEN_HZ * clamp(v, 0, 1);
    const droneBase = hold ? DRONE_LP_HOLD_HZ : (droneMid + open);
    target(droneMod.base, 'droneBase', droneBase * fts, hold ? HOLD_TC : FOLLOW_TC);
    const swingScale = hold ? 0 : fts;
    droneMod.lfos.forEach((l, i) => target(l.depth.gain, 'droneSwing' + i, l.amount * swingScale, hold ? HOLD_TC : FOLLOW_TC));

    // pad bandpass centre follows the tape
    target(padMod.base, 'padBase', ((PAD_BP_LO_HZ + PAD_BP_HI_HZ) / 2) * fts, FOLLOW_TC);
    target(padMod.lfos[0].depth.gain, 'padSwing', ((PAD_BP_HI_HZ - PAD_BP_LO_HZ) / 2) * fts, FOLLOW_TC);

    // wash: louder and brighter with speed
    const vw = clamp(v / WASH_V_FULL, 0, 1);
    target(washGain.gain, 'washGain', WASH_GAIN_REST + (WASH_GAIN_FAST - WASH_GAIN_REST) * vw, FOLLOW_TC);
    const washCentre = washRest + (WASH_BP_HI_HZ - WASH_BP_REST_SWING_HZ - washRest) * clamp(v / SHIMMER_V_FULL, 0, 1);
    target(washMod.base, 'washBase', washCentre * fts, FOLLOW_TC);
    target(washMod.lfos[0].depth.gain, 'washSwing', WASH_BP_REST_SWING_HZ * fts, FOLLOW_TC);

    // shimmer above v 1.0
    const sh = clamp((v - SHIMMER_V_START) / (SHIMMER_V_FULL - SHIMMER_V_START), 0, 1);
    target(shimGain.gain, 'shimmer', SHIMMER_GAIN * sh, FOLLOW_TC);

    // hold dips the master 3 dB
    target(duck.gain, 'duck', hold ? dbToGain(HOLD_DIP_DB) : 1, HOLD_TC);

    // dark hum
    target(humGain.gain, 'hum', dark ? HUM_GAIN : 0, HUM_TC);

    // track: playbackRate is the tape, the lowpass closes with the slow and pinches on hold, v adds nothing
    rateTarget = ts;
    for (const a of active) target(a.src.playbackRate, 'trk' + a.id, ts, FOLLOW_TC);
    const slowU = clamp((1 - ts) / (1 - TS_MIN), 0, 1);
    let trackCut = TRACK_LP_OPEN_HZ * Math.pow(TRACK_LP_SLOW_HZ / TRACK_LP_OPEN_HZ, slowU);
    if (hold) trackCut = Math.min(trackCut, TRACK_LP_HOLD_HZ);
    target(trackLP.frequency, 'trackLP', trackCut, hold ? HOLD_TC : FOLLOW_TC);
    tick();

    // shake: rising edge above the threshold, refractory
    if (shake >= SHAKE_EDGE && prevShake < SHAKE_EDGE && now() - lastShakeAt >= SHAKE_REFRACTORY_S) {
      lastShakeAt = now();
      fireShake(shake);
    }
    prevShake = shake;
  }

  return {
    out: master,
    setState,
    setMuted(b) { masterMuted = !!b; applyMaster(MUTE_TC); },
    setHidden(b) { masterHidden = !!b; applyMaster(HIDDEN_TC); },
    fireShake,
    setTrack,
    setTrackVolume,
    tick,
    tvHover,
    tvPoke,
    levels,
    get trackLoaded() { return !!track; },
  };
}

/* ---------- the live wrapper ---------- */

export function makeAudio() {
  let ctx = null;
  let graph = null;
  let muted = false;
  let pending = null;
  let trackTimer = 0;

  // the context and graph can exist before the gesture (suspended); start() is what resumes them
  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    graph = buildGraph(ctx);
    graph.out.connect(ctx.destination);
    graph.setMuted(muted);
    graph.setHidden(document.hidden);
    document.addEventListener('visibilitychange', () => {
      if (graph) graph.setHidden(document.hidden);
    });
    if (pending) { graph.setState(pending); pending = null; }
    return true;
  }

  function start() {
    if (!ensure()) return;
    if (ctx.state !== 'running') ctx.resume();
  }

  function setState(s) {
    if (!graph) { pending = s; return; }
    graph.setState(s);
  }

  function mute(b) {
    muted = !!b;
    if (graph) graph.setMuted(muted);
  }

  async function loadTrack(urls) {
    if (!ensure()) throw new Error('Web Audio unavailable');
    const list = Array.isArray(urls) ? urls : [urls];
    let buffer = null;
    const failures = [];
    for (const url of list) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        buffer = await ctx.decodeAudioData(await res.arrayBuffer());
        break;
      } catch (e) {
        failures.push(url + ': ' + (e && e.message ? e.message : e));
      }
    }
    if (!buffer) throw new Error('no track could be loaded. ' + failures.join(' | '));
    graph.setTrack(buffer);
    clearInterval(trackTimer);
    trackTimer = setInterval(() => graph.tick(), TRACK_TICK_MS);
    return buffer.duration;
  }

  function unloadTrack() {
    clearInterval(trackTimer);
    trackTimer = 0;
    if (graph) graph.setTrack(null);
  }

  function setTrackVolume(x) {
    if (graph) graph.setTrackVolume(x);
  }

  function tvHover(on) {
    if (graph) graph.tvHover(!!on);
  }

  function tvPoke(strength) {
    if (graph) graph.tvPoke(strength);
  }

  const zeroLevels = { bass: 0, mid: 0, high: 0, rms: 0, beat: 0 };
  function levels() {
    return graph ? graph.levels() : zeroLevels;
  }

  return {
    start,
    setState,
    mute,
    loadTrack,
    unloadTrack,
    setTrackVolume,
    tvHover,
    tvPoke,
    levels,
    get muted() { return muted; },
    get trackLoaded() { return !!(graph && graph.trackLoaded); },
    get context() { return ctx; },
  };
}
