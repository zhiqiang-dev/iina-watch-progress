import { describe, expect, it } from "vitest";
import { PlaybackTracker } from "../src/core/playback-tracker";
import { sample } from "./helpers";

describe("wall-clock playback tracker", () => {
  it("counts continuous playback once per session", () => {
    const tracker = new PlaybackTracker();
    expect(tracker.sample(sample(0))?.watchedSeconds).toBe(0);
    expect(tracker.sample(sample(1))).toMatchObject({ watchedSeconds: 1, firstPlayback: true });
    expect(tracker.sample(sample(2))).toMatchObject({ watchedSeconds: 1, firstPlayback: false });
  });
  it("counts one real second at double speed", () => {
    const tracker = new PlaybackTracker();
    tracker.sample(sample(0, 1000, { speed: 2 }));
    expect(tracker.sample(sample(2, 2000, { speed: 2 }))?.watchedSeconds).toBe(1);
  });
  it.each([
    ["forward seek", sample(70, 2000)],
    ["backward seek", sample(5, 2000)],
    ["seeking", sample(11, 2000, { seeking: true })],
    ["buffering", sample(11, 2000, { buffering: true })],
    ["no movement", sample(10, 2000)],
    ["app suspension", sample(20, 11000)],
  ])("does not count %s as watching", (_name, next) => {
    const tracker = new PlaybackTracker();
    tracker.sample(sample(10, 1000));
    expect(tracker.sample(next)?.watchedSeconds).toBe(0);
  });
  it("does not count a paused interval", () => {
    const tracker = new PlaybackTracker();
    tracker.sample(sample(0, 1000, { paused: true }));
    expect(tracker.sample(sample(1, 2000))?.watchedSeconds).toBe(0);
  });
  it("ignores duplicated and out-of-order messages", () => {
    const tracker = new PlaybackTracker();
    tracker.sample(sample(1));
    expect(tracker.sample(sample(1))).toBeUndefined();
    expect(tracker.sample(sample(0))).toBeUndefined();
    expect(tracker.sample(sample(2))?.watchedSeconds).toBe(1);
  });
});
