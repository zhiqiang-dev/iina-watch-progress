import { MSG, type ViewState, type ViewSnapshot, type UIAction, type MediaInfo } from "../../messaging/message-bus";
import { VideoListModel, type VideoFilter, type VideoSort } from "../video-list-model";
import { VirtualVideoList, formatTime as time } from "./virtual-list";
import { DEFAULT_SAVE_INTERVAL } from "../../models/settings";
import { BrowseStateStore, DEFAULT_BROWSE, captureAnchor, restoreAnchor, type BrowseState } from "../browse-state";
import { positionRatio, remainingTime } from "../progress-presentation";

interface WebViewBridge {
  postMessage(name: string, data?: unknown): void;
  onMessage(name: string, handler: (data: ViewState) => void): void;
}
declare global { interface Window { iina?: WebViewBridge; wpPreview?: boolean; } }
function el<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(id)! as T; }
function text(id: string, value: string): void { const node = el(id); if (node.textContent !== value) node.textContent = value; }
function width(id: string, value: string): void { const node = el(id); if (node.style.width !== value) node.style.width = value; }
function disable(id: string, value: boolean): void { const node = el<HTMLButtonElement>(id); if (node.disabled !== value) node.disabled = value; }
const list = el("list"), model = new VideoListModel();
if (window.wpPreview && new URLSearchParams(location.search).has("benchmark")) list.dataset.benchmark = "true";
const virtual = new VirtualVideoList(list, el("list-content"), model);
const completedCount = el("completed").firstChild!, completedTotal = el("completed").querySelector("small")!, rateCount = el("rate").firstChild!;
let state: ViewSnapshot | undefined;
let selectedId: string | undefined;
let filter: VideoFilter = "all", search = "", sort: VideoSort = "name", folderKey = "";
let density: BrowseState["density"] = "comfortable";
const mediaCache = new Map<string, MediaInfo>();
const browseStore = new BrowseStateStore((() => { try { return window.localStorage; } catch { return undefined; } })());
let follow = true, lastActiveId: string | undefined, pendingFollow: string | undefined, locateRequested = false;
let pendingRestore: BrowseState | undefined, rememberTimer: number | undefined;
let locateBlocked = false, revealedQuery: { filter: VideoFilter; search: string; sort: VideoSort } | undefined;
function rememberNow(): void {
  if (rememberTimer !== undefined) window.clearTimeout(rememberTimer); rememberTimer = undefined;
  if (!state?.selectedFolder || !model.total || pendingRestore) return;
  browseStore.set(state.selectedFolder, { filter, search, sort, selectedId, follow, density,
    ...captureAnchor(model.ids, list.scrollTop, virtual.rowHeight) });
}
function rememberSoon(): void {
  if (rememberTimer !== undefined) window.clearTimeout(rememberTimer);
  rememberTimer = window.setTimeout(rememberNow, 600);
}
function queryControls(): void {
  el<HTMLInputElement>("search").value = search; el<HTMLSelectElement>("sort").value = sort;
  el<HTMLSelectElement>("density").value = density;
  for (const button of document.querySelectorAll<HTMLElement>("[data-filter]")) button.setAttribute("aria-selected", String(button.dataset.filter === filter));
}
function renderNavigation(): void {
  const active = state?.activeId ? model.records.get(state.activeId) : undefined;
  text("current-name", active ? `${state?.paused ? "已暂停" : "正在播放"} · ${active.fileName}` : state?.activeId ? "当前视频在其他文件夹" : "尚未播放视频");
  el("current-name").title = active?.filePath ?? ""; disable("locate-current", !state?.activeId);
  text("follow-current", follow ? "跟随开" : "跟随关"); el("follow-current").setAttribute("aria-pressed", String(follow));
  if (state?.activeId && model.ids.includes(state.activeId)) locateBlocked = false;
  el("locate-notice").hidden = !locateBlocked && !revealedQuery;
  text("locate-hint", revealedQuery ? "正在临时显示当前视频，原筛选已保留。" : "当前视频被搜索或状态筛选隐藏。");
  el("reveal-current").hidden = !!revealedQuery; el("restore-query").hidden = !revealedQuery;
}
function pauseFollow(): void { follow = false; pendingFollow = undefined; renderNavigation(); rememberSoon(); }
function locateCurrent(explicit = true): void {
  const id = state?.activeId; if (!id) return;
  if (explicit) follow = true;
  if (!model.records.has(id)) { locateRequested = true; send({ type: "locate-current" }); return; }
  const index = model.ids.indexOf(id);
  if (index < 0) { locateBlocked = true; renderNavigation(); return; }
  selectedId = id; virtual.reveal(index); renderSelection(); updateRows(); renderNavigation(); rememberSoon();
}
function send(action: UIAction): void { window.iina?.postMessage(MSG.action, action); }
function updateRows(): void { virtual.update({ selectedId, activeId: state?.activeId, paused: state?.paused ?? true }); }
function renderSelection(): void {
  const record = selectedId ? model.records.get(selectedId) : undefined;
  el("selection").hidden = !record;
  if (!record) return;
  const percent = Math.floor(record.progress * 100);
  text("selected-name", record.fileName); el("selected-name").title = record.filePath;
  text("selected-percent", record.status === "completed" ? "已完成" : `最远 ${percent}%`);
  const seek = el<HTMLInputElement>("selected-seek");
  if (seek.dataset.scrubbing !== "true") {
    el("selected-track").dataset.jumping = String(Math.abs(record.position - Number(seek.value)) > 3);
    el("selected-track").style.setProperty("--history", `${percent}%`);
    el("selected-track").style.setProperty("--position", `${positionRatio(record.position, record.duration) * 100}%`);
    text("selected-position", `${time(record.position)} / ${time(record.duration, true)} · ${remainingTime(record.position, record.duration)}`);
    seek.max = String(Math.max(1, record.duration)); seek.value = String(record.position);
    seek.setAttribute("aria-valuetext", `${time(record.position)} / ${time(record.duration, true)}`);
  }
  seek.disabled = state?.activeId !== record.id || record.duration <= 0;
  seek.title = seek.disabled ? "播放此视频后可调整位置" : "拖动预览，松开跳转";
  text("selected-source", record.status === "completed" ? record.completionSource === "manual" ? "手动完成" : "自动完成" : record.status === "watching" ? "观看中" : "未观看");
  disable("complete-selected", record.status === "completed" || !!state?.storage.readOnly); disable("reset-selected", !!state?.storage.readOnly);
  const media = mediaCache.get(record.id);
  text("selected-resolution", media?.width && media.height ? `${media.width} × ${media.height}` : "播放后获取");
  text("selected-codec", media?.codec || "—"); text("selected-watched", time(record.watchedTime));
  text("selected-plays", `${record.playCount} 次`); text("selected-recent", record.lastPlayedAt ? new Date(record.lastPlayedAt).toLocaleString() : "尚未观看");
  text("selected-path", record.filePath);
}
function renderOverview(): void {
  if (!state) return;
  const rate = model.total ? model.completed / model.total : 0;
  const number = String(model.completed), total = `/${model.total}`, rateText = String(Math.round(rate * 1000) / 10);
  if (completedCount.nodeValue !== number) completedCount.nodeValue = number;
  if (completedTotal.textContent !== total) completedTotal.textContent = total;
  text("watching", String(model.watching));
  if (rateCount.nodeValue !== rateText) rateCount.nodeValue = rateText;
  width("overall-progress", `${rate * 100}%`);
  const latest = model.continueRecord;
  disable("continue", !latest);
  text("continue-label", latest?.lastPlayedAt ? "继续观看" : latest ? "开始观看" : model.total ? "全部已看完" : "继续观看");
  text("continue-hint", latest ? `${latest.fileName}${latest.position > 0 ? ` · ${time(latest.position)}` : ""}` : model.total ? "这个文件夹的所有视频均已完成" : "打开视频文件夹，开始记录观看进度");
  const notice = [state.storage.error, state.scanError, state.storage.recovered ? "已从有效快照恢复记录。" : undefined].filter(Boolean).join(" ");
  el("notice").hidden = !notice; text("notice", notice);
  text("storage-status", state.storage.readOnly ? "记录只读" : state.storage.error ? "记录未保存" : state.storage.dirty ? "等待保存…" : state.storage.lastSavedAt ? "观看记录已保存" : "尚无观看记录");
  const threshold = el<HTMLSelectElement>("threshold"), value = String(state.settings.completionThreshold);
  if (threshold.value !== value) threshold.value = value;
  threshold.disabled = state.storage.readOnly;
  const interval = el<HTMLSelectElement>("save-interval"), seconds = state.settings.saveIntervalSeconds ?? DEFAULT_SAVE_INTERVAL;
  if (interval.value !== String(seconds)) interval.value = String(seconds);
  interval.disabled = state.storage.readOnly;
  text("save-hint", `仅有变化时写入。暂停、切换和手动操作立即保存；异常退出可能丢失最近约 ${seconds} 秒的进度。`);
}
function renderListState(): void {
  const count = model.ids.length;
  text("list-count", `${count} 个视频${count !== model.total ? ` / 共 ${model.total} 个` : ""}`);
  list.hidden = count === 0; el("empty").hidden = count > 0;
  text("empty-title", model.total ? "没有匹配的视频" : "还没有视频");
  text("empty-description", model.total ? "试试其他文件名，或切换观看状态。" : "在 IINA 中打开本地视频或文件夹，观看记录会自动出现在这里。");
  updateRows(); renderSelection();
}
function render(next: ViewState): void {
  let restoredFolder = false;
  if (next.media) {
    mediaCache.set(next.media.id, next.media);
    if (mediaCache.size > 100) mediaCache.delete(mediaCache.keys().next().value!);
  }
  if (next.kind === "patch") {
    if (!state || (next.scope !== undefined && next.scope !== state.scope)) return;
    state = { ...state, storage: next.storage, settings: next.settings, activeId: next.activeId ?? undefined, paused: next.paused, scanError: next.scanError ?? undefined };
    model.apply(next.videos);
  } else {
    if (state?.selectedFolder !== next.selectedFolder) {
      rememberNow();
      const saved = next.selectedFolder ? browseStore.get(next.selectedFolder) : undefined;
      const browsing = saved ?? DEFAULT_BROWSE;
      selectedId = browsing.selectedId; filter = browsing.filter; search = browsing.search; sort = browsing.sort; follow = browsing.follow; density = browsing.density;
      virtual.setDensity(density);
      pendingRestore = saved; restoredFolder = !!saved; pendingFollow = undefined;
      revealedQuery = undefined; locateBlocked = false; list.scrollTop = 0;
      model.setQuery(filter, search, sort); queryControls();
    }
    state = next;
    const ids = new Set(next.items.map(item => item.id));
    model.replace(next.videos.filter(record => ids.has(record.id)));
    text("folder-title", next.selectedFolder ? next.folders.find(folder => folder.path === next.selectedFolder)?.name ?? "视频课程" : "视频课程");
    el("folder-title").title = next.selectedFolder ?? "";
    const key = JSON.stringify(next.folders);
    if (key !== folderKey) {
      folderKey = key;
      el<HTMLSelectElement>("folder").replaceChildren(...next.folders.map(folder => {
        const option = document.createElement("option"); option.value = folder.path; option.textContent = folder.path; return option;
      }));
    }
    el<HTMLSelectElement>("folder").value = next.selectedFolder ?? ""; el<HTMLSelectElement>("folder").disabled = next.folders.length < 2;
  }
  if (model.total && (!selectedId || !model.records.has(selectedId))) selectedId = state.activeId && model.records.has(state.activeId) ? state.activeId : model.ids[0];
  if (state.activeId && state.activeId !== lastActiveId) {
    lastActiveId = state.activeId;
    if (follow && !restoredFolder && !pendingRestore) pendingFollow = state.activeId;
  }
  renderOverview(); renderListState(); renderNavigation();
  if (pendingRestore && model.total) { virtual.scrollTo(restoreAnchor(model.ids, pendingRestore, virtual.rowHeight)); pendingRestore = undefined; }
  if (locateRequested && state.activeId && model.records.has(state.activeId)) { locateRequested = false; locateCurrent(); }
  else if (pendingFollow && model.records.has(pendingFollow)) { pendingFollow = undefined; locateCurrent(false); }
}
function updateQuery(manual = true): void {
  if (manual) { pauseFollow(); revealedQuery = undefined; }
  model.setQuery(filter, search, sort); virtual.scrollTo(0); queryControls(); renderListState(); renderNavigation(); rememberSoon();
}
list.addEventListener("wheel", pauseFollow, { passive: true });
list.addEventListener("touchmove", pauseFollow, { passive: true });
list.addEventListener("scroll", rememberSoon, { passive: true });
window.addEventListener("pagehide", rememberNow);
list.addEventListener("click", event => {
  const target = event.target as HTMLElement, row = target.closest<HTMLElement>(".video-row");
  if (target.closest(".row-seek")) return;
  if (!row?.dataset.id) return;
  selectedId = row.dataset.id; list.focus({ preventScroll: true }); updateRows(); renderSelection();
  rememberSoon();
  if (target.closest(".row-icon")) send({ type: "toggle-playback", id: selectedId });
});
list.addEventListener("dblclick", event => {
  const target = event.target as HTMLElement;
  if (target.closest(".row-icon,.row-seek")) return;
  const id = target.closest<HTMLElement>(".video-row")?.dataset.id;
  if (id) send({ type: "play", id });
});
list.addEventListener("keydown", event => {
  if ((event.target as HTMLElement).matches("input[type=range]")) return;
  if ((event.key === "Enter" || event.key === " ") && selectedId) {
    event.preventDefault(); send({ type: event.key === " " ? "toggle-playback" : "play", id: selectedId }); return;
  }
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) || !model.ids.length) return;
  pauseFollow();
  event.preventDefault();
  const current = selectedId ? model.ids.indexOf(selectedId) : -1;
  const index = event.key === "Home" ? 0 : event.key === "End" ? model.ids.length - 1 : Math.max(0, Math.min(model.ids.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
  selectedId = model.ids[index];
  if (index * virtual.rowHeight < list.scrollTop) virtual.scrollTo(index * virtual.rowHeight);
  else if ((index + 1) * virtual.rowHeight > list.scrollTop + list.clientHeight) virtual.scrollTo((index + 1) * virtual.rowHeight - list.clientHeight);
  updateRows(); renderSelection(); rememberSoon();
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-filter]")) button.addEventListener("click", () => {
  filter = button.dataset.filter as VideoFilter;
  for (const sibling of document.querySelectorAll("[data-filter]")) sibling.setAttribute("aria-selected", String(sibling === button));
  updateQuery();
});
el("search").addEventListener("input", event => { search = (event.target as HTMLInputElement).value; updateQuery(); });
el("sort").addEventListener("change", event => { sort = (event.target as HTMLSelectElement).value as VideoSort; updateQuery(); });
el("density").addEventListener("change", event => {
  const anchor = captureAnchor(model.ids, list.scrollTop, virtual.rowHeight);
  density = (event.target as HTMLSelectElement).value as BrowseState["density"]; virtual.setDensity(density);
  virtual.scrollTo(restoreAnchor(model.ids, anchor, virtual.rowHeight)); rememberSoon();
});
function seekTarget(target: EventTarget | null): { input: HTMLInputElement; id: string } | undefined {
  if (!(target instanceof HTMLInputElement) || !target.matches(".row-seek,#selected-seek") || target.disabled) return;
  const id = target.id === "selected-seek" ? selectedId : target.closest<HTMLElement>(".video-row")?.dataset.id;
  return id ? { input: target, id } : undefined;
}
document.addEventListener("input", event => {
  const target = seekTarget(event.target); if (!target) return;
  const position = Number(target.input.value); target.input.dataset.scrubbing = "true";
  virtual.previewPosition(target.id, position);
  if (selectedId === target.id) {
    const record = model.records.get(target.id)!;
    el("selected-track").style.setProperty("--position", `${positionRatio(position, record.duration) * 100}%`);
    el("selected-track").dataset.jumping = "true";
    text("selected-position", `${time(position)} / ${time(record.duration)} · ${remainingTime(position, record.duration)}`);
  }
});
document.addEventListener("change", event => {
  const target = seekTarget(event.target); if (!target) return;
  delete target.input.dataset.scrubbing;
  send({ type: "seek", id: target.id, position: Number(target.input.value) });
});
document.addEventListener("pointercancel", event => {
  const target = seekTarget(event.target); if (!target) return;
  delete target.input.dataset.scrubbing; updateRows(); renderSelection();
});
document.addEventListener("pointermove", event => {
  const target = seekTarget(event.target); if (!target) return;
  const bounds = target.input.getBoundingClientRect();
  const seconds = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)) * Number(target.input.max);
  target.input.title = time(seconds);
});
el("locate-current").addEventListener("click", () => locateCurrent());
el("follow-current").addEventListener("click", () => { follow = !follow; if (follow) locateCurrent(false); renderNavigation(); rememberSoon(); });
el("reveal-current").addEventListener("click", () => {
  revealedQuery = { filter, search, sort }; filter = "all"; search = "";
  updateQuery(false); locateCurrent();
});
el("restore-query").addEventListener("click", () => {
  if (!revealedQuery) return;
  ({ filter, search, sort } = revealedQuery); revealedQuery = undefined; updateQuery();
});
el("continue").addEventListener("click", () => { if (model.continueRecord) send({ type: "continue", id: model.continueRecord.id }); });
el("play-selected").addEventListener("click", () => { if (selectedId) send({ type: "play", id: selectedId }); });
el("complete-selected").addEventListener("click", () => { if (selectedId) send({ type: "complete", id: selectedId }); });
el("reset-selected").addEventListener("click", () => { if (selectedId) send({ type: "reset", id: selectedId }); });
el("folder").addEventListener("change", event => send({ type: "folder", path: (event.target as HTMLSelectElement).value }));
el("threshold").addEventListener("change", event => send({ type: "threshold", value: Number((event.target as HTMLSelectElement).value) }));
el("save-interval").addEventListener("change", event => send({ type: "save-interval", value: Number((event.target as HTMLSelectElement).value) }));
el("refresh").addEventListener("click", () => send({ type: "refresh" }));
el("detach").addEventListener("click", () => send({ type: "detach" }));
el("reveal-data").addEventListener("click", () => send({ type: "reveal-data" }));
el("reveal-file").addEventListener("click", () => { if (selectedId) send({ type: "reveal-file", id: selectedId }); });
if (window.wpPreview) el("preview-label").hidden = false;
if (window.iina) { window.iina.onMessage(MSG.view, render); window.iina.postMessage(MSG.ready, {}); }
else { text("storage-status", "请在 IINA 中打开插件，或运行 pnpm preview"); el("empty").hidden = false; list.hidden = true; }
