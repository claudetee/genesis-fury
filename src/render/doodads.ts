// 装饰层：树木/岩石/花丛按确定性噪声撒布在草地/沙地上，
// 与实体同容器画家排序；地形变化/建筑落成时局部重算（砍树）。
import { MAP, TILE_H, H_STEP } from '../core/const';
import { World, TileType } from '../sim/world';
import { Sim } from '../sim/sim';
import { AssetDb } from '../assets/loader';
import { EventBus } from '../core/events';
import { hash2 } from '../core/rng';
import { isoX } from './camera';

const GRASS_KINDS = ['tree_oak', 'tree_pine', 'tree_oak', 'tree_pine', 'tree_oak', 'bush_flower', 'rock_big', 'rock_small', 'tree_pine', 'tree_oak', 'bush_flower', 'mushroom'];
const SAND_KINDS = ['tree_palm', 'rock_small', 'reeds', 'reeds'];
const DENSITY_GRASS = 0.13;
const DENSITY_SAND = 0.06;
const KIND_SCALE: Record<string, number> = { mushroom: 0.4, rock_small: 0.7, bush_flower: 0.8, reeds: 0.75 };

interface Doodad { spr: any; tx: number; ty: number }

export class DoodadRenderer {
  private byTile = new Map<number, Doodad>();
  private world: World;
  private sim: Sim;
  private assets: AssetDb;
  private container: any;

  constructor(sim: Sim, assets: AssetDb, container: any, bus: EventBus, heightAt: (x: number, y: number) => number) {
    this.sim = sim; this.world = sim.world; this.assets = assets; this.container = container;
    this.heightAt = heightAt;
    for (let ty = 0; ty < MAP; ty++)
      for (let tx = 0; tx < MAP; tx++) this.evalTile(tx, ty);
    bus.on('terrainChanged', (e) => {
      for (let ty = Math.max(0, e.y0 - 1); ty <= Math.min(MAP - 1, e.y1 + 1); ty++)
        for (let tx = Math.max(0, e.x0 - 1); tx <= Math.min(MAP - 1, e.x1 + 1); tx++) this.evalTile(tx, ty);
    });
    bus.on('waterChanged', () => { for (const [k] of this.byTile) this.evalTile(k % MAP, (k / MAP) | 0); });
    // 建筑落成 → 清 1 格内装饰（砍树腾地）
    bus.on('entitySpawn', (e) => {
      if (e.kind !== 'house' && e.kind !== 'mil') return;
      const cx = Math.floor(e.x), cy = Math.floor(e.y);
      for (let ty = cy - 1; ty <= cy + 1; ty++)
        for (let tx = cx - 1; tx <= cx + 1; tx++) this.remove(tx, ty);
    });
  }
  private heightAt: (x: number, y: number) => number;

  private remove(tx: number, ty: number): void {
    const key = ty * MAP + tx;
    const d = this.byTile.get(key);
    if (d) { d.spr.destroy(); this.byTile.delete(key); }
  }

  private evalTile(tx: number, ty: number): void {
    const key = ty * MAP + tx;
    const existing = this.byTile.get(key);
    const type = this.world.tileType(tx, ty, 0);
    const grass = type === TileType.Grass, sand = type === TileType.Sand;
    const h = hash2(tx, ty, this.world.seed + 991);
    const density = grass ? DENSITY_GRASS : sand ? DENSITY_SAND : 0;
    const want = h < density
      && this.occupiedBy(tx, ty) < 0
      && !this.world.rockified[key]
      && this.world.tileMaxH(tx, ty) - this.world.tileMinH(tx, ty) <= 1;
    if (!want) { if (existing) this.remove(tx, ty); return; }
    if (existing) { this.reposition(existing); return; }
    const kinds = grass ? GRASS_KINDS : SAND_KINDS;
    const kind = kinds[Math.floor(hash2(tx, ty, this.world.seed + 41) * kinds.length)];
    const img = this.assets.sprites[kind];
    if (!img) return;
    const spr = new PIXI.Sprite(PIXI.Texture.from(img as HTMLCanvasElement | HTMLImageElement));
    spr.anchor.set(0.5, 0.92);
    const s = (0.42 + hash2(tx, ty, 7) * 0.3) * (KIND_SCALE[kind] ?? 1);
    spr.scale.set(hash2(tx, ty, 13) > 0.5 ? s : -s, s);   // 随机镜像
    this.container.addChild(spr);
    const d: Doodad = { spr, tx, ty };
    this.byTile.set(key, d);
    this.reposition(d);
  }

  private occupiedBy(tx: number, ty: number): number {
    return this.sim.occupancy[ty * MAP + tx];
  }

  private reposition(d: Doodad): void {
    const ox = 0.2 + hash2(d.tx, d.ty, 23) * 0.6;
    const oy = 0.2 + hash2(d.tx, d.ty, 29) * 0.6;
    const x = d.tx + ox, y = d.ty + oy;
    const h = this.heightAt(x, y);
    d.spr.x = isoX(x, y);
    d.spr.y = (x + y) * (TILE_H / 2) - h * H_STEP;
    d.spr.zIndex = d.spr.y;
  }

  /** 地形显示高度动画期间贴地 */
  refreshHeights(x0: number, y0: number, x1: number, y1: number): void {
    for (const d of this.byTile.values())
      if (d.tx >= x0 - 1 && d.tx <= x1 + 1 && d.ty >= y0 - 1 && d.ty <= y1 + 1) this.reposition(d);
  }
}
