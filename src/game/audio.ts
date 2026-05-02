// Audio helper. WebAudio for short SFX, SpeechSynthesis for spoken words.
// Volumes are intentionally conservative for headphone-on-toddler safety.

type WebAudioCtor = typeof AudioContext;

export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private englishVoice: SpeechSynthesisVoice | null = null;

  constructor() {
    if ('speechSynthesis' in window) {
      const updateVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        // Prefer a child- or female-sounding voice when available.
        this.englishVoice =
          voices.find(v => v.lang.startsWith('en') && /child|kid/i.test(v.name)) ||
          voices.find(v => v.lang.startsWith('en') && /female|samantha|karen|kate|moira|tessa/i.test(v.name)) ||
          voices.find(v => v.lang.startsWith('en')) ||
          null;
      };
      updateVoices();
      window.speechSynthesis.addEventListener('voiceschanged', updateVoices);
    }
  }

  unlock() {
    if (!this.ctx) {
      const Ctor: WebAudioCtor | undefined =
        window.AudioContext || (window as unknown as { webkitAudioContext?: WebAudioCtor }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // Soft scoop blip — used while digging. Capped to avoid spamming.
  private lastDig = 0;
  playDigBlip() {
    const now = performance.now();
    if (now - this.lastDig < 90) return;
    this.lastDig = now;
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(70 + Math.random() * 30, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.08);
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.10);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.12);
  }

  // Whoosh of dirt falling out of the bucket.
  playDump() {
    if (!this.ctx || !this.master) return;
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * 0.45);
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = 1 - i / len;
      data[i] = (Math.random() * 2 - 1) * env * 0.6;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    const g = this.ctx.createGain();
    g.gain.value = 0.13;
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start();
  }

  // Clanky thunk when material lands in truck bed.
  playClunk() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.15);
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.20);
  }

  // Two-tone truck horn.
  playHonk() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const blow = (freq: number, start: number, dur: number) => {
      const o = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(freq, start);
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.10, start + 0.02);
      g.gain.linearRampToValueAtTime(0.10, start + dur - 0.04);
      g.gain.linearRampToValueAtTime(0, start + dur);
      o.connect(g);
      g.connect(this.master!);
      o.start(start);
      o.stop(start + dur + 0.02);
    };
    blow(220, t, 0.18);
    blow(170, t + 0.20, 0.28);
  }

  // Sparkle / fanfare when truck is full.
  playFanfare() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const start = t + i * 0.09;
      const o = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, start);
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.09, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.32);
      o.connect(g);
      g.connect(this.master!);
      o.start(start);
      o.stop(start + 0.34);
    });
  }

  // Engine puff — when truck is starting / driving off.
  playEnginePuff() {
    if (!this.ctx || !this.master) return;
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * 0.35);
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = Math.exp(-i / (sr * 0.12));
      data[i] = (Math.random() * 2 - 1) * env * 0.5;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 250;
    const g = this.ctx.createGain();
    g.gain.value = 0.10;
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start();
  }

  speak(text: string, opts?: { rate?: number; pitch?: number }) {
    if (!('speechSynthesis' in window)) return;
    // Don't queue — replace any in-flight utterance.
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = opts?.rate ?? 0.95;
    u.pitch = opts?.pitch ?? 1.15;
    u.volume = 0.85;
    if (this.englishVoice) u.voice = this.englishVoice;
    window.speechSynthesis.speak(u);
  }
}
