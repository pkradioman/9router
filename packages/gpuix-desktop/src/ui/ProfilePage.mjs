// Native Profile & settings page (local slice of the dashboard profile).
//
// Only settings that are safe to flip from the isolated shell are exposed:
// require-login and tunnel dashboard access. Password, proxy, tunnel setup and
// backup/restore stay in the dashboard because they need masked input or
// external processes.
import React from "react";
import { theme } from "./theme.mjs";

const h = React.createElement;

function Toggle({ label, hint, value, onToggle, testId }) {
  return h(
    "div",
    { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 4 } },
    h(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: 2, width: 260 } },
      h("text", { style: { color: theme.text, fontSize: 12 } }, label),
      h("text", { style: { color: theme.muted, fontSize: 10 } }, hint)
    ),
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

export function ProfilePage({ api, status }) {
  const [settings, setSettings] = React.useState(null);
  const [error, setError] = React.useState("");

  const load = React.useCallback(() => {
    setError("");
    setSettings(null);
    api
      .getSettings()
      .then(setSettings)
      .catch((err) => setError(err.message));
  }, [api]);

  React.useEffect(() => {
    load();
  }, [load]);

  const patch = (change) => {
    setError("");
    api
      .patchSettings(change)
      .then(setSettings)
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
        gap: 16,
      },
    },
    h(
      "div",
      {
        testId: "profile-section",
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
      h("text", { style: { color: theme.text, fontSize: 14, fontWeight: 600 } }, "Profile & settings"),
      h(
        "text",
        { style: { color: theme.muted, fontSize: 11 } },
        `Gateway ${status.baseUrl} · data ${status.dataDir}`
      ),
      error ? h("text", { testId: "profile-error", style: { color: theme.bad, fontSize: 12 } }, error) : null,
      settings === null
        ? h("text", { testId: "profile-loading", style: { color: theme.muted, fontSize: 12 } }, "Loading settings...")
        : h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: 8 } },
            h(Toggle, {
              label: "Require dashboard login",
              hint: "Keep the dashboard behind the password; local CLI token access stays available.",
              value: settings.requireLogin !== false,
              onToggle: (value) => patch({ requireLogin: value }),
              testId: "profile-require-login",
            }),
            h(Toggle, {
              label: "Allow dashboard via tunnel",
              hint: "When off, tunnel and Tailscale hosts are redirected to login.",
              value: settings.tunnelDashboardAccess === true,
              onToggle: (value) => patch({ tunnelDashboardAccess: value }),
              testId: "profile-tunnel-access",
            }),
            h(
              "text",
              { testId: "profile-password", style: { color: theme.muted, fontSize: 11 } },
              settings.hasPassword ? "Password is set." : "No dashboard password set."
            )
          ),
      h(
        "text",
        { style: { color: theme.muted, fontSize: 11 } },
        "Password change, proxy, tunnel setup and backup/restore are not native yet."
      )
    )
  );
}
