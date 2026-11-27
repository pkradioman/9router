import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cleanup: vi.fn(),
  settings: vi.fn(),
  getKeys: vi.fn(),
  setCallback: vi.fn(),
  killCloudflared: vi.fn(),
  removeDns: vi.fn(),
  startMitm: vi.fn(),
  startRefresh: vi.fn(),
  startPing: vi.fn(),
  ensureCloudflared: vi.fn(),
  checkInternet: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  cleanupProviderConnections: mocks.cleanup,
  getSettings: mocks.settings,
  updateSettings: vi.fn(),
  getApiKeys: mocks.getKeys,
}));
vi.mock("@/lib/tunnel", () => ({
  enableTunnel: vi.fn(), enableTailscale: vi.fn(),
  isTunnelManuallyDisabled: vi.fn(), isTunnelReconnecting: vi.fn(),
  isTailscaleReconnecting: vi.fn(),
  getTunnelService: () => ({ cancelToken: { cancelled: false } }),
  getTailscaleService: () => ({ cancelToken: { cancelled: false } }),
  setTunnelUnexpectedExitCallback: mocks.setCallback,
  killCloudflared: mocks.killCloudflared, isCloudflaredRunning: vi.fn(),
  ensureCloudflared: mocks.ensureCloudflared, isTailscaleRunning: vi.fn(),
  isTailscaleRunningStrict: vi.fn().mockResolvedValue(false), isDaemonAlive: vi.fn(),
  startFunnel: vi.fn(), checkInternet: mocks.checkInternet,
  RESTART_COOLDOWN_MS: 60000, NETWORK_SETTLE_MS: 1000,
  WATCHDOG_INTERVAL_MS: 60000, NETWORK_CHECK_INTERVAL_MS: 60000, VIRTUAL_IFACE_REGEX: /never-match/,
}));
vi.mock("@/mitm/manager", () => ({
  getMitmStatus: async () => ({ running: false }),
  startMitm: mocks.startMitm,
  loadEncryptedPassword: async () => "fixture-password",
  initDbHooks: vi.fn(), restoreToolDNS: async () => {},
  removeAllDNSEntriesSync: mocks.removeDns,
}));
vi.mock("@/lib/mitmAliasCache", () => ({ syncToJson: () => Promise.resolve() }));
vi.mock("@/lib/mcp/stdioSseBridge", () => ({ killAllBridges: vi.fn() }));
vi.mock("@/shared/services/quotaAutoPing", () => ({ startQuotaAutoPing: mocks.startPing }));
vi.mock("@/sse/services/backgroundTokenRefresh.js", () => ({ startBackgroundTokenRefresh: mocks.startRefresh }));

describe("experimental initialization safety", () => {
  let listeners;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    delete global.__appSingleton;
    listeners = {};
    vi.spyOn(process, "on").mockImplementation((event, fn) => {
      (listeners[event] ||= []).push(fn);
      return process;
    });
    vi.spyOn(process, "exit").mockImplementation(() => {});
    mocks.cleanup.mockResolvedValue();
    mocks.settings.mockResolvedValue({
      mitmEnabled: true,
      tunnelEnabled: true,
      claudeAutoPing: { connections: { fixture: true } },
    });
    mocks.getKeys.mockResolvedValue([]);
    mocks.startMitm.mockResolvedValue();
    mocks.ensureCloudflared.mockResolvedValue();
    mocks.checkInternet.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    delete global.__appSingleton;
  });

  it("skips startup and shutdown integrations in experimental mode", async () => {
    vi.stubEnv("NINEROUTER_GPU_UIX", "1");
    const { initializeApp } = await import("../../src/shared/services/initializeApp.js");
    await initializeApp();
    await vi.advanceTimersByTimeAsync(4000);
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(mocks.setCallback).not.toHaveBeenCalled();
    expect(mocks.startMitm).not.toHaveBeenCalled();
    expect(mocks.startPing).not.toHaveBeenCalled();
    expect(mocks.startRefresh).not.toHaveBeenCalled();
    expect(mocks.ensureCloudflared).not.toHaveBeenCalled();
    expect(mocks.checkInternet).not.toHaveBeenCalled();
    expect(listeners.SIGTERM).toBeUndefined();
    expect(listeners.exit).toBeUndefined();
    expect(mocks.removeDns).not.toHaveBeenCalled();
    expect(mocks.killCloudflared).not.toHaveBeenCalled();
  });

  it.each(["", "0"])("preserves normal startup and shutdown hooks with experimental flag %j", async (flag) => {
    vi.stubEnv("NINEROUTER_GPU_UIX", flag);
    const { initializeApp } = await import("../../src/shared/services/initializeApp.js");
    await initializeApp();
    await vi.advanceTimersByTimeAsync(4000);
    expect(mocks.cleanup).toHaveBeenCalledOnce();
    expect(mocks.setCallback).toHaveBeenCalledOnce();
    expect(mocks.startMitm).toHaveBeenCalledOnce();
    expect(mocks.startPing).toHaveBeenCalledOnce();
    expect(mocks.startRefresh).toHaveBeenCalledOnce();
    expect(mocks.ensureCloudflared).toHaveBeenCalledOnce();
    expect(mocks.checkInternet).toHaveBeenCalledOnce();
    expect(listeners.SIGTERM).toHaveLength(1);
    listeners.SIGTERM[0]();
    expect(mocks.removeDns).toHaveBeenCalledOnce();
    expect(mocks.killCloudflared).toHaveBeenCalledOnce();
  });
});
