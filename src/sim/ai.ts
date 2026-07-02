// 绯红邪神 AI：EXPAND / HARASS / DEFEND / CATACLYSM 状态机（见 DESIGN.md §6）
// 与玩家共用 cast() 入口，无资源作弊；难度只影响决策频率与失误率。
import { MAP, AI_TICK_S, AI_FUMBLE } from '../core/const';
import { Sim } from './sim';
import { cast, canCast, miracleCost } from './miracles';

export type Difficulty = 'easy' | 'normal' | 'hard';
const F = 1; // AI 阵营

export class EnemyGod {
  private sim: Sim;
  private timer = 3;   // 开局缓 3 秒
  difficulty: Difficulty;

  constructor(sim: Sim, difficulty: Difficulty) {
    this.sim = sim;
    this.difficulty = difficulty;
  }

  tick(dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = AI_TICK_S[this.difficulty];
    if (this.sim.rng.chance(AI_FUMBLE[this.difficulty])) return; // 失误：空转

    const sim = this.sim, fs = sim.factions[F];
    const cap = sim.faithCap(F);
    const myPop = sim.pop(F), plPop = sim.pop(0);

    // CATACLYSM：信仰充沛时的大招
    if (fs.faith > cap * 0.85) {
      if (myPop > plPop * 1.1 && this.tryCataclysmVolcano()) return;
      if (myPop < plPop * 0.9 && this.tryFlood()) return;
    }
    // DEFEND：近期损失惨重
    if (fs.lossesRecent >= 3 && this.tryDefend()) return;
    // HARASS：信仰过 40% 上限
    if (fs.faith > cap * 0.4 && this.tryHarass()) return;
    // EXPAND：默认整地扩张
    this.tryExpand();
  }

  /** 玩家人口最密的粗网格（8×8 桶）中心 */
  private playerHotspot(): { x: number; y: number } | null {
    const B = 16, cell = MAP / B;
    const density = new Float32Array(B * B);
    for (const f of this.sim.followers) if (f.faction === 0)
      density[Math.min(B - 1, Math.floor(f.y / cell)) * B + Math.min(B - 1, Math.floor(f.x / cell))] += 1;
    for (const h of this.sim.houses) if (h.faction === 0)
      density[Math.min(B - 1, Math.floor(h.ty / cell)) * B + Math.min(B - 1, Math.floor(h.tx / cell))] += 2 + h.occupants;
    let best = -1, bi = -1;
    for (let i = 0; i < density.length; i++) if (density[i] > best) { best = density[i]; bi = i; }
    if (best <= 0) return null;
    return { x: (bi % B) * cell + cell / 2, y: Math.floor(bi / B) * cell + cell / 2 };
  }

  private tryCataclysmVolcano(): boolean {
    const hot = this.playerHotspot();
    if (!hot) return false;
    return cast(this.sim, F, 'volcano', hot.x, hot.y) === 'ok';
  }

  private tryFlood(): boolean {
    // 只有自家平均地势高于玩家时洪水才划算
    const myA = this.avgHomeHeight(F), plA = this.avgHomeHeight(0);
    if (myA <= plA + 0.5) return false;
    return cast(this.sim, F, 'flood', 0, 0) === 'ok';
  }

  private avgHomeHeight(faction: number): number {
    let s = 0, n = 0;
    for (const h of this.sim.houses) if (h.faction === faction) { s += this.sim.world.tileAvgH(h.tx, h.ty); n++; }
    if (n === 0) { const sp = this.sim.world.spawns[faction]; return this.sim.world.tileAvgH(Math.floor(sp.x), Math.floor(sp.y)); }
    return s / n;
  }

  private tryDefend(): boolean {
    // 受创房屋区祝福
    let worst: { x: number; y: number } | null = null, worstHp = 1;
    for (const h of this.sim.houses) if (h.faction === F) {
      const ratio = h.hp / 90;
      if (ratio < worstHp) { worstHp = ratio; worst = { x: h.tx + 0.5, y: h.ty + 0.5 }; }
    }
    if (worst && worstHp < 0.8) return cast(this.sim, F, 'bless', worst.x, worst.y) === 'ok';
    return false;
  }

  private tryHarass(): boolean {
    const hot = this.playerHotspot();
    if (!hot) return false;
    const roll = this.sim.rng.next();
    const pick = roll < 0.5 ? 'lightning' : roll < 0.8 ? 'swamp' : 'quake';
    // 雷劈具体目标：热点附近的玩家房屋优先
    if (pick === 'lightning') {
      let target: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (const h of this.sim.houses) if (h.faction === 0) {
        const d = (h.tx - hot.x) ** 2 + (h.ty - hot.y) ** 2;
        if (d < bestD) { bestD = d; target = { x: h.tx + 0.5, y: h.ty + 0.5 }; }
      }
      if (!target) {
        for (const f of this.sim.followers) if (f.faction === 0) { target = { x: f.x, y: f.y }; break; }
      }
      if (!target) return false;
      return cast(this.sim, F, 'lightning', target.x, target.y) === 'ok';
    }
    return cast(this.sim, F, pick, hot.x, hot.y) === 'ok';
  }

  private tryExpand(): boolean {
    const sim = this.sim, w = sim.world;
    // 若可建地充足则攒钱；不足则整地
    const anchor = sim.factionAnchor(F);
    let flat = 0;
    for (let y = Math.floor(anchor.y) - 8; y <= anchor.y + 8; y++)
      for (let x = Math.floor(anchor.x) - 8; x <= anchor.x + 8; x++)
        if (w.isBuildable(x, y, sim.time) && sim.occupancy[y * MAP + x] < 0) flat++;
    const idle = sim.followers.filter(f => f.faction === F).length;
    if (flat > Math.max(6, idle)) return false;

    // 找领土边缘的近平缓格来 raise/lower 整平（避开自家房屋，别拆自己城）
    for (let attempt = 0; attempt < 10; attempt++) {
      const ang = sim.rng.range(0, Math.PI * 2), r = sim.rng.range(4, 11);
      const cx = Math.round(anchor.x + Math.cos(ang) * r), cy = Math.round(anchor.y + Math.sin(ang) * r);
      if (cx < 3 || cy < 3 || cx > MAP - 3 || cy > MAP - 3) continue;
      let nearOwnHouse = false;
      for (const hh of sim.houses) {
        if (hh.faction === F && Math.abs(hh.tx - cx) <= 3 && Math.abs(hh.ty - cy) <= 3) { nearOwnHouse = true; break; }
      }
      if (nearOwnHouse) continue;
      const h = w.cornerH(cx, cy);
      if (h <= w.waterLevel) {
        // 浅水抬升成陆
        if (h >= w.waterLevel - 1 && canCast(sim, F, 'raise', cx, cy) === 'ok')
          return cast(sim, F, 'raise', cx, cy) === 'ok';
      } else if (w.tileMaxH(cx, cy) - w.tileMinH(cx, cy) >= 1 && w.tileAvgH(cx, cy) > w.waterLevel + 2) {
        // 崎岖高地削平
        if (sim.factions[F].faith > miracleCost(sim, 'lower') * 4 && canCast(sim, F, 'lower', cx, cy) === 'ok')
          return cast(sim, F, 'lower', cx, cy) === 'ok';
      } else if (w.tileMaxH(cx, cy) - w.tileMinH(cx, cy) >= 1) {
        if (canCast(sim, F, 'raise', cx, cy) === 'ok') return cast(sim, F, 'raise', cx, cy) === 'ok';
      }
    }
    // 领土远征：把图腾插到新平原引导移民
    if (sim.rng.chance(0.15)) {
      const ang = sim.rng.range(0, Math.PI * 2), r = sim.rng.range(8, 16);
      const x = anchor.x + Math.cos(ang) * r, y = anchor.y + Math.sin(ang) * r;
      if (x > 2 && y > 2 && x < MAP - 2 && y < MAP - 2 && !w.isWater(Math.floor(x), Math.floor(y)))
        return cast(sim, F, 'totem', x, y) === 'ok';
    }
    return false;
  }
}
