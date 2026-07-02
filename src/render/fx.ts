// 特效系统：粒子池（零运行时分配）+ 事件驱动发射器 + 神迹预瞄指示 + 屏幕闪光。
// 每个神迹的反馈链在这里闭合：事件 → 粒子/光效/闪电/震屏（震屏在 camera）。
import { TILE_H, TILE_W, H_STEP, MIRACLES } from '../core/const';
import { EventBus } from '../core/events';
import { isoX } from './camera';

const POOL_SIZE = 640;
const fxTexCache: { soft?: any; spark?: any; smoke?: any; pillar?: any } = {};

interface Particle {
  spr: any; alive: boolean;
  x: number; y: number; vx: number; vy: number; grav: number;
  life: number; maxLife: number; s0: number; s1: number; spin: number;
}

export class FxRenderer {
  world: any;          // 世界空间粒子层
  screen: any;         // 屏幕空间（闪光/暗角）
  cursor: any;         // 预瞄指示
  private pool: Particle[] = [];
  private free: Particle[] = [];
  private flash: any;
  private lightnings: { g: any; life: number }[] = [];
  private pillars: { spr: any; life: number; max: number }[] = [];
  private emitters: { x: number; y: number; until: number; kind: string; acc: number }[] = [];
  private heightAt: (x: number, y: number) => number;
  private quality = 1;
  private softTex: any; private sparkTex: any; private smokeTex: any; private pillarTex: any;

  constructor(bus: EventBus, heightAt: (x: number, y: number) => number, viewSize: () => { w: number; h: number }) {
    this.heightAt = heightAt;
    this.world = new PIXI.Container();
    this.screen = new PIXI.Container();
    this.cursor = new PIXI.Graphics();
    this.world.addChild(this.cursor);
    // 程序化纹理跨局缓存（防重复开局泄漏进 PIXI Cache）
    if (!fxTexCache.soft) {
      fxTexCache.soft = softCircle(48, [255, 255, 255]);
      fxTexCache.spark = softCircle(20, [255, 255, 255]);
      fxTexCache.smoke = softCircle(64, [255, 255, 255], 0.55);
      fxTexCache.pillar = pillarTexture();
    }
    this.softTex = fxTexCache.soft;
    this.sparkTex = fxTexCache.spark;
    this.smokeTex = fxTexCache.smoke;
    this.pillarTex = fxTexCache.pillar;

    for (let i = 0; i < POOL_SIZE; i++) {
      const spr = new PIXI.Sprite(this.softTex);
      spr.anchor.set(0.5); spr.visible = false;
      this.world.addChild(spr);
      const p: Particle = { spr, alive: false, x: 0, y: 0, vx: 0, vy: 0, grav: 0, life: 0, maxLife: 1, s0: 1, s1: 1, spin: 0 };
      this.pool.push(p); this.free.push(p);
    }

    this.flash = new PIXI.Graphics();
    this.flash.rect(0, 0, 4, 4).fill(0xffffff);
    this.flash.alpha = 0; this.flash.visible = false;
    this.screen.addChild(this.flash);
    this.viewSize = viewSize;
    this.bind(bus);
  }
  private viewSize: () => { w: number; h: number };

  setQuality(q: 'low' | 'medium' | 'high'): void {
    this.quality = q === 'high' ? 1 : q === 'medium' ? 0.6 : 0.3;
  }

  // ── 事件绑定：反馈链落点 ─────────────────────────────
  private bind(bus: EventBus): void {
    bus.on('miracleCast', (e) => {
      if (e.id === 'raise' || e.id === 'lower') this.dustBurst(e.x, e.y, e.id === 'raise' ? -1 : 1);
    });
    bus.on('lightningStrike', (e) => this.lightning(e.x, e.y));
    bus.on('blessApplied', (e) => this.blessFx(e.x, e.y, e.r));
    bus.on('swampApplied', (e) => this.swampFx(e.x, e.y, e.r));
    bus.on('quakeShake', (e) => this.quakeFx(e.x, e.y));
    bus.on('volcanoErupt', (e) => {
      this.emitters.push({ x: e.x, y: e.y, until: performance.now() / 1000 + 9, kind: 'volcano', acc: 0 });
      this.flashScreen(0.5, 0xffb070);
    });
    bus.on('floodStart', () => this.flashScreen(0.35, 0x4090c0));
    bus.on('floodEnd', () => this.flashScreen(0.2, 0x4090c0));
    bus.on('combat', (e) => this.combatFx(e.x, e.y));
    bus.on('entityDeath', (e) => {
      if (e.kind === 'follower') this.soulFx(e.x, e.y, e.faction);
      else this.rubbleFx(e.x, e.y);
    });
    bus.on('entitySpawn', (e) => { if (e.kind === 'follower') this.popFx(e.x, e.y); });
    bus.on('houseUpgrade', (e) => this.upgradeFx(e.x, e.y));
    bus.on('fireStart', (e) => this.emitters.push({ x: e.x, y: e.y, until: performance.now() / 1000 + 5, kind: 'fire', acc: 0 }));
    bus.on('totemPlaced', (e) => this.upgradeFx(e.x, e.y));
    bus.on('armageddon', () => this.flashScreen(0.6, 0xff3030));
  }

  // ── 粒子原语 ────────────────────────────────────────
  private spawn(wx: number, wy: number, opts: {
    n: number; speed: [number, number]; up: [number, number]; grav?: number;
    life: [number, number]; s0?: number; s1?: number; tint?: number; blend?: string; tex?: any; hOff?: number;
  }): void {
    const n = Math.max(1, Math.round(opts.n * this.quality));
    const h = this.heightAt(wx, wy);
    const px = isoX(wx, wy), py = (wx + wy) * (TILE_H / 2) - h * H_STEP - (opts.hOff ?? 0);
    for (let i = 0; i < n; i++) {
      const p = this.free.pop();
      if (!p) return;
      p.alive = true;
      const a = Math.random() * Math.PI * 2;
      const sp = opts.speed[0] + Math.random() * (opts.speed[1] - opts.speed[0]);
      p.x = px + Math.cos(a) * 6; p.y = py + Math.sin(a) * 3;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp * 0.5 - (opts.up[0] + Math.random() * (opts.up[1] - opts.up[0]));
      p.grav = opts.grav ?? 160;
      p.maxLife = p.life = opts.life[0] + Math.random() * (opts.life[1] - opts.life[0]);
      p.s0 = opts.s0 ?? 0.5; p.s1 = opts.s1 ?? 0.1;
      p.spin = (Math.random() - 0.5) * 4;
      p.spr.texture = opts.tex ?? this.softTex;
      p.spr.tint = opts.tint ?? 0xffffff;
      p.spr.blendMode = opts.blend ?? 'normal';
      p.spr.visible = true;
      p.spr.position.set(p.x, p.y);
      p.spr.zIndex = p.y;
    }
  }

  private dustBurst(x: number, y: number, dir: number): void {
    this.spawn(x, y, { n: 26, speed: [30, 130], up: dir < 0 ? [40, 120] : [-20, 30], life: [0.4, 0.9], s0: 0.7, s1: 0.15, tint: 0xb9a06d, tex: this.smokeTex });
    this.spawn(x, y, { n: 10, speed: [60, 180], up: [60, 140], life: [0.3, 0.6], s0: 0.3, s1: 0, tint: 0xd8c89a, tex: this.sparkTex });
  }
  private blessFx(x: number, y: number, r: number): void {
    const h = this.heightAt(x, y);
    const spr = new PIXI.Sprite(this.pillarTex);
    spr.anchor.set(0.5, 1);
    spr.blendMode = 'add';
    spr.tint = 0xffe9a0;
    spr.position.set(isoX(x, y), (x + y) * (TILE_H / 2) - h * H_STEP + 6);
    spr.zIndex = spr.y + 500;
    this.world.addChild(spr);
    this.pillars.push({ spr, life: 1.4, max: 1.4 });
    for (let i = 0; i < 4; i++) {
      const ang = Math.random() * Math.PI * 2, rr = Math.random() * r;
      this.spawn(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr, { n: 4, speed: [4, 18], up: [30, 80], grav: -30, life: [0.8, 1.6], s0: 0.28, s1: 0, tint: 0xffe9a0, blend: 'add', tex: this.sparkTex });
    }
  }
  private swampFx(x: number, y: number, r: number): void {
    for (let i = 0; i < 6; i++) {
      const ang = Math.random() * Math.PI * 2, rr = Math.random() * r;
      this.spawn(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr, { n: 5, speed: [5, 25], up: [10, 40], grav: -12, life: [0.9, 1.8], s0: 0.8, s1: 0.2, tint: 0x5f7a3a, tex: this.smokeTex });
    }
  }
  private quakeFx(x: number, y: number): void {
    for (let i = 0; i < 8; i++) {
      const ang = Math.random() * Math.PI * 2, rr = Math.random() * 5;
      this.spawn(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr, { n: 6, speed: [20, 90], up: [20, 90], life: [0.5, 1.2], s0: 0.8, s1: 0.2, tint: 0x8a7a5d, tex: this.smokeTex });
    }
    this.flashScreen(0.14, 0xcbb890);
  }
  private combatFx(x: number, y: number): void {
    this.spawn(x, y, { n: 5, speed: [40, 110], up: [30, 80], life: [0.2, 0.45], s0: 0.22, s1: 0, tint: 0xffdd66, blend: 'add', tex: this.sparkTex });
  }
  private soulFx(x: number, y: number, faction: number): void {
    this.spawn(x, y, { n: 6, speed: [4, 16], up: [40, 90], grav: -50, life: [0.9, 1.5], s0: 0.3, s1: 0, tint: faction === 0 ? 0xa8e8ff : 0xffb0a8, blend: 'add', tex: this.sparkTex });
  }
  private rubbleFx(x: number, y: number): void {
    this.spawn(x, y, { n: 22, speed: [40, 150], up: [60, 170], life: [0.5, 1.1], s0: 0.55, s1: 0.1, tint: 0x9c8f76, tex: this.smokeTex });
    this.spawn(x, y, { n: 12, speed: [80, 200], up: [90, 210], grav: 420, life: [0.5, 0.9], s0: 0.25, s1: 0.05, tint: 0x6f665a });
  }
  private popFx(x: number, y: number): void {
    this.spawn(x, y, { n: 4, speed: [10, 30], up: [20, 55], life: [0.3, 0.6], s0: 0.18, s1: 0, tint: 0xffffff, blend: 'add', tex: this.sparkTex });
  }
  private upgradeFx(x: number, y: number): void {
    this.spawn(x, y, { n: 14, speed: [30, 90], up: [50, 130], grav: -10, life: [0.6, 1.1], s0: 0.26, s1: 0, tint: 0xffd870, blend: 'add', tex: this.sparkTex });
  }

  private lightning(x: number, y: number): void {
    const h = this.heightAt(x, y);
    const gx = isoX(x, y), gy = (x + y) * (TILE_H / 2) - h * H_STEP;
    const g = new PIXI.Graphics();
    // 主干 + 两条分叉
    for (let branch = 0; branch < 3; branch++) {
      let bx = gx + (branch === 0 ? 0 : (Math.random() - 0.5) * 60);
      let by = gy - 620 - Math.random() * 120;
      const pts: [number, number][] = [[bx, by]];
      const segs = 9 + (branch ? 4 : 0);
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        bx = gx * t + bx * (1 - t) + (Math.random() - 0.5) * 46 * (1 - t);
        by = gy - (620 * (1 - t)) + (Math.random() - 0.5) * 18;
        pts.push([bx, by]);
      }
      pts[pts.length - 1] = [gx, gy];
      const w = branch === 0 ? 5 : 2;
      g.moveTo(pts[0][0], pts[0][1]);
      for (const [px, py] of pts.slice(1)) g.lineTo(px, py);
      g.stroke({ width: w + 5, color: 0x86c8ff, alpha: 0.35 });
      g.moveTo(pts[0][0], pts[0][1]);
      for (const [px, py] of pts.slice(1)) g.lineTo(px, py);
      g.stroke({ width: w, color: 0xffffff, alpha: 0.95 });
      if (branch !== 0 && Math.random() < 0.5) break;
    }
    g.blendMode = 'add';
    g.zIndex = gy + 1000;
    this.world.addChild(g);
    this.lightnings.push({ g, life: 0.28 });
    this.flashScreen(0.4, 0xd8ecff);
    this.spawn(x, y, { n: 16, speed: [50, 190], up: [40, 160], life: [0.25, 0.6], s0: 0.28, s1: 0, tint: 0xbfe0ff, blend: 'add', tex: this.sparkTex });
  }

  flashScreen(alpha: number, color: number): void {
    this.flash.clear();
    const { w, h } = this.viewSize();
    this.flash.rect(0, 0, w, h).fill(color);
    this.flash.alpha = Math.max(this.flash.alpha, alpha);
    this.flash.visible = true;
  }

  /** 预瞄指示：范围环 + 可行性着色（金=可施放 / 灰蓝=冷却 / 红=信仰不足） */
  updateCursor(sel: string | null, hx: number, hy: number, state: 'ok' | 'faith' | 'cooldown' | 'hidden'): void {
    const g = this.cursor;
    g.clear();
    if (!sel || state === 'hidden') return;
    const def = MIRACLES.find(m => m.id === sel);
    if (!def) return;
    const color = state === 'ok' ? 0xffd870 : state === 'cooldown' ? 0x8fa8c0 : 0xff6050;
    const r = Math.max(0.8, def.radius);
    const pts: [number, number][] = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const wx = hx + Math.cos(a) * r, wy = hy + Math.sin(a) * r;
      const h = this.heightAt(wx, wy);
      pts.push([isoX(wx, wy), (wx + wy) * (TILE_H / 2) - h * H_STEP]);
    }
    g.moveTo(pts[0][0], pts[0][1]);
    for (const [px, py] of pts.slice(1)) g.lineTo(px, py);
    g.stroke({ width: 2.5, color, alpha: 0.9 });
    // 中心标记
    const ch = this.heightAt(hx, hy);
    const cx = isoX(hx, hy), cy = (hx + hy) * (TILE_H / 2) - ch * H_STEP;
    g.moveTo(cx - 8, cy).lineTo(cx + 8, cy).stroke({ width: 1.5, color, alpha: 0.7 });
    g.moveTo(cx, cy - 5).lineTo(cx, cy + 5).stroke({ width: 1.5, color, alpha: 0.7 });
    g.zIndex = cy + 400;
    const pulse = 0.75 + Math.sin(performance.now() / 180) * 0.25;
    g.alpha = pulse;
  }

  update(dt: number): void {
    // 粒子
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; p.spr.visible = false; this.free.push(p); continue; }
      p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const t = 1 - p.life / p.maxLife;
      p.spr.position.set(p.x, p.y);
      p.spr.scale.set(p.s0 + (p.s1 - p.s0) * t);
      p.spr.alpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      p.spr.rotation += p.spin * dt;
    }
    // 闪电衰减
    for (let i = this.lightnings.length - 1; i >= 0; i--) {
      const l = this.lightnings[i];
      l.life -= dt;
      l.g.alpha = Math.max(0, l.life / 0.28);
      if (l.life <= 0) { l.g.destroy(); this.lightnings.splice(i, 1); }
    }
    // 光柱
    for (let i = this.pillars.length - 1; i >= 0; i--) {
      const p = this.pillars[i];
      p.life -= dt;
      const t = 1 - p.life / p.max;
      p.spr.scale.set(1 + t * 0.4, 1 - t * 0.15);
      p.spr.alpha = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
      if (p.life <= 0) { p.spr.destroy(); this.pillars.splice(i, 1); }
    }
    // 持续发射器（火山/火灾）
    const now = performance.now() / 1000;
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      if (now > e.until) { this.emitters.splice(i, 1); continue; }
      e.acc += dt;
      const interval = e.kind === 'volcano' ? 0.06 : 0.18;
      while (e.acc > interval) {
        e.acc -= interval;
        if (e.kind === 'volcano') {
          this.spawn(e.x, e.y, { n: 3, speed: [20, 80], up: [180, 380], grav: 300, life: [0.7, 1.6], s0: 0.3, s1: 0.08, tint: 0xff9040, blend: 'add', tex: this.sparkTex, hOff: 40 });
          this.spawn(e.x, e.y, { n: 2, speed: [10, 40], up: [60, 140], grav: -40, life: [1.5, 3], s0: 0.9, s1: 2.2, tint: 0x554a44, tex: this.smokeTex, hOff: 50 });
        } else {
          this.spawn(e.x, e.y, { n: 1, speed: [4, 18], up: [30, 80], grav: -30, life: [0.7, 1.4], s0: 0.4, s1: 1.1, tint: 0x4a4038, tex: this.smokeTex, hOff: 16 });
        }
      }
    }
    // 屏幕闪光衰减
    if (this.flash.alpha > 0.004) this.flash.alpha *= Math.exp(-7 * dt);
    else { this.flash.alpha = 0; this.flash.visible = false; }
  }
}

function softCircle(size: number, rgb: [number, number, number], hardness = 0.2): any {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, size * hardness * 0.5, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},1)`);
  grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return PIXI.Texture.from(c);
}

function pillarTexture(): any {
  const c = document.createElement('canvas');
  c.width = 96; c.height = 320;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 320);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.7, 'rgba(255,244,200,0.55)');
  grad.addColorStop(1, 'rgba(255,240,180,0.9)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(30, 0); g.lineTo(66, 0); g.lineTo(88, 320); g.lineTo(8, 320);
  g.closePath(); g.fill();
  return PIXI.Texture.from(c);
}
