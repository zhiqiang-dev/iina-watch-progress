export interface FolderRecord {
  id: string;
  path: string;
  name: string;
  totalVideos: number;
  completedVideos: number;
  watchingVideos: number;
  unwatchedVideos: number;
  completionRate: number;
  lastPlayedVideoId?: string;
  lastPlayedAt?: number;
}
