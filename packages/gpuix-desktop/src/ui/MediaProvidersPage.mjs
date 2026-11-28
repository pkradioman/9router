// Native media-provider overview: the dashboard's per-kind listing pages.
//
// Provider kinds come from a generated snapshot of the gateway registry
// (scripts/gen-media-providers.mjs) because the staged runtime exposes no
// catalog endpoint. Connection counts and toggles read and write the real
// /api/providers rows; custom embedding nodes join the embedding kind.
import React from "react";
import { theme } from "./theme.mjs";
import { MEDIA_PROVIDERS, MEDIA_MODELS } from "./media-providers.generated.mjs";

const h = React.createElement;

// Mirrors MEDIA_PROVIDER_KINDS in src/shared/constants/providers.js.
export const MEDIA_KINDS = [
  { id: "embedding", label: "Embedding", endpoint: "/v1/embeddings" },
  { id: "image", label: "Text to Image", endpoint: "/v1/images/generations" },
  { id: "imageToText", label: "Image to Text", endpoint: "/v1/images/understanding" },
  { id: "tts", label: "Text To Speech", endpoint: "/v1/audio/speech" },
  { id: "stt", label: "Speech To Text", endpoint: "/v1/audio/transcriptions" },
  { id: "webSearch", label: "Web Search", endpoint: "/v1/search" },
  { id: "webFetch", label: "Web Fetch", endpoint: "/v1/web/fetch" },
  { id: "video", label: "Video", endpoint: "/v1/videos/generations" },
  { id: "music", label: "Music", endpoint: "/v1/audio/music" },
  { id: "systemone", label: "System One", endpoint: "/v1/systemone" },
];

export function providersForKind(kind) {
  return MEDIA_PROVIDERS.filter(
    (entry) => entry.kinds.includes(kind) && !(entry.hiddenKinds || []).includes(kind)
  );
}

function connectionState(conns) {
  const active = conns.filter(
    (conn) => conn.isActive !== false && !["error", "expired", "unavailable"].includes(conn.testStatus)
  ).length;
  const errors = conns.filter((conn) => ["error", "expired", "unavailable"].includes(conn.testStatus)).length;
  const allDisabled = conns.length > 0 && conns.every((conn) => conn.isActive === false);
  return { active, errors, allDisabled };
}

export function MediaProvidersPage({ api, status }) {
  const [kind, setKind] = React.useState("image");
  const [connections, setConnections] = React.useState(null);
  const [nodes, setNodes] = React.useState([]);
  const [customModels, setCustomModels] = React.useState([]);
  const [combos, setCombos] = React.useState([]);
  const [disabled, setDisabled] = React.useState({});
  const [modelTests, setModelTests] = React.useState({});
  const [openProvider, setOpenProvider] = React.useState("");
  const [openCombo, setOpenCombo] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    setError("");
    setConnections(null);
    Promise.all([
      api.listProviders(),
      api.listProviderNodes(),
      api.getDisabledModels(),
      api.listCustomModels(),
      api.listCombos(),
    ])
      .then(([conns, nodeList, disabledMap, customList, comboList]) => {
        setConnections(conns);
        setNodes((nodeList || []).filter((node) => node.type === "custom-embedding"));
        setDisabled(disabledMap || {});
        setCustomModels(customList || []);
        setCombos(comboList || []);
      })
      .catch((err) => {
        setConnections([]);
        setNodes([]);
        setCustomModels([]);
        setCombos([]);
        setError(err.message);
      });
  }, [api]);

  const reloadDisabled = React.useCallback(() => {
    api
      .getDisabledModels()
      .then((map) => setDisabled(map || {}))
      .catch(() => {});
  }, [api]);

  // One real request with the provider account, same as the dashboard's
  // per-model Test button on a media card.
  const testModel = (entry, modelId) => {
    const key = `${entry.id}/${modelId}`;
    setModelTests((map) => ({ ...map, [key]: "Testing..." }));
    api
      .testModel(`${entry.alias}/${modelId}`, kind)
      .then((body) =>
        setModelTests((map) => ({
          ...map,
          [key]: body && body.ok ? "Test passed" : `Test failed: ${(body && body.error) || "no details"}`,
        }))
      )
      .catch((err) => setModelTests((map) => ({ ...map, [key]: `Test failed: ${err.message}` })));
  };

  const toggleModel = (entry, modelId, isDisabled) => {
    if (isDisabled) {
      void Promise.resolve(api.enableModel(entry.alias, modelId)).then(reloadDisabled);
    } else {
      void Promise.resolve(api.disableModels(entry.alias, [modelId])).then(reloadDisabled);
    }
  };

  React.useEffect(() => {
    load();
  }, [load]);

  const deleteNode = (id) => {
    setBusy(true);
    setError("");
    Promise.resolve(api.deleteProviderNode(id))
      .then(load)
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const toggleProvider = (providerId) => {
    const conns = (connections || []).filter((conn) => conn.provider === providerId);
    if (conns.length === 0) return;
    const { allDisabled } = connectionState(conns);
    const next = allDisabled;
    setBusy(true);
    setError("");
    Promise.allSettled(conns.map((conn) => api.updateProvider(conn.id, { isActive: next })))
      .then(load)
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const COMBO_BASE = { webSearch: "search-combo", webFetch: "fetch-combo" };
  const createComboForKind = (comboKind) => {
    const baseName = COMBO_BASE[comboKind];
    if (!baseName) return;
    const names = new Set(combos.map((combo) => combo.name));
    let name = baseName;
    let index = 1;
    while (names.has(name)) name = `${baseName}-${index++}`;
    setBusy(true);
    setError("");
    api
      .createCombo(name, comboKind)
      .then(load)
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };
  const updateComboModels = (combo, models) => {
    setBusy(true);
    setError("");
    Promise.resolve(api.updateCombo(combo.id, { models }))
      .then(load)
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const deleteComboRow = (id) => {
    setBusy(true);
    setError("");
    Promise.resolve(api.deleteCombo(id))
      .then(load)
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };
  const kindCombos = combos.filter((combo) => combo.kind === kind);

  const base = providersForKind(kind);
  const custom =
    kind === "embedding"
      ? nodes.map((node) => ({ id: node.id, name: node.name, kinds: ["embedding"], noAuth: false, custom: true }))
      : [];
  // Custom embedding nodes come first so their controls stay reachable without
  // scrolling past the long registry list.
  const entries = [...custom, ...base];

  const chip = (testId, label, onClick, active, count) =>
    h(
      "text",
      {
        testId,
        role: "button",
        onClick: busy ? null : onClick,
        style: {
          color: busy ? theme.muted : active ? theme.ok : theme.muted,
          fontSize: 11,
          cursor: busy ? "default" : "pointer",
          hover: busy ? {} : { color: theme.text },
        },
      },
      count === undefined ? label : `${label} (${count})`
    );

  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        backgroundColor: theme.surface,
        height: "100%",
        padding: 24,
        gap: 16,
      },
    },
    h(
      "div",
      { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 16, flexWrap: "wrap" } },
      h("text", { style: { color: theme.text, fontSize: 14, fontWeight: 600 } }, "Media providers"),
      h(
        "text",
        { style: { color: theme.muted, fontSize: 11 } },
        `${MEDIA_PROVIDERS.length} media-capable providers`
      ),
      chip("media-refresh", "Refresh", load, false)
    ),
    // Fixed rows of five keep the kind chips stable at any window width.
    h(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: 8 } },
      ...[0, 5, 10].map((start) =>
        h(
          "div",
          { key: start, style: { display: "flex", flexDirection: "row", gap: 14 } },
          ...MEDIA_KINDS.slice(start, start + 5).map((entry) =>
            chip(`media-kind-${entry.id}`, entry.label, () => setKind(entry.id), kind === entry.id, providersForKind(entry.id).length)
          )
        )
      )
    ),
    error ? h("text", { testId: "media-error", style: { color: theme.bad, fontSize: 12 } }, error) : null,
    h(
      "div",
      {
        testId: "media-section",
        style: {
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          minHeight: 0,
          backgroundColor: theme.panel,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 10,
          padding: 16,
          gap: 4,
        },
      },
      h(
        "div",
        { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 4 } },
        h(
          "text",
          { testId: "media-selected-kind", style: { color: theme.text, fontSize: 12, fontWeight: 600 } },
          MEDIA_KINDS.find((entry) => entry.id === kind)?.label || kind
        ),
        h(
          "text",
          { style: { color: theme.muted, fontSize: 10 } },
          MEDIA_KINDS.find((entry) => entry.id === kind)?.endpoint || ""
        )
      ),
      connections === null
        ? h("text", { testId: "media-loading", style: { color: theme.muted, fontSize: 12 } }, "Loading providers...")
        : entries.length === 0
          ? h(
              "text",
              { testId: "media-empty", style: { color: theme.muted, fontSize: 11 } },
              "No providers support this kind yet."
            )
          : entries.map((entry) => {
              const conns = (connections || []).filter((conn) => conn.provider === entry.id);
              const { active, errors, allDisabled } = connectionState(conns);
              const status = entry.noAuth
                ? { label: "Ready", color: theme.ok }
                : conns.length === 0
                  ? { label: "No connections", color: theme.muted }
                  : allDisabled
                    ? { label: "Disabled", color: theme.muted }
                    : active > 0
                      ? { label: `${active} connected`, color: theme.ok }
                      : errors > 0
                        ? { label: `${errors} error${errors === 1 ? "" : "s"}`, color: theme.bad }
                        : { label: `${conns.length} added`, color: theme.muted };
              const providerModels = entry.custom
                ? []
                : [
                    ...MEDIA_MODELS.filter((model) => model.provider === entry.id && model.kinds.includes(kind)),
                    ...customModels
                      .filter((model) => {
                        const modelKind = model.kind || model.type || "llm";
                        return model.providerAlias === entry.alias && modelKind === kind;
                      })
                      .map((model) => ({
                        provider: entry.id,
                        alias: entry.alias,
                        model: model.id,
                        name: `${model.name || model.id} (custom)`,
                        kinds: [kind],
                        custom: true,
                      })),
                  ];
              const open = openProvider === entry.id;
              const disabledIds = disabled[entry.alias] || [];
              return h(
                "div",
                {
                  key: entry.id,
                  testId: `media-provider-${entry.id}`,
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    paddingTop: 6,
                    paddingBottom: 6,
                    borderTopWidth: 1,
                    borderColor: theme.border,
                  },
                },
                h(
                  "div",
                  { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" } },
                  h(
                    "div",
                    { style: { display: "flex", flexDirection: "column", flexGrow: 1, gap: 2 } },
                    h("text", { style: { color: theme.text, fontSize: 12 } }, entry.name),
                    h(
                      "text",
                      { style: { color: theme.muted, fontSize: 10 } },
                      entry.custom ? "custom embedding node" : entry.kinds.join(" · ")
                    )
                  ),
                  h("text", { style: { color: status.color, fontSize: 10 } }, status.label),
                  providerModels.length > 0
                    ? h(
                        "text",
                        {
                          testId: `media-models-${entry.id}`,
                          role: "button",
                          onClick: busy ? null : () => setOpenProvider(open ? "" : entry.id),
                          style: {
                            color: theme.muted,
                            fontSize: 10,
                            cursor: busy ? "default" : "pointer",
                            hover: busy ? {} : { color: theme.text },
                          },
                        },
                        `${open ? "Hide" : "Models"} (${providerModels.length})`
                      )
                    : null,
                  entry.custom
                    ? h(
                        "text",
                        {
                          testId: `media-node-delete-${entry.id}`,
                          role: "button",
                          onClick: busy ? null : () => deleteNode(entry.id),
                          style: {
                            color: theme.bad,
                            fontSize: 10,
                            cursor: busy ? "default" : "pointer",
                            hover: busy ? {} : { color: theme.text },
                          },
                        },
                        "Delete"
                      )
                    : null,
                  conns.length > 0
                    ? h(
                        "text",
                        {
                          testId: `media-toggle-${entry.id}`,
                          role: "button",
                          onClick: busy ? null : () => toggleProvider(entry.id),
                          style: {
                            color: theme.muted,
                            fontSize: 10,
                            cursor: busy ? "default" : "pointer",
                            hover: busy ? {} : { color: theme.text },
                          },
                        },
                        allDisabled ? "Enable" : "Disable"
                      )
                    : null
                ),
                open
                  ? h(
                      "div",
                      { style: { display: "flex", flexDirection: "column", gap: 2, paddingLeft: 12 } },
                      ...providerModels.map((model) => {
                        const isDisabled = disabledIds.includes(model.model);
                        return h(
                          "div",
                          {
                            key: model.model,
                            testId: `media-model-${entry.id}-${model.model}`,
                            style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 10 },
                          },
                          h(
                            "text",
                            { style: { color: isDisabled ? theme.muted : theme.text, fontSize: 10, fontFamily: "Consolas", minWidth: 170 } },
                            model.model
                          ),
                          h("text", { style: { color: theme.muted, fontSize: 10, flexGrow: 1 } }, model.name),
                          h(
                            "text",
                            {
                              testId: `media-model-test-${entry.id}-${model.model}`,
                              role: "button",
                              onClick: busy ? null : () => testModel(entry, model.model),
                              style: { color: theme.muted, fontSize: 10, cursor: busy ? "default" : "pointer", hover: busy ? {} : { color: theme.text } },
                            },
                            "Test"
                          ),
                          modelTests[`${entry.id}/${model.model}`]
                            ? h(
                                "text",
                                {
                                  testId: `media-model-test-result-${entry.id}-${model.model}`,
                                  style: {
                                    color: modelTests[`${entry.id}/${model.model}`] === "Test passed" ? theme.ok : theme.bad,
                                    fontSize: 10,
                                  },
                                },
                                modelTests[`${entry.id}/${model.model}`]
                              )
                            : null,
                          h(
                            "text",
                            {
                              testId: `media-model-toggle-${entry.id}-${model.model}`,
                              role: "button",
                              onClick: busy ? null : () => toggleModel(entry, model.model, isDisabled),
                              style: {
                                color: isDisabled ? theme.muted : theme.ok,
                                fontSize: 10,
                                cursor: busy ? "default" : "pointer",
                                hover: busy ? {} : { color: theme.text },
                              },
                            },
                            isDisabled ? "Disabled" : "Enabled"
                          )
                        );
                      })
                    )
                  : null
              );
            })
    ),
    COMBO_BASE[kind]
      ? h(
          "div",
          {
            testId: "media-combos",
            style: {
              display: "flex",
              flexDirection: "column",
              backgroundColor: theme.panel,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 10,
              padding: 16,
              gap: 6,
            },
          },
          h(
            "div",
            { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 12 } },
            h(
              "text",
              { style: { color: theme.text, fontSize: 12, fontWeight: 600, flexGrow: 1 } },
              `Combos — ${MEDIA_KINDS.find((entry) => entry.id === kind)?.label || kind}`
            ),
            h(
              "text",
              {
                testId: "media-create-combo",
                role: "button",
                onClick: busy ? null : () => createComboForKind(kind),
                style: { color: theme.ok, fontSize: 10, cursor: busy ? "default" : "pointer", hover: busy ? {} : { color: theme.text } },
              },
              "Create combo"
            )
          ),
          kindCombos.length === 0
            ? h(
                "text",
                { testId: "media-combos-empty", style: { color: theme.muted, fontSize: 11 } },
                "No combos for this kind yet."
              )
            : kindCombos.map((combo) => {
                const models = (combo.models || []).map(String);
                const open = openCombo === combo.id;
                const candidates = MEDIA_MODELS.filter(
                  (entry) => entry.kinds.includes(kind) && !models.includes(`${entry.alias}/${entry.model}`)
                ).slice(0, 6);
                return h(
                  "div",
                  { key: combo.id, testId: `media-combo-${combo.id}`, style: { display: "flex", flexDirection: "column", gap: 2, paddingTop: 3, paddingBottom: 3 } },
                  h(
                    "div",
                    { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 10 } },
                    h("text", { style: { color: theme.text, fontSize: 11, flexGrow: 1 } }, combo.name),
                    h(
                      "text",
                      {
                        testId: `media-combo-models-${combo.id}`,
                        role: "button",
                        onClick: busy ? null : () => setOpenCombo(open ? "" : combo.id),
                        style: { color: theme.muted, fontSize: 10, cursor: busy ? "default" : "pointer", hover: busy ? {} : { color: theme.text } },
                      },
                      `${open ? "Hide" : "Models"} (${models.length})`
                    ),
                    h(
                      "text",
                      {
                        testId: `media-combo-delete-${combo.id}`,
                        role: "button",
                        onClick: busy ? null : () => deleteComboRow(combo.id),
                        style: { color: theme.bad, fontSize: 10, cursor: busy ? "default" : "pointer", hover: busy ? {} : { color: theme.text } },
                      },
                      "Delete"
                    )
                  ),
                  open
                    ? h(
                        "div",
                        { style: { display: "flex", flexDirection: "column", gap: 2, paddingLeft: 12 } },
                        models.length === 0
                          ? h("text", { style: { color: theme.muted, fontSize: 10 } }, "No models in this combo.")
                          : models.map((model, index) =>
                              h(
                                "div",
                                { key: `${model}-${index}`, style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 10 } },
                                h("text", { style: { color: theme.text, fontSize: 10, fontFamily: "Consolas", flexGrow: 1 } }, model),
                                h(
                                  "text",
                                  {
                                    testId: `media-combo-remove-${combo.id}-${index}`,
                                    role: "button",
                                    onClick: busy ? null : () => updateComboModels(combo, models.filter((_, at) => at !== index)),
                                    style: { color: theme.muted, fontSize: 10, cursor: busy ? "default" : "pointer", hover: busy ? {} : { color: theme.text } },
                                  },
                                  "Remove"
                                )
                              )
                            ),
                        candidates.length > 0
                          ? h(
                              "div",
                              { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 3 } },
                              h("text", { style: { color: theme.muted, fontSize: 10 } }, "Add:"),
                              ...candidates.map((entry, index) =>
                                h(
                                  "text",
                                  {
                                    key: `${entry.alias}/${entry.model}`,
                                    testId: `media-combo-add-${combo.id}-${index}`,
                                    role: "button",
                                    onClick: busy ? null : () => updateComboModels(combo, [...models, `${entry.alias}/${entry.model}`]),
                                    style: { color: theme.ok, fontSize: 10, cursor: busy ? "default" : "pointer", hover: busy ? {} : { color: theme.text } },
                                  },
                                  entry.model
                                )
                              )
                            )
                          : null
                      )
                    : null
                );
              }),
          h(
            "text",
            { style: { color: theme.muted, fontSize: 10 } },
            "Reordering media combo models stays on the dashboard."
          )
        )
      : null,
    h(
      "div",
      {
        testId: "media-example",
        style: {
          display: "flex",
          flexDirection: "column",
          backgroundColor: theme.panel,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 10,
          padding: 16,
          gap: 6,
        },
      },
      h(
        "text",
        { style: { color: theme.text, fontSize: 12, fontWeight: 600 } },
        `Example request — ${MEDIA_KINDS.find((entry) => entry.id === kind)?.label || kind}`
      ),
      h(
        "text",
        { testId: "media-example-endpoint", style: { color: theme.ok, fontSize: 11, fontFamily: "Consolas" } },
        `POST ${(status && status.baseUrl) || "http://127.0.0.1:20129"}${MEDIA_KINDS.find((entry) => entry.id === kind)?.endpoint || ""}`
      ),
      ...(() => {
        const exampleUrl = `${(status && status.baseUrl) || "http://127.0.0.1:20129"}${MEDIA_KINDS.find((entry) => entry.id === kind)?.endpoint || ""}`;
        return [
          `curl -X POST "${exampleUrl}" \\`,
          '  -H "Authorization: Bearer <api-key>" \\',
          '  -H "Content-Type: application/json" \\',
          `  -d '{"model":"<model>","input":"<prompt>"}'`,
        ];
      })().map((line, index) =>
        h(
          "text",
          {
            key: index,
            testId: index === 0 ? "media-example-curl" : undefined,
            style: { color: theme.muted, fontSize: 10, fontFamily: "Consolas" },
          },
          line
        )
      ),
      h(
        "text",
        { style: { color: theme.muted, fontSize: 10 } },
        "Provider-specific example cards (voices, sizes, file uploads) stay on the dashboard."
      )
    ),
    h(
      "text",
      { style: { color: theme.muted, fontSize: 11 } },
      "Toggles every connection of that provider. Media combos and provider-specific examples stay on the dashboard."
    )
  );
}
