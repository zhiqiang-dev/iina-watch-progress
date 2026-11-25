import type { PlaybackSample } from "../core/playback-tracker";

export class MpvAdapter {
  private playback = { duration: 0, paused: true, seeking: false, buffering: false, speed: 1 };
  constructor(private readonly mpv: IINA.API.MPV) {}
  get paused(): boolean { return this.playback.paused; }
  resetPlayback(): void { this.playback = { duration: 0, paused: true, seeking: false, buffering: false, speed: 1 }; }
  refreshPlayback(property?: string): void {
    if (!property || property === "duration") this.playback.duration = Math.max(0, this.number("duration"));
    if (!property || property === "pause") this.playback.paused = this.flag("pause", true);
    if (!property || property === "seeking") this.playback.seeking = this.flag("seeking");
    if (!property || property === "paused-for-cache") this.playback.buffering = this.flag("paused-for-cache");
    if (!property || property === "speed") this.playback.speed = this.number("speed", 1);
  }
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
    return { sequence, now: Date.now(), position, ...this.playback, eof };
  }
}
