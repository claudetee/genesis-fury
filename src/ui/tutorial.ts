// 教学引导：条件驱动的分步卡片。条件在游戏主循环里逐帧检查，达成自动进入下一步。
import { Sim } from '../sim/sim';
import { Camera } from '../render/camera';

const $ = (id: string): HTMLElement => document.getElementById(id)!;

interface Step {
  text: string;
  /** 达成条件（每帧轮询） */
  done: (ctx: TutorialCtx) => boolean;
}

export interface TutorialCtx {
  sim: Sim;
  cam: Camera;
  castCounts: Record<string, number>;
  camMoved: number;
  zoomChanged: number;
}

const STEPS: Step[] = [
  {
    text: '欢迎降临神座。<b>拖拽</b>（或 WASD）移动你的视界，俯瞰这片大地。',
    done: (c) => c.camMoved > 260,
  },
  {
    text: '用<b>滚轮</b>（或双指捏合）调整神视的高度。',
    done: (c) => c.zoomChanged > 0.25,
  },
  {
    text: '你的信徒需要平地。选择 <b>塑地·隆起</b>（热键 1），按住海岸把大地抬升出来。',
    done: (c) => (c.castCounts['raise'] ?? 0) >= 3,
  },
  {
    text: '很好。信徒会自行寻找平地<b>定居建屋</b>——房屋产出信仰，等一座新居落成。',
    done: (c) => c.sim.houses.filter(h => h.faction === 0 && h.buildProgress >= 1).length >= 2,
  },
  {
    text: '施放 <b>圣光祝福</b>（热键 3）在聚落上——治愈、加速繁衍，信仰随之滚滚而来。',
    done: (c) => (c.castCounts['bless'] ?? 0) >= 1,
  },
  {
    text: '东方的<b>绯红邪神</b>正在扩张。用 <b>雷罚</b>（热键 4）劈碎他们的屋舍，直至邪教徒一个不剩。愿尘世归一。',
    done: (c) => (c.castCounts['lightning'] ?? 0) >= 1,
  },
];

export class Tutorial {
  active = false;
  private step = 0;
  private onDone: () => void;

  constructor(onDone: () => void) {
    this.onDone = onDone;
    // 持久 DOM + 每局新 Tutorial 实例 → 用 onclick 赋值防跨局监听器累积
    ($('btn-tut-skip') as HTMLButtonElement).onclick = () => this.finish();
  }

  start(): void {
    this.active = true;
    this.step = 0;
    this.render();
  }

  update(ctx: TutorialCtx): void {
    if (!this.active) return;
    if (STEPS[this.step].done(ctx)) {
      this.step++;
      if (this.step >= STEPS.length) { this.finish(); return; }
      this.render();
    }
  }

  private render(): void {
    $('tutorial-card').classList.remove('hidden');
    $('tutorial-text').innerHTML = STEPS[this.step].text;
    $('tutorial-step').textContent = `${this.step + 1}/${STEPS.length}`;
  }

  finish(): void {
    if (!this.active) return;
    this.active = false;
    $('tutorial-card').classList.add('hidden');
    this.onDone();
  }
}
