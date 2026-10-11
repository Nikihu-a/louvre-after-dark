// Sound: a soundtrack from each painting's own era, plus synthesized effects
// (the clack of a gallery spotlight, a faint room tone). Browsers only allow
// audio after a click or key press, so enable() must be called from one.

// One loop per era, each written within a few decades of its paintings.
// Recordings and licenses: assets/music/CREDITS.md.
export const TRACKS = {
  renaissance: { title: "Francesco da Milano — Ricercar XXXI, for lute", year: "c. 1530s" },
  baroque: { title: "Louis Couperin — Chaconne in D minor", year: "c. 1650s" },
  rococo: { title: "François Couperin — L'Art de toucher le clavecin", year: "1716" },
  neoclassical: { title: "Mozart — Sonata in B-flat, K. 333, Andante cantabile", year: "1784" },
  romantic: { title: "Chopin — Nocturne in B-flat minor, Op. 9 No. 1", year: "1830–32" },
};
const OVERLAP = 4.0;      // seconds; matches the baked fade-out in tools/make_music.py
const MUSIC_LEVEL = 0.4;
const DUCKED = 0.22;      // while a single painting is open

export class Sound {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.era = null;
    this.ducked = false;
    this.buffers = new Map();
    this.voice = null;
    // Never play from a background tab.
    document.addEventListener("visibilitychange", () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else if (this.on) this.ctx.resume();
    });
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = MUSIC_LEVEL;
      this.musicBus.connect(this.master);
      this.noise = this.makeNoise(2);
      this.startRoom();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return true;
  }

  enable(on) {
    if (on && !this.ensure()) return false;
    this.on = on;
    if (this.ctx) {
      const t = this.ctx.currentTime;
      const g = this.master.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      clearTimeout(this.sleep);
      if (on) {
        g.linearRampToValueAtTime(1, t + 0.35);
        if (!this.voice) this.playEra();
      } else {
        // Silence at once (a 60 ms ramp avoids a click), then stop the
        // audio engine entirely so nothing can keep playing.
        g.linearRampToValueAtTime(0, t + 0.06);
        this.sleep = setTimeout(() => {
          if (this.on) return;
          this.stopVoice(0);
          this.ctx.suspend();
        }, 90);
      }
    }
    return on;
  }

  // ------------------------------------------------ era soundtrack
  load(era) {
    if (!this.buffers.has(era)) {
      const p = fetch(`assets/music/${era}.mp3`)
        .then((r) => {
          if (!r.ok) throw new Error(`music ${era}: ${r.status}`);
          return r.arrayBuffer();
        })
        .then((b) => this.ctx.decodeAudioData(b));
      p.catch(() => this.buffers.delete(era));
      this.buffers.set(era, p);
    }
    return this.buffers.get(era);
  }

  // Load the rest of the soundtrack quietly, one track at a time.
  async prefetch() {
    for (const era of Object.keys(TRACKS)) {
      try { await this.load(era); } catch { /* skip */ }
    }
  }

  setEra(era) {
    if (era === this.era) return;
    this.era = era;
    if (this.on && this.ctx) this.playEra();
  }

  duck(on) {
    if (on === this.ducked) return;
    this.ducked = on;
    if (!this.ctx) return;
    const g = this.musicBus.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(on ? DUCKED : MUSIC_LEVEL, t + 0.8);
  }

  async playEra() {
    const era = this.era;
    if (!era) return;
    let buf;
    try {
      buf = await this.load(era);
    } catch (err) {
      console.warn(err);
      return;
    }
    if (era !== this.era || !this.on) return;
    if (this.voice && this.voice.era === era) return;
    this.stopVoice(2.5);
    const c = this.ctx;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, c.currentTime);
    gain.gain.linearRampToValueAtTime(1, c.currentTime + 2.5);
    gain.connect(this.musicBus);
    const voice = { era, gain, sources: new Set(), timer: 0 };
    // Gapless loop: start the next pass OVERLAP seconds before this one ends.
    const pass = (at) => {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(gain);
      src.start(at);
      voice.sources.add(src);
      src.onended = () => voice.sources.delete(src);
      const next = at + buf.duration - OVERLAP;
      voice.timer = setTimeout(() => pass(next), Math.max(0, (next - c.currentTime - 1) * 1000));
    };
    pass(c.currentTime + 0.05);
    this.voice = voice;
    this.prefetch();
  }

  stopVoice(fade) {
    const v = this.voice;
    if (!v) return;
    this.voice = null;
    clearTimeout(v.timer);
    const t = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.linearRampToValueAtTime(0, t + fade);
    v.sources.forEach((s) => { try { s.stop(t + fade + 0.05); } catch { /* already stopped */ } });
  }

  makeNoise(seconds, brown = false) {
    const c = this.ctx;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  // A low, slowly breathing hush, like a large empty hall.
  startRoom() {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.makeNoise(6, true);
    src.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 380;
    const g = c.createGain();
    g.gain.value = 0.05;
    const lfo = c.createOscillator();
    const lfoGain = c.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 0.018;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(lp).connect(g).connect(this.master);
    src.start();
    lfo.start();
  }

  // The clack of a heavy relay switch, panned to where the light is.
  click(pan = 0, strength = 1) {
    if (!this.on || !this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime + 0.005;
    const out = c.createStereoPanner ? c.createStereoPanner() : c.createGain();
    if (out.pan) out.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(this.master);

    const n = c.createBufferSource();
    n.buffer = this.noise;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1700 + Math.random() * 500;
    bp.Q.value = 1.4;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.55 * strength, t + 0.002);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    n.connect(bp).connect(ng).connect(out);
    n.start(t, Math.random() * 1.5, 0.06);

    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.09);
    const og = c.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.4 * strength, t + 0.004);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 0.16);
  }
}
