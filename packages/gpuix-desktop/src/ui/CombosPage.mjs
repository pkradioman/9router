// Native Combo page: list, create (empty) and delete combos.
//
// Model ordering, strategies and vision-adapter settings are not native yet;
// the page says so instead of pretending to edit them.
import React from "react";
import { theme } from "./theme.mjs";

const h = React.createElement;

function ComboRow({ item, onDelete, busy }) {
  const models = Array.isArray(item.models) ? item.models : [];
  return h(
    "div",
    {
      testId: `combo-row-${item.id}`,
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
      h("text", { style: { color: theme.text, fontSize: 12, fontWeight: 600 } }, item.name),
      h(
        "text",
        { style: { color: theme.muted, fontSize: 11 } },
        [`${models.length} model${models.length === 1 ? "" : "s"}`, item.kind].filter(Boolean).join(" · ")
      )
    ),
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
              combos.map((item) => h(ComboRow, { key: item.id, item, onDelete: remove, busy }))
            ),
      h(
        "text",
        { style: { color: theme.muted, fontSize: 11 } },
        "Model ordering, strategies and vision adapter are not native yet."
      )
    )
  );
}
