// 模拟核心：固定步长 10Hz。信徒行为 / 房屋生长 / 战斗 / 信仰经济 / 终局判定。
// 渲染层通过位置插值消费；所有跨层通信走 EventBus。
import {
  MAP, SIM_DT, FAITH_BASE_REGEN, FAITH_PER_POP, FAITH_CAP_BASE, FAITH_CAP_PER_POP, FAITH_START,
  FOLLOWER_HP, FOLLOWER_DPS, FOLLOWER_SPEED, SWAMP_SPEED_MULT, SWAMP_DPS, POP_SOFT_EXTRA,
  START_FOLLOWERS, HOUSE_CAP, HOUSE_FAITH_MULT, HOUSE_HP, HOUSE_SPAWN_S, HOUSE_BUILD_S,
  FIRE_COLLAPSE_S, FLAT_FOR_LV2, FLAT_FOR_LV3, ARMAGEDDON_S, ARMAGEDDON_REGEN_MULT, FLOOD_DURATION,
} from '../core/const';
import { Rng } from '../core/rng';
import { EventBus } from '../core/events';
import { World, WorldSave } from './world';
import { Follower, House, Totem, Avatar, MilBuilding, FactionState, FState, FClass } from './entities';
import {
  AVATAR_HP, AVATAR_SPEED, AVATAR_REGEN, AVATAR_CONTACT_R, AVATAR_CONTACT_DPS,
  AVATAR_RESPAWN_S, AVATAR_INVULN_S,
  CLASS_HP, CLASS_DPS, CLASS_SPEED, TRAIN_COST, TRAIN_TIME,
  FIREMAGE_RANGE, FIREMAGE_DPS, FIREMAGE_SHOT_CD,
  PREACH_RANGE, PREACH_INTERVAL, PREACH_CHANCE,
  TOWER_HP, TOWER_RANGE, TOWER_DPS, TOWER_SHOT_CD, MIL_HP,
  WILDMEN_COUNT, WILD_FACTION, BUILDINGS,
} from '../core/const';

export class Sim {
  world: World;
  bus: EventBus;
  rng: Rng;
  time = 0;
  followers: Follower[] = [];
  houses: House[] = [];
  totems: Totem[] = [];
  avatars: Avatar[] = [];
  mils: MilBuilding[] = [];
  factions: FactionState[] = [];
  occupancy = new Int32Array(MAP * MAP).fill(-1);   // tile → house id
  reserved = new Int32Array(MAP * MAP).fill(-1);    // tile → builder follower id
  floodUntil = 0;
  armageddonFired = false;
  over: { victory: boolean } | null = null;
  private nextId = 1;
  private grid = new Map<number, Follower[]>();     // 空间哈希（4×4 tile 桶）
  private graceUntil = 5;                           // 开局保护期，不判胜负

  constructor(bus: EventBus, seed: number, world?: World) {
    this.bus = bus;
    this.rng = new Rng(seed ^ 0x9e3779b9);
    this.world = world ?? new World(bus, seed);
    this.factions = [0, 1].map(() => ({ faith: FAITH_START, cooldowns: {}, miracleCasts: 0, peakPop: 0, lossesRecent: 0 }));
    this.avatars = [0, 1].map(f => {
      const s = this.world.spawns[f];
      return { faction: f, x: s.x, y: s.y - 1.5, px: s.x, py: s.y - 1.5, hp: AVATAR_HP, alive: true, targetX: s.x, targetY: s.y - 1.5, respawnAt: 0, invulnUntil: 0, stuck: 0 };
    });
  }

  /** 新开一局：双方出生点各放初始信徒 + 全图散布中立野人 */
  seedStart(): void {
    for (let f = 0; f < 2; f++) {
      const s = this.world.spawns[f];
      for (let i = 0; i < START_FOLLOWERS; i++) {
        const a = (i / START_FOLLOWERS) * Math.PI * 2;
        this.spawnFollower(f, s.x + Math.cos(a) * 2.5, s.y + Math.sin(a) * 2.5);
      }
    }
    // 野人：远离双方出生地的可行走陆地
    let placed = 0, guard = 0;
    while (placed < WILDMEN_COUNT && guard++ < 800) {
      const x = this.rng.range(8, MAP - 8), y = this.rng.range(8, MAP - 8);
      if (!this.world.isWalkable(Math.floor(x), Math.floor(y), 0)) continue;
      let minD = 1e9;
      for (const s of this.world.spawns) minD = Math.min(minD, (x - s.x) ** 2 + (y - s.y) ** 2);
      if (minD < 18 * 18) continue;
      this.spawnFollower(WILD_FACTION, x, y);
      placed++;
    }
  }

  // ── 查询 ────────────────────────────────────────────
  pop(faction: number): number {
    let n = 0;
    for (const f of this.followers) if (f.faction === faction) n++;
    for (const h of this.houses) if (h.faction === faction) n += h.occupants;
    return n;
  }
  faithCap(faction: number): number { return FAITH_CAP_BASE + FAITH_CAP_PER_POP * this.pop(faction); }
  faithRegen(faction: number): number {
    let weighted = 0;
    for (const f of this.followers) if (f.faction === faction) weighted += 1;
    for (const h of this.houses) if (h.faction === faction && h.buildProgress >= 1)
      weighted += h.occupants * HOUSE_FAITH_MULT[h.level - 1];
    // 次线性：大帝国边际递减，防信仰爆表
    let r = FAITH_BASE_REGEN + FAITH_PER_POP * Math.pow(weighted, 0.88);
    if (this.time >= ARMAGEDDON_S) r *= ARMAGEDDON_REGEN_MULT;
    return r;
  }
  popCap(faction: number): number {
    let cap = POP_SOFT_EXTRA;
    for (const h of this.houses) if (h.faction === faction && h.buildProgress >= 1) cap += HOUSE_CAP[h.level - 1];
    return cap;
  }
  houseAt(tx: number, ty: number): House | null {
    if (tx < 0 || ty < 0 || tx >= MAP || ty >= MAP) return null;
    const id = this.occupancy[ty * MAP + tx];
    if (id < 0) return null;
    return this.houses.find(h => h.id === id) ?? null;
  }

  // ── 生成 ────────────────────────────────────────────
  spawnFollower(faction: number, x: number, y: number, cls: FClass = FClass.Brave): Follower {
    const f: Follower = {
      id: this.nextId++, faction, cls, x, y, px: x, py: y, hp: CLASS_HP[cls],
      state: FState.Wander, targetX: x, targetY: y, buildX: -1, buildY: -1,
      enemyId: -1, blessedUntil: 0, wanderTimer: 0, stuck: 0,
      shotCd: 0, preachCd: 0, trainId: -1,
    };
    this.followers.push(f);
    this.bus.emit('entitySpawn', { kind: 'follower', id: f.id, faction, x, y });
    return f;
  }

  // ── 军事建筑 ────────────────────────────────────────
  milAt(tx: number, ty: number): MilBuilding | null {
    for (const m of this.mils) if (m.tx === tx && m.ty === ty) return m;
    return null;
  }

  /** 营造：由神迹入口（miracles.placeBuilding）调用，地块合法性已验证 */
  placeMil(faction: number, kind: MilBuilding['kind'], tx: number, ty: number): MilBuilding {
    const m: MilBuilding = {
      id: this.nextId++, faction, kind, tx, ty,
      hp: kind === 'tower' ? TOWER_HP : MIL_HP,
      traineeId: -1, trainT: 0, shotCd: 0,
    };
    this.mils.push(m);
    this.occupancy[ty * MAP + tx] = m.id;   // 与房屋共用占位表（id 空间共享 nextId 不冲突）
    this.bus.emit('entitySpawn', { kind: 'mil', id: m.id, faction, x: tx + 0.5, y: ty + 0.5 });
    return m;
  }

  destroyMil(m: MilBuilding, cause: string): void {
    const i = this.mils.indexOf(m);
    if (i < 0) return;
    this.mils.splice(i, 1);
    if (this.occupancy[m.ty * MAP + m.tx] === m.id) this.occupancy[m.ty * MAP + m.tx] = -1;
    // 受训中的信徒放出
    if (m.traineeId >= 0) {
      const f = this.followers.find(ff => ff.id === m.traineeId);
      if (f) { f.state = FState.Wander; f.trainId = -1; f.wanderTimer = 0; }
    }
    this.bus.emit('entityDeath', { kind: 'mil', id: m.id, faction: m.faction, x: m.tx + 0.5, y: m.ty + 0.5, cause });
  }

  placeHouse(faction: number, tx: number, ty: number): House {
    const h: House = {
      id: this.nextId++, faction, tx, ty, level: 1, hp: 4, occupants: 1,
      buildProgress: 0, spawnTimer: 0, upgradeTimer: 0, fireUntil: 0, blessedUntil: 0, ejectTimer: 0,
    };
    this.houses.push(h);
    this.occupancy[ty * MAP + tx] = h.id;
    this.bus.emit('entitySpawn', { kind: 'house', id: h.id, faction, x: tx + 0.5, y: ty + 0.5 });
    return h;
  }

  placeTotem(faction: number, x: number, y: number, until: number): void {
    // 每方同时只有一个图腾
    this.totems = this.totems.filter(t => t.faction !== faction);
    const t: Totem = { id: this.nextId++, faction, x, y, until };
    this.totems.push(t);
    this.bus.emit('totemPlaced', { x, y, faction });
  }

  // ── 主循环 ──────────────────────────────────────────
  tick(): void {
    if (this.over) return;
    this.time += SIM_DT;
    const t = this.time;

    // 信仰回复
    for (let f = 0; f < 2; f++) {
      const fs = this.factions[f];
      fs.faith = Math.min(this.faithCap(f), fs.faith + this.faithRegen(f) * SIM_DT);
      fs.lossesRecent = Math.max(0, fs.lossesRecent - SIM_DT / 8 * 4);
      const p = this.pop(f);
      if (p > fs.peakPop) fs.peakPop = p;
    }

    // 洪水退去
    if (this.floodUntil > 0 && t >= this.floodUntil) {
      this.floodUntil = 0;
      this.world.setWaterLevel(this.world.baseWaterLevel);
      this.bus.emit('floodEnd', {});
    }

    // 终焉审判
    if (!this.armageddonFired && t >= ARMAGEDDON_S) {
      this.armageddonFired = true;
      this.bus.emit('armageddon', {});
    }

    this.totems = this.totems.filter(tt => tt.until > t);
    this.rebuildGrid();
    this.tickAvatars();
    this.tickFollowers();
    this.tickHouses();
    this.tickMils();
    this.tickFirestorms();
    this.checkGameOver();
  }

  // ── Firestorm ───────────────────────────────────────
  firestorms: { x: number; y: number; until: number; acc: number }[] = [];

  startFirestorm(x: number, y: number): void {
    this.firestorms.push({ x, y, until: this.time + 8, acc: 0 });
  }

  private tickFirestorms(): void {
    const t = this.time;
    for (let i = this.firestorms.length - 1; i >= 0; i--) {
      const fs = this.firestorms[i];
      if (t >= fs.until) { this.firestorms.splice(i, 1); continue; }
      fs.acc += SIM_DT;
      const interval = 8 / 22;   // FIRESTORM_DURATION / METEORS
      while (fs.acc >= interval) {
        fs.acc -= interval;
        const ang = this.rng.range(0, Math.PI * 2), r = Math.sqrt(this.rng.next()) * 8;
        const mx = fs.x + Math.cos(ang) * r, my = fs.y + Math.sin(ang) * r;
        this.bus.emit('meteor', { x: mx, y: my });
        // 杀伤：单位 + 点燃房屋 + 军事建筑掉血 + 焦痕
        for (const f of this.followers)
          if ((f.x - mx) ** 2 + (f.y - my) ** 2 <= 1.4 * 1.4) f.hp -= 8;
        const h = this.houseAt(Math.floor(mx), Math.floor(my));
        if (h) { h.hp -= 12; if (h.fireUntil <= t) { h.fireUntil = t + 999; this.bus.emit('fireStart', { id: h.id, x: h.tx + 0.5, y: h.ty + 0.5 }); } }
        const m = this.milAt(Math.floor(mx), Math.floor(my));
        if (m) { m.hp -= 16; if (m.hp <= 0) this.destroyMil(m, 'firestorm'); }
        const ti = Math.floor(my) * MAP + Math.floor(mx);
        if (ti >= 0 && ti < MAP * MAP) this.world.scorched[ti] = 1;
      }
    }
  }

  // ── 军事建筑 tick：训练招募 + 守卫塔火力 + 环境毁伤 ──
  private tickMils(): void {
    const t = this.time;
    const KIND_CLS: Record<string, FClass> = { barracks: FClass.Warrior, mageschool: FClass.FireMage, sanctum: FClass.Preacher };
    for (const m of [...this.mils]) {
      // 环境毁伤（与房屋同规则）
      if (this.world.isWater(m.tx, m.ty)) { this.destroyMil(m, 'flood'); continue; }
      if (this.world.isLava(m.tx, m.ty, t)) { this.destroyMil(m, 'lava'); continue; }
      if (!this.tileStillFlat(m.tx, m.ty)) { this.destroyMil(m, 'terrain'); continue; }
      if (m.hp <= 0) { this.destroyMil(m, 'razed'); continue; }

      if (m.kind === 'tower') {
        m.shotCd -= SIM_DT;
        if (m.shotCd <= 0) {
          // 最近敌单位（塔不打野人）
          let best: Follower | null = null, bd = TOWER_RANGE * TOWER_RANGE;
          this.nearbyFollowers(m.tx + 0.5, m.ty + 0.5, TOWER_RANGE, this.scratch);
          for (const f of this.scratch) {
            if (f.faction === m.faction || f.faction === WILD_FACTION || f.hp <= 0) continue;
            const d = (f.x - m.tx - 0.5) ** 2 + (f.y - m.ty - 0.5) ** 2;
            if (d < bd) { bd = d; best = f; }
          }
          // 也狙敌方神使
          const ea = this.avatars[1 - m.faction];
          if (!best && ea?.alive && (ea.x - m.tx - 0.5) ** 2 + (ea.y - m.ty - 0.5) ** 2 <= TOWER_RANGE * TOWER_RANGE && t >= ea.invulnUntil) {
            ea.hp -= TOWER_DPS * TOWER_SHOT_CD;
            this.bus.emit('fireShot', { fx: m.tx + 0.5, fy: m.ty + 0.5, tx: ea.x, ty: ea.y, tower: true });
            m.shotCd = TOWER_SHOT_CD;
          } else if (best) {
            best.hp -= TOWER_DPS * TOWER_SHOT_CD;
            this.bus.emit('fireShot', { fx: m.tx + 0.5, fy: m.ty + 0.5, tx: best.x, ty: best.y, tower: true });
            m.shotCd = TOWER_SHOT_CD;
          }
        }
        continue;
      }

      // 训练屋：招募闲置信徒
      if (m.traineeId < 0) {
        const cost = TRAIN_COST[KIND_CLS[m.kind]];
        if (this.factions[m.faction].faith >= cost) {
          this.nearbyFollowers(m.tx + 0.5, m.ty + 0.5, 8, this.scratch);
          for (const f of this.scratch) {
            if (f.faction !== m.faction || f.cls !== FClass.Brave || f.hp <= 0) continue;
            if (f.state !== FState.Wander) continue;
            this.factions[m.faction].faith -= cost;
            f.state = FState.Train; f.trainId = m.id;
            m.traineeId = f.id; m.trainT = 0;
            break;
          }
        }
      } else {
        const f = this.followers.find(ff => ff.id === m.traineeId);
        if (!f || f.hp <= 0 || f.state !== FState.Train) { m.traineeId = -1; m.trainT = 0; continue; }
        // 学徒到位后计时
        if ((f.x - m.tx - 0.5) ** 2 + (f.y - m.ty - 0.5) ** 2 < 1.2) {
          m.trainT += SIM_DT;
          if (m.trainT >= TRAIN_TIME) {
            const cls = KIND_CLS[m.kind];
            f.cls = cls; f.hp = CLASS_HP[cls];
            f.state = FState.Wander; f.trainId = -1; f.wanderTimer = 0;
            m.traineeId = -1; m.trainT = 0;
            this.bus.emit('classTrained', { id: f.id, faction: f.faction, cls, x: f.x, y: f.y });
          }
        }
      }
    }
  }

  // ── 神使化身 ────────────────────────────────────────
  avatar(faction: number): Avatar { return this.avatars[faction]; }

  /** 移动令（玩家点地 / AI 走位） */
  commandAvatar(faction: number, x: number, y: number): boolean {
    const a = this.avatars[faction];
    if (!a.alive) return false;
    a.targetX = Math.max(0.5, Math.min(MAP - 0.5, x));
    a.targetY = Math.max(0.5, Math.min(MAP - 0.5, y));
    if (faction === 0) this.bus.emit('avatarMove', { x: a.targetX, y: a.targetY });
    return true;
  }

  private tickAvatars(): void {
    const t = this.time;
    for (const a of this.avatars) {
      if (!a.alive) {
        if (t >= a.respawnAt) {
          const anchor = this.factionAnchor(a.faction);
          a.alive = true; a.hp = AVATAR_HP;
          a.x = a.px = anchor.x; a.y = a.py = anchor.y;
          a.targetX = a.x; a.targetY = a.y;
          a.invulnUntil = t + AVATAR_INVULN_S;
          this.bus.emit('avatarRespawn', { faction: a.faction, x: a.x, y: a.y });
        }
        continue;
      }
      a.px = a.x; a.py = a.y;

      // 移动（可穿沼泽但减速；水/岩浆不可入）
      const dx = a.targetX - a.x, dy = a.targetY - a.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const inSwamp = this.world.isSwamp(Math.floor(a.x), Math.floor(a.y), t);
      if (d > 0.1) {
        const speed = AVATAR_SPEED * (inSwamp ? 0.45 : 1);
        const step = Math.min(d, speed * SIM_DT);
        let nx = a.x + (dx / d) * step, ny = a.y + (dy / d) * step;
        if (!this.world.isWalkable(Math.floor(nx), Math.floor(ny), t)) {
          if (this.world.isWalkable(Math.floor(nx), Math.floor(a.y), t)) ny = a.y;
          else if (this.world.isWalkable(Math.floor(a.x), Math.floor(ny), t)) nx = a.x;
          else {
            a.stuck++;
            if (a.stuck > 6) { a.targetX = a.x; a.targetY = a.y; a.stuck = 0; }
            continue;
          }
        }
        a.stuck = 0;
        a.x = Math.max(0.5, Math.min(MAP - 0.5, nx));
        a.y = Math.max(0.5, Math.min(MAP - 0.5, ny));
      }

      // 环境伤害 + 敌信徒围攻（接触光环，无逐徒状态）
      const tx = Math.floor(a.x), ty = Math.floor(a.y);
      if (t >= a.invulnUntil) {
        if (this.world.isWater(tx, ty)) a.hp -= 5 * SIM_DT;
        if (this.world.isLava(tx, ty, t)) a.hp -= 12 * SIM_DT;
        this.nearbyFollowers(a.x, a.y, AVATAR_CONTACT_R, this.scratch);
        let attackers = 0;
        for (const f of this.scratch) if (f.faction !== a.faction && f.hp > 0) attackers++;
        if (attackers > 0) {
          a.hp -= Math.min(5, attackers) * AVATAR_CONTACT_DPS * SIM_DT;
          if (this.rng.chance(0.05)) this.bus.emit('combat', { x: a.x, y: a.y });
        } else if (a.hp < AVATAR_HP) {
          a.hp = Math.min(AVATAR_HP, a.hp + AVATAR_REGEN * SIM_DT);
        }
      }

      if (a.hp <= 0) {
        a.alive = false;
        a.respawnAt = t + AVATAR_RESPAWN_S;
        this.factions[a.faction].lossesRecent += 2;
        this.bus.emit('avatarDeath', { faction: a.faction, x: a.x, y: a.y });
      }
    }
  }

  private rebuildGrid(): void {
    this.grid.clear();
    for (const f of this.followers) {
      const key = (Math.floor(f.y / 4) * 64 + Math.floor(f.x / 4)) | 0;
      let arr = this.grid.get(key);
      if (!arr) { arr = []; this.grid.set(key, arr); }
      arr.push(f);
    }
  }

  private nearbyFollowers(x: number, y: number, r: number, out: Follower[]): void {
    out.length = 0;
    const gx0 = Math.floor((x - r) / 4), gx1 = Math.floor((x + r) / 4);
    const gy0 = Math.floor((y - r) / 4), gy1 = Math.floor((y + r) / 4);
    for (let gy = gy0; gy <= gy1; gy++)
      for (let gx = gx0; gx <= gx1; gx++) {
        const arr = this.grid.get((gy * 64 + gx) | 0);
        if (arr) for (const f of arr) {
          const dx = f.x - x, dy = f.y - y;
          if (dx * dx + dy * dy <= r * r) out.push(f);
        }
      }
  }

  // ── 信徒 ────────────────────────────────────────────
  private scratch: Follower[] = [];
  private tickFollowers(): void {
    const t = this.time, w = this.world;
    const dead: Follower[] = [];

    for (const f of this.followers) {
      f.px = f.x; f.py = f.y;
      const tx = Math.floor(f.x), ty = Math.floor(f.y);
      const maxHp = CLASS_HP[f.cls];

      // 环境伤害
      if (w.isWater(tx, ty)) f.hp -= 5 * SIM_DT;                    // 溺水
      if (w.isLava(tx, ty, t)) f.hp -= 12 * SIM_DT;                 // 岩浆
      const inSwamp = w.isSwamp(tx, ty, t);
      if (inSwamp && f.blessedUntil < t) f.hp -= SWAMP_DPS * SIM_DT;
      if (f.blessedUntil > t) f.hp = Math.min(maxHp, f.hp + 1.5 * SIM_DT);
      if (f.hp <= 0) { dead.push(f); continue; }
      f.shotCd -= SIM_DT; f.preachCd -= SIM_DT;

      // 野人：只漫游，不战斗不定居
      if (f.faction === WILD_FACTION) {
        f.wanderTimer -= SIM_DT;
        if (f.wanderTimer <= 0) {
          f.wanderTimer = this.rng.range(2, 5);
          f.targetX = f.x + this.rng.range(-5, 5);
          f.targetY = f.y + this.rng.range(-5, 5);
        }
        this.moveToward(f, f.targetX, f.targetY, t, inSwamp);
        continue;
      }

      // 受训：走向训练屋并等待
      if (f.state === FState.Train) {
        const m = this.mils.find(mm => mm.id === f.trainId);
        if (!m) { f.state = FState.Wander; f.trainId = -1; f.wanderTimer = 0; }
        else {
          if ((f.x - m.tx - 0.5) ** 2 + (f.y - m.ty - 0.5) ** 2 >= 1.0)
            this.moveToward(f, m.tx + 0.5, m.ty + 0.5, t, inSwamp);
          continue;
        }
      }

      // 火法师：远程射击（不进近战）
      if (f.cls === FClass.FireMage) {
        let target: Follower | null = null, bd = FIREMAGE_RANGE * FIREMAGE_RANGE;
        this.nearbyFollowers(f.x, f.y, FIREMAGE_RANGE, this.scratch);
        for (const e of this.scratch) {
          if (e.faction === f.faction || e.faction === WILD_FACTION || e.hp <= 0) continue;
          const d = dist2(f, e);
          if (d < bd) { bd = d; target = e; }
        }
        if (target) {
          if (bd < 2.2 * 2.2) this.moveToward(f, f.x + (f.x - target.x), f.y + (f.y - target.y), t, inSwamp); // 拉开距离
          else if (f.shotCd <= 0) {
            f.shotCd = FIREMAGE_SHOT_CD;
            target.hp -= FIREMAGE_DPS * FIREMAGE_SHOT_CD * (f.blessedUntil > t ? 1.4 : 1);
            this.bus.emit('fireShot', { fx: f.x, fy: f.y, tx: target.x, ty: target.y, tower: false });
          }
          continue;
        }
      }

      // 传教士：不战斗，布道转化敌方信徒（仅普通信徒）
      if (f.cls === FClass.Preacher) {
        if (f.preachCd <= 0) {
          this.nearbyFollowers(f.x, f.y, PREACH_RANGE, this.scratch);
          for (const e of this.scratch) {
            if (e.faction === f.faction || e.faction === WILD_FACTION || e.cls !== FClass.Brave || e.hp <= 0) continue;
            f.preachCd = PREACH_INTERVAL;
            if (this.rng.chance(PREACH_CHANCE)) {
              e.faction = f.faction;
              e.state = FState.Wander; e.enemyId = -1; e.wanderTimer = 0;
              this.releaseReservation(e);
              this.bus.emit('convert', { x: e.x, y: e.y, toFaction: f.faction });
            }
            break;
          }
        }
      }

      // 战斗：找 1.1 tile 内敌人（传教士不主动；野人不是目标；进战斗前释放建地预约）
      if (f.state !== FState.Fight && f.cls !== FClass.Preacher) {
        this.nearbyFollowers(f.x, f.y, 1.1, this.scratch);
        for (const e of this.scratch) {
          if (e.faction !== f.faction && e.faction !== WILD_FACTION && e.hp > 0) {
            this.releaseReservation(f);
            f.state = FState.Fight; f.enemyId = e.id; break;
          }
        }
      }

      if (f.state === FState.Fight) {
        const e = this.followers.find(o => o.id === f.enemyId);
        if (!e || e.hp <= 0 || dist2(f, e) > 2.5 * 2.5) { f.state = FState.Wander; f.enemyId = -1; f.wanderTimer = 0; }
        else {
          if (dist2(f, e) > 0.8) this.moveToward(f, e.x, e.y, t, inSwamp);
          else {
            e.hp -= CLASS_DPS[f.cls] * SIM_DT * (f.blessedUntil > t ? 1.5 : 1);
            if (this.rng.chance(0.02)) this.bus.emit('combat', { x: f.x, y: f.y });
          }
          continue;
        }
      }

      // 攻城：紧邻敌方建筑则拆（房屋/军事建筑）
      const razeDps = Math.max(CLASS_DPS[f.cls], FOLLOWER_DPS);
      const nearHouse = this.adjacentEnemyHouse(f);
      if (nearHouse) {
        nearHouse.hp -= razeDps * SIM_DT;
        nearHouse.ejectTimer += SIM_DT;
        if (this.rng.chance(0.02)) this.bus.emit('combat', { x: f.x, y: f.y });
        if (nearHouse.hp <= 0) this.destroyHouse(nearHouse, 'razed');
        continue;
      }
      const nearMil = this.adjacentEnemyMil(f);
      if (nearMil) {
        nearMil.hp -= razeDps * SIM_DT;
        if (this.rng.chance(0.02)) this.bus.emit('combat', { x: f.x, y: f.y });
        continue; // 摧毁判定在 tickMils
      }

      if (f.state === FState.Build) {
        // 建造中：地基仍可用？
        if (!w.isBuildable(f.buildX, f.buildY, t) || this.occupancy[f.buildY * MAP + f.buildX] >= 0) {
          this.releaseReservation(f); f.state = FState.Wander; f.wanderTimer = 0;
        } else {
          f.wanderTimer += SIM_DT;
          if (f.wanderTimer >= 1.2) { // 打地基动画时长
            const bx = f.buildX, by = f.buildY;   // ⚠️ 先取值再释放（release 会重置为 -1）
            this.releaseReservation(f);
            this.placeHouse(f.faction, bx, by);
            dead.push(f); // 建造者迁入新居（非死亡：不发 death 事件，见下方过滤）
            (f as { settled?: boolean }).settled = true;
          }
        }
        continue;
      }

      if (f.state === FState.Seek) {
        if (!w.isBuildable(f.buildX, f.buildY, t) || this.reservedByOther(f) || this.occupancy[f.buildY * MAP + f.buildX] >= 0) {
          this.releaseReservation(f); f.state = FState.Wander; f.wanderTimer = 0;
        } else if (Math.abs(f.x - (f.buildX + 0.5)) < 0.35 && Math.abs(f.y - (f.buildY + 0.5)) < 0.35) {
          f.state = FState.Build; f.wanderTimer = 0;
        } else {
          this.moveToward(f, f.buildX + 0.5, f.buildY + 0.5, t, inSwamp);
        }
        continue;
      }

      // Wander：周期性找定居点（仅普通信徒定居建屋；军职随图腾/锚点游走）
      f.wanderTimer -= SIM_DT;
      if (f.wanderTimer <= 0) {
        f.wanderTimer = this.rng.range(0.8, 1.6);
        const site = f.cls === FClass.Brave ? this.findSettleSite(f) : null;
        if (site) {
          this.releaseReservation(f); // 兜底：覆盖旧目标前先释放（防任何遗漏路径的孤儿预约）
          f.buildX = site.tx; f.buildY = site.ty;
          this.reserved[site.ty * MAP + site.tx] = f.id;
          f.state = FState.Seek;
          continue;
        }
        // 无地可建：向图腾/家园/随机方向漫步
        const totem = this.totems.find(tt => tt.faction === f.faction);
        if (totem) { f.targetX = totem.x + this.rng.range(-2, 2); f.targetY = totem.y + this.rng.range(-2, 2); }
        else {
          const anchor = this.factionAnchor(f.faction);
          f.targetX = anchor.x + this.rng.range(-8, 8);
          f.targetY = anchor.y + this.rng.range(-8, 8);
        }
      }
      this.moveToward(f, f.targetX, f.targetY, t, inSwamp);
    }

    for (const f of dead) {
      const i = this.followers.indexOf(f);
      if (i >= 0) this.followers.splice(i, 1);
      this.releaseReservation(f);
      if (!(f as { settled?: boolean }).settled) {
        if (f.faction < 2) this.factions[f.faction].lossesRecent += 1;   // 野人无阵营统计
        this.bus.emit('entityDeath', { kind: 'follower', id: f.id, faction: f.faction, x: f.x, y: f.y, cause: 'combat' });
      }
    }
  }

  private moveToward(f: Follower, gx: number, gy: number, t: number, inSwamp: boolean): void {
    const dx = gx - f.x, dy = gy - f.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.05) return;
    const speed = FOLLOWER_SPEED * (inSwamp ? SWAMP_SPEED_MULT : 1) * (f.blessedUntil > t ? 1.25 : 1);
    const step = Math.min(d, speed * SIM_DT);
    let nx = f.x + (dx / d) * step, ny = f.y + (dy / d) * step;
    if (!this.world.isWalkable(Math.floor(nx), Math.floor(ny), t)) {
      // 简单绕行：先试横向、再试纵向、再随机偏转
      if (this.world.isWalkable(Math.floor(nx), Math.floor(f.y), t)) ny = f.y;
      else if (this.world.isWalkable(Math.floor(f.x), Math.floor(ny), t)) nx = f.x;
      else {
        f.stuck += 1;
        if (f.stuck > 4) {
          this.releaseReservation(f); // 放弃当前目标 → 必须释放预约
          f.targetX = f.x + this.rng.range(-6, 6); f.targetY = f.y + this.rng.range(-6, 6);
          f.stuck = 0; f.state = FState.Wander;
        }
        return;
      }
    }
    f.stuck = 0;
    f.x = Math.max(0.5, Math.min(MAP - 0.5, nx));
    f.y = Math.max(0.5, Math.min(MAP - 0.5, ny));
  }

  private adjacentEnemyHouse(f: Follower): House | null {
    const tx = Math.floor(f.x), ty = Math.floor(f.y);
    for (let y = ty - 1; y <= ty + 1; y++)
      for (let x = tx - 1; x <= tx + 1; x++) {
        const h = this.houseAt(x, y);
        if (h && h.faction !== f.faction) return h;
      }
    return null;
  }

  private adjacentEnemyMil(f: Follower): MilBuilding | null {
    const tx = Math.floor(f.x), ty = Math.floor(f.y);
    for (const m of this.mils)
      if (m.faction !== f.faction && Math.abs(m.tx - tx) <= 1 && Math.abs(m.ty - ty) <= 1) return m;
    return null;
  }

  private reservedByOther(f: Follower): boolean {
    const r = this.reserved[f.buildY * MAP + f.buildX];
    return r >= 0 && r !== f.id;
  }
  private releaseReservation(f: Follower): void {
    if (f.buildX >= 0 && this.reserved[f.buildY * MAP + f.buildX] === f.id)
      this.reserved[f.buildY * MAP + f.buildX] = -1;
    f.buildX = -1; f.buildY = -1;
  }

  /** 定居点搜索：图腾 > 己方房屋群落边缘 > 出生地附近 */
  private findSettleSite(f: Follower): { tx: number; ty: number } | null {
    if (this.pop(f.faction) >= this.popCap(f.faction) + 6) return null;
    // 帝国越大扩张欲望越低（对局曲线控制：防 3 分钟铺满地图）
    let myHouses = 0;
    for (const h of this.houses) if (h.faction === f.faction) myHouses++;
    if (this.rng.next() < myHouses / (myHouses + 30)) return null;
    const t = this.time;
    const totem = this.totems.find(tt => tt.faction === f.faction);
    const anchors: { x: number; y: number }[] = [];
    if (totem) anchors.push({ x: totem.x, y: totem.y });
    anchors.push({ x: f.x, y: f.y });
    anchors.push(this.factionAnchor(f.faction));
    for (const a of anchors) {
      for (let attempt = 0; attempt < 14; attempt++) {
        const r = this.rng.range(0, 7), ang = this.rng.range(0, Math.PI * 2);
        const tx = Math.floor(a.x + Math.cos(ang) * r), ty = Math.floor(a.y + Math.sin(ang) * r);
        if (tx < 1 || ty < 1 || tx >= MAP - 1 || ty >= MAP - 1) continue;
        const i = ty * MAP + tx;
        if (this.occupancy[i] >= 0 || this.reserved[i] >= 0) continue;
        if (!this.world.isBuildable(tx, ty, t)) continue;
        // 不贴敌方房屋建
        let nearEnemy = false;
        for (let y = ty - 2; y <= ty + 2 && !nearEnemy; y++)
          for (let x = tx - 2; x <= tx + 2; x++) {
            const h = this.houseAt(x, y);
            if (h && h.faction !== f.faction) { nearEnemy = true; break; }
          }
        if (!nearEnemy) return { tx, ty };
      }
    }
    return null;
  }

  factionAnchor(faction: number): { x: number; y: number } {
    let sx = 0, sy = 0, n = 0;
    for (const h of this.houses) if (h.faction === faction) { sx += h.tx; sy += h.ty; n++; }
    if (n > 0) return { x: sx / n, y: sy / n };
    return this.world.spawns[faction];
  }

  // ── 房屋 ────────────────────────────────────────────
  private tickHouses(): void {
    const t = this.time, w = this.world;
    const destroyed: [House, string][] = [];
    for (const h of this.houses) {
      const maxHp = HOUSE_HP[h.level - 1];
      // 淹没
      if (w.isWater(h.tx, h.ty)) { destroyed.push([h, 'flood']); continue; }
      if (w.isLava(h.tx, h.ty, t)) { destroyed.push([h, 'lava']); continue; }
      // 地基被神迹破坏（不再平整）
      if (h.buildProgress >= 1 && !this.tileStillFlat(h.tx, h.ty)) { destroyed.push([h, 'terrain']); continue; }

      if (h.buildProgress < 1) {
        h.buildProgress += SIM_DT / HOUSE_BUILD_S;
        h.hp = Math.min(maxHp, h.hp + maxHp * SIM_DT / HOUSE_BUILD_S);
        continue;
      }

      // 火
      if (h.fireUntil > t) {
        if (h.blessedUntil > t) { h.fireUntil = 0; } // 祝福灭火
        else {
          h.hp -= maxHp / FIRE_COLLAPSE_S * SIM_DT;
          if (h.hp <= 0) { destroyed.push([h, 'fire']); continue; }
        }
      }
      if (h.blessedUntil > t) h.hp = Math.min(maxHp, h.hp + 4 * SIM_DT);
      if (h.hp <= 0) { destroyed.push([h, 'razed']); continue; }

      // 被攻击时放出防御者
      if (h.ejectTimer > 2 && h.occupants > 0) {
        h.ejectTimer = 0; h.occupants--;
        this.spawnFollower(h.faction, h.tx + 0.5 + this.rng.range(-0.8, 0.8), h.ty + 1.5);
      }
      h.ejectTimer = Math.max(0, h.ejectTimer - SIM_DT * 0.5);

      // 升级
      const flat = w.flatCount5x5(h.tx, h.ty, t);
      const maxLevel = flat >= FLAT_FOR_LV3 ? 3 : flat >= FLAT_FOR_LV2 ? 2 : 1;
      if (h.level < maxLevel && h.occupants >= HOUSE_CAP[h.level - 1]) {
        h.upgradeTimer += SIM_DT * (h.blessedUntil > t ? 2 : 1);
        if (h.upgradeTimer >= 14) {
          h.upgradeTimer = 0; h.level++;
          h.hp = HOUSE_HP[h.level - 1];
          this.bus.emit('houseUpgrade', { id: h.id, level: h.level, x: h.tx + 0.5, y: h.ty + 0.5 });
        }
      } else h.upgradeTimer = 0;

      // 繁衍
      h.spawnTimer += SIM_DT * (h.blessedUntil > t ? 2 : 1);
      const interval = HOUSE_SPAWN_S[h.level - 1];
      if (h.spawnTimer >= interval) {
        h.spawnTimer = 0;
        if (h.occupants < HOUSE_CAP[h.level - 1]) h.occupants++;
        else if (this.pop(h.faction) < this.popCap(h.faction))
          this.spawnFollower(h.faction, h.tx + 0.5 + this.rng.range(-0.8, 0.8), h.ty + 1.5);
      }
    }
    for (const [h, cause] of destroyed) this.destroyHouse(h, cause);
  }

  private tileStillFlat(tx: number, ty: number): boolean {
    const w = this.world, h = w.cornerH(tx, ty);
    return h > w.waterLevel && w.cornerH(tx + 1, ty) === h && w.cornerH(tx, ty + 1) === h && w.cornerH(tx + 1, ty + 1) === h;
  }

  destroyHouse(h: House, cause: string): void {
    const i = this.houses.indexOf(h);
    if (i < 0) return;
    this.houses.splice(i, 1);
    this.occupancy[h.ty * MAP + h.tx] = -1;
    // 一半居民逃生。注意：本方法可能在 tickFollowers 的 for-of 中被调用，
    // 新幸存者会被当前迭代器访问到——无害（当 tick 只做环境判定/漫步），但改迭代语义前须知
    const survivors = cause === 'flood' || cause === 'lava' ? 0 : Math.floor(h.occupants / 2);
    for (let s = 0; s < survivors; s++)
      this.spawnFollower(h.faction, h.tx + 0.5 + this.rng.range(-1, 1), h.ty + 0.5 + this.rng.range(-1, 1));
    this.factions[h.faction].lossesRecent += h.occupants - survivors;
    this.bus.emit('entityDeath', { kind: 'house', id: h.id, faction: h.faction, x: h.tx + 0.5, y: h.ty + 0.5, cause });
  }

  private checkGameOver(): void {
    if (this.time < this.graceUntil) return;
    const p0 = this.pop(0), p1 = this.pop(1);
    if (p1 <= 0) { this.over = { victory: true }; this.bus.emit('gameOver', { victory: true }); }
    else if (p0 <= 0) { this.over = { victory: false }; this.bus.emit('gameOver', { victory: false }); }
  }

  // ── 存档 ────────────────────────────────────────────
  serialize(): SaveData {
    return {
      v: 1, time: this.time, world: this.world.serialize(),
      followers: this.followers.map(f => [f.id, f.faction, +f.x.toFixed(2), +f.y.toFixed(2), +f.hp.toFixed(1), +f.blessedUntil.toFixed(1), f.cls] as const),
      mils: this.mils.map(m => [m.id, m.faction, m.kind, m.tx, m.ty, Math.round(m.hp)] as const),
      houses: this.houses.map(h => [h.id, h.faction, h.tx, h.ty, h.level, Math.round(h.hp), h.occupants, +h.buildProgress.toFixed(2), +h.fireUntil.toFixed(1), +h.blessedUntil.toFixed(1)] as const),
      totems: this.totems.map(tt => [tt.id, tt.faction, +tt.x.toFixed(1), +tt.y.toFixed(1), +tt.until.toFixed(1)] as const),
      avatars: this.avatars.map(a => [a.faction, +a.x.toFixed(2), +a.y.toFixed(2), +a.hp.toFixed(1), a.alive ? 1 : 0, +a.respawnAt.toFixed(1)] as const),
      factions: this.factions.map(fs => ({ faith: Math.round(fs.faith), casts: fs.miracleCasts, peak: fs.peakPop, cd: { ...fs.cooldowns } })),
      floodUntil: this.floodUntil, nextId: this.nextId, rngState: this.rng.state(), armageddon: this.armageddonFired,
    };
  }

  static deserialize(bus: EventBus, d: SaveData): Sim {
    const world = World.deserialize(bus, d.world);
    const sim = new Sim(bus, d.world.seed, world);
    sim.time = d.time; sim.floodUntil = d.floodUntil; sim.nextId = d.nextId;
    sim.armageddonFired = d.armageddon; sim.rng.setState(d.rngState);
    sim.graceUntil = d.time + 3;
    for (const [id, faction, x, y, hp, blessedUntil, cls] of d.followers)
      sim.followers.push({ id, faction, cls: cls ?? FClass.Brave, x, y, px: x, py: y, hp, state: FState.Wander, targetX: x, targetY: y, buildX: -1, buildY: -1, enemyId: -1, blessedUntil: blessedUntil ?? 0, wanderTimer: 0, stuck: 0, shotCd: 0, preachCd: 0, trainId: -1 });
    if (d.mils) for (const [id, faction, kind, tx, ty, hp] of d.mils) {
      sim.mils.push({ id, faction, kind: kind as MilBuilding['kind'], tx, ty, hp, traineeId: -1, trainT: 0, shotCd: 0 });
      sim.occupancy[ty * MAP + tx] = id;
    }
    for (const [id, faction, tx, ty, level, hp, occupants, buildProgress, fireUntil, blessedUntil] of d.houses) {
      sim.houses.push({ id, faction, tx, ty, level, hp, occupants, buildProgress, spawnTimer: 0, upgradeTimer: 0, fireUntil: fireUntil ?? 0, blessedUntil: blessedUntil ?? 0, ejectTimer: 0 });
      sim.occupancy[ty * MAP + tx] = id;
    }
    for (const [id, faction, x, y, until] of d.totems) sim.totems.push({ id, faction, x, y, until });
    if (d.avatars) for (const [faction, x, y, hp, alive, respawnAt] of d.avatars) {
      const a = sim.avatars[faction];
      a.x = a.px = a.targetX = x; a.y = a.py = a.targetY = y;
      a.hp = hp; a.alive = alive === 1; a.respawnAt = respawnAt;
    }
    for (let f = 0; f < 2; f++) {
      sim.factions[f].faith = d.factions[f].faith;
      sim.factions[f].miracleCasts = d.factions[f].casts;
      sim.factions[f].peakPop = d.factions[f].peak;
      sim.factions[f].cooldowns = d.factions[f].cd ?? {};
    }
    if (d.floodUntil > d.time) world.setWaterLevel(world.baseWaterLevel + 1);
    return sim;
  }
}

export interface SaveData {
  v: number; time: number;
  world: WorldSave;
  followers: (readonly [number, number, number, number, number, number?, number?])[];
  mils?: (readonly [number, number, string, number, number, number])[];
  houses: (readonly [number, number, number, number, number, number, number, number, number?, number?])[];
  totems: (readonly [number, number, number, number, number])[];
  avatars?: (readonly [number, number, number, number, number, number])[];
  factions: { faith: number; casts: number; peak: number; cd?: Record<string, number> }[];
  floodUntil: number; nextId: number; rngState: number; armageddon: boolean;
}

function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy;
}
