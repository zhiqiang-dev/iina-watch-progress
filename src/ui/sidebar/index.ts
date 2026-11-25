import { MSG, type ViewState, type ViewSnapshot, type UIAction } from "../../messaging/message-bus";
import { VideoListModel, type VideoFilter, type VideoSort } from "../video-list-model";
import { VirtualVideoList, ROW_HEIGHT, formatTime as time } from "./virtual-list";

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
function send(action: UIAction): void { window.iina?.postMessage(MSG.action, action); }
function updateRows(): void { virtual.update({ selectedId, activeId: state?.activeId, paused: state?.paused ?? true }); }
function renderSelection(): void {
  const record = selectedId ? model.records.get(selectedId) : undefined;
  el("selection").hidden = !record;
  if (!record) return;
  const percent = Math.floor(record.progress * 100);
  text("selected-name", record.fileName); el("selected-name").title = record.filePath;
  text("selected-percent", `${percent}%`); width("selected-progress", `${percent}%`);
  text("selected-position", `${time(record.position)} / ${time(record.duration, true)}`);
  text("selected-source", record.status === "completed" ? record.completionSource === "manual" ? "手动完成" : "自动完成" : record.status === "watching" ? "观看中" : "未观看");
  disable("complete-selected", record.status === "completed" || !!state?.storage.readOnly); disable("reset-selected", !!state?.storage.readOnly);
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
  if (next.kind === "patch") {
    if (!state || (next.scope !== undefined && next.scope !== state.scope)) return;
    state = { ...state, storage: next.storage, settings: next.settings, activeId: next.activeId ?? undefined, paused: next.paused, scanError: next.scanError ?? undefined };
    model.apply(next.videos);
  } else {
    if (state?.selectedFolder !== next.selectedFolder) { selectedId = undefined; list.scrollTop = 0; }
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
  if (!selectedId || !model.records.has(selectedId)) selectedId = state.activeId && model.records.has(state.activeId) ? state.activeId : model.ids[0];
  renderOverview(); renderListState();
}
function updateQuery(): void { model.setQuery(filter, search, sort); list.scrollTop = 0; renderListState(); }
list.addEventListener("click", event => {
  const target = event.target as HTMLElement, row = target.closest<HTMLElement>(".video-row");
  if (!row?.dataset.id) return;
  selectedId = row.dataset.id; list.focus({ preventScroll: true }); updateRows(); renderSelection();
  if (target.closest(".row-icon")) send({ type: "toggle-playback", id: selectedId });
});
list.addEventListener("dblclick", event => {
  const target = event.target as HTMLElement;
  if (target.closest(".row-icon")) return;
  const id = target.closest<HTMLElement>(".video-row")?.dataset.id;
  if (id) send({ type: "play", id });
});
list.addEventListener("keydown", event => {
  if ((event.key === "Enter" || event.key === " ") && selectedId) {
    event.preventDefault(); send({ type: event.key === " " ? "toggle-playback" : "play", id: selectedId }); return;
  }
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) || !model.ids.length) return;
  event.preventDefault();
  const current = selectedId ? model.ids.indexOf(selectedId) : -1;
  const index = event.key === "Home" ? 0 : event.key === "End" ? model.ids.length - 1 : Math.max(0, Math.min(model.ids.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
  selectedId = model.ids[index];
  if (index * ROW_HEIGHT < list.scrollTop) list.scrollTop = index * ROW_HEIGHT;
  else if ((index + 1) * ROW_HEIGHT > list.scrollTop + list.clientHeight) list.scrollTop = (index + 1) * ROW_HEIGHT - list.clientHeight;
  updateRows(); renderSelection();
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-filter]")) button.addEventListener("click", () => {
  filter = button.dataset.filter as VideoFilter;
  for (const sibling of document.querySelectorAll("[data-filter]")) sibling.setAttribute("aria-selected", String(sibling === button));
  updateQuery();
});
el("search").addEventListener("input", event => { search = (event.target as HTMLInputElement).value; updateQuery(); });
el("sort").addEventListener("change", event => { sort = (event.target as HTMLSelectElement).value as VideoSort; updateQuery(); });
el("continue").addEventListener("click", () => { if (model.continueRecord) send({ type: "continue", id: model.continueRecord.id }); });
el("play-selected").addEventListener("click", () => { if (selectedId) send({ type: "play", id: selectedId }); });
el("complete-selected").addEventListener("click", () => { if (selectedId) send({ type: "complete", id: selectedId }); });
el("reset-selected").addEventListener("click", () => { if (selectedId) send({ type: "reset", id: selectedId }); });
el("folder").addEventListener("change", event => send({ type: "folder", path: (event.target as HTMLSelectElement).value }));
el("threshold").addEventListener("change", event => send({ type: "threshold", value: Number((event.target as HTMLSelectElement).value) }));
el("refresh").addEventListener("click", () => send({ type: "refresh" }));
el("detach").addEventListener("click", () => send({ type: "detach" }));
el("reveal-data").addEventListener("click", () => send({ type: "reveal-data" }));
if (window.wpPreview) el("preview-label").hidden = false;
if (window.iina) { window.iina.onMessage(MSG.view, render); window.iina.postMessage(MSG.ready, {}); }
else { text("storage-status", "请在 IINA 中打开插件，或运行 pnpm preview"); el("empty").hidden = false; list.hidden = true; }
