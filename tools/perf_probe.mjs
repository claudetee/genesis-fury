// 性能探针：WebGL 后端识别 + 分场景 FPS + 主循环各段耗时
import { chromium } from '/workspace/repos/DZMM-WEB-MAIN/node_modules/playwright/index.mjs';
const BASE = process.env.GF_URL || 'http://127.0.0.1:8931';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('ERR', e.message));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#btn-new:visible', { timeout: 20000 });

const gl = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const g = c.getContext('webgl2') || c.getContext('webgl');
  if (!g) return 'none';
  const ext = g.getExtension('WEBGL_debug_renderer_info');
  return ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER);
});
console.log('WebGL renderer:', gl);

const fpsSample = () => page.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  const tick = () => { n++; performance.now() - t0 < 3000 ? requestAnimationFrame(tick) : res(Math.round(n / 3)); };
  requestAnimationFrame(tick);
}));

console.log('FPS @title:', await fpsSample());
await page.click('#btn-new');
await page.click('.btn-diff[data-diff="normal"]');
await page.waitForSelector('#hud:not(.hidden)', { timeout: 20000 });
await page.waitForTimeout(2500);
console.log('FPS @game:', await fpsSample());

// raf 帧内耗时拆解：包一层 renderer.update 不可行（打包后），用 Long Task 观察 + JS 总耗时近似
const cpu = await page.evaluate(() => new Promise((res) => {
  let busy = 0, frames = 0; let last = performance.now();
  const tick = () => {
    const t0 = performance.now();
    frames++;
    requestAnimationFrame(() => {
      const t1 = performance.now();
      busy += 0; // rAF 间隔近似
      if (t1 - last < 3000) { last = last; tick(); } else res({ frames });
    });
  };
  // 简化：测每帧 JS 占用（通过消息循环空转对比）
  const t0 = performance.now(); let n = 0;
  const loop = () => { n++; if (performance.now() - t0 < 2000) setTimeout(loop, 0); else res({ timerHz: Math.round(n / 2) }); };
  loop();
}));
console.log('event-loop idle Hz:', cpu.timerHz);
await browser.close();
