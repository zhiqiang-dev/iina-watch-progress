import { describe, expect, it, vi } from "vitest";
import { MpvAdapter } from "../src/adapter/mpv-api";

describe("cached mpv playback properties", () => {
  it("reads only time-pos for periodic samples and refreshes low-frequency properties on events", () => {
    const properties: Record<string, unknown> = { "time-pos": 10, duration: 100, pause: false, seeking: false, "paused-for-cache": false, speed: 2 };
    const number = vi.fn((name: string) => properties[name]), flag = vi.fn((name: string) => properties[name]);
    const adapter = new MpvAdapter({ getNumber: number, getFlag: flag } as unknown as IINA.API.MPV);
    adapter.refreshPlayback(); number.mockClear(); flag.mockClear();
    expect(adapter.sample(1)).toMatchObject({ duration: 100, speed: 2, paused: false });
    adapter.sample(2); expect(number.mock.calls).toEqual([["time-pos"], ["time-pos"]]); expect(flag).not.toHaveBeenCalled();
    properties.pause = true; properties.duration = 200;
    adapter.refreshPlayback("pause"); expect(adapter.paused).toBe(true);
    adapter.refreshPlayback("duration"); expect(adapter.sample(3)?.duration).toBe(200);
    properties.seeking = true; properties["paused-for-cache"] = true;
    adapter.refreshPlayback("seeking"); adapter.refreshPlayback("paused-for-cache");
    expect(adapter.sample(4)).toMatchObject({ seeking: true, buffering: true });
    adapter.resetPlayback(); expect(adapter.paused).toBe(true);
  });
});
