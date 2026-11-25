import { folderPath, isVideo, mediaId, normalizePath } from "./media-identity";

export interface MediaItem { id: string; path: string; playlistIndex?: number; }
export interface ListedFile { filename: string; isDir: boolean; }

export class FolderListingCache {
  private cached?: { path: string; at: number; files?: ListedFile[]; error?: unknown };
  constructor(private readonly read: (path: string) => ListedFile[], private readonly ttl = 5000) {}
  list(path: string, now: number, force = false): ListedFile[] {
    if (!force && this.cached?.path === path && now - this.cached.at < this.ttl) {
      if (this.cached.error) throw this.cached.error;
      return this.cached.files!;
    }
    try {
      const files = this.read(path);
      if (!Array.isArray(files)) throw new Error("文件夹不可访问");
      this.cached = { path, at: now, files };
      return files;
    } catch (error) {
      this.cached = { path, at: now, error };
      throw error;
    }
  }
}

export function playlistItems(entries: { filename: string }[], cwd?: string): MediaItem[] {
  const seen = new Set<string>();
  return entries.flatMap((entry, playlistIndex) => {
    const path = normalizePath(entry.filename, cwd);
    if (!path || !isVideo(path) || seen.has(path)) return [];
    seen.add(path);
    return [{ id: mediaId(path), path, playlistIndex }];
  });
}

/** The folder count includes direct sibling videos, even if IINA's playlist is partial. */
export function includeFolder(items: MediaItem[], folder: string, files: ListedFile[]): MediaItem[] {
  const byPath = new Map(items.map(item => [item.path, item]));
  for (const file of files) {
    if (file.isDir || !file.filename || file.filename.includes("/") || !isVideo(file.filename)) continue;
    const path = normalizePath(`${folder}/${file.filename}`);
    if (path && !byPath.has(path)) byPath.set(path, { id: mediaId(path), path });
  }
  return [...byPath.values()].filter(item => folderPath(item.path) === folder);
}
