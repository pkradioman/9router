// Native Providers page: the existing provider connections.
//
// Read plus enable/disable, matching the dashboard list. Adding connections,
// OAuth flows, proxy pools and model tests are not native yet and stay pending.
import React from "react";
import { theme } from "./theme.mjs";

const h = React.createElement;

function ProviderRow({ item, onToggle, onDelete, onUpdate, onTest, busy }) {
  const [editing, setEditing] = React.useState(false);
  const [testState, setTestState] = React.useState({ phase: "idle", message: "" });
  const [draftName, setDraftName] = React.useState(item.name || "");
  const [draftModel, setDraftModel] = React.useState(item.defaultModel || "");
  const [draftPriority, setDraftPriority] = React.useState(
    item.priority === undefined || item.priority === null ? "" : String(item.priority)
  );
  const [draftProxy, setDraftProxy] = React.useState(item.providerSpecificData?.proxyPoolId || "");

  const save = () => {
    const patch = { name: draftName.trim() || item.name };
    patch.defaultModel = draftModel.trim();
    if (draftPriority.trim() !== "") {
      const value = Number(draftPriority);
      if (!Number.isFinite(value)) return;
      patch.priority = value;
    }
    patch.proxyPoolId = draftProxy.trim() || null;
    onUpdate(item, patch);
    setEditing(false);
  };

  const runTest = () => {
    setTestState({ phase: "running", message: "" });
    onTest(item)
      .then((result) => {
        if (result && result.valid) setTestState({ phase: "ok", message: "Test passed" });
        else setTestState({ phase: "fail", message: `Test failed: ${(result && result.error) || "no details"}` });
      })
      .catch((err) => setTestState({ phase: "fail", message: `Test failed: ${err.message}` }));
  };

  return h(
    "div",
    {
      testId: `provider-row-${item.id}`,
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 4,
        paddingTop: 8,
        paddingBottom: 8,
        borderTopWidth: 1,
        borderColor: theme.border,
      },
    },
    h(
      "div",
      { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 12 } },
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, gap: 2 } },
        h("text", { style: { color: theme.text, fontSize: 12, fontWeight: 600 } }, item.name || item.provider),
        h(
          "text",
          { style: { color: theme.muted, fontSize: 11 } },
          [
            item.provider,
            item.authType,
            item.email,
            item.defaultModel,
            item.providerSpecificData?.proxyPoolId ? `proxy ${item.providerSpecificData.proxyPoolId}` : null,
          ]
            .filter(Boolean)
            .join(" · ")
        )
      ),
      h(
        "text",
        {
          testId: `provider-test-${item.id}`,
          role: "button",
          onClick: () => (busy || testState.phase === "running" ? null : runTest()),
          style: {
            color: testState.phase === "ok" ? theme.ok : testState.phase === "fail" ? theme.bad : theme.muted,
            fontSize: 11,
            cursor: busy ? "default" : "pointer",
            hover: busy ? {} : { color: theme.text },
          },
        },
        testState.phase === "running" ? "Testing..." : "Test"
      ),
      h(
        "text",
        {
          testId: `provider-edit-${item.id}`,
          role: "button",
          onClick: () => (busy ? null : setEditing((value) => !value)),
          style: { color: theme.muted, fontSize: 11, cursor: busy ? "default" : "pointer", hover: busy ? {} : { color: theme.text } },
        },
        "Edit"
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
    ),
    testState.phase === "ok" || testState.phase === "fail"
      ? h(
          "text",
          {
            testId: `provider-test-result-${item.id}`,
            style: { color: testState.phase === "ok" ? theme.ok : theme.bad, fontSize: 10 },
          },
          testState.message
        )
      : null,
    editing
      ? h(
          "div",
          { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" } },
          h("input", {
            testId: `provider-name-edit-${item.id}`,
            "aria-label": "Connection name",
            value: draftName,
            onChange: (event) => setDraftName(event.value ?? ""),
            style: { width: 150, height: 26, color: theme.text, backgroundColor: theme.panelAlt },
          }),
          h("input", {
            testId: `provider-model-edit-${item.id}`,
            "aria-label": "Default model",
            value: draftModel,
            onChange: (event) => setDraftModel(event.value ?? ""),
            style: { width: 180, height: 26, color: theme.text, backgroundColor: theme.panelAlt },
          }),
          h("input", {
            testId: `provider-priority-edit-${item.id}`,
            "aria-label": "Priority",
            value: draftPriority,
            onChange: (event) => setDraftPriority(event.value ?? ""),
            onSubmit: save,
            style: { width: 70, height: 26, color: theme.text, backgroundColor: theme.panelAlt },
          }),
          h("input", {
            testId: `provider-proxy-edit-${item.id}`,
            "aria-label": "Proxy pool ID",
            value: draftProxy,
            onChange: (event) => setDraftProxy(event.value ?? ""),
            onSubmit: save,
            placeholder: "proxy pool id (none)",
            style: { width: 150, height: 26, color: theme.text, backgroundColor: theme.panelAlt },
          }),
          h(
            "text",
            {
              testId: `provider-save-${item.id}`,
              role: "button",
              onClick: save,
              style: { color: theme.ok, fontSize: 11, cursor: "pointer", hover: { color: theme.text } },
            },
            "Save"
          )
        )
      : null
  );
}

function NodeRow({ node, onDelete, onUpdate, busy }) {
  const [editing, setEditing] = React.useState(false);
  const [draftName, setDraftName] = React.useState(node.name || "");
  const [draftPrefix, setDraftPrefix] = React.useState(node.prefix || "");
  const [draftUrl, setDraftUrl] = React.useState(node.baseUrl || "");

  const start = () => {
    setDraftName(node.name || "");
    setDraftPrefix(node.prefix || "");
    setDraftUrl(node.baseUrl || "");
    setEditing(true);
  };

  const save = () => {
    const name = draftName.trim();
    const prefix = draftPrefix.trim();
    const baseUrl = draftUrl.trim();
    if (!name || !prefix || !baseUrl) return;
    onUpdate(node, { name, prefix, baseUrl, apiType: node.apiType || "chat" });
    setEditing(false);
  };

  return h(
    "div",
    {
      testId: `node-row-${node.id}`,
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 4,
        paddingTop: 7,
        paddingBottom: 7,
        borderTopWidth: 1,
        borderColor: theme.border,
      },
    },
    h(
      "div",
      { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 12 } },
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
          testId: `node-edit-${node.id}`,
          role: "button",
          onClick: () => (busy ? null : editing ? setEditing(false) : start()),
          style: { color: theme.muted, fontSize: 10, cursor: busy ? "default" : "pointer", hover: busy ? {} : { color: theme.text } },
        },
        "Edit"
      ),
      h(
        "text",
        {
          testId: `node-delete-${node.id}`,
          role: "button",
          onClick: () => (busy ? null : onDelete(node)),
          style: {
            color: theme.bad,
            fontSize: 11,
            cursor: busy ? "default" : "pointer",
            hover: busy ? {} : { color: "#ff9c9c" },
          },
        },
        "Delete"
      )
    ),
    editing
      ? h(
          "div",
          { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" } },
          h("input", {
            testId: `node-name-edit-${node.id}`,
            "aria-label": "Node name",
            value: draftName,
            onChange: (event) => setDraftName(event.value ?? ""),
            style: { width: 140, height: 24, color: theme.text, backgroundColor: theme.panelAlt },
          }),
          h("input", {
            testId: `node-prefix-edit-${node.id}`,
            "aria-label": "Model prefix",
            value: draftPrefix,
            onChange: (event) => setDraftPrefix(event.value ?? ""),
            style: { width: 110, height: 24, color: theme.text, backgroundColor: theme.panelAlt },
          }),
          h("input", {
            testId: `node-url-edit-${node.id}`,
            "aria-label": "Base URL",
            value: draftUrl,
            onChange: (event) => setDraftUrl(event.value ?? ""),
            onSubmit: save,
            style: { width: 260, height: 24, color: theme.text, backgroundColor: theme.panelAlt },
          }),
          h(
            "text",
            {
              testId: `node-save-${node.id}`,
              role: "button",
              onClick: save,
              style: { color: theme.ok, fontSize: 10, cursor: "pointer", hover: { color: theme.text } },
            },
            "Save"
          )
        )
      : null
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
  const [strategies, setStrategies] = React.useState({});
  const [stickyDraft, setStickyDraft] = React.useState({});
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

  const update = (item, patch) => {
    setBusy(true);
    setError("");
    api
      .updateProvider(item.id, patch)
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

  React.useEffect(() => {
    api
      .getSettings()
      .then((settings) => setStrategies((settings && settings.providerStrategies) || {}))
      .catch(() => setStrategies({}));
  }, [api]);

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

  const updateNode = (node, patch) => {
    setBusy(true);
    setError("");
    api
      .updateProviderNode(node.id, patch)
      .then(loadNodes)
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };

  // Provider strategy override lives in settings.providerStrategies keyed by
  // provider id; an empty override removes the entry and restores the global.
  const saveStrategy = (providerId, strategy, sticky) => {
    const updated = { ...strategies };
    if (!strategy) {
      delete updated[providerId];
    } else {
      const override = { fallbackStrategy: strategy };
      if (strategy === "round-robin") {
        const limit = Number(sticky);
        override.stickyRoundRobinLimit = Number.isFinite(limit) && limit > 0 ? limit : 1;
      }
      updated[providerId] = override;
    }
    setBusy(true);
    setError("");
    api
      .patchSettings({ providerStrategies: updated })
      .then((next) => setStrategies((next && next.providerStrategies) || updated))
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
                h(ProviderRow, {
                  key: item.id,
                  item,
                  onToggle: toggle,
                  onDelete: remove,
                  onUpdate: update,
                  onTest: (target) => api.testProvider(target.id),
                  busy,
                })
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
        "API-key connections only, entered without masking (GPUIX has no masked field). OAuth sign-in and per-model tests are not native yet."
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
                h(NodeRow, { key: node.id, node, onDelete: removeNode, onUpdate: updateNode, busy })
              )
            ),
      h(
        "text",
        { style: { color: theme.muted, fontSize: 11 } },
        "Chat-type OpenAI-compatible nodes only; responses routing and per-node options are not native yet."
      )
    ) : null,
    h(
      "div",
      {
        testId: "provider-strategies",
        style: {
          display: "flex",
          flexDirection: "column",
          backgroundColor: theme.panel,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 10,
          padding: 16,
          gap: 8,
        },
      },
      h("text", { style: { color: theme.text, fontSize: 14, fontWeight: 600 } }, "Provider strategies"),
      h(
        "text",
        { style: { color: theme.muted, fontSize: 10 } },
        "Round-robin rotates connections of this provider within the sticky window; Global removes the override."
      ),
      providers === null
        ? h("text", { style: { color: theme.muted, fontSize: 12 } }, "Loading providers...")
        : [...new Set(providers.map((item) => item.provider).filter(Boolean))].map((providerId) => {
            const override = strategies[providerId] || {};
            const roundRobin = override.fallbackStrategy === "round-robin";
            const chip = (testId, label, onClick, color) =>
              h(
                "text",
                {
                  testId,
                  role: "button",
                  onClick: busy ? null : onClick,
                  style: { color: busy ? theme.muted : color, fontSize: 10, cursor: busy ? "default" : "pointer", hover: busy ? {} : { color: theme.text } },
                },
                label
              );
            const stickyValue =
              stickyDraft[providerId] !== undefined
                ? stickyDraft[providerId]
                : String(override.stickyRoundRobinLimit ?? 1);
            return h(
              "div",
              {
                key: providerId,
                testId: `provider-strategy-${providerId}`,
                style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
              },
              h("text", { style: { color: theme.text, fontSize: 11, flexGrow: 1, minWidth: 120 } }, providerId),
              chip(
                `provider-strategy-${providerId}-global`,
                "Global",
                () => saveStrategy(providerId, null),
                roundRobin ? theme.muted : theme.ok
              ),
              chip(
                `provider-strategy-${providerId}-rr`,
                "Round robin",
                () => saveStrategy(providerId, "round-robin", stickyValue),
                roundRobin ? theme.ok : theme.muted
              ),
              h("input", {
                testId: `provider-strategy-${providerId}-sticky`,
                "aria-label": "Sticky round-robin limit",
                value: stickyValue,
                onChange: (event) =>
                  setStickyDraft((value) => ({ ...value, [providerId]: event.value ?? "" })),
                onSubmit: () => saveStrategy(providerId, "round-robin", stickyValue),
                style: { width: 70, height: 24, color: theme.text, backgroundColor: theme.panelAlt },
              }),
              chip(
                `provider-strategy-${providerId}-sticky-save`,
                "Save sticky",
                () => saveStrategy(providerId, "round-robin", stickyValue),
                theme.muted
              )
            );
          })
    )
  );
}
