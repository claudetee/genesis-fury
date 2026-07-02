// 输入统一层：鼠标（左键施法/右中键拖拽/滚轮指向缩放/边缘滚动）、
// 键盘（WASD/方向键平移、1-9 神迹热键、Esc、+/-）、
// 触屏（单指拖动=平移、点按=施法、双指捏合=缩放）。
// 拖拽即时跟手，松手带惯性；tap 与 drag 用 8px/220ms 阈值区分。
import { CAM_EDGE_PX, CAM_KEY_SPEED, MIRACLES, BUILDINGS } from '../core/const';
import { Camera } from '../render/camera';

export interface InputCallbacks {
  onCast(x: number, y: number): void;
  onSelectMiracle(id: string | null): void;
  onPause(): void;
  onToggleDebug(): void;
}

interface PointerState { id: number; x: number; y: number; sx: number; sy: number; t: number; button: number }

export class InputManager {
  hoverX = 64; hoverY = 64;          // 光标处 tile 坐标
  pointerOnCanvas = false;
  private cam: Camera;
  private cb: InputCallbacks;
  private canvas: HTMLCanvasElement;
  private pointers = new Map<number, PointerState>();
  private dragging = false;
  private dragButton = -1;
  private lastMoves: { x: number; y: number; t: number }[] = [];
  private pinchDist = 0;
  private keys = new Set<string>();
  private mouseX = 0; private mouseY = 0;
  private brushHold = false;          // 塑地长按连发（仅鼠标）
  private brushTimer = 0;
  private hadMulti = false;           // 本手势曾出现多点触控 → 抑制 tap
  private detached: (() => void)[] = [];
  edgeScrollEnabled = true;
  camSpeedMult = 1;
  selected: string | null = null;
  enabled = false;

  constructor(canvas: HTMLCanvasElement, cam: Camera, cb: InputCallbacks) {
    this.canvas = canvas; this.cam = cam; this.cb = cb;
    this.attach();
  }

  select(id: string | null): void {
    this.selected = id;
    this.cb.onSelectMiracle(id);
  }

  private attach(): void {
    const c = this.canvas;
    const on = <E extends Event>(el: HTMLElement | Window, ev: string, fn: (e: E) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(ev, fn as EventListener, opts);
      this.detached.push(() => el.removeEventListener(ev, fn as EventListener));
    };

    on(c, 'pointerdown', (e: PointerEvent) => {
      if (!this.enabled) return;
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { id: e.pointerId, x: e.offsetX, y: e.offsetY, sx: e.offsetX, sy: e.offsetY, t: performance.now(), button: e.button });
      this.lastMoves = [];
      if (this.pointers.size >= 2) {
        // 进入多点触控：抑制本手势期间与结束瞬间的一切 tap/施法
        this.hadMulti = true;
        const [a, b] = [...this.pointers.values()];
        this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        this.dragging = false; this.brushHold = false;
      } else if (e.button === 1 || e.button === 2 || this.keys.has(' ')) {
        this.dragging = true; this.dragButton = e.button;
      } else if (e.button === 0 && e.pointerType === 'mouse' && (this.selected === 'raise' || this.selected === 'lower')) {
        // 塑地长按连发只给鼠标；触屏用 tap（否则单指永远无法平移）
        this.castAt(e.offsetX, e.offsetY);
        this.brushHold = true; this.brushTimer = 0.18;
      }
    });

    on(c, 'pointermove', (e: PointerEvent) => {
      this.mouseX = e.offsetX; this.mouseY = e.offsetY;
      this.pointerOnCanvas = true;
      const p = this.pointers.get(e.pointerId);
      const t = this.cam.pickTile(e.offsetX, e.offsetY);
      this.hoverX = t.x; this.hoverY = t.y;
      if (!p || !this.enabled) return;
      const dx = e.offsetX - p.x, dy = e.offsetY - p.y;
      p.x = e.offsetX; p.y = e.offsetY;

      if (this.pointers.size === 2) {
        // 捏合缩放 + 双指平移
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (this.pinchDist > 0 && Math.abs(d - this.pinchDist) > 1) {
          this.cam.zoomAt(d / this.pinchDist, mx, my);
          this.pinchDist = d;
        }
        this.cam.pan(-dx / 2, -dy / 2);
        return;
      }

      const total = Math.hypot(e.offsetX - p.sx, e.offsetY - p.sy);
      // 左键（或触摸）拖过阈值 → 转为平移（未按住塑地时）
      if (!this.dragging && !this.brushHold && total > 8 && p.button === 0) this.dragging = true;
      if (this.dragging) {
        this.cam.pan(-dx, -dy);
        this.lastMoves.push({ x: e.offsetX, y: e.offsetY, t: performance.now() });
        if (this.lastMoves.length > 6) this.lastMoves.shift();
      }
    });

    const finish = (e: PointerEvent) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchDist = 0;
      // 手势状态无条件先清（enabled=false 时也不能把 dragging/brushHold 泄漏到恢复之后）
      const wasBrush = this.brushHold, wasDragging = this.dragging;
      const wasMulti = this.hadMulti;
      if (this.pointers.size === 0) { this.dragging = false; this.brushHold = false; this.hadMulti = false; }
      if (!p || !this.enabled) return;
      if (wasBrush) return;
      if (wasMulti) return;               // 捏合/多指手势收尾：绝不判 tap（防缩放误施法）
      const dt = performance.now() - p.t;
      const total = Math.hypot(e.offsetX - p.sx, e.offsetY - p.sy);
      if (wasDragging) {
        // 惯性
        if (this.lastMoves.length >= 2) {
          const a = this.lastMoves[0], b = this.lastMoves[this.lastMoves.length - 1];
          const span = (b.t - a.t) / 1000;
          if (span > 0.01 && performance.now() - b.t < 90) {
            this.cam.fling((b.x - a.x) / span, (b.y - a.y) / span);
          }
        }
        return;
      }
      // tap → 施法
      if (p.button === 0 && total <= 8 && dt <= 400) this.castAt(e.offsetX, e.offsetY);
    };
    on(c, 'pointerup', finish);
    on(c, 'pointercancel', (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 0) { this.dragging = false; this.brushHold = false; this.hadMulti = false; }
      if (this.pointers.size < 2) this.pinchDist = 0;
    });
    on(c, 'pointerleave', () => { this.pointerOnCanvas = false; });

    on(c, 'wheel', (e: WheelEvent) => {
      if (!this.enabled) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0012);
      this.cam.zoomAt(factor, e.offsetX, e.offsetY);
    }, { passive: false });

    on(c, 'contextmenu', (e: Event) => e.preventDefault());

    on(window, 'keydown', (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.key === ' ' ? ' ' : e.key.toLowerCase());
      if (!this.enabled) { if (e.key === 'Escape') this.cb.onPause(); return; }
      if (e.key === 'Escape') { this.selected ? this.select(null) : this.cb.onPause(); }
      if (e.key === 'F3') { e.preventDefault(); this.cb.onToggleDebug(); }
      const key = e.key.toLowerCase();
      const m = MIRACLES.find(mm => mm.hotkey === key);
      if (m) this.select(this.selected === m.id ? null : m.id);
      const b = BUILDINGS.find(bb => bb.hotkey === key);
      if (b) this.select(this.selected === `b:${b.id}` ? null : `b:${b.id}`);
    });
    on(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.key === ' ' ? ' ' : e.key.toLowerCase()));
    on(window, 'blur', () => { this.keys.clear(); this.dragging = false; this.brushHold = false; });
  }

  private castAt(sx: number, sy: number): void {
    const t = this.cam.pickTile(sx, sy);
    this.cb.onCast(t.x, t.y);
  }

  /** 每帧：键盘平移 / 边缘滚动 / 塑地连发 */
  update(dt: number): void {
    if (!this.enabled) return;
    let dx = 0, dy = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
    if (dx || dy) this.cam.keyPan(dx, dy, dt, CAM_KEY_SPEED * this.camSpeedMult);
    else if (this.edgeScrollEnabled && this.pointerOnCanvas && this.pointers.size === 0 && document.hasFocus()) {
      const w = this.cam.viewW, h = this.cam.viewH;
      let ex = 0, ey = 0;
      if (this.mouseX < CAM_EDGE_PX) ex = -1; else if (this.mouseX > w - CAM_EDGE_PX) ex = 1;
      if (this.mouseY < CAM_EDGE_PX) ey = -1; else if (this.mouseY > h - CAM_EDGE_PX) ey = 1;
      if (ex || ey) this.cam.keyPan(ex, ey, dt, CAM_KEY_SPEED * 0.8 * this.camSpeedMult);
    }
    if (this.brushHold) {
      this.brushTimer -= dt;
      if (this.brushTimer <= 0) { this.brushTimer = 0.18; this.castAt(this.mouseX, this.mouseY); }
    }
  }

  destroy(): void { for (const d of this.detached) d(); }
}
