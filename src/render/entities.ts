// 实体视图层：以 sim 为唯一事实源做逐帧 diff 同步（新建/更新/移除），
// 信徒位置用上一 tick→当前 tick 插值，60fps 平滑。zIndex = 屏幕 Y 画家排序。
import { TILE_H } from '../core/const';
import { Sim } from '../sim/sim';
import { FState } from '../sim/entities';
import { AssetDb } from '../assets/loader';
import { isoX } from './camera';

const FACTION_TINT = [0x9fe8ff, 0xffb3ad];

export class EntityRenderer {
  container: any;
  private sim: Sim;
  private assets: AssetDb;
  private followerViews = new Map<number, any>();
  private houseViews = new Map<number, any>();
  private totemViews = new Map<number, any>();
  private followerTex: any[];
  private flameTex: any;
  private ringTex: any;
  private heightAt: (x: number, y: number) => number;

  constructor(sim: Sim, assets: AssetDb, heightAt: (x: number, y: number) => number) {
    this.sim = sim; this.assets = assets; this.heightAt = heightAt;
    this.container = new PIXI.Container();
    this.container.sortableChildren = true;
    this.followerTex = [makeFollowerTexture(0), makeFollowerTexture(1)];
    this.flameTex = makeFlameTexture();
    this.ringTex = makeRingTexture();
  }

  sync(alpha: number, time: number): void {
    const sim = this.sim;
    // ── 信徒 ──
    const liveF = new Set<number>();
    for (const f of sim.followers) {
      liveF.add(f.id);
      let v = this.followerViews.get(f.id);
      if (!v) {
        v = new PIXI.Sprite(this.followerTex[f.faction]);
        v.anchor.set(0.5, 0.92);
        this.followerViews.set(f.id, v);
        this.container.addChild(v);
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

function makeFollowerTexture(faction: number): any {
  const c = document.createElement('canvas');
  c.width = 22; c.height = 30;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.beginPath(); g.ellipse(11, 27, 7, 2.6, 0, 0, Math.PI * 2); g.fill();
  const robe = faction === 0 ? '#3f8fa8' : '#a83f46';
  const robeD = faction === 0 ? '#2c6579' : '#7a2c32';
  const grad = g.createLinearGradient(0, 8, 0, 27);
  grad.addColorStop(0, robe); grad.addColorStop(1, robeD);
  g.fillStyle = grad;
  g.beginPath(); g.moveTo(11, 8); g.quadraticCurveTo(19, 14, 16.5, 26); g.lineTo(5.5, 26); g.quadraticCurveTo(3, 14, 11, 8); g.fill();
  g.fillStyle = '#e8c49a';
  g.beginPath(); g.arc(11, 6.5, 4.4, 0, Math.PI * 2); g.fill();
  g.fillStyle = faction === 0 ? '#dff3f8' : '#f8dfe0';
  g.beginPath(); g.arc(11, 4, 3.2, Math.PI, 0); g.fill(); // 头巾
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
