// Native Profile & settings page (local slice of the dashboard profile).
//
// Only settings that are safe to flip from the isolated shell are exposed:
// require-login, tunnel dashboard access and the dashboard password. Proxy,
// tunnel setup and backup/restore stay in the dashboard because they need
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
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [passwordStatus, setPasswordStatus] = React.useState("");

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

  // The gateway hashes the new password (bcrypt) and verifies the current one;
  // the plaintext never leaves this call and is cleared from state afterwards.
  const changePassword = () => {
    setError("");
    setPasswordStatus("");
    if (!newPassword) {
      setPasswordStatus("Enter a new password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordStatus("New passwords do not match.");
      return;
    }
    const change = { newPassword };
    if (settings?.hasPassword !== false) change.currentPassword = currentPassword;
    api
      .patchSettings(change)
      .then((next) => {
        setSettings(next);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setPasswordStatus("Password updated.");
      })
      .catch((err) => setPasswordStatus(err.message));
  };

  const passwordField = (testId, label, value, onChange) =>
    h(
      "div",
      { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 10 } },
      h("text", { style: { color: theme.muted, fontSize: 11, width: 120 } }, label),
      h("input", {
        testId,
        "aria-label": label,
        value,
        onChange: (event) => onChange(event.value ?? ""),
        style: { width: 200, height: 26, color: theme.text, backgroundColor: theme.panelAlt },
      })
    );

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
              "div",
              {
                testId: "profile-password-section",
                style: {
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  paddingTop: 10,
                  borderTopWidth: 1,
                  borderColor: theme.border,
                },
              },
              h("text", { style: { color: theme.text, fontSize: 12, fontWeight: 600 } }, "Dashboard password"),
              h(
                "text",
                { style: { color: theme.muted, fontSize: 10 } },
                "Fields are not masked here (GPUIX has no masked input); the gateway stores only the bcrypt hash."
              ),
              settings.hasPassword
                ? passwordField("profile-current-password", "Current password", currentPassword, setCurrentPassword)
                : null,
              passwordField("profile-new-password", "New password", newPassword, setNewPassword),
              passwordField("profile-confirm-password", "Confirm password", confirmPassword, setConfirmPassword),
              h(
                "text",
                {
                  testId: "profile-change-password",
                  role: "button",
                  onClick: changePassword,
                  style: { color: theme.ok, fontSize: 11, cursor: "pointer", hover: { color: theme.text } },
                },
                "Change password"
              ),
              passwordStatus
                ? h("text", { testId: "profile-password-status", style: { color: theme.muted, fontSize: 10 } }, passwordStatus)
                : null
            ),
            h(
              "text",
              { testId: "profile-password", style: { color: theme.muted, fontSize: 11 } },
              settings.hasPassword ? "Password is set." : "No dashboard password set."
            )
          ),
      h(
        "text",
        { style: { color: theme.muted, fontSize: 11 } },
        "Outbound proxy, tunnel setup and backup/restore are not native yet."
      )
    )
  );
}
