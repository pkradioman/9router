import crypto from "node:crypto";
import net from "node:net";

export async function acquireSingleInstance(identity, onActivate) {
  if (process.platform !== "win32") return { primary: true, close: async () => {} };
  const hash = crypto.createHash("sha256").update(identity.toLowerCase()).digest("hex").slice(0, 32);
  const pipe = `\\\\.\\pipe\\9router-gpuix-${hash}`;
  const server = net.createServer((socket) => {
    socket.on("error", () => {});
    onActivate();
    socket.end("activated\n");
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(pipe, resolve);
    });
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
      let response = "";
      socket.setTimeout(3000, () => socket.destroy(new Error("Existing instance did not respond.")));
      socket.on("data", (chunk) => {
        response += chunk.toString();
        if (response.length > 32) socket.destroy(new Error("Invalid instance response."));
      });
      socket.once("end", () => response === "activated\n" ? resolve() : reject(new Error("Invalid instance response.")));
      socket.once("error", reject);
    });
    return { primary: false, close: async () => {} };
  }
}
