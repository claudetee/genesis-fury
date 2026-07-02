// 世界地形：129×129 角点高度场 + 瓦片分类 + 覆盖层（沼泽/岩浆/焦土）+ 神迹形变
import { MAP, CORNERS, H_MAX, WATER_LEVEL, SNOW_H } from '../core/const';
import { Rng, fbm, hash2 } from '../core/rng';
import { EventBus } from '../core/events';

export const enum TileType { Deep = 0, Shallow = 1, Sand = 2, Grass = 3, Rock = 4, Snow = 5, Lava = 6 }

export interface SpawnPoint { x: number; y: number }

export class World {
  heights: Uint8Array;             // 角点高度 (CORNERS²)
  rockified: Uint8Array;           // 瓦片：火山永久荒岩
  scorched: Uint8Array;            // 瓦片：焦痕（视觉）
  swampUntil: Float32Array;        // 瓦片：沼泽结束 sim 时间
  lavaUntil: Float32Array;         // 瓦片：岩浆结束 sim 时间
  waterLevel: number = WATER_LEVEL;
  baseWaterLevel: number = WATER_LEVEL;
  seed: number;
  spawns: SpawnPoint[] = [];
  private bus: EventBus;

  constructor(bus: EventBus, seed: number, generate = true) {
    this.bus = bus;
    this.seed = seed;
    this.heights = new Uint8Array(CORNERS * CORNERS);
    this.rockified = new Uint8Array(MAP * MAP);
    this.scorched = new Uint8Array(MAP * MAP);
    this.swampUntil = new Float32Array(MAP * MAP);
    this.lavaUntil = new Float32Array(MAP * MAP);
    if (generate) this.generate();
    else this.spawns = [{ x: 30, y: 64 }, { x: 98, y: 64 }];
  }

  // ── 生成 ────────────────────────────────────────────
  private generate(): void {
    const rng = new Rng(this.seed);
    const off1 = rng.range(0, 1000), off2 = rng.range(0, 1000);
    for (let cy = 0; cy < CORNERS; cy++) {
      for (let cx = 0; cx < CORNERS; cx++) {
        const nx = cx / CORNERS, ny = cy / CORNERS;
        // 中央大陆掩膜：边缘沉入海洋
        const dx = nx - 0.5, dy = ny - 0.5;
        const d = Math.sqrt(dx * dx + dy * dy) * 2;
        const mask = Math.max(0, 1 - Math.pow(d, 2.2));
        let h = fbm(nx * 6 + off1, ny * 6 + off2, this.seed, 5);
        h = (h - 0.34) * 1.7 * mask + mask * 0.3;
        // 山脊（收敛幅度，雪峰只留极高处）
        const ridge = 1 - Math.abs(fbm(nx * 3.5 + off2, ny * 3.5 + off1, this.seed + 77, 3) * 2 - 1);
        h += ridge * ridge * 0.34 * mask * Math.max(0, h);
        this.heights[cy * CORNERS + cx] = Math.max(0, Math.min(H_MAX, Math.round(h * H_MAX)));
      }
    }
    // 一次平滑：去掉量化噪声造成的孤立尖角（避免草原上散落碎岩）
    const smoothed = new Uint8Array(this.heights);
    for (let cy = 1; cy < CORNERS - 1; cy++) {
      for (let cx = 1; cx < CORNERS - 1; cx++) {
        const i = cy * CORNERS + cx;
        const sum = this.heights[i] * 4 + this.heights[i - 1] + this.heights[i + 1] + this.heights[i - CORNERS] + this.heights[i + CORNERS];
        smoothed[i] = Math.round(sum / 8);
      }
    }
    this.heights = smoothed;
    // 双方出生高原（对称公平）
    this.spawns = [{ x: 30, y: 64 }, { x: 98, y: 64 }];
    for (const s of this.spawns) this.flattenPlateau(s.x, s.y, 9, WATER_LEVEL + 2);
  }

  private flattenPlateau(px: number, py: number, r: number, h: number): void {
    for (let cy = Math.max(0, py - r); cy <= Math.min(CORNERS - 1, py + r); cy++) {
      for (let cx = Math.max(0, px - r); cx <= Math.min(CORNERS - 1, px + r); cx++) {
        const d = Math.sqrt((cx - px) ** 2 + (cy - py) ** 2);
        if (d <= r * 0.62) this.heights[cy * CORNERS + cx] = h;
        else if (d <= r) {
          const t = (d - r * 0.62) / (r * 0.38);
          const cur = this.heights[cy * CORNERS + cx];
          this.heights[cy * CORNERS + cx] = Math.round(h * (1 - t) + cur * t);
        }
      }
    }
  }

  // ── 查询 ────────────────────────────────────────────
  cornerH(cx: number, cy: number): number {
    cx = Math.max(0, Math.min(CORNERS - 1, cx)); cy = Math.max(0, Math.min(CORNERS - 1, cy));
    return this.heights[cy * CORNERS + cx];
  }

  /** 任意浮点位置的双线性插值高度（tile 坐标系） */
  heightAt(x: number, y: number): number {
    const xi = Math.max(0, Math.min(MAP - 1, Math.floor(x)));
    const yi = Math.max(0, Math.min(MAP - 1, Math.floor(y)));
    const xf = Math.max(0, Math.min(1, x - xi)), yf = Math.max(0, Math.min(1, y - yi));
    const a = this.cornerH(xi, yi), b = this.cornerH(xi + 1, yi);
    const c = this.cornerH(xi, yi + 1), d = this.cornerH(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  }

  tileMinH(tx: number, ty: number): number {
    return Math.min(this.cornerH(tx, ty), this.cornerH(tx + 1, ty), this.cornerH(tx, ty + 1), this.cornerH(tx + 1, ty + 1));
  }
  tileMaxH(tx: number, ty: number): number {
    return Math.max(this.cornerH(tx, ty), this.cornerH(tx + 1, ty), this.cornerH(tx, ty + 1), this.cornerH(tx + 1, ty + 1));
  }
  tileAvgH(tx: number, ty: number): number {
    return (this.cornerH(tx, ty) + this.cornerH(tx + 1, ty) + this.cornerH(tx, ty + 1) + this.cornerH(tx + 1, ty + 1)) / 4;
  }

  tileType(tx: number, ty: number, simTime = Infinity): TileType {
    if (tx < 0 || ty < 0 || tx >= MAP || ty >= MAP) return TileType.Deep;
    const i = ty * MAP + tx;
    if (this.lavaUntil[i] > simTime) return TileType.Lava;
    const min = this.tileMinH(tx, ty), max = this.tileMaxH(tx, ty), avg = this.tileAvgH(tx, ty);
    if (max <= this.waterLevel) return avg < this.waterLevel - 1 ? TileType.Deep : TileType.Shallow;
    if (this.rockified[i]) return TileType.Rock;
    if (min < this.waterLevel || avg <= this.waterLevel + 0.6) return TileType.Sand;
    if (max - min >= 3) return TileType.Rock;
    if (avg >= SNOW_H) return TileType.Snow;
    return TileType.Grass;
  }

  isWater(tx: number, ty: number): boolean {
    return this.tileMaxH(tx, ty) <= this.waterLevel;
  }
  isSwamp(tx: number, ty: number, simTime: number): boolean {
    if (tx < 0 || ty < 0 || tx >= MAP || ty >= MAP) return false;
    return this.swampUntil[ty * MAP + tx] > simTime;
  }
  isLava(tx: number, ty: number, simTime: number): boolean {
    if (tx < 0 || ty < 0 || tx >= MAP || ty >= MAP) return false;
    return this.lavaUntil[ty * MAP + tx] > simTime;
  }

  /** 可建造：四角等高、高于水面、非沼泽/岩浆/荒岩 */
  isBuildable(tx: number, ty: number, simTime: number): boolean {
    if (tx < 1 || ty < 1 || tx >= MAP - 1 || ty >= MAP - 1) return false;
    const h = this.cornerH(tx, ty);
    if (h <= this.waterLevel) return false;
    if (this.cornerH(tx + 1, ty) !== h || this.cornerH(tx, ty + 1) !== h || this.cornerH(tx + 1, ty + 1) !== h) return false;
    const i = ty * MAP + tx;
    if (this.rockified[i]) return false;
    if (this.swampUntil[i] > simTime || this.lavaUntil[i] > simTime) return false;
    return this.tileAvgH(tx, ty) < SNOW_H;
  }

  /** 5×5 邻域平地数 → 房屋等级上限依据 */
  flatCount5x5(tx: number, ty: number, simTime: number): number {
    let n = 0;
    for (let y = ty - 2; y <= ty + 2; y++)
      for (let x = tx - 2; x <= tx + 2; x++)
        if (this.isBuildable(x, y, simTime)) n++;
    return n;
  }

  /** 通行成本：水/岩浆不可走 */
  isWalkable(tx: number, ty: number, simTime: number): boolean {
    if (tx < 0 || ty < 0 || tx >= MAP || ty >= MAP) return false;
    if (this.isWater(tx, ty)) return false;
    if (this.isLava(tx, ty, simTime)) return false;
    return this.tileMaxH(tx, ty) - this.tileMinH(tx, ty) <= 4;
  }

  // ── 形变 ────────────────────────────────────────────
  /** 高斯衰减笔刷 ±1（dir=+1 隆起 / −1 沉降），返回受影响瓦片范围 */
  brush(cx: number, cy: number, dir: number, radius: number): void {
    const r = Math.ceil(radius);
    for (let y = Math.max(0, cy - r); y <= Math.min(CORNERS - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(CORNERS - 1, cx + r); x++) {
        const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (d > radius) continue;
        const w = Math.exp(-(d * d) / (radius * 0.85));
        const delta = dir * (w > 0.32 ? 1 : 0);
        if (delta === 0) continue;
        const i = y * CORNERS + x;
        this.heights[i] = Math.max(0, Math.min(H_MAX, this.heights[i] + delta));
      }
    }
    this.enforceMaxSlope(cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2);
    this.emitTerrainChanged(cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2);
  }

  /** 地震：区域高度随机抖动 */
  quake(cx: number, cy: number, radius: number, rng: Rng): void {
    const r = Math.ceil(radius);
    for (let y = Math.max(0, cy - r); y <= Math.min(CORNERS - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(CORNERS - 1, cx + r); x++) {
        const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (d > radius) continue;
        const i = y * CORNERS + x;
        const jitter = rng.int(-2, 2) * (1 - d / radius);
        this.heights[i] = Math.max(0, Math.min(H_MAX, this.heights[i] + Math.round(jitter)));
      }
    }
    this.enforceMaxSlope(cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2);
    this.emitTerrainChanged(cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2);
  }

  /** 火山：岩锥隆起 + 区域永久荒岩 + 岩浆 */
  volcano(cx: number, cy: number, radius: number, simTime: number): void {
    const r = Math.ceil(radius);
    const peak = Math.min(H_MAX, this.cornerH(cx, cy) + 6);
    for (let y = Math.max(0, cy - r); y <= Math.min(CORNERS - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(CORNERS - 1, cx + r); x++) {
        const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (d > radius) continue;
        const t = 1 - d / radius;
        const i = y * CORNERS + x;
        const target = Math.round(this.waterLevel + 1 + (peak - this.waterLevel - 1) * t * t);
        this.heights[i] = Math.max(this.heights[i], Math.min(H_MAX, target));
      }
    }
    for (let ty = Math.max(0, cy - r); ty < Math.min(MAP, cy + r); ty++) {
      for (let tx = Math.max(0, cx - r); tx < Math.min(MAP, cx + r); tx++) {
        const d = Math.sqrt((tx + 0.5 - cx) ** 2 + (ty + 0.5 - cy) ** 2);
        if (d > radius) continue;
        const i = ty * MAP + tx;
        this.rockified[i] = 1;
        if (d < radius * 0.7) this.lavaUntil[i] = simTime + 14;
        this.scorched[i] = 1;
      }
    }
    this.enforceMaxSlope(cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2);
    this.emitTerrainChanged(cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2);
  }

  swamp(cx: number, cy: number, radius: number, until: number): void {
    for (let ty = Math.max(0, Math.floor(cy - radius)); ty <= Math.min(MAP - 1, Math.ceil(cy + radius)); ty++)
      for (let tx = Math.max(0, Math.floor(cx - radius)); tx <= Math.min(MAP - 1, Math.ceil(cx + radius)); tx++) {
        const d = Math.sqrt((tx + 0.5 - cx) ** 2 + (ty + 0.5 - cy) ** 2);
        if (d <= radius && !this.isWater(tx, ty)) this.swampUntil[ty * MAP + tx] = until;
      }
    this.emitTerrainChanged(cx - radius, cy - radius, cx + radius, cy + radius);
  }

  clearSwamp(cx: number, cy: number, radius: number): void {
    for (let ty = Math.max(0, Math.floor(cy - radius)); ty <= Math.min(MAP - 1, Math.ceil(cy + radius)); ty++)
      for (let tx = Math.max(0, Math.floor(cx - radius)); tx <= Math.min(MAP - 1, Math.ceil(cx + radius)); tx++) {
        const d = Math.sqrt((tx + 0.5 - cx) ** 2 + (ty + 0.5 - cy) ** 2);
        if (d <= radius) this.swampUntil[ty * MAP + tx] = 0;
      }
    this.emitTerrainChanged(cx - radius, cy - radius, cx + radius, cy + radius);
  }

  setWaterLevel(level: number): void {
    this.waterLevel = level;
    this.bus.emit('waterChanged', { level });
    this.emitTerrainChanged(0, 0, MAP, MAP);
  }

  /** 限坡：相邻角点高差 ≤4，防形变出撕裂尖刺（扩散抹平） */
  private enforceMaxSlope(x0: number, y0: number, x1: number, y1: number): void {
    const MAXD = 4;
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (let y = Math.max(0, y0); y <= Math.min(CORNERS - 1, y1); y++) {
        for (let x = Math.max(0, x0); x <= Math.min(CORNERS - 1, x1); x++) {
          const i = y * CORNERS + x;
          const h = this.heights[i];
          const nbs = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
          for (const [nx, ny] of nbs) {
            if (nx < 0 || ny < 0 || nx >= CORNERS || ny >= CORNERS) continue;
            const j = ny * CORNERS + nx;
            if (this.heights[j] - h > MAXD) { this.heights[j] = h + MAXD; changed = true; }
          }
        }
      }
      if (!changed) break;
    }
  }

  private emitTerrainChanged(x0: number, y0: number, x1: number, y1: number): void {
    this.bus.emit('terrainChanged', {
      x0: Math.max(0, Math.floor(x0)), y0: Math.max(0, Math.floor(y0)),
      x1: Math.min(MAP, Math.ceil(x1)), y1: Math.min(MAP, Math.ceil(y1)),
    });
  }

  /** 瓦片视觉变化哈希（渲染用变体选择） */
  tileHash(tx: number, ty: number): number { return hash2(tx, ty, this.seed); }

  // ── 存档 ────────────────────────────────────────────
  serialize(): WorldSave {
    return {
      seed: this.seed,
      h: rle(this.heights), rock: rle(this.rockified), scorch: rle(this.scorched),
      wl: this.baseWaterLevel,
      sw: sparse(this.swampUntil), lv: sparse(this.lavaUntil),
    };
  }
  static deserialize(bus: EventBus, d: WorldSave): World {
    const w = new World(bus, d.seed, false);
    unrle(d.h, w.heights); unrle(d.rock, w.rockified); unrle(d.scorch, w.scorched);
    w.baseWaterLevel = d.wl; w.waterLevel = d.wl;
    if (d.sw) unsparse(d.sw, w.swampUntil);
    if (d.lv) unsparse(d.lv, w.lavaUntil);
    return w;
  }
}

export interface WorldSave {
  seed: number; h: string; rock: string; scorch: string; wl: number;
  sw?: number[]; lv?: number[];   // 稀疏 [idx,until,idx,until,...]（沼泽/岩浆限时覆盖层）
}

// 稀疏编码限时覆盖层（活跃格通常极少）
function sparse(a: Float32Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] > 0) out.push(i, Math.round(a[i] * 10) / 10);
  return out;
}
function unsparse(s: number[], target: Float32Array): void {
  for (let i = 0; i + 1 < s.length; i += 2) target[s[i]] = s[i + 1];
}

// 简单 RLE + base64（高度场大片同值，压得很小）
function rle(a: Uint8Array): string {
  const out: number[] = [];
  let i = 0;
  while (i < a.length) {
    const v = a[i]; let n = 1;
    while (i + n < a.length && a[i + n] === v && n < 255) n++;
    out.push(n, v); i += n;
  }
  let s = '';
  for (let j = 0; j < out.length; j += 4096) s += String.fromCharCode(...out.slice(j, j + 4096));
  return btoa(s);
}
function unrle(s: string, target: Uint8Array): void {
  const bin = atob(s);
  let ti = 0;
  for (let i = 0; i < bin.length; i += 2) {
    const n = bin.charCodeAt(i), v = bin.charCodeAt(i + 1);
    target.fill(v, ti, ti + n); ti += n;
  }
}
