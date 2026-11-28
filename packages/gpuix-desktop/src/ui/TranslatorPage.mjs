// Native Translator viewer: the seven request-translation step files.
//
// Read-only slice: load and inspect each captured step. Editing, re-translating
// and sending back to the client stay in the dashboard because they write files
// and call a model.
import React from "react";
import { theme } from "./theme.mjs";

const h = React.createElement;

const STEPS = [
  { id: 1, label: "Client Request", file: "1_req_client.json" },
  { id: 2, label: "Source Body", file: "2_req_source.json" },
  { id: 3, label: "OpenAI Intermediate", file: "3_req_openai.json" },
  { id: 4, label: "Target Request", file: "4_req_target.json" },
  { id: 5, label: "Provider Response", file: "5_res_provider.txt" },
  { id: 6, label: "OpenAI Response", file: "6_res_openai.txt" },
  { id: 7, label: "Client Response", file: "7_res_client.txt" },
];

export function TranslatorPage({ api }) {
  const [active, setActive] = React.useState(1);
  const [content, setContent] = React.useState(null);
  const [error, setError] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [status, setStatus] = React.useState("");

  const step = STEPS.find((item) => item.id === active);
  const load = React.useCallback(
    (target) => {
      setError("");
      setStatus("");
      setEditing(false);
      setContent(null);
      api
        .getTranslatorFile(target.file)
        .then(setContent)
        .catch((err) => {
          setContent("");
          setError(err.message);
        });
    },
    [api]
  );

  React.useEffect(() => {
    load(step);
  }, [load, step]);

  const startEdit = () => {
    setDraft(content || "");
    setStatus("");
    setEditing(true);
  };

  const save = () => {
    setStatus("Saving...");
    Promise.resolve(api.saveTranslatorFile(step.file, draft))
      .then(() => {
        setContent(draft);
        setEditing(false);
        setStatus("Saved.");
      })
      .catch((err) => setStatus(err.message));
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
        gap: 12,
      },
    },
    h(
      "div",
      { style: { display: "flex", flexDirection: "row", gap: 8, flexWrap: "wrap" } },
      ...STEPS.map((item) =>
        h(
          "text",
          {
            key: item.id,
            testId: `translator-step-${item.id}`,
            role: "button",
            onClick: () => setActive(item.id),
            style: {
              paddingTop: 5,
              paddingBottom: 5,
              paddingLeft: 10,
              paddingRight: 10,
              borderRadius: 999,
              backgroundColor: active === item.id ? theme.panelAlt : "transparent",
              borderWidth: 1,
              borderColor: active === item.id ? theme.border : "transparent",
              color: active === item.id ? theme.text : theme.muted,
              fontSize: 11,
              cursor: "pointer",
              hover: { color: theme.text },
            },
          },
          `${item.id}. ${item.label}`
        )
      )
    ),
    h(
      "div",
      {
        testId: "translator-section",
        style: {
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          minHeight: 0,
          backgroundColor: theme.panel,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 10,
          padding: 12,
          gap: 6,
        },
      },
      h(
        "div",
        { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 12 } },
        h("text", { style: { color: theme.muted, fontSize: 11, flexGrow: 1 } }, step.file),
        editing
          ? h(
              "text",
              { testId: "translator-save", role: "button", onClick: save, style: { color: theme.ok, fontSize: 11, cursor: "pointer", hover: { color: theme.text } } },
              "Save"
            )
          : content !== null
            ? h(
                "text",
                { testId: "translator-edit", role: "button", onClick: startEdit, style: { color: theme.muted, fontSize: 11, cursor: "pointer", hover: { color: theme.text } } },
                "Edit"
              )
            : null,
        editing
          ? h(
              "text",
              { testId: "translator-cancel", role: "button", onClick: () => setEditing(false), style: { color: theme.muted, fontSize: 11, cursor: "pointer", hover: { color: theme.text } } },
              "Cancel"
            )
          : null,
        status ? h("text", { testId: "translator-status", style: { color: status === "Saved." ? theme.ok : theme.muted, fontSize: 10 } }, status) : null
      ),
      error ? h("text", { testId: "translator-error", style: { color: theme.bad, fontSize: 11 } }, error) : null,
      content === null
        ? h("text", { testId: "translator-loading", style: { color: theme.muted, fontSize: 11 } }, "Loading...")
        : editing
          ? h("input", {
              testId: "translator-edit-input",
              "aria-label": "File content",
              value: draft,
              onChange: (event) => setDraft(event.value ?? ""),
              onSubmit: save,
              style: { height: 26, color: theme.text, backgroundColor: theme.panelAlt, fontFamily: "Consolas" },
            })
          : content === ""
            ? h("text", { testId: "translator-empty", style: { color: theme.muted, fontSize: 11 } }, "No captured content.")
            : h(
                "text",
                { testId: "translator-content", style: { color: theme.text, fontSize: 10, fontFamily: "Consolas" } },
                content.length > 8000 ? `${content.slice(0, 8000)}\n... (truncated)` : content
              ),
      h(
        "text",
        { style: { color: theme.muted, fontSize: 11 } },
        "Editing saves the captured file; re-translating and sending back stay in the dashboard. The editor is single-line, so keys are easiest to edit."
      )
    )
  );
}
