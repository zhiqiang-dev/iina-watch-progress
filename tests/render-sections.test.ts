import { describe, expect, it } from "vitest";
import { RenderSections } from "../src/ui/render-sections";

describe("independent view sections", () => {
  it("keeps video sections unchanged through storage-only messages and invalidates dependent fields", () => {
    const sections = new RenderSections(), selected = { position: 10 }, other = { position: 20 };
    expect(sections.changed("selection", [selected, false])).toBe(true);
    expect(sections.changed("stats", [1000, 3, 2])).toBe(true);
    expect(sections.changed("storage", [true, 0])).toBe(true);
    expect(sections.changed("storage", [false, 1000])).toBe(true);
    expect(sections.changed("selection", [selected, false])).toBe(false);
    expect(sections.changed("stats", [1000, 3, 2])).toBe(false);
    expect(sections.changed("selection", [other, false])).toBe(true);
    expect(sections.changed("selection", [other, true])).toBe(true);
    expect(sections.changed("stats", [1000, 4, 1])).toBe(true);
  });
});
