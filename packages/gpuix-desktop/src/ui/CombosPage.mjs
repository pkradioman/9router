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
        "text",
        { style: { color: theme.muted, fontSize: 11 } },
        "The vision/capacity adapter stays on the dashboard."
      )
    )
  );
}
