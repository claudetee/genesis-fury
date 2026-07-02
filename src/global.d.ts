// PixiJS v8 以 vendored IIFE 引入（vendor/pixi.min.js），运行时全局 PIXI。
// 渲染层集中收敛对 any 的使用，sim/core 层保持全量强类型。
declare const PIXI: any;
