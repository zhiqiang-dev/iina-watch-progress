import { describe, expect, it } from "vitest";
import { mediaId, normalizePath } from "../src/core/media-identity";
import { includeFolder, playlistItems } from "../src/core/playlist-service";
import { aggregateFolder } from "../src/core/folder-service";
import { createRecord, markCompleted } from "../src/core/progress-engine";

describe("local media identity", () => {
  it("normalizes file URLs, relative paths and dot segments", () => {
    expect(normalizePath("file:///Videos/%E8%AF%BE%E7%A8%8B/01%20intro.mp4")).toBe("/Videos/课程/01 intro.mp4");
    expect(normalizePath("file://localhost/Videos/a.mp4")).toBe("/Videos/a.mp4");
    expect(normalizePath("./Course/../01.mp4", "/Videos")).toBe("/Videos/01.mp4");
    expect(normalizePath("/Videos//Course/./01.mp4")).toBe("/Videos/Course/01.mp4");
  });
  it("preserves literal percent, case and folder identity", () => {
    expect(normalizePath("/Videos/100% complete.mp4")).toBe("/Videos/100% complete.mp4");
    expect(normalizePath("file:///Videos/100%25%20complete.mp4")).toBe("/Videos/100% complete.mp4");
    expect(mediaId("/A/01.mp4")).not.toBe(mediaId("/B/01.mp4"));
    expect(normalizePath("/Videos/A.mp4")).not.toBe(normalizePath("/Videos/a.mp4"));
  });
  it.each(["https://example.com/a.mp4", "smb://host/a.mp4", "file://host/a.mp4", "file:///bad%ZZ.mp4", "relative.mp4", "/bad\0.mp4"])("rejects unsupported identity %s", input => {
    expect(normalizePath(input)).toBeUndefined();
  });
});

describe("playlist and folder scope", () => {
  it("deduplicates files but keeps their actual playlist index", () => {
    const list = playlistItems(["https://example.com/a.mp4", "/A/01.mp4", "/A/01.mp4", "/A/02.MKV", "/A/audio.mp3"].map(filename => ({ filename })));
    expect(list.map(item => item.playlistIndex)).toEqual([1, 3]);
  });
  it("counts direct video siblings beyond a partial playlist", () => {
    const list = playlistItems([{ filename: "/A/01.mp4" }, { filename: "/B/01.mp4" }]);
    const items = includeFolder(list, "/A", [{ filename: "01.mp4", isDir: false }, { filename: "02.mp4", isDir: false },
      { filename: "nested", isDir: true }, { filename: "notes.pdf", isDir: false }]);
    expect(items).toHaveLength(2);
    expect(items[0]?.playlistIndex).toBe(0);
    expect(items[1]?.playlistIndex).toBeUndefined();
  });
  it("aggregates exactly the current folder membership", () => {
    const first = markCompleted(createRecord("/A/01.mp4", 1), 2);
    const second = { ...createRecord("/A/02.mp4", 1), status: "watching" as const, lastPlayedAt: 5 };
    const third = createRecord("/A/03.mp4", 1);
    const stats = aggregateFolder("/A", [first, second, third, createRecord("/B/01.mp4", 1)]);
    expect(stats).toMatchObject({ totalVideos: 3, completedVideos: 1, watchingVideos: 1, unwatchedVideos: 1,
      completionRate: 1 / 3, lastPlayedVideoId: second.id });
    expect(aggregateFolder("/Empty", []).completionRate).toBe(0);
  });
});
