// Presentational primitives for the GPUIX shell.
//
// Pure createElement components (the package has no JSX transform) and no
// hooks. Every component accepts an optional `testId` and `style`; `style` is
// merged last so callers can keep the exact control geometry they had before
// the light-theme pass. No behaviour lives here: handlers are passed straight
// through, and a null handler means "disabled/busy" exactly as at the call site.
import React from "react";
import { theme } from "./theme.mjs";

const h = React.createElement;

export function Section({ children, testId, style }) {
  return h(
    "div",
    {
      testId,
      style: {
        display: "flex",
        flexDirection: "column",
        backgroundColor: theme.card,
        borderWidth: 1,
        borderColor: theme.subtle,
        borderRadius: theme.radiusLg,
        padding: 16,
        gap: 12,
        minWidth: 0,
        ...style,
      },
    },
    children
  );
}

export function SectionTitle({ children, subtitle, testId, style }) {
  return h(
    "div",
    { testId, style: { display: "flex", flexDirection: "column", gap: 2, ...style } },
    h("text", { style: { color: theme.text, fontSize: 14, fontWeight: 600 } }, children),
    subtitle ? h("text", { style: { color: theme.muted, fontSize: 11 } }, subtitle) : null
  );
}

export function Chip({ children, active, onClick, testId, style }) {
  const props = {
    testId,
    style: {
      borderRadius: 999,
      paddingTop: 5,
      paddingBottom: 5,
      paddingLeft: 10,
      paddingRight: 10,
      fontSize: 11,
      cursor: onClick ? "pointer" : "default",
      ...(active
        ? { backgroundColor: theme.primarySoft, color: theme.primary }
        : { backgroundColor: "transparent", color: theme.muted, hover: { color: theme.text } }),
      ...style,
    },
  };
  if (onClick) props.onClick = onClick;
  return h("text", props, children);
}

const BUTTON_VARIANTS = {
  primary: {
    height: 32,
    backgroundColor: theme.primary,
    color: "#ffffff",
    hover: { backgroundColor: theme.primaryHover },
  },
  secondary: {
    height: 30,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    color: theme.text,
    hover: { backgroundColor: theme.panelAlt },
  },
  ghost: {
    height: 30,
    backgroundColor: "transparent",
    color: theme.muted,
    hover: { color: theme.text, backgroundColor: theme.panelAlt },
  },
  danger: {
    height: 30,
    backgroundColor: "transparent",
    color: theme.bad,
    borderWidth: 1,
    borderColor: theme.border,
    hover: { backgroundColor: theme.panelAlt },
  },
};

export function Button({ children, variant = "secondary", onClick, testId, style }) {
  const enabled = typeof onClick === "function";
  const base = BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.secondary;
  const props = {
    testId,
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 12,
      fontWeight: 500,
      borderRadius: theme.radius,
      paddingLeft: 12,
      paddingRight: 12,
      cursor: enabled ? "pointer" : "default",
      ...base,
      ...(enabled ? null : { color: theme.faint, hover: {} }),
      ...style,
    },
  };
  if (enabled) props.onClick = onClick;
  return h("text", props, children);
}

export function Field({
  label,
  value,
  onChange,
  onSubmit,
  placeholder,
  testId,
  width,
  height = 30,
  style,
  inputStyle,
  fontFamily,
  ...inputProps
}) {
  const fieldStyle = {
    height,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.subtle,
    borderRadius: theme.radius,
    paddingLeft: 8,
    paddingRight: 8,
    fontSize: 12,
    color: theme.text,
    focusVisible: { outlineWidth: 2, outlineColor: theme.primary },
  };
  if (width !== undefined) fieldStyle.width = width;
  if (fontFamily) fieldStyle.fontFamily = fontFamily;

  const input = h("input", {
    ...inputProps,
    testId,
    value,
    onChange,
    onSubmit,
    placeholder,
    style: { ...fieldStyle, ...inputStyle },
  });

  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: 4, ...style } },
    label ? h("text", { style: { color: theme.muted, fontSize: 11 } }, label) : null,
    input
  );
}

export function Stat({ label, value, testId, style }) {
  return h(
    "div",
    { testId, style: { display: "flex", flexDirection: "column", gap: 2, ...style } },
    h("text", { style: { color: theme.muted, fontSize: 11 } }, label),
    h("text", { style: { color: theme.text, fontSize: 20, fontWeight: 600 } }, value)
  );
}

export function EmptyState({ children, testId, style }) {
  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        ...style,
      },
    },
    h("text", { testId, style: { color: theme.muted, fontSize: 12, textAlign: "center" } }, children)
  );
}

export function InlineError({ children, testId, style }) {
  return h("text", { testId, style: { color: theme.bad, fontSize: 12, ...style } }, children);
}
