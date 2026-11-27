// Native request log: paged metadata from /api/usage/request-details.
//
// Conversation bodies are redacted by the gateway; only model, provider,
// status, timing and token counts are shown.
import React from "react";
import { theme } from "./theme.mjs";

const h = React.createElement;
const PAGE_SIZE = 20;

export function RequestLogPage({ api }) {
  const [page, setPage] = React.useState(1);
  const [result, setResult] = React.useState(null);
  const [error, setError] = React.useState("");

  const load = React.useCallback(() => {
    setError("");
    setResult(null);
    api
      .getRequestDetails(page, PAGE_SIZE)
      .then(setResult)
      .catch((err) => setError(err.message));
  }, [api, page]);

  React.useEffect(() => {
    load();
  }, [load]);

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
          : details.map((item, index) =>
              h(
                "div",
                {
                  key: item.id || index,
                  testId: `request-log-row-${index}`,
                  style: {
                    display: "flex",
                    flexDirection: "row",
                    gap: 10,
                    paddingTop: 4,
                    paddingBottom: 4,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderColor: theme.border,
                  },
                },
                h("text", { style: { color: theme.text, fontSize: 11, width: 150 } }, item.model || "unknown"),
                h("text", { style: { color: theme.muted, fontSize: 11, flexGrow: 1 } }, item.provider || ""),
                h(
                  "text",
                  { style: { color: theme.muted, fontSize: 11, width: 90 } },
                  item.status === 200 || item.status === "200" || item.status === "ok" ? "ok" : String(item.status ?? "")
                ),
                h(
                  "text",
                  { style: { color: theme.muted, fontSize: 10, width: 190 } },
                  String(item.timestamp || "").replace("T", " ").slice(0, 19)
                )
              )
            )
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
