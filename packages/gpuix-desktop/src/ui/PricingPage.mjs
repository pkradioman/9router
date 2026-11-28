// Native pricing settings: per-model rates used for cost tracking.
//
// Mirrors the dashboard settings/pricing screen with an inline editor instead
// of a modal: pick a provider, filter models, edit rates in place, or reset a
// model / all overrides back to built-in defaults. Rates are $ per 1M tokens.
import React from "react";
import { theme } from "./theme.mjs";

const h = React.createElement;
const FIELDS = ["input", "output", "cached", "reasoning", "cache_creation"];

function rateText(rates) {
  if (!rates) return "";
  const parts = [];
  for (const key of FIELDS) {
    if (rates[key] === undefined || rates[key] === null) continue;
    parts.push(`${key === "cache_creation" ? "cache" : key} ${rates[key]}`);
  }
  return parts.join(" · ");
}

function PricingRow({ provider, model, rates, busy, onSave, onReset }) {
  const [editing, setEditing] = React.useState(false);
  const [drafts, setDrafts] = React.useState({});
  const [message, setMessage] = React.useState("");

  const open = () => {
    const next = {};
    for (const key of FIELDS) {
      next[key] = rates && rates[key] !== undefined && rates[key] !== null ? String(rates[key]) : "";
    }
    setDrafts(next);
    setMessage("");
    setEditing(true);
  };

  const save = () => {
    const input = Number(drafts.input);
    const output = Number(drafts.output);
    if (
      drafts.input === "" ||
      drafts.output === "" ||
      !Number.isFinite(input) ||
      !Number.isFinite(output) ||
      input < 0 ||
      output < 0
    ) {
      setMessage("Input and output rates are required.");
      return;
    }
    const entry = { input, output };
    for (const key of ["cached", "reasoning", "cache_creation"]) {
      if (drafts[key] === "") continue;
      const value = Number(drafts[key]);
      if (!Number.isFinite(value) || value < 0) {
        setMessage(`Invalid ${key} rate.`);
        return;
      }
      entry[key] = value;
    }
    setMessage("");
    onSave(provider, model, entry);
    setEditing(false);
  };

  const chip = (testId, label, onClick, color) =>
    h(
      "text",
      {
        testId,
        role: "button",
        onClick: busy ? null : onClick,
        style: {
          color: busy ? theme.muted : color,
          fontSize: 10,
          cursor: busy ? "default" : "pointer",
          hover: busy ? {} : { color: theme.text },
        },
      },
      label
    );

  return h(
    "div",
    {
      testId: `pricing-row-${model}`,
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 3,
        paddingTop: 5,
        paddingBottom: 5,
        borderTopWidth: 1,
        borderColor: theme.border,
      },
    },
    h(
      "div",
      { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 12 } },
      h("text", { style: { color: theme.text, fontSize: 11, flexGrow: 1, minWidth: 160 } }, model),
      h("text", { style: { color: theme.muted, fontSize: 10 } }, rateText(rates)),
      chip(`pricing-edit-${model}`, editing ? "Close" : "Edit", () => (editing ? setEditing(false) : open()), theme.muted),
      chip(`pricing-reset-${model}`, "Reset", () => onReset(provider, model), theme.bad)
    ),
    editing
      ? h(
          "div",
          { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" } },
          ...FIELDS.map((key) =>
            h("input", {
              key,
              testId: `pricing-${key}-${model}`,
              "aria-label": `${key} rate`,
              value: drafts[key] ?? "",
              onChange: (event) => setDrafts((value) => ({ ...value, [key]: event.value ?? "" })),
              onSubmit: save,
              placeholder: key,
              style: { width: 82, height: 24, color: theme.text, backgroundColor: theme.panelAlt },
            })
          ),
          h(
            "text",
            {
              testId: `pricing-save-${model}`,
              role: "button",
              onClick: save,
              style: { color: theme.ok, fontSize: 10, cursor: "pointer", hover: { color: theme.text } },
            },
            "Save"
          )
        )
      : null,
    message
      ? h("text", { testId: `pricing-row-error-${model}`, style: { color: theme.bad, fontSize: 10 } }, message)
      : null
  );
}

export function PricingPage({ api }) {
  const [pricing, setPricing] = React.useState(null);
  const [selected, setSelected] = React.useState("");
  const [providerFilter, setProviderFilter] = React.useState("");
  const [modelFilter, setModelFilter] = React.useState("");
  const [resetArm, setResetArm] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    setError("");
    api
      .getPricing()
      .then((body) => setPricing(body || {}))
      .catch((err) => {
        setPricing({});
        setError(err.message);
      });
  }, [api]);

  React.useEffect(() => {
    load();
  }, [load]);

  const providerNames = React.useMemo(
    () => Object.keys(pricing || {}).sort((a, b) => a.localeCompare(b)),
    [pricing]
  );

  React.useEffect(() => {
    if (!selected && providerNames.length > 0) setSelected(providerNames[0]);
  }, [providerNames, selected]);

  const modelCount = React.useMemo(
    () => providerNames.reduce((total, name) => total + Object.keys(pricing[name] || {}).length, 0),
    [pricing, providerNames]
  );

  const providerQuery = providerFilter.trim().toLowerCase();
  const matchingProviders = providerQuery
    ? providerNames.filter((name) => name.toLowerCase().includes(providerQuery))
    : providerNames;
  const shownProviders = matchingProviders.slice(0, 24);

  const models =
    selected && pricing && pricing[selected] ? Object.keys(pricing[selected]).sort((a, b) => a.localeCompare(b)) : [];
  const modelQuery = modelFilter.trim().toLowerCase();
  const shownModels = modelQuery ? models.filter((model) => model.toLowerCase().includes(modelQuery)) : models;

  const guard = (work) => {
    setBusy(true);
    setError("");
    setNotice("");
    return Promise.resolve(work)
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const saveRates = (provider, model, entry) => {
    void guard(
      api.patchPricing({ [provider]: { [model]: entry } }).then(() => {
        setNotice(`Saved ${provider}/${model}.`);
        load();
      })
    );
  };

  const resetModel = (provider, model) => {
    void guard(
      api.resetPricing(provider, model).then(() => {
        setNotice(`Reset ${provider}/${model} to the built-in rate.`);
        load();
      })
    );
  };

  const resetAll = () => {
    if (!resetArm) {
      setResetArm(true);
      setNotice("Click again to remove every custom rate.");
      return;
    }
    setResetArm(false);
    void guard(
      api.resetPricing().then(() => {
        setNotice("All pricing reset to built-in defaults.");
        load();
      })
    );
  };

  const chip = (testId, label, onClick, active) =>
    h(
      "text",
      {
        testId,
        role: "button",
        onClick: busy ? null : onClick,
        style: {
          color: busy ? theme.muted : active ? theme.ok : theme.muted,
          fontSize: 11,
          cursor: busy ? "default" : "pointer",
          hover: busy ? {} : { color: theme.text },
        },
      },
      label
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
      { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 16, flexWrap: "wrap" } },
      h("text", { style: { color: theme.text, fontSize: 14, fontWeight: 600 } }, "Pricing"),
      h("text", { style: { color: theme.muted, fontSize: 11 } }, `${providerNames.length} providers · ${modelCount} models`),
      chip("pricing-refresh", "Refresh", load, false),
      chip(
        "pricing-reset-all",
        resetArm ? "Confirm reset all" : "Reset all pricing",
        resetAll,
        resetArm
      )
    ),
    error ? h("text", { testId: "pricing-error", style: { color: theme.bad, fontSize: 12 } }, error) : null,
    notice ? h("text", { testId: "pricing-notice", style: { color: theme.ok, fontSize: 11 } }, notice) : null,
    h(
      "div",
      {
        testId: "pricing-section",
        style: {
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          minHeight: 0,
          backgroundColor: theme.panel,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 10,
          padding: 16,
          gap: 10,
        },
      },
      pricing === null
        ? h("text", { testId: "pricing-loading", style: { color: theme.muted, fontSize: 12 } }, "Loading pricing...")
        : h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: 10, flexGrow: 1, minHeight: 0 } },
            h("input", {
              testId: "pricing-provider-filter",
              "aria-label": "Filter providers",
              value: providerFilter,
              onChange: (event) => setProviderFilter(event.value ?? ""),
              placeholder: "Filter providers",
              style: { width: 240, height: 28, color: theme.text, backgroundColor: theme.panelAlt },
            }),
            h(
              "div",
              { style: { display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 12 } },
              ...shownProviders.map((name) =>
                h(
                  "text",
                  {
                    key: name,
                    testId: `pricing-provider-${name}`,
                    role: "button",
                    onClick: busy ? null : () => {
                      setSelected(name);
                      setModelFilter("");
                      setResetArm(false);
                    },
                    style: {
                      color: selected === name ? theme.ok : theme.muted,
                      fontSize: 11,
                      cursor: busy ? "default" : "pointer",
                      hover: busy ? {} : { color: theme.text },
                    },
                  },
                  name
                )
              ),
              matchingProviders.length > shownProviders.length
                ? h(
                    "text",
                    { style: { color: theme.muted, fontSize: 10 } },
                    `${shownProviders.length} of ${matchingProviders.length} shown — type to narrow`
                  )
                : null
            ),
            !selected
              ? h("text", { style: { color: theme.muted, fontSize: 12 } }, "Select a provider to view its model rates.")
              : h(
                  "div",
                  { style: { display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, gap: 6 } },
                  h(
                    "div",
                    { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 12 } },
                    h(
                      "text",
                      { testId: "pricing-selected-provider", style: { color: theme.text, fontSize: 12, fontWeight: 600 } },
                      selected
                    ),
                    h("input", {
                      testId: "pricing-model-filter",
                      "aria-label": "Filter models",
                      value: modelFilter,
                      onChange: (event) => setModelFilter(event.value ?? ""),
                      placeholder: "Filter models",
                      style: { width: 200, height: 26, color: theme.text, backgroundColor: theme.panelAlt },
                    }),
                    h("text", { style: { color: theme.muted, fontSize: 10 } }, `${shownModels.length} of ${models.length}`)
                  ),
                  shownModels.length === 0
                    ? h("text", { testId: "pricing-models-empty", style: { color: theme.muted, fontSize: 11 } }, "No models match.")
                    : h(
                        "div",
                        { style: { display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 } },
                        shownModels.map((model) =>
                          h(PricingRow, {
                            key: model,
                            provider: selected,
                            model,
                            rates: pricing[selected][model],
                            busy,
                            onSave: saveRates,
                            onReset: resetModel,
                          })
                        )
                      )
                )
          )
    ),
    h(
      "text",
      { style: { color: theme.muted, fontSize: 11 } },
      "Rates are US dollars per 1M tokens. Saving writes an override for that model; Reset restores the built-in rate. Pricing only affects cost tracking."
    )
  );
}
