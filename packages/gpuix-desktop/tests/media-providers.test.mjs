// The native media list is a generated snapshot; this test fails when the
// gateway registry changes and the snapshot was not regenerated.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { MEDIA_PROVIDERS, MEDIA_MODELS } from "../src/ui/media-providers.generated.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

describe("media provider snapshot", () => {
  it("matches the gateway registry", async () => {
    const registryPath = path.join(repoRoot, "open-sse", "providers", "registry", "index.js");
    const registry = (await import(pathToFileURL(registryPath).href)).default;

    const expected = registry
      .filter((entry) => !entry.hidden)
      .map((entry) => {
        const kinds = entry.serviceKinds ?? ["llm"];
        if (!kinds.some((kind) => kind !== "llm")) return null;
        const row = {
          id: entry.id,
          alias: entry.uiAlias || entry.alias || entry.id,
          name: (entry.display && entry.display.name) || entry.id,
          kinds,
          noAuth: entry.noAuth === true,
          priority: entry.priority ?? entry.mediaPriority ?? 999,
        };
        if (entry.hiddenKinds) row.hiddenKinds = entry.hiddenKinds;
        return row;
      })
      .filter(Boolean)
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

    expect(MEDIA_PROVIDERS).toEqual(expected);

    const aliasById = new Map(expected.map((entry) => [entry.id, entry.alias]));
    const models = [];
    for (const entry of registry) {
      if (entry.hidden || !Array.isArray(entry.models)) continue;
      if (!aliasById.has(entry.id)) continue;
      for (const model of entry.models) {
        const kinds = model.kinds ?? (model.kind ? [model.kind] : null);
        if (!kinds || !kinds.some((kind) => kind !== "llm")) continue;
        models.push({
          provider: entry.id,
          alias: aliasById.get(entry.id),
          model: model.id,
          name: model.name || model.id,
          kinds,
        });
      }
    }
    models.sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));
    expect(MEDIA_MODELS).toEqual(models);
  });
});
