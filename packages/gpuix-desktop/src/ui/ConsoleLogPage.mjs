// Native Console Log page: gateway log lines, refreshed by polling.
//
// The dashboard streams these lines over SSE; the shell polls the same JSON
// route instead, which needs no EventSource in the native renderer. The footer
// says so instead of implying a live stream.
import React from "react";
import { theme } from "./theme.mjs";

const h = React.createElement;
const MAX_LINES = 400;
const POLL_MS = 3000;

// Same level tags as the dashboard console; the first [TAG] on the line decides
// the colour, untagged lines read as LOG.
export const LEVEL_COLORS = {
  LOG: "#3ecf8e",
  INFO: "#5aa9ff",
  WARN: "#f0b429",
  ERROR: "#f16c6c",
  DEBUG: "#b58cff",
};

export function levelColor(line) {
  const match = String(line ?? "").match(/\[(\w+)\]/);
  const tag = match ? match[1].toUpperCase() : "LOG";
  return LEVEL_COLORS[tag] || LEVEL_COLORS.LOG;
}

export function ConsoleLogPage({ api }) {
  const [lines, setLines] = React.useState(null);
  const [error, setError] = React.useState("");

  const load = React.useCallback(
    (force) => {
      api
        .getConsoleLogs()
        .then((logs) => {
          setLines(logs.slice(-MAX_LINES));
          if (force) setError("");
        })
        .catch((err) => {
          if (force) {
            setLines([]);
            setError(err.message);
          }
        });
    },
    [api]
  );

  React.useEffect(() => {
    load(true);
    const timer = setInterval(() => load(false), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const clear = () => {
    api
      .clearConsoleLogs()
      .then(() => setLines([]))
      .catch((err) => setError(err.message));
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
      { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 16 } },
      h("text", { style: { color: theme.text, fontSize: 14, fontWeight: 600 } }, "Console log"),
      h(
        "text",
        {
          testId: "console-refresh",
          role: "button",
          onClick: () => load(true),
          style: { color: theme.ok, fontSize: 12, cursor: "pointer", hover: { color: theme.text } },
        },
        "Refresh"
      ),
      h(
        "text",
        {
          testId: "console-clear",
          role: "button",
          onClick: clear,
          style: { color: theme.bad, fontSize: 12, cursor: "pointer", hover: { color: "#ff9c9c" } },
        },
        "Clear"
      )
    ),
    error ? h("text", { testId: "console-error", style: { color: theme.bad, fontSize: 12 } }, error) : null,
    h(
      "div",
      {
        testId: "console-section",
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
          gap: 2,
        },
      },
      lines === null
        ? h("text", { testId: "console-loading", style: { color: theme.muted, fontSize: 11 } }, "Loading log...")
        : lines.length === 0
          ? h("text", { testId: "console-empty", style: { color: theme.muted, fontSize: 11 } }, "No log lines yet.")
          : lines.map((line, index) =>
              h(
                "text",
                { key: index, style: { color: levelColor(line), fontSize: 10, fontFamily: "Consolas" } },
                String(line)
              )
            )
    ),
    h(
      "text",
      { style: { color: theme.muted, fontSize: 11 } },
      `Polled every ${POLL_MS / 1000}s; the dashboard uses a live stream.`
    )
  );
}
