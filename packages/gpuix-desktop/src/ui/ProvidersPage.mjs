// Native Providers page: the existing provider connections.
//
// Read plus enable/disable, matching the dashboard list. Adding connections,
// OAuth flows, proxy pools and model tests are not native yet and stay pending.
import React from "react";
import { theme } from "./theme.mjs";

const h = React.createElement;

function ProviderRow({ item, onToggle, busy }) {
  return h(
    "div",
    {
      testId: `provider-row-${item.id}`,
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
      h("text", { style: { color: theme.text, fontSize: 12, fontWeight: 600 } }, item.name || item.provider),
      h(
        "text",
        { style: { color: theme.muted, fontSize: 11 } },
        [item.provider, item.authType, item.email].filter(Boolean).join(" · ")
      )
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
    )
  );
}

export function ProvidersPage({ api }) {
  const [providers, setProviders] = React.useState(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

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
                h(ProviderRow, { key: item.id, item, onToggle: toggle, busy })
              )
            ),
      h(
        "text",
        { style: { color: theme.muted, fontSize: 11 } },
        "Adding connections, OAuth sign-in, proxy pools and model tests are not native yet."
      )
    )
  );
}
