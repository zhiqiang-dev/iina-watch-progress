export interface Settings {
  completionThreshold: number;
}

export const DEFAULT_SETTINGS: Settings = { completionThreshold: 0.95 };

export function validThreshold(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0.8 && value <= 1;
}
