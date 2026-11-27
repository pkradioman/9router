import { PROVIDERS } from "open-sse/config/providers.js";
import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";
import { modelKind } from "open-sse/providers/models/schema.js";

const CLOUDFLARE_ID = "cloudflare-ai";
export const CLOUDFLARE_ALIASES = ["cloudflare-ai", "cf"];
// Verified live Workers AI chat model; only used when the saved configuration names no
// usable model (e.g. every built-in is disabled and no custom model exists).
export const CLOUDFLARE_FALLBACK_TEST_MODEL = "@cf/openai/gpt-oss-20b";

function isEnabledModel(id, disabled, enabled) {
  if (!id || disabled.has(id)) return false;
  if (!enabled) return true;
  return enabled.has(id) || CLOUDFLARE_ALIASES.some((alias) => enabled.has(`${alias}/${id}`));
}

/**
 * Pick the model to probe with, mirroring what the connection actually routes:
 * - AI Gateway mode: an enabled custom-provider model first (custom-{slug}/... only
 *   exists behind the gateway), then an enabled built-in chat model.
 * - Direct Workers AI: enabled built-in chat model only; custom models 404 there.
 */
export function pickCloudflareTestModel({ providerSpecificData = {}, disabledModels = {}, customModels = [] } = {}) {
  const gatewayId = String(providerSpecificData.gatewayId || "").trim();
  const enabled = Array.isArray(providerSpecificData.enabledModels) && providerSpecificData.enabledModels.length
    ? new Set(providerSpecificData.enabledModels)
    : null;
  const disabled = new Set(CLOUDFLARE_ALIASES.flatMap((alias) => disabledModels[alias] || []));

  if (gatewayId) {
    const custom = customModels.find((m) =>
      CLOUDFLARE_ALIASES.includes(m.providerAlias)
      && (m.type || "llm") === "llm"
      && isEnabledModel(m.id, disabled, enabled));
    if (custom) return custom.id;
  }

  const builtin = (PROVIDER_MODELS[CLOUDFLARE_ID] || []).find((m) =>
    modelKind(m) === "llm" && isEnabledModel(m.id, disabled, enabled));

  return builtin?.id || CLOUDFLARE_FALLBACK_TEST_MODEL;
}

/**
 * Resolve the probe URL, auth headers and model for a saved Cloudflare connection.
 */export function resolveCloudflareTestTarget({ providerSpecificData = {}, apiKey, disabledModels = {}, customModels = [] } = {}) {
  const { accountId } = providerSpecificData;
  if (!accountId) return { error: "Missing Account ID" };

  const gatewayId = String(providerSpecificData.gatewayId || "").trim();
  const gateway = PROVIDERS[CLOUDFLARE_ID]?.aiGateway;
  const base = gatewayId && gateway?.baseUrl
    ? gateway.baseUrl.replace("{accountId}", accountId).replace("{gatewayId}", gatewayId)
    : PROVIDERS[CLOUDFLARE_ID].baseUrl.replace("{accountId}", accountId);

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
  if (gatewayId && gateway?.authHeader) headers[gateway.authHeader] = `Bearer ${apiKey}`;

  const model = pickCloudflareTestModel({ providerSpecificData, disabledModels, customModels });
  return { url: base, headers, model, gatewayId: gatewayId || null };
}

// 4xx/410 here means the account, token, gateway or model is wrong, not a passing probe.
const REJECTED_STATUSES = new Set([401, 403, 404, 410]);

export function cloudflareProbeError(status, model) {
  return REJECTED_STATUSES.has(status)
    ? `Cloudflare rejected ${model} (HTTP ${status})`
    : null;
}
