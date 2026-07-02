// 小地图：双层 canvas（地形层按需重绘 / 实体层 3Hz），点击/拖拽跳转镜头
import { MAP, TILE_W, TILE_H } from '../core/const';
import { Sim } from '../sim/sim';
import { TileType } from '../sim/world';
import { Camera, isoX, isoY } from './camera';

const TYPE_RGB: Record<number, number> = {
  [TileType.Deep]: 0x17364e, [TileType.Shallow]: 0x265d7d, [TileType.Sand]: 0xc2a76b,
  [TileType.Grass]: 0x4d7c33, [TileType.Rock]: 0x77705f, [TileType.Snow]: 0xdfe5ee, [TileType.Lava]: 0xc33d10,
};

export class Minimap {
  private base: HTMLCanvasElement;
  private view: HTMLCanvasElement;
  private sim: Sim;
  private cam: Camera;
  private terrainDirty = true;
  private entTimer = 0;

  constructor(viewCanvas: HTMLCanvasElement, sim: Sim, cam: Camera) {
    this.view = viewCanvas;
    this.view.width = MAP; this.view.height = MAP;
    this.base = document.createElement('canvas');
    this.base.width = MAP; this.base.height = MAP;
    this.sim = sim; this.cam = cam;
    let down = false;
    const jump = (e: PointerEvent) => {
      const r = this.view.getBoundingClientRect();
      const tx = (e.clientX - r.left) / r.width * MAP;
      const ty = (e.clientY - r.top) / r.height * MAP;
      this.cam.centerOnTile(tx, ty);
    };
    // #minimap 是持久 DOM，每局新 Minimap 实例 → onpointerXXX 赋值（幂等）防监听器跨局累积
    this.view.onpointerdown = (e) => { down = true; this.view.setPointerCapture(e.pointerId); jump(e); };
    this.view.onpointermove = (e) => { if (down) jump(e); };
    this.view.onpointerup = () => { down = false; };
  }

  markTerrainDirty(): void { this.terrainDirty = true; }

  update(dt: number): void {
    this.entTimer -= dt;
    if (this.sim.time >= this.nextExpiry) this.terrainDirty = true;   // 覆盖层到期自愈
    if (this.terrainDirty) { this.redrawTerrain(); this.terrainDirty = false; this.entTimer = 0; }
    if (this.entTimer <= 0) { this.entTimer = 0.33; this.redrawEntities(); }
  }

  private img: ImageData | null = null;
  private nextExpiry = Infinity;   // 沼泽/岩浆最近到期 → 到点自动重绘
  private redrawTerrain(): void {
    const g = this.base.getContext('2d')!;
    if (!this.img) this.img = g.createImageData(MAP, MAP);
    const d = this.img.data;
    const w = this.sim.world, t = this.sim.time;
    let nextExp = Infinity;
    for (let y = 0; y < MAP; y++)
      for (let x = 0; x < MAP; x++) {
        const ti = y * MAP + x;
        const su = w.swampUntil[ti], lu = w.lavaUntil[ti];
        if (su > t && su < nextExp) nextExp = su;
        if (lu > t && lu < nextExp) nextExp = lu;
        const c = su > t ? 0x42502c : TYPE_RGB[w.tileType(x, y, t)];
        const i = ti * 4;
        d[i] = c >> 16; d[i + 1] = (c >> 8) & 0xff; d[i + 2] = c & 0xff; d[i + 3] = 255;
      }
    this.nextExpiry = nextExp;
    g.putImageData(this.img, 0, 0);
  }

  private redrawEntities(): void {
    const g = this.view.getContext('2d')!;
    g.clearRect(0, 0, MAP, MAP);
    g.drawImage(this.base, 0, 0);
    for (const h of this.sim.houses) {
      g.fillStyle = h.faction === 0 ? '#6fe3ff' : '#ff7a70';
      g.fillRect(h.tx - 1, h.ty - 1, 3, 3);
    }
    for (const f of this.sim.followers) {
      g.fillStyle = f.faction === 0 ? '#c8f2ff' : '#ffc9c4';
      g.fillRect(Math.floor(f.x), Math.floor(f.y), 1, 1);
    }
    for (const tt of this.sim.totems) {
      g.strokeStyle = tt.faction === 0 ? '#6fe3ff' : '#ff7a70';
      g.strokeRect(tt.x - 2.5, tt.y - 2.5, 5, 5);
    }
    // 视口四边形（世界像素 → tile 逆投影）
    g.strokeStyle = 'rgba(255,232,160,0.9)';
    g.lineWidth = 1;
    g.beginPath();
    const corners = [
      this.cam.screenToWorld(0, 0), this.cam.screenToWorld(this.cam.viewW, 0),
      this.cam.screenToWorld(this.cam.viewW, this.cam.viewH), this.cam.screenToWorld(0, this.cam.viewH),
    ];
    corners.forEach((c, i) => {
      const u = c.x / (TILE_W / 2), v = c.y / (TILE_H / 2);
      const tx = (u + v) / 2, ty = (v - u) / 2;
      if (i === 0) g.moveTo(tx, ty); else g.lineTo(tx, ty);
    });
    g.closePath(); g.stroke();
  }
}
// isoX/isoY 引入保持 API 对齐（视口投影用逆变换）
void isoX; void isoY;
