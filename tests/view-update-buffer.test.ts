import { describe, expect, it } from "vitest";
import { ViewUpdateBuffer } from "../src/ui/view-update-buffer";
import { createRecord } from "../src/core/progress-engine";
import type { ViewPatch, ViewSnapshot } from "../src/messaging/message-bus";
const record = createRecord("/Course/01.mp4", 1);
const snapshot: ViewSnapshot = { kind: "snapshot", scope: 1, items: [], folders: [], videos: [record], settings: { completionThreshold: 0.95 },
  storage: { readOnly: false, dirty: false, recovered: false, lastSavedAt: 0 } };
function patch(position: number, scope = 1): ViewPatch {
  return { ...snapshot, kind: "patch", scope, activeId: record.id, paused: false, scanError: null, videos: [{ ...record, position }] };
}
describe("hidden view updates", () => {
  it("coalesces many ticks into the latest per-file update and preserves the initial snapshot", () => {
    const buffer = new ViewUpdateBuffer(); buffer.push(snapshot);
    for (let tick = 0; tick < 1000; tick++) buffer.push(patch(tick));
    buffer.push({ ...patch(999), videos: [], paused: true });
    const updates = buffer.drain(); expect(updates).toHaveLength(2);
    expect(updates[0]).toBe(snapshot); expect(updates[1]?.videos).toHaveLength(1);
    expect(updates[1]?.videos[0]?.position).toBe(999); expect(updates[1]).toMatchObject({ paused: true });
    expect(buffer.drain()).toEqual([]);
  });
  it("rejects stale folder patches and drops old pending changes after a new snapshot", () => {
    const buffer = new ViewUpdateBuffer(); buffer.push(snapshot); buffer.push(patch(20));
    buffer.push({ ...snapshot, scope: 2 }); buffer.push(patch(99)); buffer.push(patch(2, 2));
    const updates = buffer.drain(); expect(updates).toHaveLength(2); expect(updates[1]?.videos[0]?.position).toBe(2);
  });
});
