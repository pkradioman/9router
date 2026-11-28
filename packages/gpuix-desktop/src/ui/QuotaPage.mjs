// Native quota tracker: per-connection provider limits, loaded on demand.
//
// The dashboard fetches /api/usage/[connectionId] for every account in the list;
// here nothing is requested until the row's Load control is clicked, so opening
// the page never spends provider quota. Provider payloads differ wildly, so the
// renderer normalises the two common shapes (a quotas map and a windows list)
// and otherwise shows the provider message verbatim.
import React from "react";
import { theme } from "./theme.mjs";
import { Button, Chip, EmptyState, InlineError, Section, SectionTitle } from "./primitives.mjs";

const h = React.createElement;

function quotaRows(data) {
  if (!data || typeof data !== "object") return [];
  const source = data.quotas && typeof data.quotas === "object" ? data.quotas : null;
  const rows = [];
  if (source) {
    for (const [key, value] of Object.entries(source)) {
      if (!value || typeof value !== "object") continue;
      rows.push({
        key,
        name: value.displayName || value.name || key,
        used: Number(value.used || 0),
        total: Number(value.total || value.limit || 0),
        remaining: value.remainingPercentage,
        resetAt: value.resetAt || value.resetsAt || null,
      });
    }
    return rows;
  }
  const list = Array.isArray(data.windows)
    ? data.windows
    : Array.isArray(data.limits)
      ? data.limits
      : Array.isArray(data)
        ? data
        : [];
  for (const [index, value] of list.entries()) {
    if (!value || typeof value !== "object") continue;
    rows.push({
      key: String(index),
      name: value.displayName || value.name || value.label || `window ${index + 1}`,
      used: Number(value.used || 0),
      total: Number(value.total || value.limit || 0),
      remaining: value.remainingPercentage,
      resetAt: value.resetAt || value.resetsAt || null,
    });
  }
  return rows;
}

function percent(row) {
  if (typeof row.remaining === "number") return `· ${Math.round(row.remaining)}% left`;
  if (row.total > 0) return `· ${Math.round((row.used / row.total) * 100)}% used`;
  return "";
}

export function QuotaPage({ api }) {
  const [connections, setConnections] = React.useState(null);
  const [states, setStates] = React.useState({});
  const [providerFilter, setProviderFilter] = React.useState("");
  const [sortMode, setSortMode] = React.useState("default");
  const [error, setError] = React.useState("");

  const load = React.useCallback(() => {
    setError("");
    setConnections(null);
    api
      .listProviders()
      .then((list) => setConnections(list || []))
      .catch((err) => {
        setConnections([]);
        setError(err.message);
      });
  }, [api]);

  React.useEffect(() => {
    load();
  }, [load]);

  const fetchQuota = (connection) => {
    setStates((map) => ({ ...map, [connection.id]: { status: "loading" } }));
    Promise.resolve(api.getConnectionUsage(connection.id))
      .then((data) => setStates((map) => ({ ...map, [connection.id]: { status: "data", data } })))
      .catch((err) => setStates((map) => ({ ...map, [connection.id]: { status: "error", error: err.message } })));
  };

  const loaded = Object.keys(states);
  const providerIds = [...new Set((connections || []).map((connection) => connection.provider).filter(Boolean))].sort();
  const visible = (connections || []).filter((connection) => !providerFilter || connection.provider === providerFilter);
  // Depleted-first ordering uses the lowest remaining share among the rows that
  // were actually loaded; connections without data keep their original order
  // after the loaded ones.
  const remainingShare = (connection) => {
    const state = states[connection.id];
    if (!state || state.status !== "data") return null;
    const rows = quotaRows(state.data);
    if (rows.length === 0) return null;
    return Math.min(
      ...rows.map((row) =>
        typeof row.remaining === "number" ? row.remaining / 100 : row.total > 0 ? 1 - row.used / row.total : 1
      )
    );
  };
  const ordered =
    sortMode === "depleted"
      ? [...visible].sort((a, b) => {
          const left = remainingShare(a);
          const right = remainingShare(b);
          if (left === null && right === null) return 0;
          if (left === null) return 1;
          if (right === null) return -1;
          return left - right;
        })
      : visible;

  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        backgroundColor: theme.canvas,
        height: "100%",
        overflowY: "scroll",
        padding: 24,
        gap: 14,
      },
    },
    h(
      "div",
      { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 16 } },
      h(
        SectionTitle,
        {
          style: { flexGrow: 1 },
          subtitle: `${connections === null ? "loading" : connections.length} connections · quota is read only when you load a row`,
        },
        "Quota tracker"
      ),
      h(
        Button,
        {
          variant: "ghost",
          testId: "quota-refresh-all",
          onClick: () => {
            for (const connection of connections || []) {
              if (states[connection.id] && states[connection.id].status !== "loading") fetchQuota(connection);
            }
          },
          style: { height: 26, fontSize: 11, color: loaded.length ? theme.ok : theme.muted },
        },
        `Refresh loaded (${loaded.length})`
      )
    ),
    error ? h(InlineError, { testId: "quota-error" }, error) : null,
    providerIds.length > 1
      ? h(
          "div",
          { style: { display: "flex", flexDirection: "row", gap: 12, alignItems: "center" } },
          h("text", { style: { color: theme.muted, fontSize: 10 } }, "Provider:"),
          h(
            Chip,
            { testId: "quota-provider-all", active: !providerFilter, onClick: () => setProviderFilter("") },
            "All"
          ),
          ...providerIds.map((id) =>
            h(
              Chip,
              {
                key: id,
                testId: `quota-provider-${id}`,
                active: providerFilter === id,
                onClick: () => setProviderFilter(id),
              },
              id
            )
          )
        )
      : null,
    h(
      "div",
      { style: { display: "flex", flexDirection: "row", gap: 12, alignItems: "center" } },
      h("text", { style: { color: theme.muted, fontSize: 10 } }, "Sort:"),
      h(
        Chip,
        { testId: "quota-sort-default", active: sortMode === "default", onClick: () => setSortMode("default") },
        "Connection order"
      ),
      h(
        Chip,
        { testId: "quota-sort-depleted", active: sortMode === "depleted", onClick: () => setSortMode("depleted") },
        "Depleted first"
      )
    ),
    h(
      Section,
      {
        testId: "quota-list",
        style: { flexGrow: 1, minHeight: 0, padding: 12, gap: 4 },
      },
      connections === null
        ? h("text", { testId: "quota-loading", style: { color: theme.muted, fontSize: 11 } }, "Loading connections...")
        : connections.length === 0
          ? h(EmptyState, { testId: "quota-empty" }, "No connections to track.")
          : visible.length === 0
            ? h(EmptyState, { testId: "quota-filter-empty" }, "No connections for this provider.")
            : ordered.map((connection, index) => {
              const state = states[connection.id] || null;
              const rows = state && state.status === "data" ? quotaRows(state.data) : [];
              const message = state && state.status === "data" && state.data && state.data.message;
              return h(
                "div",
                {
                  key: connection.id,
                  testId: `quota-row-${index}`,
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    paddingTop: 5,
                    paddingBottom: 5,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderColor: theme.border,
                  },
                },
                h(
                  "div",
                  { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 12 } },
                  h("text", { style: { color: theme.text, fontSize: 12, flexGrow: 1 } }, connection.name || connection.id),
                  h("text", { style: { color: theme.muted, fontSize: 10, width: 140 } }, connection.provider || ""),
                  h(
                    "text",
                    {
                      testId: `quota-load-${index}`,
                      role: "button",
                      onClick: state && state.status === "loading" ? null : () => fetchQuota(connection),
                      style: {
                        color: state && state.status === "loading" ? theme.muted : theme.ok,
                        fontSize: 10,
                        width: 44,
                        cursor: state && state.status === "loading" ? "default" : "pointer",
                        hover: { color: theme.text },
                      },
                    },
                    state && state.status === "loading" ? "..." : state ? "Reload" : "Load"
                  )
                ),
                state && state.status === "error"
                  ? h("text", { testId: `quota-error-${index}`, style: { color: theme.bad, fontSize: 10 } }, state.error)
                  : null,
                state && state.status === "data" && rows.length === 0
                  ? h(
                      "text",
                      { testId: `quota-message-${index}`, style: { color: theme.muted, fontSize: 10 } },
                      message || "No quota fields returned for this provider."
                    )
                  : null,
                ...rows.map((row) =>
                  h(
                    "div",
                    {
                      key: row.key,
                      testId: `quota-entry-${connection.id}-${row.key}`,
                      style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 12 },
                    },
                    h("text", { style: { color: theme.text, fontSize: 10, width: 170 } }, row.name),
                    h(
                      "text",
                      { style: { color: theme.muted, fontSize: 10, width: 130 } },
                      row.total > 0 ? `${row.used} / ${row.total}` : `${row.used} used`
                    ),
                    h("text", { style: { color: theme.muted, fontSize: 10, flexGrow: 1 } }, percent(row)),
                    h(
                      "text",
                      { style: { color: theme.muted, fontSize: 10, width: 170 } },
                      row.resetAt ? `resets ${String(row.resetAt).replace("T", " ").slice(0, 16)}` : ""
                    )
                  )
                )
              );
            })
    ),
    h(
      "text",
      { style: { color: theme.muted, fontSize: 10 } },
      "Auto-ping schedules, reset credits and per-model quotas stay on the dashboard."
    )
  );
}
