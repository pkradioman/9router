import { describe, it, expect } from "vitest";
import { DefaultExecutor } from "open-sse/executors/default.js";
import { PROVIDERS } from "open-sse/config/providers.js";
import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";
import {
  pickCloudflareTestModel,
  resolveCloudflareTestTarget,
  cloudflareProbeError,
  CLOUDFLARE_FALLBACK_TEST_MODEL,
} from "@/shared/utils/cloudflareTestTarget";

const ACCOUNT = "acct-1";
const GATEWAY_URL = `https://gateway.ai.cloudflare.com/v1/${ACCOUNT}/proxy/compat/chat/completions`;
const DIRECT_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/v1/chat/completions`;
const CUSTOM_ID = "custom-token-router/deepseek/deepseek-v4.1-flash-1017-free";
const CUSTOM_MODELS = [{ providerAlias: "cf", id: CUSTOM_ID, type: "llm", name: "DeepSeek V4.1 Flash" }];
const FIRST_BUILTIN = PROVIDER_MODELS["cloudflare-ai"].find((m) => (m.kind || "llm") === "llm").id;
const BUILTIN_IDS = PROVIDER_MODELS["cloudflare-ai"]
  .filter((m) => (m.kind || "llm") === "llm")
  .map((m) => m.id);

describe("cloudflare-ai AI Gateway transport (registry)", () => {
  it("declares the gateway endpoint next to the direct one", () => {
    expect(PROVIDERS["cloudflare-ai"].aiGateway).toEqual({
      baseUrl: "https://gateway.ai.cloudflare.com/v1/{accountId}/{gatewayId}/compat/chat/completions",
      authHeader: "cf-aig-authorization",
    });
  });
});

describe("DefaultExecutor — Cloudflare AI Gateway routing", () => {
  const ex = new DefaultExecutor("cloudflare-ai");

  it("builds the gateway URL when a gatewayId is saved", () => {
    const url = ex.buildUrl(CUSTOM_ID, true, 0, {
      providerSpecificData: { accountId: ACCOUNT, gatewayId: "proxy" },
    });
    expect(url).toBe(GATEWAY_URL);
  });

  it("keeps the direct Workers AI URL without a gatewayId", () => {
    const url = ex.buildUrl("@cf/openai/gpt-oss-20b", true, 0, {
      providerSpecificData: { accountId: ACCOUNT },
    });
    expect(url).toBe(DIRECT_URL);
  });

  it("requires accountId in gateway mode", () => {
    expect(() => ex.buildUrl("m", false, 0, { providerSpecificData: { gatewayId: "proxy" } }))
      .toThrow(/accountId/);
  });

  it("adds cf-aig-authorization with the connection token in gateway mode", () => {
    const headers = ex.buildHeaders(
      { apiKey: "cf-token", providerSpecificData: { accountId: ACCOUNT, gatewayId: "proxy" } },
      true, GATEWAY_URL, CUSTOM_ID, null,
    );
    expect(headers.Authorization).toBe("Bearer cf-token");
    expect(headers["cf-aig-authorization"]).toBe("Bearer cf-token");
  });

  it("does not add gateway headers without a gatewayId", () => {
    const headers = ex.buildHeaders(
      { apiKey: "cf-token", providerSpecificData: { accountId: ACCOUNT } },
      true, DIRECT_URL, "@cf/openai/gpt-oss-20b", null,
    );
    expect(headers.Authorization).toBe("Bearer cf-token");
    expect(headers["cf-aig-authorization"]).toBeUndefined();
  });
});

describe("pickCloudflareTestModel", () => {
  it("probes the enabled custom provider model through a gateway", () => {
    expect(pickCloudflareTestModel({
      providerSpecificData: { gatewayId: "proxy" },
      customModels: CUSTOM_MODELS,
    })).toBe(CUSTOM_ID);
  });

  it("never probes a custom model on the direct endpoint", () => {
    expect(pickCloudflareTestModel({ customModels: CUSTOM_MODELS })).toBe(FIRST_BUILTIN);
  });

  it("prefers the enabled built-in chat model", () => {
    const enabledId = "@cf/openai/gpt-oss-20b";
    expect(pickCloudflareTestModel({
      providerSpecificData: { gatewayId: "proxy" },
      disabledModels: { cf: BUILTIN_IDS.filter((id) => id !== enabledId) },
      customModels: CUSTOM_MODELS,
    })).toBe(CUSTOM_ID);
    expect(pickCloudflareTestModel({
      disabledModels: { cf: BUILTIN_IDS.filter((id) => id !== enabledId) },
    })).toBe(enabledId);
  });

  it("skips disabled custom models", () => {
    expect(pickCloudflareTestModel({
      providerSpecificData: { gatewayId: "proxy" },
      disabledModels: { cf: [CUSTOM_ID] },
      customModels: CUSTOM_MODELS,
    })).toBe(FIRST_BUILTIN);
  });

  it("ignores non-chat kinds and falls back when nothing is usable", () => {
    expect(pickCloudflareTestModel({
      disabledModels: { cf: BUILTIN_IDS },
      customModels: CUSTOM_MODELS,
    })).toBe(CLOUDFLARE_FALLBACK_TEST_MODEL);
  });

  it("falls back to a live model when everything built-in is disabled", () => {
    const model = pickCloudflareTestModel({
      providerSpecificData: { gatewayId: "proxy" },
      disabledModels: { cf: BUILTIN_IDS },
    });
    expect(model).toBe(CLOUDFLARE_FALLBACK_TEST_MODEL);
    expect(model.startsWith("@cf/")).toBe(true);
  });
});

describe("resolveCloudflareTestTarget", () => {
  it("probes the gateway with cf-aig-authorization and the custom model", () => {
    const target = resolveCloudflareTestTarget({
      providerSpecificData: { accountId: ACCOUNT, gatewayId: "proxy" },
      apiKey: "cf-token",
      customModels: CUSTOM_MODELS,
    });
    expect(target.error).toBeUndefined();
    expect(target.url).toBe(GATEWAY_URL);
    expect(target.model).toBe(CUSTOM_ID);
    expect(target.headers.Authorization).toBe("Bearer cf-token");
    expect(target.headers["cf-aig-authorization"]).toBe("Bearer cf-token");
  });

  it("probes Workers AI directly when no gateway is configured", () => {
    const target = resolveCloudflareTestTarget({
      providerSpecificData: { accountId: ACCOUNT },
      apiKey: "cf-token",
      customModels: CUSTOM_MODELS,
    });
    expect(target.url).toBe(DIRECT_URL);
    expect(target.headers["cf-aig-authorization"]).toBeUndefined();
  });

  it("reports a missing Account ID", () => {
    expect(resolveCloudflareTestTarget({ providerSpecificData: {}, apiKey: "k" }).error)
      .toMatch(/Account ID/);
  });
});

describe("cloudflareProbeError", () => {
  it("treats 2xx/429 as a passing auth probe", () => {
    expect(cloudflareProbeError(200, "m")).toBeNull();
    expect(cloudflareProbeError(429, "m")).toBeNull();
  });

  it("names the model when the probe is rejected", () => {
    expect(cloudflareProbeError(401, CUSTOM_ID)).toBe(`Cloudflare rejected ${CUSTOM_ID} (HTTP 401)`);
    expect(cloudflareProbeError(404, CUSTOM_ID)).toMatch(/HTTP 404/);
  });
});
