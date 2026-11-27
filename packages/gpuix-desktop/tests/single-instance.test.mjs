import crypto from "node:crypto";
import net from "node:net";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  ACTIVATION_PROTOCOL_VERSION,
  acquireSingleInstance,
  singleInstancePipe,
} from "../src/single-instance.mjs";

const owners = [];
afterEach(async () => {
  for (const owner of owners.splice(0)) await owner.close();
});

const TOKEN = "a".repeat(64);
const WRONG_TOKEN = "b".repeat(64);
const VERSION = ACTIVATION_PROTOCOL_VERSION;

function proofFor(nonce, token = TOKEN) {
  return crypto.createHmac("sha256", token).update(`gpuix-activate-v2:${nonce}`).digest("hex");
}

// Reads the CHALLENGE, then sends whatever `respond` returns (null closes).
// Resolves with the challenge line and the single reply line.
function challengeSession(pipe, respond, { timeoutMs = 2500 } = {}) {
  return new Promise((resolve) => {
    const socket = net.createConnection(pipe);
    let buffer = "";
    let challenge = null;
    let response = "";
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({ challenge, response });
    };
    const timer = setTimeout(finish, timeoutMs);
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      if (settled) return;
      buffer += chunk;
      let newline;
      while (!settled && (newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (challenge === null) {
          challenge = line;
          const match = /^CHALLENGE 2 ([0-9a-f]{32})$/.exec(line);
          const payload = respond(match ? match[1] : null, line);
          if (payload === null) {
            finish();
            return;
          }
          socket.write(payload);
        } else {
          response = line;
          finish();
          return;
        }
      }
    });
    socket.once("end", finish);
    socket.once("close", finish);
    socket.once("error", finish);
  });
}

// Writes immediately (before reading the challenge) and reports everything the
// server said plus how long the connection stayed open.
function rawExchange(pipe, payload, { timeoutMs = 2000 } = {}) {
  return new Promise((resolve) => {
    const socket = net.createConnection(pipe);
    let data = "";
    const startedAt = Date.now();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({ data, elapsedMs: Date.now() - startedAt });
    };
    const timer = setTimeout(finish, timeoutMs);
    socket.setEncoding("utf8");
    socket.once("connect", () => {
      if (payload !== null) socket.write(payload);
    });
    socket.on("data", (chunk) => {
      data += chunk;
    });
    socket.once("end", finish);
    socket.once("close", finish);
    socket.once("error", finish);
  });
}

// A hostile process that owns the pipe name before the real app launches.
async function squatterFor(identity, firstLine) {
  const received = { text: "" };
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("data", (chunk) => {
      received.text += chunk.toString();
    });
    if (firstLine !== null) socket.write(firstLine);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(singleInstancePipe(identity), resolve);
  });
  const socketsTimer = setTimeout(() => {
    for (const socket of sockets) socket.destroy();
  }, 500);
  socketsTimer.unref?.();
  return {
    received,
    close: async () => {
      clearTimeout(socketsTimer);
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function primaryFor(identity, options = {}) {
  let activations = 0;
  const owner = await acquireSingleInstance(identity, () => { activations++; }, {
    activationToken: TOKEN,
    ...options,
  });
  owners.push(owner);
  return { owner, activations: () => activations };
}

function validPayload(nonce) {
  return `ACTIVATE ${VERSION} ${proofFor(nonce)}\n`;
}

describe.skipIf(process.platform !== "win32")("single instance", () => {
  it("activates the existing instance and releases its pipe on close", async () => {
    const identity = `fixture-${crypto.randomUUID()}`;
    let activations = 0;
    const first = await acquireSingleInstance(identity, () => { activations++; }, { activationToken: TOKEN });
    owners.push(first);
    expect(first.primary).toBe(true);
    const second = await acquireSingleInstance(identity, () => { throw new Error("second became primary"); }, {
      activationToken: TOKEN,
    });
    expect(second.primary).toBe(false);
    expect(activations).toBe(1);
    await first.close();
    const third = await acquireSingleInstance(identity, () => {}, { activationToken: TOKEN });
    owners.push(third);
    expect(third.primary).toBe(true);
  });

  it("keeps different experimental identities independent", async () => {
    const first = await acquireSingleInstance(`fixture-${crypto.randomUUID()}`, () => {}, { activationToken: TOKEN });
    const second = await acquireSingleInstance(`fixture-${crypto.randomUUID()}`, () => {}, { activationToken: TOKEN });
    owners.push(first, second);
    expect(first.primary).toBe(true);
    expect(second.primary).toBe(true);
  });

  it("releases the pipe after the primary process exits unexpectedly", async () => {
    const identity = `fixture-${crypto.randomUUID()}`;
    const moduleUrl = new URL("../src/single-instance.mjs", import.meta.url).href;
    const script = `import { acquireSingleInstance } from ${JSON.stringify(moduleUrl)};
      const owner = await acquireSingleInstance(${JSON.stringify(identity)}, () => {}, { activationToken: ${JSON.stringify(TOKEN)} });
      console.log(owner.primary ? "ready" : "secondary");
      setInterval(() => {}, 1000);`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const output = await new Promise((resolve, reject) => {
        child.stdout.once("data", (data) => resolve(data.toString()));
        child.once("error", reject);
        child.once("exit", () => reject(new Error("Fixture exited before acquiring the pipe")));
      });
      expect(output.trim()).toBe("ready");
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exited;
      const next = await acquireSingleInstance(identity, () => {}, { activationToken: TOKEN });
      owners.push(next);
      expect(next.primary).toBe(true);
    } finally {
      child.kill();
    }
  });

  it("refuses to own the pipe without an activation token", async () => {
    await expect(acquireSingleInstance(`fixture-${crypto.randomUUID()}`, () => {})).rejects.toThrow(
      /activation token/
    );
  });

  it("activates on a correct challenge response and replies with the version", async () => {
    const identity = `fixture-${crypto.randomUUID()}`;
    const { activations } = await primaryFor(identity);
    const session = await challengeSession(singleInstancePipe(identity), (nonce) => validPayload(nonce));
    expect(session.challenge).toMatch(/^CHALLENGE 2 [0-9a-f]{32}$/);
    expect(session.response).toBe(`OK ${VERSION}`);
    expect(activations()).toBe(1);
  });

  it("rejects a request with no proof and takes no window action", async () => {
    const identity = `fixture-${crypto.randomUUID()}`;
    const { activations } = await primaryFor(identity);
    const session = await challengeSession(singleInstancePipe(identity), () => `ACTIVATE ${VERSION}\n`);
    expect(session.response).toBe("DENIED");
    expect(activations()).toBe(0);
  });

  it("rejects a wrong proof and takes no window action", async () => {
    const identity = `fixture-${crypto.randomUUID()}`;
    const { activations } = await primaryFor(identity);
    const session = await challengeSession(
      singleInstancePipe(identity),
      (nonce) => `ACTIVATE ${VERSION} ${proofFor(nonce, WRONG_TOKEN)}\n`
    );
    expect(session.response).toBe("DENIED");
    expect(activations()).toBe(0);
  });

  it("rejects an unsupported request line", async () => {
    const identity = `fixture-${crypto.randomUUID()}`;
    const { activations } = await primaryFor(identity);
    const session = await challengeSession(singleInstancePipe(identity), () => "HELLO\n");
    expect(session.response).toBe("DENIED");
    expect(activations()).toBe(0);
  });

  it("rejects an oversized message without hanging and survives it", async () => {
    const identity = `fixture-${crypto.randomUUID()}`;
    const { activations } = await primaryFor(identity);
    const pipe = singleInstancePipe(identity);
    const oversized = await challengeSession(pipe, () => "A".repeat(1024));
    expect(oversized.response).toBe("DENIED");
    expect(activations()).toBe(0);
    const ok = await challengeSession(pipe, (nonce) => validPayload(nonce));
    expect(ok.response).toBe(`OK ${VERSION}`);
    expect(activations()).toBe(1);
  });

  it("closes a silent connection on the handshake timeout", async () => {
    const identity = `fixture-${crypto.randomUUID()}`;
    const { activations } = await primaryFor(identity, { handshakeTimeoutMs: 120 });
    const pipe = singleInstancePipe(identity);
    const silent = await rawExchange(pipe, null, { timeoutMs: 1500 });
    expect(silent.data).toMatch(/^CHALLENGE 2 [0-9a-f]{32}\n$/);
    expect(activations()).toBe(0);
    const ok = await challengeSession(pipe, (nonce) => validPayload(nonce));
    expect(ok.response).toBe(`OK ${VERSION}`);
    expect(activations()).toBe(1);
  });

  it("survives two rapid invalid attempts and still activates a valid one", async () => {
    const identity = `fixture-${crypto.randomUUID()}`;
    const { activations } = await primaryFor(identity);
    const pipe = singleInstancePipe(identity);
    expect((await challengeSession(pipe, () => "GARBAGE\n")).response).toBe("DENIED");
    expect((await challengeSession(pipe, () => `ACTIVATE 999 ${WRONG_TOKEN}\n`)).response).toBe("DENIED");
    expect(activations()).toBe(0);
    expect((await challengeSession(pipe, (nonce) => validPayload(nonce))).response).toBe(`OK ${VERSION}`);
    expect(activations()).toBe(1);
  });

  it("coalesces rapid valid activations into one window action", async () => {
    const identity = `fixture-${crypto.randomUUID()}`;
    const { activations } = await primaryFor(identity, { minActivationIntervalMs: 60_000 });
    const pipe = singleInstancePipe(identity);
    expect((await challengeSession(pipe, (nonce) => validPayload(nonce))).response).toBe(`OK ${VERSION}`);
    expect((await challengeSession(pipe, (nonce) => validPayload(nonce))).response).toBe(`OK ${VERSION}`);
    expect(activations()).toBe(1);
  });

  it("denies a replayed proof on a fresh challenge", async () => {
    const identity = `fixture-${crypto.randomUUID()}`;
    const { activations } = await primaryFor(identity);
    const pipe = singleInstancePipe(identity);
    let captured = null;
    const first = await challengeSession(pipe, (nonce) => {
      captured = proofFor(nonce);
      return `ACTIVATE ${VERSION} ${captured}\n`;
    });
    expect(first.response).toBe(`OK ${VERSION}`);
    // Same proof, new connection, new nonce.
    const replay = await challengeSession(pipe, () => `ACTIVATE ${VERSION} ${captured}\n`);
    expect(replay.response).toBe("DENIED");
    expect(activations()).toBe(1);
  });

  it("denies an ACTIVATE sent before reading the challenge", async () => {
    const identity = `fixture-${crypto.randomUUID()}`;
    const { activations } = await primaryFor(identity);
    const result = await rawExchange(
      singleInstancePipe(identity),
      `ACTIVATE ${VERSION} ${proofFor("0".repeat(32))}\n`
    );
    expect(result.data).toContain("DENIED");
    expect(activations()).toBe(0);
  });

  it("accepts only the first ACTIVATE on a connection", async () => {
    const identity = `fixture-${crypto.randomUUID()}`;
    const { activations } = await primaryFor(identity);
    const session = await challengeSession(singleInstancePipe(identity), (nonce) => {
      const line = validPayload(nonce);
      return `${line}${line}`;
    });
    expect(session.response).toBe(`OK ${VERSION}`);
    expect(activations()).toBe(1);
  });

  it("survives pending-cap exhaustion and still activates afterwards", async () => {
    const identity = `fixture-${crypto.randomUUID()}`;
    const { activations } = await primaryFor(identity, { maxPending: 4, handshakeTimeoutMs: 200 });
    const pipe = singleInstancePipe(identity);
    const sockets = [];
    for (let index = 0; index < 40; index++) {
      const socket = net.createConnection(pipe);
      socket.on("error", () => {});
      sockets.push(socket);
    }
    await new Promise((r) => setTimeout(r, 450));
    for (const socket of sockets) socket.destroy();
    const ok = await challengeSession(pipe, (nonce) => validPayload(nonce));
    expect(ok.response).toBe(`OK ${VERSION}`);
    expect(activations()).toBe(1);
  });

  it("activates again after minActivationIntervalMs has elapsed", async () => {
    const identity = `fixture-${crypto.randomUUID()}`;
    const { activations } = await primaryFor(identity, { minActivationIntervalMs: 120 });
    const pipe = singleInstancePipe(identity);
    expect((await challengeSession(pipe, (nonce) => validPayload(nonce))).response).toBe(`OK ${VERSION}`);
    await new Promise((r) => setTimeout(r, 250));
    expect((await challengeSession(pipe, (nonce) => validPayload(nonce))).response).toBe(`OK ${VERSION}`);
    expect(activations()).toBe(2);
  });

  it("fails closed with a clear error against a legacy unauthenticated owner", async () => {
    const identity = `fixture-${crypto.randomUUID()}`;
    const squatter = await squatterFor(identity, "activated\n");
    try {
      await expect(
        acquireSingleInstance(identity, () => {}, { activationToken: TOKEN })
      ).rejects.toThrow(/legacy activation protocol/);
      // No token material was sent to the squatter.
      expect(squatter.received.text).toBe("");
    } finally {
      await squatter.close();
    }
  });

  it("sends nothing to a squatter that answers with garbage", async () => {
    const identity = `fixture-${crypto.randomUUID()}`;
    const squatter = await squatterFor(identity, "garbage\n");
    try {
      await expect(
        acquireSingleInstance(identity, () => {}, { activationToken: TOKEN })
      ).rejects.toThrow(/valid challenge/);
      expect(squatter.received.text).toBe("");
    } finally {
      await squatter.close();
    }
  });

  it("suppresses rejection log flooding after five lines per reason", async () => {
    const identity = `fixture-${crypto.randomUUID()}`;
    const logs = [];
    const { activations } = await primaryFor(identity, { log: (line) => logs.push(line) });
    const pipe = singleInstancePipe(identity);
    for (let index = 0; index < 8; index++) {
      expect((await challengeSession(pipe, () => "HELLO\n")).response).toBe("DENIED");
    }
    expect(activations()).toBe(0);
    const rejectionLines = logs.filter(
      (line) => line.includes("rejected activation request") || line.includes("suppressed")
    );
    expect(rejectionLines).toHaveLength(6);
    expect(rejectionLines.filter((line) => line.includes("suppressed"))).toHaveLength(1);
  });

  it("destroys a connection beyond maxPending with no challenge and zero bytes", async () => {
    const identity = `fixture-${crypto.randomUUID()}`;
    const { activations } = await primaryFor(identity, { maxPending: 1, handshakeTimeoutMs: 4000 });
    const pipe = singleInstancePipe(identity);

    const occupied = net.createConnection(pipe);
    occupied.on("error", () => {});
    let occupiedData = "";
    occupied.setEncoding("utf8");
    occupied.on("data", (chunk) => { occupiedData += chunk; });
    await new Promise((resolve) => occupied.once("connect", resolve));
    await new Promise((r) => setTimeout(r, 100));
    expect(occupiedData).toMatch(/^CHALLENGE 2 /);

    // Pending cap is 1 and already taken: this connection must be dropped
    // before the owner writes a challenge, so it receives exactly nothing.
    const overflow = await rawExchange(pipe, null, { timeoutMs: 1000 });
    expect(overflow.data).toBe("");
    expect(overflow.elapsedMs).toBeLessThan(900);

    occupied.destroy();
    // The owner releases the pending slot on its own 'close' event.
    await new Promise((r) => setTimeout(r, 100));
    const ok = await challengeSession(pipe, (nonce) => validPayload(nonce));
    expect(ok.response).toBe(`OK ${VERSION}`);
    expect(activations()).toBe(1);
  }, 15_000);

  it("fails closed on a slow-drip owner within the absolute deadline", async () => {
    const identity = `fixture-${crypto.randomUUID()}`;
    const nonce = "d".repeat(32);
    const sockets = new Set();
    const owner = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.write(`CHALLENGE ${VERSION} ${nonce}\n`);
      // Dribble bytes that never form a line, keeping an idle timeout alive.
      const drip = setInterval(() => {
        if (!socket.destroyed) socket.write("x");
      }, 100);
      drip.unref?.();
      socket.on("close", () => clearInterval(drip));
    });
    await new Promise((resolve, reject) => {
      owner.once("error", reject);
      owner.listen(singleInstancePipe(identity), resolve);
    });
    try {
      const startedAt = Date.now();
      await expect(
        acquireSingleInstance(identity, () => {}, { activationToken: TOKEN, clientHandshakeTimeoutMs: 400 })
      ).rejects.toThrow(/handshake in time/);
      expect(Date.now() - startedAt).toBeLessThan(3000);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => owner.close(resolve));
    }
  }, 15_000);
});
