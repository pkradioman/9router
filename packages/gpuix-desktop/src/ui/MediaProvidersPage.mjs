// Native media-provider overview: the dashboard's per-kind listing pages.
//
// Provider kinds come from a generated snapshot of the gateway registry
// (scripts/gen-media-providers.mjs) because the staged runtime exposes no
// catalog endpoint. Connection counts and toggles read and write the real
// /api/providers rows; custom embedding nodes join the embedding kind.
import React from "react";
import { theme } from "./theme.mjs";
import { MEDIA_PROVIDERS } from "./media-providers.generated.mjs";

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

export function MediaProvidersPage({ api }) {
  const [kind, setKind] = React.useState("image");
  const [connections, setConnections] = React.useState(null);
  const [nodes, setNodes] = React.useState([]);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    setError("");
    setConnections(null);
    Promise.all([api.listProviders(), api.listProviderNodes()])
      .then(([conns, nodeList]) => {
        setConnections(conns);
        setNodes((nodeList || []).filter((node) => node.type === "custom-embedding"));
      })
      .catch((err) => {
        setConnections([]);
        setNodes([]);
        setError(err.message);
      });
  }, [api]);

  React.useEffect(() => {
    load();
  }, [load]);

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

  const base = providersForKind(kind);
  const custom =
    kind === "embedding"
      ? nodes.map((node) => ({ id: node.id, name: node.name, kinds: ["embedding"], noAuth: false, custom: true }))
      : [];
  const entries = [...base, ...custom];

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
    h(
      "div",
      { style: { display: "flex", flexDirection: "row", gap: 14, flexWrap: "wrap" } },
      ...MEDIA_KINDS.map((entry) =>
        chip(`media-kind-${entry.id}`, entry.label, () => setKind(entry.id), kind === entry.id, providersForKind(entry.id).length)
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
              return h(
                "div",
                {
                  key: entry.id,
                  testId: `media-provider-${entry.id}`,
                  style: {
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingTop: 6,
                    paddingBottom: 6,
                    borderTopWidth: 1,
                    borderColor: theme.border,
                  },
                },
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
                conns.length > 0
                  ? h(
                      "text",
                      {
                        testId: `media-toggle-${entry.id}`,
                        role: "button",
                        onClick: busy ? null : () => toggleProvider(entry.id),
                        style: {
                          color: busy ? theme.muted : theme.muted,
                          fontSize: 10,
                          cursor: busy ? "default" : "pointer",
                          hover: busy ? {} : { color: theme.text },
                        },
                      },
                      allDisabled ? "Enable" : "Disable"
                    )
                  : null
              );
            })
    ),
    h(
      "text",
      { style: { color: theme.muted, fontSize: 11 } },
      "Toggles every connection of that provider. Per-model media lists, example requests and media combos stay on the dashboard."
    )
  );
}
