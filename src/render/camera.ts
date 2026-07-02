// 相机：临界阻尼缓动 + 拖拽惯性 + 距离衰减震屏 + 指向缩放。
// 世界坐标 = 等距投影后的像素空间；tile→world 见 iso()/unproject()。
import { TILE_W, TILE_H, H_STEP, MAP, CAM_EASE, ZOOM_MIN, ZOOM_MAX } from '../core/const';

export function isoX(x: number, y: number): number { return (x - y) * (TILE_W / 2); }
export function isoY(x: number, y: number, h: number): number { return (x + y) * (TILE_H / 2) - h * H_STEP; }

export class Camera {
  x = 0; y = 0; zoom = 1;                    // 当前（世界像素，指向地图中心点）
  tx = 0; ty = 0; tzoom = 1;                 // 目标
  vx = 0; vy = 0;                            // 惯性速度（松手后衰减）
  shakeAmp = 0; shakeT = 0;
  viewW = 1; viewH = 1;
  private shakeX = 0; private shakeY = 0;

  constructor(heightAt: (x: number, y: number) => number) {
    this.heightAt = heightAt;
  }
  private heightAt: (x: number, y: number) => number;

  centerOnTile(tx: number, ty: number, immediate = false): void {
    const h = this.heightAt(tx, ty);
    this.tx = isoX(tx, ty); this.ty = isoY(tx, ty, h);
    if (immediate) { this.x = this.tx; this.y = this.ty; }
  }

  resize(w: number, h: number): void { this.viewW = w; this.viewH = h; }

  pan(dxScreen: number, dyScreen: number): void {
    this.tx -= dxScreen / this.zoom;
    this.ty -= dyScreen / this.zoom;
    this.x = this.tx; this.y = this.ty;      // 拖拽即时跟手（≤100ms 体感）
    this.clampTarget();
  }

  fling(vxScreen: number, vyScreen: number): void {
    this.vx = -vxScreen / this.zoom; this.vy = -vyScreen / this.zoom;
  }

  /** 指向缩放：保持光标下的世界点不动 */
  zoomAt(factor: number, sx: number, sy: number): void {
    const before = this.screenToWorld(sx, sy);
    this.tzoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.tzoom * factor));
    const z = this.tzoom;
    // 直接以目标 zoom 反推目标位置，让缩放锚定光标
    const wx = before.x, wy = before.y;
    this.tx = wx - (sx - this.viewW / 2) / z;
    this.ty = wy - (sy - this.viewH / 2) / z;
    this.clampTarget();
  }

  keyPan(dx: number, dy: number, dt: number, speed: number): void {
    this.tx += dx * speed * dt / this.zoom;
    this.ty += dy * speed * dt / this.zoom;
    this.clampTarget();
  }

  shake(power: number): void {
    this.shakeAmp = Math.min(26, this.shakeAmp + power * 14);
    this.shakeT = 0;
  }

  update(dt: number): void {
    // 惯性
    if (Math.abs(this.vx) > 1 || Math.abs(this.vy) > 1) {
      this.tx += this.vx * dt; this.ty += this.vy * dt;
      const decay = Math.exp(-4.2 * dt);
      this.vx *= decay; this.vy *= decay;
      this.clampTarget();
    }
    // 临界阻尼式指数缓动
    const k = 1 - Math.exp(-CAM_EASE * dt);
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    this.zoom += (this.tzoom - this.zoom) * (1 - Math.exp(-10 * dt));
    // 震屏（阻尼振荡）
    if (this.shakeAmp > 0.4) {
      this.shakeT += dt;
      const a = this.shakeAmp * Math.exp(-6 * this.shakeT);
      this.shakeX = Math.sin(this.shakeT * 57) * a;
      this.shakeY = Math.cos(this.shakeT * 43) * a * 0.7;
      if (a < 0.4) this.shakeAmp = 0;
    } else { this.shakeX = 0; this.shakeY = 0; }
  }

  private clampTarget(): void {
    const half = MAP / 2;
    const cx = isoX(half, half);
    const spanX = MAP * TILE_W / 2;
    const spanY = MAP * TILE_H / 2;
    this.tx = Math.max(cx - spanX * 0.55, Math.min(cx + spanX * 0.55, this.tx));
    this.ty = Math.max(-spanY * 0.15, Math.min(spanY * 1.12, this.ty));
  }

  /** 应用到 Pixi 世界容器 */
  apply(container: { position: { set(x: number, y: number): void }; scale: { set(s: number): void } }): void {
    container.scale.set(this.zoom);
    container.position.set(
      this.viewW / 2 - (this.x + this.shakeX) * this.zoom,
      this.viewH / 2 - (this.y + this.shakeY) * this.zoom,
    );
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: this.x + (sx - this.viewW / 2) / this.zoom, y: this.y + (sy - this.viewH / 2) / this.zoom };
  }

  /** 屏幕 → tile 坐标（迭代收敛处理高度视差） */
  pickTile(sx: number, sy: number): { x: number; y: number } {
    const w = this.screenToWorld(sx, sy);
    let h = 0, x = 0, y = 0;
    for (let i = 0; i < 4; i++) {
      const u = w.x / (TILE_W / 2), v = (w.y + h * H_STEP) / (TILE_H / 2);
      x = (u + v) / 2; y = (v - u) / 2;
      h = this.heightAt(x, y);
    }
    return { x: Math.max(0, Math.min(MAP - 0.01, x)), y: Math.max(0, Math.min(MAP - 0.01, y)) };
  }

  /** 世界像素视口（裁剪用），带余量 */
  viewport(): { x0: number; y0: number; x1: number; y1: number } {
    const mx = 160 / this.zoom;
    return {
      x0: this.x - this.viewW / 2 / this.zoom - mx, y0: this.y - this.viewH / 2 / this.zoom - mx,
      x1: this.x + this.viewW / 2 / this.zoom + mx, y1: this.y + this.viewH / 2 / this.zoom + mx,
    };
  }
}
