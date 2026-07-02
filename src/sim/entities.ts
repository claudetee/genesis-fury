// 实体类型定义。faction: 0 = 玩家(苍蓝) / 1 = 敌神(绯红) / 2 = 中立野人
export const enum FState { Wander = 0, Seek = 1, Build = 2, Fight = 3, Train = 4 }
export const enum FClass { Brave = 0, Warrior = 1, FireMage = 2, Preacher = 3 }

export interface Follower {
  id: number; faction: number;
  cls: FClass;
  x: number; y: number;           // tile 坐标（浮点）
  px: number; py: number;         // 上一 tick 位置（渲染插值）
  hp: number;
  state: FState;
  targetX: number; targetY: number;   // seek/wander 目的地
  buildX: number; buildY: number;     // 预定建房瓦片
  enemyId: number;                    // 战斗对象（follower id 或 -house id-1）
  blessedUntil: number;
  wanderTimer: number;
  stuck: number;
  shotCd: number;                     // 火法师射击冷却
  preachCd: number;                   // 传教士布道冷却
  trainId: number;                    // 前往受训的军事建筑 id
}

export interface House {
  id: number; faction: number;
  tx: number; ty: number;
  level: number;                  // 1..3
  hp: number;
  occupants: number;
  buildProgress: number;          // 0..1，<1 表示在建
  spawnTimer: number;
  upgradeTimer: number;
  fireUntil: number;              // >simTime 表示着火
  blessedUntil: number;
  ejectTimer: number;
}

export interface Totem {
  id: number; faction: number;
  x: number; y: number;
  until: number;
}

// 军事建筑：barracks(→战士) mageschool(→火法师) sanctum(→传教士) tower(自动攻击)
export interface MilBuilding {
  id: number; faction: number;
  kind: 'barracks' | 'mageschool' | 'sanctum' | 'tower';
  tx: number; ty: number;
  hp: number;
  traineeId: number;               // 正在受训的信徒 id（-1 空）
  trainT: number;                  // 训练进度计时
  shotCd: number;                  // 塔射击冷却
}

export interface Avatar {
  faction: number;
  x: number; y: number;
  px: number; py: number;        // 上一 tick（渲染插值）
  hp: number;
  alive: boolean;
  targetX: number; targetY: number;
  respawnAt: number;             // 殒落后的转生 sim 时间
  invulnUntil: number;
  stuck: number;
}

export interface FactionState {
  faith: number;
  cooldowns: Record<string, number>;  // miracleId → 可再施放的 sim 时间
  miracleCasts: number;
  peakPop: number;
  lossesRecent: number;               // 近 8s 损失（AI 用），滑动衰减
}
