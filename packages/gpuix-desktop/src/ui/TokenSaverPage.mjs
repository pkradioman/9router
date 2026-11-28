// Native Token Saver page: savings stats, the caveman and RTK switches, and a
// read-only headroom status read-out.
//
// Headroom start/stop/extras and pxpipe stay on the dashboard: their routes are
// blocked in the experimental build.
import React from "react";
import { theme } from "./theme.mjs";

const h = React.createElement;

const PERIODS = [
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
  { id: "all", label: "All" },
];

const LEVELS = [
  { id: "lite", label: "Lite" },
  { id: "full", label: "Full" },
  { id: "ultra", label: "Ultra" },
];

function Toggle({ label, value, onToggle, testId }) {
  return h(
    "div",
    { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 12 } },
    h("text", { style: { color: theme.text, fontSize: 12, width: 160 } }, label),
    h(
      "text",
      {
        testId,
        role: "button",
        onClick: () => onToggle(!value),
        style: { color: value ? theme.ok : theme.muted, fontSize: 11, cursor: "pointer", hover: { color: theme.text } },
      },
      value ? "Enabled" : "Disabled"
    )
  );
}

export function TokenSaverPage({ api }) {
  const [period, setPeriod] = React.useState("7d");
  const [stats, setStats] = React.useState(null);
  const [settings, setSettings] = React.useState(null);
  const [headroom, setHeadroom] = React.useState(null);
  const [error, setError] = React.useState("");

  const loadStats = React.useCallback(() => {
    setError("");
    setStats(null);
    api
      .getTokenSaverStats(period)
      .then(setStats)
      .catch((err) => setError(err.message));
  }, [api, period]);

  const loadSettings = React.useCallback(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch((err) => setError(err.message));
  }, [api]);

  React.useEffect(() => {
    loadStats();
  }, [loadStats]);

  React.useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  React.useEffect(() => {
    api
      .getHeadroomStatus()
      .then(setHeadroom)
      .catch(() => setHeadroom(false));
  }, [api]);

  const patch = (change) => {
    setError("");
    api
      .patchSettings(change)
      .then(setSettings)
      .catch((err) => setError(err.message));
  };

  const rtk = (stats && stats.rtk) || {};
  const caveman = (stats && stats.caveman) || {};

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
      { style: { display: "flex", flexDirection: "row", gap: 8 } },
      ...PERIODS.map((item) =>
        h(
          "text",
          {
            key: item.id,
            testId: `saver-period-${item.id}`,
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
        testId: "saver-section",
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
      h("text", { style: { color: theme.text, fontSize: 14, fontWeight: 600 } }, "Savings"),
      error ? h("text", { testId: "saver-error", style: { color: theme.bad, fontSize: 12 } }, error) : null,
      stats === null
        ? h("text", { testId: "saver-loading", style: { color: theme.muted, fontSize: 12 } }, "Loading stats...")
        : h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: 4 } },
            h(
              "text",
              { testId: "saver-rtk-bytes", style: { color: theme.text, fontSize: 12 } },
              `RTK saved ${rtk.bytesSaved || 0} bytes across ${rtk.hitRequests || 0} requests`
            ),
            h(
              "text",
              { testId: "saver-caveman", style: { color: theme.text, fontSize: 12 } },
              `Caveman on ${caveman.onRequests || 0} requests, off ${caveman.offRequests || 0}`
            )
          )
    ),
    h(
      "div",
      {
        testId: "saver-settings",
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
      h("text", { style: { color: theme.text, fontSize: 14, fontWeight: 600 } }, "Switches"),
      settings === null
        ? h("text", { testId: "saver-settings-loading", style: { color: theme.muted, fontSize: 12 } }, "Loading settings...")
        : h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: 8 } },
            h(Toggle, {
              label: "Caveman compression",
              value: settings.cavemanEnabled === true,
              onToggle: (value) => patch({ cavemanEnabled: value }),
              testId: "saver-caveman-toggle",
            }),
            h(
              "div",
              { style: { display: "flex", flexDirection: "row", gap: 8 } },
              ...LEVELS.map((level) =>
                h(
                  "text",
                  {
                    key: level.id,
                    testId: `saver-level-${level.id}`,
                    role: "button",
                    onClick: () => patch({ cavemanLevel: level.id }),
                    style: {
                      paddingTop: 4,
                      paddingBottom: 4,
                      paddingLeft: 10,
                      paddingRight: 10,
                      borderRadius: 999,
                      backgroundColor: settings.cavemanLevel === level.id ? theme.panelAlt : "transparent",
                      borderWidth: 1,
                      borderColor: settings.cavemanLevel === level.id ? theme.border : "transparent",
                      color: settings.cavemanLevel === level.id ? theme.text : theme.muted,
                      fontSize: 11,
                      cursor: "pointer",
                      hover: { color: theme.text },
                    },
                  },
                  level.label
                )
              )
            ),
            h(Toggle, {
              label: "RTK byte saver",
              value: settings.rtkEnabled === true,
              onToggle: (value) => patch({ rtkEnabled: value }),
              testId: "saver-rtk-toggle",
            })
          ),
      h(
        "text",
        { style: { color: theme.muted, fontSize: 11 } },
        "RTK and Caveman are the only saver tools in scope. Headroom start/stop, pxpipe and the other savers are deferred by the owner."
      )
    ),
    h(
      "div",
      {
        testId: "saver-headroom",
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
      h("text", { style: { color: theme.text, fontSize: 14, fontWeight: 600 } }, "Headroom"),
      headroom === null
        ? h("text", { testId: "saver-headroom-loading", style: { color: theme.muted, fontSize: 12 } }, "Reading status...")
        : headroom === false
          ? h("text", { testId: "saver-headroom-unavailable", style: { color: theme.muted, fontSize: 12 } }, "Status unavailable.")
          : h(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: 4 } },
              h(
                "text",
                { testId: "saver-headroom-installed", style: { color: theme.text, fontSize: 12 } },
                `Installed: ${headroom.installed ? "yes" : "no"} · running: ${headroom.running ? "yes" : "no"}`
              ),
              h(
                "text",
                { testId: "saver-headroom-version", style: { color: theme.muted, fontSize: 11 } },
                `Version: ${headroom.version || "unknown"}`
              ),
              h(
                "text",
                { testId: "saver-headroom-url", style: { color: theme.muted, fontSize: 11 } },
                `URL: ${headroom.url || "unknown"}`
              )
            ),
      h(
        "text",
        { style: { color: theme.muted, fontSize: 11 } },
        "Read-only read-out; starting or stopping headroom stays on the dashboard."
      )
    )
  );
}
