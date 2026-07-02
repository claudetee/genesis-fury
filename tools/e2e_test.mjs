// GENESIS FURY 端到端自测：标题 → 难度 → 开局 → 施放神迹 → 暂停/设置 → 性能采样。
// 输出截图到 /tmp/claude-1001 scratchpad + 控制台报告。
import { chromium } from '/workspace/repos/DZMM-WEB-MAIN/node_modules/playwright/index.mjs';

const BASE = process.env.GF_URL || 'http://127.0.0.1:8931';
const SHOT = process.env.GF_SHOTS || '/tmp/gf-shots';
import { mkdirSync } from 'node:fs';
mkdirSync(SHOT, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });

const shot = async (name) => { await page.screenshot({ path: `${SHOT}/${name}.png` }); console.log(`📸 ${name}`); };

console.log('1. 加载页面...');
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(2500);
await shot('01-loading-or-title');

console.log('2. 等待标题界面...');
await page.waitForSelector('#btn-new:visible', { timeout: 20000 });
await page.waitForTimeout(1200);
await shot('02-title');

console.log('3. 开始圣战 → 难度选择...');
await page.click('#btn-new');
await page.waitForSelector('.btn-diff:visible', { timeout: 5000 });
await shot('03-difficulty');

console.log('4. 选普通难度，进入游戏...');
await page.click('.btn-diff[data-diff="normal"]');
await page.waitForSelector('#hud:not(.hidden)', { timeout: 20000 });
await page.waitForTimeout(3000); // 开场运镜
await shot('04-game-start');

const canvas = await page.$('#game-canvas');
const box = await canvas.boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

console.log('5. 塑地·隆起（热键1 + 点击）...');
await page.keyboard.press('1');
await page.mouse.move(cx - 80, cy - 40);
await page.waitForTimeout(400);
await shot('05-raise-aim');
for (let i = 0; i < 5; i++) { await page.mouse.click(cx - 80 + i * 18, cy - 40 + i * 8); await page.waitForTimeout(280); }
await page.waitForTimeout(800);
await shot('06-raise-done');

console.log('6. 圣光祝福（热键3）...');
await page.keyboard.press('3');
await page.mouse.move(cx, cy);
await page.waitForTimeout(300);
await page.mouse.click(cx, cy);
await page.waitForTimeout(700);
await shot('07-bless');

console.log('7. 雷罚（热键4）...');
await page.keyboard.press('4');
await page.mouse.click(cx + 120, cy + 30);
await page.waitForTimeout(400);
await shot('08-lightning');

console.log('8. 镜头拖拽 + 缩放...');
await page.keyboard.press('Escape'); // 取消选中
await page.mouse.move(cx, cy);
await page.mouse.down({ button: 'right' });
await page.mouse.move(cx - 320, cy - 160, { steps: 12 });
await page.mouse.up({ button: 'right' });
await page.mouse.wheel(0, -600);
await page.waitForTimeout(900);
await shot('09-pan-zoom');

console.log('9. 性能采样（5s）...');
const perf = await page.evaluate(() => new Promise((res) => {
  let frames = 0; const t0 = performance.now();
  const tick = () => { frames++; if (performance.now() - t0 < 5000) requestAnimationFrame(tick); else res({ fps: Math.round(frames / 5), heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1 }); };
  requestAnimationFrame(tick);
}));
console.log(`   FPS=${perf.fps} heap=${perf.heapMB}MB`);

console.log('10. 快进游戏（3x 速度跑 25s 观察 AI 对抗）...');
await page.click('#btn-speed'); await page.click('#btn-speed'); // 3x
await page.waitForTimeout(25000);
await shot('10-midgame');
const stats = await page.evaluate(() => ({
  own: document.getElementById('pop-own')?.textContent,
  foe: document.getElementById('pop-foe')?.textContent,
  faith: document.getElementById('faith-num')?.textContent,
  time: document.getElementById('game-time')?.textContent,
}));
console.log(`   人口 ${stats.own} vs ${stats.foe} | 信仰 ${stats.faith} | 时间 ${stats.time}`);

console.log('11. 小地图点击跳转...');
const mm = await page.$('#minimap');
const mb = await mm.boundingBox();
await page.mouse.click(mb.x + mb.width * 0.72, mb.y + mb.height * 0.5);
await page.waitForTimeout(900);
await shot('11-minimap-jump');

console.log('12. 暂停 + 设置...');
await page.keyboard.press('Escape');
await page.waitForSelector('#screen-pause:not(.hidden)', { timeout: 4000 });
await shot('12-pause');
await page.click('#btn-pause-settings');
await page.waitForSelector('#screen-settings:not(.hidden)', { timeout: 4000 });
await shot('13-settings');
await page.click('#btn-settings-back');
await page.click('#btn-resume');
await page.waitForTimeout(500);

console.log('13. 存档 → 回标题 → 继续...');
await page.keyboard.press('Escape');
await page.click('#btn-save-quit');
await page.waitForSelector('#screen-title:not(.hidden)', { timeout: 6000 });
await shot('14-title-with-save');
const hasContinue = await page.$eval('#btn-continue', (el) => !el.classList.contains('hidden'));
console.log(`   继续按钮可见: ${hasContinue}`);
if (hasContinue) {
  await page.click('#btn-continue');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 20000 });
  await page.waitForTimeout(2000);
  await shot('15-continued');
  const stats2 = await page.evaluate(() => ({ time: document.getElementById('game-time')?.textContent, own: document.getElementById('pop-own')?.textContent }));
  console.log(`   读档后 时间=${stats2.time} 人口=${stats2.own}`);
}

console.log('\n═══ 报告 ═══');
console.log(`错误数: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log(`  ✗ ${e}`);
console.log(`FPS: ${perf.fps} | Heap: ${perf.heapMB}MB`);
await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
