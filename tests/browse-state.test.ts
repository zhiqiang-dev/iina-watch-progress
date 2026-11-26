import { describe, expect, it } from "vitest";
import { BrowseStateStore, DEFAULT_BROWSE, captureAnchor, restoreAnchor } from "../src/ui/browse-state";

describe("folder browsing memory", () => {
  it("does not write unchanged preferences and preserves updates from another view", () => {
    let wire: string | null = null, writes = 0;
    const storage = { getItem: () => wire, setItem: (_key: string, value: string) => { wire = value; writes++; } };
    const a = new BrowseStateStore(storage), b = new BrowseStateStore(storage);
    a.set("/A", DEFAULT_BROWSE); b.set("/B", DEFAULT_BROWSE);
    for (let index = 0; index < 20; index++) a.set("/A", { ...DEFAULT_BROWSE });
    expect(writes).toBe(2);
    expect(new BrowseStateStore(storage).get("/B")).toEqual(DEFAULT_BROWSE);
    a.set("/A", { ...DEFAULT_BROWSE, scrollTop: 100 }); expect(writes).toBe(3);
  });
  it("restores separate folders across views and preserves an anchor after insertion", () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const first = new BrowseStateStore(storage), second = new BrowseStateStore(storage);
    first.set("/A", { ...DEFAULT_BROWSE, search: "058 德国", selectedId: "b", ...captureAnchor(["a", "b", "c"], 70, 64) });
    second.set("/B", { ...DEFAULT_BROWSE, sort: "recent", follow: false });
    const restored = new BrowseStateStore(storage).get("/A")!;
    expect(restored.search).toBe("058 德国"); expect(restored.selectedId).toBe("b");
    expect(restoreAnchor(["new", "a", "b", "c"], restored, 64)).toBe(134);
    expect(new BrowseStateStore(storage).get("/B")?.sort).toBe("recent");
  });
  it("tolerates unavailable or damaged UI storage and bounds the folder count", () => {
    const unavailable = { getItem: () => { throw new Error("Unavailable"); }, setItem: () => { throw new Error("Quota"); } };
    const fallback = new BrowseStateStore(unavailable); fallback.set("/A", { ...DEFAULT_BROWSE, scrollTop: 100 });
    expect(fallback.get("/A")?.scrollTop).toBe(100);
    const memory = new BrowseStateStore(); memory.set("/A", DEFAULT_BROWSE); expect(memory.get("/A")).toBeDefined();
    let wire = "broken";
    const bounded = new BrowseStateStore({ getItem: () => wire, setItem: (_key, value) => { wire = value; } });
    expect(bounded.get("/A")).toBeUndefined();
    for (let index = 0; index < 50; index++) bounded.set(`/Folder${index}`, DEFAULT_BROWSE);
    expect(JSON.parse(wire)).toHaveLength(40); expect(bounded.get("/Folder0")).toBeUndefined();
  });
  it("ignores invalid preferences and falls back if the anchor file disappeared", () => {
    const store = new BrowseStateStore(); store.set("/A", { ...DEFAULT_BROWSE, scrollTop: NaN });
    expect(store.get("/A")).toBeUndefined();
    expect(restoreAnchor(["a"], { anchorId: "missing", anchorOffset: 4, scrollTop: 120 }, 64)).toBe(120);
  });
});
