// GENESIS FURY — 入口与总编排。
// 状态机：loading → title → playing ↔ paused → ended → title。
// 模拟固定步长 10Hz（速度倍率 1/2/3），渲染 60fps 插值。
import { SIM_DT, AUTOSAVE_S } from './core/const';
import { EventBus } from './core/events';
import { Sim } from './sim/sim';
import { cast, canCast, placeBuilding, canBuild } from './sim/miracles';
import { EnemyGod, Difficulty } from './sim/ai';
import { loadAssets, AssetDb } from './assets/loader';
import { Renderer } from './render/renderer';
import { InputManager } from './input/input';
import { AudioEngine } from './audio/audio';
import { Hud } from './ui/hud';
import { Screens, fatalError } from './ui/screens';
import { Tutorial, TutorialCtx } from './ui/tutorial';
import { loadSettings, saveGame, loadGame, clearSave, Settings } from './core/save';

type State = 'boot' | 'title' | 'playing' | 'paused' | 'ended';

class Game {
  private state: State = 'boot';
  private settings: Settings = loadSettings();
  private audio = new AudioEngine();
  private assets!: AssetDb;
  private screens!: Screens;
  // 每局对象
  private bus: EventBus | null = null;
  private sim: Sim | null = null;
  private ai: EnemyGod | null = null;
  private renderer: Renderer | null = null;
  private input: InputManager | null = null;
  private hud: Hud | null = null;
  private tutorial: Tutorial | null = null;
  private difficulty: Difficulty = 'normal';
  private speed = 1;
  private acc = 0;
  private lastT = 0;
  private autosaveT = 0;
  private showDebug = false;
  private tutCtx: TutorialCtx | null = null;
  private raf = 0;
  private endPending = 0;
  private prevCam: { x: number; y: number; z: number } | null = null;

  async boot(): Promise<void> {
    this.screens = new Screens(this.settings, {
      onNewGame: (d) => this.startGame(d as Difficulty, !this.settings.tutorialDone),
      onContinue: () => this.continueGame(),
      onTutorial: () => this.startGame('easy', true),
      onResume: () => this.resume(),
      onSaveQuit: () => { this.saveNow(); this.teardown(); this.toTitle(); },
      onAbandon: () => { clearSave(); this.teardown(); this.toTitle(); },
      onAgain: () => { const d = this.difficulty; this.teardown(); this.startGame(d, false); },
      onToTitle: () => { this.teardown(); this.toTitle(); },
      onSettingsChanged: (s) => this.applySettings(s),
      onUiSound: (k) => { this.audio.play(k === 'click' ? 'uiClick' : 'uiHover'); },
    });
    this.screens.showLoading();
    this.assets = await loadAssets((p, label) => this.screens.setLoadProgress(p * 0.9, label));
    this.screens.applyAssets(this.assets);
    this.screens.setLoadProgress(1, '神座已就绪');
    await sleep(350);
    this.toTitle();
    // 用户手势解锁音频（iOS Safari 对 pointerdown 可能不放行 → 多事件监听 + 确认 running 才解绑）
    const unlockEvents = ['pointerdown', 'touchend', 'keydown'];
    const tryUnlock = () => {
      this.audio.start(); this.audio.resume();
      setTimeout(() => {
        if (this.audio.isRunning()) unlockEvents.forEach(ev => window.removeEventListener(ev, tryUnlock));
      }, 250);
    };
    unlockEvents.forEach(ev => window.addEventListener(ev, tryUnlock));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (this.state === 'playing') { this.pause(); this.saveNow(); } }
      else this.audio.resume();
    });
  }

  private toTitle(): void {
    this.state = 'title';
    this.screens.showTitle(!!loadGame());
  }

  // ── 开局 ────────────────────────────────────────────
  private async startGame(diff: Difficulty, withTutorial: boolean): Promise<void> {
    this.audio.start();
    this.difficulty = diff;
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const bus = new EventBus();
    const sim = new Sim(bus, seed);
    sim.seedStart();
    await this.mount(bus, sim, withTutorial);
  }

  private async continueGame(): Promise<void> {
    this.audio.start();
    const env = loadGame();
    if (!env) { this.toTitle(); return; }
    this.difficulty = (env.difficulty as Difficulty) || 'normal';
    const bus = new EventBus();
    let sim: Sim;
    try { sim = Sim.deserialize(bus, env.data); }
    catch { clearSave(); this.hud?.toast('存档已破损，重归混沌', 'warn'); this.toTitle(); return; }
    await this.mount(bus, sim, false);
  }

  private async mount(bus: EventBus, sim: Sim, withTutorial: boolean): Promise<void> {
    this.screens.showLoading();
    this.screens.setLoadProgress(0.2, '编织大地经纬……');
    // ⚠️ 初始化完成前不碰 this.renderer/this.sim —— 上一局的 RAF 循环可能仍在跑，
    //    提前赋值会让它 update 一个未初始化的 renderer（重开局崩溃竞态）
    const renderer = new Renderer(sim, bus, this.assets);
    const host = document.getElementById('game-root')!;
    host.innerHTML = '';
    try { await renderer.init(host); }
    catch (e) { fatalError(`渲染引擎无法启动（${(e as Error).message}）。请使用支持 WebGL 的现代浏览器。`); return; }
    this.bus = bus; this.sim = sim; this.renderer = renderer;
    this.ai = new EnemyGod(sim, this.difficulty);
    this.audio.bind(bus);
    this.screens.setLoadProgress(0.7, '召唤信徒……');

    this.hud = new Hud(sim, this.assets, bus, {
      onSelect: (id) => this.select(id),
      onPause: () => this.handleEsc(),
      onToggleSound: () => this.hud!.setSoundIcon(this.audio.toggleMute()),
      onOpenSettings: () => { this.pause(); this.screens.openSettings('pause'); },
      onSpeed: () => { this.speed = this.speed >= 3 ? 1 : this.speed + 1; return this.speed; },
      onHover: () => this.audio.play('uiHover'),
    });
    this.renderer.attachMinimap(document.getElementById('minimap') as HTMLCanvasElement);

    this.input = new InputManager(this.renderer.app.canvas, this.renderer.camera, {
      onCast: (x, y) => this.tryCast(x, y),
      onSelectMiracle: (id) => this.hud!.setSelected(id),
      onPause: () => this.handleEsc(),
      onToggleDebug: () => { this.showDebug = !this.showDebug; },
    });
    this.applySettings(this.settings);

    // 敌方大神迹预警 + 关键事件 toast
    bus.on('miracleCast', (e) => {
      if (e.faction !== 1) return;
      if (e.id === 'flood') this.hud!.toast('绯红邪神召唤了大洪水！', 'warn');
      else if (e.id === 'volcano') this.hud!.toast('绯红邪神降下了火山！', 'warn');
      else if (e.id === 'quake') this.hud!.toast('大地在绯红的怒意中震颤', 'warn');
    });
    bus.on('entityDeath', (e) => {
      if (e.kind === 'house' && e.faction === 0 && e.cause !== 'razed') { /* 静默，避免刷屏 */ }
    });
    bus.on('houseUpgrade', (e) => { if (this.sim!.houses.find(h => h.id === e.id)?.faction === 0 && e.level === 3) this.hud!.toast('一座圣殿拔地而起', 'good'); });
    bus.on('gameOver', (e) => { this.endPending = 1.8; void e; });
    bus.on('avatarDeath', (e) => {
      if (e.faction === 0) this.hud!.toast('你的神使殒落了！神迹暂时失声', 'warn');
      else this.hud!.toast('绯红神使殒落！趁现在！', 'good');
    });
    bus.on('avatarRespawn', (e) => { if (e.faction === 0) this.hud!.toast('神使已于圣殿转生', 'good'); });

    this.tutCtx = { sim, cam: this.renderer.camera, castCounts: {}, camMoved: 0, zoomChanged: 0, moveOrders: 0 };
    this.tutorial = new Tutorial(() => { this.settings.tutorialDone = true; this.applySettings(this.settings); });
    if (withTutorial) this.tutorial.start();

    this.screens.setLoadProgress(1, '降临！');
    await sleep(250);
    this.screens.showGame();
    this.hud.show();
    this.renderer.cinematicIntro();
    this.state = 'playing';
    this.input.enabled = true;
    this.speed = 1;
    this.acc = 0; this.autosaveT = 0; this.endPending = 0;
    this.lastT = performance.now();
    if (!this.raf) this.loop(this.lastT);
    this.hud.toast(this.difficulty === 'easy' ? '晨曦照拂着你的子民' : this.difficulty === 'hard' ? '永夜之战，愿神明保佑你' : '圣战开启，尘世待定', 'good');
  }

  private teardown(): void {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    this.input?.destroy(); this.input = null;
    this.renderer?.destroy(); this.renderer = null;
    this.hud?.hide(); this.hud = null;
    this.bus?.clear(); this.bus = null;
    this.sim = null; this.ai = null; this.tutorial = null; this.tutCtx = null;
    this.prevCam = null; this.speed = 1; this.endPending = 0;
    document.getElementById('game-root')!.innerHTML = '';
    document.getElementById('tutorial-card')!.classList.add('hidden');
  }

  // ── 交互 ────────────────────────────────────────────
  private select(id: string | null): void {
    if (!this.input || !this.hud) return;
    this.input.selected = id;
    this.hud.setSelected(id);
    if (id) this.audio.play('uiClick');
  }

  private tryCast(x: number, y: number): void {
    if (this.state !== 'playing' || !this.sim || !this.input || this.sim.over) return;
    const id = this.input.selected;
    if (!id) {
      // 无神迹选中：点地 = 神使移动令（Populous 正统操控）
      if (this.sim.commandAvatar(0, x, y)) {
        this.audio.play('uiClick');
        if (this.tutCtx) this.tutCtx.moveOrders++;
      } else this.hud?.toast('神使殒落，等待转生', 'warn');
      return;
    }
    if (id.startsWith('b:')) {
      const r = placeBuilding(this.sim, 0, id.slice(2), x, y);
      if (r === 'ok') { this.audio.play('totem'); this.select(null); }
      return;
    }
    const r = cast(this.sim, 0, id, x, y);
    if (r === 'ok' && this.tutCtx) this.tutCtx.castCounts[id] = (this.tutCtx.castCounts[id] ?? 0) + 1;
  }

  /** Esc / 暂停按钮统一入口：设置页 → 回暂停菜单；暂停 → 继续；游戏中 → 暂停 */
  private handleEsc(): void {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') {
      if (this.screens.isSettingsOpen()) this.screens.showPause();
      else this.resume();
    }
  }

  private pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    if (this.input) this.input.enabled = false;
    this.screens.showPause();
  }
  private resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    if (this.input) this.input.enabled = true;
    this.screens.showGame();
    this.lastT = performance.now();
  }

  private saveNow(): void {
    if (this.sim && !this.sim.over) saveGame(this.sim.serialize(), this.difficulty);
  }

  private applySettings(s: Settings): void {
    this.settings = s;
    this.audio.setVolumes(s.masterVol, s.musicVol, s.sfxVol);
    if (this.renderer) this.renderer.fx.setQuality(s.quality);
    if (this.input) { this.input.edgeScrollEnabled = s.edgeScroll; this.input.camSpeedMult = s.camSpeed; }
    try { localStorage.setItem('genesis-fury:settings:v1', JSON.stringify(s)); } catch { /* ignore */ }
  }

  // ── 主循环 ──────────────────────────────────────────
  private loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    const frameT0 = performance.now();
    const dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    if (!this.renderer || !this.sim) return;

    if (this.state === 'playing') {
      this.acc += dt * this.speed;
      let steps = 0;
      while (this.acc >= SIM_DT && steps < 8) {
        this.sim.tick();
        if (!this.sim.over) this.ai?.tick(SIM_DT);   // 胜负已定：AI 停手，不在结算动画期改地形
        this.acc -= SIM_DT; steps++;
      }
      if (steps >= 8) this.acc = 0; // 长时间挂起后不追帧

      // 自动存档
      this.autosaveT += dt;
      if (this.autosaveT >= AUTOSAVE_S) { this.autosaveT = 0; this.saveNow(); }

      // 教学（开场运镜的 2.5s 内不计入镜头操作，防自动跳步）
      if (this.tutorial?.active && this.tutCtx) {
        const cam = this.renderer.camera;
        if (this.sim.time < 2.5) this.prevCam = { x: cam.x, y: cam.y, z: cam.zoom };
        else if (this.prevCam) {
          this.tutCtx.camMoved += Math.abs(cam.x - this.prevCam.x) + Math.abs(cam.y - this.prevCam.y);
          this.tutCtx.zoomChanged += Math.abs(cam.zoom - this.prevCam.z);
        }
        this.prevCam = { x: cam.x, y: cam.y, z: cam.zoom };
        this.tutorial.update(this.tutCtx);
      }

      // 结算延迟（让终局特效播完）
      if (this.endPending > 0) {
        this.endPending -= dt;
        if (this.endPending <= 0 && this.sim.over) {
          this.state = 'ended';
          if (this.input) this.input.enabled = false;
          clearSave();
          const fs = this.sim.factions[0];
          this.screens.showEnd(this.sim.over.victory, {
            time: this.sim.time, peakPop: fs.peakPop, casts: fs.miracleCasts, pop: this.sim.pop(0),
          });
        }
      }
    }

    // 输入（镜头键盘/边缘滚动/塑地连发）
    this.input?.update(dt);

    // 预瞄指示（含神使祈告半径环）
    if (this.input && this.renderer) {
      const sel = this.state === 'playing' ? this.input.selected : null;
      if (sel && this.sim) {
        const st = sel.startsWith('b:')
          ? canBuild(this.sim, 0, sel.slice(2), Math.floor(this.input.hoverX), Math.floor(this.input.hoverY))
          : canCast(this.sim, 0, sel, this.input.hoverX, this.input.hoverY);
        const cursorState = st === 'ok' || st === 'cooldown' || st === 'faith' || st === 'range' || st === 'dead' ? st : 'faith';
        this.renderer.fx.updateCursor(sel, this.input.hoverX, this.input.hoverY,
          st === 'invalid' ? 'faith' : cursorState, this.sim.avatar(0));
      } else this.renderer.fx.updateCursor(null, 0, 0, 'hidden');
    }

    // 渲染 + HUD + 音频
    const alpha = this.state === 'playing' ? Math.min(1, this.acc / SIM_DT) : 1;
    this.renderer.update(dt, alpha, now / 1000);
    this.hud?.update(this.renderer.fps, this.showDebug, this.sim.followers.length + this.sim.houses.length);
    this.audio.update(dt);

    // JS 主循环耗时统计（F3 面板 / window.__gfPerf 供自测脚本读取）
    const jsMs = performance.now() - frameT0;
    const p = perfStats;
    p.acc += jsMs; p.n++; if (jsMs > p.peak) p.peak = jsMs;
    if (p.n >= 60) { p.avg = p.acc / p.n; p.lastPeak = p.peak; p.acc = 0; p.n = 0; p.peak = 0; }
  };
}

// ── 启动 & 错误兜底 ───────────────────────────────────
window.addEventListener('error', (e) => {
  console.error(e.error);
  if (document.getElementById('screen-loading') && !document.getElementById('screen-loading')!.classList.contains('hidden'))
    fatalError(e.message || '未知错误');
});
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
});

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

// 帧耗时统计（自测/调优用）
const perfStats = { acc: 0, n: 0, peak: 0, avg: 0, lastPeak: 0 };
(window as unknown as { __gfPerf: typeof perfStats }).__gfPerf = perfStats;

if (typeof PIXI === 'undefined') {
  fatalError('渲染库加载失败，请检查网络后刷新');
} else {
  new Game().boot().catch((e) => { console.error(e); fatalError((e as Error).message); });
}
