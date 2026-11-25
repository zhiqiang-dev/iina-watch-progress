import { fileName, folderPath, mediaId } from "./media-identity";
import type { VideoRecord } from "../models/video-record";

export function createRecord(path: string, now: number): VideoRecord {
  return {
    id: mediaId(path), filePath: path, fileName: fileName(path), folderPath: folderPath(path),
    duration: 0, position: 0, maxPosition: 0, watchedTime: 0, progress: 0,
    status: "unwatched", playCount: 0, firstPlayedAt: 0, lastPlayedAt: 0, updatedAt: now,
  };
}

export interface PlaybackUpdate {
  position: number;
  duration: number;
  watchedSeconds: number;
  firstPlayback: boolean;
  eof: boolean;
  now: number;
}

export function updateProgress(record: VideoRecord, update: PlaybackUpdate, threshold: number): VideoRecord {
  const next = { ...record };
  if (Number.isFinite(update.duration) && update.duration > 0) next.duration = update.duration;
  if (Number.isFinite(update.position) && update.position >= 0) {
    next.position = next.duration > 0 ? Math.min(update.position, next.duration) : update.position;
    next.maxPosition = Math.max(next.maxPosition, next.position);
  }
  next.watchedTime += Math.max(0, update.watchedSeconds);
  if (update.watchedSeconds > 0) {
    if (update.firstPlayback) next.playCount += 1;
    if (!next.firstPlayedAt) next.firstPlayedAt = update.now;
    next.lastPlayedAt = update.now;
  }
  next.progress = next.duration > 0 ? Math.min(1, next.maxPosition / next.duration) : 0;
  if (next.status !== "completed") {
    if (update.eof || (next.duration > 0 && next.progress >= threshold)) {
      next.status = "completed";
      next.completionSource = "auto";
      next.completedAt = update.now;
    } else if (next.watchedTime >= 5) next.status = "watching";
  }
  // Completed is sticky, including when an unknown duration later becomes known.
  if (next.status === "completed") next.progress = 1;
  const changed = (Object.keys(next) as (keyof VideoRecord)[]).some(key => next[key] !== record[key]);
  if (!changed) return record;
  next.updatedAt = update.now;
  return next;
}

export function markCompleted(record: VideoRecord, now: number): VideoRecord {
  return { ...record, status: "completed", progress: 1, completionSource: "manual", completedAt: now, updatedAt: now };
}

export function resetRecord(record: VideoRecord, now: number): VideoRecord {
  return { ...createRecord(record.filePath, now), duration: record.duration };
}
