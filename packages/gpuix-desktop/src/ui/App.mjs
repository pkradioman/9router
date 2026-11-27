// App shell for the experimental native window.
//
// Navigation mirrors the dashboard sidebar, but only screens that are actually
// implemented are enabled. Pending items stay visible and disabled so the gap is
// explicit; nothing renders a fake page.
import React from "react";
import { theme } from "./theme.mjs";
import { STATUS } from "./status-model.mjs";
import { EndpointPage } from "./EndpointPage.mjs";
import { ProvidersPage } from "./ProvidersPage.mjs";
import { UsagePage } from "./UsagePage.mjs";
import { CombosPage } from "./CombosPage.mjs";
import { ConsoleLogPage } from "./ConsoleLogPage.mjs";
import { TokenSaverPage } from "./TokenSaverPage.mjs";
import { ProxyPoolsPage } from "./ProxyPoolsPage.mjs";
import { CliToolsPage } from "./CliToolsPage.mjs";
import { StatusPanel } from "./StatusPanel.mjs";

const h = React.createElement;

const PAGES = [
  { id: "endpoint", label: "Endpoint & Key", enabled: true },
  { id: "status", label: "Gateway status", enabled: true },
  { id: "providers", label: "Providers", enabled: true },
  { id: "combos", label: "Combo & Vision Adapter", enabled: true },
  { id: "usage", label: "Usage", enabled: true },
  { id: "quota", label: "Quota Tracker", enabled: false },
  { id: "token-saver", label: "Token Saver", enabled: true },
  { id: "cli-tools", label: "CLI Tools", enabled: true },
  { id: "translator", label: "Translator", enabled: false },
  { id: "console-log", label: "Console Log", enabled: true },
  { id: "proxy-pools", label: "Proxy Pools", enabled: true },
  { id: "skills", label: "Skills", enabled: false },
];

export function App({ api, status, onRefresh }) {
  const [page, setPage] = React.useState("endpoint");
  const badgeColor =
    status.phase === STATUS.ready ? theme.ok : status.phase === STATUS.degraded ? theme.bad : theme.warn;

  const nav = h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        width: 216,
        backgroundColor: theme.panel,
        borderRightWidth: 1,
        borderColor: theme.border,
        paddingTop: 20,
        paddingBottom: 20,
        paddingLeft: 12,
        paddingRight: 12,
        gap: 4,
      },
    },
    h(
      "div",
      { style: { display: "flex", flexDirection: "column", paddingLeft: 8, paddingBottom: 12, gap: 2 } },
      h("text", { style: { color: theme.text, fontSize: 15, fontWeight: 600 } }, "9Router Experimental"),
      h("text", { style: { color: theme.muted, fontSize: 11 } }, `v${status.version || "unknown"}`)
    ),
    ...PAGES.map((item) =>
      h(
        "div",
        {
          key: item.id,
          testId: `nav-${item.id}`,
          role: item.enabled ? "button" : undefined,
          onClick: item.enabled ? () => setPage(item.id) : undefined,
          style: {
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 7,
            paddingBottom: 7,
            paddingLeft: 10,
            paddingRight: 10,
            borderRadius: 7,
            backgroundColor: page === item.id ? theme.panelAlt : "transparent",
          },
        },
        h(
          "text",
          {
            style: {
              color: !item.enabled ? "#55555c" : page === item.id ? theme.text : theme.muted,
              fontSize: 12,
            },
          },
          item.label
        ),
        item.enabled
          ? null
          : h("text", { style: { color: "#55555c", fontSize: 10 } }, "soon")
      )
    )
  );

  let content;
  if (page === "status") content = h(StatusPanel, { status, onRefresh });
  else if (page === "providers") content = h(ProvidersPage, { api });
  else if (page === "usage") content = h(UsagePage, { api });
  else if (page === "combos") content = h(CombosPage, { api });
  else if (page === "console-log") content = h(ConsoleLogPage, { api });
  else if (page === "token-saver") content = h(TokenSaverPage, { api });
  else if (page === "proxy-pools") content = h(ProxyPoolsPage, { api });
  else if (page === "cli-tools") content = h(CliToolsPage, { api });
  else content = h(EndpointPage, { api, status, onRefresh });

  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "row",
        backgroundColor: theme.surface,
        height: "100%",
      },
    },
    nav,
    h(
      "div",
      { style: { display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 } },
      h(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingTop: 14,
            paddingBottom: 14,
            paddingLeft: 24,
            paddingRight: 24,
            borderBottomWidth: 1,
            borderColor: theme.border,
          },
        },
        h("text", { style: { color: theme.text, fontSize: 13, fontWeight: 600 } }, "9Router"),
        h(
          "div",
          {
            testId: "app-status-badge",
            style: {
              paddingTop: 2,
              paddingBottom: 2,
              paddingLeft: 8,
              paddingRight: 8,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: badgeColor,
            },
          },
          h("text", { style: { color: badgeColor, fontSize: 10 } }, status.phase)
        ),
        h("div", { style: { flexGrow: 1 } }),
        h("text", { style: { color: theme.muted, fontSize: 11 } }, status.baseUrl)
      ),
      h("div", { style: { flexGrow: 1, minHeight: 0 } }, content)
    )
  );
}
