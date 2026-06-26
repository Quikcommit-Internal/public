import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DEFAULT_API_URL } from "@quikcommit/shared";

const mockGetApiKey = vi.fn(() => "file-api-key");

vi.mock("../src/config.js", () => ({
  getApiKey: () => mockGetApiKey(),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { ApiClient } from "../src/api.js";

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}) {
  const { ok = true, status = 200, statusText = "OK" } = init;
  return {
    ok,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(body),
  };
}

describe("ApiClient", () => {
  const originalApiUrl = process.env.QC_API_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetApiKey.mockReturnValue("file-api-key");
    delete process.env.QC_API_URL;
  });

  afterEach(() => {
    if (originalApiUrl === undefined) {
      delete process.env.QC_API_URL;
    } else {
      process.env.QC_API_URL = originalApiUrl;
    }
  });

  describe("constructor", () => {
    it("uses provided apiKey and baseUrl", () => {
      const client = new ApiClient({
        apiKey: "explicit-key",
        baseUrl: "https://custom.example.com",
      });
      expect(client.hasAuth()).toBe(true);
    });

    it("falls back to getApiKey() and DEFAULT_API_URL", () => {
      mockGetApiKey.mockReturnValue("from-config");
      const client = new ApiClient();
      expect(client.hasAuth()).toBe(true);
      expect(mockGetApiKey).toHaveBeenCalled();
    });

    it("prefers QC_API_URL env over DEFAULT_API_URL", async () => {
      process.env.QC_API_URL = "https://env.example.com";
      fetchMock.mockResolvedValue(jsonResponse({ message: "feat: ok" }));

      const client = new ApiClient({ apiKey: "key" });
      await client.generateCommit("diff", "changes");

      expect(fetchMock).toHaveBeenCalledWith(
        "https://env.example.com/v1/commit",
        expect.any(Object)
      );
    });

    it("uses DEFAULT_API_URL when no baseUrl or env override", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ message: "feat: ok" }));

      const client = new ApiClient({ apiKey: "key" });
      await client.generateCommit("diff", "changes");

      expect(fetchMock).toHaveBeenCalledWith(
        `${DEFAULT_API_URL}/v1/commit`,
        expect.any(Object)
      );
    });
  });

  describe("request()", () => {
    it("sends Authorization header and JSON body", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ message: "feat: add tests" }));

      const client = new ApiClient({ apiKey: "test-token", baseUrl: "https://api.test" });
      await client.generateCommit("diff content", "file.ts");

      expect(fetchMock).toHaveBeenCalledWith("https://api.test/v1/commit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-token",
        },
        body: JSON.stringify({
          diff: "diff content",
          changes: "file.ts",
        }),
        signal: expect.any(AbortSignal),
      });
    });

    it("throws when not authenticated", async () => {
      mockGetApiKey.mockReturnValue(null);
      const client = new ApiClient({ apiKey: undefined });

      await expect(client.generateCommit("diff", "changes")).rejects.toThrow(
        "Not authenticated. Run `qc login` first."
      );
    });

    it("handles 413 with size hint", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          { error: "too large", received_bytes: 102_400, limit_bytes: 51_200 },
          { ok: false, status: 413 }
        )
      );

      const client = new ApiClient({ apiKey: "key" });

      await expect(client.generateCommit("big diff", "files")).rejects.toThrow(
        /Diff too large to send \(100KB > 50KB limit\)/
      );
    });

    it("handles generic HTTP errors", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ error: "Rate limit exceeded" }, { ok: false, status: 429 })
      );

      const client = new ApiClient({ apiKey: "key" });

      await expect(client.generateCommit("diff", "changes")).rejects.toThrow(
        "Rate limit exceeded"
      );
    });

    it("falls back to status text when error body is missing", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        json: vi.fn().mockRejectedValue(new Error("invalid json")),
      });

      const client = new ApiClient({ apiKey: "key" });

      await expect(client.generateCommit("diff", "changes")).rejects.toThrow("Bad Gateway");
    });

    it("parses successful JSON responses", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ message: "feat: parsed" }));

      const client = new ApiClient({ apiKey: "key" });
      const result = await client.generateCommit("diff", "changes");

      expect(result.message).toBe("feat: parsed");
    });

    it("includes AbortSignal.timeout on fetch calls", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ message: "feat: ok" }));

      const client = new ApiClient({ apiKey: "key" });
      await client.generateCommit("diff", "changes");

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(options.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("generateCommit()", () => {
    it("returns message with null-coalesce for missing fields", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ diagnostics: { model: "x" } }));

      const client = new ApiClient({ apiKey: "key" });
      const result = await client.generateCommit("diff", "changes");

      expect(result).toEqual({ message: "", diagnostics: { model: "x" } });
    });
  });

  describe("generateBranchName()", () => {
    it("returns name, type, and slug from the API", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          name: "feat/oauth-device-flow",
          type: "feat",
          slug: "oauth-device-flow",
        })
      );

      const client = new ApiClient({ apiKey: "key" });
      const result = await client.generateBranchName({ diff: "diff", changes: "auth.ts" });

      expect(result).toEqual({
        name: "feat/oauth-device-flow",
        type: "feat",
        slug: "oauth-device-flow",
      });
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/v1/branch"),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
  });

  describe("generatePR()", () => {
    it("returns title and message with null-coalesce", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ title: "Add OAuth" }));

      const client = new ApiClient({ apiKey: "key" });
      const result = await client.generatePR({
        diff: "diff",
        changes: "files",
        commits: ["feat: oauth"],
      });

      expect(result).toEqual({ title: "Add OAuth", message: "" });
    });
  });

  describe("getUsage()", () => {
    it("returns null on HTTP error instead of throwing", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn(),
      });

      const client = new ApiClient({ apiKey: "key" });
      const usage = await client.getUsage();

      expect(usage).toBeNull();
    });

    it("returns null when not authenticated", async () => {
      mockGetApiKey.mockReturnValue(null);
      const client = new ApiClient({ apiKey: undefined });

      await expect(client.getUsage()).resolves.toBeNull();
    });

    it("returns usage data on success", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          plan: "pro",
          commit_count: 10,
          limit: 100,
          remaining: 90,
        })
      );

      const client = new ApiClient({ apiKey: "key" });
      const usage = await client.getUsage();

      expect(usage).toEqual({
        plan: "pro",
        commit_count: 10,
        limit: 100,
        remaining: 90,
      });
    });
  });
});
