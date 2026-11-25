import type { ViewState, ViewSnapshot, ViewPatch } from "../messaging/message-bus";

/** Coalesce hidden-view traffic without rendering or keeping every playback tick. */
export class ViewUpdateBuffer {
  private snapshot?: ViewSnapshot;
  private patch?: ViewPatch;
  push(next: ViewState): void {
    if (next.kind !== "patch") { this.snapshot = next; this.patch = undefined; return; }
    if (this.snapshot && next.scope !== undefined && next.scope !== this.snapshot.scope) return;
    if (!this.patch || next.scope !== this.patch.scope) { this.patch = next; return; }
    const videos = new Map(this.patch.videos.map(record => [record.id, record]));
    for (const record of next.videos) videos.set(record.id, record);
    this.patch = { ...next, videos: [...videos.values()] };
  }
  drain(): ViewState[] {
    const output: ViewState[] = [];
    if (this.snapshot) output.push(this.snapshot);
    if (this.patch) output.push(this.patch);
    this.snapshot = undefined; this.patch = undefined;
    return output;
  }
}
