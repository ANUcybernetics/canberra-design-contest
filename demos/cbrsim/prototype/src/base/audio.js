// Ambient sound, synthesised with Web Audio (no sound files): lapping water near the
// lake, wind that grows with height, birds in the trees, footsteps that change with
// the surface underfoot. Starts on the first click (browser autoplay rules).

export function createAudio() {
  let ctx = null, master, water, wind, muted = false;
  let stepT = 0, birdT = 2;

  function noiseSource(seconds = 2) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate), d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 6; }   // soft brown-ish noise
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.start();
    return src;
  }
  function bed(freq, q) {
    const src = noiseSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q; g.gain.value = 0;
    src.connect(f).connect(g).connect(master);
    return { gain: g, filter: f };
  }

  function start() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(ctx.destination);
    water = bed(420, 0.6);
    wind = bed(260, 0.4);
  }

  function chirp() {
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner();
    const base = 2200 + Math.random() * 2200, notes = 2 + Math.floor(Math.random() * 4);
    o.type = 'sine'; p.pan.value = Math.random() * 2 - 1;
    g.gain.setValueAtTime(0, t);
    for (let k = 0; k < notes; k++) {
      const t0 = t + k * 0.13;
      o.frequency.setValueAtTime(base * (1 + 0.25 * Math.sin(k * 2.1)), t0);
      o.frequency.exponentialRampToValueAtTime(base * (1.3 + 0.2 * Math.random()), t0 + 0.08);
      g.gain.linearRampToValueAtTime(0.05, t0 + 0.01); g.gain.linearRampToValueAtTime(0, t0 + 0.09);
    }
    o.connect(g).connect(p).connect(master); o.start(t); o.stop(t + notes * 0.13 + 0.1);
  }

  // surface: 'stone' | 'gravel' | 'grass'
  function step(surface) {
    const t = ctx.currentTime, len = surface === 'stone' ? 0.05 : surface === 'gravel' ? 0.12 : 0.09;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const e = Math.pow(1 - i / d.length, surface === 'stone' ? 6 : 2);
      d[i] = (Math.random() * 2 - 1) * e * (surface === 'gravel' && Math.random() < 0.08 ? 2.5 : 1);
    }
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = buf;
    f.type = surface === 'grass' ? 'lowpass' : 'bandpass';
    f.frequency.value = surface === 'stone' ? 900 : surface === 'gravel' ? 2600 : 700;
    g.gain.value = surface === 'grass' ? 0.12 : 0.22;
    src.connect(f).connect(g).connect(master); src.start(t);
  }

  return {
    start,
    get started() { return !!ctx; },
    toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.8; return muted; },
    // env: { waterNear 0..1, height m, trees 0..1, speed m/s, surface, walking }
    update(dt, env) {
      if (!ctx) return;
      const t = ctx.currentTime;
      water.gain.gain.setTargetAtTime(0.35 * env.waterNear, t, 0.3);
      water.filter.frequency.setTargetAtTime(380 + 80 * Math.sin(t * 0.7), t, 0.5);
      wind.gain.gain.setTargetAtTime(0.05 + Math.min(0.35, env.height / 400), t, 0.5);
      if ((birdT -= dt) <= 0) { if (Math.random() < env.trees) chirp(); birdT = 0.6 + Math.random() * 3; }
      if (env.walking && env.speed > 0.5) {
        stepT -= dt * env.speed / 1.4;
        if (stepT <= 0) { step(env.surface); stepT = 1; }
      } else stepT = 0.2;
    },
  };
}
