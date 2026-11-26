import type { VideoRecord } from "../../models/video-record";
import type { VideoListModel } from "../video-list-model";
import { formatTime, positionRatio, recentTime, remainingTime, progressDescription } from "../progress-presentation";
export { formatTime } from "../progress-presentation";

export const ROW_HEIGHT = 88, COMPACT_ROW_HEIGHT = 68;
const OVERSCAN = 3;
interface Row {
  element: HTMLDivElement; button: HTMLButtonElement; title: HTMLDivElement; badge: HTMLSpanElement;
  position: HTMLSpanElement; recent: HTMLSpanElement; track: HTMLDivElement; seek: HTMLInputElement;
  status: HTMLSpanElement; signature: string;
}
export interface PlaybackView { selectedId?: string; activeId?: string; paused: boolean; }

/** Reuse rows by file identity; collapse scroll and progress events to one frame. */
export class VirtualVideoList {
  private rows = new Map<string, Row>();
  private frame?: number;
  private nextRow = 0;
  private visible = !document.hidden;
  private flags: PlaybackView = { paused: true };
  private readonly resize: ResizeObserver;
  rowHeight = ROW_HEIGHT;
  readonly metrics = { frames: 0, created: 0, patched: 0 };
  constructor(private readonly viewport: HTMLElement, private readonly content: HTMLElement, private readonly model: VideoListModel) {
    viewport.addEventListener("scroll", () => this.schedule(), { passive: true });
    this.resize = new ResizeObserver(() => this.schedule()); this.resize.observe(viewport);
  }
  update(flags: PlaybackView, changedIds?: string[]): void {
    const flagsChanged = flags.selectedId !== this.flags.selectedId || flags.activeId !== this.flags.activeId || flags.paused !== this.flags.paused;
    this.flags = flags;
    if (flagsChanged || changedIds === undefined || changedIds.some(id => this.rows.has(id))) this.schedule();
  }
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!visible && this.frame !== undefined) { cancelAnimationFrame(this.frame); this.frame = undefined; }
    if (visible) this.schedule();
  }
  setDensity(density: "comfortable" | "compact"): void {
    this.rowHeight = density === "compact" ? COMPACT_ROW_HEIGHT : ROW_HEIGHT;
    this.viewport.dataset.density = density; this.schedule();
  }
  scrollTo(top: number): void {
    this.content.style.height = `${this.model.ids.length * this.rowHeight}px`;
    this.viewport.scrollTop = Math.max(0, top); this.schedule();
  }
  reveal(index: number): void { this.scrollTo(index * this.rowHeight - (this.viewport.clientHeight - this.rowHeight) / 2); }
  setScrubbing(id: string, scrubbing: boolean): void {
    const row = this.rows.get(id); if (!row) return;
    if (scrubbing) row.seek.dataset.scrubbing = "true";
    else { delete row.seek.dataset.scrubbing; row.signature = ""; this.schedule(); }
  }
  previewPosition(id: string, position: number): void {
    const row = this.rows.get(id), record = this.model.records.get(id);
    if (!row || !record) return;
    row.track.dataset.jumping = "true";
    row.track.style.setProperty("--position", `${positionRatio(position, record.duration) * 100}%`);
    row.position.textContent = `${formatTime(position)} / ${formatTime(record.duration, true)} · ${remainingTime(position, record.duration)}`;
    row.seek.setAttribute("aria-valuetext", `${formatTime(position)} / ${formatTime(record.duration)}`);
  }
  private schedule(): void {
    if (!this.visible || this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => { this.frame = undefined; this.render(); });
  }
  private render(): void {
    this.metrics.frames++;
    const ids = this.model.ids, height = `${ids.length * this.rowHeight}px`;
    if (this.content.style.height !== height) this.content.style.height = height;
    const visible = Math.ceil(this.viewport.clientHeight / this.rowHeight);
    const first = Math.max(0, Math.min(ids.length - visible, Math.floor(this.viewport.scrollTop / this.rowHeight)));
    const start = Math.max(0, first - OVERSCAN), end = Math.min(ids.length, first + visible + OVERSCAN);
    const wanted = new Set(ids.slice(start, end));
    for (const [id, row] of this.rows) if (!wanted.has(id) && row.seek.dataset.scrubbing !== "true") { row.element.remove(); this.rows.delete(id); }
    let cursor = this.content.firstElementChild;
    for (let index = start; index < end; index++) {
      const id = ids[index]!;
      let row = this.rows.get(id);
      if (!row) { row = this.createRow(id); this.rows.set(id, row); }
      this.patch(row, this.model.records.get(id)!, index, ids.length);
      if (row.element !== cursor) this.content.insertBefore(row.element, cursor);
      else cursor = cursor.nextElementSibling;
    }
    const selected = this.flags.selectedId ? this.rows.get(this.flags.selectedId) : undefined;
    if (selected) this.viewport.setAttribute("aria-activedescendant", selected.element.id);
    else this.viewport.removeAttribute("aria-activedescendant");
    if (this.viewport.dataset.benchmark === "true") {
      this.viewport.dataset.created = String(this.metrics.created); this.viewport.dataset.patched = String(this.metrics.patched);
      this.viewport.dataset.frames = String(this.metrics.frames); this.viewport.dataset.sorts = String(this.model.fullSorts);
      this.viewport.dataset.moves = String(this.model.moves);
    }
  }
  private createRow(id: string): Row {
    this.metrics.created++;
    const element = document.createElement("div"); element.className = "video-row";
    element.id = `video-row-${this.nextRow++}`; element.dataset.id = id; element.setAttribute("role", "option");
    const button = document.createElement("button"); button.className = "row-icon"; button.type = "button"; button.tabIndex = -1;
    const body = document.createElement("div"); body.className = "row-content";
    const heading = document.createElement("div"); heading.className = "row-heading";
    const title = document.createElement("div"); title.className = "row-title";
    const badge = document.createElement("span"); badge.className = "row-badge"; heading.append(title, badge);
    const details = document.createElement("div"); details.className = "row-details";
    const position = document.createElement("span"); position.className = "row-position";
    const recent = document.createElement("span"); recent.className = "row-recent"; details.append(position, recent);
    const bottom = document.createElement("div"); bottom.className = "row-bottom";
    const track = document.createElement("div"); track.className = "progress-track row-progress";
    for (const name of ["progress-history", "progress-position", "progress-thumb"]) {
      const layer = document.createElement("div"); layer.className = name; track.append(layer);
    }
    const seek = document.createElement("input"); seek.type = "range"; seek.className = "row-seek"; seek.min = "0"; seek.step = "1"; seek.tabIndex = -1; track.append(seek);
    const status = document.createElement("span"); status.className = "row-status";
    bottom.append(track, status); body.append(heading, details, bottom); element.append(button, body);
    return { element, button, title, badge, position, recent, track, seek, status, signature: "" };
  }
  private patch(row: Row, record: VideoRecord, index: number, total: number): void {
    const active = this.flags.activeId === record.id, selected = this.flags.selectedId === record.id;
    const percent = Math.floor(record.progress * 100), recent = recentTime(record.lastPlayedAt);
    const signature = JSON.stringify([record.fileName, record.duration, percent, Math.floor(record.position), recent, record.status, active, selected, active && this.flags.paused, index, total, this.rowHeight]);
    if (signature === row.signature || row.seek.dataset.scrubbing === "true") return;
    row.signature = signature; this.metrics.patched++;
    row.element.style.top = `${index * this.rowHeight}px`; row.element.style.height = `${this.rowHeight}px`;
    row.element.dataset.status = record.status; row.element.dataset.active = String(active);
    row.element.setAttribute("aria-selected", String(selected)); row.element.setAttribute("aria-posinset", String(index + 1)); row.element.setAttribute("aria-setsize", String(total));
    row.element.title = `${record.filePath}\n${progressDescription(record)}${record.lastPlayedAt ? `\n上次观看 ${new Date(record.lastPlayedAt).toLocaleString()}` : ""}`;
    row.title.textContent = record.fileName; row.badge.textContent = active ? this.flags.paused ? "已暂停" : "播放中" : "";
    row.recent.textContent = recent; row.recent.title = record.lastPlayedAt ? new Date(record.lastPlayedAt).toLocaleString() : "尚未实际播放";
    row.track.style.setProperty("--history", `${percent}%`); row.track.title = progressDescription(record);
    const jumping = Math.abs(record.position - Number(row.seek.value)) > 3 || row.seek.max !== String(Math.max(1, record.duration));
    row.seek.max = String(Math.max(1, record.duration)); row.seek.value = String(record.position);
    row.seek.disabled = !active || record.duration <= 0;
    row.seek.setAttribute("aria-label", `调整 ${record.fileName} 的播放位置`);
    row.seek.title = active && record.duration > 0 ? "拖动预览，松开跳转" : "播放此视频后可调整位置";
    this.previewPosition(record.id, record.position);
    row.track.dataset.jumping = String(jumping);
    row.status.textContent = record.status === "completed" ? "已完成" : record.status === "unwatched" ? "未观看" : `${percent}%`;
    const pause = active && !this.flags.paused;
    row.button.textContent = active ? pause ? "Ⅱ" : "▶" : record.status === "completed" ? "✓" : String(index + 1).padStart(2, "0");
    row.button.title = pause ? "暂停" : "播放"; row.button.setAttribute("aria-label", `${pause ? "暂停" : "播放"} ${record.fileName}`);
    row.button.setAttribute("aria-pressed", String(pause));
  }
}
