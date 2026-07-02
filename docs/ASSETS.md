# GENESIS FURY — 素材生成记录

所有美术素材由 OpenRouter 图像模型生成（key 来自 Secrets Manager，未落盘），`tools/gen_assets.mjs` 一键复现。
后处理使用 sharp（借用 DZMM-WEB-MAIN node_modules，无本地安装）。原始生成图缓存在 `assets/raw/`。


### title_hero
- **模型**: openai/gpt-5.4-image-2
- **时间**: 2026-07-02T13:25:17.812Z
- **Prompt**: Painterly epic fantasy concept art, ancient mythic bronze-age civilization, warm golden-hour light, weathered stone, moss, soft volumetric atmosphere, rich color, AAA game production quality. Wide cinematic 16:9 key art for a god game: colossal divine stone hands parting storm clouds above a floating emerald island with tiny bronze-age villages, a teal-blue benevolent glow on the left clashing with an ominous crimson storm god on the right, dramatic god rays, epic scale, no text, no watermark, no logo.
- **后处理**:
  - `ui/title_hero.webp` — cover-resize 1920x1080, webp q88

### title_hero
- **模型**: openai/gpt-5.4-image-2
- **时间**: 2026-07-02T13:27:32.639Z
- **Prompt**: Painterly epic fantasy concept art, ancient mythic bronze-age civilization, warm golden-hour light, weathered stone, moss, soft volumetric atmosphere, rich color, AAA game production quality. Wide cinematic 16:9 key art for a god game: colossal divine stone hands parting storm clouds above a floating emerald island with tiny bronze-age villages, a teal-blue benevolent glow on the left clashing with an ominous crimson storm god on the right, dramatic god rays, epic scale, no text, no watermark, no logo.
- **后处理**:
  - `ui/title_hero.webp` — cover-resize 1920x1080, webp q88

### panel_stone
- **模型**: openai/gpt-5.4-image-2
- **时间**: 2026-07-02T13:30:12.076Z
- **Prompt**: Painterly epic fantasy concept art, ancient mythic bronze-age civilization, warm golden-hour light, weathered stone, moss, soft volumetric atmosphere, rich color, AAA game production quality. Game UI asset: a single rectangular ornate carved stone frame panel, ancient temple bas-relief border with subtle laurel and rune engravings, weathered granite with faint moss in the crevices, dark neutral empty center, perfectly straight symmetric edges, uniform border thickness on all four sides, front-facing orthographic view, isolated on pure black background, no text.
- **后处理**:
  - `ui/panel_stone.webp` — resize 768, webp (CSS border-image nine-slice at runtime)

### panel_stone
- **模型**: openai/gpt-5.4-image-2
- **时间**: 2026-07-02T13:30:29.803Z
- **Prompt**: Painterly epic fantasy concept art, ancient mythic bronze-age civilization, warm golden-hour light, weathered stone, moss, soft volumetric atmosphere, rich color, AAA game production quality. Game UI asset: a single rectangular ornate carved stone frame panel, ancient temple bas-relief border with subtle laurel and rune engravings, weathered granite with faint moss in the crevices, dark neutral empty center, perfectly straight symmetric edges, uniform border thickness on all four sides, front-facing orthographic view, isolated on pure black background, no text.
- **后处理**:
  - `ui/panel_stone.webp` — resize 768, webp (CSS border-image nine-slice at runtime)

### parchment
- **模型**: openai/gpt-5.4-image-2
- **时间**: 2026-07-02T13:33:50.547Z
- **Prompt**: Painterly epic fantasy concept art, ancient mythic bronze-age civilization, warm golden-hour light, weathered stone, moss, soft volumetric atmosphere, rich color, AAA game production quality. Game UI asset: a rectangular sheet of aged parchment paper with gently deckled torn edges, warm cream color, subtle fiber texture and light stains, slightly darker burnt border, flat front-facing orthographic view, fills the frame edge to edge, isolated on pure black background, no text, no objects.
- **后处理**:
  - `ui/parchment.webp` — resize 768, webp (CSS border-image nine-slice)

### btn_stone
- **模型**: openai/gpt-5.4-image-2
- **时间**: 2026-07-02T13:36:15.612Z
- **Prompt**: Painterly epic fantasy concept art, ancient mythic bronze-age civilization, warm golden-hour light, weathered stone, moss, soft volumetric atmosphere, rich color, AAA game production quality. Game UI asset: a single wide rectangular carved stone button with a beveled gold-leaf trim edge and a smooth slightly domed empty face, ancient temple style, weathered granite, symmetric, front-facing orthographic view, isolated on pure black background, no text, no icon.
- **后处理**:
  - `ui/btn_stone.webp` — resize 512x256, webp (CSS border-image nine-slice)

### icons_miracles
- **模型**: openai/gpt-5.4-image-2
- **时间**: 2026-07-02T13:39:19.429Z
- **Prompt**: Painterly epic fantasy concept art, ancient mythic bronze-age civilization, warm golden-hour light, weathered stone, moss, soft volumetric atmosphere, rich color, AAA game production quality. Game UI icon sheet: a strict 3x3 grid of nine square miracle icons for a god game, each icon a glowing rune symbol carved into a round weathered stone medallion, consistent style and framing, dark background between cells, clear equal margins between cells. Row 1: mountain rising with upward arrow; sinking cracked ground with downward arrow; radiant sun blessing with small leaves. Row 2: a single lightning bolt; a murky swamp bubble with reeds; a cracked earthquake fissure. Row 3: a giant ocean wave flood; an erupting volcano cone; a tribal wooden totem pole. No text, no numbers.
- **后处理**:
  - `icons/raise.png` — grid-slice 3x3, inset 20px, circle alpha mask, 160px
  - `icons/lower.png` — grid-slice 3x3, inset 20px, circle alpha mask, 160px
  - `icons/bless.png` — grid-slice 3x3, inset 20px, circle alpha mask, 160px
  - `icons/lightning.png` — grid-slice 3x3, inset 20px, circle alpha mask, 160px
  - `icons/swamp.png` — grid-slice 3x3, inset 20px, circle alpha mask, 160px
  - `icons/quake.png` — grid-slice 3x3, inset 20px, circle alpha mask, 160px
  - `icons/flood.png` — grid-slice 3x3, inset 20px, circle alpha mask, 160px
  - `icons/volcano.png` — grid-slice 3x3, inset 20px, circle alpha mask, 160px
  - `icons/totem.png` — grid-slice 3x3, inset 20px, circle alpha mask, 160px

### terrain_atlas
- **模型**: openai/gpt-5.4-image-2
- **时间**: 2026-07-02T13:42:39.760Z
- **Prompt**: Hand-painted seamless tileable game terrain textures, stylized painterly fantasy, top-down orthographic view, even diffuse lighting, no shadows of external objects: a strict 3x2 grid of six square texture swatches with thin dark separation lines. Top row: lush green grass meadow with tiny flowers; warm golden beach sand with faint ripples; grey rocky cliff stone with cracks. Bottom row: fresh alpine snow with slight sparkle; dark fertile soil with pebbles; glowing orange-red lava with black crust. Flat texture only, no horizon, no sky, no text.
- **后处理**:
  - `terrain/grass.png` — grid-slice 3x2, inset, mirror-blend edges for seamless tiling, 256px
  - `terrain/sand.png` — grid-slice 3x2, inset, mirror-blend edges for seamless tiling, 256px
  - `terrain/rock.png` — grid-slice 3x2, inset, mirror-blend edges for seamless tiling, 256px
  - `terrain/snow.png` — grid-slice 3x2, inset, mirror-blend edges for seamless tiling, 256px
  - `terrain/soil.png` — grid-slice 3x2, inset, mirror-blend edges for seamless tiling, 256px
  - `terrain/lava.png` — grid-slice 3x2, inset, mirror-blend edges for seamless tiling, 256px

### buildings
- **模型**: openai/gpt-5.4-image-2
- **时间**: 2026-07-02T13:45:54.744Z
- **Prompt**: Painterly epic fantasy concept art, ancient mythic bronze-age civilization, warm golden-hour light, weathered stone, moss, soft volumetric atmosphere, rich color, AAA game production quality. Game sprite sheet: a strict 3x3 grid of isometric bronze-age building sprites, consistent 3/4 top-down isometric angle, consistent scale and lighting from top-left, each sprite fully inside its cell with margin, isolated on a uniform pure magenta background (#FF00FF). Row 1 (teal-blue faction, azure banners): small thatched hut; medium stone house with teal awning; grand two-story temple dwelling with teal banners. Row 2 (crimson faction, red banners): small dark hide tent; medium dark timber house with red awning; grand dark spiked shrine with crimson banners. Row 3: a teal carved wooden totem pole with glowing eye; a crimson carved totem pole with horns; a pile of grey stone ruins and rubble. No text.
- **后处理**:
  - `sprites/house_a1.png` — grid-slice 3x3, magenta chroma-key + despill, trim, fit 200px
  - `sprites/house_a2.png` — grid-slice 3x3, magenta chroma-key + despill, trim, fit 200px
  - `sprites/house_a3.png` — grid-slice 3x3, magenta chroma-key + despill, trim, fit 200px
  - `sprites/house_b1.png` — grid-slice 3x3, magenta chroma-key + despill, trim, fit 200px
  - `sprites/house_b2.png` — grid-slice 3x3, magenta chroma-key + despill, trim, fit 200px
  - `sprites/house_b3.png` — grid-slice 3x3, magenta chroma-key + despill, trim, fit 200px
  - `sprites/totem_a.png` — grid-slice 3x3, magenta chroma-key + despill, trim, fit 200px
  - `sprites/totem_b.png` — grid-slice 3x3, magenta chroma-key + despill, trim, fit 200px
  - `sprites/ruin.png` — grid-slice 3x3, magenta chroma-key + despill, trim, fit 200px

### emblem
- **模型**: openai/gpt-5.4-image-2
- **时间**: 2026-07-02T13:48:33.276Z
- **Prompt**: Painterly epic fantasy concept art, ancient mythic bronze-age civilization, warm golden-hour light, weathered stone, moss, soft volumetric atmosphere, rich color, AAA game production quality. Game logo emblem: a single majestic golden winged sun disc with a central all-seeing divine eye, ornate bronze-age carved metal, subtle teal gem inlays, perfectly centered, symmetric, isolated on pure black background, glowing edges, no text.
- **后处理**:
  - `ui/emblem.png` — black luma-key to alpha, trim, 512px

### avatars
- **模型**: google/gemini-3-pro-image
- **时间**: 2026-07-02T16:51:14.319Z
- **Prompt**: Painterly epic fantasy concept art, ancient mythic bronze-age civilization, warm golden-hour light, weathered stone, moss, soft volumetric atmosphere, rich color, AAA game production quality. Game sprite sheet: a strict 2x1 grid (two cells side by side) of full-body fantasy avatar sprites, consistent 3/4 top-down isometric angle, consistent scale, lighting from top-left, each figure fully inside its cell with margin, isolated on a uniform pure magenta background (#FF00FF). Left cell: a serene divine prophetess in flowing teal-and-white robes holding a tall golden staff topped with a glowing sun disc, gentle azure aura. Right cell: a menacing dark shaman in tattered crimson-and-black robes holding a crooked staff topped with a burning red skull totem, ember-red aura. No text.
- **后处理**:
  - `sprites/avatar_a.png` — grid-slice 2x1, magenta chroma-key + despill, trim, fit 220px
  - `sprites/avatar_b.png` — grid-slice 2x1, magenta chroma-key + despill, trim, fit 220px

### avatars
- **模型**: cached
- **时间**: 2026-07-02T16:52:22.813Z
- **Prompt**: Painterly epic fantasy concept art, ancient mythic bronze-age civilization, warm golden-hour light, weathered stone, moss, soft volumetric atmosphere, rich color, AAA game production quality. Game sprite sheet: a strict 2x1 grid (two cells side by side) of full-body fantasy avatar sprites, consistent 3/4 top-down isometric angle, consistent scale, lighting from top-left, each figure fully inside its cell with margin, isolated on a uniform pure magenta background (#FF00FF). Left cell: a serene divine prophetess in flowing teal-and-white robes holding a tall golden staff topped with a glowing sun disc, gentle azure aura. Right cell: a menacing dark shaman in tattered crimson-and-black robes holding a crooked staff topped with a burning red skull totem, ember-red aura. No text.
- **后处理**:
  - `sprites/avatar_a.png` — grid-slice 2x1, magenta chroma-key + despill, trim, fit 220px
  - `sprites/avatar_b.png` — grid-slice 2x1, magenta chroma-key + despill, trim, fit 220px

### avatars
- **模型**: google/gemini-3-pro-image
- **时间**: 2026-07-02T17:02:02.653Z
- **Prompt**: Game asset sprite sheet on a FLAT SOLID MAGENTA (#FF00FF) chroma-key background — the entire background must be one single uniform magenta color with no gradient, no texture, no vignette. A strict 2x1 grid (two cells side by side) of full-body painterly fantasy avatar sprites, consistent 3/4 top-down isometric angle, consistent scale, lighting from top-left, each figure fully inside its cell with margin. Left cell: a serene divine prophetess in flowing deep-teal robes with gold trim holding a tall golden staff topped with a glowing sun disc. Right cell: a menacing dark shaman in tattered crimson-and-black robes holding a crooked staff topped with a burning red skull totem. Rich saturated colors, AAA game quality, no text, no watermark.
- **后处理**:
  - `sprites/avatar_a.png` — grid-slice 2x1, magenta chroma-key + despill, trim, fit 220px
  - `sprites/avatar_b.png` — grid-slice 2x1, magenta chroma-key + despill, trim, fit 220px

### doodads
- **模型**: openai/gpt-5-image
- **时间**: 2026-07-02T17:22:24.180Z
- **Prompt**: Game asset sprite sheet on a FLAT SOLID MAGENTA (#FF00FF) chroma-key background — entire background one single uniform magenta, no gradient, no texture. A strict 3x3 grid of painterly fantasy nature doodad sprites, consistent 3/4 top-down isometric angle, consistent scale, lighting from top-left, each sprite fully inside its cell with margin. Row 1: a lush broadleaf oak tree; a tall dark pine tree; a swaying tropical palm tree. Row 2: a large mossy grey boulder; a cluster of three small rocks; a flowering pink bush. Row 3: a gnarled dead tree; a patch of tall golden reeds; two red-capped mushrooms. Rich saturated painterly colors, AAA game quality, no text.
- **后处理**:
  - `sprites/tree_oak.png` — grid-slice 3x3, chroma/flood key, trim, fit 140px
  - `sprites/tree_pine.png` — grid-slice 3x3, chroma/flood key, trim, fit 140px
  - `sprites/tree_palm.png` — grid-slice 3x3, chroma/flood key, trim, fit 140px
  - `sprites/rock_big.png` — grid-slice 3x3, chroma/flood key, trim, fit 140px
  - `sprites/rock_small.png` — grid-slice 3x3, chroma/flood key, trim, fit 140px
  - `sprites/bush_flower.png` — grid-slice 3x3, chroma/flood key, trim, fit 140px
  - `sprites/tree_dead.png` — grid-slice 3x3, chroma/flood key, trim, fit 140px
  - `sprites/reeds.png` — grid-slice 3x3, chroma/flood key, trim, fit 140px
  - `sprites/mushroom.png` — grid-slice 3x3, chroma/flood key, trim, fit 140px

### buildings2
- **模型**: openai/gpt-5.4-image-2
- **时间**: 2026-07-02T17:25:30.957Z
- **Prompt**: Game asset sprite sheet on a FLAT SOLID MAGENTA (#FF00FF) chroma-key background — entire background one single uniform magenta, no gradient. A strict 3x3 grid of painterly bronze-age military building sprites, consistent 3/4 top-down isometric angle, consistent scale, lighting from top-left, each fully inside its cell with margin. Row 1 (teal-blue faction, azure banners): a warrior training lodge with crossed swords sign and teal banner; a fire-mage academy with a burning brazier and teal roof; a small white marble sanctuary with a golden bell and teal trim. Row 2 (crimson faction): a dark warrior training lodge with crossed axes and red banner; a dark fire-mage academy with green flame brazier and red roof; a dark bone shrine with a red crystal. Row 3: a tall teal stone guard tower with a watch fire on top; a tall crimson dark guard tower with a skull totem on top; a primitive neutral grey wildman tent with bones. Rich saturated painterly colors, AAA quality, no text.
- **后处理**:
  - `sprites/barracks_a.png` — grid-slice 3x3, chroma/flood key, trim, fit 210px
  - `sprites/mageschool_a.png` — grid-slice 3x3, chroma/flood key, trim, fit 210px
  - `sprites/sanctum_a.png` — grid-slice 3x3, chroma/flood key, trim, fit 210px
  - `sprites/barracks_b.png` — grid-slice 3x3, chroma/flood key, trim, fit 210px
  - `sprites/mageschool_b.png` — grid-slice 3x3, chroma/flood key, trim, fit 210px
  - `sprites/sanctum_b.png` — grid-slice 3x3, chroma/flood key, trim, fit 210px
  - `sprites/tower_a.png` — grid-slice 3x3, chroma/flood key, trim, fit 210px
  - `sprites/tower_b.png` — grid-slice 3x3, chroma/flood key, trim, fit 210px
  - `sprites/wildtent.png` — grid-slice 3x3, chroma/flood key, trim, fit 210px

### icons2
- **模型**: openai/gpt-5.4-image-2
- **时间**: 2026-07-02T17:28:11.435Z
- **Prompt**: Painterly epic fantasy concept art, ancient mythic bronze-age civilization, warm golden-hour light, weathered stone, moss, soft volumetric atmosphere, rich color, AAA game production quality. Game UI icon sheet: a strict 3x2 grid of six square icons, each a glowing rune symbol carved into a round weathered stone medallion, consistent style with clear equal margins between cells, dark background between cells. Row 1: a meteor shower of three falling burning stars; a swirling teleport portal spiral; crossed swords. Row 2: a fireball in an open palm; a white chapel bell with light rays; a stone watchtower. No text, no numbers.
- **后处理**:
  - `icons/firestorm.png` — grid-slice 3x2, inset, circle mask, 160px
  - `icons/teleport.png` — grid-slice 3x2, inset, circle mask, 160px
  - `icons/barracks.png` — grid-slice 3x2, inset, circle mask, 160px
  - `icons/mageschool.png` — grid-slice 3x2, inset, circle mask, 160px
  - `icons/sanctum.png` — grid-slice 3x2, inset, circle mask, 160px
  - `icons/tower.png` — grid-slice 3x2, inset, circle mask, 160px
