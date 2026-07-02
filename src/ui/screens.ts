// 屏幕流转：载入 → 标题 → (难度) → 游戏 ↔ 暂停/设置 → 结算。
// 同时负责把生成素材注入 CSS 变量（border-image / 标题大图）。
import { AssetDb } from '../assets/loader';
import { Settings, saveSettings, clearSave } from '../core/save';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export interface ScreenCallbacks {
  onNewGame(difficulty: string): void;
  onContinue(): void;
  onTutorial(): void;
  onResume(): void;
  onSaveQuit(): void;
  onAbandon(): void;
  onAgain(): void;
  onToTitle(): void;
  onSettingsChanged(s: Settings): void;
  onUiSound(kind: 'click' | 'hover'): void;
}

export class Screens {
  private settings: Settings;
  private cb: ScreenCallbacks;
  private settingsReturnTo: 'title' | 'pause' = 'title';

  constructor(settings: Settings, cb: ScreenCallbacks) {
    this.settings = settings; this.cb = cb;
    this.wire();
  }

  /** 素材注入：面板九宫格 / 标题背景 / 徽记 */
  applyAssets(db: AssetDb): void {
    const root = document.documentElement.style;
    root.setProperty('--img-panel', `url("${db.uiUrl('panel_stone')}")`);
    root.setProperty('--img-parch', `url("${db.uiUrl('parchment')}")`);
    root.setProperty('--img-btn', `url("${db.uiUrl('btn_stone')}")`);
    root.setProperty('--img-hero', `url("${db.uiUrl('title_hero')}")`);
    ($('title-emblem') as HTMLImageElement).src = db.uiUrl('emblem');
    ($('loading-emblem') as HTMLImageElement).src = db.uiUrl('emblem');
  }

  setLoadProgress(p: number, label: string): void {
    $('load-fill').style.width = `${Math.round(p * 100)}%`;
    $('load-label').textContent = label;
  }

  private showOnly(id: string | null): void {
    for (const s of document.querySelectorAll('#screen-layer .screen')) s.classList.add('hidden');
    if (id) $(id).classList.remove('hidden');
  }

  showLoading(): void { this.showOnly('screen-loading'); }
  showTitle(hasSave: boolean): void {
    this.showOnly('screen-title');
    $('btn-continue').classList.toggle('hidden', !hasSave);
  }
  showGame(): void { this.showOnly(null); }
  showPause(): void { this.showOnly('screen-pause'); }
  hideModal(): void { this.showOnly(null); }

  showEnd(victory: boolean, stats: { time: number; peakPop: number; casts: number; pop: number }): void {
    this.showOnly('screen-end');
    $('end-title').textContent = victory ? '尘世归一' : '诸神黄昏';
    ($('end-title')).style.color = victory ? '#6b4a14' : '#8a3428';
    $('end-flavor').textContent = victory
      ? '绯红的祭坛已然崩塌，万民匍匐于你的光辉之下。'
      : '你的圣名从大地上被抹去，唯余风声悼念。';
    const mm = Math.floor(stats.time / 60), ss = Math.floor(stats.time % 60);
    $('end-stats').innerHTML = [
      ['统治时长', `${mm}分${ss}秒`],
      ['信众峰值', String(stats.peakPop)],
      ['神迹施放', `${stats.casts} 次`],
      ['终局人口', String(stats.pop)],
    ].map(([k, v]) => `<div class="stat-cell"><span>${k}</span><b>${v}</b></div>`).join('');
    // 评级：胜利按效率
    let rating = '—';
    if (victory) {
      rating = stats.time < 420 ? 'S' : stats.time < 700 ? 'A' : stats.time < 1100 ? 'B' : 'C';
    }
    $('end-rating').textContent = rating;
  }

  openSettings(from: 'title' | 'pause'): void {
    this.settingsReturnTo = from;
    const s = this.settings;
    ($('set-master') as HTMLInputElement).value = String(s.masterVol);
    ($('set-music') as HTMLInputElement).value = String(s.musicVol);
    ($('set-sfx') as HTMLInputElement).value = String(s.sfxVol);
    ($('set-quality') as HTMLSelectElement).value = s.quality;
    ($('set-camspeed') as HTMLInputElement).value = String(s.camSpeed);
    ($('set-edge') as HTMLInputElement).checked = s.edgeScroll;
    this.showOnly('screen-settings');
  }

  private wire(): void {
    const click = (id: string, fn: () => void) => $(id).addEventListener('click', () => { this.cb.onUiSound('click'); fn(); });
    for (const b of document.querySelectorAll('button'))
      b.addEventListener('mouseenter', () => this.cb.onUiSound('hover'));

    click('btn-new', () => this.showOnly('screen-difficulty'));
    click('btn-diff-back', () => this.showTitle(true));
    for (const b of document.querySelectorAll<HTMLButtonElement>('.btn-diff'))
      b.addEventListener('click', () => { this.cb.onUiSound('click'); this.cb.onNewGame(b.dataset.diff!); });
    click('btn-continue', () => this.cb.onContinue());
    click('btn-tutorial', () => this.cb.onTutorial());
    click('btn-title-settings', () => this.openSettings('title'));
    click('btn-resume', () => this.cb.onResume());
    click('btn-pause-settings', () => this.openSettings('pause'));
    click('btn-save-quit', () => this.cb.onSaveQuit());
    click('btn-abandon', () => this.cb.onAbandon());
    click('btn-again', () => this.cb.onAgain());
    click('btn-to-title', () => this.cb.onToTitle());
    click('btn-clear-save', () => { clearSave(); $('btn-continue').classList.add('hidden'); });
    click('btn-settings-back', () => {
      if (this.settingsReturnTo === 'pause') this.showPause();
      else this.showTitle(!$('btn-continue').classList.contains('hidden'));
    });

    // 设置项即时生效
    const sync = () => {
      const s = this.settings;
      s.masterVol = parseFloat(($('set-master') as HTMLInputElement).value);
      s.musicVol = parseFloat(($('set-music') as HTMLInputElement).value);
      s.sfxVol = parseFloat(($('set-sfx') as HTMLInputElement).value);
      s.quality = ($('set-quality') as HTMLSelectElement).value as Settings['quality'];
      s.camSpeed = parseFloat(($('set-camspeed') as HTMLInputElement).value);
      s.edgeScroll = ($('set-edge') as HTMLInputElement).checked;
      saveSettings(s);
      this.cb.onSettingsChanged(s);
    };
    for (const id of ['set-master', 'set-music', 'set-sfx', 'set-quality', 'set-camspeed', 'set-edge'])
      $(id).addEventListener('input', sync);
  }
}

export function fatalError(msg: string): void {
  const el = document.getElementById('error-overlay');
  const detail = document.getElementById('error-detail');
  if (el && detail) {
    detail.textContent = `世界之线出现了裂痕：${msg}`;
    el.classList.remove('hidden');
  }
}
