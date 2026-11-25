import { describe, expect, it } from "vitest";
import { mergeRecordMessages } from "../src/messaging/record-updates";
import { createRecord } from "../src/core/progress-engine";
import type { RecordsMessage } from "../src/messaging/message-bus";

const first = createRecord("/Course/01.mp4", 1), second = createRecord("/Course/02.mp4", 1);
function message(kind: "snapshot" | "patch", videos: typeof first[], scope = 1): RecordsMessage {
  return { kind, scope, videos, settings: { completionThreshold: 0.95 }, storage: { dirty: true, readOnly: false, recovered: false, lastSavedAt: 0 } };
}
function merge(a: RecordsMessage, b: RecordsMessage): RecordsMessage { return JSON.parse(mergeRecordMessages(JSON.stringify(a), JSON.stringify(b))); }
describe("coalesced record updates", () => {
  it("retains the initial snapshot when a time sample arrives in the same tick", () => {
    const update = { ...first, position: 50 };
    expect(merge(message("snapshot", [first, second]), message("patch", [update]))).toMatchObject({ kind: "snapshot", videos: [update, second] });
  });
  it("merges changes to different files and keeps the latest value of each", () => {
    const combined = merge(message("patch", [first]), message("patch", [second]));
    const final = merge(combined, message("patch", [{ ...first, position: 60 }]));
    expect(final.videos).toEqual([{ ...first, position: 60 }, second]);
    expect(final.kind).toBe("patch");
  });
  it("never resurrects records from an earlier folder subscription", () => {
    expect(merge(message("snapshot", [first]), message("patch", [second], 2))).toEqual(message("patch", [second], 2));
    expect(merge(message("patch", [first]), message("snapshot", [second]))).toEqual(message("snapshot", [second]));
  });
  it("storage-only updates preserve pending record changes", () => {
    const next = message("patch", []); next.storage.dirty = false; next.storage.lastSavedAt = 42;
    expect(merge(message("patch", [first]), next)).toMatchObject({ videos: [first], storage: { dirty: false, lastSavedAt: 42 } });
  });
});
