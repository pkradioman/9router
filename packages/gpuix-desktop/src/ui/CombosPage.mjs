// Native Combo page: list, create, edit (rename, ordered models, add/remove) and
// delete combos.
//
// Per-combo strategies and the vision adapter stay on the dashboard; the page
// says so instead of pretending to edit them.
import React from "react";
import { theme } from "./theme.mjs";

const h = React.createElement;

function ComboRow({ item, onDelete, onSave, busy }) {
  const models = Array.isArray(item.models) ? item.models : [];
  const [editing, setEditing] = React.useState(false);
  const [draftName, setDraftName] = React.useState(item.name || "");
  const [draftModels, setDraftModels] = React.useState(models);
  const [newModel, setNewModel] = React.useState("");

  const start = () => {
    setDraftName(item.name || "");
    setDraftModels(Array.isArray(item.models) ? item.models : []);
    setNewModel("");
    setEditing(true);
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
          [`${models.length} model${models.length === 1 ? "" : "s"}`, item.kind].filter(Boolean).join(" · ")
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
  const [draftName, setDraftName] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    setError("");
    setCombos(null);
    api
      .listCombos()
      .then(setCombos)
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
    void guard(api.deleteCombo(item.id).then(load));
  };

  const save = (item, patch) => {
    void guard(api.updateCombo(item.id, patch).then(load));
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
              combos.map((item) => h(ComboRow, { key: item.id, item, onDelete: remove, onSave: save, busy }))
            ),
      h(
        "text",
        { style: { color: theme.muted, fontSize: 11 } },
        "Per-combo strategies and the vision adapter stay on the dashboard."
      )
    )
  );
}
