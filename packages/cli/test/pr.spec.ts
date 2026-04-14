import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs so we can control which files exist without touching the real filesystem.
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    statSync: vi.fn(() => ({ isFile: () => false, isDirectory: () => false })),
    readdirSync: vi.fn(() => [] as string[]),
    readFileSync: vi.fn(() => "## Summary\n- "),
  };
});

vi.mock("../src/git.js", () => ({
  getGitRoot: vi.fn(() => "/fake/root"),
  getCurrentBranch: vi.fn(() => "feat/test"),
  getBranchCommits: vi.fn(() => ["feat: test"]),
  getDiffStat: vi.fn(() => "1 file changed"),
}));

const mockGeneratePR = vi.fn().mockResolvedValue({
  message: "## Summary\nTest",
  title: "Test title",
});

vi.mock("../src/api.js", () => {
  return {
    ApiClient: vi.fn(function () {
      return { generatePR: mockGeneratePR };
    }),
  };
});

vi.mock("../src/config.js", () => ({
  getApiKey: vi.fn(() => "test-key"),
  loadConfig: vi.fn(() => ({})),
}));

vi.mock("../src/commitlint.js", () => ({
  detectCommitlintRules: vi.fn().mockResolvedValue(undefined),
}));

import { existsSync, statSync, readdirSync } from "fs";
import { pr } from "../src/commands/pr.js";

// Helpers to configure per-test fs state.
function makeFile() {
  return { isFile: () => true, isDirectory: () => false };
}
function makeDir() {
  return { isFile: () => false, isDirectory: () => true };
}

describe("PR template detection", () => {
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation((() => {}) as any);

  beforeEach(() => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(statSync).mockReturnValue({ isFile: () => false, isDirectory: () => false } as any);
    vi.mocked(readdirSync).mockReturnValue([] as any);
    consoleErrorSpy.mockClear();
    consoleLogSpy.mockClear();
  });

  it("uses .github/pull_request_template.md when present", async () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p).endsWith(".github/pull_request_template.md")
    );
    vi.mocked(statSync).mockImplementation((p) =>
      String(p).endsWith(".github/pull_request_template.md") ? (makeFile() as any) : ({ isFile: () => false, isDirectory: () => false } as any)
    );

    await pr({ base: "main" });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(".github/pull_request_template.md")
    );
  });

  it("uses .github/PULL_REQUEST_TEMPLATE.md (uppercase) when lowercase not present", async () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p).endsWith(".github/PULL_REQUEST_TEMPLATE.md")
    );
    vi.mocked(statSync).mockImplementation((p) =>
      String(p).endsWith(".github/PULL_REQUEST_TEMPLATE.md") ? (makeFile() as any) : ({ isFile: () => false, isDirectory: () => false } as any)
    );

    await pr({ base: "main" });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("PULL_REQUEST_TEMPLATE.md")
    );
  });

  it("uses root-level pull_request_template.md when .github/ not present", async () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p) === "/fake/root/pull_request_template.md"
    );
    vi.mocked(statSync).mockImplementation((p) =>
      String(p) === "/fake/root/pull_request_template.md" ? (makeFile() as any) : ({ isFile: () => false, isDirectory: () => false } as any)
    );

    await pr({ base: "main" });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("pull_request_template.md")
    );
  });

  it("uses first .md from .github/PULL_REQUEST_TEMPLATE/ directory", async () => {
    const dir = "/fake/root/.github/PULL_REQUEST_TEMPLATE";
    vi.mocked(existsSync).mockImplementation((p) => String(p) === dir);
    vi.mocked(statSync).mockImplementation((p) => {
      if (String(p) === dir) return makeDir() as any;
      if (String(p) === `${dir}/bug_report.md`) return makeFile() as any;
      return { isFile: () => false, isDirectory: () => false } as any;
    });
    vi.mocked(readdirSync).mockReturnValue(["bug_report.md", "feature_request.md"] as any);

    await pr({ base: "main" });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("bug_report.md")
    );
  });

  it("does NOT use docs/pull_request_template.md (not a GitHub location)", async () => {
    // Only a docs/ template exists — should not be found.
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p) === "/fake/root/docs/pull_request_template.md"
    );
    vi.mocked(statSync).mockImplementation((p) =>
      String(p) === "/fake/root/docs/pull_request_template.md" ? (makeFile() as any) : ({ isFile: () => false, isDirectory: () => false } as any)
    );

    await pr({ base: "main" });

    const templateLog = consoleErrorSpy.mock.calls.find((args) =>
      String(args[0]).includes("[qc] Using PR template")
    );
    expect(templateLog).toBeUndefined();
  });

  it("proceeds without template when no template file exists", async () => {
    // All existsSync returns false (default beforeEach).
    await pr({ base: "main" });

    const templateLog = consoleErrorSpy.mock.calls.find((args) =>
      String(args[0]).includes("[qc] Using PR template")
    );
    expect(templateLog).toBeUndefined();
  });
});
