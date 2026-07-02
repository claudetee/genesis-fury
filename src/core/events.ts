// 轻量类型化事件总线 — sim 产生事件，render/audio/ui 消费，模块间零直接依赖
export interface GameEvents {
  miracleCast: { id: string; x: number; y: number; faction: number };
  miracleDenied: { id: string; reason: 'faith' | 'cooldown' | 'invalid' | 'range' | 'dead' };
  avatarMove: { x: number; y: number };
  avatarDeath: { faction: number; x: number; y: number };
  avatarRespawn: { faction: number; x: number; y: number };
  terrainChanged: { x0: number; y0: number; x1: number; y1: number };
  waterChanged: { level: number };
  entitySpawn: { kind: 'follower' | 'house' | 'totem'; id: number; faction: number; x: number; y: number };
  entityDeath: { kind: 'follower' | 'house' | 'totem'; id: number; faction: number; x: number; y: number; cause: string };
  houseUpgrade: { id: number; level: number; x: number; y: number };
  fireStart: { id: number; x: number; y: number };
  combat: { x: number; y: number };
  lightningStrike: { x: number; y: number };
  quakeShake: { x: number; y: number; power: number };
  volcanoErupt: { x: number; y: number };
  floodStart: Record<string, never>;
  floodEnd: Record<string, never>;
  blessApplied: { x: number; y: number; r: number };
  swampApplied: { x: number; y: number; r: number };
  totemPlaced: { x: number; y: number; faction: number };
  gameOver: { victory: boolean };
  armageddon: Record<string, never>;
  toast: { text: string; kind?: 'info' | 'warn' | 'good' };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private map = new Map<string, Set<Handler<unknown>>>();
  on<K extends keyof GameEvents>(ev: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.map.get(ev as string);
    if (!set) { set = new Set(); this.map.set(ev as string, set); }
    set.add(fn as Handler<unknown>);
    return () => set!.delete(fn as Handler<unknown>);
  }
  emit<K extends keyof GameEvents>(ev: K, payload: GameEvents[K]): void {
    const set = this.map.get(ev as string);
    if (set) for (const fn of set) (fn as Handler<GameEvents[K]>)(payload);
  }
  clear(): void { this.map.clear(); }
}
