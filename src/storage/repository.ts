import type { VideoRecord } from "../models/video-record";
import { createRecord, markCompleted, resetRecord } from "../core/progress-engine";
import type { JsonStorage } from "./json-storage";
import type { RecordsPayload } from "./migration";
import { mediaId } from "../core/media-identity";
import { DEFAULT_SAVE_INTERVAL, validSaveInterval, validThreshold } from "../models/settings";

export class Repository {
  readonly data: RecordsPayload;
  constructor(readonly storage: JsonStorage) { this.data = storage.load(); }

  ensure(path: string, now: number): VideoRecord {
    const id = mediaId(path);
    if (!Object.prototype.hasOwnProperty.call(this.data.videos, id)) {
      this.data.videos[id] = createRecord(path, now);
      this.storage.state.dirty = true;
    }
    return this.data.videos[id]!;
  }
  put(record: VideoRecord): void {
    if (this.data.videos[record.id] === record) return;
    this.data.videos[record.id] = record;
    this.storage.state.dirty = true;
  }
  mark(id: string, completed: boolean, now: number): boolean {
    const record = this.data.videos[id];
    if (!record || this.storage.state.readOnly) return false;
    if (completed && record.status === "completed") return false;
    this.put(completed ? markCompleted(record, now) : resetRecord(record, now));
    return true;
  }
  setThreshold(threshold: unknown): boolean {
    if (!validThreshold(threshold) || this.storage.state.readOnly) return false;
    if (this.data.settings.completionThreshold === threshold) return false;
    this.data.settings.completionThreshold = threshold;
    this.storage.state.dirty = true;
    return true;
  }
  setSaveInterval(seconds: unknown): boolean {
    if (!validSaveInterval(seconds) || this.storage.state.readOnly) return false;
    if ((this.data.settings.saveIntervalSeconds ?? DEFAULT_SAVE_INTERVAL) === seconds) return false;
    this.data.settings.saveIntervalSeconds = seconds;
    this.storage.state.dirty = true;
    return true;
  }
  flush(now: number): boolean { return this.storage.save(this.data, now); }
}
