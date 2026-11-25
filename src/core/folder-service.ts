import type { FolderRecord } from "../models/folder-record";
import type { VideoRecord } from "../models/video-record";
import { fileName } from "./media-identity";

export function aggregateFolder(path: string, records: VideoRecord[]): FolderRecord {
  const videos = records.filter(record => record.folderPath === path);
  const completedVideos = videos.filter(record => record.status === "completed").length;
  const watchingVideos = videos.filter(record => record.status === "watching").length;
  const latest = videos.reduce<VideoRecord | undefined>((last, record) =>
    record.lastPlayedAt > (last?.lastPlayedAt ?? 0) ? record : last, undefined);
  return { id: path, path, name: fileName(path) || "/", totalVideos: videos.length,
    completedVideos, watchingVideos, unwatchedVideos: videos.length - completedVideos - watchingVideos,
    completionRate: videos.length ? completedVideos / videos.length : 0,
    lastPlayedVideoId: latest?.id, lastPlayedAt: latest?.lastPlayedAt };
}
