// HUD：信仰条 / 神迹栏（费用·冷却·热键·选中态）/ 计时 / toast / 调试面板。
// 纯 DOM，读取 sim 状态每帧刷新；交互回调交给 Game 编排。
import { MIRACLES, ARMAGEDDON_S } from '../core/const';
import { Sim } from '../sim/sim';
import { miracleCost } from '../sim/miracles';
import { AssetDb } from '../assets/loader';
import { EventBus } from '../core/events';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export interface HudCallbacks {
  onSelect(id: string | null): void;
  onPause(): void;
  onToggleSound(): void;
  onOpenSettings(): void;
  onSpeed(): number;      // 循环 1→2→3→1，返回新速度
  onHover(): void;
}

export class Hud {
  selected: string | null = null;
  private sim: Sim;
  private slots = new Map<string, HTMLButtonElement>();
  private cb: HudCallbacks;
  private lastFaith = -1;

  constructor(sim: Sim, assets: AssetDb, bus: EventBus, cb: HudCallbacks) {
    this.sim = sim; this.cb = cb;
    $('faith-emblem').setAttribute('src', assets.uiUrl('emblem'));

    // 神迹栏
    const bar = $('miracle-bar');
    bar.innerHTML = '';
    for (const m of MIRACLES) {
      const b = document.createElement('button');
      b.className = 'miracle-slot';
      b.innerHTML = `<img src="${assets.iconUrl(m.icon)}" alt="${m.name}" draggable="false">
        <span class="cd" style="--cd:0"></span><span class="cd-num"></span>
        <span class="hotkey">${m.hotkey}</span><span class="cost">${m.cost}</span>`;
      b.addEventListener('click', () => { this.cb.onSelect(this.selected === m.id ? null : m.id); });
      b.addEventListener('mouseenter', () => { this.showTip(m.id); this.cb.onHover(); });
      b.addEventListener('mouseleave', () => this.hideTip());
      bar.appendChild(b);
      this.slots.set(m.id, b);
    }

    $('btn-pause').addEventListener('click', () => this.cb.onPause());
    $('btn-settings').addEventListener('click', () => this.cb.onOpenSettings());
    $('btn-sound').addEventListener('click', () => this.cb.onToggleSound());
    $('btn-speed').addEventListener('click', () => { $('btn-speed').textContent = `${this.cb.onSpeed()}×`; });

    bus.on('miracleDenied', (e) => {
      const slot = this.slots.get(e.id);
      if (slot) { slot.classList.remove('deny'); void slot.offsetWidth; slot.classList.add('deny'); }
      if (e.reason === 'faith') this.toast('信仰之力不足', 'warn');
      else if (e.reason === 'cooldown') this.toast('神迹尚在酝酿', 'warn');
    });
    bus.on('toast', (e) => this.toast(e.text, e.kind));
    bus.on('armageddon', () => this.toast('终焉审判降临！神力奔涌！', 'warn'));
  }

  setSelected(id: string | null): void {
    this.selected = id;
    for (const [mid, slot] of this.slots) slot.classList.toggle('selected', mid === id);
    if (id) this.showTip(id); else this.hideTip();
  }

  private showTip(id: string): void {
    const m = MIRACLES.find(mm => mm.id === id)!;
    $('tip-name').textContent = m.name;
    $('tip-cost').textContent = `❖ ${miracleCost(this.sim, id)} 信仰${m.cooldown ? ` · 冷却 ${m.cooldown}s` : ''}`;
    $('tip-desc').textContent = m.desc;
    $('miracle-tip').classList.remove('hidden');
  }
  private hideTip(): void {
    if (this.selected) { this.showTip(this.selected); return; }
    $('miracle-tip').classList.add('hidden');
  }

  toast(text: string, kind: 'info' | 'warn' | 'good' = 'info'): void {
    const layer = $('toast-layer');
    if (layer.children.length > 3) layer.firstChild?.remove();
    const el = document.createElement('div');
    el.className = `toast ${kind === 'info' ? '' : kind}`;
    el.textContent = text;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  update(fps: number, showDebug: boolean, entityCount: number): void {
    const sim = this.sim, fs = sim.factions[0];
    const cap = sim.faithCap(0);
    // 信仰条
    const faith = Math.floor(fs.faith);
    if (faith !== this.lastFaith) {
      this.lastFaith = faith;
      $('faith-fill').style.width = `${Math.min(100, fs.faith / cap * 100).toFixed(1)}%`;
      $('faith-num').textContent = `${faith} / ${Math.floor(cap)}`;
    }
    $('faith-regen').textContent = `+${sim.faithRegen(0).toFixed(1)}/s`;
    $('pop-own').textContent = String(sim.pop(0));
    $('pop-foe').textContent = String(sim.pop(1));

    // 时间 + 终焉倒计时
    const t = Math.floor(sim.time);
    $('game-time').textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    const toArm = ARMAGEDDON_S - sim.time;
    const banner = $('armageddon-banner');
    if (toArm <= 60 && toArm > 0) {
      banner.classList.remove('hidden');
      $('armageddon-count').textContent = `${Math.ceil(toArm)}s`;
    } else if (sim.armageddonFired) {
      banner.classList.remove('hidden');
      $('armageddon-count').textContent = '· 神力三倍奔涌';
    } else banner.classList.add('hidden');

    // 神迹槽状态
    for (const m of MIRACLES) {
      const slot = this.slots.get(m.id)!;
      const cost = miracleCost(sim, m.id);
      (slot.querySelector('.cost') as HTMLElement).textContent = String(cost);
      slot.classList.toggle('insufficient', fs.faith < cost);
      const cdEl = slot.querySelector('.cd') as HTMLElement;
      const cdNum = slot.querySelector('.cd-num') as HTMLElement;
      const left = (fs.cooldowns[m.id] ?? 0) - sim.time;
      if (left > 0) {
        cdEl.style.setProperty('--cd', String(Math.min(1, left / m.cooldown)));
        cdNum.textContent = left > 0.9 ? String(Math.ceil(left)) : '';
      } else { cdEl.style.setProperty('--cd', '0'); cdNum.textContent = ''; }
    }

    // 调试
    const dbg = $('debug-overlay');
    if (showDebug) {
      dbg.classList.remove('hidden');
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      const perf = (window as unknown as { __gfPerf?: { avg: number; lastPeak: number } }).__gfPerf;
      dbg.textContent = `fps ${fps}` +
        (perf ? `\njs ${perf.avg.toFixed(1)}ms avg / ${perf.lastPeak.toFixed(1)}ms peak` : '') +
        `\nentities ${entityCount}\nsim t ${sim.time.toFixed(1)}s` +
        `\nheap ${mem ? (mem.usedJSHeapSize / 1048576).toFixed(0) + 'MB' : 'n/a'}`;
    } else dbg.classList.add('hidden');
  }

  show(): void { $('hud').classList.remove('hidden'); }
  hide(): void { $('hud').classList.add('hidden'); }
  setSoundIcon(muted: boolean): void { $('btn-sound').textContent = muted ? '♪̸' : '♪'; }
}
