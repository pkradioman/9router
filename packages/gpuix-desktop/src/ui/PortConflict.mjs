import React from "react";
import { resolvePort } from "../config.mjs";
import { theme } from "./theme.mjs";

const h = React.createElement;

export function PortConflict({ occupiedPort, onChoose, onCancel }) {
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState("");
  const submit = () => {
    try {
      if (!value.trim()) throw new Error("Enter a port.");
      const port = resolvePort({ NINEROUTER_GPU_UIX_PORT: value });
      if (port === occupiedPort) throw new Error("Choose a different port.");
      onChoose(port);
    } catch (err) {
      setError(err.message);
    }
  };
  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", backgroundColor: theme.canvas, height: "100%", padding: 24, gap: 16 } },
    h("text", { style: { color: theme.text, fontSize: 20 } }, "Experimental gateway port in use"),
    h("text", { style: { color: theme.text, fontSize: 14 } }, `Port ${occupiedPort} is occupied. Choose another port.`),
    h("text", { style: { color: theme.muted, fontSize: 12 } }, "Port 20128 is reserved for the installed app."),
    h("input", {
      testId: "port-input",
      "aria-label": "Alternative port",
      value,
      onChange: (event) => setValue(event.value ?? ""),
      onSubmit: submit,
      autoFocus: true,
      placeholder: "Port number",
      style: { width: 220, height: 36, color: theme.text, backgroundColor: theme.card },
    }),
    error && h("text", { testId: "port-error", style: { color: "#f16c6c", fontSize: 12 } }, error),
    h("div", { style: { display: "flex", flexDirection: "row", gap: 20 } },
      h("text", { testId: "port-retry", role: "button", "aria-label": "Retry", onClick: submit, style: { color: "#3ecf8e" } }, "Retry"),
      h("text", { testId: "port-cancel", role: "button", "aria-label": "Cancel", onClick: onCancel, style: { color: theme.text } }, "Cancel")
    )
  );
}
