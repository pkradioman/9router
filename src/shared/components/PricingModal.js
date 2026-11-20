"use client";

import { useState, useEffect } from "react";
import { getDefaultPricing, formatCost } from "open-sse/providers/pricing.js";

export default function PricingModal({ isOpen, onClose, onSave }) {
  const [pricingData, setPricingData] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [nodes, setNodes] = useState([]);
  const [form, setForm] = useState({ provider: "", model: "", input: "", output: "", cached: "", reasoning: "", cache_creation: "" });
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadPricing();
      fetch("/api/provider-nodes")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setNodes(d?.nodes || []))
        .catch(() => {});
    }
  }, [isOpen]);

  const loadPricing = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/pricing");
      if (response.ok) {
        const data = await response.json();
        setPricingData(data);
      } else {
        // Fallback to defaults
        const defaults = getDefaultPricing();
        setPricingData(defaults);
      }
    } catch (error) {
      console.error("Failed to load pricing:", error);
      const defaults = getDefaultPricing();
      setPricingData(defaults);
    } finally {
      setLoading(false);
    }
  };

  const handlePricingChange = (provider, model, field, value) => {
    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue < 0) return;

    setPricingData(prev => {
      const newData = { ...prev };
      if (!newData[provider]) newData[provider] = {};
      if (!newData[provider][model]) newData[provider][model] = {};
      newData[provider][model][field] = numValue;
      return newData;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pricingData)
      });

      if (response.ok) {
        onSave?.();
        onClose();
      } else {
        const error = await response.json();
        alert(`Failed to save pricing: ${error.error}`);
      }
    } catch (error) {
      console.error("Failed to save pricing:", error);
      alert("Failed to save pricing");
    } finally {
      setSaving(false);
    }
  };

  const handleAddEntry = async () => {
    const provider = form.provider.trim();
    const model = form.model.trim();
    const input = parseFloat(form.input);
    const output = parseFloat(form.output);
    if (!provider || !model || !Number.isFinite(input) || !Number.isFinite(output)) {
      alert("Provider, model, input and output rate are required.");
      return;
    }
    const pricing = { input, output };
    for (const key of ["cached", "reasoning", "cache_creation"]) {
      const value = parseFloat(form[key]);
      if (Number.isFinite(value)) pricing[key] = value;
    }
    setAdding(true);
    try {
      const response = await fetch("/api/pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [provider]: { [model]: pricing } }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        alert(`Failed to add pricing: ${error.error || response.status}`);
        return;
      }
      setForm({ provider: "", model: "", input: "", output: "", cached: "", reasoning: "", cache_creation: "" });
      await loadPricing();
    } catch (error) {
      console.error("Failed to add pricing:", error);
      alert("Failed to add pricing");
    } finally {
      setAdding(false);
    }
  };

  const handleReset = async () => {
    if (!confirm("Reset all pricing to defaults? This cannot be undone.")) return;

    try {
      const response = await fetch("/api/pricing", { method: "DELETE" });
      if (response.ok) {
        const defaults = getDefaultPricing();
        setPricingData(defaults);
      }
    } catch (error) {
      console.error("Failed to reset pricing:", error);
      alert("Failed to reset pricing");
    }
  };

  if (!isOpen) return null;

  // Get all unique providers and models for display
  const allProviders = Object.keys(pricingData).sort();
  const pricingFields = ["input", "output", "cached", "reasoning", "cache_creation"];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-base border border-border rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-xl font-semibold">Pricing Configuration</h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="text-center py-8 text-text-muted">Loading pricing data...</div>
          ) : (
            <div className="space-y-6">
              {/* Instructions */}
              <div className="bg-bg-subtle border border-border rounded-lg p-3 text-sm">
                <p className="font-medium mb-1">Pricing Rates Format</p>
                <p className="text-text-muted">
                  All rates are in <strong>dollars per million tokens</strong> ($/1M tokens).
                  Example: Input rate of 2.50 means $2.50 per 1,000,000 input tokens.
                </p>
              </div>

              {/* Add a provider/model rate (custom OpenAI-compatible nodes are not in the defaults) */}
              <div className="border border-border rounded-lg p-3">
                <p className="font-medium text-sm mb-2">Add / update a rate</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                  <input
                    list="pricing-provider-options"
                    placeholder="provider (node id or prefix)"
                    value={form.provider}
                    onChange={(e) => setForm({ ...form, provider: e.target.value })}
                    className="col-span-2 px-2 py-1 text-sm bg-bg-base border border-border rounded focus:outline-none focus:border-primary"
                  />
                  <datalist id="pricing-provider-options">
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>{n.name}</option>
                    ))}
                    {nodes.filter((n) => n.prefix).map((n) => (
                      <option key={`${n.id}-prefix`} value={n.prefix}>{n.name} (prefix)</option>
                    ))}
                  </datalist>
                  <input
                    placeholder="model id"
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                    className="col-span-2 px-2 py-1 text-sm bg-bg-base border border-border rounded focus:outline-none focus:border-primary"
                  />
                  {["input", "output", "cached", "reasoning", "cache_creation"].map((field) => (
                    <input
                      key={field}
                      type="number"
                      step="0.0001"
                      min="0"
                      placeholder={field}
                      value={form[field]}
                      onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                      className="px-2 py-1 text-sm text-right bg-bg-base border border-border rounded focus:outline-none focus:border-primary"
                    />
                  ))}
                  <button
                    onClick={handleAddEntry}
                    disabled={adding}
                    className="col-span-2 px-3 py-1 text-sm rounded bg-primary text-white disabled:opacity-50"
                  >
                    {adding ? "Saving..." : "Save rate"}
                  </button>
                </div>
                <p className="text-[11px] text-text-muted mt-2">
                  $ per 1M tokens. Use the node id for one connection or the node prefix to cover all of its connections.
                  Custom OpenAI-compatible nodes are never priced by model-name globs.
                </p>
              </div>

              {/* Pricing Tables */}
              {allProviders.map(provider => {
                const models = Object.keys(pricingData[provider]).sort();
                return (
                  <div key={provider} className="border border-border rounded-lg overflow-hidden">
                    <div className="bg-bg-subtle px-4 py-2 font-semibold text-sm">
                      {provider.toUpperCase()}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-bg-hover text-text-muted uppercase text-xs">
                          <tr>
                            <th className="px-3 py-2 text-left">Model</th>
                            <th className="px-3 py-2 text-right">Input</th>
                            <th className="px-3 py-2 text-right">Output</th>
                            <th className="px-3 py-2 text-right">Cached</th>
                            <th className="px-3 py-2 text-right">Reasoning</th>
                            <th className="px-3 py-2 text-right">Cache Creation</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {models.map(model => (
                            <tr key={model} className="hover:bg-bg-subtle/50">
                              <td className="px-3 py-2 font-medium">{model}</td>
                              {pricingFields.map(field => (
                                <td key={field} className="px-3 py-2">
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={pricingData[provider][model][field] || 0}
                                    onChange={(e) => handlePricingChange(provider, model, field, e.target.value)}
                                    className="w-20 px-2 py-1 text-right bg-bg-base border border-border rounded focus:outline-none focus:border-primary"
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}

              {allProviders.length === 0 && (
                <div className="text-center py-8 text-text-muted">
                  No pricing data available
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex items-center justify-between gap-2">
          <button
            onClick={handleReset}
            className="px-4 py-2 text-sm text-red-500 hover:bg-red-500/10 rounded border border-red-500/20 transition-colors"
            disabled={saving}
          >
            Reset to Defaults
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-text-muted hover:text-text border border-border rounded transition-colors"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm bg-primary text-white rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}