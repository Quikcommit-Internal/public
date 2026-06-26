import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DEFAULT_API_URL } from "@quikcommit/shared";

const mockSaveApiKey = vi.fn();
const mockExecFileSync = vi.fn();
const mockPlatform = vi.fn(() => "darwin");

vi.mock("child_process", () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

vi.mock("os", () => ({
  platform: () => mockPlatform(),
}));

vi.mock("../../src/config.js", () => ({
  saveApiKey: (...args: unknown[]) => mockSaveApiKey(...args),
}));

vi.mock("@quikcommit/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@quikcommit/shared")>();
  return { ...mod, DEVICE_FLOW_TIMEOUT: 3_000 };
});

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { runLogin } from "../../src/commands/login.js";

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}) {
  const { ok = true, status = 200, statusText = "OK" } = init;
  return {
    ok,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(body),
  };
}

const deviceCodePayload = {
  device_code: "device-abc",
  user_code: "WXYZ-5678",
  verification_uri_complete: "https://app.quikcommit.dev/device?user_code=WXYZ-5678",
  interval: 1,
  expires_in: 300,
};

describe("runLogin", () => {
  const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const stderrWriteSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code ?? 0})`);
  }) as typeof process.exit);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockPlatform.mockReturnValue("darwin");
    mockExecFileSync.mockImplementation(() => undefined);
    delete process.env.QC_API_URL;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("requests device code and opens browser on darwin", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(deviceCodePayload))
      .mockResolvedValueOnce(jsonResponse({ access_token: "qc-token-123" }));

    const promise = runLogin();
    await vi.advanceTimersByTimeAsync(1_000);
    await promise;

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${DEFAULT_API_URL}/api/auth/device/code`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ client_id: "qc-cli" }),
      })
    );
    expect(mockExecFileSync).toHaveBeenCalledWith("open", [deviceCodePayload.verification_uri_complete], {
      stdio: "pipe",
    });
    expect(mockSaveApiKey).toHaveBeenCalledWith("qc-token-123");
    expect(consoleLogSpy).toHaveBeenCalledWith("Successfully logged in!");
  });

  it("throws when device code request fails", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "server unavailable" }, { ok: false, status: 503, statusText: "Service Unavailable" })
    );

    await expect(runLogin()).rejects.toThrow("server unavailable");
    expect(mockSaveApiKey).not.toHaveBeenCalled();
  });

  it("throws when server omits device codes", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ user_code: "ONLY-CODE", interval: 1, expires_in: 300 })
    );

    await expect(runLogin()).rejects.toThrow("Server did not return device codes");
  });

  it("continues polling on authorization_pending then saves API key", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(deviceCodePayload))
      .mockResolvedValueOnce(jsonResponse({ error: "authorization_pending" }))
      .mockResolvedValueOnce(jsonResponse({ error: "authorization_pending" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "pending-token" }));

    const promise = runLogin();
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(mockSaveApiKey).toHaveBeenCalledWith("pending-token");
  });

  it("increases poll interval after slow_down then completes auth", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(deviceCodePayload))
      .mockResolvedValueOnce(jsonResponse({ error: "slow_down" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "slow-token" }));

    const promise = runLogin();
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(6_000);
    await promise;

    expect(mockSaveApiKey).toHaveBeenCalledWith("slow-token");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.skip("exits when device code expires", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(deviceCodePayload))
      .mockResolvedValueOnce(jsonResponse({ error: "expired_token" }));

    const promise = runLogin();
    // Advance past the polling interval (1s) + spinner intervals (80ms)
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(promise).rejects.toThrow("process.exit(1)");
    expect(mockSaveApiKey).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("times out when authorization never completes", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith("/api/auth/device/code")) {
        return Promise.resolve(jsonResponse(deviceCodePayload));
      }
      return Promise.resolve(jsonResponse({ error: "authorization_pending" }));
    });

    const promise = runLogin();
    // Advance past DEVICE_FLOW_TIMEOUT (600_000ms) in large steps
    for (let t = 0; t < 610_000; t += 10_000) {
      await vi.advanceTimersByTimeAsync(10_000);
    }

    await expect(promise).rejects.toThrow("process.exit(1)");
    expect(mockSaveApiKey).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  }, 15_000);

  it("prints manual URL when browser cannot be opened", async () => {
    mockPlatform.mockReturnValue("freebsd");
    fetchMock
      .mockResolvedValueOnce(jsonResponse(deviceCodePayload))
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-no-browser" }));

    const promise = runLogin();
    await vi.advanceTimersByTimeAsync(1_000);
    await promise;

    expect(mockExecFileSync).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith("Could not open browser. Please visit:");
    expect(consoleLogSpy).toHaveBeenCalledWith(deviceCodePayload.verification_uri_complete);
    expect(stderrWriteSpy).toHaveBeenCalled();
  });
});
