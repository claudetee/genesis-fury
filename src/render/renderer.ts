// 渲染编排：Pixi Application + 层级（地形→实体→世界FX→云影→屏幕FX→暗角），
// 相机应用、事件接线、fps 统计。DOM HUD 在 canvas 之上独立存在。
import { EventBus } from '../core/events';
import { Sim } from '../sim/sim';
import { AssetDb } from '../assets/loader';
import { Camera } from './camera';
import { TerrainRenderer } from './terrainMesh';
import { EntityRenderer } from './entities';
import { FxRenderer } from './fx';
import { Minimap } from './minimap';
import { DoodadRenderer } from './doodads';

export class Renderer {
  app: any;
  camera!: Camera;
  terrain!: TerrainRenderer;
  entities!: EntityRenderer;
  fx!: FxRenderer;
  minimap: Minimap | null = null;
  doodads: DoodadRenderer | null = null;
  fps = 60;
  private nightOverlay: any;
  private fpsAcc = 0; private fpsN = 0;
  private worldC: any;
  private clouds: { spr: any; vx: number }[] = [];
  private sim: Sim;
  private bus: EventBus;
  private assets: AssetDb;

  constructor(sim: Sim, bus: EventBus, assets: AssetDb) {
    this.sim = sim; this.bus = bus; this.assets = assets;
  }

  async init(host: HTMLElement): Promise<void> {
    this.app = new PIXI.Application();
    await this.app.init({
      background: '#0a0f16',
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      resizeTo: host,
    });
    host.appendChild(this.app.canvas);
    this.app.canvas.id = 'game-canvas';
    this.app.canvas.style.touchAction = 'none';

    const sim = this.sim;
    this.camera = new Camera((x, y) => this.terrain ? this.terrain.displayHeightAt(x, y) : sim.world.heightAt(x, y));
    this.camera.resize(this.app.screen.width, this.app.screen.height);

    this.worldC = new PIXI.Container();
    this.terrain = new TerrainRenderer(sim.world, this.assets, () => sim.time);
    this.entities = new EntityRenderer(sim, this.assets, (x, y) => Math.max(this.terrain.displayHeightAt(x, y), (this.terrain as unknown as { dispWL?: number }).dispWL ?? sim.world.waterLevel));
    this.fx = new FxRenderer(this.bus, (x, y) => this.terrain.displayHeightAt(x, y), () => ({ w: this.app.screen.width, h: this.app.screen.height }));

    this.fx.world.sortableChildren = true;

    this.worldC.addChild(this.terrain.container);
    this.worldC.addChild(this.entities.container);
    this.worldC.addChild(this.fx.world);
    this.app.stage.addChild(this.worldC);

    // 装饰层：与实体同容器 → 树/单位/建筑统一画家排序
    this.doodads = new DoodadRenderer(sim, this.assets, this.entities.container, this.bus,
      (x, y) => this.terrain.displayHeightAt(x, y));
    this.bus.on('terrainChanged', (e) => {
      // 形变动画结束后（缓动收敛需要几帧），补一次贴地；teardown 后 doodads 置 null 自弃
      setTimeout(() => { if (!this.fx?.dead) this.doodads?.refreshHeights(e.x0, e.y0, e.x1, e.y1); }, 600);
    });

    // 云影（低频漂移，god view 氛围）
    for (let i = 0; i < 5; i++) {
      const spr = new PIXI.Sprite(cloudTexture(i));
      spr.anchor.set(0.5);
      spr.alpha = 0.10;
      spr.tint = 0x0a1420;
      spr.position.set((Math.random() - 0.2) * 4000, Math.random() * 3000);
      spr.scale.set(2.2 + Math.random() * 2.5);
      this.worldC.addChild(spr);
      this.clouds.push({ spr, vx: 12 + Math.random() * 14 });
    }

    this.app.stage.addChild(this.fx.screen);

    // 昼夜光照循环（multiply 全屏染色，4 分钟一昼夜）
    this.nightOverlay = new PIXI.Graphics();
    this.nightOverlay.rect(0, 0, 4, 4).fill(0xffffff);
    this.nightOverlay.blendMode = 'multiply';
    this.app.stage.addChild(this.nightOverlay);

    // 暗角
    const vig = new PIXI.Sprite(vignetteTexture());
    vig.alpha = 0.55;
    this.app.stage.addChild(vig);
    const fitVig = () => {
      vig.width = this.app.screen.width; vig.height = this.app.screen.height;
      this.nightOverlay.width = this.app.screen.width; this.nightOverlay.height = this.app.screen.height;
    };
    fitVig();

    this.app.renderer.on('resize', () => {
      this.camera.resize(this.app.screen.width, this.app.screen.height);
      fitVig();
    });

    // 事件接线：地形变化 → chunk 标脏 + 小地图
    this.bus.on('terrainChanged', (e) => {
      this.terrain.markDirty(e.x0, e.y0, e.x1, e.y1);
      this.minimap?.markTerrainDirty();
    });
    this.bus.on('waterChanged', () => { this.terrain.markWaterAffected(); this.minimap?.markTerrainDirty(); });
    this.bus.on('quakeShake', (e) => {
      // 距离衰减震屏
      const c = this.camera.pickTile(this.camera.viewW / 2, this.camera.viewH / 2);
      const d = Math.sqrt((c.x - e.x) ** 2 + (c.y - e.y) ** 2);
      this.camera.shake(e.power * Math.max(0.15, 1 - d / 60));
    });

    // 开局镜头对准玩家出生地
    const sp = sim.world.spawns[0];
    this.camera.centerOnTile(sp.x, sp.y, true);
    this.camera.tzoom = 1.05;
  }

  attachMinimap(canvas: HTMLCanvasElement): void {
    this.minimap = new Minimap(canvas, this.sim, this.camera);
  }

  /** 每帧：dt=渲染帧时长，alpha=sim 插值系数 */
  update(dt: number, alpha: number, time: number): void {
    this.camera.update(dt);
    this.camera.apply(this.worldC);
    this.terrain.update(dt, time, this.camera.viewport());
    this.entities.sync(alpha, this.sim.time);
    this.fx.update(dt);
    this.minimap?.update(dt);
    for (const c of this.clouds) {
      c.spr.x += c.vx * dt;
      if (c.spr.x > 5200) c.spr.x = -1200;
    }
    // 昼夜：simTime 240s 一循环。正午纯白 → 黄昏暖金 → 夜深蓝 → 黎明
    {
      const phase = (this.sim.time % 240) / 240;           // 0=正午
      const night = Math.max(0, Math.sin((phase - 0.25) * Math.PI * 2)); // 0.25~0.75 入夜
      const dusk = Math.max(0, Math.sin(phase * Math.PI * 4) * (phase < 0.5 ? 1 : 0)) * (phase > 0.2 && phase < 0.3 ? 1 : 0);
      const r = 1 - night * 0.45, g = 1 - night * 0.38 + dusk * -0.06, b = 1 - night * 0.18;
      const warmR = Math.min(1, r + dusk * 0.06);
      this.nightOverlay.tint = (Math.round(warmR * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
    }
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc >= 0.5) { this.fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; }
  }

  /** 开场运镜：从高空俯冲到出生地 */
  cinematicIntro(): void {
    const sp = this.sim.world.spawns[0];
    this.camera.zoom = 0.4; this.camera.tzoom = 1.05;
    this.camera.y -= 600; // 从上方飘入
    this.camera.centerOnTile(sp.x, sp.y);
  }

  destroy(): void {
    if (this.fx) this.fx.dead = true;
    this.doodads = null;
    this.app?.destroy(true, { children: true, texture: false });
  }
}

function cloudTexture(seed: number): any {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 180;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 16; i++) {
    const x = 40 + ((seed * 31 + i * 53) % 240), y = 40 + ((seed * 17 + i * 37) % 100);
    const r = 24 + ((i * 29) % 40);
    const grad = g.createRadialGradient(x, y, 2, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.75)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return PIXI.Texture.from(c);
}

function vignetteTexture(): any {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 288;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(256, 144, 90, 256, 144, 300);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.72, 'rgba(2,6,12,0.05)');
  grad.addColorStop(1, 'rgba(2,6,12,0.6)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 288);
  return PIXI.Texture.from(c);
}
