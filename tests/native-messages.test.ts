import { describe, expect, it, vi } from "vitest";
import { DeferredGlobalMessages, onNativeMessage } from "../src/messaging/native-messages";

describe("native message bridge", () => {
  it("never sends a reply inside the caller's synchronous native stack", () => {
    const tasks: (() => void)[] = [];
    let inRequest = true;
    const send = vi.fn((_player: string, _name: string, wire: string) => {
      expect(inRequest).toBe(false);
      expect(JSON.parse(wire)).toEqual({ videos: ["课程.mp4"] });
    });
    const messages = new DeferredGlobalMessages(send, task => tasks.push(task), vi.fn());
    messages.post("0", "records", { videos: ["课程.mp4"] });
    expect(send).not.toHaveBeenCalled();
    inRequest = false;
    tasks.shift()!();
    expect(send).toHaveBeenCalledOnce();
  });
  it("coalesces snapshots by player, retaining an immutable copy of each latest state", () => {
    const tasks: (() => void)[] = [];
    const send = vi.fn();
    const messages = new DeferredGlobalMessages(send, task => tasks.push(task), vi.fn());
    messages.post("0", "records", { position: 1 });
    const state = { position: 2 };
    messages.post("0", "records", state);
    messages.post("1", "records", { position: 3 });
    messages.post("0", "reset", null);
    state.position = 99;
    expect(tasks).toHaveLength(1);
    tasks.shift()!();
    expect(send.mock.calls).toEqual([
      ["0", "records", '{"position":2}'], ["1", "records", '{"position":3}'], ["0", "reset", "null"],
    ]);
  });
  it("isolates failed destinations and defers messages enqueued during delivery", () => {
    const tasks: (() => void)[] = [];
    const error = vi.fn();
    const send = vi.fn((player: string) => {
      if (player === "closed") throw new Error("Window closed");
      if (player === "0") messages.post("1", "records", {});
    });
    const messages = new DeferredGlobalMessages(send, task => tasks.push(task), error);
    messages.post("closed", "records", {});
    messages.post("0", "records", {});
    tasks.shift()!();
    expect(error).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledTimes(2);
    expect(tasks).toHaveLength(1);
    tasks.shift()!();
    expect(send).toHaveBeenLastCalledWith("1", "records", "{}");
  });
  it("roots message callbacks and replaces registrations for a reloaded WebView", () => {
    const endpoint = { onMessage: vi.fn() };
    const first = vi.fn();
    const replacement = vi.fn();
    onNativeMessage(endpoint, "ready", first);
    onNativeMessage(endpoint, "ready", replacement);
    const root = globalThis as typeof globalThis & {
      __watchProgressMessageCallbacks: Map<typeof endpoint, Map<string, (...args: unknown[]) => void>>;
    };
    const retained = root.__watchProgressMessageCallbacks.get(endpoint)!.get("ready")!;
    retained({});
    expect(replacement).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });
});
