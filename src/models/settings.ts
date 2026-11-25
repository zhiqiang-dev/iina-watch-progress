export interface Settings {
  completionThreshold: number;
  /** Missing in older snapshots; use the default without rewriting on load. */
  saveIntervalSeconds?: number;
}

export const SAVE_INTERVALS = [5, 15, 30, 60] as const;
export const DEFAULT_SAVE_INTERVAL = 5;
export const DEFAULT_SETTINGS: Settings = { completionThreshold: 0.95, saveIntervalSeconds: DEFAULT_SAVE_INTERVAL };

export function validSaveInterval(value: unknown): value is number {
  return typeof value === "number" && SAVE_INTERVALS.some(interval => interval === value);
}

export function validThreshold(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0.8 && value <= 1;
}
