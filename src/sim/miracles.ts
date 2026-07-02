// 神迹系统：验证（信仰/冷却/目标合法性）→ 执行 → 事件。玩家与 AI 共用同一入口，严格对称。
import { MIRACLES, MiracleDef, BUILDINGS, BLESS_DURATION, SWAMP_DURATION, FLOOD_DURATION, TOTEM_DURATION, QUAKE_BUILDING_COLLAPSE, ARMAGEDDON_S, CAST_RANGE, CLASS_HP, WILD_FACTION } from '../core/const';
import { MAP, H_MAX } from '../core/const';
import { Sim } from './sim';
import { FClass, FState } from './entities';

export const miracleById = new Map<string, MiracleDef>(MIRACLES.map(m => [m.id, m]));

export function miracleCost(sim: Sim, id: string): number {
  const def = miracleById.get(id)!;
  // 终焉审判：毁灭级神迹半价
  if (sim.time >= ARMAGEDDON_S && (id === 'volcano' || id === 'flood')) return Math.round(def.cost / 2);
  return def.cost;
}

export type CastResult = 'ok' | 'faith' | 'cooldown' | 'invalid' | 'range' | 'dead';

export function canCast(sim: Sim, faction: number, id: string, x: number, y: number): CastResult {
  const def = miracleById.get(id);
  if (!def) return 'invalid';
  const fs = sim.factions[faction];
  // 神迹经由神使化身祈告：她殒落则失声，目标须在祈告半径内（洪水为全图仪式，只需在世）
  const av = sim.avatar(faction);
  if (!av.alive) return 'dead';
  if (id !== 'flood' && id !== 'teleport') {   // teleport = 神行，无距离限制
    const dx = x - av.x, dy = y - av.y;
    if (dx * dx + dy * dy > CAST_RANGE * CAST_RANGE) return 'range';
  }
  if ((fs.cooldowns[id] ?? 0) > sim.time) return 'cooldown';
  if (fs.faith < miracleCost(sim, id)) return 'faith';
  if (id !== 'flood' && (x < 1 || y < 1 || x > MAP - 1 || y > MAP - 1)) return 'invalid';
  if (id === 'totem' && sim.world.isWater(Math.floor(x), Math.floor(y))) return 'invalid';
  if (id === 'teleport' && !sim.world.isWalkable(Math.floor(x), Math.floor(y), sim.time)) return 'invalid';
  return 'ok';
}

// ── 营造：建筑放置（与神迹同套验证逻辑）────────────────
export const buildingById = new Map(BUILDINGS.map(b => [b.id, b]));

export function canBuild(sim: Sim, faction: number, id: string, tx: number, ty: number): CastResult {
  const def = buildingById.get(id);
  if (!def) return 'invalid';
  const av = sim.avatar(faction);
  if (!av.alive) return 'dead';
  const dx = tx + 0.5 - av.x, dy = ty + 0.5 - av.y;
  if (dx * dx + dy * dy > CAST_RANGE * CAST_RANGE) return 'range';
  if (sim.factions[faction].faith < def.cost) return 'faith';
  if (!sim.world.isBuildable(tx, ty, sim.time)) return 'invalid';
  if (sim.occupancy[ty * MAP + tx] >= 0 || sim.reserved[ty * MAP + tx] >= 0) return 'invalid';
  return 'ok';
}

export function placeBuilding(sim: Sim, faction: number, id: string, x: number, y: number): CastResult {
  const tx = Math.floor(x), ty = Math.floor(y);
  const check = canBuild(sim, faction, id, tx, ty);
  if (check !== 'ok') {
    if (faction === 0) sim.bus.emit('miracleDenied', { id, reason: check as 'faith' | 'cooldown' | 'invalid' | 'range' | 'dead' });
    return check;
  }
  sim.factions[faction].faith -= buildingById.get(id)!.cost;
  sim.placeMil(faction, id as 'barracks' | 'mageschool' | 'sanctum' | 'tower', tx, ty);
  return 'ok';
}

/** 施放神迹。返回结果；'ok' 时已生效并广播事件。 */
export function cast(sim: Sim, faction: number, id: string, x: number, y: number): CastResult {
  const check = canCast(sim, faction, id, x, y);
  if (check !== 'ok') {
    if (faction === 0) sim.bus.emit('miracleDenied', { id, reason: check });
    return check;
  }
  const def = miracleById.get(id)!;
  const fs = sim.factions[faction];
  fs.faith -= miracleCost(sim, id);
  if (def.cooldown > 0) fs.cooldowns[id] = sim.time + def.cooldown;
  fs.miracleCasts++;

  const t = sim.time, w = sim.world;
  const cx = Math.round(x), cy = Math.round(y);

  switch (id) {
    case 'raise': w.brush(cx, cy, +1, def.radius); break;
    case 'lower': w.brush(cx, cy, -1, def.radius); break;

    case 'bless': {
      w.clearSwamp(x, y, def.radius);
      for (const f of sim.followers) {
        if (d2(f.x, f.y, x, y) > def.radius ** 2) continue;
        if (f.faction === faction) {
          f.blessedUntil = t + BLESS_DURATION;
          f.hp = Math.min(CLASS_HP[f.cls], f.hp + 4);
        } else if (f.faction === WILD_FACTION) {
          // 感化野人：入我苍蓝/绯红门下
          f.faction = faction;
          f.cls = FClass.Brave;
          f.state = FState.Wander; f.wanderTimer = 0;
          sim.bus.emit('convert', { x: f.x, y: f.y, toFaction: faction });
        }
      }
      for (const h of sim.houses)
        if (h.faction === faction && d2(h.tx + 0.5, h.ty + 0.5, x, y) <= def.radius ** 2)
          h.blessedUntil = t + BLESS_DURATION;
      sim.bus.emit('blessApplied', { x, y, r: def.radius });
      break;
    }

    case 'firestorm':
      sim.startFirestorm(x, y);
      sim.bus.emit('quakeShake', { x, y, power: 0.5 });
      break;

    case 'teleport': {
      const av = sim.avatar(faction);
      sim.bus.emit('teleportFx', { fromX: av.x, fromY: av.y, toX: x, toY: y });
      av.x = av.px = av.targetX = x;
      av.y = av.py = av.targetY = y;
      break;
    }

    case 'lightning': {
      // 单点：杀伤 0.9 范围内单位，命中房屋则点燃
      let kills = 0;
      for (const f of sim.followers)
        if (d2(f.x, f.y, x, y) <= 0.9 * 0.9 && kills < 2) { f.hp = 0; kills++; }
      const h = sim.houseAt(Math.floor(x), Math.floor(y));
      if (h) {
        h.hp -= 18;
        if (h.fireUntil <= t) { h.fireUntil = t + 999; sim.bus.emit('fireStart', { id: h.id, x: h.tx + 0.5, y: h.ty + 0.5 }); }
      }
      w.scorched[Math.floor(y) * MAP + Math.floor(x)] = 1;
      sim.bus.emit('lightningStrike', { x, y });
      break;
    }

    case 'swamp':
      w.swamp(x, y, def.radius, t + SWAMP_DURATION);
      sim.bus.emit('swampApplied', { x, y, r: def.radius });
      break;

    case 'quake': {
      w.quake(cx, cy, def.radius, sim.rng);
      for (const h of [...sim.houses])
        if (d2(h.tx + 0.5, h.ty + 0.5, x, y) <= def.radius ** 2 && sim.rng.chance(QUAKE_BUILDING_COLLAPSE))
          sim.destroyHouse(h, 'quake');
      for (const f of sim.followers)
        if (d2(f.x, f.y, x, y) <= def.radius ** 2 && sim.rng.chance(0.25)) f.hp -= 6;
      sim.bus.emit('quakeShake', { x, y, power: 1 });
      break;
    }

    case 'flood':
      sim.floodUntil = t + FLOOD_DURATION;
      w.setWaterLevel(w.baseWaterLevel + 1);
      sim.bus.emit('floodStart', {});
      break;

    case 'volcano':
      w.volcano(cx, cy, def.radius, t);
      for (const f of sim.followers)
        if (d2(f.x, f.y, x, y) <= (def.radius * 0.7) ** 2) f.hp = 0;
      sim.bus.emit('volcanoErupt', { x, y });
      sim.bus.emit('quakeShake', { x, y, power: 1.6 });
      break;

    case 'totem':
      sim.placeTotem(faction, x, y, t + TOTEM_DURATION);
      break;
  }

  sim.bus.emit('miracleCast', { id, x, y, faction });
  return 'ok';
}

function d2(x0: number, y0: number, x1: number, y1: number): number {
  const dx = x0 - x1, dy = y0 - y1; return dx * dx + dy * dy;
}
