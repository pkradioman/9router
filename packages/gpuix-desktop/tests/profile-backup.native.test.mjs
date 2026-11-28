// Database backup/restore through the real GPUIX paint and hit-test pipeline.
//
// Mounted directly (no app shell) because the native test window is sized to the
// display and the shell pushes this section below the fold, where clicks are not
// possible. The backup folder is redirected so the test never writes Downloads.
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const gpuix = await import("@gpuix/react/testing");
const { hasNativeTestRenderer, createTestRoot } = gpuix;
const React = (await import("react")).default;
const { ProfilePage } = await import("../src/ui/ProfilePage.mjs");

const h = React.createElement;

async function settle(root) {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    root.renderer.flush();
  }
}

function click(renderer, testId) {
  const element = renderer.findByTestId(testId);
  expect(element).toBeTruthy();
  const bounds = renderer.getElementBounds(element.id);
  renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}

function typeInto(root, testId, keys) {
  const element = root.renderer.findByTestId(testId);
  const bounds = root.renderer.getElementBounds(element.id);
  root.renderer.nativeSimulateClick(bounds.x + 4, bounds.y + bounds.height / 2);
  root.renderer.nativeSimulateKeystrokes(element.id, keys);
}

describe.skipIf(!hasNativeTestRenderer)("profile database backup", () => {
  it("writes a backup to the default folder and restores it after confirmation", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpuix-backup-"));
    const previous = process.env.GPUIX_BACKUP_DIR;
    process.env.GPUIX_BACKUP_DIR = dir;
    try {
      const api = {
        getSettings: vi.fn(async () => ({ hasPassword: true, requireLogin: true })),
        patchSettings: vi.fn(async (patch) => ({ hasPassword: true, ...patch })),
        getDatabaseBackup: vi.fn(async () => ({ version: 1, marker: "db" })),
        importDatabase: vi.fn(async () => ({ success: true })),
      };
      const root = createTestRoot({ width: 1000, height: 1800 });
      root.render(h(ProfilePage, { api, status: { baseUrl: "http://127.0.0.1:20129" } }));
      await settle(root);

      typeInto(root, "profile-db-password", "p w");
      await settle(root);
      click(root.renderer, "profile-db-save");
      await settle(root);

      expect(api.getDatabaseBackup).toHaveBeenCalledWith("pw");
      const files = fs.readdirSync(dir).filter((name) => name.startsWith("9router-backup-"));
      expect(files).toHaveLength(1);
      expect(fs.readFileSync(path.join(dir, files[0]), "utf-8")).toContain('"marker": "db"');
      expect(root.renderer.getPaintedText().join("\n")).toContain("Backup saved:");

      click(root.renderer, "profile-db-latest");
      await settle(root);
      click(root.renderer, "profile-db-restore");
      await settle(root);
      expect(root.renderer.getPaintedText().join("\n")).toContain("Press Confirm");
      expect(api.importDatabase).not.toHaveBeenCalled();

      click(root.renderer, "profile-db-restore");
      await settle(root);
      expect(api.importDatabase).toHaveBeenCalledWith({ version: 1, marker: "db" }, "pw");
      expect(root.renderer.getPaintedText().join("\n")).toContain("Database imported.");
    } finally {
      if (previous === undefined) delete process.env.GPUIX_BACKUP_DIR;
      else process.env.GPUIX_BACKUP_DIR = previous;
    }
  });
});
