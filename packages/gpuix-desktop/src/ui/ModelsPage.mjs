// Native model management: what the dashboard does inside a provider page.
//
// Lists every routed model grouped by provider alias, with the same three
// actions the dashboard offers there: enable/disable per model, set or clear a
// public alias, and add/remove custom models. Live model tests stay pending
// because they would spend a real provider account.
import React from "react";
import { theme } from "./theme.mjs";

const h = React.createElement;

// The routed prefix is the provider alias the server uses for disabled lists
// and custom rows; `provider` itself stays the registry id for built-in models.
function providerKey(item) {
  const routed = item.routedModel || "";
  const cut = routed.indexOf("/");
  return cut > 0 ? routed.slice(0, cut) : item.provider;
}

function capsLabel(caps) {
  if (!caps) return "";
  return [caps.vision ? "vision" : null, caps.reasoning ? "reasoning" : null].filter(Boolean).join(" · ");
}

function ModelRow({ item, disabled, isCustom, busy, onToggle, onAlias, onDeleteCustom }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(item.alias || "");

  const saveAlias = () => {
    const value = draft.trim();
    if (value && value !== item.alias) onAlias(item, value);
    else if (!value && item.alias && item.alias !== item.model) onAlias(item, "");
    setEditing(false);
  };

  const caps = capsLabel(item.caps);

  return h(
    "div",
    {
      testId: `model-row-${item.fullModel}`,
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 2,
        paddingTop: 6,
        paddingBottom: 6,
        borderTopWidth: 1,
        borderColor: theme.border,
      },
    },
    h(
      "div",
      { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 12 } },
      h(
        "text",
        { style: { color: disabled ? theme.muted : theme.text, fontSize: 11, flexGrow: 1 } },
        `${item.model}${item.alias && item.alias !== item.model ? `  → ${item.alias}` : ""}${caps ? `  (${caps})` : ""}`
      ),
      isCustom
        ? h("text", { style: { color: theme.muted, fontSize: 10 } }, "custom")
        : null,
      h(
        "text",
        {
          testId: `model-alias-${item.fullModel}`,
          role: "button",
          onClick: () => (busy ? null : setEditing((value) => !value)),
          style: { color: theme.muted, fontSize: 10, cursor: busy ? "default" : "pointer", hover: busy ? {} : { color: theme.text } },
        },
        "Alias"
      ),
      h(
        "text",
        {
          testId: `model-toggle-${item.fullModel}`,
          role: "button",
          onClick: () => (busy ? null : onToggle(item, disabled)),
          style: {
            color: disabled ? theme.muted : theme.ok,
            fontSize: 10,
            cursor: busy ? "default" : "pointer",
            hover: busy ? {} : { color: theme.text },
          },
        },
        disabled ? "Disabled" : "Enabled"
      ),
      isCustom
        ? h(
            "text",
            {
              testId: `model-delete-${item.fullModel}`,
              role: "button",
              onClick: () => (busy ? null : onDeleteCustom(item)),
              style: { color: theme.bad, fontSize: 10, cursor: busy ? "default" : "pointer", hover: busy ? {} : { color: "#ff9c9c" } },
            },
            "Delete"
          )
        : null
    ),
    editing
      ? h(
          "div",
          { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 8 } },
          h("input", {
            testId: `model-alias-input-${item.fullModel}`,
            "aria-label": "Model alias",
            value: draft,
            onChange: (event) => setDraft(event.value ?? ""),
            onSubmit: saveAlias,
            style: { width: 200, height: 24, color: theme.text, backgroundColor: theme.panelAlt },
          }),
          h(
            "text",
            {
              testId: `model-alias-save-${item.fullModel}`,
              role: "button",
              onClick: saveAlias,
              style: { color: theme.ok, fontSize: 10, cursor: "pointer", hover: { color: theme.text } },
            },
            "Save"
          )
        )
      : null
  );
}

export function ModelsPage({ api }) {
  const [models, setModels] = React.useState(null);
  const [disabledMap, setDisabledMap] = React.useState({});
  const [custom, setCustom] = React.useState([]);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [newAlias, setNewAlias] = React.useState("");
  const [newId, setNewId] = React.useState("");

  const load = React.useCallback(() => {
    setError("");
    setModels(null);
    Promise.all([api.getModels(), api.getDisabledModels(), api.listCustomModels()])
      .then(([list, disabled, customList]) => {
        setModels(list);
        setDisabledMap(disabled || {});
        setCustom(customList);
      })
      .catch((err) => {
        setModels([]);
        setError(err.message);
      });
  }, [api]);

  React.useEffect(() => {
    load();
  }, [load]);

  const run = (action) => {
    setBusy(true);
    setError("");
    action()
      .then(load)
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const toggle = (item, isDisabled) => {
    const alias = providerKey(item);
    if (isDisabled) run(() => api.enableModel(alias, item.model));
    else run(() => api.disableModels(alias, [item.model]));
  };

  const setAlias = (item, alias) => {
    if (alias) run(() => api.setModelAlias(item.fullModel, alias));
    else run(() => api.deleteModelAlias(item.alias));
  };

  const enableAll = (providerAlias) => run(() => api.enableAllModels(providerAlias));

  const addCustom = () => {
    if (!newAlias.trim() || !newId.trim()) {
      setError("Custom model needs a provider alias and a model ID.");
      return;
    }
    run(() =>
      api.addCustomModel({ providerAlias: newAlias.trim(), id: newId.trim(), type: "llm" }).then(() => {
        setNewAlias("");
        setNewId("");
      })
    );
  };

  const removeCustom = (item) => run(() => api.deleteCustomModel(providerKey(item), item.model));

  const groups = React.useMemo(() => {
    const map = new Map();
    for (const item of models || []) {
      const key = providerKey(item);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [models]);

  const customKeys = new Set(custom.map((item) => `${item.providerAlias}/${item.id}`));

  const inputStyle = { width: 160, height: 28, color: theme.text, backgroundColor: theme.panelAlt };
  const button = (testId, label, onClick, color) =>
    h(
      "text",
      {
        testId,
        role: "button",
        onClick: busy ? () => {} : onClick,
        style: {
          paddingTop: 5,
          paddingBottom: 5,
          paddingLeft: 10,
          paddingRight: 10,
          borderRadius: 7,
          backgroundColor: theme.panelAlt,
          color: busy ? theme.muted : color || theme.text,
          fontSize: 11,
          cursor: busy ? "default" : "pointer",
          hover: busy ? {} : { backgroundColor: "#2e2e33" },
        },
      },
      label
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
      {
        testId: "models-section",
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
      h("text", { style: { color: theme.text, fontSize: 14, fontWeight: 600 } }, "Routed models"),
      h(
        "div",
        { style: { display: "flex", flexDirection: "row", gap: 10, alignItems: "center", flexWrap: "wrap" } },
        h("input", {
          testId: "custom-model-alias-input",
          "aria-label": "Provider alias",
          value: newAlias,
          onChange: (event) => setNewAlias(event.value ?? ""),
          placeholder: "provider alias",
          style: inputStyle,
        }),
        h("input", {
          testId: "custom-model-id-input",
          "aria-label": "Model ID",
          value: newId,
          onChange: (event) => setNewId(event.value ?? ""),
          onSubmit: addCustom,
          placeholder: "model id",
          style: inputStyle,
        }),
        button("custom-model-add", "Add custom model", addCustom)
      ),
      error ? h("text", { testId: "models-error", style: { color: theme.bad, fontSize: 12 } }, error) : null,
      models === null
        ? h("text", { testId: "models-loading", style: { color: theme.muted, fontSize: 12 } }, "Loading models...")
        : models.length === 0
          ? h("text", { testId: "models-empty", style: { color: theme.muted, fontSize: 12 } }, "No routed models.")
          : h(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: 14 } },
              groups.map(([provider, list]) => {
                const disabledIds = disabledMap[provider] || [];
                return h(
                  "div",
                  {
                    key: provider,
                    testId: `model-group-${provider}`,
                    style: { display: "flex", flexDirection: "column" },
                  },
                  h(
                    "div",
                    { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 10 } },
                    h("text", { style: { color: theme.text, fontSize: 12, fontWeight: 600, flexGrow: 1 } }, `${provider} · ${list.length}`),
                    disabledIds.length > 0
                      ? h(
                          "text",
                          {
                            testId: `model-enable-all-${provider}`,
                            role: "button",
                            onClick: busy ? null : () => enableAll(provider),
                            style: { color: theme.ok, fontSize: 10, cursor: busy ? "default" : "pointer", hover: busy ? {} : { color: theme.text } },
                          },
                          `Enable all (${disabledIds.length})`
                        )
                      : null
                  ),
                  list.map((item) =>
                    h(ModelRow, {
                      key: item.fullModel,
                      item,
                      disabled: disabledIds.includes(item.model),
                      isCustom: customKeys.has(`${item.provider}/${item.model}`),
                      busy,
                      onToggle: toggle,
                      onAlias: setAlias,
                      onDeleteCustom: removeCustom,
                    })
                  )
                );
              })
            ),
      h(
        "text",
        { style: { color: theme.muted, fontSize: 11 } },
        "Same data the dashboard edits inside a provider. Model tests and catalog sync stay on the dashboard because they call provider accounts."
      )
    )
  );
}
