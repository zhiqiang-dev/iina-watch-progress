import type { VideoFilter, VideoSort } from "./video-list-model";

export interface BrowseState {
  filter: VideoFilter; search: string; sort: VideoSort;
  selectedId?: string; anchorId?: string; anchorOffset: number; scrollTop: number;
  follow: boolean; density: "comfortable" | "compact";
}
export const DEFAULT_BROWSE: BrowseState = { filter: "all", search: "", sort: "name",
  anchorOffset: 0, scrollTop: 0, follow: true, density: "comfortable" };
interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void; }
const KEY = "watch-progress:browse:v1";
function valid(value: unknown): value is BrowseState {
  if (!value || typeof value !== "object") return false;
  const state = value as BrowseState;
  return ["all", "unwatched", "watching", "completed"].includes(state.filter) &&
    ["name", "progress", "recent"].includes(state.sort) && typeof state.search === "string" && state.search.length <= 1000 &&
    [state.selectedId, state.anchorId].every(id => id === undefined || typeof id === "string") &&
    Number.isFinite(state.scrollTop) && state.scrollTop >= 0 && Number.isFinite(state.anchorOffset) && state.anchorOffset >= 0 &&
    typeof state.follow === "boolean" && ["comfortable", "compact"].includes(state.density);
}

/** Small UI-only preferences. Never enters the video-record snapshots. */
export class BrowseStateStore {
  private memory = new Map<string, BrowseState>();
  constructor(private readonly storage?: StoragePort) {}
  private read(): Map<string, BrowseState> {
    if (!this.storage) return new Map(this.memory);
    try {
      const entries: unknown = JSON.parse(this.storage?.getItem(KEY) ?? "[]");
      if (Array.isArray(entries)) return new Map(entries.filter(entry => Array.isArray(entry) &&
        typeof entry[0] === "string" && valid(entry[1])).slice(-40));
    } catch { /* Unavailable WebView storage or corrupt UI preferences must not affect playback. */ }
    return new Map(this.memory);
  }
  get(folder: string): BrowseState | undefined { const state = this.memory.get(folder) ?? this.read().get(folder); return state ? { ...state } : undefined; }
  set(folder: string, state: BrowseState): void {
    if (!folder || !valid(state)) return;
    const entries = this.read(); entries.delete(folder); entries.set(folder, { ...state });
    this.memory = new Map([...entries].slice(-40));
    try { this.storage?.setItem(KEY, JSON.stringify([...this.memory])); } catch { /* Keep a session-only fallback. */ }
  }
}

export function captureAnchor(ids: string[], scrollTop: number, rowHeight: number): Pick<BrowseState, "anchorId" | "anchorOffset" | "scrollTop"> {
  const index = Math.max(0, Math.floor(scrollTop / rowHeight));
  return { anchorId: ids[index], anchorOffset: scrollTop - index * rowHeight, scrollTop };
}
export function restoreAnchor(ids: string[], state: Pick<BrowseState, "anchorId" | "anchorOffset" | "scrollTop">, rowHeight: number): number {
  const index = state.anchorId ? ids.indexOf(state.anchorId) : -1;
  return index >= 0 ? index * rowHeight + Math.min(state.anchorOffset, rowHeight - 1) : state.scrollTop;
}
