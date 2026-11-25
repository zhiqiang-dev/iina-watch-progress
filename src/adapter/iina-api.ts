import type { FilePort } from "../storage/json-storage";
import type { PlaybackSample } from "../core/playback-tracker";
import { object, nonnegative } from "../storage/migration";

export function filePort(file: IINA.API.File): FilePort {
  return { exists: path => file.exists(path), read: path => {
    const value = file.read(path);
    if (typeof value !== "string") throw new Error(`无法读取 ${path}`);
    return value;
  }, write: (path, content) => file.write(path, content) };
}

export function validSample(value: unknown): value is PlaybackSample {
  if (!object(value)) return false;
  return ["sequence", "now", "position", "duration", "speed"].every(key => nonnegative(value[key])) &&
    Number.isSafeInteger(value.sequence) &&
    ["paused", "seeking", "buffering", "eof"].every(key => typeof value[key] === "boolean");
}
