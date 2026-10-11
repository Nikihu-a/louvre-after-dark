// Synthesized sound, no audio files: the clack of a gallery spotlight switching
// on, and a faint room tone. Browsers only allow audio after a click or key
// press, so enable() must be called from one.

export class Sound {
  constructor() {
    this.ctx = null;
    this.on = false;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.ctx.destination);
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
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(on ? 1 : 0, t, 0.2);
    }
    return on;
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
