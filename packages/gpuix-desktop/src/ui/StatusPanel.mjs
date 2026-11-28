// Native status panel. Written with createElement instead of JSX so the package
// needs no JSX transform at runtime; GPUIX host elements are plain strings.
import React from "react";
import { describeStatus, STATUS } from "./status-model.mjs";
import { theme } from "./theme.mjs";

const h = React.createElement;

function Row({ label, value, testId, color }) {
  return h(
    "div",
    { style: { display: "flex", flexDirection: "row", gap: 12, paddingTop: 6, paddingBottom: 6 } },
    h("text", { style: { color: theme.muted, fontSize: 12, width: 132 } }, label),
    h(
      "text",
      { testId, style: { color: color || theme.text, fontSize: 12, flexGrow: 1, minWidth: 0 } },
      String(value)
    )
  );
}

export function StatusPanel({ status, onRefresh }) {
  const badgeColor =
    status.phase === STATUS.ready ? theme.ok : status.phase === STATUS.degraded ? theme.bad : theme.warn;

  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        backgroundColor: theme.surface,
        height: "100%",
        overflowY: "scroll",
        padding: 24,
        gap: 16,
      },
    },
    h(
      "div",
      { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 12 } },
      h("text", { style: { color: theme.text, fontSize: 20, fontWeight: 600 } }, "9Router Experimental"),
      h(
        "div",
        {
          testId: "status-badge",
          style: {
            paddingTop: 3,
            paddingBottom: 3,
            paddingLeft: 10,
            paddingRight: 10,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: badgeColor,
          },
        },
        h("text", { style: { color: badgeColor, fontSize: 11 } }, status.phase)
      )
    ),
    h(
      "text",
      { testId: "status-summary", style: { color: status.phase === STATUS.degraded ? theme.bad : theme.text, fontSize: 13 } },
      describeStatus(status)
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
        },
      },
      h(Row, { label: "Gateway", value: status.baseUrl, testId: "gateway-url" }),
      h(Row, { label: "App version", value: status.version || "unknown", testId: "app-version" }),
      h(Row, { label: "Data directory", value: status.dataDir, testId: "data-dir" }),
      h(Row, { label: "Gateway runtime", value: status.runtimeDir, testId: "runtime-dir" }),
      status.hasUpdate && status.latestVersion
        ? h(Row, {
            label: "Update",
            value: `v${status.latestVersion} available — install from the dashboard`,
            color: theme.warn,
            testId: "update-available",
          })
        : null,
      status.lastError ? h(Row, { label: "Last error", value: status.lastError, color: theme.bad, testId: "last-error" }) : null
    ),
    h(
      "div",
      {
        testId: "refresh-status",
        onClick: onRefresh,
        style: {
          alignSelf: "start",
          paddingTop: 8,
          paddingBottom: 8,
          paddingLeft: 14,
          paddingRight: 14,
          borderRadius: 8,
          backgroundColor: theme.panelAlt,
          cursor: "pointer",
          hover: { backgroundColor: theme.panelAlt },
        },
      },
      h("text", { style: { color: theme.text, fontSize: 12 } }, "Refresh status")
    ),
    h(
      "text",
      { style: { color: theme.muted, fontSize: 11, marginTop: 4 } },
      "This shell is isolated from the installed 9Router app: separate data, logs and gateway port."
    )
  );
}
