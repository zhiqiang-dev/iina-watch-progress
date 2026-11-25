import { describe, expect, it } from "vitest";
import { createRecord, updateProgress, markCompleted, resetRecord, type PlaybackUpdate } from "../src/core/progress-engine";

const path = "/Videos/Course/01.mp4";
function update(overrides: Partial<PlaybackUpdate> = {}): PlaybackUpdate {
  return { position: 50, duration: 100, watchedSeconds: 1, firstPlayback: false, eof: false, now: 10000, ...overrides };
}
describe("progress state machine", () => {
  it("starts unwatched and becomes watching after five real seconds", () => {
    const record = createRecord(path, 1);
    const four = updateProgress(record, update({ watchedSeconds: 4, firstPlayback: true }), 0.95);
    expect(four.status).toBe("unwatched");
    const five = updateProgress(four, update({ position: 51 }), 0.95);
    expect(five.status).toBe("watching");
    expect(five.playCount).toBe(1);
    expect(five.firstPlayedAt).toBe(10000);
    expect(record.watchedTime).toBe(0);
  });
  it("completes at the threshold and preserves completion on replay", () => {
    const done = updateProgress(createRecord(path, 1), update({ position: 95 }), 0.95);
    const replay = updateProgress(done, update({ position: 0, watchedSeconds: 0, now: 20000 }), 0.95);
    expect(done.status).toBe("completed");
    expect(done.completionSource).toBe("auto");
    expect(replay.status).toBe("completed");
    expect(replay.progress).toBe(1);
    expect(replay.position).toBe(0);
    expect(replay.completedAt).toBe(done.completedAt);
  });
  it("keeps the historical farthest progress when seeking backwards", () => {
    const half = updateProgress(createRecord(path, 1), update(), 0.95);
    const back = updateProgress(half, update({ position: 10 }), 0.95);
    expect(back.position).toBe(10);
    expect(back.maxPosition).toBe(50);
    expect(back.progress).toBe(0.5);
  });
  it("uses positional completion even for a seek to 95 percent", () => {
    const result = updateProgress(createRecord(path, 1), update({ position: 95, watchedSeconds: 0 }), 0.95);
    expect(result.status).toBe("completed");
    expect(result.watchedTime).toBe(0);
  });
  it("does not complete unknown duration or an ordinary stop", () => {
    const unknown = updateProgress(createRecord(path, 1), update({ duration: 0, position: 500 }), 0.95);
    expect(unknown.progress).toBe(0);
    expect(unknown.status).toBe("unwatched");
    expect(updateProgress(createRecord(path, 1), update({ position: 40 }), 0.95).status).not.toBe("completed");
  });
  it("completes on confirmed EOF even at a 100 percent threshold", () => {
    const result = updateProgress(createRecord(path, 1), update({ eof: true, position: 99.99 }), 1);
    expect(result.status).toBe("completed");
  });
  it("preserves manual source and resets every watch counter", () => {
    const done = markCompleted(updateProgress(createRecord(path, 1), update({ firstPlayback: true }), 0.95), 12000);
    const again = updateProgress(done, update(), 0.95);
    expect(again.completionSource).toBe("manual");
    const reset = resetRecord(again, 15000);
    expect(reset).toEqual({ ...createRecord(path, 15000), duration: 100 });
  });
  it("handles changing duration and ignores invalid numeric properties", () => {
    const initial = updateProgress(createRecord(path, 1), update({ duration: 0 }), 0.95);
    const known = updateProgress(initial, update({ duration: 80, position: 50 }), 0.95);
    expect(known.progress).toBe(0.625);
    const invalid = updateProgress(known, update({ position: NaN, duration: Infinity }), 0.95);
    expect(invalid.position).toBe(50);
    expect(invalid.duration).toBe(80);
  });
  it("does not dirty records when the playback position has not changed", () => {
    const initial = updateProgress(createRecord(path, 1), update({ watchedSeconds: 0 }), 0.95);
    expect(updateProgress(initial, update({ watchedSeconds: 0, now: 20000 }), 0.95)).toBe(initial);
  });
});
