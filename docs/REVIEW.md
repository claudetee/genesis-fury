# 审查记录 — 2026-07-02

三路独立审查 + 修复验证闭环：

| 路 | 形式 | 结果 |
|----|------|------|
| Workflow 五维审查 | 24 个 agent：5 维度（sim 正确性/渲染性能/交互手感/移动端/健壮性）并行审查 → 每个 finding 由独立 agent 对抗验证（倾向证伪） | 19 verdicts：16 REAL / 3 refuted（refuted 项均为审查期间已修复的代码，交叉印证） |
| Opus 独立整体审查 | 独立上下文通读全部源码 | 与五维结果高度重合（双指误施法/reserved 泄漏/存档瞬态），另抓到 1 条新问题（终局窗口 AI 仍动作），并显式核实 8 类"干净项" |
| Codex (GPT-5.5) | — | **不可用**：容器内 OAuth refresh token 被吊销（401 token_invalidated），需人工重登。已用独立 Opus agent 替代二审 |

## 修复清单（全部已修 + 回归验证）

**模拟层**
- `reserved[]` 孤儿预约泄漏：Seek/Build 被战斗打断、寻路卡死、重新选址三条路径都不释放旧预约 → 前线可建地慢性枯竭。三处补 `releaseReservation` + 覆盖前兜底释放
- 存档不对称：`swampUntil/lavaUntil`（稀疏编码）、`fireUntil/blessedUntil`、神迹 `cooldowns` 全部入档；读档后沼泽消失/着火自灭/冷却清零的 save-scum 全部堵死。往返序列化字节级一致（`tools/` 下有测试）
- 终局结算窗（1.8s）内 AI 停手、玩家施法被 gate

**渲染层**
- 沼泽/岩浆到期不重建（视觉永久停留过期状态）：chunk 与小地图各自跟踪 `nextExpiry` 到点自愈
- 洪水动画期全图 64 chunk × 每帧重建 + 每瓦片 ~7 次临时数组分配：rebuild 热路径改零分配（模块级 scratch），水位动画只重建近水 chunk（`minH` 判定）
- 每局重开泄漏 ~13 个 canvas 纹理进 PIXI 全局 Cache：地形图集/信徒/火焰/光环/粒子纹理全部改跨局模块级单例

**交互/移动端**
- 双指捏合结束误判 tap → 误施法（花信仰+不可逆改地形）：`hadMulti` 手势标记，多点手势全程与收尾抑制 tap
- 触屏选中塑地后单指无法平移（每次触摸都连发施法）：长按连发改为仅鼠标
- `enabled=false` 期间抬指泄漏 dragging/brushHold 到恢复后：手势状态无条件先清
- Esc 返回链断裂（暂停→设置→Esc 直接回游戏）：`handleEsc` 统一入口，设置页 Esc 回暂停菜单
- 神迹栏窄屏被 flex 压扁 → `flex-wrap` 两行；HUD 加 `env(safe-area-inset-*)` 适配刘海/Home Indicator
- iOS 音频解锁：单次 pointerdown 改多事件（pointerdown/touchend/keydown）+ 确认 `AudioContext.state === 'running'` 才解绑

**生命周期**
- 重开局竞态崩溃：`mount()` 在 `await renderer.init()` 前就暴露 `this.renderer`，上局 RAF 循环会 update 未初始化对象 → 改为初始化完成后才赋值 + teardown 取消 RAF
- Hud/Minimap/Tutorial 在持久 DOM 上 `addEventListener` 跨局累积（速度按钮一次跳两档）→ 全部改幂等 `onclick`/`onpointerX` 赋值

## 验证

- `tools/e2e_test.mjs`：15 步全流程（含存档→读档状态连续性），修复后 **0 JS 错误**
- 连开两局回归：速度按钮单步、Esc 链正确、零错误（重开局竞态与监听器泄漏的针对性验证）
- `tools/sim_test.ts`：12 分钟无头对局，AI 不再自拆城（`house:terrain:f1` 归零），0.31ms/tick
- 存档往返：serialize→deserialize→serialize 字节级一致，沼泽 18 格/3 项冷却读档全保留
