// Native Providers page: the existing provider connections.
//
// Read plus enable/disable, matching the dashboard list. Adding connections,
// OAuth flows, proxy pools and model tests are not native yet and stay pending.
import React from "react";
import { theme } from "./theme.mjs";

const h = React.createElement;

function ProviderRow({ item, onToggle, onDelete, busy }) {
  return h(
    "div",
    {
      testId: `provider-row-${item.id}`,
      style: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingTop: 8,
        paddingBottom: 8,
        borderTopWidth: 1,
        borderColor: theme.border,
      },
    },
    h(
      "div",
      { style: { display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, gap: 2 } },
      h("text", { style: { color: theme.text, fontSize: 12, fontWeight: 600 } }, item.name || item.provider),
      h(
        "text",
        { style: { color: theme.muted, fontSize: 11 } },
        [item.provider, item.authType, item.email].filter(Boolean).join(" · ")
      )
    ),
    h(
      "text",
      {
        testId: `provider-toggle-${item.id}`,
        role: "button",
        onClick: () => (busy ? null : onToggle(item)),
        style: {
          color: item.isActive === false ? theme.muted : theme.ok,
          fontSize: 11,
          cursor: busy ? "default" : "pointer",
          hover: busy ? {} : { color: theme.text },
        },
      },
      item.isActive === false ? "Disabled" : "Active"
    ),
    h(
      "text",
      {
        testId: `provider-delete-${item.id}`,
        role: "button",
        onClick: () => (busy ? null : onDelete(item)),
        style: { color: theme.bad, fontSize: 11, cursor: busy ? "default" : "pointer", hover: busy ? {} : { color: "#ff9c9c" } },
      },
      "Delete"
    )
  );
}

export function ProvidersPage({ api }) {
  const [providers, setProviders] = React.useState(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [providerId, setProviderId] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [name, setName] = React.useState("");
  const [nodes, setNodes] = React.useState(null);
  const [nodeName, setNodeName] = React.useState("");
  const [nodePrefix, setNodePrefix] = React.useState("");
  const [nodeBaseUrl, setNodeBaseUrl] = React.useState("");
  const [nodesOpen, setNodesOpen] = React.useState(false);

  const load = React.useCallback(() => {
    setError("");
    setProviders(null);
    api
      .listProviders()
      .then(setProviders)
      .catch((err) => {
        setProviders([]);
        setError(err.message);
      });
  }, [api]);

  React.useEffect(() => {
    load();
  }, [load]);

  const toggle = (item) => {
    setBusy(true);
    setError("");
    api
      .updateProvider(item.id, { isActive: item.isActive === false })
      .then(load)
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const create = () => {
    if (!providerId.trim() || !apiKey.trim()) {
      setError("Enter a provider ID and an API key.");
      return;
    }
    setBusy(true);
    setError("");
    api
      .createProvider({ provider: providerId.trim(), apiKey: apiKey.trim(), name: name.trim() || undefined })
      .then(() => {
        setProviderId("");
        setApiKey("");
        setName("");
        load();
      })
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const remove = (item) => {
    setBusy(true);
    setError("");
    api
      .deleteProvider(item.id)
      .then(load)
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const loadNodes = React.useCallback(() => {
    api
      .listProviderNodes()
      .then(setNodes)
      .catch(() => setNodes([]));
  }, [api]);

  React.useEffect(() => {
    loadNodes();
  }, [loadNodes]);

  const createNode = () => {
    if (!nodeName.trim() || !nodePrefix.trim() || !nodeBaseUrl.trim()) {
      setError("Node needs a name, a prefix and a base URL.");
      return;
    }
    setBusy(true);
    setError("");
    api
      .createProviderNode({
        name: nodeName.trim(),
        prefix: nodePrefix.trim(),
        baseUrl: nodeBaseUrl.trim(),
        apiType: "chat",
      })
      .then(() => {
        setNodeName("");
        setNodePrefix("");
        setNodeBaseUrl("");
        loadNodes();
      })
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const removeNode = (node) => {
    setBusy(true);
    setError("");
    api
      .deleteProviderNode(node.id)
      .then(loadNodes)
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const inputStyle = { width: 170, height: 30, color: theme.text, backgroundColor: theme.panelAlt };
  const field = (props) => h("input", { ...props, style: inputStyle });

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
      {
        testId: "providers-section",
        style: {
          display: "flex",
          flexDirection: "column",
          backgroundColor: theme.panel,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 10,
          padding: 16,
          gap: 10,
        },
      },
      h("text", { style: { color: theme.text, fontSize: 14, fontWeight: 600 } }, "Provider connections"),
      h(
        "div",
        { style: { display: "flex", flexDirection: "row", gap: 10, alignItems: "center", flexWrap: "wrap" } },
        field({
          testId: "provider-id-input",
          "aria-label": "Provider ID",
          value: providerId,
          onChange: (event) => setProviderId(event.value ?? ""),
          placeholder: "provider id (e.g. openai)",
        }),
        field({
          testId: "provider-key-input",
          "aria-label": "Provider API key",
          value: apiKey,
          onChange: (event) => setApiKey(event.value ?? ""),
          placeholder: "API key",
        }),
        field({
          testId: "provider-name-input",
          "aria-label": "Connection name",
          value: name,
          onChange: (event) => setName(event.value ?? ""),
          onSubmit: create,
          placeholder: "name (optional)",
        }),
        h(
          "text",
          {
            testId: "provider-create",
            role: "button",
            onClick: busy ? () => {} : create,
            style: {
              paddingTop: 6,
              paddingBottom: 6,
              paddingLeft: 12,
              paddingRight: 12,
              borderRadius: 8,
              backgroundColor: theme.panelAlt,
              color: busy ? theme.muted : theme.text,
              fontSize: 12,
              cursor: busy ? "default" : "pointer",
              hover: busy ? {} : { backgroundColor: "#2e2e33" },
            },
          },
          "Add connection"
        )
      ),
      error ? h("text", { testId: "providers-error", style: { color: theme.bad, fontSize: 12 } }, error) : null,
      providers === null
        ? h("text", { testId: "providers-loading", style: { color: theme.muted, fontSize: 12 } }, "Loading providers...")
        : providers.length === 0
          ? h(
              "text",
              { testId: "providers-empty", style: { color: theme.muted, fontSize: 12 } },
              "No provider connections yet."
            )
          : h(
              "div",
              { style: { display: "flex", flexDirection: "column" } },
              providers.map((item) =>
                h(ProviderRow, { key: item.id, item, onToggle: toggle, onDelete: remove, busy })
              )
            ),
      h(
        "text",
        {
          testId: "nodes-open",
          role: "button",
          onClick: () => setNodesOpen((value) => !value),
          style: { color: theme.ok, fontSize: 11, cursor: "pointer", hover: { color: theme.text } },
        },
        `${nodesOpen ? "Hide" : "Show"} custom nodes (${nodes === null ? "…" : nodes.length})`
      ),
      h(
        "text",
        { style: { color: theme.muted, fontSize: 11 } },
        "API-key connections only, entered without masking (GPUIX has no masked field). OAuth, proxy pools per connection and model tests are not native yet."
      )
    ),
    nodesOpen ? h(
      "div",
      {
        testId: "nodes-section",
        style: {
          display: "flex",
          flexDirection: "column",
          backgroundColor: theme.panel,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 10,
          padding: 16,
          gap: 10,
        },
      },
      h("text", { style: { color: theme.text, fontSize: 14, fontWeight: 600 } }, "Custom provider nodes"),
      h(
        "div",
        { style: { display: "flex", flexDirection: "row", gap: 10, alignItems: "center", flexWrap: "wrap" } },
        field({
          testId: "node-name-input",
          "aria-label": "Node name",
          value: nodeName,
          onChange: (event) => setNodeName(event.value ?? ""),
          placeholder: "node name",
        }),
        field({
          testId: "node-prefix-input",
          "aria-label": "Model prefix",
          value: nodePrefix,
          onChange: (event) => setNodePrefix(event.value ?? ""),
          placeholder: "model prefix",
        }),
        field({
          testId: "node-url-input",
          "aria-label": "Base URL",
          value: nodeBaseUrl,
          onChange: (event) => setNodeBaseUrl(event.value ?? ""),
          onSubmit: createNode,
          placeholder: "https://host/v1",
        }),
        h(
          "text",
          {
            testId: "node-create",
            role: "button",
            onClick: busy ? () => {} : createNode,
            style: {
              paddingTop: 6,
              paddingBottom: 6,
              paddingLeft: 12,
              paddingRight: 12,
              borderRadius: 8,
              backgroundColor: theme.panelAlt,
              color: busy ? theme.muted : theme.text,
              fontSize: 12,
              cursor: busy ? "default" : "pointer",
              hover: busy ? {} : { backgroundColor: "#2e2e33" },
            },
          },
          "Add node"
        )
      ),
      nodes === null
        ? h("text", { testId: "nodes-loading", style: { color: theme.muted, fontSize: 12 } }, "Loading nodes...")
        : nodes.length === 0
          ? h("text", { testId: "nodes-empty", style: { color: theme.muted, fontSize: 12 } }, "No custom nodes yet.")
          : h(
              "div",
              { style: { display: "flex", flexDirection: "column" } },
              nodes.map((node) =>
                h(
                  "div",
                  {
                    key: node.id,
                    testId: `node-row-${node.id}`,
                    style: {
                      display: "flex",
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      paddingTop: 7,
                      paddingBottom: 7,
                      borderTopWidth: 1,
                      borderColor: theme.border,
                    },
                  },
                  h(
                    "div",
                    { style: { display: "flex", flexDirection: "column", flexGrow: 1, gap: 2 } },
                    h("text", { style: { color: theme.text, fontSize: 12 } }, node.name),
                    h(
                      "text",
                      { style: { color: theme.muted, fontSize: 10 } },
                      `${node.prefix} · ${node.baseUrl} · ${node.apiType || node.type}`
                    )
                  ),
                  h(
                    "text",
                    {
                      testId: `node-delete-${node.id}`,
                      role: "button",
                      onClick: () => (busy ? null : removeNode(node)),
                      style: {
                        color: theme.bad,
                        fontSize: 11,
                        cursor: busy ? "default" : "pointer",
                        hover: busy ? {} : { color: "#ff9c9c" },
                      },
                    },
                    "Delete"
                  )
                )
              )
            ),
      h(
        "text",
        { style: { color: theme.muted, fontSize: 11 } },
        "Chat-type OpenAI-compatible nodes only; responses routing and per-node options are not native yet."
      )
    ) : null
  );
}
