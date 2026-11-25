import { describe, expect, it } from "vitest";
import { JsonStorage, SNAPSHOT_PATHS } from "../src/storage/json-storage";
import { Repository } from "../src/storage/repository";
import { checksum, decodeSnapshot, emptyPayload, encodeSnapshot } from "../src/storage/migration";
import { MemoryFiles, repository } from "./helpers";

describe("verified alternating snapshots", () => {
  it("loads legacy settings without changing the stored file and persists a chosen save interval", () => {
    const files = new MemoryFiles(), payload = emptyPayload();
    delete payload.settings.saveIntervalSeconds;
    files.files.set(SNAPSHOT_PATHS[0], encodeSnapshot(payload, 1, 1));
    const repo = repository(files);
    expect(repo.storage.state.readOnly).toBe(false);
    expect(repo.setSaveInterval(5)).toBe(false);
    expect(repo.flush(2)).toBe(false); expect(files.writes).toBe(0);
    expect(repo.setSaveInterval(30)).toBe(true); repo.flush(3);
    expect(repository(files).data.settings.saveIntervalSeconds).toBe(30);
    expect(repo.setSaveInterval(1)).toBe(false);
    expect(repo.setSaveInterval(0)).toBe(false);
    expect(repo.setSaveInterval(Infinity)).toBe(false);
    expect(repo.setSaveInterval("15")).toBe(false);
    expect(repo.flush(4)).toBe(false); expect(files.writes).toBe(1);
  });
  it("rejects invalid saved intervals and protects read-only snapshots from setting changes", () => {
    const files = new MemoryFiles(), payload = emptyPayload();
    payload.settings.saveIntervalSeconds = 1;
    const invalid = encodeSnapshot(payload, 1, 1);
    expect(() => decodeSnapshot(invalid)).toThrow("字段无效");
    files.files.set(SNAPSHOT_PATHS[0], invalid);
    const repo = repository(files);
    expect(repo.setSaveInterval(30)).toBe(false); expect(repo.flush(2)).toBe(false);
    expect(files.writes).toBe(0);
  });
  it("avoids dirty writes when selecting the existing threshold or completing a completed file", () => {
    const files = new MemoryFiles(), repo = repository(files);
    const record = repo.ensure("/Course/01.mp4", 1); repo.mark(record.id, true, 2); repo.flush(3);
    expect(repo.setThreshold(0.95)).toBe(false); expect(repo.mark(record.id, true, 4)).toBe(false);
    expect(repo.flush(5)).toBe(false); expect(files.writes).toBe(1);
  });
  it("keeps the on-disk schema and checksum exactly compatible with 0.1.1", () => {
    const payload = emptyPayload(), body = { schemaVersion: 1, revision: 12, savedAt: 34, payload };
    const legacy = JSON.stringify({ ...body, checksum: checksum(JSON.stringify(body)) });
    expect(encodeSnapshot(payload, 12, 34)).toBe(legacy);
    expect(decodeSnapshot(encodeSnapshot(payload, 12, 34)).payload).toEqual(payload);
  });
  it("does not write unchanged state and restores progress after restart", () => {
    const files = new MemoryFiles();
    const repo = repository(files);
    expect(repo.flush(100)).toBe(false);
    const record = repo.ensure("/Course/01.mp4", 1);
    repo.put({ ...record, position: 50, maxPosition: 50, progress: 0.5, duration: 100, status: "watching" });
    expect(repo.flush(1000)).toBe(true);
    expect(repo.flush(2000)).toBe(false);
    expect(files.writes).toBe(1);
    expect(repository(files).data.videos[record.id]?.position).toBe(50);
  });
  it("selects the newest valid revision regardless of slot or clock", () => {
    const files = new MemoryFiles();
    const repo = repository(files);
    const record = repo.ensure("/Course/01.mp4", 1);
    repo.flush(5000);
    repo.mark(record.id, true, 6000);
    repo.flush(4000);
    const restored = repository(files);
    expect(restored.data.videos[record.id]?.status).toBe("completed");
    expect(restored.storage.state.lastSavedAt).toBe(4000);
  });
  it("recovers after an interrupted write and preserves the last valid slot", () => {
    const files = new MemoryFiles();
    const repo = repository(files);
    repo.ensure("/Course/01.mp4", 1);
    repo.flush(1000);
    const verified = files.read(SNAPSHOT_PATHS[0]);
    repo.ensure("/Course/02.mp4", 2);
    files.truncateWrite = true;
    expect(repo.flush(2000)).toBe(false);
    expect(repo.storage.state.dirty).toBe(true);
    expect(files.read(SNAPSHOT_PATHS[0])).toBe(verified);
    const restored = repository(files);
    expect(Object.keys(restored.data.videos)).toHaveLength(1);
    expect(restored.storage.state.recovered).toBe(true);
    files.truncateWrite = false;
    expect(repo.flush(3000)).toBe(true);
    expect(Object.keys(repository(files).data.videos)).toHaveLength(2);
  });
  it("retains dirty state on disk failure and retries", () => {
    const files = new MemoryFiles();
    const repo = repository(files);
    repo.ensure("/Course/01.mp4", 1);
    files.failWrite = true;
    expect(repo.flush(100)).toBe(false);
    expect(repo.storage.state.error).toContain("保存失败");
    files.failWrite = false;
    expect(repo.flush(200)).toBe(true);
    expect(repo.storage.state.error).toBeUndefined();
  });
  it("never overwrites both unreadable snapshots", () => {
    const files = new MemoryFiles();
    files.files.set(SNAPSHOT_PATHS[0], "bad");
    files.files.set(SNAPSHOT_PATHS[1], "{}");
    const repo = repository(files);
    repo.ensure("/Course/01.mp4", 1);
    expect(repo.storage.state.readOnly).toBe(true);
    expect(repo.flush(100)).toBe(false);
    expect(files.writes).toBe(0);
  });
  it("protects future schema even when an older valid backup exists", () => {
    const files = new MemoryFiles();
    files.files.set(SNAPSHOT_PATHS[0], encodeSnapshot(emptyPayload(), 1, 1));
    files.files.set(SNAPSHOT_PATHS[1], JSON.stringify({ schemaVersion: 2 }));
    const repo = repository(files);
    repo.ensure("/Course/01.mp4", 1);
    expect(repo.storage.state.readOnly).toBe(true);
    expect(repo.flush(100)).toBe(false);
  });
  it("detects tampering and semantically invalid records even with a correct checksum", () => {
    const payload = emptyPayload();
    const repo = new Repository(new JsonStorage(new MemoryFiles()));
    const record = repo.ensure("/Course/01.mp4", 1);
    payload.videos[record.id] = { ...record, position: -1 };
    expect(() => decodeSnapshot(encodeSnapshot(payload, 1, 1))).toThrow("字段无效");
    const body = { schemaVersion: 1, revision: 1, savedAt: 1, payload: emptyPayload() };
    const text = JSON.stringify({ ...body, checksum: checksum(JSON.stringify(body)) });
    expect(() => decodeSnapshot(text.replace('"savedAt":1', '"savedAt":2'))).toThrow("校验失败");
  });
  it("persists reset and settings together", () => {
    const files = new MemoryFiles();
    const repo = repository(files);
    const record = repo.ensure("/Course/01.mp4", 1);
    repo.mark(record.id, true, 2);
    repo.flush(3);
    repo.mark(record.id, false, 4);
    repo.setThreshold(0.8);
    repo.flush(5);
    const restored = repository(files);
    expect(restored.data.videos[record.id]?.status).toBe("unwatched");
    expect(restored.data.settings.completionThreshold).toBe(0.8);
    expect(restored.setThreshold(0.7)).toBe(false);
  });
});
