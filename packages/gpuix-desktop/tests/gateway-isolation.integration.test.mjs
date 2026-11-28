// End-to-end isolation proof against the real staged gateway.
//
// Boots the actual Next standalone runtime on the experimental port with an
// isolated DATA_DIR and asserts three things that matter:
//   1. the gateway becomes healthy on the configured port,
//   2. every gateway write lands in the isolated directory,
//   3. the installed application's data directory is not modified.
//
// Skipped when the staged runtime and isolated APPDATA are not prepared, so the
// default test run stays hermetic.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gatewayEnv, resolveIsolation, resolvePort } from "../src/config.mjs";
import { GatewaySupervisor, resolveRuntimeDir } from "../src/gateway-supervisor.mjs";
import { loadOrCreateSecrets } from "../src/secrets.mjs";
import { readCliToken } from "../src/cli-token.mjs";
import {
  checkAuthenticatedLanMockFlow,
  checkExperimentalRouteBlocks,
  checkUnauthenticatedLanRejection,
  summarize,
} from "../src/security-check.mjs";
import { assertIsolationHeld, snapshotDir } from "../src/isolation-proof.mjs";

const packageRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");

let runtimeDir = null;
try {
  runtimeDir = resolveRuntimeDir({ env: {}, packageRoot });
} catch {
  runtimeDir = null;
}

const cleanups = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});

async function freePort() {
  const server = net.createServer().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  return port;
}

// Uses the same snapshot format as isolation-proof.mjs so the two are comparable;
// a basename-only format would report a false "gained db\\data.sqlite".
function snapshot(dir) {
  try {
    return fs
      .readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name))
      .map((file) => {
        const stat = fs.statSync(file, { throwIfNoEntry: false });
        return stat ? `${path.relative(dir, file)}:${stat.size}:${stat.mtimeMs}` : null;
      })
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

const isolatedAppData = process.env.GPU_UIX_TEST_APPDATA;
const canRun = Boolean(runtimeDir) && Boolean(isolatedAppData) && fs.existsSync(isolatedAppData);

describe.runIf(canRun)("isolated gateway integration", () => {
  it("serves health on the experimental port, writes only inside isolated paths, and leaves the installed data alone", async () => {
    const env = { APPDATA: isolatedAppData, LOCALAPPDATA: process.env.LOCALAPPDATA };
    const isolation = resolveIsolation({ env });

    // The stand-in for the installed app's data dir. A real %APPDATA%\9router is
    // being written by the running app, so comparing it would be flaky; this
    // fixture proves the gateway never grows anything under the shared path.
    const sharedFixture = path.join(isolatedAppData, "9router");
    fs.mkdirSync(path.join(sharedFixture, "db"), { recursive: true });
    fs.writeFileSync(path.join(sharedFixture, "db", "data.sqlite"), "installed-app-sentinel");
    const sharedSnapshotBefore = snapshot(sharedFixture);
    expect(sharedSnapshotBefore.length).toBeGreaterThan(0);

    const port = await freePort();
    const secrets = loadOrCreateSecrets(isolation.dataDir);

    const supervisor = new GatewaySupervisor({
      runtimeDir,
      port,
      logDir: isolation.logDir,
      secrets,
      env: gatewayEnv({ isolation, port, secrets, runtimeDir, env }),
      healthTimeoutMs: 90_000,
    });
    cleanups.push(() => supervisor.stop());

    const health = await supervisor.start();
    expect(health).toEqual({ ok: true });

    const res = await fetch(`http://127.0.0.1:${port}/api/version`, { signal: AbortSignal.timeout(8000) });
    expect(res.ok).toBe(true);

    // A protected dashboard API must reject an unauthenticated caller even on
    // loopback: isolation must not weaken authentication.
    const guarded = await fetch(`http://127.0.0.1:${port}/api/providers`, { signal: AbortSignal.timeout(8000) });
    expect(guarded.status).toBeGreaterThanOrEqual(400);

    // A public endpoint that reads persisted settings forces the DB layer to
    // initialize, so the isolated DATA_DIR is exercised, not just created.
    const settings = await fetch(`http://127.0.0.1:${port}/api/settings/require-login`, {
      signal: AbortSignal.timeout(8000),
    });
    expect(settings.ok).toBe(true);

    // Self-update / cross-process kill routes must be refused on the staged build.
    const blocks = await checkExperimentalRouteBlocks({ baseUrl: `http://127.0.0.1:${port}` });
    expect(summarize(blocks).failures).toEqual([]);

    // Unauthenticated access must still be rejected; an authenticated LAN-style
    // session must still work and prove DB-backed writes on the isolated DB.
    const unauth = await checkUnauthenticatedLanRejection({ baseUrl: `http://127.0.0.1:${port}` });
    expect(summarize(unauth).failures).toEqual([]);
    const auth = await checkAuthenticatedLanMockFlow({
      baseUrl: `http://127.0.0.1:${port}`,
      password: secrets.initialPassword,
    });
    expect(summarize(auth).failures).toEqual([]);

    // Model management (the native Models page) round-trips on the CLI-token
    // guarded routes, so every write below lands in the isolated DB.
    const cliHeaders = { "x-9r-cli-token": readCliToken(isolation.dataDir) };
    const call = async (route, init = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}${route}`, {
        ...init,
        headers: { ...cliHeaders, ...(init.body ? { "content-type": "application/json" } : {}) },
        signal: AbortSignal.timeout(8000),
      });
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      return { status: response.status, body };
    };

    const models = await call("/api/models");
    expect(models.status).toBe(200);
    expect(Array.isArray(models.body.models)).toBe(true);
    expect(models.body.models.length).toBeGreaterThan(0);
    expect(models.body.models[0].routedModel).toContain("/");

    const disabled = await call("/api/models/disabled");
    expect(disabled.status).toBe(200);
    expect(disabled.body.disabled).toBeTruthy();

    const disable = await call("/api/models/disabled", {
      method: "POST",
      body: JSON.stringify({ providerAlias: "openai", ids: ["gpt-4o"] }),
    });
    expect(disable.status).toBe(200);
    const disabledAfter = await call("/api/models/disabled?providerAlias=openai");
    expect(disabledAfter.body.ids).toContain("gpt-4o");
    expect((await call("/api/models/disabled?providerAlias=openai&id=gpt-4o", { method: "DELETE" })).status).toBe(200);

    const addCustom = await call("/api/models/custom", {
      method: "POST",
      body: JSON.stringify({ providerAlias: "openai", id: "gpuix-probe", type: "llm" }),
    });
    expect(addCustom.status).toBe(200);
    const custom = await call("/api/models/custom");
    expect(custom.body.models.some((m) => m.id === "gpuix-probe")).toBe(true);
    expect(
      (await call("/api/models/custom?providerAlias=openai&id=gpuix-probe&type=llm", { method: "DELETE" })).status
    ).toBe(200);

    const setAlias = await call("/api/models/alias", {
      method: "PUT",
      body: JSON.stringify({ model: "openai/gpt-4o", alias: "gpuix-alias" }),
    });
    expect(setAlias.status).toBe(200);
    expect((await call("/api/models/alias?alias=gpuix-alias", { method: "DELETE" })).status).toBe(200);

    // Endpoint access controls: the require-API-key policy round-trips and the
    // read-only tunnel status answers. The original policy is restored.
    const currentSettings = await call("/api/settings");
    expect(currentSettings.status).toBe(200);
    const flipped = await call("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ requireApiKey: currentSettings.body.requireApiKey !== true }),
    });
    expect(flipped.status).toBe(200);
    await call("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ requireApiKey: currentSettings.body.requireApiKey === true }),
    });

    const tunnel = await call("/api/tunnel/status");
    expect(tunnel.status).toBe(200);
    expect(tunnel.body).toHaveProperty("tunnel");

    // Combo editing: create, replace the ordered model list, delete.
    const createdCombo = await call("/api/combos", {
      method: "POST",
      body: JSON.stringify({ name: `gpuix-probe-${Date.now()}` }),
    });
    expect(createdCombo.status).toBe(201);
    const comboId = createdCombo.body.id;
    const updatedCombo = await call(`/api/combos/${encodeURIComponent(comboId)}`, {
      method: "PUT",
      body: JSON.stringify({ models: ["openai/gpt-4o"] }),
    });
    expect(updatedCombo.status).toBe(200);
    expect(updatedCombo.body.models).toEqual(["openai/gpt-4o"]);
    expect((await call(`/api/combos/${encodeURIComponent(comboId)}`, { method: "DELETE" })).status).toBe(200);

    // Request-log filters are accepted and still return the paged envelope.
    const filtered = await call(
      "/api/usage/request-details?page=1&pageSize=5&provider=openai&status=200&startDate=2000-01-01&endDate=2999-12-31"
    );
    expect(filtered.status).toBe(200);
    expect(Array.isArray(filtered.body.details)).toBe(true);
    expect(filtered.body.pagination.pageSize).toBe(5);

    // Provider chips are fed by the distinct providers in request details.
    const usedProviders = await call("/api/usage/providers");
    expect(usedProviders.status).toBe(200);
    expect(Array.isArray(usedProviders.body.providers)).toBe(true);

    // Capacity adapter is a settings-only write; store, read back, restore.
    const capSave = await call("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({
        capacityAdapter: { vision: { enabled: false, roundRobin: false, models: ["openai/gpt-4o"] } },
      }),
    });
    expect(capSave.status).toBe(200);
    expect((await call("/api/settings")).body.capacityAdapter.vision.models).toEqual(["openai/gpt-4o"]);
    expect((await call("/api/settings", { method: "PATCH", body: JSON.stringify({ capacityAdapter: {} }) })).status).toBe(200);

    // Provider strategy overrides sit in settings.providerStrategies.
    const strategySave = await call("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ providerStrategies: { openai: { fallbackStrategy: "round-robin", stickyRoundRobinLimit: 2 } } }),
    });
    expect(strategySave.status).toBe(200);
    expect((await call("/api/settings")).body.providerStrategies.openai.stickyRoundRobinLimit).toBe(2);
    expect((await call("/api/settings", { method: "PATCH", body: JSON.stringify({ providerStrategies: {} }) })).status).toBe(200);

    // Pricing overrides: store a synthetic model rate, read it back merged into
    // the built-in table, then reset that model to the built-in rate.
    const priceSave = await call("/api/pricing", {
      method: "PATCH",
      body: JSON.stringify({ "gpuix-probe": { "probe-model": { input: 1.5, output: 4.5, cached: 0.75 } } }),
    });
    expect(priceSave.status).toBe(200);
    const priceMerged = await call("/api/pricing");
    expect(priceMerged.status).toBe(200);
    expect(priceMerged.body["gpuix-probe"]["probe-model"]).toEqual({ input: 1.5, output: 4.5, cached: 0.75 });
    const priceReset = await call("/api/pricing?provider=gpuix-probe&model=probe-model", { method: "DELETE" });
    expect(priceReset.status).toBe(200);
    expect((await call("/api/pricing")).body["gpuix-probe"]?.["probe-model"]).toBeUndefined();

    // Model availability reads connection cooldown locks; a fresh isolated DB
    // has none, and clearing a synthetic lock is a no-op that still answers 200.
    const availability = await call("/api/models/availability");
    expect(availability.status).toBe(200);
    expect(Array.isArray(availability.body.models)).toBe(true);
    const cleared = await call("/api/models/availability", {
      method: "POST",
      body: JSON.stringify({ action: "clearCooldown", provider: "gpuix-probe", model: "probe-model" }),
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.ok).toBe(true);

    // Combo presets preview is read-only and does not touch providers for the
    // "claude" source.
    const presets = await call("/api/combos/presets?source=claude");
    expect(presets.status).toBe(200);
    expect(presets.body.source).toBe("claude");
    expect(Array.isArray(presets.body.items)).toBe(true);

    // Proxy pools: create, edit name + strict mode, delete. The connection
    // target is loopback-only on a closed port; this probe never dials out.
    const createdPool = await call("/api/proxy-pools", {
      method: "POST",
      body: JSON.stringify({ name: "gpuix-probe", proxyUrl: "http://127.0.0.1:9", type: "http" }),
    });
    expect(createdPool.status).toBe(201);
    const poolId = createdPool.body.proxyPool.id;
    const updatedPool = await call(`/api/proxy-pools/${encodeURIComponent(poolId)}`, {
      method: "PUT",
      body: JSON.stringify({ name: "gpuix-probe-2", strictProxy: true }),
    });
    expect(updatedPool.status).toBe(200);
    expect(updatedPool.body.proxyPool.name).toBe("gpuix-probe-2");
    expect(updatedPool.body.proxyPool.strictProxy).toBe(true);
    expect((await call(`/api/proxy-pools/${encodeURIComponent(poolId)}`, { method: "DELETE" })).status).toBe(200);

    // Connection-level proxy binding: create a synthetic key connection, bind it
    // to a probe pool, unbind, then remove both. No provider traffic happens.
    const bindPool = await call("/api/proxy-pools", {
      method: "POST",
      body: JSON.stringify({ name: "gpuix-bind", proxyUrl: "http://127.0.0.1:9" }),
    });
    expect(bindPool.status).toBe(201);
    const bindPoolId = bindPool.body.proxyPool.id;
    const newConnection = await call("/api/providers", {
      method: "POST",
      body: JSON.stringify({ provider: "openai", apiKey: "sk-gpuix-probe", name: "gpuix-probe" }),
    });
    expect(newConnection.status).toBe(201);
    const connectionId = newConnection.body.connection.id;
    const bound = await call(`/api/providers/${encodeURIComponent(connectionId)}`, {
      method: "PUT",
      body: JSON.stringify({ proxyPoolId: bindPoolId }),
    });
    expect(bound.status).toBe(200);
    expect(bound.body.connection.providerSpecificData.proxyPoolId).toBe(bindPoolId);
    const poolsWithUsage = await call("/api/proxy-pools?includeUsage=true");
    expect(poolsWithUsage.status).toBe(200);
    expect(poolsWithUsage.body.proxyPools.find((pool) => pool.id === bindPoolId).boundConnectionCount).toBe(1);
    const unbound = await call(`/api/providers/${encodeURIComponent(connectionId)}`, {
      method: "PUT",
      body: JSON.stringify({ proxyPoolId: null }),
    });
    expect(unbound.status).toBe(200);
    expect(unbound.body.connection.providerSpecificData?.proxyPoolId).toBeUndefined();
    expect((await call(`/api/providers/${encodeURIComponent(connectionId)}`, { method: "DELETE" })).status).toBe(200);
    expect((await call(`/api/proxy-pools/${encodeURIComponent(bindPoolId)}`, { method: "DELETE" })).status).toBe(200);

    // Combo strategies live in settings.comboStrategies; write one entry and
    // restore the original map afterwards.
    const beforeStrategy = await call("/api/settings");
    expect(beforeStrategy.status).toBe(200);
    const strategies = { ...(beforeStrategy.body.comboStrategies || {}), gpuixprobe: { fallbackStrategy: "round-robin" } };
    expect((await call("/api/settings", { method: "PATCH", body: JSON.stringify({ comboStrategies: strategies }) })).status).toBe(200);
    const afterStrategy = await call("/api/settings");
    expect(afterStrategy.body.comboStrategies.gpuixprobe.fallbackStrategy).toBe("round-robin");
    expect(
      (
        await call("/api/settings", {
          method: "PATCH",
          body: JSON.stringify({ comboStrategies: beforeStrategy.body.comboStrategies || {} }),
        })
      ).status
    ).toBe(200);
    expect((await call("/api/settings")).body.comboStrategies.gpuixprobe).toBeUndefined();

    // Outbound proxy settings round-trip; the probe URL is a closed loopback
    // port, so the gateway's own proxy test fails fast without dialing out.
    const proxySave = await call("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ outboundProxyEnabled: false, outboundProxyUrl: "", outboundNoProxy: "" }),
    });
    expect(proxySave.status).toBe(200);
    expect((await call("/api/settings")).body.outboundProxyUrl).toBe("");
    const proxyTest = await call("/api/settings/proxy-test", {
      method: "POST",
      body: JSON.stringify({ proxyUrl: "http://127.0.0.1:9" }),
    });
    expect(proxyTest.body.ok).toBe(false);

    // Headroom status is a read-only probe of the configured local URL; it must
    // answer without spawning anything.
    const headroom = await call("/api/headroom/status");
    expect(headroom.status).toBe(200);
    expect(typeof headroom.body.installed).toBe("boolean");
    expect(typeof headroom.body.running).toBe("boolean");

    // Provider node edit: create a chat node, rename it through PUT, delete it.
    const createdNode = await call("/api/provider-nodes", {
      method: "POST",
      body: JSON.stringify({ name: "gpuix-node", prefix: "gpuixn", baseUrl: "http://127.0.0.1:9/v1", apiType: "chat" }),
    });
    expect(createdNode.status).toBe(201);
    const nodeId = createdNode.body.node.id;
    const updatedNode = await call(`/api/provider-nodes/${encodeURIComponent(nodeId)}`, {
      method: "PUT",
      body: JSON.stringify({ name: "gpuix-node-2", prefix: "gpuixn2", baseUrl: "http://127.0.0.1:9/v1", apiType: "chat" }),
    });
    expect(updatedNode.status).toBe(200);
    expect(updatedNode.body.node.name).toBe("gpuix-node-2");
    expect(updatedNode.body.node.prefix).toBe("gpuixn2");
    expect((await call(`/api/provider-nodes/${encodeURIComponent(nodeId)}`, { method: "DELETE" })).status).toBe(200);

    // Node types the native add form can now send: responses, Anthropic
    // compatible and custom embedding. All land in the isolated DB and delete.
    for (const body of [
      { name: "gpuix-resp", prefix: "gpuixr", baseUrl: "http://127.0.0.1:9/v1", type: "openai-compatible", apiType: "responses" },
      { name: "gpuix-anth", prefix: "gpuixa", baseUrl: "http://127.0.0.1:9/v1", type: "anthropic-compatible" },
      { name: "gpuix-emb", prefix: "gpuixe", baseUrl: "http://127.0.0.1:9/v1", type: "custom-embedding" },
    ]) {
      const created = await call("/api/provider-nodes", { method: "POST", body: JSON.stringify(body) });
      expect(created.status).toBe(201);
      expect(created.body.node.type).toBe(body.type);
      if (body.apiType) expect(created.body.node.apiType).toBe(body.apiType);
      expect((await call(`/api/provider-nodes/${encodeURIComponent(created.body.node.id)}`, { method: "DELETE" })).status).toBe(200);
    }

    // Dashboard password: hashed by the gateway and written to the isolated DB.
    // This runs last because a fresh isolated DB has no prior password to restore;
    // the fixture directory is disposable.
    const passwordChange = await call("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ currentPassword: "123456", newPassword: "gpuix-probe-pass" }),
    });
    expect(passwordChange.status).toBe(200);
    expect((await call("/api/settings")).body.hasPassword).toBe(true);

    await supervisor.stop();

    // 1. Gateway state landed in the isolated data dir and nowhere else.
    const isolatedFiles = fs.readdirSync(isolation.dataDir, { recursive: true }).map(String);
    expect(isolatedFiles.some((f) => f.includes("db"))).toBe(true);
    expect(snapshot(isolation.logDir).some((f) => f.startsWith("gateway.log"))).toBe(true);

    // 2. The installed app's data dir is byte-for-byte untouched, and the
    //    gateway's DB really is the isolated one.
    expect(snapshot(sharedFixture)).toEqual(sharedSnapshotBefore);
    expect(fs.readFileSync(path.join(sharedFixture, "db", "data.sqlite"), "utf8")).toBe("installed-app-sentinel");
    expect(() =>
      assertIsolationHeld({ isolation, sharedDataDir: sharedFixture, sharedBefore: sharedSnapshotBefore })
    ).not.toThrow();
    expect(snapshotDir(isolation.dataDir)).toEqual(expect.arrayContaining([expect.stringMatching(/^db[\\/]/)]));
  }, 240_000);

  it("refuses to start when the experimental port is occupied, leaving the occupant running", async () => {
    const occupant = net.createServer().listen(0, "127.0.0.1");
    await new Promise((r) => occupant.once("listening", r));
    const { port } = occupant.address();
    cleanups.push(() => new Promise((r) => occupant.close(r)));

    const env = { APPDATA: isolatedAppData, LOCALAPPDATA: process.env.LOCALAPPDATA };
    const isolation = resolveIsolation({ env });
    const secrets = loadOrCreateSecrets(isolation.dataDir);
    const supervisor = new GatewaySupervisor({
      runtimeDir,
      port,
      logDir: isolation.logDir,
      secrets,
      env: gatewayEnv({ isolation, port, secrets, runtimeDir, env }),
      healthTimeoutMs: 5000,
    });
    cleanups.push(() => supervisor.stop());

    await expect(supervisor.start()).rejects.toThrow(/already in use/);
    // The occupant still owns the port.
    expect(occupant.listening).toBe(true);
  }, 60_000);

  it("uses port 20129 by default, never the installed app's 20128", () => {
    expect(resolvePort({})).toBe(20129);
    expect(repoRoot).toBeTruthy();
  });
});

describe.skipIf(canRun)("isolated gateway integration (skipped)", () => {
  it("needs GPU_UIX_TEST_APPDATA pointing at an empty isolated APPDATA and a staged runtime", () => {
    expect(canRun).toBe(false);
  });
});
