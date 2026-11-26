import { describe, expect, it } from "vitest";
import { createRecord } from "../src/core/progress-engine";
import { adjacentUnfinished, numberedVideos } from "../src/ui/list-navigation";

describe("quick video location", () => {
  const records = ["001 开始", "058 课程", "100 总结"].map(name => createRecord(`/A/${name}.mp4`, 1));
  records[1]!.status = "completed";
  const byId = new Map(records.map(record => [record.id, record])), ids = records.map(record => record.id);
  it("skips completed items in the visible order without wrapping or playing", () => {
    expect(adjacentUnfinished(ids, byId, 0, 1)).toBe(ids[2]);
    expect(adjacentUnfinished(ids, byId, 2, -1)).toBe(ids[0]);
    expect(adjacentUnfinished(ids, byId, 2, 1)).toBeUndefined();
    expect(adjacentUnfinished([...ids].reverse(), byId, 0, 1)).toBe(ids[0]);
    expect(adjacentUnfinished([ids[1]!], byId, -1, 1)).toBeUndefined();
    expect(adjacentUnfinished(ids, byId, -1, -1)).toBe(ids[2]);
  });
  it("matches filename numbers independently of the filter/order and reports duplicates", () => {
    expect(numberedVideos(records, "５８")).toEqual([ids[1]]);
    expect(numberedVideos(records, "0001")).toEqual([ids[0]]);
    expect(numberedVideos(records, "2")).toEqual([]);
    expect(numberedVideos(records, "58 课程")).toEqual([]);
    expect(numberedVideos(records, "9007199254740992")).toEqual([]);
    expect(numberedVideos([...records, createRecord("/A/58 其他.mp4", 1)], "58")).toHaveLength(2);
  });
});
