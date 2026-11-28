// End-to-end proof that the native chat page's streaming path works through the
// real staged gateway runtime.
//
// Boots the isolated runtime on a free port against an isolated APPDATA, points
// two synthetic OpenAI-compatible provider connections at two local mock SSE
// servers, and drives `createGatewayApi().streamChatCompletion` — the exact
// function ChatPage calls — twice: once to completion, once aborted after the
// first delta (the "Stop" control).
//
// Runs only when GPU_UIX_TEST_APPDATA points at a prepared isolated APPDATA and
// the staged runtime exists, so the default test run stays hermetic.
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { gatewayEnv, resolveIsolation } from "../src/config.mjs";
import { GatewaySupervisor, resolveRuntimeDir } from "../src/gateway-supervisor.mjs";
import { loadOrCreateSecrets } from "../src/secrets.mjs";
import { readCliToken } from "../src/cli-token.mjs";
import { createGatewayApi } from "../src/ui/api.mjs";
import { assertIsolationHeld, snapshotDir } from "../src/isolation-proof.mjs";

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
afterAll(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function freePort() {
  const server = net.createServer().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  return port;
}

// Minimal OpenAI-compatible upstream. It records what the gateway actually sent
// (so `stream: true` is proven on the wire, not just in our client) and emits the
// given chunks as SSE deltas, one per tick, so an abort can land mid-stream.
function startMockProvider(port, { chunks, intervalMs, text }) {
  const state = { requests: [], timers: new Set(), responses: new Set(), sent: [] };
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
      state.requests.push({ url: req.url, stream: parsed.stream === true, model: parsed.model ?? null });

      if (parsed.stream !== true) {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: { message: "mock upstream expects stream:true" } }));
        return;
      }

      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      state.responses.add(res);
      res.on("close", () => state.responses.delete(res));

      let index = 0;
      const pump = () => {
        if (res.writableEnded || res.destroyed) return;
        if (index >= chunks.length) {
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }
        const piece = chunks[index];
        const delta = index === 0 ? { role: "assistant", content: piece } : { content: piece };
        index += 1;
        state.sent.push(piece);
        res.write(
          `data: ${JSON.stringify({
            id: "chatcmpl-mock-stream",
            object: "chat.completion.chunk",
            created: 1,
            model: text,
            choices: [{ index: 0, delta }],
          })}\n\n`
        );
        const timer = setTimeout(pump, intervalMs);
        state.timers.add(timer);
      };
      const timer = setTimeout(pump, intervalMs);
      state.timers.add(timer);
    });
  });

  state.close = () =>
    new Promise((resolve) => {
      for (const timer of state.timers) clearTimeout(timer);
      state.timers.clear();
      for (const res of state.responses) res.destroy();
      state.responses.clear();
      server.closeAllConnections?.();
      server.close(() => resolve());
    });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(state));
  });
}

// Records the gateway's own response headers: streamChatCompletion returns only
// deltas, so the SSE content-type has to be observed on the wire here.
function recordingFetch(seen) {
  return async (url, init) => {
    const response = await fetch(url, init);
    seen.push({ url: String(url), contentType: response.headers.get("content-type") });
    return response;
  };
}

describe.runIf(canRun)("chat streaming through the isolated gateway", () => {
  it("streams upstream deltas in order, then stops cleanly when aborted", async () => {
    const upstreamText = ["Hello", " from", " the", " mock"];
    const abortChunks = ["first", " second", " third", " fourth", " fifth", " sixth"];

    // Everything below resolves inside the isolated APPDATA: the gateway data
    // dir, its logs/cache (LOCALAPPDATA is redirected too) and the fixture that
    // stands in for the installed app's shared dir.
    const env = { APPDATA: isolatedAppData, LOCALAPPDATA: isolatedAppData };
    const isolation = resolveIsolation({ env });

    const sharedFixture = path.join(isolatedAppData, "9router");
    fs.mkdirSync(path.join(sharedFixture, "db"), { recursive: true });
    fs.writeFileSync(path.join(sharedFixture, "db", "data.sqlite"), "installed-app-sentinel");
    const sharedBefore = snapshotDir(sharedFixture);
    expect(sharedBefore.length).toBeGreaterThan(0);

    const gatewayPort = await freePort();
    const normalPort = await freePort();
    const slowPort = await freePort();

    const normalMock = await startMockProvider(normalPort, {
      chunks: upstreamText,
      intervalMs: 40,
      text: "mock-fast",
    });
    cleanups.push(() => normalMock.close());
    const slowMock = await startMockProvider(slowPort, {
      chunks: abortChunks,
      intervalMs: 250,
      text: "mock-slow",
    });
    cleanups.push(() => slowMock.close());

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
    const health = await supervisor.start();
    expect(health).toEqual({ ok: true });

    const baseUrl = `http://127.0.0.1:${gatewayPort}`;
    const token = readCliToken(isolation.dataDir);
    const seenResponses = [];
    const api = createGatewayApi({ baseUrl, token, fetchImpl: recordingFetch(seenResponses) });
    const auth = { "x-9r-cli-token": token, "content-type": "application/json" };

    // Synthetic provider nodes -> the local mock upstreams; no real credentials.
    const register = async (prefix, mockPort) => {
      const nodeRes = await fetch(`${baseUrl}/api/provider-nodes`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          name: `Stream Mock ${prefix}`,
          prefix,
          apiType: "chat",
          baseUrl: `http://127.0.0.1:${mockPort}/v1`,
        }),
      });
      expect(nodeRes.status).toBe(201);
      const node = (await nodeRes.json()).node;
      const connRes = await fetch(`${baseUrl}/api/providers`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ provider: node.id, apiKey: "sk-synthetic-mock", name: `Stream Mock ${prefix}` }),
      });
      expect(connRes.status).toBe(201);
      return node;
    };

    const fastNode = await register("streamfast", normalPort);
    await register("streamslow", slowPort);
    const key = await api.createKey("chat-stream-mock");

    // --- 1. normal stream -------------------------------------------------
    const deltas = [];
    await api.streamChatCompletion({
      apiKey: key.key,
      model: `${fastNode.prefix}/mock-model`,
      messages: [{ role: "user", content: "ping" }],
      onDelta: (delta) => deltas.push(delta),
      timeout: 30_000,
    });

    expect(deltas).toEqual(upstreamText);
    expect(deltas.join("")).toBe(upstreamText.join(""));

    const chatResponses = seenResponses.filter((entry) => entry.url.includes("/v1/chat/completions"));
    expect(chatResponses.length).toBeGreaterThanOrEqual(1);
    expect(chatResponses[0].contentType).toContain("text/event-stream");

    expect(normalMock.requests).toHaveLength(1);
    expect(normalMock.requests[0].stream).toBe(true);
    expect(normalMock.requests[0].model).toBe("mock-model");

    // --- 2. abort after the first delta ----------------------------------
    const controller = new AbortController();
    const abortedDeltas = [];
    const streamError = await api
      .streamChatCompletion({
        apiKey: key.key,
        model: "streamslow/mock-model",
        messages: [{ role: "user", content: "stop me" }],
        signal: controller.signal,
        onDelta: (delta) => {
          abortedDeltas.push(delta);
          if (abortedDeltas.length === 1) controller.abort();
        },
        timeout: 30_000,
      })
      .then(
        () => null,
        (error) => error
      );

    expect(streamError).toBeTruthy();
    // ChatPage's Stop control calls controller.abort() with no reason, so the
    // rejection must be the abort (AbortError), not the 30 s timeout ("Error").
    expect(streamError.name).toBe("AbortError");
    expect(abortedDeltas).toEqual([abortChunks[0]]);
    expect(slowMock.requests).toHaveLength(1);
    expect(slowMock.requests[0].stream).toBe(true);

    // Nothing may arrive after the rejection settled, even though the mock keeps
    // writing slow deltas for another second and a half.
    await new Promise((r) => setTimeout(r, 1200));
    expect(abortedDeltas).toHaveLength(1);

    // --- 3. cheap usage evidence -----------------------------------------
    // Optional per the task: the completed stream must leave a usage row behind.
    let stats = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      stats = await api.getUsageStats("all");
      if ((stats.totalRequests || 0) >= 1) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(stats.totalRequests).toBeGreaterThanOrEqual(1);

    await api.deleteKey(key.id);

    // --- 4. cleanup + isolation proof ------------------------------------
    await supervisor.stop();

    expect(fs.existsSync(path.join(isolation.dataDir, "db", "data.sqlite"))).toBe(true);
    expect(() => assertIsolationHeld({ isolation, sharedDataDir: sharedFixture, sharedBefore })).not.toThrow();
  }, 240_000);
});
