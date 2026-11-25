import type { VideoRecord, WatchStatus } from "../models/video-record";

export type VideoFilter = "all" | WatchStatus;
export type VideoSort = "name" | "progress" | "recent";

/** Patches update counters and, when needed, reposition only the changed record. */
export class VideoListModel {
  readonly records = new Map<string, VideoRecord>();
  ids: string[] = [];
  completed = 0;
  watching = 0;
  fullSorts = 0;
  private filter: VideoFilter = "all";
  private search = "";
  private sort: VideoSort = "name";
  private continueId?: string;
  private readonly collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
  get total(): number { return this.records.size; }
  get continueRecord(): VideoRecord | undefined { return this.continueId ? this.records.get(this.continueId) : undefined; }
  replace(records: VideoRecord[]): void {
    this.records.clear();
    for (const record of records) this.records.set(record.id, record);
    this.completed = 0; this.watching = 0;
    for (const record of this.records.values()) this.count(record, 1);
    this.findContinue(); this.rebuild();
  }
  setQuery(filter: VideoFilter, search: string, sort: VideoSort): void {
    search = search.trim().toLocaleLowerCase();
    if (filter === this.filter && search === this.search && sort === this.sort) return;
    this.filter = filter; this.search = search; this.sort = sort;
    this.rebuild();
  }
  apply(changes: VideoRecord[]): void {
    for (const record of changes) {
      const old = this.records.get(record.id);
      if (!old || old === record) continue;
      const wasVisible = this.matches(old), isVisible = this.matches(record);
      this.records.set(record.id, record);
      if (old.status !== record.status) { this.count(old, -1); this.count(record, 1); }
      if (record.id === this.continueId) {
        if (record.status === "completed" || record.lastPlayedAt < old.lastPlayedAt || record.fileName !== old.fileName) this.findContinue();
      } else if (record.status !== "completed" && (!this.continueRecord || this.compareContinue(record, this.continueRecord) < 0)) this.continueId = record.id;
      const keyChanged = old.fileName !== record.fileName ||
        (this.sort === "progress" && old.progress !== record.progress) ||
        (this.sort === "recent" && old.lastPlayedAt !== record.lastPlayedAt);
      if (wasVisible === isVisible && (!isVisible || !keyChanged)) continue;
      if (wasVisible) { const index = this.ids.indexOf(record.id); if (index >= 0) this.ids.splice(index, 1); }
      if (isVisible) {
        let low = 0, high = this.ids.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          if (this.compare(this.records.get(this.ids[middle]!)!, record) <= 0) low = middle + 1;
          else high = middle;
        }
        this.ids.splice(low, 0, record.id);
      }
    }
  }
  private matches(record: VideoRecord): boolean {
    return (this.filter === "all" || record.status === this.filter) &&
      this.search.split(/\s+/).every(word => record.fileName.toLocaleLowerCase().includes(word));
  }
  private compare(a: VideoRecord, b: VideoRecord): number {
    const primary = this.sort === "progress" ? b.progress - a.progress : this.sort === "recent" ? b.lastPlayedAt - a.lastPlayedAt : 0;
    return primary || this.collator.compare(a.fileName, b.fileName) || a.id.localeCompare(b.id);
  }
  private compareContinue(a: VideoRecord, b: VideoRecord): number {
    return b.lastPlayedAt - a.lastPlayedAt || this.collator.compare(a.fileName, b.fileName) || a.id.localeCompare(b.id);
  }
  private findContinue(): void {
    let best: VideoRecord | undefined;
    for (const record of this.records.values()) if (record.status !== "completed" && (!best || this.compareContinue(record, best) < 0)) best = record;
    this.continueId = best?.id;
  }
  private count(record: VideoRecord, delta: number): void {
    if (record.status === "completed") this.completed += delta;
    if (record.status === "watching") this.watching += delta;
  }
  private rebuild(): void {
    this.fullSorts++;
    this.ids = [...this.records.values()].filter(record => this.matches(record)).sort((a, b) => this.compare(a, b)).map(record => record.id);
  }
}
