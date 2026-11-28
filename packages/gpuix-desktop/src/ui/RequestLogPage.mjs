// Native request log: paged, filterable metadata from /api/usage/request-details.
//
// Conversation bodies are redacted by the gateway; only model, provider,
// status, timing and token counts are shown.
import React from "react";
import { theme } from "./theme.mjs";

const h = React.createElement;
const PAGE_SIZE = 20;

// Same token fields as the dashboard (tokenDisplay.js): OpenAI and Claude names.
export function inputTokens(tokens) {
  const prompt = (tokens && (tokens.prompt_tokens || tokens.input_tokens)) || 0;
  const cache = cachedTokens(tokens);
  return prompt < cache ? cache : prompt;
}
export function cachedTokens(tokens) {
  return (tokens && (tokens.cached_tokens || tokens.cache_read_input_tokens)) || 0;
}
export function cacheCreationTokens(tokens) {
  return (tokens && tokens.cache_creation_input_tokens) || 0;
}
export function outputTokens(tokens) {
  return (tokens && (tokens.completion_tokens || tokens.output_tokens)) || 0;
}
function compact(n) {
  const num = Number(n) || 0;
  if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
  return String(num);
}

export function RequestLogPage({ api }) {
  const [page, setPage] = React.useState(1);
  const [result, setResult] = React.useState(null);
  const [error, setError] = React.useState("");
  const [drafts, setDrafts] = React.useState({ provider: "", model: "", status: "", startDate: "", endDate: "" });
  const [filters, setFilters] = React.useState({ provider: "", model: "", status: "", startDate: "", endDate: "" });
  const [providers, setProviders] = React.useState([]);
  const [openRow, setOpenRow] = React.useState(-1);

  React.useEffect(() => {
    api
      .getUsageProviders()
      .then((list) => setProviders(list || []))
      .catch(() => setProviders([]));
  }, [api]);

  const load = React.useCallback(() => {
    setError("");
    setResult(null);
    setOpenRow(-1);
    api
      .getRequestDetails(page, PAGE_SIZE, filters)
      .then(setResult)
      .catch((err) => setError(err.message));
  }, [api, page, filters]);

  React.useEffect(() => {
    load();
  }, [load]);

  const applyFilters = () => {
    setPage(1);
    setFilters({ ...drafts });
  };

  const clearFilters = () => {
    const empty = { provider: "", model: "", status: "", startDate: "", endDate: "" };
    setDrafts(empty);
    setFilters(empty);
    setPage(1);
  };

  const pagination = (result && result.pagination) || null;
  const details = (result && result.details) || [];

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
      { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 16 } },
      h("text", { style: { color: theme.text, fontSize: 14, fontWeight: 600 } }, "Request log"),
      h(
        "text",
        {
          testId: "request-log-refresh",
          role: "button",
          onClick: load,
          style: { color: theme.ok, fontSize: 12, cursor: "pointer", hover: { color: theme.text } },
        },
        "Refresh"
      ),
      pagination
        ? h(
            "text",
            { testId: "request-log-page", style: { color: theme.muted, fontSize: 11 } },
            `page ${pagination.page} / ${Math.max(pagination.totalPages, 1)} · ${pagination.totalItems} total`
          )
        : null
    ),
    h(
      "div",
      { style: { display: "flex", flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" } },
      h("input", {
        testId: "request-log-provider",
        "aria-label": "Provider filter",
        value: drafts.provider,
        onChange: (event) => setDrafts((value) => ({ ...value, provider: event.value ?? "" })),
        placeholder: "provider",
        style: { width: 140, height: 26, color: theme.text, ...theme.input },
      }),
      h("input", {
        testId: "request-log-model",
        "aria-label": "Model filter",
        value: drafts.model,
        onChange: (event) => setDrafts((value) => ({ ...value, model: event.value ?? "" })),
        placeholder: "model",
        style: { width: 170, height: 26, color: theme.text, ...theme.input },
      }),
      h("input", {
        testId: "request-log-status",
        "aria-label": "Status filter",
        value: drafts.status,
        onChange: (event) => setDrafts((value) => ({ ...value, status: event.value ?? "" })),
        onSubmit: applyFilters,
        placeholder: "status",
        style: { width: 90, height: 26, color: theme.text, ...theme.input },
      }),
      h("input", {
        testId: "request-log-start",
        "aria-label": "Start date",
        value: drafts.startDate,
        onChange: (event) => setDrafts((value) => ({ ...value, startDate: event.value ?? "" })),
        placeholder: "from YYYY-MM-DD",
        style: { width: 130, height: 26, color: theme.text, ...theme.input },
      }),
      h("input", {
        testId: "request-log-end",
        "aria-label": "End date",
        value: drafts.endDate,
        onChange: (event) => setDrafts((value) => ({ ...value, endDate: event.value ?? "" })),
        onSubmit: applyFilters,
        placeholder: "to YYYY-MM-DD",
        style: { width: 130, height: 26, color: theme.text, ...theme.input },
      }),
      h(
        "text",
        {
          testId: "request-log-apply",
          role: "button",
          onClick: applyFilters,
          style: { color: theme.ok, fontSize: 11, cursor: "pointer", hover: { color: theme.text } },
        },
        "Apply"
      ),
      h(
        "text",
        {
          testId: "request-log-clear",
          role: "button",
          onClick: clearFilters,
          style: { color: theme.muted, fontSize: 11, cursor: "pointer", hover: { color: theme.text } },
        },
        "Clear"
      )
    ),
    providers.length > 0
      ? h(
          "div",
          { style: { display: "flex", flexDirection: "row", gap: 12, alignItems: "center", flexWrap: "wrap" } },
          h("text", { style: { color: theme.muted, fontSize: 10 } }, "Providers:"),
          h(
            "text",
            {
              testId: "request-log-provider-chip-all",
              role: "button",
              onClick: () => {
                const next = { ...drafts, provider: "" };
                setDrafts(next);
                setFilters(next);
                setPage(1);
              },
              style: {
                color: drafts.provider ? theme.muted : theme.ok,
                fontSize: 10,
                cursor: "pointer",
                hover: { color: theme.text },
              },
            },
            "All"
          ),
          ...providers.slice(0, 16).map((item) =>
            h(
              "text",
              {
                key: item.id,
                testId: `request-log-provider-chip-${item.id}`,
                role: "button",
                onClick: () => {
                  const next = { ...drafts, provider: item.id };
                  setDrafts(next);
                  setFilters(next);
                  setPage(1);
                },
                style: {
                  color: drafts.provider === item.id ? theme.ok : theme.muted,
                  fontSize: 10,
                  cursor: "pointer",
                  hover: { color: theme.text },
                },
              },
              item.name || item.id
            )
          )
        )
      : null,
    error ? h("text", { testId: "request-log-error", style: { color: theme.bad, fontSize: 12 } }, error) : null,
    h(
      "div",
      {
        testId: "request-log-section",
        style: {
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          minHeight: 0,
          overflowY: "scroll",
          backgroundColor: theme.panel,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 10,
          padding: 12,
          gap: 4,
        },
      },
      result === null
        ? h("text", { testId: "request-log-loading", style: { color: theme.muted, fontSize: 11 } }, "Loading...")
        : details.length === 0
          ? h("text", { testId: "request-log-empty", style: { color: theme.muted, fontSize: 11 } }, "No recorded requests.")
          : details.map((item, index) => {
              const tokens = item.tokens || {};
              const latency = item.latency || {};
              const open = openRow === index;
              const ok = item.status === 200 || item.status === "200" || item.status === "ok";
              return h(
                "div",
                {
                  key: item.id || index,
                  testId: `request-log-row-${index}`,
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderColor: theme.border,
                  },
                },
                h(
                  "div",
                  {
                    testId: `request-log-row-${index}-summary`,
                    role: "button",
                    onClick: () => setOpenRow(open ? -1 : index),
                    style: { display: "flex", flexDirection: "row", gap: 10, alignItems: "center", paddingTop: 4, paddingBottom: 4, cursor: "pointer" },
                  },
                  h(
                    "text",
                    { style: { color: theme.muted, fontSize: 10, width: 130 } },
                    String(item.timestamp || "").replace("T", " ").slice(0, 19)
                  ),
                  h("text", { style: { color: theme.text, fontSize: 11, width: 170 } }, item.model || "unknown"),
                  h("text", { style: { color: theme.muted, fontSize: 11, flexGrow: 1 } }, item.provider || ""),
                  h("text", { style: { color: theme.muted, fontSize: 10, width: 74 } }, `${compact(inputTokens(tokens))} in`),
                  h("text", { style: { color: theme.muted, fontSize: 10, width: 84 } }, `${compact(cachedTokens(tokens))} cached`),
                  h("text", { style: { color: theme.muted, fontSize: 10, width: 74 } }, `${compact(outputTokens(tokens))} out`),
                  h("text", { style: { color: theme.muted, fontSize: 10, width: 74 } }, `${latency.total || 0} ms`),
                  h(
                    "text",
                    { style: { color: ok ? theme.muted : theme.bad, fontSize: 10, width: 70 } },
                    ok ? "ok" : String(item.status ?? "")
                  )
                ),
                open
                  ? h(
                      "div",
                      {
                        testId: `request-log-detail-${index}`,
                        style: { display: "flex", flexDirection: "column", paddingLeft: 12, paddingBottom: 6, gap: 2 },
                      },
                      h(
                        "text",
                        { style: { color: theme.muted, fontSize: 10 } },
                        `TTFT ${latency.ttft || 0} ms · total ${latency.total || 0} ms`
                      ),
                      h(
                        "text",
                        { style: { color: theme.muted, fontSize: 10 } },
                        `cache creation ${cacheCreationTokens(tokens)} tok · cost $${Number(item.cost || 0).toFixed(4)}`
                      ),
                      h(
                        "text",
                        { style: { color: theme.muted, fontSize: 10 } },
                        `connection ${item.connectionId || "—"}`
                      )
                    )
                  : null
              );
            })
    ),
    h(
      "div",
      { style: { display: "flex", flexDirection: "row", gap: 16, alignItems: "center" } },
      h(
        "text",
        {
          testId: "request-log-prev",
          role: "button",
          onClick: () => (pagination && pagination.hasPrev ? setPage(page - 1) : null),
          style: {
            color: pagination && pagination.hasPrev ? theme.ok : theme.muted,
            fontSize: 11,
            cursor: pagination && pagination.hasPrev ? "pointer" : "default",
          },
        },
        "Previous"
      ),
      h(
        "text",
        {
          testId: "request-log-next",
          role: "button",
          onClick: () => (pagination && pagination.hasNext ? setPage(page + 1) : null),
          style: {
            color: pagination && pagination.hasNext ? theme.ok : theme.muted,
            fontSize: 11,
            cursor: pagination && pagination.hasNext ? "pointer" : "default",
          },
        },
        "Next"
      ),
      h("text", { style: { color: theme.muted, fontSize: 11 } }, "Bodies are redacted by the gateway.")
    )
  );
}
