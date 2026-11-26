import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchInput } from "../src/ui/search-input";

afterEach(() => vi.useRealTimers());
describe("search input scheduling", () => {
  it("coalesces a burst of keystrokes into the latest query", () => {
    vi.useFakeTimers(); let value = "", result = "", calls = 0;
    const search = new SearchInput(() => { result = value; calls++; });
    for (const next of ["课", "课程", "课程 058"]) { value = next; search.input(); vi.advanceTimersByTime(50); }
    expect(calls).toBe(0); vi.advanceTimersByTime(100);
    expect(result).toBe("课程 058"); expect(calls).toBe(1);
  });
  it("does not query intermediate IME input or run twice after composition ends", () => {
    vi.useFakeTimers(); const apply = vi.fn(), search = new SearchInput(apply);
    search.input(); search.compositionStart();
    search.input(); search.flush(); vi.advanceTimersByTime(1000); expect(apply).not.toHaveBeenCalled();
    search.compositionEnd(); search.input(); vi.advanceTimersByTime(150); expect(apply).toHaveBeenCalledTimes(1);
  });
  it("applies Enter immediately and cancels a query when switching folders", () => {
    vi.useFakeTimers(); const apply = vi.fn(), search = new SearchInput(apply);
    search.input(); search.flush(); vi.advanceTimersByTime(1000); expect(apply).toHaveBeenCalledTimes(1);
    search.input(); search.cancel(); vi.advanceTimersByTime(1000); expect(apply).toHaveBeenCalledTimes(1);
    search.compositionStart(); search.input(); search.reset();
    search.input(); vi.advanceTimersByTime(150); expect(apply).toHaveBeenCalledTimes(2);
  });
});
