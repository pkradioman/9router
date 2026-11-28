import { describe, expect, it } from "vitest";
import { levelColor, LEVEL_COLORS } from "../src/ui/ConsoleLogPage.mjs";

describe("console line colours", () => {
  it("uses the dashboard level tags and falls back to LOG", () => {
    expect(levelColor("[ERROR] boom")).toBe(LEVEL_COLORS.ERROR);
    expect(levelColor("[warn] careful")).toBe(LEVEL_COLORS.WARN);
    expect(levelColor("[INFO] up")).toBe(LEVEL_COLORS.INFO);
    expect(levelColor("[DEBUG] trace")).toBe(LEVEL_COLORS.DEBUG);
    expect(levelColor("[LOG] plain")).toBe(LEVEL_COLORS.LOG);
    expect(levelColor("no tag at all")).toBe(LEVEL_COLORS.LOG);
    expect(levelColor("[CUSTOM] unknown tag")).toBe(LEVEL_COLORS.LOG);
    expect(levelColor(null)).toBe(LEVEL_COLORS.LOG);
  });
});
