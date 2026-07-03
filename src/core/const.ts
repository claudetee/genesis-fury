// GENESIS FURY — 全局调参常量表（与 docs/DESIGN.md §4/§5 数值一一对应）

// ── 地图 ──────────────────────────────────────────────
export const MAP = 128;              // 瓦片数（每边）
export const CORNERS = MAP + 1;      // 角点数
export const H_MAX = 14;             // 最大高度
export const WATER_LEVEL = 2;        // 基准水位
export const SNOW_H = 12;            // 雪线

// ── 等距投影 ──────────────────────────────────────────
export const TILE_W = 64;            // 瓦片屏幕宽
export const TILE_H = 32;            // 瓦片屏幕高
export const H_STEP = 14;            // 每级高度的像素位移
export const CHUNK = 16;             // 每 chunk 瓦片数

// ── 模拟 ──────────────────────────────────────────────
export const SIM_HZ = 10;
export const SIM_DT = 1 / SIM_HZ;

// ── 信仰 ──────────────────────────────────────────────
export const FAITH_BASE_REGEN = 2;
export const FAITH_PER_POP = 0.55;
export const FAITH_CAP_BASE = 200;
export const FAITH_CAP_PER_POP = 12;
export const FAITH_START = 120;

// ── 信徒 ──────────────────────────────────────────────
export const FOLLOWER_HP = 10;
export const FOLLOWER_DPS = 1.2;
export const FOLLOWER_SPEED = 1.6;   // tile/s
export const SWAMP_SPEED_MULT = 0.25;
export const SWAMP_DPS = 0.8;
export const POP_SOFT_EXTRA = 8;     // 全局人口上限 = Σ容量 + 这个
export const START_FOLLOWERS = 6;

// ── 房屋（等级 1/2/3）─────────────────────────────────
export const HOUSE_CAP = [2, 4, 7];
export const HOUSE_FAITH_MULT = [1, 1.15, 1.3];
export const HOUSE_HP = [30, 55, 90];
export const HOUSE_SPAWN_S = [13, 10, 8];
export const HOUSE_BUILD_S = 4;      // 建造耗时
export const FIRE_COLLAPSE_S = 6;
export const FLAT_FOR_LV2 = 10;      // 5×5 内平地数 ≥ → 可升2级
export const FLAT_FOR_LV3 = 17;

// ── 神迹 ──────────────────────────────────────────────
export interface MiracleDef {
  id: string; name: string; icon: string; cost: number; cooldown: number;
  radius: number; hotkey: string; desc: string;
}
export const MIRACLES: MiracleDef[] = [
  { id: 'raise',     name: '塑地·隆起', icon: 'raise',     cost: 8,   cooldown: 0,  radius: 2, hotkey: '1', desc: '抬升大地，为信徒开辟家园' },
  { id: 'lower',     name: '塑地·沉降', icon: 'lower',     cost: 8,   cooldown: 0,  radius: 2, hotkey: '2', desc: '沉降大地，或将敌土没入汪洋' },
  { id: 'bless',     name: '圣光祝福', icon: 'bless',     cost: 45,  cooldown: 8,  radius: 4, hotkey: '3', desc: '治愈信徒，繁衍加倍；感化中立的野人' },
  { id: 'lightning', name: '雷罚',     icon: 'lightning', cost: 60,  cooldown: 3,  radius: 1, hotkey: '4', desc: '天雷击落，点燃屋舍' },
  { id: 'swamp',     name: '沼泽',     icon: 'swamp',     cost: 70,  cooldown: 10, radius: 3, hotkey: '5', desc: '化地为泽，困住来犯之敌' },
  { id: 'quake',     name: '地震',     icon: 'quake',     cost: 120, cooldown: 20, radius: 6, hotkey: '6', desc: '大地震颤，屋舍崩塌' },
  { id: 'firestorm', name: '陨星风暴', icon: 'firestorm', cost: 180, cooldown: 40, radius: 8, hotkey: '7', desc: '天火倾泻八秒，焚尽一方' },
  { id: 'flood',     name: '洪水',     icon: 'flood',     cost: 200, cooldown: 45, radius: 0, hotkey: '8', desc: '大洪水淹没低地，涤荡尘世' },
  { id: 'volcano',   name: '火山',     icon: 'volcano',   cost: 260, cooldown: 60, radius: 5, hotkey: '9', desc: '召唤火山，焦土千里' },
  { id: 'teleport',  name: '神行',     icon: 'teleport',  cost: 50,  cooldown: 15, radius: 1, hotkey: '0', desc: '神使瞬行至大地任意一角' },
  { id: 'totem',     name: '集结图腾', icon: 'totem',     cost: 25,  cooldown: 0,  radius: 6, hotkey: 't', desc: '树立图腾，引导信徒汇聚' },
];

// ── 营造（建筑放置，与神迹同门不同栏）──────────────────
export interface BuildDef { id: string; name: string; icon: string; cost: number; hotkey: string; desc: string }
export const BUILDINGS: BuildDef[] = [
  { id: 'barracks',   name: '武堂',   icon: 'barracks',   cost: 90,  hotkey: 'z', desc: '信徒入内受训为战士——皮糙肉厚的近卫' },
  { id: 'mageschool', name: '火祭坛', icon: 'mageschool', cost: 110, hotkey: 'x', desc: '信徒入内受训为火法师——掷焰的远击手' },
  { id: 'sanctum',    name: '圣所',   icon: 'sanctum',    cost: 100, hotkey: 'c', desc: '信徒入内受训为传教士——不战而屈人之兵' },
  { id: 'tower',      name: '守卫塔', icon: 'tower',      cost: 70,  hotkey: 'v', desc: '自动喷吐圣焰，狙杀来犯之敌' },
];

// ── 职业 ──────────────────────────────────────────────
// class: 0 信徒 / 1 战士 / 2 火法师 / 3 传教士
export const CLASS_HP = [10, 26, 12, 10];
export const CLASS_DPS = [1.2, 3.2, 0, 0];       // 火法师走远程投射
export const CLASS_SPEED = [1.6, 1.5, 1.45, 1.5];
export const TRAIN_COST = [0, 18, 26, 22];        // 每人转职耗信仰
export const TRAIN_TIME = 6;                      // 训练时长 s
export const FIREMAGE_RANGE = 6;
export const FIREMAGE_DPS = 4;
export const FIREMAGE_SHOT_CD = 1.6;
export const PREACH_RANGE = 3;
export const PREACH_INTERVAL = 5;                 // 每次转化判定间隔
export const PREACH_CHANCE = 0.55;                // 每次判定成功率（仅对 class0 信徒）

// ── 守卫塔 / 军事建筑 ─────────────────────────────────
export const TOWER_HP = 130;
export const TOWER_RANGE = 7;
export const TOWER_DPS = 2.4;
export const TOWER_SHOT_CD = 1.2;
export const MIL_HP = 70;                          // 训练屋 HP

// ── 野人 ──────────────────────────────────────────────
export const WILDMEN_COUNT = 26;
export const WILD_FACTION = 2;

// ── Firestorm ────────────────────────────────────────
export const FIRESTORM_DURATION = 8;
export const FIRESTORM_METEORS = 22;
export const FIRESTORM_METEOR_DMG = 8;
export const BLESS_DURATION = 12;
export const SWAMP_DURATION = 25;
export const FLOOD_DURATION = 25;
export const TOTEM_DURATION = 45;
export const QUAKE_BUILDING_COLLAPSE = 0.6;
export const VOLCANO_LAVA_S = 14;    // 岩浆持续伤害时间

// ── 神使化身 ──────────────────────────────────────────
export const AVATAR_HP = 80;
export const AVATAR_SPEED = 2.4;          // tile/s
export const AVATAR_REGEN = 1.5;          // 脱战回复/s
export const AVATAR_CONTACT_R = 1.2;      // 敌信徒接触判定半径
export const AVATAR_CONTACT_DPS = 1.2;    // 每个接触敌徒的 dps（封顶 5 人）
export const AVATAR_RESPAWN_S = 25;
export const AVATAR_INVULN_S = 3;         // 转生无敌
export const CAST_RANGE = 20;             // 神迹祈告半径（tile）

// ── 终局 ──────────────────────────────────────────────
export const ARMAGEDDON_S = 20 * 60;
export const ARMAGEDDON_REGEN_MULT = 3;

// ── AI ────────────────────────────────────────────────
export const AI_TICK_S: Record<string, number> = { easy: 2.6, normal: 1.5, hard: 0.8 };
export const AI_FUMBLE: Record<string, number> = { easy: 0.4, normal: 0.2, hard: 0.05 };

// ── 相机 ──────────────────────────────────────────────
export const CAM_EASE = 9;            // 目标插值速率
export const CAM_KEY_SPEED = 900;     // px/s（世界坐标）
export const CAM_EDGE_PX = 24;        // 边缘滚动触发带
export const ZOOM_MIN = 0.35;
export const ZOOM_MAX = 2.2;

// ── 存档 ──────────────────────────────────────────────
export const SAVE_KEY = 'genesis-fury:save:v1';
export const SETTINGS_KEY = 'genesis-fury:settings:v1';
export const AUTOSAVE_S = 30;
