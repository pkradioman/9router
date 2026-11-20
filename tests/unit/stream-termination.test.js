import { describe, it, expect, vi } from "vitest";

import {
  createStreamController,
  isUpstreamNetworkClose,
  pipeWithDisconnect,
} from "../../open-sse/utils/streamHandler.js";
import { estimateInterruptedUsage } from "../../open-sse/utils/usageTracking.js";

// The error undici raises when the peer closes the socket mid-stream.
function terminatedError(causeCode = "UND_ERR_SOCKET", causeMessage = "other side closed") {
  const err = new TypeError("terminated");
  err.cause = { code: causeCode, message: causeMessage };
  return err;
}

function bodyThatFails(error) {
  let sent = false;
  return new ReadableStream({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(new TextEncoder().encode("data: {}\n\n"));
        return;
      }
      controller.error(error);
    },
  });
}

function bodyThatStreams() {
  return new ReadableStream({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode("data: {}\n\n"));
    },
  });
}

function controllerWithSpies(overrides = {}) {
  const log = { line: vi.fn(), errorLine: vi.fn() };
  const controller = createStreamController({
    log,
    provider: "p",
    model: "m",
    reqTag: "T",
    onError: vi.fn(),
    onUpstreamClose: vi.fn(),
    onDisconnect: vi.fn(),
    ...overrides,
  });
  return { controller, log };
}

async function drain(stream) {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done } = await reader.read();
      if (done) return;
    }
  } catch {
    // consumers may see the error; the log assertions are what matter
  }
}

describe("transport termination classification", () => {
  it("treats a peer socket close as a disconnect, not a provider error", () => {
    expect(isUpstreamNetworkClose(terminatedError())).toBe(true);
    expect(isUpstreamNetworkClose(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }))).toBe(true);
    expect(isUpstreamNetworkClose(terminatedError("EPIPE", "broken pipe"))).toBe(true);
  });

  it("does not classify our own abort or a real provider error as a disconnect", () => {
    const abort = new Error("This operation was aborted");
    abort.name = "AbortError";
    expect(isUpstreamNetworkClose(abort)).toBe(false);
    expect(isUpstreamNetworkClose(new Error("upstream returned 500"))).toBe(false);
    expect(isUpstreamNetworkClose(null)).toBe(false);
  });

  it("logs a cut upstream socket as a disconnect and terminates the stream once", async () => {
    const { controller, log } = controllerWithSpies();
    const transform = new TransformStream();
    const terminated = [];
    transform.abortStream = (reason) => terminated.push(reason);

    const response = { body: bodyThatFails(terminatedError()) };
    await drain(pipeWithDisconnect(response, transform, controller, null, 60000));

    expect(log.errorLine).not.toHaveBeenCalled();
    expect(log.line).toHaveBeenCalledTimes(1);
    expect(log.line.mock.calls[0][2]).toContain("upstream closed (other side closed)");
    expect(controller.isConnected()).toBe(false);
    expect(terminated).toEqual(["other side closed"]);
  });

  it("still logs a real stream error as an error", async () => {
    const { controller, log } = controllerWithSpies();
    const transform = new TransformStream();
    transform.abortStream = () => {};
    const response = { body: bodyThatFails(new Error("upstream returned 500")) };

    await drain(pipeWithDisconnect(response, transform, controller, null, 60000));

    expect(log.errorLine).toHaveBeenCalledTimes(1);
    expect(log.errorLine.mock.calls[0][2]).toContain("ERROR: upstream returned 500");
  });

  it("does not log an error when the client cancels", async () => {
    const { controller, log } = controllerWithSpies();
    const transform = new TransformStream();
    const terminated = [];
    transform.abortStream = (reason) => terminated.push(reason);

    const reader = pipeWithDisconnect({ body: bodyThatStreams() }, transform, controller, null, 60000).getReader();
    await reader.read();
    await reader.cancel("client closed");

    expect(log.errorLine).not.toHaveBeenCalled();
    expect(terminated).toEqual(["client closed"]);
  });
});

describe("estimateInterruptedUsage", () => {
  it("charges the prompt and only the output that reached the client, without the client-facing buffer", () => {
    const body = { messages: [{ role: "user", content: "x".repeat(400) }] };
    const usage = estimateInterruptedUsage(body, 40);

    expect(usage.estimated).toBe(true);
    expect(usage.prompt_tokens).toBe(Math.ceil(JSON.stringify(body).length / 4));
    expect(usage.completion_tokens).toBe(10);
    expect(usage.total_tokens).toBe(usage.prompt_tokens + usage.completion_tokens);
  });

  it("still reports prompt usage when nothing was generated", () => {
    const usage = estimateInterruptedUsage({ messages: [{ role: "user", content: "hi" }] }, 0);
    expect(usage.prompt_tokens).toBeGreaterThan(0);
    expect(usage.completion_tokens).toBe(0);
  });
});
