// 绯红邪神 AI：EXPAND / HARASS / DEFEND / CATACLYSM 状态机（见 DESIGN.md §6）
// 与玩家共用 cast() 入口，无资源作弊；难度只影响决策频率与失误率。
import { MAP, AI_TICK_S, AI_FUMBLE, CAST_RANGE, AVATAR_HP } from '../core/const';
import { Sim } from './sim';
import { cast, canCast, miracleCost, placeBuilding, canBuild } from './miracles';
import { FClass } from './entities';

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
    const av = sim.avatar(F);
    const cap = sim.faithCap(F);
    const myPop = sim.pop(F), plPop = sim.pop(0);

    // 化身走位优先级：殒落等转生 > 残血逃生（神行优先）> 任务走位
    if (!av.alive) return;
    if (av.hp < AVATAR_HP * 0.35) {
      const home = sim.factionAnchor(F);
      // 危急时刻神行瞬移回家（比走路稳）
      if (av.hp < AVATAR_HP * 0.2 && canCast(sim, F, 'teleport', home.x, home.y) === 'ok') {
        cast(sim, F, 'teleport', home.x, home.y);
        return;
      }
      sim.commandAvatar(F, home.x, home.y);
      if (this.tryDefend()) return;
      return;
    }

    // CATACLYSM：信仰充沛时的大招
    if (fs.faith > cap * 0.85) {
      if (myPop > plPop * 1.1 && this.tryCataclysmVolcano()) return;
      if (myPop < plPop * 0.9 && this.tryFlood()) return;
      if (this.tryFirestorm()) return;
    }
    // DEFEND：近期损失惨重
    if (fs.lossesRecent >= 3 && this.tryDefend()) return;
    // MILITARIZE：人口/信仰过阈值后建军事设施（有屋才有兵源）
    if (myPop >= 14 && this.tryMilitarize()) return;
    // HARASS：信仰过 40% 上限
    if (fs.faith > cap * 0.4 && this.tryHarass()) return;
    // EXPAND：默认整地扩张
    this.tryExpand();
  }

  private tryFirestorm(): boolean {
    const target = this.nearestPlayerAsset();
    if (!target) return false;
    if (!this.approach(target.x, target.y)) return true;
    return cast(this.sim, F, 'firestorm', target.x, target.y) === 'ok';
  }

  /** 建军：武堂→守卫塔→火祭坛→圣所，按数量缺口依次补 */
  private tryMilitarize(): boolean {
    const sim = this.sim;
    const mine = sim.mils.filter(m => m.faction === F);
    const count = (k: string) => mine.filter(m => m.kind === k).length;
    const myPop = sim.pop(F);
    let want: string | null = null;
    if (count('barracks') < 1) want = 'barracks';
    else if (count('tower') < Math.min(3, Math.floor(myPop / 18))) want = 'tower';
    else if (count('mageschool') < 1 && myPop > 26) want = 'mageschool';
    else if (count('sanctum') < 1 && myPop > 36) want = 'sanctum';
    if (!want) return false;
    // 选址：锚点附近可建格（塔偏向前线方向=面向玩家出生地）
    const anchor = sim.factionAnchor(F);
    const toward = want === 'tower' ? 0.45 : 0;
    const pSpawn = sim.world.spawns[0];
    const bx = anchor.x + (pSpawn.x - anchor.x) * toward;
    const by = anchor.y + (pSpawn.y - anchor.y) * toward;
    for (let attempt = 0; attempt < 12; attempt++) {
      const tx = Math.round(bx + sim.rng.range(-5, 5)), ty = Math.round(by + sim.rng.range(-5, 5));
      const r = canBuild(sim, F, want, tx, ty);
      if (r === 'range') { this.approach(tx + 0.5, ty + 0.5); return true; }
      if (r === 'ok') return placeBuilding(sim, F, want, tx + 0.5, ty + 0.5) === 'ok';
    }
    return false;
  }

  /** 目标超出祈告半径 → 命令化身逼近（停在半径 70% 处，别送到人堆里），返回是否已在射程 */
  private approach(x: number, y: number): boolean {
    const sim = this.sim, av = sim.avatar(F);
    const dx = x - av.x, dy = y - av.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= CAST_RANGE * 0.95) return true;
    const stop = d - CAST_RANGE * 0.7;
    sim.commandAvatar(F, av.x + (dx / d) * stop, av.y + (dy / d) * stop);
    return false;
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
    if (!this.approach(hot.x, hot.y)) return true; // 在路上（本 tick 已消费）
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
    if (worst && worstHp < 0.8) {
      if (!this.approach(worst.x, worst.y)) return true;
      return cast(this.sim, F, 'bless', worst.x, worst.y) === 'ok';
    }
    return false;
  }

  /** 离己方化身最近的玩家资产（房屋权重高）——短途骚扰，别横穿地图送头 */
  private nearestPlayerAsset(): { x: number; y: number } | null {
    const av = this.sim.avatar(F);
    let best: { x: number; y: number } | null = null, bd = Infinity;
    for (const h of this.sim.houses) if (h.faction === 0) {
      const d = (h.tx + 0.5 - av.x) ** 2 + (h.ty + 0.5 - av.y) ** 2;
      if (d < bd) { bd = d; best = { x: h.tx + 0.5, y: h.ty + 0.5 }; }
    }
    if (!best) {
      for (const f of this.sim.followers) if (f.faction === 0) {
        const d = (f.x - av.x) ** 2 + (f.y - av.y) ** 2;
        if (d < bd) { bd = d; best = { x: f.x, y: f.y }; }
      }
    }
    return best;
  }

  private tryHarass(): boolean {
    const target = this.nearestPlayerAsset();
    if (!target) return false;
    const roll = this.sim.rng.next();
    const pick = roll < 0.5 ? 'lightning' : roll < 0.8 ? 'swamp' : 'quake';
    if (!this.approach(target.x, target.y)) return true;
    return cast(this.sim, F, pick, target.x, target.y) === 'ok';
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
      const tryShape = (id: 'raise' | 'lower'): boolean | null => {
        const r = canCast(sim, F, id, cx, cy);
        if (r === 'range') { this.approach(cx, cy); return true; }   // 走位过去，本 tick 消费
        if (r === 'ok') return cast(sim, F, id, cx, cy) === 'ok';
        return null;
      };
      if (h <= w.waterLevel) {
        // 浅水抬升成陆
        if (h >= w.waterLevel - 1) { const r = tryShape('raise'); if (r !== null) return r; }
      } else if (w.tileMaxH(cx, cy) - w.tileMinH(cx, cy) >= 1 && w.tileAvgH(cx, cy) > w.waterLevel + 2) {
        // 崎岖高地削平
        if (sim.factions[F].faith > miracleCost(sim, 'lower') * 4) { const r = tryShape('lower'); if (r !== null) return r; }
      } else if (w.tileMaxH(cx, cy) - w.tileMinH(cx, cy) >= 1) {
        const r = tryShape('raise'); if (r !== null) return r;
      }
    }
    // 领土远征：把图腾插到新平原引导移民
    if (sim.rng.chance(0.15)) {
      const ang = sim.rng.range(0, Math.PI * 2), r = sim.rng.range(8, 16);
      const x = anchor.x + Math.cos(ang) * r, y = anchor.y + Math.sin(ang) * r;
      if (x > 2 && y > 2 && x < MAP - 2 && y < MAP - 2 && !w.isWater(Math.floor(x), Math.floor(y))) {
        if (!this.approach(x, y)) return true;
        return cast(sim, F, 'totem', x, y) === 'ok';
      }
    }
    // 无事可做：化身回巢休整
    if (sim.rng.chance(0.3)) sim.commandAvatar(F, anchor.x + sim.rng.range(-3, 3), anchor.y + sim.rng.range(-3, 3));
    return false;
  }
}
