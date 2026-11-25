import { decodeSnapshot, emptyPayload, encodeSnapshot, FutureSchemaError, type RecordsPayload, type Snapshot } from "./migration";

export interface FilePort {
  exists(path: string): boolean;
  read(path: string): string;
  write(path: string, content: string): void;
}
export interface StorageState {
  readOnly: boolean;
  dirty: boolean;
  recovered: boolean;
  lastSavedAt: number;
  error?: string;
}
export const SNAPSHOT_PATHS = ["@data/records.json", "@data/records.backup.json"] as const;

/** Only the global entry owns this object. Preserve one verified slot on every write. */
export class JsonStorage {
  readonly state: StorageState = { readOnly: false, dirty: false, recovered: false, lastSavedAt: 0 };
  private revision = 0;
  private activeSlot = -1;

  constructor(private readonly file: FilePort) {}

  load(): RecordsPayload {
    const snapshots: { slot: number; snapshot: Snapshot }[] = [];
    let damaged = 0;
    let future = false;
    for (const [slot, path] of SNAPSHOT_PATHS.entries()) {
      try {
        if (!this.file.exists(path)) continue;
        snapshots.push({ slot, snapshot: decodeSnapshot(this.file.read(path)) });
      } catch (error) {
        damaged++;
        if (error instanceof FutureSchemaError) future = true;
      }
    }
    const newest = snapshots.sort((a, b) => b.snapshot.revision - a.snapshot.revision)[0];
    if (newest) {
      this.revision = newest.snapshot.revision;
      this.activeSlot = newest.slot;
      this.state.lastSavedAt = newest.snapshot.savedAt;
      this.state.recovered = damaged > 0;
    }
    if (future || (!newest && damaged > 0)) {
      this.state.readOnly = true;
      this.state.error = future ? "记录来自更新版本，已停止写入。请升级插件。" :
        "记录快照均无法读取，已保留原文件并停止写入。请先备份数据再修复。";
    }
    return newest?.snapshot.payload ?? emptyPayload();
  }

  save(payload: RecordsPayload, now: number): boolean {
    if (this.state.readOnly || !this.state.dirty) return false;
    const nextSlot = this.activeSlot === 0 ? 1 : 0;
    const path = SNAPSHOT_PATHS[nextSlot]!;
    try {
      const text = encodeSnapshot(payload, this.revision + 1, now);
      this.file.write(path, text);
      // The in-memory payload is already typed/validated. Exact read-back comparison
      // detects partial or silent writes without parsing and validating every record twice.
      if (this.file.read(path) !== text) {
        throw new Error("写入后校验失败");
      }
      this.activeSlot = nextSlot;
      this.revision += 1;
      this.state.lastSavedAt = now;
      this.state.dirty = false;
      this.state.error = undefined;
      return true;
    } catch (error) {
      this.state.error = `观看记录保存失败，将自动重试：${String(error)}`;
      return false;
    }
  }
}
