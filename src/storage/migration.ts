import { DEFAULT_SETTINGS, validThreshold, type Settings } from "../models/settings";
import type { VideoRecord } from "../models/video-record";
import { fileName, folderPath, mediaId, normalizePath } from "../core/media-identity";

export const SCHEMA_VERSION = 1;
export interface RecordsPayload { videos: Record<string, VideoRecord>; settings: Settings; }
export interface Snapshot {
  schemaVersion: 1;
  revision: number;
  savedAt: number;
  payload: RecordsPayload;
  checksum: string;
}

export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function nonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function validateRecord(value: unknown, id: string): value is VideoRecord {
  if (!object(value) || typeof value.filePath !== "string") return false;
  const path = normalizePath(value.filePath);
  if (!path || path !== value.filePath || value.id !== id || mediaId(path) !== id ||
      value.fileName !== fileName(path) || value.folderPath !== folderPath(path)) return false;
  for (const key of ["duration", "position", "maxPosition", "watchedTime", "progress", "playCount",
    "firstPlayedAt", "lastPlayedAt", "updatedAt"] as const) {
    if (!nonnegative(value[key])) return false;
  }
  return (value.progress as number) <= 1 && Number.isSafeInteger(value.playCount) &&
    ["unwatched", "watching", "completed"].includes(value.status as string) &&
    (value.completionSource === undefined || ["auto", "manual"].includes(value.completionSource as string)) &&
    (value.completedAt === undefined || nonnegative(value.completedAt));
}

/** FNV-1a is a corruption check, not a security hash or a media fingerprint. */
export function checksum(content: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function encodeSnapshot(payload: RecordsPayload, revision: number, savedAt: number): string {
  const body = { schemaVersion: SCHEMA_VERSION, revision, savedAt, payload };
  const text = JSON.stringify(body);
  return `${text.slice(0, -1)},"checksum":"${checksum(text)}"}`;
}

export function decodeSnapshot(text: string): Snapshot {
  const value: unknown = JSON.parse(text);
  if (!object(value)) throw new Error("快照格式无效");
  if (typeof value.schemaVersion === "number" && value.schemaVersion > SCHEMA_VERSION) {
    throw new FutureSchemaError("记录来自更新版本的插件，已停止写入，请升级插件。");
  }
  if (value.schemaVersion !== SCHEMA_VERSION || !Number.isSafeInteger(value.revision) ||
      !nonnegative(value.revision) || !nonnegative(value.savedAt) || !object(value.payload) ||
      !object(value.payload.videos) || !object(value.payload.settings) ||
      !validThreshold(value.payload.settings.completionThreshold)) throw new Error("快照字段无效");
  const body = { schemaVersion: value.schemaVersion, revision: value.revision, savedAt: value.savedAt, payload: value.payload };
  if (value.checksum !== checksum(JSON.stringify(body))) throw new Error("快照校验失败");
  for (const [id, record] of Object.entries(value.payload.videos)) {
    if (!validateRecord(record, id)) throw new Error("视频记录字段无效");
  }
  return value as unknown as Snapshot;
}

export class FutureSchemaError extends Error {}
export function emptyPayload(): RecordsPayload { return { videos: {}, settings: { ...DEFAULT_SETTINGS } }; }
