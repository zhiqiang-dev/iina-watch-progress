import { describe, expect, it, vi } from "vitest";
import { Coordinator } from "../src/core/coordinator";
import { mediaId } from "../src/core/media-identity";
import { MemoryFiles, repository, sample } from "./helpers";

describe("multi-window coordinator", () => {
  it("uses a full snapshot only for subscription and constant-size patches for playback", () => {
    const repo = repository(); const post = vi.fn(); const coordinator = new Coordinator(repo, post, vi.fn());
    const paths = Array.from({ length: 1000 }, (_, index) => `/Course/${index}.mp4`);
    coordinator.sync("one", paths, 1, 7);
    expect(post.mock.calls.at(-1)?.[1]).toMatchObject({ kind: "snapshot", scope: 7 });
    expect(post.mock.calls.at(-1)?.[1].videos).toHaveLength(1000);
    coordinator.begin("one", "s1", paths[0]!, 1); coordinator.sample("one", "s1", sample(50), false);
    expect(post.mock.calls.at(-1)?.[1]).toMatchObject({ kind: "patch", scope: 7 });
    expect(post.mock.calls.at(-1)?.[1].videos).toHaveLength(1);
    coordinator.publishAll(); expect(post.mock.calls.at(-1)?.[1].videos).toHaveLength(0);
  });
  it("merges updates from different windows without overwriting either file", () => {
    const files = new MemoryFiles();
    const repo = repository(files);
    const post = vi.fn();
    const coordinator = new Coordinator(repo, post, vi.fn());
    coordinator.sync("one", ["/A/01.mp4"], 1);
    coordinator.sync("two", ["/B/01.mp4"], 1);
    coordinator.begin("one", "s1", "/A/01.mp4", 1);
    coordinator.begin("two", "s2", "/B/01.mp4", 1);
    coordinator.sample("one", "s1", sample(30), true);
    coordinator.sample("two", "s2", sample(60), true);
    const restored = repository(files);
    expect(restored.data.videos[mediaId("/A/01.mp4")]?.position).toBe(30);
    expect(restored.data.videos[mediaId("/B/01.mp4")]?.position).toBe(60);
    expect(post.mock.calls.at(-1)?.[0]).toBe("two");
  });
  it("keeps completion sticky across windows replaying the same file", () => {
    const repo = repository();
    const coordinator = new Coordinator(repo, vi.fn(), vi.fn());
    for (const player of ["one", "two"]) {
      coordinator.sync(player, ["/A/01.mp4"], 1);
      coordinator.begin(player, player, "/A/01.mp4", 1);
    }
    coordinator.sample("one", "one", sample(96), true);
    coordinator.sample("two", "two", sample(1), true);
    expect(repo.data.videos[mediaId("/A/01.mp4")]?.status).toBe("completed");
  });
  it("rejects stale sessions and duplicated begin does not reset tracking", () => {
    const repo = repository();
    const coordinator = new Coordinator(repo, vi.fn(), vi.fn());
    coordinator.begin("one", "s1", "/A/01.mp4", 1);
    coordinator.sample("one", "s1", sample(0), false);
    coordinator.begin("one", "s1", "/A/01.mp4", 1);
    coordinator.sample("one", "s1", sample(1), false);
    expect(repo.data.videos[mediaId("/A/01.mp4")]?.watchedTime).toBe(1);
    coordinator.begin("one", "s2", "/A/02.mp4", 2);
    coordinator.sample("one", "s1", sample(99), true);
    coordinator.end("one", "s1", 3);
    coordinator.sample("one", "s2", sample(20), true);
    expect(repo.data.videos[mediaId("/A/02.mp4")]?.position).toBe(20);
  });
  it("suspends every active window on reset until a paused zero acknowledgement", () => {
    const repo = repository();
    const reset = vi.fn();
    const coordinator = new Coordinator(repo, vi.fn(), reset);
    const path = "/A/01.mp4";
    for (const player of ["one", "two"]) {
      coordinator.sync(player, [path], 1);
      coordinator.begin(player, player, path, 1);
      coordinator.sample(player, player, sample(96), true);
    }
    coordinator.mark("one", mediaId(path), false, 100000);
    expect(reset).toHaveBeenCalledTimes(2);
    coordinator.sample("two", "two", sample(97, 101000), true);
    expect(repo.data.videos[mediaId(path)]?.status).toBe("unwatched");
    coordinator.sample("one", "one", sample(0, 102000, { paused: true }), true);
    expect(repo.data.videos[mediaId(path)]?.position).toBe(0);
    coordinator.sample("one", "one", sample(0, 103000), false);
    coordinator.sample("one", "one", sample(1, 104000), false);
    expect(repo.data.videos[mediaId(path)]?.watchedTime).toBe(1);
  });
  it("restricts manual mutations to subscribed records and preserves detached folders", () => {
    const repo = repository();
    const coordinator = new Coordinator(repo, vi.fn(), vi.fn());
    coordinator.sync("one", ["/A/01.mp4"], 1);
    coordinator.sync("two", ["/B/01.mp4"], 1);
    coordinator.mark("one", mediaId("/B/01.mp4"), true, 2);
    expect(repo.data.videos[mediaId("/B/01.mp4")]?.status).toBe("unwatched");
    coordinator.sync("one", ["/C/01.mp4"], 3);
    expect(repo.data.videos[mediaId("/A/01.mp4")]).toBeDefined();
  });
});
