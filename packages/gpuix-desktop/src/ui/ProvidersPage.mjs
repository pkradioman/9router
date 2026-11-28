// Native Providers page: the existing provider connections.
//
// Read plus enable/disable, matching the dashboard list. Adding connections,
// OAuth flows, proxy pools and model tests are not native yet and stay pending.
import React from "react";
import { theme } from "./theme.mjs";
import {
  PING_SCHEDULE_DEFAULTS,
  getLocalTimezone,
  getScheduleSlotLabels,
} from "../../../../src/shared/services/quotaPingSchedule.js";

const h = React.createElement;

// Same settings keys as the dashboard (AUTO_PING_SETTINGS_KEYS).
export const AUTO_PING_KEYS = { claude: "claudeAutoPing", codex: "codexAutoPing" };

function ProviderRow({ item, onToggle, onDelete, onUpdate, onTest, busy, autoPing, onSaveAutoPing }) {
  const [editing, setEditing] = React.useState(false);
  const [testState, setTestState] = React.useState({ phase: "idle", message: "" });
  const [draftName, setDraftName] = React.useState(item.name || "");
  const [draftModel, setDraftModel] = React.useState(item.defaultModel || "");
  const [draftPriority, setDraftPriority] = React.useState(
    item.priority === undefined || item.priority === null ? "" : String(item.priority)
  );
  const [draftProxy, setDraftProxy] = React.useState(item.providerSpecificData?.proxyPoolId || "");
  const schedule = autoPing && autoPing.schedules ? autoPing.schedules[item.id] : null;
  const reactiveOn = Boolean(autoPing && autoPing.connections && autoPing.connections[item.id] === true);
  const scheduleOn = Boolean(schedule && schedule.enabled === true);
  const [pingAnchor, setPingAnchor] = React.useState((schedule && schedule.anchor) || PING_SCHEDULE_DEFAULTS.anchor);
  const [pingWindow, setPingWindow] = React.useState(String((schedule && schedule.windowHours) || PING_SCHEDULE_DEFAULTS.windowHours));
  const [pingSlots, setPingSlots] = React.useState(String((schedule && schedule.slotsPerDay) || PING_SCHEDULE_DEFAULTS.slotsPerDay));
  React.useEffect(() => {
    if (!schedule) return;
    setPingAnchor(schedule.anchor || PING_SCHEDULE_DEFAULTS.anchor);
    setPingWindow(String(schedule.windowHours || PING_SCHEDULE_DEFAULTS.windowHours));
    setPingSlots(String(schedule.slotsPerDay || PING_SCHEDULE_DEFAULTS.slotsPerDay));
  }, [schedule]);

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
            (() => {
              const expires = item.expiresAt || item.tokenExpiresAt;
              if (!expires) return null;
              const at = new Date(expires);
              if (Number.isNaN(at.getTime())) return null;
              return `expires ${at.toISOString().slice(0, 10)}`;
            })(),
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
    autoPing && item.authType === "oauth"
      ? (() => {
          const pingChip = (testId, label, active, onClick) =>
            h(
              "text",
              {
                testId,
                role: "button",
                onClick: busy ? null : onClick,
                style: {
                  color: busy ? theme.muted : active ? theme.ok : theme.muted,
                  fontSize: 10,
                  cursor: busy ? "default" : "pointer",
                  hover: busy ? {} : { color: theme.text },
                },
              },
              label
            );
          const saveSchedule = () => {
            if (!pingAnchor.trim() || !Number(pingWindow) || !Number(pingSlots)) return;
            onSaveAutoPing(item.id, {
              reactive: false,
              schedule: {
                enabled: true,
                anchor: pingAnchor.trim(),
                timezone: getLocalTimezone(),
                windowHours: Number(pingWindow),
                slotsPerDay: Number(pingSlots),
              },
            });
          };
          return h(
            "div",
            { testId: `provider-autoping-${item.id}`, style: { display: "flex", flexDirection: "column", gap: 4, paddingTop: 2 } },
            h(
              "div",
              { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" } },
              h("text", { style: { color: theme.muted, fontSize: 10 } }, "Auto-ping:"),
              pingChip(`provider-autoping-off-${item.id}`, "Off", !reactiveOn && !scheduleOn, () =>
                onSaveAutoPing(item.id, { reactive: false, schedule: { enabled: false } })
              ),
              pingChip(`provider-autoping-reset-${item.id}`, "On reset", reactiveOn, () =>
                onSaveAutoPing(item.id, { reactive: true, schedule: { enabled: false } })
              ),
              pingChip(`provider-autoping-schedule-${item.id}`, "Schedule", scheduleOn, saveSchedule),
              h(
                "text",
                { testId: `provider-autoping-summary-${item.id}`, style: { color: theme.muted, fontSize: 10, flexGrow: 1 } },
                scheduleOn ? getScheduleSlotLabels(schedule).join(" / ") : reactiveOn ? "after each reset" : "off"
              )
            ),
            scheduleOn
              ? h(
                  "div",
                  { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" } },
                  h("input", {
                    testId: `provider-autoping-anchor-${item.id}`,
                    "aria-label": "Anchor time",
                    value: pingAnchor,
                    onChange: (event) => setPingAnchor(event.value ?? ""),
                    onSubmit: saveSchedule,
                    style: { width: 66, height: 24, color: theme.text, backgroundColor: theme.panelAlt },
                  }),
                  h("input", {
                    testId: `provider-autoping-window-${item.id}`,
                    "aria-label": "Window hours",
                    value: pingWindow,
                    onChange: (event) => setPingWindow(event.value ?? ""),
                    onSubmit: saveSchedule,
                    style: { width: 50, height: 24, color: theme.text, backgroundColor: theme.panelAlt },
                  }),
                  h("input", {
                    testId: `provider-autoping-slots-${item.id}`,
                    "aria-label": "Pings per day",
                    value: pingSlots,
                    onChange: (event) => setPingSlots(event.value ?? ""),
                    onSubmit: saveSchedule,
                    style: { width: 46, height: 24, color: theme.text, backgroundColor: theme.panelAlt },
                  }),
                  h(
                    "text",
                    {
                      testId: `provider-autoping-save-${item.id}`,
                      role: "button",
                      onClick: busy ? null : saveSchedule,
                      style: { color: theme.ok, fontSize: 10, cursor: busy ? "default" : "pointer", hover: busy ? {} : { color: theme.text } },
                    },
                    "Save schedule"
                  ),
                  h(
                    "text",
                    { style: { color: theme.muted, fontSize: 10 } },
                    `anchor / window hours / pings per day · ${getLocalTimezone()}`
                  )
                )
              : null
          );
        })()
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
  const [validateResult, setValidateResult] = React.useState(null);
  const [nodes, setNodes] = React.useState(null);
  const [strategies, setStrategies] = React.useState({});
  const [autoPing, setAutoPing] = React.useState({});
  const [stickyDraft, setStickyDraft] = React.useState({});
  const [availability, setAvailability] = React.useState(null);
  const [nodeName, setNodeName] = React.useState("");
  const [nodePrefix, setNodePrefix] = React.useState("");
  const [nodeBaseUrl, setNodeBaseUrl] = React.useState("");
  const [nodeType, setNodeType] = React.useState("openai-compatible");
  const [nodeApiType, setNodeApiType] = React.useState("chat");
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
    // The gateway exempts ollama-local from the API-key requirement.
    const keyOptional = providerId.trim() === "ollama-local";
    if (!providerId.trim() || (!apiKey.trim() && !keyOptional)) {
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

  // Key check against the provider before creating the connection; one real
  // request with the entered key, same as the dashboard's add dialog.
  const validateDraft = () => {
    const keyOptional = providerId.trim() === "ollama-local";
    if (!providerId.trim() || (!apiKey.trim() && !keyOptional)) {
      setError("Enter a provider ID and an API key first.");
      return;
    }
    setBusy(true);
    setError("");
    setValidateResult(null);
    api
      .validateProvider(providerId.trim(), apiKey.trim())
      .then((body) => setValidateResult(body || null))
      .catch((err) => {
        setValidateResult({ valid: false, error: err.message });
      })
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
      .then((settings) => {
        setStrategies((settings && settings.providerStrategies) || {});
        const ping = {};
        for (const [provider, key] of Object.entries(AUTO_PING_KEYS)) {
          ping[provider] = (settings && settings[key]) || {};
        }
        setAutoPing(ping);
      })
      .catch(() => {
        setStrategies({});
        setAutoPing({});
      });
  }, [api]);

  // Cooldown locks and unavailable connections come from the gateway's own
  // connection rows, so this is a read of real routing state, not a probe.
  const loadAvailability = React.useCallback(() => {
    api
      .getModelAvailability()
      .then((body) => setAvailability((body && body.models) || []))
      .catch(() => setAvailability([]));
  }, [api]);

  React.useEffect(() => {
    loadAvailability();
  }, [loadAvailability]);

  const clearCooldown = (provider, model) => {
    setBusy(true);
    setError("");
    api
      .clearModelCooldown(provider, model)
      .then(loadAvailability)
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const createNode = () => {
    if (!nodeName.trim() || !nodePrefix.trim() || !nodeBaseUrl.trim()) {
      setError("Node needs a name, a prefix and a base URL.");
      return;
    }
    const payload = {
      name: nodeName.trim(),
      prefix: nodePrefix.trim(),
      baseUrl: nodeBaseUrl.trim(),
      type: nodeType,
    };
    if (nodeType === "openai-compatible") payload.apiType = nodeApiType;
    setBusy(true);
    setError("");
    api
      .createProviderNode(payload)
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

  // Auto-ping lives in one settings key per provider (claudeAutoPing,
  // codexAutoPing) holding { connections, schedules } maps keyed by connection.
  const saveAutoPing = (providerId, connectionId, change) => {
    const key = AUTO_PING_KEYS[providerId];
    if (!key) return;
    const current = autoPing[providerId] || {};
    const next = {
      connections: { ...(current.connections || {}), [connectionId]: change.reactive === true },
      schedules: { ...(current.schedules || {}), [connectionId]: change.schedule || { enabled: false } },
    };
    setBusy(true);
    setError("");
    api
      .patchSettings({ [key]: next })
      .then((settings) => {
        const saved = (settings && settings[key]) || next;
        setAutoPing((map) => ({ ...map, [providerId]: saved }));
      })
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const inputStyle = { width: 170, height: 30, color: theme.text, backgroundColor: theme.panelAlt };
  const field = (props) => h("input", { ...props, style: inputStyle });

  const availabilityIssues = availability || [];
  const availabilityGroups = availabilityIssues.reduce((map, item) => {
    const key = item.provider || "unknown";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
    return map;
  }, new Map());

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
        ),
        h(
          "text",
          {
            testId: "provider-validate",
            role: "button",
            onClick: busy ? () => {} : validateDraft,
            style: { color: busy ? theme.muted : theme.muted, fontSize: 11, cursor: busy ? "default" : "pointer", hover: busy ? {} : { color: theme.text } },
          },
          "Validate key"
        )
      ),
      validateResult
        ? h(
            "text",
            {
              testId: "provider-validate-result",
              style: { color: validateResult.valid ? theme.ok : theme.bad, fontSize: 11 },
            },
            validateResult.valid ? "Key valid" : `Invalid: ${validateResult.error || "rejected by provider"}`
          )
        : null,
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
                  autoPing: AUTO_PING_KEYS[item.provider] ? autoPing[item.provider] || {} : null,
                  onSaveAutoPing: (connectionId, change) => saveAutoPing(item.provider, connectionId, change),
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
        { style: { display: "flex", flexDirection: "row", gap: 14, alignItems: "center", flexWrap: "wrap" } },
        ...[
          ["openai-compatible", "OpenAI compatible"],
          ["anthropic-compatible", "Anthropic compatible"],
          ["custom-embedding", "Embedding"],
        ].map(([id, label]) =>
          h(
            "text",
            {
              key: id,
              testId: `node-type-${id}`,
              role: "button",
              onClick: busy ? null : () => setNodeType(id),
              style: {
                color: nodeType === id ? theme.ok : theme.muted,
                fontSize: 10,
                cursor: busy ? "default" : "pointer",
                hover: busy ? {} : { color: theme.text },
              },
            },
            label
          )
        ),
        nodeType === "openai-compatible"
          ? h(
              "div",
              { style: { display: "flex", flexDirection: "row", gap: 12, alignItems: "center" } },
              ...[
                ["chat", "api chat"],
                ["responses", "api responses"],
              ].map(([id, label]) =>
                h(
                  "text",
                  {
                    key: id,
                    testId: `node-apitype-${id}`,
                    role: "button",
                    onClick: busy ? null : () => setNodeApiType(id),
                    style: {
                      color: nodeApiType === id ? theme.ok : theme.muted,
                      fontSize: 10,
                      cursor: busy ? "default" : "pointer",
                      hover: busy ? {} : { color: theme.text },
                    },
                  },
                  label
                )
              )
            )
          : null
      ),
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
        "Creates OpenAI-compatible (chat/responses), Anthropic-compatible or custom-embedding nodes; per-node options stay on the dashboard."
      )
    ) : null,
    h(
      "div",
      {
        testId: "availability-section",
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
      h(
        "div",
        { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 12 } },
        h("text", { style: { color: theme.text, fontSize: 14, fontWeight: 600 } }, "Model availability"),
        h(
          "text",
          {
            testId: "availability-summary",
            style: { color: availabilityIssues.length === 0 ? theme.ok : theme.warn, fontSize: 11 },
          },
          availability === null
            ? "Loading..."
            : availabilityIssues.length === 0
              ? "All models available"
              : `${availabilityIssues.length} model issue${availabilityIssues.length === 1 ? "" : "s"}`
        ),
        h("div", { style: { flexGrow: 1 } }),
        h(
          "text",
          {
            testId: "availability-refresh",
            role: "button",
            onClick: loadAvailability,
            style: { color: theme.muted, fontSize: 10, cursor: "pointer", hover: { color: theme.text } },
          },
          "Refresh"
        )
      ),
      availability === null
        ? null
        : availabilityIssues.length === 0
          ? h(
              "text",
              { testId: "availability-ok", style: { color: theme.muted, fontSize: 11 } },
              "No cooldowns or unavailable connections right now."
            )
          : h(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: 6 } },
              [...availabilityGroups.entries()].map(([provider, items]) =>
                h(
                  "div",
                  { key: provider, style: { display: "flex", flexDirection: "column", gap: 2 } },
                  h("text", { style: { color: theme.text, fontSize: 11, fontWeight: 600 } }, provider),
                  ...items.map((item) =>
                    h(
                      "div",
                      {
                        key: `${item.connectionId || ""}-${item.model}`,
                        testId: `availability-row-${provider}-${item.model}`,
                        style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 10 },
                      },
                      h(
                        "text",
                        { style: { color: theme.text, fontSize: 10, fontFamily: "Consolas", minWidth: 160 } },
                        item.model === "__all" ? "all models" : item.model
                      ),
                      h(
                        "text",
                        {
                          style: {
                            color: item.status === "cooldown" ? theme.warn : theme.bad,
                            fontSize: 10,
                            width: 78,
                          },
                        },
                        item.status === "cooldown"
                          ? `cooldown${item.until ? ` · ${new Date(item.until).toLocaleString()}` : ""}`
                          : "unavailable"
                      ),
                      h("text", { style: { color: theme.muted, fontSize: 10, flexGrow: 1 } }, item.connectionName || ""),
                      item.status === "cooldown"
                        ? h(
                            "text",
                            {
                              testId: `availability-clear-${provider}-${item.model}`,
                              role: "button",
                              onClick: busy ? null : () => clearCooldown(provider, item.model),
                              style: { color: theme.muted, fontSize: 10, cursor: busy ? "default" : "pointer", hover: busy ? {} : { color: theme.text } },
                            },
                            "Clear"
                          )
                        : null
                    )
                  )
                )
              )
            )
    ),
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
