import { describe, expect, it } from "vitest";
import { ApiError, createGatewayApi } from "../src/ui/api.mjs";

function fakeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { calls, fetchImpl };
}

function json(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

describe("createGatewayApi", () => {
  it("sends the CLI token and returns the key list", async () => {
    const { calls, fetchImpl } = fakeFetch(() => json({ keys: [{ id: "k1", name: "laptop", key: "sk-1" }] }));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", token: "tok", fetchImpl });

    const keys = await api.listKeys();
    expect(keys).toEqual([{ id: "k1", name: "laptop", key: "sk-1" }]);
    expect(calls[0].url).toBe("http://127.0.0.1:20129/api/keys");
    expect(calls[0].init.headers["x-9r-cli-token"]).toBe("tok");
  });

  it("creates, updates and deletes keys with JSON bodies", async () => {
    const { calls, fetchImpl } = fakeFetch((url, init) => {
      if (init.method === "POST") return json({ key: "sk-new", name: "desk" }, 201);
      return json({ key: { id: "k1", isActive: false } });
    });
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    await api.createKey("desk");
    await api.updateKey("k 1", { isActive: false });
    await api.deleteKey("k 1");

    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe('{"name":"desk"}');
    expect(calls[0].init.headers["content-type"]).toBe("application/json");
    expect(calls[1].url).toBe("http://127.0.0.1:20129/api/keys/k%201");
    expect(calls[1].init.body).toBe('{"isActive":false}');
    expect(calls[2].init.method).toBe("DELETE");
    expect(calls[0].init.headers["x-9r-cli-token"]).toBeUndefined();
  });

  it("surfaces the gateway error message and status", async () => {
    const { fetchImpl } = fakeFetch(() => json({ error: "Unauthorized" }, 401));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    await expect(api.listKeys()).rejects.toMatchObject({ name: "ApiError", message: "Unauthorized", status: 401 });
    await expect(api.listKeys()).rejects.toBeInstanceOf(ApiError);
  });

  it("falls back to a route description for non-JSON failures", async () => {
    const { fetchImpl } = fakeFetch(() => ({ ok: false, status: 502, text: async () => "bad gateway" }));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    await expect(api.listKeys()).rejects.toMatchObject({ message: "GET /api/keys failed (502)", status: 502 });
  });
});
