// Native Proxy Pools page: list, add (name + URL), enable/disable, delete.
//
// Pool types beyond plain HTTP proxies, strict mode and connection bindings are
// not native yet and stay pending.
import React from "react";
import { theme } from "./theme.mjs";

const h = React.createElement;

function PoolRow({ item, onToggle, onDelete, busy }) {
  return h(
    "div",
    {
      testId: `pool-row-${item.id}`,
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
      h("text", { style: { color: theme.muted, fontSize: 11 } }, `${item.type || "http"} · ${item.proxyUrl}`)
    ),
    h(
      "text",
      {
        testId: `pool-toggle-${item.id}`,
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
        testId: `pool-delete-${item.id}`,
        role: "button",
        onClick: () => (busy ? null : onDelete(item)),
        style: { color: theme.bad, fontSize: 11, cursor: busy ? "default" : "pointer", hover: busy ? {} : { color: "#ff9c9c" } },
      },
      "Delete"
    )
  );
}

export function ProxyPoolsPage({ api }) {
  const [pools, setPools] = React.useState(null);
  const [name, setName] = React.useState("");
  const [proxyUrl, setProxyUrl] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    setError("");
    setPools(null);
    api
      .listProxyPools()
      .then(setPools)
      .catch((err) => {
        setPools([]);
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
    if (!name.trim() || !proxyUrl.trim()) {
      setError("Enter a name and a proxy URL.");
      return;
    }
    void guard(
      api.createProxyPool({ name: name.trim(), proxyUrl: proxyUrl.trim(), type: "http" }).then(() => {
        setName("");
        setProxyUrl("");
        load();
      })
    );
  };

  const toggle = (item) => {
    void guard(api.updateProxyPool(item.id, { isActive: item.isActive === false }).then(load));
  };

  const remove = (item) => {
    void guard(api.deleteProxyPool(item.id).then(load));
  };

  const input = (props) =>
    h("input", {
      ...props,
      style: { width: 200, height: 32, color: theme.text, backgroundColor: theme.panelAlt },
    });

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
        testId: "pools-section",
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
      h("text", { style: { color: theme.text, fontSize: 14, fontWeight: 600 } }, "Proxy pools"),
      h(
        "div",
        { style: { display: "flex", flexDirection: "row", gap: 12, alignItems: "center" } },
        input({
          testId: "pool-name-input",
          "aria-label": "Proxy pool name",
          value: name,
          onChange: (event) => setName(event.value ?? ""),
          placeholder: "Pool name",
        }),
        input({
          testId: "pool-url-input",
          "aria-label": "Proxy URL",
          value: proxyUrl,
          onChange: (event) => setProxyUrl(event.value ?? ""),
          onSubmit: create,
          placeholder: "http://proxy:8080",
        }),
        h(
          "text",
          {
            testId: "pool-create",
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
          "Add pool"
        )
      ),
      error ? h("text", { testId: "pools-error", style: { color: theme.bad, fontSize: 12 } }, error) : null,
      pools === null
        ? h("text", { testId: "pools-loading", style: { color: theme.muted, fontSize: 12 } }, "Loading pools...")
        : pools.length === 0
          ? h("text", { testId: "pools-empty", style: { color: theme.muted, fontSize: 12 } }, "No proxy pools yet.")
          : h(
              "div",
              { style: { display: "flex", flexDirection: "column" } },
              pools.map((item) => h(PoolRow, { key: item.id, item, onToggle: toggle, onDelete: remove, busy }))
            ),
      h("text", { style: { color: theme.muted, fontSize: 11 } }, "Named proxy types, strict mode and bindings are not native yet.")
    )
  );
}
