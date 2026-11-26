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
  orderRevision = 0;
  navigationRevision = 0;
  moves = 0;
  private orderedIds?: string[];
  private positions = new Map<string, number>();
  private names = new Map<string, { source: string; normalized: string }>();
  private words: string[] = [];
  private filter: VideoFilter = "all";
  private search = "";
  private sort: VideoSort = "name";
  private continueId?: string;
  private readonly collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
  get total(): number { return this.records.size; }
  indexOf(id?: string): number { return id ? this.positions.get(id) ?? -1 : -1; }
  get continueRecord(): VideoRecord | undefined { return this.continueId ? this.records.get(this.continueId) : undefined; }
  replace(records: VideoRecord[]): void {
    this.orderedIds = undefined;
    this.records.clear();
    this.names.clear();
    for (const record of records) this.records.set(record.id, record);
    this.completed = 0; this.watching = 0;
    for (const record of this.records.values()) this.count(record, 1);
    this.findContinue(); this.rebuild();
  }
  setQuery(filter: VideoFilter, search: string, sort: VideoSort): void {
    search = search.normalize("NFKC").trim().toLocaleLowerCase();
    if (filter === this.filter && search === this.search && sort === this.sort) return;
    if (sort !== this.sort) this.orderedIds = undefined;
    this.filter = filter; this.search = search; this.sort = sort;
    this.words = search ? search.split(/\s+/) : [];
    this.rebuild();
  }
  apply(changes: VideoRecord[]): void {
    for (const record of changes) {
      const old = this.records.get(record.id);
      if (!old || old === record) continue;
      const wasVisible = this.matches(old), isVisible = this.matches(record);
      this.records.set(record.id, record);
      if (old.status !== record.status) { this.count(old, -1); this.count(record, 1); this.navigationRevision++; }
      if (record.id === this.continueId) {
        if (record.status === "completed" || record.lastPlayedAt < old.lastPlayedAt || record.fileName !== old.fileName) this.findContinue();
      } else if (record.status !== "completed" && (!this.continueRecord || this.compareContinue(record, this.continueRecord) < 0)) this.continueId = record.id;
      const keyChanged = old.fileName !== record.fileName ||
        (this.sort === "progress" && old.progress !== record.progress) ||
        (this.sort === "recent" && old.lastPlayedAt !== record.lastPlayedAt);
      if (keyChanged) this.orderedIds = undefined;
      if (wasVisible === isVisible && (!isVisible || !keyChanged)) continue;
      const previousIndex = this.indexOf(record.id);
      if (wasVisible && isVisible &&
          (previousIndex === 0 || this.compare(this.records.get(this.ids[previousIndex - 1]!)!, record) <= 0) &&
          (previousIndex === this.ids.length - 1 || this.compare(record, this.records.get(this.ids[previousIndex + 1]!)!) <= 0)) continue;
      if (wasVisible && previousIndex >= 0) { this.ids.splice(previousIndex, 1); this.positions.delete(record.id); }
      let insertedIndex = this.ids.length;
      if (isVisible) {
        let low = 0, high = this.ids.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          if (this.compare(this.records.get(this.ids[middle]!)!, record) <= 0) low = middle + 1;
          else high = middle;
        }
        insertedIndex = low; this.ids.splice(low, 0, record.id);
      }
      const from = previousIndex < 0 ? insertedIndex : Math.min(previousIndex, insertedIndex);
      for (let index = from; index < this.ids.length; index++) this.positions.set(this.ids[index]!, index);
      this.orderRevision++; this.navigationRevision++; this.moves++;
    }
  }
  private matches(record: VideoRecord): boolean {
    if (this.filter !== "all" && record.status !== this.filter) return false;
    if (!this.words.length) return true;
    let cached = this.names.get(record.id);
    if (cached?.source !== record.fileName) {
      cached = { source: record.fileName, normalized: record.fileName.normalize("NFKC").toLocaleLowerCase() }; this.names.set(record.id, cached);
    }
    return this.words.every(word => cached!.normalized.includes(word));
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
    if (!this.orderedIds) {
      this.fullSorts++;
      this.orderedIds = [...this.records.values()].sort((a, b) => this.compare(a, b)).map(record => record.id);
    }
    this.ids = this.orderedIds.filter(id => this.matches(this.records.get(id)!));
    this.positions.clear(); this.ids.forEach((id, index) => this.positions.set(id, index)); this.orderRevision++; this.navigationRevision++;
  }
}
