// GENESIS FURY — asset generation pipeline
// Usage: secrets-manager.py exec -k OPENROUTER_API_KEY 'node tools/gen_assets.mjs [--only name]'
// Generates painterly game assets via OpenRouter image models, post-processes with sharp
// (grid slicing, chroma-key matting, despill, trim, resize), writes assets/manifest.json
// and appends a generation log to docs/ASSETS.md.
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require2 = createRequire('/workspace/repos/DZMM-WEB-MAIN/node_modules/');
const sharp = require2('sharp');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'assets', 'raw');
const OUT = join(ROOT, 'assets');
for (const d of [RAW, join(OUT, 'ui'), join(OUT, 'icons'), join(OUT, 'terrain'), join(OUT, 'sprites')]) mkdirSync(d, { recursive: true });

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('OPENROUTER_API_KEY missing'); process.exit(1); }

const MODELS = ['openai/gpt-5.4-image-2', 'openai/gpt-5-image', 'google/gemini-3-pro-image'];

const STYLE = 'Painterly epic fantasy concept art, ancient mythic bronze-age civilization, warm golden-hour light, weathered stone, moss, soft volumetric atmosphere, rich color, AAA game production quality.';

/** @type {Record<string, {prompt:string, post:(raw:Buffer)=>Promise<object[]>}>} */
const ASSETS = {
  title_hero: {
    prompt: `${STYLE} Wide cinematic 16:9 key art for a god game: colossal divine stone hands parting storm clouds above a floating emerald island with tiny bronze-age villages, a teal-blue benevolent glow on the left clashing with an ominous crimson storm god on the right, dramatic god rays, epic scale, no text, no watermark, no logo.`,
    post: async (raw) => {
      const buf = await sharp(raw).resize(1920, 1080, { fit: 'cover' }).webp({ quality: 88 }).toBuffer();
      writeFileSync(join(OUT, 'ui', 'title_hero.webp'), buf);
      return [{ file: 'ui/title_hero.webp', op: 'cover-resize 1920x1080, webp q88' }];
    },
  },
  panel_stone: {
    prompt: `${STYLE} Game UI asset: a single rectangular ornate carved stone frame panel, ancient temple bas-relief border with subtle laurel and rune engravings, weathered granite with faint moss in the crevices, dark neutral empty center, perfectly straight symmetric edges, uniform border thickness on all four sides, front-facing orthographic view, isolated on pure black background, no text.`,
    post: async (raw) => {
      const buf = await sharp(raw).resize(768, 768, { fit: 'fill' }).webp({ quality: 90 }).toBuffer();
      writeFileSync(join(OUT, 'ui', 'panel_stone.webp'), buf);
      return [{ file: 'ui/panel_stone.webp', op: 'resize 768, webp (CSS border-image nine-slice at runtime)' }];
    },
  },
  parchment: {
    prompt: `${STYLE} Game UI asset: a rectangular sheet of aged parchment paper with gently deckled torn edges, warm cream color, subtle fiber texture and light stains, slightly darker burnt border, flat front-facing orthographic view, fills the frame edge to edge, isolated on pure black background, no text, no objects.`,
    post: async (raw) => {
      const buf = await sharp(raw).resize(768, 768, { fit: 'fill' }).webp({ quality: 90 }).toBuffer();
      writeFileSync(join(OUT, 'ui', 'parchment.webp'), buf);
      return [{ file: 'ui/parchment.webp', op: 'resize 768, webp (CSS border-image nine-slice)' }];
    },
  },
  btn_stone: {
    prompt: `${STYLE} Game UI asset: a single wide rectangular carved stone button with a beveled gold-leaf trim edge and a smooth slightly domed empty face, ancient temple style, weathered granite, symmetric, front-facing orthographic view, isolated on pure black background, no text, no icon.`,
    post: async (raw) => {
      const buf = await sharp(raw).resize(512, 256, { fit: 'fill' }).webp({ quality: 90 }).toBuffer();
      writeFileSync(join(OUT, 'ui', 'btn_stone.webp'), buf);
      return [{ file: 'ui/btn_stone.webp', op: 'resize 512x256, webp (CSS border-image nine-slice)' }];
    },
  },
  icons_miracles: {
    prompt: `${STYLE} Game UI icon sheet: a strict 3x3 grid of nine square miracle icons for a god game, each icon a glowing rune symbol carved into a round weathered stone medallion, consistent style and framing, dark background between cells, clear equal margins between cells. Row 1: mountain rising with upward arrow; sinking cracked ground with downward arrow; radiant sun blessing with small leaves. Row 2: a single lightning bolt; a murky swamp bubble with reeds; a cracked earthquake fissure. Row 3: a giant ocean wave flood; an erupting volcano cone; a tribal wooden totem pole. No text, no numbers.`,
    post: async (raw) => {
      const img = sharp(raw).resize(1026, 1026, { fit: 'fill' });
      const buf = await img.png().toBuffer();
      const names = ['raise', 'lower', 'bless', 'lightning', 'swamp', 'quake', 'flood', 'volcano', 'totem'];
      const outs = [];
      for (let i = 0; i < 9; i++) {
        const cx = (i % 3) * 342, cy = Math.floor(i / 3) * 342;
        // inset to trim grid gutters, round-mask to medallion
        const cell = await sharp(buf).extract({ left: cx + 20, top: cy + 20, width: 302, height: 302 }).resize(160, 160).png().toBuffer();
        const masked = await circleMask(cell, 160);
        writeFileSync(join(OUT, 'icons', `${names[i]}.png`), masked);
        outs.push({ file: `icons/${names[i]}.png`, op: 'grid-slice 3x3, inset 20px, circle alpha mask, 160px' });
      }
      return outs;
    },
  },
  terrain_atlas: {
    prompt: `Hand-painted seamless tileable game terrain textures, stylized painterly fantasy, top-down orthographic view, even diffuse lighting, no shadows of external objects: a strict 3x2 grid of six square texture swatches with thin dark separation lines. Top row: lush green grass meadow with tiny flowers; warm golden beach sand with faint ripples; grey rocky cliff stone with cracks. Bottom row: fresh alpine snow with slight sparkle; dark fertile soil with pebbles; glowing orange-red lava with black crust. Flat texture only, no horizon, no sky, no text.`,
    post: async (raw) => {
      const buf = await sharp(raw).resize(1026, 684, { fit: 'fill' }).png().toBuffer();
      const names = ['grass', 'sand', 'rock', 'snow', 'soil', 'lava'];
      const outs = [];
      for (let i = 0; i < 6; i++) {
        const cx = (i % 3) * 342, cy = Math.floor(i / 3) * 342;
        const cell = await sharp(buf).extract({ left: cx + 12, top: cy + 12, width: 318, height: 318 }).resize(256, 256).png().toBuffer();
        const tiled = await selfMirrorTile(cell, 256);
        writeFileSync(join(OUT, 'terrain', `${names[i]}.png`), tiled);
        outs.push({ file: `terrain/${names[i]}.png`, op: 'grid-slice 3x2, inset, mirror-blend edges for seamless tiling, 256px' });
      }
      return outs;
    },
  },
  buildings: {
    prompt: `${STYLE} Game sprite sheet: a strict 3x3 grid of isometric bronze-age building sprites, consistent 3/4 top-down isometric angle, consistent scale and lighting from top-left, each sprite fully inside its cell with margin, isolated on a uniform pure magenta background (#FF00FF). Row 1 (teal-blue faction, azure banners): small thatched hut; medium stone house with teal awning; grand two-story temple dwelling with teal banners. Row 2 (crimson faction, red banners): small dark hide tent; medium dark timber house with red awning; grand dark spiked shrine with crimson banners. Row 3: a teal carved wooden totem pole with glowing eye; a crimson carved totem pole with horns; a pile of grey stone ruins and rubble. No text.`,
    post: async (raw) => {
      const buf = await sharp(raw).resize(1026, 1026, { fit: 'fill' }).png().toBuffer();
      const names = ['house_a1', 'house_a2', 'house_a3', 'house_b1', 'house_b2', 'house_b3', 'totem_a', 'totem_b', 'ruin'];
      const outs = [];
      for (let i = 0; i < 9; i++) {
        const cx = (i % 3) * 342, cy = Math.floor(i / 3) * 342;
        const cell = await sharp(buf).extract({ left: cx + 8, top: cy + 8, width: 326, height: 326 }).png().toBuffer();
        const keyed = await chromaKey(cell);
        const trimmed = await sharp(keyed).trim({ threshold: 8 }).png().toBuffer();
        const final = await sharp(trimmed).resize(200, 200, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
        writeFileSync(join(OUT, 'sprites', `${names[i]}.png`), final);
        outs.push({ file: `sprites/${names[i]}.png`, op: 'grid-slice 3x3, magenta chroma-key + despill, trim, fit 200px' });
      }
      return outs;
    },
  },
  emblem: {
    prompt: `${STYLE} Game logo emblem: a single majestic golden winged sun disc with a central all-seeing divine eye, ornate bronze-age carved metal, subtle teal gem inlays, perfectly centered, symmetric, isolated on pure black background, glowing edges, no text.`,
    post: async (raw) => {
      const keyed = await blackKey(await sharp(raw).resize(768, 768, { fit: 'inside' }).png().toBuffer());
      const trimmed = await sharp(keyed).trim({ threshold: 12 }).resize(512, 512, { fit: 'inside' }).png().toBuffer();
      writeFileSync(join(OUT, 'ui', 'emblem.png'), trimmed);
      return [{ file: 'ui/emblem.png', op: 'black luma-key to alpha, trim, 512px' }];
    },
  },
};

async function circleMask(png, size) {
  const r = size / 2;
  const svg = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${r}" cy="${r}" r="${r - 1}" fill="#fff"/></svg>`);
  return sharp(png).composite([{ input: svg, blend: 'dest-in' }]).png().toBuffer();
}

// blend edges with mirrored copy so texture tiles seamlessly
async function selfMirrorTile(png, size) {
  const img = sharp(png).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, ch = info.channels;
  const out = Buffer.from(data);
  const band = Math.floor(size * 0.12);
  const mix = (a, b, t) => Math.round(a * (1 - t) + b * t);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < band; x++) {
      const t = 0.5 * (1 - x / band);
      const i = (y * w + x) * ch, j = (y * w + (w - 1 - x)) * ch;
      for (let c = 0; c < 3; c++) { const a = out[i + c], b = out[j + c]; out[i + c] = mix(a, b, t); out[j + c] = mix(b, a, t); }
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < band; y++) {
      const t = 0.5 * (1 - y / band);
      const i = (y * w + x) * ch, j = ((h - 1 - y) * w + x) * ch;
      for (let c = 0; c < 3; c++) { const a = out[i + c], b = out[j + c]; out[i + c] = mix(a, b, t); out[j + c] = mix(b, a, t); }
    }
  }
  return sharp(out, { raw: { width: w, height: h, channels: ch } }).png().toBuffer();
}

async function chromaKey(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const d = data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const magenta = r > 120 && b > 120 && g < Math.min(r, b) * 0.6;
    if (magenta) d[i + 3] = 0;
    else if (r > 90 && b > 90 && g < Math.min(r, b) * 0.85) {
      // despill fringe: pull magenta cast toward neutral, soften alpha
      const spill = Math.min(r, b) - g;
      d[i] = Math.max(0, r - spill * 0.5); d[i + 2] = Math.max(0, b - spill * 0.5);
      d[i + 3] = Math.min(d[i + 3], 255 - spill);
    }
  }
  return sharp(d, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

async function blackKey(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const d = data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (lum < 26) d[i + 3] = 0;
    else if (lum < 60) d[i + 3] = Math.round(((lum - 26) / 34) * 255);
  }
  return sharp(d, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

async function generate(name, prompt) {
  for (const model of MODELS) {
    try {
      console.log(`[${name}] trying ${model} ...`);
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, modalities: ['image', 'text'], messages: [{ role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(300000),
      });
      if (!res.ok) { console.warn(`[${name}] ${model} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`); continue; }
      const j = await res.json();
      const imgs = j.choices?.[0]?.message?.images;
      if (!imgs?.length) { console.warn(`[${name}] ${model} returned no image`); continue; }
      const url = imgs[0].image_url?.url || imgs[0].url;
      const b64 = url.split(',')[1];
      return { buf: Buffer.from(b64, 'base64'), model };
    } catch (e) { console.warn(`[${name}] ${model} error: ${e.message}`); }
  }
  return null;
}

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const manifestPath = join(OUT, 'manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { generated: {}, files: {} };
let failures = 0;

for (const [name, spec] of Object.entries(ASSETS)) {
  if (only && name !== only) continue;
  const rawPath = join(RAW, `${name}.png`);
  let raw = null, model = 'cached';
  if (!process.argv.includes('--force') && existsSync(rawPath)) {
    raw = readFileSync(rawPath);
    console.log(`[${name}] using cached raw`);
  } else {
    const r = await generate(name, spec.prompt);
    if (!r) { console.error(`[${name}] ALL MODELS FAILED — procedural fallback will be used in-game`); failures++; continue; }
    raw = r.buf; model = r.model;
    writeFileSync(rawPath, raw);
  }
  try {
    const outs = await spec.post(raw);
    manifest.generated[name] = { model, at: new Date().toISOString(), outputs: outs.map(o => o.file) };
    for (const o of outs) manifest.files[o.file] = true;
    appendFileSync(join(ROOT, 'docs', 'ASSETS.md'),
      `\n### ${name}\n- **模型**: ${model}\n- **时间**: ${new Date().toISOString()}\n- **Prompt**: ${spec.prompt}\n- **后处理**:\n${outs.map(o => `  - \`${o.file}\` — ${o.op}`).join('\n')}\n`);
    console.log(`[${name}] OK → ${outs.length} file(s)`);
  } catch (e) { console.error(`[${name}] post-process failed: ${e.message}`); failures++; }
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`done. failures=${failures}`);
process.exit(failures > 0 ? 2 : 0);
