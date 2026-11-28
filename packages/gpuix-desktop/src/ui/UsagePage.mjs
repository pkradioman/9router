// Native Usage page: totals, per-provider breakdown and recent requests.
//
// Read-only slice of the dashboard's usage screen. Charts, request details and
// log streaming are not native yet.
import React from "react";
import { theme } from "./theme.mjs";

const h = React.createElement;

const PERIODS = [
  { id: "today", label: "Today" },
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
  { id: "60d", label: "60d" },
  { id: "all", label: "All" },
];

function Stat({ label, value, testId }) {
  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: 2, minWidth: 120 } },
    h("text", { style: { color: theme.muted, fontSize: 11 } }, label),
    h("text", { testId, style: { color: theme.text, fontSize: 16, fontWeight: 600 } }, value)
  );
}

function providerRows(stats) {
  const byProvider = (stats && stats.byProvider) || {};
  return Object.entries(byProvider)
    .map(([provider, entry]) => ({
      provider,
      requests: entry?.requests || 0,
      tokens: (entry?.promptTokens || 0) + (entry?.completionTokens || 0),
      cost: entry?.cost || 0,
    }))
    .filter((row) => row.requests > 0 || row.tokens > 0)
    .sort((a, b) => b.requests - a.requests);
}

export function UsagePage({ api }) {
  const [period, setPeriod] = React.useState("7d");
  const [stats, setStats] = React.useState(null);
  const [chart, setChart] = React.useState(null);
  const [error, setError] = React.useState("");

  const load = React.useCallback(() => {
    setError("");
    setStats(null);
    setChart(null);
    api
      .getUsageStats(period)
      .then(setStats)
      .catch((err) => setError(err.message));
    api
      .getUsageChart(period)
      .then(setChart)
      .catch(() => setChart([]));
  }, [api, period]);

  React.useEffect(() => {
    load();
  }, [load]);

  const totalTokens = stats ? (stats.totalPromptTokens || 0) + (stats.totalCompletionTokens || 0) : 0;
  const rows = stats ? providerRows(stats) : [];
  // The aggregate keys models as "model (provider)"; sort by cost, then tokens.
  const modelRows = stats
    ? Object.entries(stats.byModel || {})
        .map(([key, entry]) => ({
          key,
          tokens: (entry.promptTokens || 0) + (entry.completionTokens || 0),
          requests: entry.requests || 0,
          cost: entry.cost || 0,
        }))
        .filter((row) => row.requests > 0)
        .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
        .slice(0, 8)
    : [];
  const recent = (stats && stats.recentRequests) || [];

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
      { style: { display: "flex", flexDirection: "row", gap: 8, alignItems: "center" } },
      ...PERIODS.map((item) =>
        h(
          "text",
          {
            key: item.id,
            testId: `usage-period-${item.id}`,
            role: "button",
            onClick: () => setPeriod(item.id),
            style: {
              paddingTop: 5,
              paddingBottom: 5,
              paddingLeft: 12,
              paddingRight: 12,
              borderRadius: 999,
              backgroundColor: period === item.id ? theme.panelAlt : "transparent",
              borderWidth: 1,
              borderColor: period === item.id ? theme.border : "transparent",
              color: period === item.id ? theme.text : theme.muted,
              fontSize: 11,
              cursor: "pointer",
              hover: { color: theme.text },
            },
          },
          item.label
        )
      )
    ),
    h(
      "div",
      {
        testId: "usage-section",
        style: {
          display: "flex",
          flexDirection: "column",
          backgroundColor: theme.panel,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 10,
          padding: 16,
          gap: 12,
        },
      },
      error ? h("text", { testId: "usage-error", style: { color: theme.bad, fontSize: 12 } }, error) : null,
      stats === null && !error
        ? h("text", { testId: "usage-loading", style: { color: theme.muted, fontSize: 12 } }, "Loading usage...")
        : stats
          ? h(
              "div",
              { style: { display: "flex", flexDirection: "row", gap: 28, flexWrap: "wrap" } },
              h(Stat, { label: "Requests", value: String(stats.totalRequests || 0), testId: "usage-requests" }),
              h(Stat, { label: "Tokens", value: String(totalTokens), testId: "usage-tokens" }),
              h(Stat, { label: "Cached", value: String(stats.totalCachedTokens || 0), testId: "usage-cached" }),
              h(Stat, { label: "Cost", value: `$${Number(stats.totalCost || 0).toFixed(4)}`, testId: "usage-cost" })
            )
          : null,
      modelRows.length
        ? h(
            "div",
            { testId: "usage-models", style: { display: "flex", flexDirection: "column" } },
            h("text", { style: { color: theme.text, fontSize: 12, fontWeight: 600, paddingBottom: 4 } }, "Top models"),
            ...modelRows.map((row) =>
              h(
                "div",
                {
                  key: row.key,
                  testId: `usage-model-${row.key}`,
                  style: { display: "flex", flexDirection: "row", gap: 12, paddingTop: 5, paddingBottom: 5, borderTopWidth: 1, borderColor: theme.border },
                },
                h("text", { style: { color: theme.text, fontSize: 11, flexGrow: 1 } }, row.key),
                h("text", { style: { color: theme.muted, fontSize: 10, width: 70 } }, `${row.requests} req`),
                h("text", { style: { color: theme.muted, fontSize: 10, width: 90 } }, `${row.tokens} tok`),
                h("text", { style: { color: theme.muted, fontSize: 10, width: 80 } }, `$${Number(row.cost).toFixed(4)}`)
              )
            )
          )
        : null,
      rows.length
        ? h(
            "div",
            { style: { display: "flex", flexDirection: "column" } },
            ...rows.map((row) =>
              h(
                "div",
                {
                  key: row.provider,
                  testId: `usage-provider-${row.provider}`,
                  style: {
                    display: "flex",
                    flexDirection: "row",
                    gap: 12,
                    paddingTop: 6,
                    paddingBottom: 6,
                    borderTopWidth: 1,
                    borderColor: theme.border,
                  },
                },
                h("text", { style: { color: theme.text, fontSize: 12, flexGrow: 1 } }, row.provider),
                h("text", { style: { color: theme.muted, fontSize: 11, width: 90 } }, `${row.requests} req`),
                h("text", { style: { color: theme.muted, fontSize: 11, width: 110 } }, `${row.tokens} tok`),
                h("text", { style: { color: theme.muted, fontSize: 11, width: 80 } }, `$${Number(row.cost).toFixed(4)}`)
              )
            )
          )
        : stats
          ? h("text", { testId: "usage-empty", style: { color: theme.muted, fontSize: 12 } }, "No usage in this period.")
          : null
    ),
    h(
      "div",
      {
        testId: "usage-chart",
        style: {
          display: "flex",
          flexDirection: "column",
          backgroundColor: theme.panel,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 10,
          padding: 16,
          gap: 6,
        },
      },
      h("text", { style: { color: theme.text, fontSize: 14, fontWeight: 600 } }, "Tokens by bucket"),
      chart === null
        ? h("text", { testId: "usage-chart-loading", style: { color: theme.muted, fontSize: 11 } }, "Loading chart...")
        : chart.length === 0
          ? h("text", { testId: "usage-chart-empty", style: { color: theme.muted, fontSize: 11 } }, "No buckets.")
          : (() => {
              const buckets = chart.slice(-12);
              const max = Math.max(1, ...buckets.map((b) => b.tokens || 0));
              return h(
                "div",
                { style: { display: "flex", flexDirection: "column", gap: 4 } },
                ...buckets.map((bucket, index) => {
                  const tokens = bucket.tokens || 0;
                  return h(
                    "div",
                    {
                      key: `${bucket.label || index}`,
                      style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 8 },
                    },
                    h("text", { style: { color: theme.muted, fontSize: 10, width: 96 } }, String(bucket.label || "")),
                    h(
                      "div",
                      {
                        style: {
                          display: "flex",
                          flexDirection: "row",
                          flexGrow: 1,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: theme.panelAlt,
                        },
                      },
                      h("div", {
                        style: {
                          flexGrow: tokens === 0 ? 0.001 : tokens,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: theme.ok,
                        },
                      }),
                      h("div", { style: { flexGrow: Math.max(max - tokens, 0.001), height: 8 } })
                    ),
                    h(
                      "text",
                      { style: { color: theme.text, fontSize: 10, width: 70 } },
                      `${tokens} tok`
                    )
                  );
                })
              );
            })()
    ),
    h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          backgroundColor: theme.panel,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 10,
          padding: 16,
          gap: 8,
        },
      },
      h("text", { style: { color: theme.text, fontSize: 14, fontWeight: 600 } }, "Recent requests"),
      !recent.length
        ? h("text", { testId: "usage-recent-empty", style: { color: theme.muted, fontSize: 12 } }, "Nothing yet.")
        : h(
            "div",
            { style: { display: "flex", flexDirection: "column" } },
            ...recent.slice(0, 10).map((item, index) =>
              h(
                "div",
                {
                  key: `${item.timestamp || index}-${index}`,
                  style: {
                    display: "flex",
                    flexDirection: "row",
                    gap: 10,
                    paddingTop: 5,
                    paddingBottom: 5,
                    borderTopWidth: 1,
                    borderColor: theme.border,
                  },
                },
                h("text", { style: { color: theme.text, fontSize: 11, flexGrow: 1 } }, item.model || "unknown"),
                h("text", { style: { color: theme.muted, fontSize: 11, width: 90 } }, item.provider || ""),
                h(
                  "text",
                  { style: { color: theme.muted, fontSize: 11, width: 140 } },
                  `${item.promptTokens || 0} + ${item.completionTokens || 0} tok`
                )
              )
            )
          )
    ),
    h(
      "text",
      { style: { color: theme.muted, fontSize: 11 } },
      "Recent requests live on the Request log page; live log streaming is not native yet."
    )
  );
}
