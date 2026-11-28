// Light warm palette, mirroring the shipping dashboard's src/app/globals.css.
//
// The first nine keys are the historical shell contract and are referenced by
// every page; keep them even when a key looks redundant with a newer alias.
export const theme = {
  // Historical keys (all pages depend on these).
  surface: "#FDFAF6",
  panel: "#ffffff",
  panelAlt: "#f4f4f5",
  border: "#e5e7eb",
  text: "#0a0a0a",
  muted: "#6B7280",
  ok: "#10B981",
  warn: "#F59E0B",
  bad: "#cf222e",

  // Extended tokens.
  canvas: "#FDFAF6",
  card: "#ffffff",
  subtle: "#f1f1f3",
  primary: "#E56A4A",
  primaryHover: "#cc5236",
  primarySoft: "#FDEFEA",
  info: "#3B82F6",
  radius: 10,
  radiusLg: 14,
  faint: "#9CA3AF",
  shadow: { offsetX: 0, offsetY: 1, blurRadius: 2, spreadRadius: 0, color: "rgba(0,0,0,0.04)" },
  // Text inputs: white field, hairline ring, inner padding — spread after the
  // size so each call site keeps its own width/height.
  input: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    paddingLeft: 8,
    paddingRight: 8,
  },
};
