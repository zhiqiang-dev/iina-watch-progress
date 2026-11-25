import type { VideoRecord } from "../../models/video-record";
import type { VideoListModel } from "../video-list-model";

export const ROW_HEIGHT = 64;
const OVERSCAN = 3;
interface Row {
  element: HTMLDivElement; button: HTMLButtonElement; title: HTMLDivElement;
  duration: HTMLSpanElement; bar: HTMLDivElement; status: HTMLSpanElement; signature: string;
}
export interface PlaybackView { selectedId?: string; activeId?: string; paused: boolean; }
export function formatTime(seconds: number, unknownWhenZero = false): string {
  if (seconds <= 0) return unknownWhenZero ? "—" : "0:00";
  const total = Math.floor(seconds), hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

/** Reuse rows by file identity; collapse scroll and progress events to one frame. */
export class VirtualVideoList {
  private rows = new Map<string, Row>();
  private frame?: number;
  private nextRow = 0;
  private flags: PlaybackView = { paused: true };
  private readonly resize: ResizeObserver;
  readonly metrics = { frames: 0, created: 0, patched: 0 };
  constructor(private readonly viewport: HTMLElement, private readonly content: HTMLElement, private readonly model: VideoListModel) {
    viewport.addEventListener("scroll", () => this.schedule(), { passive: true });
    this.resize = new ResizeObserver(() => this.schedule()); this.resize.observe(viewport);
  }
  update(flags: PlaybackView): void { this.flags = flags; this.schedule(); }
  scrollTo(top: number): void {
    // Update the virtual extent before assigning scrollTop, otherwise WebKit clamps
    // a restored position against the previous folder's shorter content.
    this.content.style.height = `${this.model.ids.length * ROW_HEIGHT}px`;
    this.viewport.scrollTop = Math.max(0, top); this.schedule();
  }
  reveal(index: number): void {
    this.scrollTo(index * ROW_HEIGHT - (this.viewport.clientHeight - ROW_HEIGHT) / 2);
  }
  private schedule(): void {
    if (this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => { this.frame = undefined; this.render(); });
  }
  private render(): void {
    this.metrics.frames++;
    const ids = this.model.ids, height = `${ids.length * ROW_HEIGHT}px`;
    if (this.content.style.height !== height) this.content.style.height = height;
    const visible = Math.ceil(this.viewport.clientHeight / ROW_HEIGHT);
    const first = Math.max(0, Math.min(ids.length - visible, Math.floor(this.viewport.scrollTop / ROW_HEIGHT)));
    const start = Math.max(0, first - OVERSCAN), end = Math.min(ids.length, first + visible + OVERSCAN);
    const wanted = new Set(ids.slice(start, end));
    for (const [id, row] of this.rows) if (!wanted.has(id)) { row.element.remove(); this.rows.delete(id); }
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
    }
  }
  private createRow(id: string): Row {
    this.metrics.created++;
    const element = document.createElement("div"); element.className = "video-row";
    element.id = `video-row-${this.nextRow++}`; element.dataset.id = id; element.setAttribute("role", "option");
    const button = document.createElement("button"); button.className = "row-icon"; button.type = "button"; button.tabIndex = -1;
    const body = document.createElement("div"); body.className = "row-content";
    const title = document.createElement("div"); title.className = "row-title";
    const bottom = document.createElement("div"); bottom.className = "row-bottom";
    const duration = document.createElement("span"); duration.className = "row-duration";
    const track = document.createElement("div"); track.className = "row-progress"; track.setAttribute("aria-hidden", "true");
    const bar = document.createElement("div"); track.append(bar);
    const status = document.createElement("span"); status.className = "row-status";
    bottom.append(duration, track, status); body.append(title, bottom); element.append(button, body);
    return { element, button, title, duration, bar, status, signature: "" };
  }
  private patch(row: Row, record: VideoRecord, index: number, total: number): void {
    const active = this.flags.activeId === record.id, selected = this.flags.selectedId === record.id;
    const percent = Math.floor(record.progress * 100);
    const signature = JSON.stringify([record.fileName, record.duration, percent, record.status, active, selected, active && this.flags.paused, index, total]);
    if (signature === row.signature) return;
    row.signature = signature; this.metrics.patched++;
    row.element.style.top = `${index * ROW_HEIGHT}px`; row.element.dataset.status = record.status; row.element.dataset.active = String(active);
    row.element.setAttribute("aria-selected", String(selected)); row.element.setAttribute("aria-posinset", String(index + 1)); row.element.setAttribute("aria-setsize", String(total));
    row.element.title = record.filePath; row.title.textContent = record.fileName; row.duration.textContent = formatTime(record.duration, true);
    row.bar.style.width = `${percent}%`;
    row.status.textContent = record.status === "completed" ? "已看完" : record.status === "watching" ? `${percent}%` : "未观看";
    const pause = active && !this.flags.paused;
    row.button.textContent = active ? pause ? "Ⅱ" : "▶" : record.status === "completed" ? "✓" : String(index + 1).padStart(2, "0");
    row.button.title = pause ? "暂停" : "播放"; row.button.setAttribute("aria-label", `${pause ? "暂停" : "播放"} ${record.fileName}`);
    row.button.setAttribute("aria-pressed", String(pause));
  }
}
