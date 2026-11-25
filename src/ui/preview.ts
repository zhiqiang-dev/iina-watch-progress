import { MSG, type ViewState, type ViewSnapshot, type UIAction } from "../messaging/message-bus";
import { createRecord, markCompleted, resetRecord, updateProgress } from "../core/progress-engine";
import { mediaId } from "../core/media-identity";
import { DEFAULT_SETTINGS } from "../models/settings";

const folder = "/视频课程";
const names = ["课程导论", "基础理论", "核心知识", "专题讲解", "案例分析", "综合应用", "强化练习", "课程总结"];
const durations = [1530, 2538, 2300, 2712, 1960, 3010, 1695, 1110];
const params = new URLSearchParams(location.search);
const count = params.has("empty") ? 0 : Math.min(10000, Math.max(8, Number(params.get("count")) || 8));
const videos = Array.from({ length: count }, (_, index) => {
  const record = createRecord(`${folder}/${String(index + 1).padStart(2, "0")}. ${names[index] ?? `视频 ${index + 1}`}.mp4`, Date.now());
  record.duration = durations[index] ?? 1800;
  if (index < 3) return markCompleted(record, Date.now());
  if (index < 5) {
    record.progress = index === 3 ? 0.65 : 0.23;
    record.position = record.maxPosition = record.duration * record.progress;
    record.status = "watching";
    record.watchedTime = record.position;
    record.lastPlayedAt = Date.now() - index * 1000;
    record.playCount = 1;
  }
  return record;
});
const previewState: ViewSnapshot = { kind: "snapshot", scope: 1, paused: !params.has("live"), videos, items: videos.map((record, playlistIndex) => ({ id: record.id, path: record.filePath, playlistIndex })),
  folders: count ? [{ path: folder, name: "视频课程" }] : [], selectedFolder: count ? folder : undefined,
  activeId: count ? mediaId(`${folder}/04. 专题讲解.mp4`) : undefined,
  settings: { ...DEFAULT_SETTINGS }, storage: { readOnly: false, dirty: false, recovered: false, lastSavedAt: Date.now() } };
let render: ((state: ViewState) => void) | undefined;
function patch(changes: typeof videos = []): void {
  render?.({ kind: "patch", scope: 1, videos: changes, settings: previewState.settings, storage: previewState.storage,
    activeId: previewState.activeId ?? null, paused: previewState.paused ?? true, scanError: null });
}
window.wpPreview = true;
window.iina = {
  onMessage(name, handler) { if (name === MSG.view) render = handler; },
  postMessage(name, data) {
    if (name === MSG.ready) { render?.(previewState); return; }
    if (name !== MSG.action) return;
    const action = data as UIAction;
    if ("id" in action) {
      const index = previewState.videos.findIndex(record => record.id === action.id);
      const record = previewState.videos[index];
      if (record) {
        if (action.type === "complete") previewState.videos[index] = markCompleted(record, Date.now());
        else if (action.type === "reset") {
          previewState.videos[index] = resetRecord(record, Date.now());
          if (previewState.activeId === action.id) previewState.paused = true;
        } else if (action.type === "play" || action.type === "continue") { previewState.activeId = action.id; previewState.paused = false; }
        else if (action.type === "toggle-playback") {
          previewState.paused = previewState.activeId === action.id ? !previewState.paused : false;
          previewState.activeId = action.id;
        }
        patch([previewState.videos[index]!]);
      }
    } else if (action.type === "threshold") { previewState.settings.completionThreshold = action.value; patch(); }
    else if (action.type === "save-interval") { previewState.settings.saveIntervalSeconds = action.value; patch(); }
    else if (action.type === "refresh") render?.(previewState);
  },
};
if (params.has("live")) setInterval(() => {
  if (previewState.paused) return;
  const index = previewState.videos.findIndex(record => record.id === previewState.activeId);
  const record = previewState.videos[index];
  if (!record) return;
  const next = updateProgress(record, { position: record.position + 1, duration: record.duration,
    watchedSeconds: 1, firstPlayback: false, eof: false, now: Date.now() }, previewState.settings.completionThreshold);
  previewState.videos[index] = next; patch([next]);
}, 1000);
