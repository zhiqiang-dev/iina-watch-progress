import type { PlaybackUpdate } from "./progress-engine";

export interface PlaybackSample {
  sequence: number;
  now: number;
  position: number;
  duration: number;
  paused: boolean;
  seeking: boolean;
  buffering: boolean;
  speed: number;
  eof: boolean;
}

/** Measures wall-clock watch time, not seek distance or media time at 2× speed. */
export class PlaybackTracker {
  private previous?: PlaybackSample;
  private countedPlay = false;
  private sequence = -1;

  sample(current: PlaybackSample): PlaybackUpdate | undefined {
    if (current.sequence <= this.sequence) return;
    this.sequence = current.sequence;
    const previous = this.previous;
    this.previous = current;
    let watchedSeconds = 0;
    if (previous) {
      const elapsed = (current.now - previous.now) / 1000;
      const moved = current.position - previous.position;
      const speed = previous.speed > 0 ? previous.speed : 1;
      if (elapsed > 0 && elapsed <= 2.5 && !previous.paused && !previous.seeking &&
          !current.seeking && !previous.buffering && !current.buffering &&
          moved > 0 && moved <= elapsed * speed + 0.75) {
        watchedSeconds = Math.min(elapsed, moved / speed);
      }
    }
    const firstPlayback = watchedSeconds > 0 && !this.countedPlay;
    if (firstPlayback) this.countedPlay = true;
    return { position: current.position, duration: current.duration, watchedSeconds,
      firstPlayback, eof: current.eof, now: current.now };
  }
}
