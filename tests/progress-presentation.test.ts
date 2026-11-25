import { describe, expect, it } from "vitest";
import { formatTime, positionRatio, remainingTime, recentTime, progressDescription } from "../src/ui/progress-presentation";
import { createRecord } from "../src/core/progress-engine";

describe("progress presentation", () => {
  it("distinguishes the last position from historical progress after rewinding", () => {
    const record = { ...createRecord("/Course/01.mp4", 1), duration: 100, position: 20, maxPosition: 80, progress: 0.8 };
    expect(positionRatio(record.position, record.duration)).toBe(0.2);
    expect(progressDescription(record)).toContain("历史最远 80%");
    expect(remainingTime(record.position, record.duration)).toBe("剩余 1:20");
  });
  it("formats unknown, zero, over-duration, and hour-long media safely", () => {
    expect(formatTime(0, true)).toBe("—"); expect(formatTime(3661)).toBe("1:01:01");
    expect(positionRatio(120, 100)).toBe(1); expect(positionRatio(20, 0)).toBe(0);
    expect(remainingTime(120, 100)).toBe("剩余 0:00"); expect(remainingTime(0, 0)).toBe("时长未知");
    expect(recentTime(0)).toBe("未观看"); expect(recentTime(1000, 2000)).toBe("刚刚");
  });
});
