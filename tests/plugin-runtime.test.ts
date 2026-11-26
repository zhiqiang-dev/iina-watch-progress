import { beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import vm from "node:vm";
import { MSG, type ViewState, type ViewSnapshot } from "../src/messaging/message-bus";
import { mediaId } from "../src/core/media-identity";
import { decodeSnapshot } from "../src/storage/migration";

let globalCode: string;
let mainCode: string;
beforeAll(async () => {
  const bundle = async (entry: string) => (await build({ entryPoints: [entry], bundle: true,
    write: false, format: "iife", platform: "neutral", target: "safari14" })).outputFiles[0]!.text;
  [globalCode, mainCode] = await Promise.all([bundle("src/global.ts"), bundle("src/main.ts")]);
});

function runtime(options: { loadEvents?: boolean; unavailableFolder?: string } = {}) {
  const files = new Map<string, string>();
  const globalHandlers = new Map<string, (data: unknown, player: string) => void>();
  const childHandlers = new Map<string, (data: unknown) => void>();
  const events = new Map<string, () => void>();
  const hooks = new Map<string, () => void>();
  const viewHandlers = new Map<string, (data: unknown) => void>();
  const timers: (() => void)[] = [];
  const globalTimers: (() => void)[] = [];
  let requestDepth = 0;
  const ticks: (() => void)[] = [];
  const autosaves = new Map<string, { callback: () => void; ms: number }>();
  let nextAutosave = 0, writes = 0, viewLoads = 0;
  const commands: unknown[][] = [];
  const plays: number[] = [];
  const errors: unknown[] = [];
  const reads: string[] = [];
  const playerWindow = { sidebar: "plugin:io.iina.watch-progress" as string | null, miniaturized: false };
  const properties: Record<string, unknown> = { path: "/Course/01.mp4", "working-directory": "/",
    "time-pos": 0, duration: 100, pause: false, seeking: false, "paused-for-cache": false, speed: 1, "eof-reached": false };
  let playlist = [{ filename: "/Course/01.mp4" }, { filename: "/Course/02.mp4" }];
  let view: ViewSnapshot | undefined;
  const viewMessages: ViewState[] = [];
  const scans: string[] = [];
  const clone = (value: unknown) => JSON.parse(JSON.stringify(value));
  function deliver(): void {
    let count = 0;
    while (globalTimers.length) {
      if (++count > 100) throw new Error("Unbounded native message recursion");
      globalTimers.shift()!();
    }
  }
  const consoleAPI = { log() {}, error: (error: unknown) => errors.push(error) };
  const fileAPI = {
    exists: (path: string) => path.startsWith("/Course/") || files.has(path),
    read: (path: string) => files.get(path),
    write: (path: string, text: string) => { writes++; files.set(path, text); },
    list: (path: string) => {
      scans.push(path); if (path === options.unavailableFolder) throw new Error("Folder offline");
      return ["01.mp4", "02.mp4", "03.mp4"].map(filename => ({ filename, path: `/${filename}`, isDir: false }));
    },
    showInFinder() {},
  };
  vm.runInNewContext(globalCode, {
    iina: { file: fileAPI, console: consoleAPI, global: {
      onMessage: (name: string, handler: (data: unknown, player: string) => void) => globalHandlers.set(name, handler),
      postMessage: (_player: string, name: string, data: unknown) => {
        if (requestDepth > 0) throw new Error("Unsafe synchronous cross-context reply");
        childHandlers.get(name)?.(clone(data));
      },
    } }, setInterval: (callback: () => void, ms: number) => {
      const id = `global-timer-${++nextAutosave}`; autosaves.set(id, { callback, ms }); return id;
    }, clearInterval: (id: string) => autosaves.delete(id),
    setTimeout: (callback: () => void) => { globalTimers.push(callback); return "global-timeout"; },
  });
  const ui = {
    loadFile: () => { viewLoads++; viewHandlers.clear(); },
    onMessage: (name: string, handler: (data: unknown) => void) => viewHandlers.set(name, handler),
    postMessage: (name: string, data: ViewState) => {
      if (name !== MSG.view) return;
      const next = clone(data) as ViewState;
      viewMessages.push(next);
      if (next.kind !== "patch") view = next;
      else if (view && next.scope === view.scope) {
        const videos = new Map(view.videos.map(record => [record.id, record]));
        for (const record of next.videos) videos.set(record.id, record);
        view = { ...view, videos: [...videos.values()], settings: next.settings, storage: next.storage,
          activeId: next.activeId ?? undefined, paused: next.paused, media: next.media, scanError: next.scanError ?? undefined };
      }
    },
    show() {},
  };
  vm.runInNewContext(mainCode, {
    iina: {
      console: consoleAPI, file: fileAPI, sidebar: ui,
      standaloneWindow: { ...ui, open() {}, close() {}, setProperty() {}, setFrame() {} },
      core: { window: playerWindow, open: (path: string) => { properties.path = path; } },
      mpv: {
        getNative: () => ({ w: 1920, h: 1080 }),
        getNumber: (name: string) => { reads.push(name); return properties[name]; }, getFlag: (name: string) => { reads.push(name); return properties[name]; },
        getString: (name: string) => { reads.push(name); return properties[name]; },
        set: (name: string, value: unknown) => { properties[name] = value; },
        command: (name: string, args: string[]) => { commands.push([name, args]); },
        addHook: (name: string, _priority: number, callback: () => void) => hooks.set(name, callback),
      },
      event: { on: (name: string, handler: () => void) => events.set(name, handler) },
      playlist: { list: () => playlist, play: (index: number) => plays.push(index) },
      menu: { addItem() {}, item() {} },
      global: {
        onMessage: (name: string, handler: (data: unknown) => void) => childHandlers.set(name, handler),
        postMessage: (name: string, data: unknown) => {
          requestDepth++;
          try { globalHandlers.get(name)?.(clone(data), "player-one"); }
          finally { requestDepth--; }
        },
      },
    },
    setInterval: (callback: () => void) => { ticks.push(callback); return "main-timer"; },
    setTimeout: (callback: () => void) => { timers.push(callback); return "timeout"; }, clearTimeout() {},
  });
  const fire = (event: string) => { events.get(event)?.(); deliver(); };
  const ready = () => { viewHandlers.get(MSG.ready)?.({}); deliver(); };
  if (options.loadEvents !== false) {
    fire("iina.window-loaded");
    ready();
    fire("iina.file-loaded");
  }
  return { files, properties, fire, hooks, errors, plays, commands, viewMessages, scans, reads, playerWindow,
    viewLoads: () => viewLoads,
    autosaves, writes: () => writes,
    checkpoint: () => { for (const { callback } of autosaves.values()) callback(); deliver(); },
    tick: () => { ticks.forEach(tick => tick()); deliver(); },
    runTimers: () => { timers.splice(0).forEach(timer => timer()); deliver(); },
    action: (data: unknown) => { viewHandlers.get(MSG.action)?.(data); deliver(); },
    ready,
    receive: (wire: unknown) => childHandlers.get(MSG.records)?.(wire),
    state: () => view!,
    setPlaylist: (paths: string[]) => { playlist = paths.map(filename => ({ filename })); },
    reorder: () => { playlist = [...playlist].reverse(); },
  };
}

describe("bundled IINA main/global integration", () => {
  it("reattaches the sidebar when a closed player is reused for another file", () => {
    const app = runtime(); expect(app.viewLoads()).toBe(1);
    app.fire("iina.window-will-close");
    app.properties.path = "/Course/02.mp4"; app.properties["time-pos"] = 30;
    app.fire("iina.file-loaded"); app.ready();
    expect(app.viewLoads()).toBe(2); expect(app.state().activeId).toBe(mediaId("/Course/02.mp4"));
    app.properties["time-pos"] = 31; app.tick();
    expect(app.state().videos.find(record => record.id === mediaId("/Course/02.mp4"))?.position).toBe(31);
    expect(app.errors).toEqual([]);
  });
  it("keeps tracking and saving when the view is hidden, then sends the latest full state", () => {
    const app = runtime(); app.action({ type: "visibility", visible: false }); const messages = app.viewMessages.length;
    app.properties["time-pos"] = 20; app.tick(); app.checkpoint();
    expect(app.viewMessages).toHaveLength(messages); expect(app.writes()).toBeGreaterThan(0);
    app.action({ type: "visibility", visible: true }); expect(app.state().videos[0]?.position).toBe(20);
    app.playerWindow.sidebar = "audio"; app.tick(); const hidden = app.viewMessages.length;
    app.properties["time-pos"] = 25; app.tick(); expect(app.viewMessages).toHaveLength(hidden);
    app.playerWindow.sidebar = "plugin:io.iina.watch-progress"; app.tick(); expect(app.state().videos[0]?.position).toBe(25);
  });
  it("keeps updating a visible plugin sidebar when IINA 1.5.1 reports null for its name", () => {
    const app = runtime(); app.playerWindow.sidebar = null;
    app.properties["time-pos"] = 35; app.tick();
    expect(app.state().videos[0]?.position).toBe(35);
    app.playerWindow.miniaturized = true; app.tick(); const messages = app.viewMessages.length;
    app.properties["time-pos"] = 36; app.tick(); expect(app.viewMessages).toHaveLength(messages);
    app.playerWindow.miniaturized = false; app.tick(); expect(app.state().videos[0]?.position).toBe(36);
  });
  it("avoids repeated duration/speed/flags and cwd reads during periodic playback and all mpv reads while paused", () => {
    const app = runtime(); app.reads.length = 0;
    app.properties["time-pos"] = 1; app.tick(); app.properties["time-pos"] = 2; app.tick();
    expect(app.reads).toEqual(["path", "time-pos", "path", "time-pos"]);
    app.properties.pause = true; app.fire("mpv.pause.changed"); app.reads.length = 0; app.tick();
    expect(app.reads).toEqual([]);
  });
  it("seeks only within the active file and keeps its paused state", () => {
    const app = runtime(); app.properties.pause = true; app.fire("mpv.pause.changed");
    const active = mediaId("/Course/01.mp4");
    app.action({ type: "seek", id: mediaId("/Course/02.mp4"), position: 50 });
    app.action({ type: "seek", id: active, position: NaN });
    expect(app.commands).toEqual([]);
    app.action({ type: "seek", id: active, position: 150 }); expect(app.commands.at(-1)).toEqual(["seek", ["100", "absolute+exact"]]);
    app.action({ type: "seek", id: active, position: -10 }); expect(app.commands.at(-1)).toEqual(["seek", ["0", "absolute+exact"]]);
    expect(app.properties.pause).toBe(true); expect(app.plays).toEqual([]);
    expect(app.state().media).toMatchObject({ id: active, width: 1920, height: 1080 });
  });
  it("locates the active file's folder without playing or seeking", () => {
    const app = runtime(); app.setPlaylist(["/Course/01.mp4", "/Other/01.mp4"]);
    app.fire("mpv.playlist.changed"); app.runTimers();
    app.action({ type: "folder", path: "/Other" }); expect(app.state().selectedFolder).toBe("/Other");
    app.action({ type: "locate-current" }); expect(app.state().selectedFolder).toBe("/Course");
    expect(app.state().activeId).toBe(mediaId("/Course/01.mp4")); expect(app.commands).toEqual([]); expect(app.plays).toEqual([]);
  });
  it("browses a remembered local folder outside the playlist without changing playback", () => {
    const app = runtime();
    app.action({ type: "folder", path: "/Remembered" });
    expect(app.state().selectedFolder).toBe("/Remembered"); expect(app.state().items).toHaveLength(3);
    expect(app.state().activeId).toBe(mediaId("/Course/01.mp4"));
    expect(app.commands).toEqual([]); expect(app.plays).toEqual([]);
    app.action({ type: "folder", path: "https://example.com/video" });
    app.action({ type: "folder", path: "relative/path" });
    expect(app.state().selectedFolder).toBe("/Remembered");
    app.action({ type: "locate-current" }); expect(app.state().selectedFolder).toBe("/Course");
  });
  it("keeps the current folder and playback when a remembered folder is offline", () => {
    const app = runtime({ unavailableFolder: "/Offline" });
    app.action({ type: "folder", path: "/Offline" });
    expect(app.state().selectedFolder).toBe("/Course"); expect(app.state().scanError).toContain("offline");
    expect(app.state().videos).toHaveLength(3); expect(app.plays).toEqual([]); expect(app.commands).toEqual([]);
  });
  it("changes the global checkpoint interval without extra idle writes and still saves pauses immediately", () => {
    const app = runtime();
    expect([...app.autosaves.values()].map(timer => timer.ms)).toEqual([5000]);
    app.action({ type: "save-interval", value: 30 });
    expect([...app.autosaves.values()].map(timer => timer.ms)).toEqual([30000]);
    expect(app.state().settings.saveIntervalSeconds).toBe(30);
    const saved = app.writes();
    app.action({ type: "save-interval", value: 30 });
    app.action({ type: "save-interval", value: 1 });
    app.checkpoint();
    expect(app.writes()).toBe(saved);
    app.properties["time-pos"] = 21; app.tick();
    expect(app.writes()).toBe(saved);
    app.properties.pause = true; app.fire("mpv.pause.changed");
    expect(app.writes()).toBe(saved + 1);
    const snapshot = decodeSnapshot([...app.files.values()].at(-1)!);
    expect(snapshot.payload.settings.saveIntervalSeconds).toBe(30);
    expect(snapshot.payload.videos[mediaId("/Course/01.mp4")]?.position).toBe(21);
    app.checkpoint(); expect(app.writes()).toBe(saved + 1);
    expect(app.errors).toEqual([]);
  });
  it("registers messages after loadFile clears listeners and scans all siblings", () => {
    const app = runtime();
    expect(app.state().items).toHaveLength(3);
    expect(app.state().videos).toHaveLength(3);
    expect(app.state().activeId).toBe(mediaId("/Course/01.mp4"));
    expect(app.errors).toEqual([]);
  });
  it("flushes playback on pause and close without completing an ordinary stop", () => {
    const app = runtime();
    app.properties["time-pos"] = 40;
    app.properties.pause = true;
    app.fire("mpv.pause.changed");
    const snapshot = decodeSnapshot([...app.files.values()].at(-1)!);
    expect(snapshot.payload.videos[mediaId("/Course/01.mp4")]?.position).toBe(40);
    app.fire("iina.window-will-close");
    expect(app.state().videos[0]?.status).not.toBe("completed");
    expect(app.errors).toEqual([]);
  });
  it("does not overwrite a saved position when time-pos disappears during unload", () => {
    const app = runtime();
    app.properties["time-pos"] = 40;
    app.fire("mpv.pause.changed");
    app.properties["time-pos"] = null;
    app.hooks.get("on_unload")?.();
    app.fire("mpv.end-file");
    expect(app.state().videos[0]?.position).toBe(40);
  });
  it("only treats confirmed EOF as completion at 100 percent", () => {
    const app = runtime();
    app.action({ type: "threshold", value: 1 });
    app.properties["time-pos"] = 99.5;
    app.properties["eof-reached"] = true;
    app.hooks.get("on_unload")?.();
    app.runTimers();
    expect(app.state().videos[0]?.status).toBe("completed");
  });
  it("resolves the current playlist index for double-click playback", () => {
    const app = runtime();
    app.reorder();
    app.action({ type: "play", id: mediaId("/Course/01.mp4") });
    expect(app.plays).toEqual([]); // Already active: resume without reloading.
    app.action({ type: "play", id: mediaId("/Course/02.mp4") });
    expect(app.plays).toEqual([0]);
  });
  it("explicitly continues saved history after the target file starts", () => {
    const app = runtime();
    app.properties["time-pos"] = 40;
    app.fire("mpv.pause.changed");
    app.fire("mpv.start-file");
    app.properties.path = "/Course/02.mp4";
    app.properties["time-pos"] = 0;
    app.fire("iina.file-loaded");
    app.action({ type: "continue", id: mediaId("/Course/01.mp4") });
    expect(app.commands).toEqual([]);
    app.fire("mpv.start-file");
    app.properties.path = "/Course/01.mp4";
    app.fire("iina.file-loaded");
    app.fire("mpv.playback-restart");
    expect(app.commands).toContainEqual(["seek", ["40", "absolute+exact"]]);
  });
  it("does not resubscribe or write new samples after the window closes", () => {
    const app = runtime();
    app.properties["time-pos"] = 40;
    app.fire("iina.window-will-close");
    const saved = [...app.files.values()];
    app.properties["time-pos"] = 90;
    app.fire("mpv.end-file");
    app.fire("mpv.playlist.changed");
    app.runTimers();
    app.tick();
    expect([...app.files.values()]).toEqual(saved);
    expect(app.errors).toEqual([]);
  });
  it("reattaches after enabling the plugin in an already loaded player without seeking", () => {
    const app = runtime({ loadEvents: false });
    app.properties["time-pos"] = 40;
    app.runTimers();
    app.ready();
    expect(app.state().items).toHaveLength(3);
    expect(app.state().activeId).toBe(mediaId("/Course/01.mp4"));
    expect(app.commands).toEqual([]);
    expect(app.errors).toEqual([]);
  });
  it("keeps the last valid list and surfaces malformed native record messages", () => {
    const app = runtime();
    app.receive("not JSON");
    expect(app.state().videos).toHaveLength(3);
    expect(app.state().storage.error).toContain("无法读取观看记录消息");
  });
  it("toggles the active row without reloading or seeking and plays inactive rows", () => {
    const app = runtime(); app.properties["time-pos"] = 40; app.properties.pause = true; app.fire("mpv.pause.changed");
    app.action({ type: "toggle-playback", id: mediaId("/Course/01.mp4") });
    expect(app.properties.pause).toBe(false); expect(app.state().paused).toBe(false);
    app.action({ type: "toggle-playback", id: mediaId("/Course/01.mp4") });
    expect(app.properties.pause).toBe(true); expect(app.properties["time-pos"]).toBe(40);
    expect(app.commands).toEqual([]); expect(app.plays).toEqual([]);
    app.action({ type: "toggle-playback", id: mediaId("/Course/02.mp4") }); expect(app.plays).toEqual([1]);
  });
  it("sends just one changed record and no periodic UI updates while paused", () => {
    const app = runtime(); const before = app.viewMessages.length;
    app.properties["time-pos"] = 40; app.tick();
    const updates = app.viewMessages.slice(before);
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.every(message => message.kind === "patch" && message.videos.length <= 1)).toBe(true);
    app.properties.pause = true; app.fire("mpv.pause.changed");
    const paused = app.viewMessages.length; app.tick(); app.tick();
    expect(app.viewMessages).toHaveLength(paused);
  });
  it("reuses folder listings across file events and explicitly refreshes on request", () => {
    const app = runtime(); expect(app.scans).toHaveLength(1);
    app.fire("mpv.playlist.changed"); app.runTimers(); expect(app.scans).toHaveLength(1);
    app.action({ type: "refresh" }); expect(app.scans).toHaveLength(2);
  });
  it("discards snapshots from an obsolete folder subscription", () => {
    const app = runtime(); const before = app.state();
    app.receive(JSON.stringify({ kind: "snapshot", scope: 999, videos: [], settings: before.settings, storage: before.storage }));
    expect(app.state().videos).toHaveLength(3);
  });
});
