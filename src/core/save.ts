// 存档与设置持久化（localStorage）。存档失败（隐私模式/配额）静默降级，不影响游戏。
import { SAVE_KEY, SETTINGS_KEY } from './const';
import { SaveData } from '../sim/sim';

export interface Settings {
  masterVol: number; musicVol: number; sfxVol: number;
  quality: 'low' | 'medium' | 'high';
  camSpeed: number;          // 0.5..2
  edgeScroll: boolean;
  difficulty: 'easy' | 'normal' | 'hard';
  tutorialDone: boolean;
}

export const defaultSettings: Settings = {
  masterVol: 0.8, musicVol: 0.7, sfxVol: 0.9,
  quality: 'high', camSpeed: 1, edgeScroll: true,
  difficulty: 'normal', tutorialDone: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...defaultSettings };
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export interface SaveEnvelope { data: SaveData; savedAt: number; difficulty: string }

export function saveGame(data: SaveData, difficulty: string): boolean {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ data, savedAt: Date.now(), difficulty }));
    return true;
  } catch { return false; }
}

export function loadGame(): SaveEnvelope | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const env = JSON.parse(raw) as SaveEnvelope;
    if (!env?.data || env.data.v !== 1) return null;
    return env;
  } catch { return null; }
}

export function clearSave(): void {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
