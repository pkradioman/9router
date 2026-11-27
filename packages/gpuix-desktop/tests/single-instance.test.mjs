import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { acquireSingleInstance } from "../src/single-instance.mjs";

const owners = [];
afterEach(async () => {
  for (const owner of owners.splice(0)) await owner.close();
});

describe.skipIf(process.platform !== "win32")("single instance", () => {
  it("activates the existing instance and releases its pipe on close", async () => {
    const identity = `fixture-${crypto.randomUUID()}`;
    let activations = 0;
    const first = await acquireSingleInstance(identity, () => { activations++; });
    owners.push(first);
    expect(first.primary).toBe(true);
    const second = await acquireSingleInstance(identity, () => { throw new Error("second became primary"); });
    expect(second.primary).toBe(false);
    expect(activations).toBe(1);
    await first.close();
    const third = await acquireSingleInstance(identity, () => {});
    owners.push(third);
    expect(third.primary).toBe(true);
  });

  it("keeps different experimental identities independent", async () => {
    const first = await acquireSingleInstance(`fixture-${crypto.randomUUID()}`, () => {});
    const second = await acquireSingleInstance(`fixture-${crypto.randomUUID()}`, () => {});
    owners.push(first, second);
    expect(first.primary).toBe(true);
    expect(second.primary).toBe(true);
  });

  it("releases the pipe after the primary process exits unexpectedly", async () => {
    const identity = `fixture-${crypto.randomUUID()}`;
    const moduleUrl = new URL("../src/single-instance.mjs", import.meta.url).href;
    const script = `import { acquireSingleInstance } from ${JSON.stringify(moduleUrl)};
      const owner = await acquireSingleInstance(${JSON.stringify(identity)}, () => {});
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
      const next = await acquireSingleInstance(identity, () => {});
      owners.push(next);
      expect(next.primary).toBe(true);
    } finally {
      child.kill();
    }
  });
});
