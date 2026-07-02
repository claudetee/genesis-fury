// WebAudio 全程序化音频：环境音景（风/海/鸟）+ 生成式配乐（竖琴/圣咏垫/战鼓）
// + 全套合成 SFX。无任何音频资产文件；首次用户手势后惰性启动（浏览器策略）。
import { EventBus } from '../core/events';

type SfxName =
  | 'raise' | 'lower' | 'bless' | 'lightning' | 'swamp' | 'quake' | 'flood' | 'volcano' | 'totem'
  | 'firestorm' | 'teleport'
  | 'uiClick' | 'uiHover' | 'denied' | 'birth' | 'death' | 'collapse' | 'upgrade' | 'victory' | 'defeat';

const PENTA = [220, 246.9, 293.7, 329.6, 392, 440, 493.9, 587.3];         // A 五声
const CHORDS = [[220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7], [146.8, 220, 293.7]];

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode; private music!: GainNode; private sfx!: GainNode; private amb!: GainNode;
  private noiseBuf!: AudioBuffer;
  private started = false;
  private musicTimer = 0;
  private bar = 0; private step = 0;
  private intensity = 0;               // 0 祥和 → 1 战争
  private targetIntensity = 0;
  private combatHeat = 0;
  private vol = { master: 0.8, music: 0.7, sfx: 0.9 };
  private padOsc: OscillatorNode[] = [];
  private padGain!: GainNode; private padFilter!: BiquadFilterNode;
  muted = false;

  /** 必须在用户手势中调用 */
  start(): void {
    if (this.started) return;
    try {
      this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    } catch { return; }
    const ctx = this.ctx;
    this.master = ctx.createGain(); this.master.connect(ctx.destination);
    this.music = ctx.createGain(); this.music.connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.amb = ctx.createGain(); this.amb.connect(this.master);
    this.applyVolumes();

    // 共享噪声源
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.startAmbience();
    this.startPad();
    this.started = true;
  }

  setVolumes(master: number, music: number, sfxV: number): void {
    this.vol = { master, music, sfx: sfxV };
    this.applyVolumes();
  }
  toggleMute(): boolean { this.muted = !this.muted; this.applyVolumes(); return this.muted; }
  private applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = this.muted ? 0 : this.vol.master;
    this.music.gain.value = this.vol.music * 0.5;
    this.sfx.gain.value = this.vol.sfx;
    this.amb.gain.value = 0.34;
  }

  resume(): void { this.ctx?.resume(); }
  isRunning(): boolean { return this.started && this.ctx?.state === 'running'; }

  // ── 环境音景 ────────────────────────────────────────
  private startAmbience(): void {
    const ctx = this.ctx!;
    // 风：噪声 → 带通（中心频率被 LFO 缓慢摆动）
    const wind = ctx.createBufferSource(); wind.buffer = this.noiseBuf; wind.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.6;
    const windGain = ctx.createGain(); windGain.gain.value = 0.16;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 220;
    lfo.connect(lfoAmt); lfoAmt.connect(bp.frequency);
    wind.connect(bp); bp.connect(windGain); windGain.connect(this.amb);
    wind.start(); lfo.start();
    // 海浪：低通噪声 + 慢包络起伏
    const sea = ctx.createBufferSource(); sea.buffer = this.noiseBuf; sea.loop = true; sea.playbackRate.value = 0.6;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240;
    const seaGain = ctx.createGain(); seaGain.gain.value = 0.10;
    const seaLfo = ctx.createOscillator(); seaLfo.frequency.value = 0.12;
    const seaAmt = ctx.createGain(); seaAmt.gain.value = 0.05;
    seaLfo.connect(seaAmt); seaAmt.connect(seaGain.gain);
    sea.connect(lp); lp.connect(seaGain); seaGain.connect(this.amb);
    sea.start(); seaLfo.start();
  }

  /** 鸟鸣（祥和时随机触发，由 update 调度） */
  private birdChirp(): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(); o.type = 'sine';
      const g = ctx.createGain();
      const f0 = 2400 + Math.random() * 1400;
      const t = t0 + i * (0.09 + Math.random() * 0.06);
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * (1.2 + Math.random() * 0.4), t + 0.05);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.03, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.connect(g); g.connect(this.amb);
      o.start(t); o.stop(t + 0.12);
    }
  }

  // ── 生成式配乐 ──────────────────────────────────────
  private startPad(): void {
    const ctx = this.ctx!;
    this.padGain = ctx.createGain(); this.padGain.gain.value = 0;
    this.padFilter = ctx.createBiquadFilter(); this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 900;
    this.padFilter.connect(this.padGain); this.padGain.connect(this.music);
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.detune.value = (i - 1) * 9;
      o.frequency.value = 220;
      o.connect(this.padFilter);
      o.start();
      this.padOsc.push(o);
    }
    this.padGain.gain.setTargetAtTime(0.05, ctx.currentTime + 1, 3);
  }

  private pluck(freq: number, when: number, vel = 0.14): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2; // 泛音
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vel, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 1.6);
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o2.connect(g2); g2.connect(g);
    o.connect(g); g.connect(this.music);
    o.start(when); o.stop(when + 1.8); o2.start(when); o2.stop(when + 1.8);
  }

  private drum(when: number, low = true): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(low ? 88 : 130, when);
    o.frequency.exponentialRampToValueAtTime(low ? 42 : 62, when + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.28, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.3);
    o.connect(g); g.connect(this.music);
    o.start(when); o.stop(when + 0.35);
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.1, when);
    g2.gain.exponentialRampToValueAtTime(0.001, when + 0.12);
    s.connect(f); f.connect(g2); g2.connect(this.music);
    s.start(when); s.stop(when + 0.15);
  }

  /** 战况强度（渲染层每帧喂入战斗热度） */
  reportCombat(): void { this.combatHeat = Math.min(1, this.combatHeat + 0.12); }

  update(dt: number): void {
    if (!this.started || !this.ctx || this.ctx.state !== 'running') return;
    this.combatHeat = Math.max(0, this.combatHeat - dt * 0.08);
    this.targetIntensity = this.combatHeat;
    this.intensity += (this.targetIntensity - this.intensity) * Math.min(1, dt);

    // 每 step = 0.5s 的音序器（提前 0.12s 调度）
    this.musicTimer -= dt;
    if (this.musicTimer <= 0) {
      this.musicTimer = 0.5;
      const ctx = this.ctx;
      const when = ctx.currentTime + 0.12;
      const chord = CHORDS[this.bar % CHORDS.length];
      // 垫底和声跟随和弦
      this.padOsc.forEach((o, i) => o.frequency.setTargetAtTime(chord[i % chord.length] / 2, when, 0.6));
      this.padFilter.frequency.setTargetAtTime(700 + this.intensity * 900, when, 0.8);
      // 竖琴：稀疏琶音（祥和多、战时少）
      if (Math.random() < (this.intensity > 0.5 ? 0.25 : 0.55)) {
        const note = PENTA[Math.floor(Math.random() * PENTA.length)] * (Math.random() < 0.25 ? 2 : 1);
        this.pluck(note, when, 0.09 + Math.random() * 0.06);
      }
      // 战鼓：强度驱动
      if (this.intensity > 0.35) {
        if (this.step % 2 === 0) this.drum(when, true);
        if (this.intensity > 0.7 && this.step % 4 === 3) this.drum(when + 0.25, false);
      }
      // 鸟鸣：祥和时偶发
      if (this.intensity < 0.2 && Math.random() < 0.10) this.birdChirp();
      this.step++;
      if (this.step % 16 === 0) this.bar++;
    }
  }

  // ── SFX ────────────────────────────────────────────
  play(name: SfxName): void {
    if (!this.started || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this.sfx;
    const noise = (dur: number, fType: BiquadFilterType, f0: number, f1: number, vel: number, when = t) => {
      const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = dur > 1.8;
      const f = ctx.createBiquadFilter(); f.type = fType;
      f.frequency.setValueAtTime(f0, when);
      f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), when + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel, when);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      s.connect(f); f.connect(g); g.connect(out);
      s.start(when); s.stop(when + dur + 0.05);
    };
    const tone = (type: OscillatorType, f0: number, f1: number, dur: number, vel: number, when = t) => {
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, when);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), when + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(vel, when + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      o.connect(g); g.connect(out);
      o.start(when); o.stop(when + dur + 0.05);
    };

    switch (name) {
      case 'raise': tone('sine', 70, 130, 0.5, 0.5); noise(0.5, 'lowpass', 500, 120, 0.35); break;
      case 'lower': tone('sine', 130, 60, 0.55, 0.5); noise(0.55, 'lowpass', 400, 100, 0.3); break;
      case 'bless': [523, 659, 784, 1047].forEach((f, i) => tone('sine', f, f, 0.9, 0.12, t + i * 0.07)); noise(1.2, 'highpass', 3000, 6000, 0.05); break;
      case 'lightning': noise(0.14, 'highpass', 1500, 4000, 0.7); noise(0.9, 'lowpass', 900, 60, 0.65, t + 0.05); tone('sine', 55, 30, 0.9, 0.5, t + 0.05); break;
      case 'swamp': [0, 0.12, 0.28, 0.4].forEach(d => tone('sine', 160 + Math.random() * 80, 60, 0.25, 0.22, t + d)); noise(0.8, 'lowpass', 350, 120, 0.2); break;
      case 'quake': noise(2.2, 'lowpass', 220, 40, 0.7); tone('sine', 38, 26, 2.2, 0.6); break;
      case 'flood': noise(2.4, 'lowpass', 700, 200, 0.5); tone('sine', 90, 45, 2, 0.25); break;
      case 'volcano': tone('sine', 45, 22, 2.6, 0.8); noise(2.6, 'lowpass', 400, 60, 0.7); noise(1.4, 'bandpass', 1800, 500, 0.3, t + 0.2); break;
      case 'totem': tone('square', 190, 150, 0.12, 0.2); tone('sine', 520, 520, 0.5, 0.12, t + 0.1); break;
      case 'firestorm': noise(2.2, 'bandpass', 2200, 400, 0.4); tone('sine', 60, 34, 2.2, 0.4); break;
      case 'teleport': tone('sine', 340, 1240, 0.35, 0.18); tone('sine', 1240, 340, 0.35, 0.14, t + 0.3); noise(0.5, 'highpass', 4000, 7000, 0.08); break;
      case 'uiClick': tone('square', 660, 520, 0.05, 0.1); break;
      case 'uiHover': tone('sine', 880, 880, 0.04, 0.05); break;
      case 'denied': tone('square', 160, 110, 0.18, 0.2); break;
      case 'birth': tone('sine', 620, 940, 0.16, 0.1); break;
      case 'death': tone('sine', 300, 120, 0.3, 0.12); break;
      case 'collapse': noise(0.8, 'lowpass', 600, 90, 0.45); tone('sine', 120, 50, 0.6, 0.3); break;
      case 'upgrade': [392, 523, 659].forEach((f, i) => tone('triangle', f, f, 0.4, 0.14, t + i * 0.09)); break;
      case 'victory': [261, 329, 392, 523, 659].forEach((f, i) => tone('sawtooth', f, f, 0.9, 0.1, t + i * 0.14)); break;
      case 'defeat': [392, 329, 261, 196].forEach((f, i) => tone('sawtooth', f, f * 0.98, 1.0, 0.1, t + i * 0.22)); break;
    }
  }

  /** 事件接线（渲染无关，直接吃 sim 事件） */
  bind(bus: EventBus): void {
    const evented = new Set(['lightning', 'quake', 'volcano', 'flood']); // 这些由专属事件发声（敌我通用）
    bus.on('miracleCast', (e) => {
      if (evented.has(e.id)) return;
      if (e.faction !== 0 && e.id !== 'swamp' && e.id !== 'bless') return; // 敌方静默的低感知神迹
      this.play(e.id as SfxName);
    });
    bus.on('lightningStrike', () => this.play('lightning'));
    bus.on('quakeShake', () => this.play('quake'));
    bus.on('volcanoErupt', () => this.play('volcano'));
    bus.on('floodStart', () => this.play('flood'));
    bus.on('blessApplied', () => { /* bless 已在 miracleCast 播 */ });
    bus.on('miracleDenied', () => this.play('denied'));
    bus.on('entitySpawn', (e) => { if (e.kind === 'follower' && Math.random() < 0.3) this.play('birth'); });
    bus.on('entityDeath', (e) => {
      if (e.kind === 'house') this.play('collapse');
      else if (Math.random() < 0.4) this.play('death');
    });
    bus.on('houseUpgrade', () => this.play('upgrade'));
    bus.on('combat', () => this.reportCombat());
    bus.on('gameOver', (e) => this.play(e.victory ? 'victory' : 'defeat'));
  }
}
