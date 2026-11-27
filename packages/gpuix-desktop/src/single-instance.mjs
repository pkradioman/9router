// Single-instance guard for the experimental shell.
//
// First launch owns a per-user named pipe; later launches ask the owner to
// activate its window. Any local process can open that pipe, so the owner never
// accepts a static secret: it sends "CHALLENGE 2 <nonce-hex>\n" and only accepts
// "ACTIVATE 2 <hmac-hex>\n" where hmac = HMAC-SHA256(activationToken,
// "gpuix-activate-v2:" + nonce). The token is never transmitted, and a captured
// answer cannot be replayed against a fresh nonce.
//
// Boundary: a same-user process can read the secrets store, and a squatter that
// owns the pipe name first still costs availability (our launch fails closed).
// This protocol stops blind, accidental and wrong-window activation plus
// squatter token harvesting; it is not a defence against same-user malware.
//
// Bounds per connection: one challenge, one answer, 256-byte cap, 1 s read
// timeout, one reply, 32 pending sockets, and coalescing of rapid activations.
// The secondary client also has an absolute handshake deadline so a slow-drip
// owner cannot stall a launch indefinitely.
import crypto from "node:crypto";
import net from "node:net";
import { redactSecrets } from "./secrets.mjs";

export const ACTIVATION_PROTOCOL_VERSION = 2;
const ACTIVATION_CONTEXT = "gpuix-activate-v2:";
const NONCE_PATTERN = /^[0-9a-f]{32}$/;
const PROOF_PATTERN = /^[0-9a-f]{64}$/;
const DEFAULT_MAX_REQUEST_BYTES = 256;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 1000;
const DEFAULT_CLIENT_HANDSHAKE_TIMEOUT_MS = 10_000;
const DEFAULT_MIN_ACTIVATION_INTERVAL_MS = 1000;
const DEFAULT_MAX_PENDING = 32;
const REJECT_LOG_WINDOW_MS = 60_000;
const REJECT_LOG_PER_WINDOW = 5;

export function singleInstancePipe(identity) {
  const hash = crypto.createHash("sha256").update(identity.toLowerCase()).digest("hex").slice(0, 32);
  return `\\\\.\\pipe\\9router-gpuix-${hash}`;
}

function activationProof(token, nonce) {
  return crypto.createHmac("sha256", token).update(`${ACTIVATION_CONTEXT}${nonce}`).digest("hex");
}

function constantTimeHexMatch(expected, received) {
  if (typeof received !== "string" || !PROOF_PATTERN.test(received)) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseChallenge(line) {
  const parts = String(line).trim().split(" ");
  if (parts.length !== 3 || parts[0] !== "CHALLENGE") return null;
  if (parts[1] !== String(ACTIVATION_PROTOCOL_VERSION)) return null;
  if (!NONCE_PATTERN.test(parts[2])) return null;
  return parts[2];
}

function parseActivation(line) {
  const parts = String(line).trim().split(" ");
  if (parts.length !== 3 || parts[0] !== "ACTIVATE") return { ok: false, reason: "unsupported request" };
  if (parts[1] !== String(ACTIVATION_PROTOCOL_VERSION)) {
    return { ok: false, reason: "protocol version mismatch" };
  }
  if (!PROOF_PATTERN.test(parts[2])) return { ok: false, reason: "malformed proof" };
  return { ok: true, proof: parts[2] };
}

export async function acquireSingleInstance(identity, onActivate, options = {}) {
  if (process.platform !== "win32") return { primary: true, close: async () => {} };
  const {
    activationToken,
    secrets = null,
    log = () => {},
    maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES,
    handshakeTimeoutMs = DEFAULT_HANDSHAKE_TIMEOUT_MS,
    clientHandshakeTimeoutMs = DEFAULT_CLIENT_HANDSHAKE_TIMEOUT_MS,
    minActivationIntervalMs = DEFAULT_MIN_ACTIVATION_INTERVAL_MS,
    maxPending = DEFAULT_MAX_PENDING,
  } = options;
  if (typeof activationToken !== "string" || activationToken.length < 32) {
    throw new Error("Single-instance activation requires a per-user activation token.");
  }
  const warn = (message) => {
    try {
      log(redactSecrets(`[single-instance] ${message}`, secrets || {}));
    } catch {
      // Logging must never take down the pipe.
    }
  };
  // Bounded rejection logging: five lines per reason per minute, then one
  // summary. Client input and nonces are never logged.
  const rejectionBuckets = new Map();
  const rejectLog = (reason) => {
    const now = Date.now();
    let bucket = rejectionBuckets.get(reason);
    if (!bucket || now - bucket.start >= REJECT_LOG_WINDOW_MS) {
      bucket = { start: now, logged: 0, suppressed: 0 };
      rejectionBuckets.set(reason, bucket);
    }
    if (bucket.logged < REJECT_LOG_PER_WINDOW) {
      bucket.logged += 1;
      warn(`rejected activation request (${reason})`);
      return;
    }
    bucket.suppressed += 1;
    if (bucket.suppressed === 1) warn(`further activation rejections suppressed (${reason})`);
  };

  const pipe = singleInstancePipe(identity);
  let pending = 0;
  let lastActivationAt = 0;

  const server = net.createServer((socket) => {
    if (pending >= maxPending) {
      socket.destroy();
      return;
    }
    pending += 1;
    let finished = false;
    let answered = false;
    let timer = null;
    let buffer = "";
    // Single exit point: one reply per connection, one pending decrement.
    const finish = (response) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      pending -= 1;
      if (response === null) socket.destroy();
      else socket.end(response);
    };
    timer = setTimeout(() => finish(null), handshakeTimeoutMs);
    timer.unref?.();
    socket.setEncoding("utf8");
    socket.on("error", () => finish(null));
    socket.on("close", () => finish(null));

    const nonce = crypto.randomBytes(16).toString("hex");
    socket.write(`CHALLENGE ${ACTIVATION_PROTOCOL_VERSION} ${nonce}\n`);

    socket.on("data", (chunk) => {
      if (finished) return;
      buffer += chunk;
      if (buffer.length > maxRequestBytes) {
        rejectLog("oversized");
        finish("DENIED\n");
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (answered) {
        rejectLog("duplicate request");
        finish("DENIED\n");
        return;
      }
      answered = true;

      const request = parseActivation(line);
      if (!request.ok) {
        rejectLog(request.reason);
        finish("DENIED\n");
        return;
      }
      if (!constantTimeHexMatch(activationProof(activationToken, nonce), request.proof)) {
        rejectLog("bad proof");
        finish("DENIED\n");
        return;
      }
      const now = Date.now();
      if (now - lastActivationAt >= minActivationIntervalMs) {
        lastActivationAt = now;
        try {
          onActivate();
        } catch {
          // A failed window activation must not break the pipe.
        }
      }
      finish(`OK ${ACTIVATION_PROTOCOL_VERSION}\n`);
    });
  });

  try {
    await new Promise((resolve, reject) => {
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      const onError = (error) => {
        server.off("listening", onListening);
        reject(error);
      };
      server.once("listening", onListening);
      server.once("error", onError);
      server.listen(pipe);
    });
    // Post-bind errors must be handled for the life of the pipe; a one-shot
    // listener would leave the process with an uncaught 'error' event.
    server.on("error", (error) => warn(`pipe server error (${error && error.code ? error.code : "unknown"})`));
    server.unref();
    return {
      primary: true,
      close: () => new Promise((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close((error) => error ? reject(error) : resolve());
      }),
    };
  } catch (error) {
    if (error.code !== "EADDRINUSE") throw error;
    await new Promise((resolve, reject) => {
      const socket = net.createConnection(pipe);
      let buffer = "";
      let phase = "challenge";
      let settled = false;
      let absolute = null;
      const done = (error) => {
        if (settled) return;
        settled = true;
        if (absolute) clearTimeout(absolute);
        // Release the connection even on a mismatch so teardown cannot hang.
        socket.destroy();
        if (error) reject(error);
        else resolve();
      };
      // Absolute deadline for the whole exchange. The idle timeout below is
      // reset by every chunk, so without this a slow-drip owner could keep a
      // second launch hanging indefinitely with no window and no error.
      absolute = setTimeout(() => done(new Error(
        "Existing instance did not complete the activation handshake in time."
      )), clientHandshakeTimeoutMs);
      absolute.unref?.();
      const handleLine = (line) => {
        if (phase === "challenge") {
          const nonce = parseChallenge(line);
          if (!nonce) {
            if (line === "activated") {
              return done(new Error("Existing instance uses the legacy activation protocol; close it and relaunch."));
            }
            return done(new Error(
              "Existing instance did not present a valid challenge; refusing to send an activation proof."
            ));
          }
          // Nothing derived from the token is sent before a well-formed
          // CHALLENGE: a squatter owns the pipe name long enough to answer.
          phase = "response";
          socket.write(`ACTIVATE ${ACTIVATION_PROTOCOL_VERSION} ${activationProof(activationToken, nonce)}\n`);
          return;
        }
        if (phase === "response") {
          if (line === `OK ${ACTIVATION_PROTOCOL_VERSION}`) return done();
          if (line === "activated") {
            return done(new Error("Existing instance uses the legacy activation protocol; close it and relaunch."));
          }
          return done(new Error("Existing instance rejected the activation challenge response."));
        }
      };
      socket.setEncoding("utf8");
      socket.setTimeout(3000, () => socket.destroy(new Error("Existing instance did not respond.")));
      socket.on("data", (chunk) => {
        if (settled) return;
        buffer += chunk;
        if (buffer.length > 256) return done(new Error("Invalid instance response."));
        let newline;
        while (!settled && (newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          handleLine(line);
        }
      });
      socket.once("end", () => {
        if (!settled) done(new Error("Existing instance closed before completing the activation handshake."));
      });
      socket.once("close", () => {
        if (!settled) done(new Error("Existing instance closed before completing the activation handshake."));
      });
      socket.once("error", done);
    });
    return { primary: false, close: async () => {} };
  }
}
