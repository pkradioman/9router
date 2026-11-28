import { describe, expect, it } from "vitest";
import { expandEscapes } from "../src/ui/ChatPage.mjs";

describe("chat escape expansion", () => {
  it("turns typed escapes into real whitespace and leaves other text alone", () => {
    expect(expandEscapes("line1\\nline2")).toBe("line1\nline2");
    expect(expandEscapes("a\\tb")).toBe("a\tb");
    expect(expandEscapes("no escapes")).toBe("no escapes");
    expect(expandEscapes(null)).toBe("");
  });
});
