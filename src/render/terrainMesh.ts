// 地形渲染：8×8 个 chunk（每个 16×16 瓦片）的 WebGL Mesh。
// 角点高度位移 + 逐顶点光照 + 单张地形图集 + 自定义 shader（水面波动/岩浆脉动内建）。
// 高度显示值向模拟值缓动 → 神迹形变有"大地隆起"的动画而非瞬移。
import { MAP, CORNERS, CHUNK, TILE_W, TILE_H, H_STEP } from '../core/const';
import { World, TileType } from '../sim/world';
import { AssetDb } from '../assets/loader';
import { isoX } from './camera';

const CHUNKS = MAP / CHUNK;                  // 8
const VERTS = CHUNK * CHUNK * 4;
const CELL = 256, COLS = 4;                  // 图集 4×2 cell

const VERT_SRC = `
  in vec2 aPosition; in vec2 aUV; in vec3 aColor; in vec2 aMisc;
  out vec2 vUV; out vec3 vColor; out vec2 vMisc; out vec2 vWorld;
  uniform mat3 uProjectionMatrix; uniform mat3 uWorldTransformMatrix; uniform mat3 uTransformMatrix;
  uniform highp float uTime;
  void main(){
    vec2 pos = aPosition;
    pos.y += sin(uTime*1.8 + aPosition.x*0.02 + aPosition.y*0.03) * 2.2 * aMisc.x;
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp*vec3(pos,1.0)).xy, 0.0, 1.0);
    vUV = aUV; vColor = aColor; vMisc = aMisc; vWorld = aPosition;
  }`;
const FRAG_SRC = `
  in vec2 vUV; in vec3 vColor; in vec2 vMisc; in vec2 vWorld;
  uniform sampler2D uTexture;
  uniform highp float uTime;
  void main(){
    vec2 uv = vUV;
    if (vMisc.x > 0.5) uv += vec2(sin(uTime*0.9+vWorld.y*0.015), cos(uTime*0.7+vWorld.x*0.012))*0.006;
    vec4 tex = texture(uTexture, uv);
    vec3 col = tex.rgb * vColor;
    if (vMisc.x > 0.5) {
      float sp = pow(max(0.0, sin(uTime*2.0 + vWorld.x*0.045 + vWorld.y*0.11)), 6.0);
      col += vec3(0.10,0.13,0.15)*sp;
    }
    if (vMisc.y > 0.5) col *= 0.9 + 0.4*(0.5+0.5*sin(uTime*2.6 + vWorld.x*0.05));
    gl_FragColor = vec4(col, 1.0);
  }`;

// chunk 内瓦片画家序（按 x+y 升序），所有 chunk 共用
const TILE_ORDER: number[] = (() => {
  const t: number[] = [];
  for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) t.push(lx + ly * CHUNK);
  t.sort((a, b) => ((a % CHUNK) + Math.floor(a / CHUNK)) - ((b % CHUNK) + Math.floor(b / CHUNK)));
  return t;
})();

interface Chunk {
  mesh: any; pos: Float32Array; uv: Float32Array; col: Float32Array; misc: Float32Array;
  idx: Uint32Array; dirty: boolean; cx: number; cy: number;
  minX: number; maxX: number; minY: number; maxY: number;    // 世界像素包围盒
}

export class TerrainRenderer {
  container: any;
  private world: World;
  private chunks: Chunk[] = [];
  private dispH: Float32Array;                // 角点显示高度（向模拟值缓动）
  private dispWL: number;
  private shader: any;
  private simTime = () => Infinity;
  private animating = false;

  constructor(world: World, assets: AssetDb, getSimTime: () => number) {
    this.world = world;
    this.simTime = getSimTime;
    this.container = new PIXI.Container();
    this.dispH = new Float32Array(CORNERS * CORNERS);
    for (let i = 0; i < this.dispH.length; i++) this.dispH[i] = world.heights[i];
    this.dispWL = world.waterLevel;

    const atlas = buildAtlas(assets);
    const tex = PIXI.Texture.from(atlas);
    tex.source.autoGenerateMipmaps = false;
    tex.source.style.addressMode = 'clamp-to-edge';
    this.shader = PIXI.Shader.from({
      gl: { vertex: VERT_SRC, fragment: FRAG_SRC },
      resources: {
        uTexture: tex.source,
        uSampler: tex.source.style,
        terrainUniforms: { uTime: { value: 0, type: 'f32' } },
      },
    });

    // 按对角线序创建 → 天然画家算法排序
    const order: [number, number][] = [];
    for (let cy = 0; cy < CHUNKS; cy++) for (let cx = 0; cx < CHUNKS; cx++) order.push([cx, cy]);
    order.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
    for (const [cx, cy] of order) this.chunks.push(this.makeChunk(cx, cy));
  }

  private makeChunk(cx: number, cy: number): Chunk {
    const pos = new Float32Array(VERTS * 2);
    const uv = new Float32Array(VERTS * 2);
    const col = new Float32Array(VERTS * 3);
    const misc = new Float32Array(VERTS * 2);
    const idx = new Uint32Array(CHUNK * CHUNK * 6);
    const geometry = new PIXI.Geometry({
      attributes: {
        aPosition: { buffer: pos, format: 'float32x2' },
        aUV: { buffer: uv, format: 'float32x2' },
        aColor: { buffer: col, format: 'float32x3' },
        aMisc: { buffer: misc, format: 'float32x2' },
      },
      indexBuffer: idx,
    });
    const mesh = new PIXI.Mesh({ geometry, shader: this.shader });
    this.container.addChild(mesh);
    const c: Chunk = { mesh, pos, uv, col, misc, idx, dirty: true, cx, cy, minX: 0, maxX: 0, minY: 0, maxY: 0 };
    this.rebuild(c);
    return c;
  }

  /** 神迹形变后由事件调用：标脏受影响 chunk */
  markDirty(x0: number, y0: number, x1: number, y1: number): void {
    const c0x = Math.max(0, Math.floor((x0 - 1) / CHUNK)), c1x = Math.min(CHUNKS - 1, Math.floor((x1 + 1) / CHUNK));
    const c0y = Math.max(0, Math.floor((y0 - 1) / CHUNK)), c1y = Math.min(CHUNKS - 1, Math.floor((y1 + 1) / CHUNK));
    for (const c of this.chunks) if (c.cx >= c0x && c.cx <= c1x && c.cy >= c0y && c.cy <= c1y) c.dirty = true;
    this.animating = true;
  }
  markAllDirty(): void { for (const c of this.chunks) c.dirty = true; this.animating = true; }

  update(dt: number, time: number, viewport: { x0: number; y0: number; x1: number; y1: number }): void {
    this.shader.resources.terrainUniforms.uniforms.uTime = time;

    // 高度/水位显示值缓动（形变动画）
    if (this.animating) {
      let anyLeft = false;
      const k = 1 - Math.exp(-10 * dt);
      const H = this.world.heights, D = this.dispH;
      for (const c of this.chunks) {
        if (!c.dirty) continue;
        let moving = false;
        const x0 = c.cx * CHUNK, y0 = c.cy * CHUNK;
        for (let y = y0; y <= y0 + CHUNK; y++) {
          for (let x = x0; x <= x0 + CHUNK; x++) {
            const i = y * CORNERS + x;
            const d = H[i] - D[i];
            if (Math.abs(d) > 0.02) { D[i] += d * k; moving = true; }
            else D[i] = H[i];
          }
        }
        const wd = this.world.waterLevel - this.dispWL;
        if (Math.abs(wd) > 0.01) moving = true;
        this.rebuild(c);
        if (!moving) c.dirty = false; else anyLeft = true;
      }
      const wd = this.world.waterLevel - this.dispWL;
      if (Math.abs(wd) > 0.01) { this.dispWL += wd * k; anyLeft = true; for (const c of this.chunks) c.dirty = true; }
      else this.dispWL = this.world.waterLevel;
      this.animating = anyLeft;
    }

    // 视口裁剪
    for (const c of this.chunks)
      c.mesh.visible = !(c.maxX < viewport.x0 || c.minX > viewport.x1 || c.maxY < viewport.y0 || c.minY > viewport.y1);
  }

  /** 显示高度（含水面钳制），实体/特效放置用它贴合动画中的地面 */
  displayHeightAt(x: number, y: number): number {
    const xi = Math.max(0, Math.min(MAP - 1, Math.floor(x)));
    const yi = Math.max(0, Math.min(MAP - 1, Math.floor(y)));
    const xf = x - xi, yf = y - yi;
    const D = this.dispH, C = CORNERS;
    const a = D[yi * C + xi], b = D[yi * C + xi + 1], c2 = D[(yi + 1) * C + xi], d = D[(yi + 1) * C + xi + 1];
    return a + (b - a) * xf + (c2 - a) * yf + (a - b - c2 + d) * xf * yf;
  }

  private rebuild(c: Chunk): void {
    const w = this.world, D = this.dispH, wl = this.dispWL;
    const t = this.simTime();
    const { pos, uv, col, misc, idx } = c;
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;

    const tiles = TILE_ORDER; // 瓦片按 (x+y) 画家序（模块级预计算）

    let vi = 0, ii = 0;
    for (const ti of tiles) {
      const lx = ti % CHUNK, ly = Math.floor(ti / CHUNK);
      const tx = c.cx * CHUNK + lx, ty = c.cy * CHUNK + ly;
      const i00 = ty * CORNERS + tx, i10 = i00 + 1, i01 = i00 + CORNERS, i11 = i01 + 1;
      const rh = [D[i00], D[i10], D[i01], D[i11]];
      const type = w.tileType(tx, ty, t);
      const isWaterTile = type === TileType.Deep || type === TileType.Shallow;
      // 水下角点钳到水面（封住岸线）
      const h = rh.map(v => Math.max(v, wl));

      // 图集 cell
      const swamp = w.isSwamp(tx, ty, t);
      const scorch = w.scorched[ty * MAP + tx] === 1;
      let cell: number, emissive = 0;
      if (isWaterTile) cell = 6;
      else if (swamp) cell = 7;
      else if (type === TileType.Lava) { cell = 5; emissive = 1; }
      else if (scorch && (type === TileType.Grass || type === TileType.Sand)) cell = 4;
      else cell = type === TileType.Sand ? 1 : type === TileType.Rock ? 2 : type === TileType.Snow ? 3 : 0;

      // UV：cell 内 96px 窗口按 tileHash 抖动 → 打破重复感
      const hash = w.tileHash(tx, ty);
      const cellX = (cell % COLS) * CELL, cellY = Math.floor(cell / COLS) * CELL;
      const win = 96, inset = 8;
      const ox = cellX + inset + hash * (CELL - win - inset * 2);
      const oy = cellY + inset + ((hash * 7.13) % 1) * (CELL - win - inset * 2);
      const AW = CELL * COLS, AH = CELL * 2;
      const u0 = ox / AW, v0 = oy / AH, u1 = (ox + win) / AW, v1 = (oy + win) / AH;

      // 逐角点：位置 / 光照 / misc
      const corners = [[tx, ty, h[0], u0, v0], [tx + 1, ty, h[1], u1, v0], [tx, ty + 1, h[2], u0, v1], [tx + 1, ty + 1, h[3], u1, v1]];
      for (let k = 0; k < 4; k++) {
        const [gx, gy, gh, uu, vv] = corners[k];
        const px = isoX(gx, gy);
        const py = (gx + gy) * (TILE_H / 2) - gh * H_STEP;
        pos[vi * 2] = px; pos[vi * 2 + 1] = py;
        uv[vi * 2] = uu; uv[vi * 2 + 1] = vv;
        // 光照：坡度梯度（阳面西北）+ 高度微增亮
        const ci = Math.min(CORNERS - 1, gy) * CORNERS + Math.min(CORNERS - 1, gx);
        const hx = D[Math.min(CORNERS - 1, gy) * CORNERS + Math.min(CORNERS - 1, gx + 1)] - D[ci];
        const hy = D[Math.min(CORNERS - 2, gy) * CORNERS + CORNERS + Math.min(CORNERS - 1, gx)] - D[ci];
        let light = 0.86 - hx * 0.09 - hy * 0.16 + gh * 0.012;
        light = Math.max(0.5, Math.min(1.18, light));
        let r = light, g2 = light, b = light;
        if (isWaterTile) {
          const depth = Math.max(0, wl - (rh[k] ?? 0));
          const dk = Math.max(0.35, 1 - depth * 0.16);
          r = light * 0.9 * dk; g2 = light * 0.96 * dk; b = light * 1.08;
        } else if (scorch && cell === 4) { r *= 0.55; g2 *= 0.5; b *= 0.5; }
        if (swamp && !isWaterTile) { r *= 0.75; b *= 0.6; }
        col[vi * 3] = r; col[vi * 3 + 1] = g2; col[vi * 3 + 2] = b;
        misc[vi * 2] = isWaterTile ? 1 : 0;
        misc[vi * 2 + 1] = emissive;
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
        vi++;
      }
      // 自适应对角线：让三角剖分贴合坡向
      const base = vi - 4;
      if (Math.abs(h[0] - h[3]) <= Math.abs(h[1] - h[2])) {
        idx[ii++] = base; idx[ii++] = base + 1; idx[ii++] = base + 3;
        idx[ii++] = base; idx[ii++] = base + 3; idx[ii++] = base + 2;
      } else {
        idx[ii++] = base; idx[ii++] = base + 1; idx[ii++] = base + 2;
        idx[ii++] = base + 1; idx[ii++] = base + 3; idx[ii++] = base + 2;
      }
    }

    c.minX = minX; c.maxX = maxX; c.minY = minY - TILE_H; c.maxY = maxY + TILE_H;
    const g = c.mesh.geometry;
    g.getBuffer('aPosition').update();
    g.getBuffer('aUV').update();
    g.getBuffer('aColor').update();
    g.getBuffer('aMisc').update();
    (g.indexBuffer ?? g.getIndex?.())?.update();
  }
}

/** 地形图集：4×2 cell（6 张生成/兜底纹理 + 程序化水面/沼泽） */
function buildAtlas(assets: AssetDb): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = CELL * COLS; c.height = CELL * 2;
  const g = c.getContext('2d')!;
  const order = ['grass', 'sand', 'rock', 'snow', 'soil', 'lava'];
  order.forEach((n, i) => {
    g.drawImage(assets.terrain[n] as CanvasImageSource, (i % COLS) * CELL, Math.floor(i / COLS) * CELL, CELL, CELL);
  });
  // cell 6: 水
  const wx = (6 % COLS) * CELL, wy = Math.floor(6 / COLS) * CELL;
  const wg = g.createLinearGradient(wx, wy, wx + CELL, wy + CELL);
  wg.addColorStop(0, '#2e6f8e'); wg.addColorStop(0.5, '#255d7d'); wg.addColorStop(1, '#2e6f8e');
  g.fillStyle = wg; g.fillRect(wx, wy, CELL, CELL);
  for (let i = 0; i < 34; i++) {
    g.globalAlpha = 0.05 + ((i * 73) % 10) / 10 * 0.1;
    g.strokeStyle = '#bfe8f2'; g.lineWidth = 1 + ((i * 41) % 3);
    g.beginPath();
    const yy = wy + (i * 53 + ((i * i * 17) % 29)) % CELL;
    for (let x = 0; x <= CELL; x += 8) g.lineTo(wx + x, yy + Math.sin((x + i * 31) / (11 + (i % 5) * 3)) * (2 + (i % 3)));
    g.stroke();
  }
  g.globalAlpha = 1;
  // cell 7: 沼泽
  const sx = (7 % COLS) * CELL, sy = Math.floor(7 / COLS) * CELL;
  g.fillStyle = '#3d4a2a'; g.fillRect(sx, sy, CELL, CELL);
  for (let i = 0; i < 400; i++) {
    const a = (i * 137.5) % CELL, b = (i * 89.7) % CELL;
    g.fillStyle = i % 3 ? 'rgba(84,105,54,0.5)' : 'rgba(30,36,20,0.55)';
    g.beginPath(); g.arc(sx + a, sy + b, 2 + (i % 5), 0, Math.PI * 2); g.fill();
  }
  return c;
}
