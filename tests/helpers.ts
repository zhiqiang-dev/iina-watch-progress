import { JsonStorage, type FilePort } from "../src/storage/json-storage";
import { Repository } from "../src/storage/repository";
import type { PlaybackSample } from "../src/core/playback-tracker";

export class MemoryFiles implements FilePort {
  files = new Map<string, string>();
  writes = 0;
  failWrite = false;
  truncateWrite = false;
  exists(path: string): boolean { return this.files.has(path); }
  read(path: string): string {
    const text = this.files.get(path);
    if (text === undefined) throw new Error("Missing file");
    return text;
  }
  write(path: string, content: string): void {
    this.writes++;
    if (this.failWrite) throw new Error("Disk full");
    this.files.set(path, this.truncateWrite ? content.slice(0, content.length / 2) : content);
  }
}
export function repository(file = new MemoryFiles()): Repository { return new Repository(new JsonStorage(file)); }
export function sample(position: number, now = position * 1000 + 1000, overrides: Partial<PlaybackSample> = {}): PlaybackSample {
  return { position, duration: 100, now, sequence: now, paused: false, seeking: false,
    buffering: false, speed: 1, eof: false, ...overrides };
}
