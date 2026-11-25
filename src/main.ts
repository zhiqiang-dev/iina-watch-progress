import { MpvAdapter } from "./adapter/mpv-api";
import { fileName, folderPath, isVideo, mediaId, normalizePath } from "./core/media-identity";
import { FolderListingCache, includeFolder, playlistItems, type MediaItem } from "./core/playlist-service";
import { MSG, type FolderOption, type RecordsMessage, type ViewSnapshot, type ViewPatch, type MediaInfo } from "./messaging/message-bus";
import type { VideoRecord } from "./models/video-record";
import type { PlaybackSample } from "./core/playback-tracker";
import type { StorageState } from "./storage/json-storage";
import { DEFAULT_SETTINGS } from "./models/settings";
import { object } from "./storage/migration";
import { onNativeMessage } from "./messaging/native-messages";

const globalAPI = iina.global;
const sidebar = iina.sidebar;
const standaloneWindow = iina.standaloneWindow;
const mpv = new MpvAdapter(iina.mpv);
const folderCache = new FolderListingCache(path => iina.file.list(path, { includeSubDir: false }));
let items: MediaItem[] = [];
let itemsById = new Map<string, MediaItem>();
const videosById = new Map<string, VideoRecord>();
let scope = 0;
let listed = false;
let viewMetadata = "";
let lastReading: PlaybackSample | undefined;
let folders: FolderOption[] = [];
let selectedFolder: string | undefined;
let activePath: string | undefined;
let session: string | undefined;
let sequence = 0;
let windowLoaded = false;
let sidebarReady = false;
let detachedReady = false;
let detachedLoaded = false;
let connected = false;
let closing = false;
let scanError: string | undefined;
let pendingResume: { path: string; position: number; expires: number } | undefined;
let syncTimer: string | undefined;
let seekTimer: string | undefined;
let media: MediaInfo | undefined;
function refreshMedia(): void {
  if (!activePath) { media = undefined; return; }
  try {
    const params = iina.mpv.getNative<{ w?: number; h?: number }>("video-params");
    media = { id: mediaId(activePath), width: Number(params?.w) || 0, height: Number(params?.h) || 0, codec: mpv.string("video-codec") };
  } catch { media = undefined; }
}
let settings = { ...DEFAULT_SETTINGS };
let storage: StorageState = { readOnly: false, dirty: false, recovered: false, lastSavedAt: 0,
  error: "正在连接观看记录…" };

function currentPath(): string | undefined {
  return normalizePath(mpv.string("path"), mpv.string("working-directory"));
}
function postView(target?: IINA.API.SidebarView | IINA.API.StandaloneWindow): void {
  const state: ViewSnapshot = { kind: "snapshot", scope, videos: [...videosById.values()], settings, storage,
    items, folders, selectedFolder, activeId: activePath ? mediaId(activePath) : undefined,
    paused: activePath ? mpv.flag("pause", true) : true, media, scanError };
  if (target) { target.postMessage(MSG.view, state); return; }
  if (sidebarReady) sidebar.postMessage(MSG.view, state);
  if (detachedReady) standaloneWindow.postMessage(MSG.view, state);
}
function postPatch(videos: VideoRecord[] = []): void {
  const state: ViewPatch = { kind: "patch", scope, videos, settings, storage,
    activeId: activePath ? mediaId(activePath) : null, paused: activePath ? mpv.flag("pause", true) : true,
    media, scanError: scanError ?? null };
  if (sidebarReady) sidebar.postMessage(MSG.view, state);
  if (detachedReady) standaloneWindow.postMessage(MSG.view, state);
}

function syncPlaylist(forceScan = false): void {
  syncTimer = undefined;
  if (closing) return;
  let queued: MediaItem[];
  try { queued = playlistItems(iina.playlist.list(), mpv.string("working-directory")); }
  catch (error) { scanError = `无法读取播放列表：${String(error)}`; postView(); return; }
  const paths = new Set(queued.map(item => folderPath(item.path)));
  if (activePath && isVideo(activePath)) paths.add(folderPath(activePath));
  folders = [...paths].sort().map(path => ({ path, name: fileName(path) || "/" }));
  if (!selectedFolder || !paths.has(selectedFolder))
    selectedFolder = activePath && isVideo(activePath) ? folderPath(activePath) : folders[0]?.path;
  scanError = undefined;
  if (selectedFolder) {
    try {
      const files = folderCache.list(selectedFolder, Date.now(), forceScan);
      items = includeFolder(queued, selectedFolder, files);
    } catch (error) {
      items = queued.filter(item => folderPath(item.path) === selectedFolder);
      scanError = `仅统计当前播放列表；文件夹读取失败：${String(error)}`;
    }
  } else items = [];
  const membershipChanged = !listed || items.length !== itemsById.size || items.some(item => !itemsById.has(item.id));
  itemsById = new Map(items.map(item => [item.id, item]));
  listed = true;
  if (membershipChanged) {
    scope++;
    for (const id of videosById.keys()) if (!itemsById.has(id)) videosById.delete(id);
  }
  if (membershipChanged || !connected)
    globalAPI.postMessage(MSG.sync, { paths: items.map(item => item.path), scope });
  const metadata = JSON.stringify([selectedFolder, folders]);
  const metadataChanged = metadata !== viewMetadata;
  viewMetadata = metadata;
  if (membershipChanged || metadataChanged) postView();
  else postPatch();
}

function scheduleSync(): void {
  if (closing) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(syncPlaylist, 100);
}
function sample(flush = false, eof = false): void {
  if (!session || !activePath || closing || currentPath() !== activePath) return;
  const reading = mpv.sample(++sequence, eof);
  if (!reading) return;
  const unchanged = lastReading && (["position", "duration", "paused", "seeking", "buffering", "speed", "eof"] as const)
    .every(key => lastReading![key] === reading[key]);
  if (unchanged && !flush) return;
  lastReading = reading;
  globalAPI.postMessage(MSG.sample, { session, sample: reading, flush });
}
function endSession(): void {
  if (session) globalAPI.postMessage(MSG.end, { session });
  session = undefined;
  activePath = undefined;
  lastReading = undefined;
  media = undefined;
  if (seekTimer) clearTimeout(seekTimer); seekTimer = undefined;
  postPatch();
}
function fileLoaded(): void {
  // start-file already flushed the old session. Never sample new-file properties into it.
  if (session) endSession();
  closing = false;
  const path = currentPath();
  if (pendingResume && path !== pendingResume.path) pendingResume = undefined;
  if (path && isVideo(path)) {
    activePath = path;
    session = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sequence = 0;
    selectedFolder = folderPath(path);
    globalAPI.postMessage(MSG.begin, { session, path });
  }
  refreshMedia(); syncPlaylist();
  sample();
  // Some IINA versions dispatch their file-loaded callback after playback-restart.
  if (pendingResume) setTimeout(seekPending, 200);
}
function seekPending(): void {
  const pending = pendingResume;
  if (!pending) return;
  if (Date.now() > pending.expires) { pendingResume = undefined; return; }
  if (currentPath() !== pending.path || !session) return;
  pendingResume = undefined;
  const duration = mpv.number("duration");
  const position = duration > 0 ? Math.min(pending.position, Math.max(0, duration - 1)) : pending.position;
  iina.mpv.command("seek", [String(position), "absolute+exact"]);
  iina.mpv.set("pause", false);
}
function play(id: string, resume: boolean): void {
  const item = itemsById.get(id);
  if (!item) return;
  if (!iina.file.exists(item.path)) { scanError = "视频文件不存在或已离线，请检查磁盘后刷新。"; postView(); return; }
  const record = videosById.get(id);
  const position = resume && record?.status !== "completed" ? record?.position ?? 0 : 0;
  pendingResume = resume ? { path: item.path, position, expires: Date.now() + 10000 } : undefined;
  if (activePath === item.path && session) {
    if (resume) seekPending();
    else iina.mpv.set("pause", false);
    return;
  }
  sample(true);
  // Resolve the live index; a playlist may have reordered since the last UI update.
  const queued = playlistItems(iina.playlist.list(), mpv.string("working-directory"));
  const index = queued.find(entry => entry.id === id)?.playlistIndex;
  if (index !== undefined) iina.playlist.play(index);
  else iina.core.open(item.path);
}
function togglePlayback(id: string): void {
  const item = itemsById.get(id);
  if (!item) return;
  if (item.path !== activePath || !session) { play(id, false); return; }
  const paused = !mpv.flag("pause", true);
  iina.mpv.set("pause", paused);
  sample(paused);
  postPatch();
}
function detach(): void {
  if (!detachedLoaded) {
    standaloneWindow.loadFile("ui/sidebar/index.html");
    bindView(standaloneWindow, true);
    standaloneWindow.setProperty({ title: "观看进度", resizable: true });
    standaloneWindow.setFrame(400, 680);
    detachedLoaded = true;
  }
  standaloneWindow.open();
}
function action(value: unknown): void {
  if (!object(value)) return;
  try {
    switch (value.type) {
      case "play": case "continue":
        if (typeof value.id === "string") play(value.id, value.type === "continue");
        break;
      case "toggle-playback":
        if (typeof value.id === "string") togglePlayback(value.id);
        break;
      case "seek":
        if (typeof value.id === "string" && activePath && session && value.id === mediaId(activePath) &&
            currentPath() === activePath && typeof value.position === "number" && Number.isFinite(value.position)) {
          const duration = mpv.number("duration");
          if (duration <= 0) break;
          const position = Math.max(0, Math.min(value.position, duration));
          iina.mpv.command("seek", [String(position), "absolute+exact"]);
          if (seekTimer) clearTimeout(seekTimer);
          seekTimer = setTimeout(() => { seekTimer = undefined; sample(true); }, 200);
        }
        break;
      case "reveal-file":
        if (typeof value.id === "string" && itemsById.has(value.id)) iina.file.showInFinder(itemsById.get(value.id)!.path);
        break;
      case "complete": case "reset":
        if (typeof value.id === "string" && items.some(item => item.id === value.id))
          globalAPI.postMessage(MSG.mark, { id: value.id, completed: value.type === "complete" });
        break;
      case "threshold": globalAPI.postMessage(MSG.settings, { threshold: value.value }); break;
      case "save-interval": globalAPI.postMessage(MSG.settings, { saveIntervalSeconds: value.value }); break;
      case "locate-current":
        if (activePath) { selectedFolder = folderPath(activePath); syncPlaylist(); }
        break;
      case "folder":
        if (typeof value.path === "string" && folders.some(folder => folder.path === value.path)) {
          selectedFolder = value.path;
          syncPlaylist();
        }
        break;
      case "refresh": syncPlaylist(true); break;
      case "detach": detach(); break;
      case "reveal-data": iina.file.showInFinder("@data/"); break;
    }
  } catch (error) { scanError = String(error); postView(); }
}
function bindView(view: IINA.API.SidebarView | IINA.API.StandaloneWindow, detached: boolean): void {
  // loadFile clears message listeners, so register after loading the HTML.
  onNativeMessage(view, MSG.ready, () => {
    if (detached) detachedReady = true;
    else sidebarReady = true;
    if (!listed) syncPlaylist();
    postView(view);
  });
  onNativeMessage(view, MSG.action, action);
}

onNativeMessage(globalAPI, MSG.records, (wire: unknown) => {
  let data: RecordsMessage;
  try {
    data = (typeof wire === "string" ? JSON.parse(wire) : wire) as RecordsMessage;
    if (!data || !Array.isArray(data.videos) || !data.settings || !data.storage)
      throw new Error("观看记录消息格式无效");
  } catch (error) {
    storage = { ...storage, error: `无法读取观看记录消息：${String(error)}` };
    postPatch();
    return;
  }
  if (data.scope !== undefined && data.scope !== scope) return;
  connected = true;
  settings = data.settings;
  storage = data.storage;
  if (data.kind !== "patch") videosById.clear();
  const changed: VideoRecord[] = [];
  for (const record of data.videos) if (itemsById.has(record.id)) {
    videosById.set(record.id, record);
    changed.push(record);
  }
  if (data.kind === "patch") postPatch(changed);
  else postView();
});
onNativeMessage(globalAPI, MSG.reset, () => {
  if (!session) return;
  iina.mpv.set("pause", true);
  iina.mpv.command("seek", ["0", "absolute+exact"]);
  // An immediate paused zero sample acknowledges reset once the seek settles.
  setTimeout(() => sample(true), 150);
});
function initializeWindow(): void {
  if (windowLoaded) return;
  sidebar.loadFile("ui/sidebar/index.html");
  windowLoaded = true;
  bindView(sidebar, false);
  syncPlaylist();
}
iina.event.on("iina.window-loaded", initializeWindow);
iina.event.on("mpv.start-file", () => { endSession(); });
iina.event.on("iina.file-loaded", fileLoaded);
iina.event.on("mpv.playback-restart", () => { seekPending(); sample(); });
iina.event.on("iina.file-started", seekPending);
iina.event.on("mpv.pause.changed", () => { sample(mpv.flag("pause", true)); postPatch(); });
iina.event.on("mpv.duration.changed", () => sample());
iina.event.on("mpv.speed.changed", () => sample());
iina.event.on("mpv.video-reconfig", () => { refreshMedia(); postPatch(); });
iina.event.on("mpv.eof-reached.changed", () => {
  if (mpv.flag("eof-reached")) sample(true, true);
});
iina.event.on("mpv.end-file", () => { endSession(); scheduleSync(); });
// Unlike end-file, this hook runs while the old file's final properties still exist.
iina.mpv.addHook("on_unload", 50, () => {
  sample(true, mpv.flag("eof-reached"));
});
iina.event.on("mpv.playlist-count.changed", scheduleSync);
iina.event.on("mpv.playlist-pos.changed", scheduleSync);
// Observing the whole playlist also catches same-length replacement and reordering.
iina.event.on("mpv.playlist.changed", scheduleSync);
iina.event.on("iina.window-will-close", () => {
  sample(true);
  sidebarReady = false;
  detachedReady = false;
  endSession();
  closing = true;
  connected = false;
  listed = false;
  pendingResume = undefined;
  if (detachedLoaded) standaloneWindow.close();
  globalAPI.postMessage(MSG.disconnect, {});
});
iina.event.on("mpv.shutdown", () => {
  // Never query mpv during shutdown; only flush the global instance's cached data.
  closing = true;
  connected = false;
  listed = false;
  sidebarReady = false;
  detachedReady = false;
  if (session) globalAPI.postMessage(MSG.end, { session });
  session = undefined;
  activePath = undefined;
  globalAPI.postMessage(MSG.disconnect, {});
});
iina.menu.addItem(iina.menu.item("显示观看进度", () => { if (windowLoaded) sidebar.show(); }));
iina.menu.addItem(iina.menu.item("独立观看列表", detach));
// Enabling/reloading a plugin in an existing player does not replay window-loaded
// or file-loaded. Reattach without opening or seeking the user's file.
setTimeout(() => {
  if (closing || !currentPath()) return;
  initializeWindow();
  if (!session) fileLoaded();
}, 1000);
setInterval(() => {
  if (closing) return;
  // Paused seeks are handled by playback-restart, duration and pause events.
  if (!mpv.flag("pause", true)) sample();
  if (!connected && windowLoaded) syncPlaylist();
}, 1000);
