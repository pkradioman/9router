import { describe, expect, it, vi } from "vitest";
import React from "react";
import { createTestRoot, hasNativeTestRenderer } from "@gpuix/react/testing";
import { PortConflict } from "../src/ui/PortConflict.mjs";

describe.skipIf(!hasNativeTestRenderer)("port conflict prompt", () => {
  it("shows occupied and reserved ports and supports cancellation", () => {
    const cancel = vi.fn();
    const { render, renderer } = createTestRoot({ width: 600, height: 400 });
    render(React.createElement(PortConflict, { occupiedPort: 20129, onChoose: vi.fn(), onCancel: cancel }));
    const text = renderer.getPaintedText().join("\n");
    expect(text).toContain("20129");
    expect(text).toContain("20128");
    const button = renderer.findByTestId("port-cancel");
    const bounds = renderer.getElementBounds(button.id);
    renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
