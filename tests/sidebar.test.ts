import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { createRecord } from "../src/core/progress-engine";
import { DEFAULT_BROWSE } from "../src/ui/browse-state";
import { MSG, type ViewPatch, type ViewSnapshot, type ViewState, type UIAction } from "../src/messaging/message-bus";

let code: string, html: string;
const opened: JSDOM[] = [];
beforeAll(async () => {
  html = await readFile("src/ui/sidebar/index.html", "utf8");
  code = (await build({ entryPoints: ["src/ui/sidebar/index.ts"], bundle: true, write: false, format: "iife", target: "safari14" })).outputFiles[0]!.text;
});
afterEach(() => { opened.splice(0).forEach(dom => dom.window.close()); vi.useRealTimers(); });

function sidebar(count = 1000) {
  vi.useFakeTimers();
  const dom = new JSDOM(html, { url: "https://preview.test/?benchmark=1", runScripts: "outside-only", pretendToBeVisual: true });
  opened.push(dom);
  const w = dom.window, document = w.document, actions: UIAction[] = [], frames = new Map<number, FrameRequestCallback>();
  let frameId = 0, receive: (message: ViewState) => void = () => {};
  const videos = Array.from({ length: count }, (_, i) => ({ ...createRecord(`/Course/${String(i + 1).padStart(3, "0")} 课程.mp4`, 1),
    duration: 100, status: i < 3 ? "completed" as const : "unwatched" as const }));
  const state: ViewSnapshot = { kind: "snapshot", scope: 1, videos, items: videos.map(r => ({ id: r.id, path: r.filePath })),
    folders: [{ path: "/Course", name: "Course" }], selectedFolder: "/Course", activeId: videos[3]?.id, paused: true,
    settings: { completionThreshold: 0.95 }, storage: { readOnly: false, dirty: false, recovered: false, lastSavedAt: 1 } };
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
  Object.defineProperty(el("list"), "clientHeight", { value: 350 });
  Object.assign(w, {
    wpPreview: true, ResizeObserver: class { observe() {} },
    setTimeout, clearTimeout,
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    iina: { onMessage: (_name: string, handler: typeof receive) => { receive = handler; }, postMessage: (name: string, data: UIAction) => {
      if (name === MSG.ready) receive(structuredClone(state));
      if (name === MSG.action) actions.push(data);
    } },
  });
  w.localStorage.setItem("watch-progress:browse:v1", JSON.stringify([["/Remembered", DEFAULT_BROWSE]]));
  w.eval(code);
  function flushFrames() { for (const [id, callback] of [...frames]) { frames.delete(id); callback(0); } }
  flushFrames();
  return { w, el, actions, state, flushFrames,
    key: (id: string, key: string, options = {}) => el(id).dispatchEvent(new w.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options })),
    input: (id: string, value: string) => { el<HTMLInputElement>(id).value = value; el(id).dispatchEvent(new w.Event("input", { bubbles: true })); },
    patch: (overrides: Partial<ViewPatch> = {}) => {
      receive(structuredClone({ kind: "patch", scope: 1, videos: [], settings: state.settings, storage: state.storage,
        activeId: state.activeId ?? null, paused: state.paused ?? true, scanError: null, ...overrides })); flushFrames();
    },
  };
}

describe("bundled sidebar interactions", () => {
  it("keeps a long list virtualized and waits for IME completion before querying, without re-sorting", () => {
    const app = sidebar();
    expect(app.el("list-content").children.length).toBeLessThan(20);
    app.el("search").dispatchEvent(new app.w.CompositionEvent("compositionstart"));
    app.input("search", "不匹配"); vi.advanceTimersByTime(1000); app.flushFrames();
    expect(app.el("list-count").textContent).toBe("1000 个视频");
    app.input("search", "058"); app.el("search").dispatchEvent(new app.w.CompositionEvent("compositionend"));
    vi.advanceTimersByTime(149); expect(app.el("list-count").textContent).toBe("1000 个视频");
    vi.advanceTimersByTime(1); app.flushFrames(); expect(app.el("list-count").textContent).toBe("1 个视频 / 共 1000 个");
    expect(app.el("list").dataset.sorts).toBe("1");
    app.input("search", "059"); app.key("search", "Enter"); app.flushFrames();
    expect(app.el("list-content").textContent).toContain("059 课程.mp4");
    expect(app.actions).toEqual([]);
  });
  it("does not redraw rows or unrelated sections for storage-only updates, but updates read-only controls", () => {
    const app = sidebar(), before = { ...app.el("list").dataset };
    app.patch({ storage: { ...app.state.storage, dirty: true } });
    for (const key of ["frames", "patched", "renderSelection", "renderStats", "renderNavigation"]) expect(app.el("list").dataset[key]).toBe(before[key]);
    expect(app.el("storage-status").textContent).toBe("等待保存…");
    app.patch({ storage: { ...app.state.storage, readOnly: true } });
    expect(app.el<HTMLButtonElement>("complete-selected").disabled).toBe(true);
    expect(app.el("list").dataset.frames).toBe(before.frames);
  });
  it("does not draw visible rows for an offscreen playing item or repeat navigation work on wheel events", () => {
    const app = sidebar(); app.key("list", "End"); app.flushFrames();
    const before = { ...app.el("list").dataset };
    for (let i = 0; i < 30; i++) app.el("list").dispatchEvent(new app.w.WheelEvent("wheel"));
    app.patch({ videos: [{ ...app.state.videos[3]!, position: 1, maxPosition: 1, progress: 0.01, lastPlayedAt: 1000 }] });
    for (const key of ["frames", "patched", "renderSelection", "renderStats", "renderNavigation"]) expect(app.el("list").dataset[key]).toBe(before[key]);
  });
  it("locates a filtered-out filename number, restores the filter and never plays as a side effect", () => {
    const app = sidebar();
    app.w.document.querySelector<HTMLButtonElement>('[data-filter="completed"]')!.click();
    app.key("list", "j", { metaKey: true }); expect(app.w.document.activeElement).toBe(app.el("video-number"));
    app.input("video-number", "５８"); app.el("jump-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true })); app.flushFrames();
    expect(app.el("selected-name").textContent).toBe("058 课程.mp4"); expect(app.el("restore-query").hidden).toBe(false);
    expect(app.actions).toEqual([]);
    app.el("restore-query").click(); expect(app.el("list-count").textContent).toBe("3 个视频 / 共 1000 个");
    app.key("list", "f", { metaKey: true }); expect(app.w.document.activeElement).toBe(app.el("search"));
  });
  it("selects adjacent unfinished videos and exposes recent folders without opening a video", () => {
    const app = sidebar(); app.el("next-unfinished").click();
    expect(app.el("selected-name").textContent).toBe("005 课程.mp4"); app.el("previous-unfinished").click();
    expect(app.el("selected-name").textContent).toBe("004 课程.mp4");
    expect(app.el<HTMLSelectElement>("folder").disabled).toBe(false);
    app.el<HTMLSelectElement>("folder").value = "/Remembered"; app.el("folder").dispatchEvent(new app.w.Event("change"));
    expect(app.actions).toEqual([{ type: "folder", path: "/Remembered" }]);
  });
  it("restores the displayed seek position after cancellation and ignores stale media patches", () => {
    const app = sidebar(); app.input("selected-seek", "50"); expect(app.el("selected-position").textContent).toContain("0:50");
    app.el("selected-seek").dispatchEvent(new app.w.Event("pointercancel", { bubbles: true }));
    expect(app.el<HTMLInputElement>("selected-seek").value).toBe("0");
    app.patch({ scope: 999, videos: [{ ...app.state.videos[3]!, position: 80 }], media: { id: app.state.activeId!, width: 4, height: 4, codec: "wrong" } });
    expect(app.el<HTMLInputElement>("selected-seek").value).toBe("0");
  });
});
