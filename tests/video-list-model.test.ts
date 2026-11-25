import { describe, expect, it } from "vitest";
import { VideoListModel, type VideoFilter, type VideoSort } from "../src/ui/video-list-model";
import { createRecord } from "../src/core/progress-engine";
import type { VideoRecord } from "../src/models/video-record";

function fixture(count = 100): VideoRecord[] {
  return Array.from({ length: count }, (_, index) => ({ ...createRecord(`/Course/视频 ${index + 1}.mp4`, 1),
    duration: 100, position: index % 100, progress: (index % 100) / 100,
    status: index % 3 === 0 ? "completed" : index % 3 === 1 ? "watching" : "unwatched", lastPlayedAt: index }));
}
const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
function reference(records: VideoRecord[], filter: VideoFilter, search: string, sort: VideoSort): string[] {
  return records.filter(record => (filter === "all" || record.status === filter) && record.fileName.toLocaleLowerCase().includes(search))
    .sort((a, b) => (sort === "progress" ? b.progress - a.progress : sort === "recent" ? b.lastPlayedAt - a.lastPlayedAt : 0) ||
      collator.compare(a.fileName, b.fileName) || a.id.localeCompare(b.id)).map(record => record.id);
}
describe("incremental video list", () => {
  it("does not fully sort the folder on normal progress samples", () => {
    const model = new VideoListModel(); model.replace(fixture(1000));
    const ids = [...model.ids], sorts = model.fullSorts;
    for (let tick = 1; tick <= 100; tick++) {
      const record = model.records.get(ids[5]!)!;
      model.apply([{ ...record, position: tick, progress: tick / 100, lastPlayedAt: 1000 + tick }]);
    }
    expect(model.ids).toEqual(ids);
    expect(model.fullSorts).toBe(sorts);
  });
  it.each(["name", "progress", "recent"] as VideoSort[])("matches a full recompute for %s order, filters and resets", sort => {
    for (const filter of ["all", "completed", "watching", "unwatched"] as VideoFilter[]) {
      const model = new VideoListModel(); const records = fixture(75);
      model.replace(records); model.setQuery(filter, "视频", sort);
      for (let tick = 0; tick < 120; tick++) {
        const index = (tick * 37) % records.length, old = records[index]!;
        records[index] = { ...old, progress: (tick % 100) / 100,
          lastPlayedAt: tick % 5 === 0 ? 0 : 1000 + tick,
          status: tick % 4 === 0 ? "completed" : tick % 4 === 1 ? "watching" : "unwatched" };
        model.apply([records[index]!]);
        expect(model.ids).toEqual(reference(records, filter, "视频", sort));
        expect(model.completed).toBe(records.filter(record => record.status === "completed").length);
        expect(model.watching).toBe(records.filter(record => record.status === "watching").length);
        const candidate = records.filter(record => record.status !== "completed").sort((a, b) =>
          b.lastPlayedAt - a.lastPlayedAt || collator.compare(a.fileName, b.fileName) || a.id.localeCompare(b.id))[0];
        expect(model.continueRecord?.id).toBe(candidate?.id);
      }
    }
  });
  it("ignores out-of-scope records and supports searching after a rename", () => {
    const model = new VideoListModel(); const records = fixture(3); model.replace(records);
    model.setQuery("all", "不存在", "name"); expect(model.ids).toEqual([]);
    const renamed = { ...records[0]!, fileName: "不存在.mp4" }; model.apply([renamed, createRecord("/Other/a.mp4", 1)]);
    expect(model.ids).toEqual([renamed.id]); expect(model.total).toBe(3);
  });
});
