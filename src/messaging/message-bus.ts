import type { MediaItem } from "../core/playlist-service";
import type { PlaybackSample } from "../core/playback-tracker";
import type { VideoRecord } from "../models/video-record";
import type { Settings } from "../models/settings";
import type { StorageState } from "../storage/json-storage";

export interface SyncMessage { paths: string[]; scope?: number; }
export interface BeginMessage { sessionId: string; path: string; }
export interface SampleMessage { sessionId: string; sample: PlaybackSample; flush?: boolean; }
export interface RecordsMessage {
  kind?: "snapshot" | "patch";
  scope?: number;
  videos: VideoRecord[];
  settings: Settings;
  storage: StorageState;
}
export interface FolderOption { path: string; name: string; }
export interface MediaInfo { id: string; width: number; height: number; codec: string; }
export interface ViewSnapshot extends RecordsMessage {
  kind?: "snapshot";
  items: MediaItem[];
  folders: FolderOption[];
  selectedFolder?: string;
  activeId?: string;
  paused?: boolean;
  media?: MediaInfo;
  scanError?: string;
}
export interface ViewPatch extends RecordsMessage {
  kind: "patch";
  activeId: string | null;
  paused: boolean;
  media?: MediaInfo;
  scanError: string | null;
}
export type ViewState = ViewSnapshot | ViewPatch;
export type UIAction =
  | { type: "play" | "continue" | "complete" | "reset" | "toggle-playback"; id: string }
  | { type: "refresh" | "detach" | "reveal-data" | "locate-current" }
  | { type: "folder"; path: string }
  | { type: "threshold" | "save-interval"; value: number }
  | { type: "seek"; id: string; position: number }
  | { type: "reveal-file"; id: string }
  | { type: "visibility"; visible: boolean };

export const MSG = {
  sync: "wp:sync", begin: "wp:begin", sample: "wp:sample", end: "wp:end",
  mark: "wp:mark", settings: "wp:settings", records: "wp:records", reset: "wp:reset",
  ready: "wp:ready", view: "wp:view", action: "wp:action", disconnect: "wp:disconnect",
} as const;
