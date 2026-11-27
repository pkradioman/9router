// Native CLI Tools page: read-only connection status per supported tool.
//
// The dashboard can write each tool's config files; that path spawns and edits
// external CLI settings, so it stays pending here. The page only reports what
// /api/cli-tools/all-statuses already knows.
import React from "react";
import { theme } from "./theme.mjs";

const h = React.createElement;

const LABELS = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  droid: "Droid",
  openclaw: "OpenClaw",
  hermes: "Hermes",
  cowork: "Cowork",
  cline: "Cline",
  kilo: "Kilo",
  "deepseek-tui": "DeepSeek TUI",
  jcode: "JCode",
  "grok-build": "Grok Build",
  devin: "Devin",
  pi: "Pi",
  omp: "OMP",
  crush: "Crush",
  forge: "Forge",
  smelt: "Smelt",
  codewhale: "Codewhale",
};

function describe(entry) {
  if (!entry) return { text: "Unavailable", color: theme.muted };
  if (entry.error) return { text: "Error", color: theme.bad };
  if (entry.installed === false) return { text: "Not installed", color: theme.muted };
  if (entry.installed === true && entry.has9Router === true) return { text: "Connected to 9Router", color: theme.ok };
  if (entry.installed === true && entry.has9Router === false) return { text: "Installed, not connected", color: theme.warn };
  if (entry.installed === true) return { text: "Installed", color: theme.text };
  return { text: "Unknown", color: theme.muted };
}

export function CliToolsPage({ api }) {
  const [statuses, setStatuses] = React.useState(null);
  const [error, setError] = React.useState("");

  const load = React.useCallback(() => {
    setError("");
    setStatuses(null);
    api
      .getCliToolStatuses()
      .then(setStatuses)
      .catch((err) => {
        setStatuses({});
        setError(err.message);
      });
  }, [api]);

  React.useEffect(() => {
    load();
  }, [load]);

  const ids = statuses ? Object.keys(statuses) : [];

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
        testId: "cli-section",
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
      h(
        "div",
        { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 16 } },
        h("text", { style: { color: theme.text, fontSize: 14, fontWeight: 600 } }, "CLI tools"),
        h(
          "text",
          {
            testId: "cli-refresh",
            role: "button",
            onClick: load,
            style: { color: theme.ok, fontSize: 12, cursor: "pointer", hover: { color: theme.text } },
          },
          "Refresh"
        )
      ),
      error ? h("text", { testId: "cli-error", style: { color: theme.bad, fontSize: 12 } }, error) : null,
      statuses === null
        ? h("text", { testId: "cli-loading", style: { color: theme.muted, fontSize: 12 } }, "Checking tools...")
        : ids.length === 0
          ? h("text", { testId: "cli-empty", style: { color: theme.muted, fontSize: 12 } }, "No tool statuses returned.")
          : h(
              "div",
              { style: { display: "flex", flexDirection: "column" } },
              ...ids.map((id) => {
                const state = describe(statuses[id]);
                return h(
                  "div",
                  {
                    key: id,
                    testId: `cli-row-${id}`,
                    style: {
                      display: "flex",
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      paddingTop: 6,
                      paddingBottom: 6,
                      borderTopWidth: 1,
                      borderColor: theme.border,
                    },
                  },
                  h("text", { style: { color: theme.text, fontSize: 12, flexGrow: 1 } }, LABELS[id] || id),
                  h("text", { style: { color: state.color, fontSize: 11 } }, state.text)
                );
              })
            ),
      h(
        "text",
        { style: { color: theme.muted, fontSize: 11 } },
        "Configuring tools writes external CLI settings and is not native yet."
      )
    )
  );
}
