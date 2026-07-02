// 资源加载：assets/manifest.json → 图像；任何缺失走程序化兜底（canvas 绘制），
// 保证"无破图"硬指标。DOM 侧（HUD/标题）通过 url() 引用，canvas 侧直接用 ImageSource。
import { hash2 } from '../core/rng';

export interface AssetDb {
  terrain: Record<string, CanvasImageSource>;       // grass/sand/rock/snow/soil/lava 256²
  sprites: Record<string, CanvasImageSource>;       // house_a1..3 b1..3 totem_a/b ruin
  iconUrl: (id: string) => string;                  // 神迹图标（HUD 用 url）
  uiUrl: (name: string) => string;                  // panel_stone/parchment/btn_stone/emblem/title_hero
  has: (path: string) => boolean;
}

const TERRAIN_NAMES = ['grass', 'sand', 'rock', 'snow', 'soil', 'lava'];
const SPRITE_NAMES = ['house_a1', 'house_a2', 'house_a3', 'house_b1', 'house_b2', 'house_b3', 'totem_a', 'totem_b', 'ruin'];
const ICON_NAMES = ['raise', 'lower', 'bless', 'lightning', 'swamp', 'quake', 'flood', 'volcano', 'totem'];
const UI_FILES: Record<string, string> = {
  panel_stone: 'assets/ui/panel_stone.webp', parchment: 'assets/ui/parchment.webp',
  btn_stone: 'assets/ui/btn_stone.webp', emblem: 'assets/ui/emblem.png', title_hero: 'assets/ui/title_hero.webp',
};

export async function loadAssets(onProgress: (p: number, label: string) => void): Promise<AssetDb> {
  let manifest: { files?: Record<string, boolean> } = {};
  try { manifest = await (await fetch('assets/manifest.json')).json(); } catch { /* 全兜底 */ }
  const files = manifest.files ?? {};
  const have = (p: string) => !!files[p];

  const total = TERRAIN_NAMES.length + SPRITE_NAMES.length + ICON_NAMES.length + Object.keys(UI_FILES).length;
  let done = 0;
  const step = (label: string) => onProgress(Math.min(1, ++done / total), label);

  const terrain: Record<string, CanvasImageSource> = {};
  for (const n of TERRAIN_NAMES) {
    const path = `terrain/${n}.png`;
    terrain[n] = have(path) ? await loadImage(`assets/${path}`).catch(() => fallbackTerrain(n)) : fallbackTerrain(n);
    step(`凝聚大地 · ${n}`);
  }

  const sprites: Record<string, CanvasImageSource> = {};
  for (const n of SPRITE_NAMES) {
    const path = `sprites/${n}.png`;
    sprites[n] = have(path) ? await loadImage(`assets/${path}`).catch(() => fallbackSprite(n)) : fallbackSprite(n);
    step(`筑起屋舍 · ${n}`);
  }

  const iconUrls: Record<string, string> = {};
  for (const n of ICON_NAMES) {
    const path = `icons/${n}.png`;
    iconUrls[n] = have(path) ? `assets/${path}` : canvasToUrl(fallbackIcon(n));
    step(`铭刻神迹 · ${n}`);
  }

  const uiUrls: Record<string, string> = {};
  for (const [k, p] of Object.entries(UI_FILES)) {
    const rel = p.replace(/^assets\//, '');
    uiUrls[k] = have(rel) ? p : canvasToUrl(fallbackUi(k));
    step(`雕琢神殿 · ${k}`);
  }

  return {
    terrain, sprites,
    iconUrl: (id) => iconUrls[id] ?? canvasToUrl(fallbackIcon(id)),
    uiUrl: (n) => uiUrls[n] ?? canvasToUrl(fallbackUi(n)),
    has: have,
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`load fail: ${src}`));
    img.src = src;
  });
}

function mkCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}
function canvasToUrl(c: HTMLCanvasElement): string { return c.toDataURL('image/png'); }

// ── 程序化兜底：地形 ─────────────────────────────────
const TERRAIN_BASE: Record<string, [string, string]> = {
  grass: ['#5a8f3c', '#4a7a30'], sand: ['#d8bd7f', '#c9a967'], rock: ['#8a8378', '#6f695f'],
  snow: ['#e8ecf2', '#d5dbe6'], soil: ['#7a5b3a', '#65492e'], lava: ['#c33d10', '#8a2506'],
};
function fallbackTerrain(name: string): HTMLCanvasElement {
  const [c, g] = mkCanvas(256, 256);
  const [c1, c2] = TERRAIN_BASE[name] ?? TERRAIN_BASE.grass;
  g.fillStyle = c1; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const x = (hash2(i, 1, 7) * 256) | 0, y = (hash2(i, 2, 7) * 256) | 0;
    const s = 1 + hash2(i, 3, 7) * 3;
    g.fillStyle = hash2(i, 4, 7) > 0.5 ? c2 : `rgba(255,255,255,${0.05 + hash2(i, 5, 7) * 0.06})`;
    g.fillRect(x, y, s, s);
  }
  if (name === 'lava') {
    g.fillStyle = '#ffcf3f';
    for (let i = 0; i < 60; i++) g.fillRect((hash2(i, 6, 9) * 256) | 0, (hash2(i, 7, 9) * 256) | 0, 4, 2);
  }
  return c;
}

// ── 程序化兜底：建筑精灵 ─────────────────────────────
function fallbackSprite(name: string): HTMLCanvasElement {
  const [c, g] = mkCanvas(200, 200);
  const isB = name.includes('_b');
  const wall = isB ? '#5a4048' : '#c9b795', roof = isB ? '#8c2f36' : '#3f7d8c', trim = isB ? '#e0525c' : '#59c2d6';
  const lvl = /[123]$/.test(name) ? parseInt(name[name.length - 1]) : 2;
  g.translate(100, 120);
  if (name === 'ruin') {
    g.fillStyle = '#7d766c';
    for (let i = 0; i < 7; i++) {
      const a = i * 1.1, r = 18 + (i % 3) * 12;
      g.fillRect(Math.cos(a) * r - 9, Math.sin(a) * r * 0.5 - 6, 18 + (i % 2) * 8, 12);
    }
    return c;
  }
  if (name.startsWith('totem')) {
    g.fillStyle = '#6b4a2f'; g.fillRect(-9, -78, 18, 96);
    g.fillStyle = trim;
    g.fillRect(-16, -70, 32, 10); g.fillRect(-13, -46, 26, 8); g.fillRect(-11, -24, 22, 7);
    g.beginPath(); g.arc(0, -84, 11, 0, Math.PI * 2); g.fillStyle = roof; g.fill();
    g.beginPath(); g.arc(0, -84, 5, 0, Math.PI * 2); g.fillStyle = '#ffe98a'; g.fill();
    return c;
  }
  const w = 40 + lvl * 14, hh = 26 + lvl * 12;
  // 影
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.beginPath(); g.ellipse(0, 18, w * 0.75, w * 0.3, 0, 0, Math.PI * 2); g.fill();
  // 墙（等距体块）
  g.fillStyle = wall;
  g.beginPath(); g.moveTo(-w, 0); g.lineTo(0, w * 0.5); g.lineTo(w, 0); g.lineTo(w, -hh); g.lineTo(0, -hh + w * 0.5); g.lineTo(-w, -hh); g.closePath(); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.beginPath(); g.moveTo(0, w * 0.5); g.lineTo(w, 0); g.lineTo(w, -hh); g.lineTo(0, -hh + w * 0.5); g.closePath(); g.fill();
  // 屋顶
  g.fillStyle = roof;
  g.beginPath(); g.moveTo(-w - 6, -hh); g.lineTo(0, -hh + w * 0.5 + 6); g.lineTo(w + 6, -hh); g.lineTo(0, -hh - w * 0.55 - lvl * 6); g.closePath(); g.fill();
  g.strokeStyle = trim; g.lineWidth = 3; g.stroke();
  if (lvl >= 3) { // 大殿旗帜
    g.strokeStyle = '#3a2c1c'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, -hh - w * 0.55 - 18); g.lineTo(0, -hh - w * 0.55 - 44); g.stroke();
    g.fillStyle = trim; g.beginPath(); g.moveTo(0, -hh - w * 0.55 - 44); g.lineTo(26, -hh - w * 0.55 - 37); g.lineTo(0, -hh - w * 0.55 - 30); g.closePath(); g.fill();
  }
  return c;
}

// ── 程序化兜底：神迹图标（石质圆章 + 手绘符文） ───────
function fallbackIcon(name: string): HTMLCanvasElement {
  const [c, g] = mkCanvas(160, 160);
  const grad = g.createRadialGradient(80, 66, 8, 80, 80, 80);
  grad.addColorStop(0, '#9a917f'); grad.addColorStop(0.8, '#6e675b'); grad.addColorStop(1, '#4c463d');
  g.fillStyle = grad;
  g.beginPath(); g.arc(80, 80, 78, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#3a352c'; g.lineWidth = 5;
  g.beginPath(); g.arc(80, 80, 74, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = '#ffe9a8'; g.fillStyle = '#ffe9a8'; g.lineWidth = 7;
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.shadowColor = '#ffb62e'; g.shadowBlur = 14;
  const P = (pts: number[][], close = false, fill = false) => {
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    if (close) g.closePath();
    fill ? g.fill() : g.stroke();
  };
  switch (name) {
    case 'raise': P([[80, 38], [52, 92], [108, 92]], true, true); P([[80, 104], [80, 126]]); P([[68, 116], [80, 104], [92, 116]]); break;
    case 'lower': P([[80, 122], [52, 68], [108, 68]], true, true); P([[80, 34], [80, 56]]); P([[68, 44], [80, 56], [92, 44]]); break;
    case 'bless': { g.beginPath(); g.arc(80, 80, 20, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; P([[80 + Math.cos(a) * 30, 80 + Math.sin(a) * 30], [80 + Math.cos(a) * 48, 80 + Math.sin(a) * 48]]); } break; }
    case 'lightning': P([[92, 30], [62, 86], [82, 86], [66, 130], [104, 72], [82, 72]], true, true); break;
    case 'swamp': { for (const [x, y, r] of [[62, 92, 14], [92, 100, 10], [82, 68, 8]] as const) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); } P([[48, 122], [112, 122]]); break; }
    case 'quake': P([[80, 34], [72, 66], [88, 82], [70, 104], [84, 126]]); P([[58, 50], [52, 78]]); P([[104, 56], [110, 88]]); break;
    case 'flood': { for (let r = 0; r < 3; r++) { g.beginPath(); for (let x = 0; x <= 88; x += 4) g.lineTo(36 + x, 66 + r * 24 + Math.sin(x / 12) * 7); g.stroke(); } break; }
    case 'volcano': P([[46, 118], [72, 54], [88, 54], [114, 118]], true); P([[80, 44], [70, 24]]); P([[84, 42], [92, 20]]); P([[76, 46], [58, 30]]); break;
    case 'totem': { g.fillRect(70, 40, 20, 80); P([[56, 52], [104, 52]]); P([[60, 76], [100, 76]]); P([[64, 98], [96, 98]]); g.beginPath(); g.arc(80, 32, 10, 0, Math.PI * 2); g.fill(); break; }
    default: { g.beginPath(); g.arc(80, 80, 26, 0, Math.PI * 2); g.stroke(); }
  }
  return c;
}

// ── 程序化兜底：UI 底图 ──────────────────────────────
function fallbackUi(name: string): HTMLCanvasElement {
  if (name === 'title_hero') {
    const [c, g] = mkCanvas(1920, 1080);
    const sky = g.createLinearGradient(0, 0, 0, 1080);
    sky.addColorStop(0, '#0c1a2e'); sky.addColorStop(0.55, '#27455e'); sky.addColorStop(0.78, '#b8814e'); sky.addColorStop(1, '#1d1408');
    g.fillStyle = sky; g.fillRect(0, 0, 1920, 1080);
    g.fillStyle = 'rgba(255,224,150,0.9)';
    g.beginPath(); g.arc(960, 760, 130, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#101c14';
    g.beginPath(); g.moveTo(0, 1080);
    for (let x = 0; x <= 1920; x += 32) g.lineTo(x, 900 - Math.abs(Math.sin(x / 340)) * 260 - hash2(x, 1, 5) * 40);
    g.lineTo(1920, 1080); g.closePath(); g.fill();
    return c;
  }
  if (name === 'emblem') {
    const [c, g] = mkCanvas(512, 512);
    g.translate(256, 256);
    g.fillStyle = '#d8a93a'; g.strokeStyle = '#8a6410'; g.lineWidth = 6;
    for (const side of [-1, 1]) {
      g.beginPath(); g.moveTo(side * 40, -10);
      g.quadraticCurveTo(side * 190, -110, side * 235, -20);
      g.quadraticCurveTo(side * 150, -30, side * 40, 40); g.closePath(); g.fill(); g.stroke();
    }
    g.beginPath(); g.arc(0, 0, 78, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#1c2b40'; g.beginPath(); g.ellipse(0, 0, 44, 30, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#6fd6e8'; g.beginPath(); g.arc(0, 0, 16, 0, Math.PI * 2); g.fill();
    return c;
  }
  // 石板 / 羊皮卷 / 按钮
  const [c, g] = mkCanvas(512, name === 'btn_stone' ? 256 : 512);
  const H = c.height;
  const stone = name !== 'parchment';
  g.fillStyle = stone ? '#57544b' : '#e6d3a8'; g.fillRect(0, 0, 512, H);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(${stone ? '20,18,14' : '120,90,40'},${0.04 + hash2(i, 1, 3) * 0.05})`;
    g.fillRect((hash2(i, 2, 3) * 512) | 0, (hash2(i, 3, 3) * H) | 0, 2 + hash2(i, 4, 3) * 4, 2);
  }
  g.strokeStyle = stone ? '#2e2b24' : '#a5824a'; g.lineWidth = 14; g.strokeRect(7, 7, 498, H - 14);
  g.strokeStyle = stone ? '#8d867a' : '#f6ecd2'; g.lineWidth = 4; g.strokeRect(16, 16, 480, H - 32);
  return c;
}
