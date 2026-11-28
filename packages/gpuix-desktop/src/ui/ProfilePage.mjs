// Native Profile & settings page (local slice of the dashboard profile).
//
// Only settings that are safe to flip from the isolated shell are exposed:
// require-login, tunnel dashboard access, the dashboard password and the
// gateway's outbound proxy. Tunnel setup and backup/restore stay in the
// dashboard because they need external processes or file dialogs.
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
  const [proxyEnabled, setProxyEnabled] = React.useState(false);
  const [proxyUrl, setProxyUrl] = React.useState("");
  const [proxyNoProxy, setProxyNoProxy] = React.useState("");
  const [proxyStatus, setProxyStatus] = React.useState("");

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

  React.useEffect(() => {
    if (!settings) return;
    setProxyEnabled(settings.outboundProxyEnabled === true);
    setProxyUrl(settings.outboundProxyUrl || "");
    setProxyNoProxy(settings.outboundNoProxy || "");
  }, [settings]);

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

  const labeledField = (testId, label, value, onChange) =>
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

  // Outbound proxy applies to the gateway's own egress (upstream calls), not the
  // shell. Saving pushes the env immediately, so it stays user-initiated.
  const saveProxy = () => {
    setProxyStatus("");
    api
      .patchSettings({
        outboundProxyEnabled: proxyEnabled,
        outboundProxyUrl: proxyUrl.trim(),
        outboundNoProxy: proxyNoProxy.trim(),
      })
      .then((next) => {
        setSettings(next);
        setProxyStatus("Outbound proxy saved.");
      })
      .catch((err) => setProxyStatus(err.message));
  };

  const testProxy = () => {
    setProxyStatus("Testing...");
    api
      .testProxyUrl(proxyUrl.trim())
      .then((result) =>
        setProxyStatus(result.ok ? `Proxy OK ${result.status || ""} ${result.elapsedMs || 0}ms`.trim() : `Failed: ${result.error || result.status}`)
      )
      .catch((err) => setProxyStatus(`Failed: ${err.message}`));
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
            h(Toggle, {
              label: "Request observability",
              hint: "Keep the request log and console details available in the dashboard.",
              value: settings.enableObservability === true,
              onToggle: (value) => patch({ enableObservability: value }),
              testId: "profile-observability",
            }),
            h(
              "div",
              {
                testId: "profile-proxy-section",
                style: {
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  paddingTop: 10,
                  borderTopWidth: 1,
                  borderColor: theme.border,
                },
              },
              h("text", { style: { color: theme.text, fontSize: 12, fontWeight: 600 } }, "Outbound proxy"),
              h(
                "text",
                { style: { color: theme.muted, fontSize: 10 } },
                "Applies to the gateway's upstream calls; saving is immediate."
              ),
              h(
                "div",
                { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 10 } },
                h("text", { style: { color: theme.muted, fontSize: 11, width: 120 } }, "Enabled"),
                h(
                  "text",
                  {
                    testId: "profile-proxy-enable",
                    role: "button",
                    onClick: () => setProxyEnabled((value) => !value),
                    style: {
                      color: proxyEnabled ? theme.ok : theme.muted,
                      fontSize: 11,
                      cursor: "pointer",
                      hover: { color: theme.text },
                    },
                  },
                  proxyEnabled ? "Enabled" : "Disabled"
                )
              ),
              labeledField("profile-proxy-url", "Proxy URL", proxyUrl, setProxyUrl),
              labeledField("profile-proxy-noproxy", "No proxy", proxyNoProxy, setProxyNoProxy),
              h(
                "div",
                { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 16 } },
                h(
                  "text",
                  {
                    testId: "profile-proxy-save",
                    role: "button",
                    onClick: saveProxy,
                    style: { color: theme.ok, fontSize: 11, cursor: "pointer", hover: { color: theme.text } },
                  },
                  "Save proxy"
                ),
                h(
                  "text",
                  {
                    testId: "profile-proxy-test",
                    role: "button",
                    onClick: testProxy,
                    style: { color: theme.muted, fontSize: 11, cursor: "pointer", hover: { color: theme.text } },
                  },
                  "Test"
                )
              ),
              proxyStatus
                ? h("text", { testId: "profile-proxy-status", style: { color: theme.muted, fontSize: 10 } }, proxyStatus)
                : null
            ),
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
                ? labeledField("profile-current-password", "Current password", currentPassword, setCurrentPassword)
                : null,
              labeledField("profile-new-password", "New password", newPassword, setNewPassword),
              labeledField("profile-confirm-password", "Confirm password", confirmPassword, setConfirmPassword),
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
        "Tunnel setup and backup/restore are not native yet."
      )
    )
  );
}
