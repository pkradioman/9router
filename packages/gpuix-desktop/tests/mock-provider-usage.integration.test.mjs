// End-to-end usage proof against the real staged gateway.
//
// Boots the isolated runtime, registers a synthetic OpenAI-compatible provider
// node that points at a local mock server (never a real provider), sends one
// non-streaming and one streaming chat request, and asserts that
// /api/usage/stats records both with the mock's token counts.
//
// Runs only when GPU_UIX_TEST_APPDATA points at a prepared isolated APPDATA and
// the staged runtime exists, so the default test run stays hermetic.
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gatewayEnv, resolveIsolation } from "../src/config.mjs";
import { GatewaySupervisor, resolveRuntimeDir } from "../src/gateway-supervisor.mjs";
import { loadOrCreateSecrets } from "../src/secrets.mjs";
import { readCliToken } from "../src/cli-token.mjs";
import { createGatewayApi } from "../src/ui/api.mjs";

const packageRoot = path.resolve(import.meta.dirname, "..");

let runtimeDir = null;
try {
  runtimeDir = resolveRuntimeDir({ env: {}, packageRoot });
} catch {
  runtimeDir = null;
}

const isolatedAppData = process.env.GPU_UIX_TEST_APPDATA;
const canRun = Boolean(runtimeDir) && Boolean(isolatedAppData) && fs.existsSync(isolatedAppData);

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

function startMockProvider(port) {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let parsed = {};
      try {
        parsed = JSON.parse(body || "{}");
      } catch {
        parsed = {};
      }
      if (parsed.stream === true) {
        res.setHeader("content-type", "text/event-stream");
        res.write(
          `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "mock" } }] })}\n\n`
        );
        res.write(
          `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } })}\n\n`
        );
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "c1",
          object: "chat.completion",
          created: 1,
          model: "mock-model",
          choices: [{ index: 0, message: { role: "assistant", content: "mock reply" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
        })
      );
    });
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

describe.runIf(canRun)("mock provider usage through the isolated gateway", () => {
  it("records token usage for non-streaming and streaming chat, and keeps it isolated", async () => {
    const env = { APPDATA: isolatedAppData, LOCALAPPDATA: process.env.LOCALAPPDATA };
    const isolation = resolveIsolation({ env });
    const gatewayPort = await freePort();
    const mockPort = await freePort();

    const mock = await startMockProvider(mockPort);
    cleanups.push(() => new Promise((r) => mock.close(r)));

    const secrets = loadOrCreateSecrets(isolation.dataDir);
    const supervisor = new GatewaySupervisor({
      runtimeDir,
      port: gatewayPort,
      logDir: isolation.logDir,
      secrets,
      env: gatewayEnv({ isolation, port: gatewayPort, secrets, runtimeDir, env }),
      healthTimeoutMs: 90_000,
    });
    cleanups.push(() => supervisor.stop());
    await supervisor.start();

    const baseUrl = `http://127.0.0.1:${gatewayPort}`;
    const token = readCliToken(isolation.dataDir);
    const api = createGatewayApi({ baseUrl, token });
    const auth = { "x-9r-cli-token": token, "content-type": "application/json" };

    const nodeRes = await fetch(`${baseUrl}/api/provider-nodes`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Usage Mock",
        prefix: "usagemock",
        apiType: "chat",
        baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      }),
    });
    expect(nodeRes.status).toBe(201);
    const node = (await nodeRes.json()).node;

    const connRes = await fetch(`${baseUrl}/api/providers`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ provider: node.id, apiKey: "sk-synthetic-mock", name: "Usage Mock Account" }),
    });
    expect(connRes.status).toBe(201);

    const key = await api.createKey("usage-mock");

    const nonStream = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key.key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "usagemock/mock-model",
        stream: false,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    expect(nonStream.status).toBe(200);
    // The gateway may rewrite the client-facing usage with its own accounting;
    // the recorded row (provider usage) is what the assertions below check.
    expect((await nonStream.json()).usage).toBeTruthy();

    const stream = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key.key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "usagemock/mock-model",
        stream: true,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    await stream.text();

    let stats = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      stats = await api.getUsageStats("all");
      if ((stats.totalRequests || 0) >= 2) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(stats.totalRequests).toBe(2);
    expect(stats.totalPromptTokens).toBe(19);
    expect(stats.totalCompletionTokens).toBe(8);
    expect(Object.keys(stats.byProvider || {})).toEqual([node.id]);

    await api.deleteKey(key.id);
    await supervisor.stop();

    // The rows must live in the isolated DB, not the shared app's data dir.
    expect(fs.existsSync(path.join(isolation.dataDir, "db", "data.sqlite"))).toBe(true);
  }, 240_000);
});
