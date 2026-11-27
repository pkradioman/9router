// Native Endpoint & Key page: the dashboard's landing screen.
//
// Mirrors the parts that make sense in the isolated shell: the local endpoint
// rows, gateway status, and API key management (list, create, enable/disable,
// delete). Tunnel and per-key access controls are not native yet and are called
// out as pending instead of being faked.
import React from "react";
import { theme } from "./theme.mjs";

const h = React.createElement;

function Section({ title, children, testId }) {
  return h(
    "div",
    {
      testId,
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
    h("text", { style: { color: theme.text, fontSize: 14, fontWeight: 600 } }, title),
    children
  );
}

function EndpointRow({ label, value, testId }) {
  return h(
    "div",
    { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 12 } },
    h("text", { style: { color: theme.muted, fontSize: 12, width: 92 } }, label),
    h("text", { testId, style: { color: theme.text, fontSize: 12, flexGrow: 1, minWidth: 0 } }, value)
  );
}

function KeyRow({ item, onToggle, onDelete, onAccess, busy }) {
  const [editing, setEditing] = React.useState(false);
  const [restricted, setRestricted] = React.useState(item.access?.restricted === true);
  const [allow, setAllow] = React.useState((item.access?.allow || []).join(", "));

  const saveAccess = () => {
    const list = allow
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    onAccess(item, { restricted, allow: list });
    setEditing(false);
  };

  return h(
    "div",
    {
      testId: `key-row-${item.id}`,
      style: {
        display: "flex",
        flexDirection: "column",
        paddingTop: 8,
        paddingBottom: 8,
        borderTopWidth: 1,
        borderColor: theme.border,
        gap: 4,
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
          { testId: `key-value-${item.id}`, style: { color: theme.muted, fontSize: 11 } },
          String(item.key || "")
        )
      ),
      h(
        "text",
        {
          testId: `key-access-${item.id}`,
          role: "button",
          onClick: () => (busy ? null : setEditing((value) => !value)),
          style: {
            color: item.access?.restricted ? theme.warn : theme.muted,
            fontSize: 11,
            cursor: busy ? "default" : "pointer",
            hover: busy ? {} : { color: theme.text },
          },
        },
        item.access?.restricted ? "Restricted" : "Unrestricted"
      ),
      h(
        "text",
        {
          testId: `key-toggle-${item.id}`,
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
          testId: `key-delete-${item.id}`,
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
          { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 10 } },
          h(
            "text",
            {
              testId: `key-restrict-${item.id}`,
              role: "button",
              onClick: () => setRestricted((value) => !value),
              style: { color: restricted ? theme.warn : theme.muted, fontSize: 11, cursor: "pointer", hover: { color: theme.text } },
            },
            restricted ? "Restricted: on" : "Restricted: off"
          ),
          h("input", {
            testId: `key-allow-${item.id}`,
            "aria-label": "Allowed models",
            value: allow,
            onChange: (event) => setAllow(event.value ?? ""),
            onSubmit: saveAccess,
            placeholder: "allowed model IDs, comma separated",
            style: { width: 320, height: 28, color: theme.text, backgroundColor: theme.panelAlt },
          }),
          h(
            "text",
            {
              testId: `key-access-save-${item.id}`,
              role: "button",
              onClick: saveAccess,
              style: { color: theme.ok, fontSize: 11, cursor: "pointer", hover: { color: theme.text } },
            },
            "Save access"
          )
        )
      : null
  );
}

export function EndpointPage({ api, status, onRefresh }) {
  const [keys, setKeys] = React.useState(null);
  const [error, setError] = React.useState("");
  const [draftName, setDraftName] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    setError("");
    setKeys(null);
    api
      .listKeys()
      .then(setKeys)
      .catch((err) => {
        setKeys([]);
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
      setError("Enter a key name.");
      return;
    }
    void guard(
      api.createKey(name).then(() => {
        setDraftName("");
        load();
      })
    );
  };

  const toggle = (item) => {
    void guard(api.updateKey(item.id, { isActive: item.isActive === false }).then(load));
  };

  const remove = (item) => {
    void guard(api.deleteKey(item.id).then(load));
  };

  const setAccess = (item, access) => {
    void guard(api.updateKey(item.id, { access }).then(load));
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
      Section,
      { title: "Endpoint", testId: "endpoint-section" },
      h(EndpointRow, { label: "Base URL", value: status.baseUrl, testId: "endpoint-base-url" }),
      h(EndpointRow, { label: "OpenAI API", value: `${status.baseUrl}/v1`, testId: "endpoint-openai" }),
      h(EndpointRow, { label: "Health", value: `${status.baseUrl}/api/health`, testId: "endpoint-health" }),
      h(EndpointRow, { label: "Version", value: status.version || "unknown", testId: "endpoint-version" }),
      status.lastError
        ? h(EndpointRow, { label: "Last error", value: status.lastError, testId: "endpoint-error" })
        : null,
      h(
        "div",
        { style: { display: "flex", flexDirection: "row", gap: 16, alignItems: "center", paddingTop: 4 } },
        h(
          "text",
          {
            testId: "endpoint-refresh",
            role: "button",
            onClick: onRefresh,
            style: { color: theme.ok, fontSize: 12, cursor: "pointer", hover: { color: theme.text } },
          },
          "Refresh status"
        ),
        h("text", { style: { color: theme.muted, fontSize: 11 } }, `Data: ${status.dataDir}`)
      )
    ),
    h(
      Section,
      { title: "API keys", testId: "keys-section" },
      h(
        "div",
        { style: { display: "flex", flexDirection: "row", gap: 12, alignItems: "center" } },
        h("input", {
          testId: "key-name-input",
          "aria-label": "New API key name",
          value: draftName,
          onChange: (event) => setDraftName(event.value ?? ""),
          onSubmit: create,
          placeholder: "Key name",
          style: { width: 220, height: 32, color: theme.text, backgroundColor: theme.panelAlt },
        }),
        h(
          "text",
          {
            testId: "key-create",
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
          "Create key"
        )
      ),
      error ? h("text", { testId: "keys-error", style: { color: theme.bad, fontSize: 12 } }, error) : null,
      keys === null
        ? h("text", { testId: "keys-loading", style: { color: theme.muted, fontSize: 12 } }, "Loading keys...")
        : keys.length === 0
          ? h("text", { testId: "keys-empty", style: { color: theme.muted, fontSize: 12 } }, "No API keys yet.")
          : h(
              "div",
              { style: { display: "flex", flexDirection: "column" } },
              keys.map((item) =>
                h(KeyRow, { key: item.id, item, onToggle: toggle, onDelete: remove, onAccess: setAccess, busy })
              )
            ),
      h(
        "text",
        { style: { color: theme.muted, fontSize: 11 } },
        "Tunnel sharing is not native yet. Access control restricts a key to the listed model IDs."
      )
    )
  );
}
