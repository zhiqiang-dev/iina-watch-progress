import type { PlaybackSample } from "../core/playback-tracker";

export class MpvAdapter {
  constructor(private readonly mpv: IINA.API.MPV) {}
  number(name: string, fallback = 0): number {
    try {
      const value = this.mpv.getNumber(name);
      return typeof value === "number" && Number.isFinite(value) ? value : fallback;
    } catch { return fallback; }
  }
  flag(name: string, fallback = false): boolean {
    try { const value = this.mpv.getFlag(name); return typeof value === "boolean" ? value : fallback; }
    catch { return fallback; }
  }
  string(name: string): string {
    try { return this.mpv.getString(name) || ""; } catch { return ""; }
  }
  sample(sequence: number, eof = false): PlaybackSample | undefined {
    const position = this.number("time-pos", NaN);
    if (!Number.isFinite(position) || position < 0) return;
    return { sequence, now: Date.now(), position,
      duration: Math.max(0, this.number("duration")), paused: this.flag("pause", true),
      seeking: this.flag("seeking"), buffering: this.flag("paused-for-cache"),
      speed: this.number("speed", 1), eof };
  }
}
