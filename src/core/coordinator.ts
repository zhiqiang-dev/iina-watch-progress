import { PlaybackTracker, type PlaybackSample } from "./playback-tracker";
import { normalizePath, mediaId } from "./media-identity";
import { updateProgress } from "./progress-engine";
import type { Repository } from "../storage/repository";
import type { RecordsMessage } from "../messaging/message-bus";

interface Session { id: string; path: string; tracker: PlaybackTracker; suspended: boolean; }

export class Coordinator {
  private subscriptions = new Map<string, { ids: Set<string>; scope: number }>();
  private sessions = new Map<string, Session>();

  constructor(readonly repository: Repository,
    private readonly post: (player: string, state: RecordsMessage) => void,
    private readonly resetPlayback: (player: string) => void) {}

  sync(player: string, paths: string[], now: number, scope = 0): void {
    const ids = new Set<string>();
    for (const candidate of paths) {
      const path = normalizePath(candidate);
      if (path) ids.add(this.repository.ensure(path, now).id);
    }
    this.subscriptions.set(player, { ids, scope });
    this.publish(player, true);
  }
  begin(player: string, id: string, input: string, now: number): void {
    if (this.sessions.get(player)?.id === id) return;
    const path = normalizePath(input);
    if (!path) return;
    this.repository.ensure(path, now);
    this.sessions.set(player, { id, path, tracker: new PlaybackTracker(), suspended: false });
  }
  sample(player: string, id: string, sample: PlaybackSample, flush: boolean): void {
    const session = this.sessions.get(player);
    if (!session || session.id !== id) return;
    // A reset must survive stale high-position samples from every open window.
    if (session.suspended) {
      if (sample.position > 1 || !sample.paused) return;
      session.suspended = false;
    }
    const update = session.tracker.sample(sample);
    if (!update) return;
    const record = this.repository.ensure(session.path, sample.now);
    const updated = updateProgress(record, update, this.repository.data.settings.completionThreshold);
    this.repository.put(updated);
    if (record === updated && !flush) return;
    if (flush) this.repository.flush(sample.now);
    this.publishInterested(record.id);
  }
  end(player: string, id: string, now: number): void {
    if (this.sessions.get(player)?.id !== id) return;
    this.sessions.delete(player);
    this.repository.flush(now);
    this.publishAll();
  }
  mark(player: string, id: string, completed: boolean, now: number): void {
    if (!this.subscriptions.get(player)?.ids.has(id) || !this.repository.mark(id, completed, now)) return;
    if (!completed) {
      for (const [target, session] of this.sessions) {
        if (mediaId(session.path) === id) {
          session.tracker = new PlaybackTracker();
          session.suspended = true;
          this.resetPlayback(target);
        }
      }
    }
    this.repository.flush(now);
    this.publishInterested(id);
  }
  disconnect(player: string, now: number): void {
    this.sessions.delete(player);
    this.subscriptions.delete(player);
    this.repository.flush(now);
  }
  publishAll(): void { for (const player of this.subscriptions.keys()) this.publish(player); }
  private publishInterested(id: string): void {
    for (const [player, { ids }] of this.subscriptions) if (ids.has(id)) this.publish(player, false, id);
  }
  private publish(player: string, full = false, changedId?: string): void {
    const subscription = this.subscriptions.get(player);
    if (!subscription) return;
    const ids = full ? [...subscription.ids] : changedId ? [changedId] : [];
    const videos = ids
      .flatMap(id => this.repository.data.videos[id] ? [this.repository.data.videos[id]!] : []);
    this.post(player, { kind: full ? "snapshot" : "patch", scope: subscription.scope,
      videos, settings: this.repository.data.settings, storage: { ...this.repository.storage.state } });
  }
}
