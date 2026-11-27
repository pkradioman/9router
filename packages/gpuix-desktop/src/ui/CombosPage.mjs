// Native Combo page: list, create, edit (rename, ordered models, add/remove),
// set the per-combo strategy and delete combos.
//
// The vision/capacity adapter stays on the dashboard; the page says so instead
// of pretending to edit it.
import React from "react";
import { theme } from "./theme.mjs";

const h = React.createElement;

const STRATEGIES = [
  { value: "fallback", label: "Fallback" },
  { value: "round-robin", label: "Round Robin" },
  { value: "smart", label: "Smart" },
  { value: "fusion", label: "Fusion" },
];

// Capacity adapter: per input modality, an ordered pool the translator falls
// back to when the chosen model cannot take that input. Settings-only.
const CAPACITY_CAPS = [
  { key: "vision", label: "Vision" },
  { key: "pdf", label: "PDF" },
  { key: "audioInput", label: "Audio" },
  { key: "videoInput", label: "Video" },
];

function normalizeCapEntry(entry) {
  if (Array.isArray(entry)) {
    return { enabled: true, roundRobin: false, models: entry.map((item) => item?.model || item).filter(Boolean) };
  }
  if (entry && typeof entry === "object") {
    return {
      enabled: entry.enabled !== false,
      roundRobin: entry.roundRobin === true,
      models: Array.isArray(entry.models) ? entry.models.filter(Boolean) : [],
    };
  }
  return { enabled: true, roundRobin: false, models: [] };
}

function ComboRow({ item, strategy, onDelete, onSave, onStrategy, busy }) {
  const models = Array.isArray(item.models) ? item.models : [];
  const current = strategy.fallbackStrategy || "fallback";
  const [editing, setEditing] = React.useState(false);
  const [draftName, setDraftName] = React.useState(item.name || "");
  const [draftModels, setDraftModels] = React.useState(models);
  const [newModel, setNewModel] = React.useState("");
  const [draftJudge, setDraftJudge] = React.useState(strategy.judgeModel || "");

  const start = () => {
    setDraftName(item.name || "");
    setDraftModels(Array.isArray(item.models) ? item.models : []);
    setNewModel("");
    setDraftJudge(strategy.judgeModel || "");
    setEditing(true);
  };

  const saveJudge = () => {
    const value = draftJudge.trim();
    onStrategy(item, { judgeModel: value || undefined });
  };

  const addModel = () => {
    const value = newModel.trim();
    if (!value) return;
    setDraftModels((list) => [...list, value]);
    setNewModel("");
  };

  const move = (index, delta) => {
    setDraftModels((list) => {
      const next = [...list];
      const target = index + delta;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const save = () => {
    const name = draftName.trim();
    if (!name) return;
    onSave(item, { name, models: draftModels });
    setEditing(false);
  };

  const action = (testId, label, onClick, color) =>
    h(
      "text",
      {
        testId,
        role: "button",
        onClick: busy ? null : onClick,
        style: { color: busy ? theme.muted : color || theme.muted, fontSize: 10, cursor: busy ? "default" : "pointer", hover: busy ? {} : { color: theme.text } },
      },
      label
    );

  return h(
    "div",
    {
      testId: `combo-row-${item.id}`,
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
        h("text", { style: { color: theme.text, fontSize: 12, fontWeight: 600 } }, item.name),
        h(
          "text",
          { style: { color: theme.muted, fontSize: 11 } },
          [`${models.length} model${models.length === 1 ? "" : "s"}`, item.kind, current === "fallback" ? null : current]
            .filter(Boolean)
            .join(" · ")
        )
      ),
      action(`combo-edit-${item.id}`, "Edit", () => (editing ? setEditing(false) : start())),
      h(
        "text",
        {
          testId: `combo-delete-${item.id}`,
          role: "button",
          onClick: () => (busy ? null : onDelete(item)),
          style: { color: theme.bad, fontSize: 11, cursor: busy ? "default" : "pointer", hover: busy ? {} : { color: "#ff9c9c" } },
        },
        "Delete"
      )
    ),
    editing
      ? h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: 6, paddingTop: 4 } },
          h(
            "div",
            { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 8 } },
            h("input", {
              testId: `combo-name-edit-${item.id}`,
              "aria-label": "Combo name",
              value: draftName,
              onChange: (event) => setDraftName(event.value ?? ""),
              style: { width: 200, height: 26, color: theme.text, backgroundColor: theme.panelAlt },
            }),
            action(`combo-save-${item.id}`, "Save", save, theme.ok),
            action(`combo-cancel-${item.id}`, "Cancel", () => setEditing(false))
          ),
          h(
            "div",
            { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" } },
            h("text", { style: { color: theme.muted, fontSize: 10, width: 60 } }, "Strategy"),
            ...STRATEGIES.map((option) =>
              action(
                `combo-strategy-${item.id}-${option.value}`,
                option.label,
                () => onStrategy(item, { fallbackStrategy: option.value }),
                current === option.value ? theme.ok : theme.muted
              )
            )
          ),
          current === "fusion"
            ? h(
                "div",
                { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 8 } },
                h("input", {
                  testId: `combo-judge-${item.id}`,
                  "aria-label": "Fusion judge model",
                  value: draftJudge,
                  onChange: (event) => setDraftJudge(event.value ?? ""),
                  onSubmit: saveJudge,
                  placeholder: "judge model",
                  style: { width: 220, height: 24, color: theme.text, backgroundColor: theme.panelAlt },
                }),
                action(`combo-judge-save-${item.id}`, "Save judge", saveJudge, theme.ok)
              )
            : null,
          draftModels.map((model, index) =>
            h(
              "div",
              { key: `${model}-${index}`, style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 10 } },
              h("text", { style: { color: theme.muted, fontSize: 10, width: 18 } }, String(index + 1)),
              h("text", { style: { color: theme.text, fontSize: 11, flexGrow: 1 } }, model),
              action(`combo-model-up-${item.id}-${index}`, "Up", () => move(index, -1)),
              action(`combo-model-down-${item.id}-${index}`, "Down", () => move(index, 1)),
              action(
                `combo-model-remove-${item.id}-${index}`,
                "Remove",
                () => setDraftModels((list) => list.filter((_, at) => at !== index)),
                theme.bad
              )
            )
          ),
          h(
            "div",
            { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 8 } },
            h("input", {
              testId: `combo-model-add-input-${item.id}`,
              "aria-label": "Model to add",
              value: newModel,
              onChange: (event) => setNewModel(event.value ?? ""),
              onSubmit: addModel,
              placeholder: "provider/model",
              style: { width: 220, height: 26, color: theme.text, backgroundColor: theme.panelAlt },
            }),
            action(`combo-model-add-${item.id}`, "Add model", addModel, theme.ok)
          )
        )
      : null
  );
}

export function CombosPage({ api }) {
  const [combos, setCombos] = React.useState(null);
  const [strategies, setStrategies] = React.useState({});
  const [presets, setPresets] = React.useState(null);
  const [capacity, setCapacity] = React.useState({});
  const [capDraft, setCapDraft] = React.useState({});
  const [draftName, setDraftName] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    setError("");
    setCombos(null);
    Promise.all([api.listCombos(), api.getSettings()])
      .then(([list, settings]) => {
        setCombos(list);
        setStrategies((settings && settings.comboStrategies) || {});
        const raw = (settings && settings.capacityAdapter) || {};
        const normalized = {};
        for (const cap of CAPACITY_CAPS) normalized[cap.key] = normalizeCapEntry(raw[cap.key]);
        setCapacity(normalized);
      })
      .catch((err) => {
        setCombos([]);
        setError(err.message);
      });
  }, [api]);

  React.useEffect(() => {
    load();
  }, [load]);

  const guard = (work) => {
    setBusy(true);
    setError("");
    return Promise.resolve(work)
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const create = () => {
    const name = draftName.trim();
    if (!name) {
      setError("Enter a combo name.");
      return;
    }
    void guard(
      api.createCombo(name).then(() => {
        setDraftName("");
        load();
      })
    );
  };

  const remove = (item) => {
    void guard(
      api
        .deleteCombo(item.id)
        .then(() => {
          if (strategies[item.name] === undefined) return null;
          const updated = { ...strategies };
          delete updated[item.name];
          return api.patchSettings({ comboStrategies: updated });
        })
        .then(load)
    );
  };

  const save = (item, patch) => {
    void guard(api.updateCombo(item.id, patch).then(load));
  };

  // Same merge/prune rule as the dashboard: a fallback-only entry is dropped so
  // settings.comboStrategies stays limited to combos that actually override.
  const saveStrategy = (item, patch) => {
    const updated = { ...strategies };
    const next = { ...(updated[item.name] || {}), ...patch };
    if (!next.fallbackStrategy || next.fallbackStrategy === "fallback") delete updated[item.name];
    else updated[item.name] = next;
    void guard(api.patchSettings({ comboStrategies: updated }).then(load));
  };

  const previewPresets = (source) => {
    setError("");
    setPresets(null);
    api
      .getComboPresets(source)
      .then(setPresets)
      .catch((err) => setError(err.message));
  };

  const createPresets = () => {
    if (!presets) return;
    void guard(
      api.createComboPresets(presets.source).then(() => {
        setPresets(null);
        load();
      })
    );
  };

  const saveCapacity = (key, patch) => {
    const next = { ...capacity, [key]: { ...(capacity[key] || normalizeCapEntry()), ...patch } };
    void guard(api.patchSettings({ capacityAdapter: next }).then(load));
  };

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
        testId: "combos-section",
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
      h("text", { style: { color: theme.text, fontSize: 14, fontWeight: 600 } }, "Combos"),
      h(
        "div",
        { style: { display: "flex", flexDirection: "row", gap: 12, alignItems: "center" } },
        h("input", {
          testId: "combo-name-input",
          "aria-label": "New combo name",
          value: draftName,
          onChange: (event) => setDraftName(event.value ?? ""),
          onSubmit: create,
          placeholder: "Combo name",
          style: { width: 220, height: 32, color: theme.text, backgroundColor: theme.panelAlt },
        }),
        h(
          "text",
          {
            testId: "combo-create",
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
          "Create combo"
        )
      ),
      error ? h("text", { testId: "combos-error", style: { color: theme.bad, fontSize: 12 } }, error) : null,
      h(
        "div",
        { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" } },
        h("text", { style: { color: theme.muted, fontSize: 10 } }, "Presets"),
        h(
          "text",
          {
            testId: "combo-presets-claude",
            role: "button",
            onClick: () => previewPresets("claude"),
            style: { color: theme.ok, fontSize: 11, cursor: "pointer", hover: { color: theme.text } },
          },
          "Preview Claude"
        ),
        h(
          "text",
          {
            testId: "combo-presets-cursor",
            role: "button",
            onClick: () => previewPresets("cursor"),
            style: { color: theme.ok, fontSize: 11, cursor: "pointer", hover: { color: theme.text } },
          },
          "Preview Cursor"
        )
      ),
      presets
        ? h(
            "div",
            {
              testId: "combo-presets-panel",
              style: {
                display: "flex",
                flexDirection: "column",
                gap: 4,
                paddingTop: 6,
                borderTopWidth: 1,
                borderColor: theme.border,
              },
            },
            h(
              "div",
              { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 12 } },
              h(
                "text",
                { style: { color: theme.text, fontSize: 11, flexGrow: 1 } },
                `${presets.source} · ${presets.toCreate} to create · ${presets.toSkip} existing`
              ),
              presets.toCreate > 0
                ? h(
                    "text",
                    {
                      testId: "combo-presets-create",
                      role: "button",
                      onClick: busy ? null : createPresets,
                      style: { color: theme.ok, fontSize: 11, cursor: busy ? "default" : "pointer", hover: busy ? {} : { color: theme.text } },
                    },
                    `Create missing (${presets.toCreate})`
                  )
                : null
            ),
            ...(presets.items || []).map((preset) =>
              h(
                "text",
                { key: preset.name, style: { color: preset.exists ? theme.muted : theme.text, fontSize: 10 } },
                `${preset.name}${preset.exists ? " · exists" : ` · ${(preset.models || []).length} models`}`
              )
            )
          )
        : null,
      combos === null
        ? h("text", { testId: "combos-loading", style: { color: theme.muted, fontSize: 12 } }, "Loading combos...")
        : combos.length === 0
          ? h("text", { testId: "combos-empty", style: { color: theme.muted, fontSize: 12 } }, "No combos yet.")
          : h(
              "div",
              { style: { display: "flex", flexDirection: "column" } },
              combos.map((item) =>
                h(ComboRow, {
                  key: item.id,
                  item,
                  strategy: strategies[item.name] || {},
                  onDelete: remove,
                  onSave: save,
                  onStrategy: saveStrategy,
                  busy,
                })
              )
            ),
      h(
        "div",
        {
          testId: "combos-capacity",
          style: {
            display: "flex",
            flexDirection: "column",
            gap: 8,
            paddingTop: 10,
            borderTopWidth: 1,
            borderColor: theme.border,
          },
        },
        h("text", { style: { color: theme.text, fontSize: 12, fontWeight: 600 } }, "Capacity adapter"),
        h(
          "text",
          { style: { color: theme.muted, fontSize: 10 } },
          "Ordered fallback models the translator uses when the chosen model cannot take that input."
        ),
        ...CAPACITY_CAPS.map((cap) => {
          const entry = capacity[cap.key] || normalizeCapEntry();
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
          return h(
            "div",
            { key: cap.key, testId: `cap-${cap.key}`, style: { display: "flex", flexDirection: "column", gap: 3 } },
            h(
              "div",
              { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 12 } },
              h("text", { style: { color: theme.text, fontSize: 11, flexGrow: 1 } }, cap.label),
              chip(
                `cap-${cap.key}-enabled`,
                entry.enabled ? "Enabled" : "Disabled",
                () => saveCapacity(cap.key, { enabled: entry.enabled !== true }),
                entry.enabled ? theme.ok : theme.muted
              ),
              chip(
                `cap-${cap.key}-rr`,
                entry.roundRobin ? "Round robin" : "Ordered",
                () => saveCapacity(cap.key, { roundRobin: entry.roundRobin !== true }),
                entry.roundRobin ? theme.warn : theme.muted
              )
            ),
            entry.models.map((model, index) =>
              h(
                "div",
                { key: `${model}-${index}`, style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 10 } },
                h("text", { style: { color: theme.muted, fontSize: 10, width: 18 } }, String(index + 1)),
                h("text", { style: { color: theme.text, fontSize: 10, flexGrow: 1 } }, model),
                chip(
                  `cap-${cap.key}-remove-${index}`,
                  "Remove",
                  () => saveCapacity(cap.key, { models: entry.models.filter((_, at) => at !== index) }),
                  theme.bad
                )
              )
            ),
            h(
              "div",
              { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 8 } },
              h("input", {
                testId: `cap-${cap.key}-input`,
                "aria-label": `${cap.label} fallback model`,
                value: capDraft[cap.key] || "",
                onChange: (event) =>
                  setCapDraft((value) => ({ ...value, [cap.key]: event.value ?? "" })),
                style: { width: 220, height: 24, color: theme.text, backgroundColor: theme.panelAlt },
              }),
              chip(
                `cap-${cap.key}-add`,
                "Add model",
                () => {
                  const model = (capDraft[cap.key] || "").trim();
                  if (!model) return;
                  saveCapacity(cap.key, { models: [...entry.models, model] });
                  setCapDraft((value) => ({ ...value, [cap.key]: "" }));
                },
                theme.ok
              )
            )
          );
        })
      ),
      h(
        "text",
        { style: { color: theme.muted, fontSize: 11 } },
        "Cursor presets resolve its live catalog when a cursor connection is active."
      )
    )
  );
}
