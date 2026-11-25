export type WatchStatus = "unwatched" | "watching" | "completed";

export interface VideoRecord {
  id: string;
  filePath: string;
  fileName: string;
  folderPath: string;
  duration: number;
  position: number;
  maxPosition: number;
  watchedTime: number;
  progress: number;
  status: WatchStatus;
  completionSource?: "auto" | "manual";
  playCount: number;
  firstPlayedAt: number;
  lastPlayedAt: number;
  completedAt?: number;
  updatedAt: number;
}
