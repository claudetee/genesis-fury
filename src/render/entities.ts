// 实体视图层：以 sim 为唯一事实源做逐帧 diff 同步（新建/更新/移除），
// 信徒位置用上一 tick→当前 tick 插值，60fps 平滑。zIndex = 屏幕 Y 画家排序。
import { TILE_H } from '../core/const';
import { Sim } from '../sim/sim';
import { FState } from '../sim/entities';
import { AssetDb } from '../assets/loader';
import { isoX } from './camera';

const FACTION_TINT = [0x9fe8ff, 0xffb3ad];
const texCache: { follower?: Map<number, any>; flame?: any; ring?: any } = {};
const MIL_SPRITE: Record<string, [string, string]> = {
  barracks: ['barracks_a', 'barracks_b'], mageschool: ['mageschool_a', 'mageschool_b'],
  sanctum: ['sanctum_a', 'sanctum_b'], tower: ['tower_a', 'tower_b'],
};

export class EntityRenderer {
  container: any;
  private sim: Sim;
  private assets: AssetDb;
  private followerViews = new Map<number, any>();
  private houseViews = new Map<number, any>();
  private totemViews = new Map<number, any>();
  private avatarViews = new Map<number, any>();
  private flameTex: any;
  private ringTex: any;
  private milViews = new Map<number, any>();
  private heightAt: (x: number, y: number) => number;

  constructor(sim: Sim, assets: AssetDb, heightAt: (x: number, y: number) => number) {
    this.sim = sim; this.assets = assets; this.heightAt = heightAt;
    this.container = new PIXI.Container();
    this.container.sortableChildren = true;
    // 程序化纹理跨局缓存（重复开局不再向 PIXI Cache 泄漏新纹理）
    if (!texCache.follower) {
      texCache.follower = new Map();
      texCache.flame = makeFlameTexture();
      texCache.ring = makeRingTexture();
    }
    this.flameTex = texCache.flame;
    this.ringTex = texCache.ring;
  }

  /** 职业×阵营贴图（惰性生成，跨局缓存）。野人=faction2 */
  private followerTexFor(faction: number, cls: number): any {
    const key = faction * 10 + cls;
    let tex = texCache.follower!.get(key);
    if (!tex) { tex = makeFollowerTexture(faction, cls); texCache.follower!.set(key, tex); }
    return tex;
  }

  sync(alpha: number, time: number): void {
    const sim = this.sim;
    // ── 神使化身 ──
    for (const a of sim.avatars) {
      let v = this.avatarViews.get(a.faction);
      if (!v) {
        v = new PIXI.Container();
        const ring = new PIXI.Sprite(this.ringTex);
        ring.anchor.set(0.5); ring.blendMode = 'add';
        ring.tint = a.faction === 0 ? 0x8fe0ff : 0xff9088;
        ring.scale.set(0.55); ring.y = 3;
        const key = a.faction === 0 ? 'avatar_a' : 'avatar_b';
        const spr = new PIXI.Sprite(PIXI.Texture.from(this.assets.sprites[key] as HTMLCanvasElement | HTMLImageElement));
        spr.anchor.set(0.5, 0.94);
        spr.scale.set(0.38);
        v.addChild(ring); v.addChild(spr);
        (v as { _spr?: unknown })._spr = spr;
        (v as { _ring?: unknown })._ring = ring;
        this.avatarViews.set(a.faction, v);
        this.container.addChild(v);
      }
      const spr = (v as { _spr: any })._spr, ring = (v as { _ring: any })._ring;
      if (!a.alive) { v.visible = false; continue; }
      v.visible = true;
      const x = a.px + (a.x - a.px) * alpha, y = a.py + (a.y - a.py) * alpha;
      const h = this.heightAt(x, y);
      v.x = isoX(x, y);
      v.y = (x + y) * (TILE_H / 2) - h * 14;
      v.zIndex = v.y + 1;
      // 浮游感 + 光环脉动 + 受击/无敌反馈
      spr.y = Math.sin(time * 2.2 + a.faction * 3) * 2.5 - 2;
      ring.alpha = 0.35 + Math.sin(time * 3) * 0.15;
      const hurt = a.hp < 30;
      spr.tint = a.invulnUntil > time ? 0xbfffd0 : hurt && Math.sin(time * 12) > 0 ? 0xffb0a0 : 0xffffff;
      spr.alpha = a.invulnUntil > time ? 0.65 + Math.sin(time * 10) * 0.2 : 1;
    }
    // ── 信徒（含职业/野人）──
    const liveF = new Set<number>();
    for (const f of sim.followers) {
      liveF.add(f.id);
      let v = this.followerViews.get(f.id);
      if (!v) {
        v = new PIXI.Sprite(this.followerTexFor(f.faction, f.cls));
        v.anchor.set(0.5, 0.92);
        (v as { _key?: number })._key = f.faction * 10 + f.cls;
        this.followerViews.set(f.id, v);
        this.container.addChild(v);
      }
      // 转职/转阵营 → 换贴图
      const key = f.faction * 10 + f.cls;
      if ((v as { _key: number })._key !== key) {
        v.texture = this.followerTexFor(f.faction, f.cls);
        (v as { _key: number })._key = key;
      }
      const x = f.px + (f.x - f.px) * alpha, y = f.py + (f.y - f.py) * alpha;
      const h = this.heightAt(x, y);
      v.x = isoX(x, y);
      v.y = (x + y) * (TILE_H / 2) - h * 14;
      v.zIndex = v.y;
      // 行走轻微起伏 + 战斗红闪 + 祝福金光
      const moving = Math.abs(f.x - f.px) + Math.abs(f.y - f.py) > 0.001;
      v.scale.set(1, moving ? 1 + Math.sin(time * 16 + f.id * 1.7) * 0.08 : 1);
      if (f.state === FState.Fight) v.tint = (Math.sin(time * 20) > 0 ? 0xffffff : 0xff8877);
      else if (f.blessedUntil > time) v.tint = 0xffe9a0;
      else v.tint = 0xffffff;
      v.alpha = f.hp < 4 ? 0.55 + f.hp / 10 : 1;
    }
    for (const [id, v] of this.followerViews) if (!liveF.has(id)) { v.destroy(); this.followerViews.delete(id); }

    // ── 房屋 ──
    const liveH = new Set<number>();
    for (const h of sim.houses) {
      liveH.add(h.id);
      let v = this.houseViews.get(h.id);
      const key = (h.faction === 0 ? 'house_a' : 'house_b') + h.level;
      if (!v) {
        v = new PIXI.Container();
        const spr = new PIXI.Sprite(PIXI.Texture.from(this.assets.sprites[key] as HTMLCanvasElement | HTMLImageElement));
        spr.anchor.set(0.5, 0.86);
        spr.scale.set(0.62);
        v.addChild(spr);
        (v as { _spr?: unknown })._spr = spr;
        (v as { _lvl?: number })._lvl = h.level;
        this.houseViews.set(h.id, v);
        this.container.addChild(v);
      }
      const spr = (v as { _spr: any })._spr;
      if ((v as { _lvl: number })._lvl !== h.level) {
        spr.texture = PIXI.Texture.from(this.assets.sprites[key] as HTMLCanvasElement | HTMLImageElement);
        (v as { _lvl: number })._lvl = h.level;
      }
      const gh = this.heightAt(h.tx + 0.5, h.ty + 0.5);
      v.x = isoX(h.tx + 0.5, h.ty + 0.5);
      v.y = (h.tx + 0.5 + h.ty + 0.5) * (TILE_H / 2) - gh * 14;
      v.zIndex = v.y;
      // 建造中：从地里长出来（back-out 缓动）
      const p = Math.min(1, h.buildProgress);
      const s = p < 1 ? backOut(p) * 0.62 : 0.62;
      spr.scale.set(s * (1 + h.level * 0.16));
      spr.alpha = 0.4 + p * 0.6;
      // 火焰
      let flame = (v as { _flame?: any })._flame;
      if (h.fireUntil > time) {
        if (!flame) {
          flame = new PIXI.Sprite(this.flameTex);
          flame.anchor.set(0.5, 1);
          flame.blendMode = 'add';
          (v as { _flame?: any })._flame = flame;
          v.addChild(flame);
        }
        flame.visible = true;
        flame.y = -8;
        flame.scale.set(0.8 + Math.sin(time * 23 + h.id) * 0.18, 1 + Math.sin(time * 31 + h.id) * 0.22);
        flame.alpha = 0.85 + Math.sin(time * 40) * 0.15;
      } else if (flame) flame.visible = false;
      // 祝福微光
      spr.tint = h.blessedUntil > time ? 0xffedb0 : 0xffffff;
    }
    for (const [id, v] of this.houseViews) if (!liveH.has(id)) { v.destroy({ children: true }); this.houseViews.delete(id); }

    // ── 军事建筑 ──
    const liveM = new Set<number>();
    for (const m of sim.mils) {
      liveM.add(m.id);
      let v = this.milViews.get(m.id);
      if (!v) {
        v = new PIXI.Container();
        const key = MIL_SPRITE[m.kind][m.faction === 0 ? 0 : 1];
        const spr = new PIXI.Sprite(PIXI.Texture.from(this.assets.sprites[key] as HTMLCanvasElement | HTMLImageElement));
        spr.anchor.set(0.5, 0.88);
        spr.scale.set(0);   // 落成动画
        v.addChild(spr);
        (v as { _spr?: unknown })._spr = spr;
        (v as { _born?: number })._born = time;
        this.milViews.set(m.id, v);
        this.container.addChild(v);
      }
      const spr = (v as { _spr: any })._spr;
      const born = (v as { _born: number })._born;
      const p = Math.min(1, (time - born) / 0.6);
      const baseScale = (m.kind === 'tower' ? 0.6 : 0.66);
      spr.scale.set(backOut(p) * baseScale);
      const gh = this.heightAt(m.tx + 0.5, m.ty + 0.5);
      v.x = isoX(m.tx + 0.5, m.ty + 0.5);
      v.y = (m.tx + 0.5 + m.ty + 0.5) * (TILE_H / 2) - gh * 14;
      v.zIndex = v.y;
      // 训练中：金光脉动
      spr.tint = m.traineeId >= 0 ? (Math.sin(time * 5) > 0 ? 0xffe8b0 : 0xffffff) : 0xffffff;
      spr.alpha = m.hp < 30 ? 0.6 + Math.sin(time * 9) * 0.15 : 1;
    }
    for (const [id, v] of this.milViews) if (!liveM.has(id)) { v.destroy({ children: true }); this.milViews.delete(id); }

    // ── 图腾 ──
    const liveT = new Set<number>();
    for (const t of sim.totems) {
      liveT.add(t.id);
      let v = this.totemViews.get(t.id);
      if (!v) {
        v = new PIXI.Container();
        const ring = new PIXI.Sprite(this.ringTex);
        ring.anchor.set(0.5);
        ring.blendMode = 'add';
        ring.tint = FACTION_TINT[t.faction];
        const spr = new PIXI.Sprite(PIXI.Texture.from(this.assets.sprites[t.faction === 0 ? 'totem_a' : 'totem_b'] as HTMLCanvasElement | HTMLImageElement));
        spr.anchor.set(0.5, 0.9);
        spr.scale.set(0.55);
        v.addChild(ring); v.addChild(spr);
        (v as { _ring?: any })._ring = ring;
        this.totemViews.set(t.id, v);
        this.container.addChild(v);
      }
      const gh = this.heightAt(t.x, t.y);
      v.x = isoX(t.x, t.y);
      v.y = (t.x + t.y) * (TILE_H / 2) - gh * 14;
      v.zIndex = v.y;
      const ring = (v as { _ring: any })._ring;
      const pulse = (time * 0.8) % 1;
      ring.scale.set(0.4 + pulse * 1.4);
      ring.alpha = (1 - pulse) * 0.5;
      ring.y = 4;
      // 剩余时间淡出提示
      v.alpha = Math.min(1, (t.until - time) / 5);
    }
    for (const [id, v] of this.totemViews) if (!liveT.has(id)) { v.destroy({ children: true }); this.totemViews.delete(id); }
  }
}

function backOut(t: number): number { const s = 1.4; const u = t - 1; return u * u * ((s + 1) * u + s) + 1; }

// 职业变体贴图：0信徒 1战士 2火法师 3传教士；faction 2 = 中立野人（灰褐）
function makeFollowerTexture(faction: number, cls = 0): any {
  const c = document.createElement('canvas');
  c.width = 24; c.height = 34;
  const g = c.getContext('2d')!;
  const cx = 12, base = 30;
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.beginPath(); g.ellipse(cx, base + 1, 7, 2.6, 0, 0, Math.PI * 2); g.fill();
  const wild = faction === 2;
  let robe = wild ? '#7a6a52' : faction === 0 ? '#3f8fa8' : '#a83f46';
  let robeD = wild ? '#5a4c3a' : faction === 0 ? '#2c6579' : '#7a2c32';
  if (cls === 2) { robe = faction === 0 ? '#2f6f9e' : '#8e3a20'; robeD = faction === 0 ? '#1c4a70' : '#5e2412'; }
  if (cls === 3) { robe = '#e8e2d2'; robeD = '#bcb49e'; }
  const grad = g.createLinearGradient(0, 10, 0, base);
  grad.addColorStop(0, robe); grad.addColorStop(1, robeD);
  g.fillStyle = grad;
  const wide = cls === 1 ? 2 : 0;   // 战士更壮
  g.beginPath(); g.moveTo(cx, 10); g.quadraticCurveTo(cx + 8 + wide, 16, cx + 5.5 + wide, base); g.lineTo(cx - 5.5 - wide, base); g.quadraticCurveTo(cx - 8 - wide, 16, cx, 10); g.fill();
  // 头
  g.fillStyle = '#e8c49a';
  g.beginPath(); g.arc(cx, 8.5, 4.4, 0, Math.PI * 2); g.fill();
  if (cls === 1) {
    // 战士：金属盔 + 肩甲 + 剑
    g.fillStyle = faction === 0 ? '#b8c8d8' : '#8a8078';
    g.beginPath(); g.arc(cx, 6.5, 4.6, Math.PI, 0); g.fill();
    g.fillRect(cx - 8 - wide, 13, 5, 4); g.fillRect(cx + 3 + wide, 13, 5, 4);
    g.strokeStyle = '#d8dce2'; g.lineWidth = 1.8;
    g.beginPath(); g.moveTo(cx + 8, 24); g.lineTo(cx + 12, 10); g.stroke();
    g.fillStyle = '#7a5a2a'; g.fillRect(cx + 7, 23, 3, 3);
  } else if (cls === 2) {
    // 火法师：兜帽 + 火杖
    g.fillStyle = robeD;
    g.beginPath(); g.arc(cx, 6, 4.8, Math.PI * 0.9, Math.PI * 0.1); g.fill();
    g.strokeStyle = '#6b4a2f'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(cx - 9, 27); g.lineTo(cx - 11, 6); g.stroke();
    g.fillStyle = '#ff9440';
    g.shadowColor = '#ff7020'; g.shadowBlur = 6;
    g.beginPath(); g.arc(cx - 11, 4.5, 2.8, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
  } else if (cls === 3) {
    // 传教士：白袍金环
    g.strokeStyle = '#d8b84a'; g.lineWidth = 1.4;
    g.beginPath(); g.arc(cx, 3.5, 3.4, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#f6f0e0';
    g.beginPath(); g.arc(cx, 5.5, 3.4, Math.PI, 0); g.fill();
  } else if (wild) {
    // 野人：乱发 + 骨饰
    g.fillStyle = '#4a3a28';
    g.beginPath(); g.arc(cx, 5.5, 4.2, Math.PI * 0.85, Math.PI * 0.15); g.fill();
    g.fillStyle = '#e8e0d0'; g.fillRect(cx - 3, 15, 6, 1.6);
  } else {
    g.fillStyle = faction === 0 ? '#dff3f8' : '#f8dfe0';
    g.beginPath(); g.arc(cx, 6, 3.2, Math.PI, 0); g.fill(); // 头巾
  }
  return PIXI.Texture.from(c);
}

function makeFlameTexture(): any {
  const c = document.createElement('canvas');
  c.width = 48; c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(24, 46, 4, 24, 40, 34);
  grad.addColorStop(0, 'rgba(255,240,160,0.95)');
  grad.addColorStop(0.4, 'rgba(255,150,40,0.8)');
  grad.addColorStop(0.8, 'rgba(200,50,10,0.3)');
  grad.addColorStop(1, 'rgba(120,20,0,0)');
  g.fillStyle = grad;
  g.beginPath(); g.moveTo(24, 0); g.quadraticCurveTo(46, 34, 24, 62); g.quadraticCurveTo(2, 34, 24, 0); g.fill();
  return PIXI.Texture.from(c);
}

function makeRingTexture(): any {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 5;
  g.beginPath(); g.ellipse(64, 32, 58, 26, 0, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 12;
  g.beginPath(); g.ellipse(64, 32, 52, 22, 0, 0, Math.PI * 2); g.stroke();
  return PIXI.Texture.from(c);
}
