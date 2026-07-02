// 纯模拟层冒烟测试：无渲染跑 N 分钟游戏时间，观察人口/信仰曲线与胜负。
// btoa/atob polyfill（world 序列化用）
(globalThis as Record<string, unknown>).btoa = (s: string) => Buffer.from(s, 'binary').toString('base64');
(globalThis as Record<string, unknown>).atob = (s: string) => Buffer.from(s, 'base64').toString('binary');

import { EventBus } from '../src/core/events';
import { Sim } from '../src/sim/sim';
import { EnemyGod } from '../src/sim/ai';
import { SIM_DT } from '../src/core/const';

const seed = parseInt(process.argv[2] || '12345');
const minutes = parseFloat(process.argv[3] || '8');
const bus = new EventBus();
const deaths: Record<string, number> = {};
bus.on('entityDeath', (e) => { const k = `${e.kind}:${e.cause}:f${e.faction}`; deaths[k] = (deaths[k] || 0) + 1; });
let over: string | null = null;
bus.on('gameOver', (e) => { over = e.victory ? 'VICTORY' : 'DEFEAT'; });

const sim = new Sim(bus, seed);
sim.seedStart();
const ai = new EnemyGod(sim, 'normal');

const ticks = Math.round(minutes * 60 / SIM_DT);
const t0 = Date.now();
for (let i = 0; i < ticks; i++) {
  sim.tick();
  ai.tick(SIM_DT);
  if (i % 300 === 0) {
    const w = sim.world;
    let buildable0 = 0;
    const sp = w.spawns[0];
    for (let y = sp.y - 10; y < sp.y + 10; y++) for (let x = sp.x - 10; x < sp.x + 10; x++) if (w.isBuildable(x, y, sim.time)) buildable0++;
    console.log(`t=${(i * SIM_DT).toFixed(0).padStart(4)}s pop=${sim.pop(0)}/${sim.pop(1)} houses=${sim.houses.filter(h => h.faction === 0).length}/${sim.houses.filter(h => h.faction === 1).length} faith=${Math.round(sim.factions[0].faith)}/${Math.round(sim.factions[1].faith)} buildable@spawn0=${buildable0}`);
  }
  if (over) { console.log(`>>> ${over} at t=${sim.time.toFixed(1)}s`); break; }
}
const elapsed = Date.now() - t0;
console.log(`deaths:`, deaths);
console.log(`sim speed: ${(ticks / (elapsed / 1000)).toFixed(0)} ticks/s (${(elapsed / ticks).toFixed(2)}ms/tick, 预算 100ms)`);
