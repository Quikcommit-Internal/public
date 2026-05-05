import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:readline/promises", () => ({
  default: {
    createInterface: () => ({
      question: vi.fn().mockResolvedValue("y"),
      close: vi.fn(),
    }),
  },
}));

// Mutable handle so individual tests can override per-call behaviour.
const mockGenerateBranchNameForBranch = vi.fn(async (req: { description?: string }) => {
  if (req.description === "make oauth login") {
    return { name: "feat/oauth-login", type: "feat", slug: "oauth-login" };
  }
  return { name: "fix/some-thing", type: "fix", slug: "some-thing" };
});

vi.mock("../../src/api.js", () => ({
  ApiClient: class {
    constructor() {}
    hasAuth() {
      return true;
    }
    async generateBranchName(req: { description?: string }) {
      return mockGenerateBranchNameForBranch(req);
    }
  },
}));

vi.mock("../../src/git.js", () => ({
  isGitRepo: () => true,
  getCurrentBranch: () => "main",
  getStagedDiff: () => "diff --git a/x b/x\n+x",
  getStagedFiles: () => "x\n",
  hasStagedChanges: () => true,
  branchExists: vi.fn().mockReturnValue(false),
  createAndCheckoutBranch: vi.fn(),
  createBranch: vi.fn(),
  gitPushSetUpstream: vi.fn(),
  getRecentBranchCommits: () => [],
  validateRef: () => {},
}));

vi.mock("../../src/config.js", () => ({
  getApiKey: () => "test-key",
  getConfig: () => ({}),
}));

vi.mock("../../src/local.js", () => ({
  getLocalProviderConfig: vi.fn().mockReturnValue({ provider: "ollama" }),
  generateLocalBranchName: vi.fn().mockResolvedValue("feat/local-generated"),
  runLocalBranch: vi.fn().mockResolvedValue(undefined),
}));

import { runBranch } from "../../src/commands/branch.js";
import * as gitMod from "../../src/git.js";
import * as guardMod from "../../src/protected-branch-guard.js";
import * as rescueMod from "../../src/branch-rescue.js";
import * as configMod from "../../src/config.js";
import * as localMod from "../../src/local.js";

describe("runBranch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("with --message generates name and creates branch", async () => {
    await runBranch({
      message: "make oauth login",
      noSwitch: false,
      dryRun: false,
      push: false,
    });
    expect(gitMod.createAndCheckoutBranch).toHaveBeenCalledWith("feat/oauth-login", "HEAD");
  });

  it("with --dry-run does not create branch", async () => {
    await runBranch({
      message: "make oauth login",
      dryRun: true,
      noSwitch: false,
      push: false,
    });
    expect(gitMod.createAndCheckoutBranch).not.toHaveBeenCalled();
    expect(gitMod.createBranch).not.toHaveBeenCalled();
  });

  it("with --no-switch creates without checkout", async () => {
    await runBranch({
      message: "make oauth login",
      noSwitch: true,
      dryRun: false,
      push: false,
    });
    expect(gitMod.createBranch).toHaveBeenCalledWith("feat/oauth-login", "HEAD");
    expect(gitMod.createAndCheckoutBranch).not.toHaveBeenCalled();
  });

  it("with explicit name skips AI", async () => {
    await runBranch({
      explicitName: "feat/manual-name",
      noSwitch: false,
      dryRun: false,
      push: false,
    });
    expect(gitMod.createAndCheckoutBranch).toHaveBeenCalledWith("feat/manual-name", "HEAD");
  });

  it("rejects invalid explicit name", async () => {
    await expect(
      runBranch({
        explicitName: "not a valid name",
        noSwitch: false,
        dryRun: false,
        push: false,
      })
    ).rejects.toThrow(/invalid branch name/i);
  });

  it("appends suffix if name exists", async () => {
    (gitMod.branchExists as unknown as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    await runBranch({
      message: "make oauth login",
      noSwitch: false,
      dryRun: false,
      push: false,
    });
    expect(gitMod.createAndCheckoutBranch).toHaveBeenCalledWith("feat/oauth-login-2", "HEAD");
  });

  it("with --push pushes upstream after creation", async () => {
    await runBranch({
      message: "make oauth login",
      noSwitch: false,
      dryRun: false,
      push: true,
    });
    expect(gitMod.gitPushSetUpstream).toHaveBeenCalledWith("feat/oauth-login");
  });
});

describe("runBranch --rescue", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when not on a protected branch", async () => {
    vi.spyOn(guardMod, "detectProtectedBranchState").mockReturnValue({
      isProtected: false,
      branch: "feat/foo",
      commitsAhead: 0,
      mode: "none",
    });
    await expect(runBranch({ rescue: true, message: "x" })).rejects.toThrow(/protected branch/i);
  });

  it("throws when there are no commits ahead of upstream", async () => {
    vi.spyOn(guardMod, "detectProtectedBranchState").mockReturnValue({
      isProtected: true,
      branch: "main",
      commitsAhead: 0,
      mode: "uncommitted",
    });
    await expect(runBranch({ rescue: true, message: "x" })).rejects.toThrow(/No commits ahead/);
  });

  it("dry-run does not call rescueCommits", async () => {
    vi.spyOn(guardMod, "detectProtectedBranchState").mockReturnValue({
      isProtected: true,
      branch: "main",
      commitsAhead: 2,
      mode: "rescue",
    });
    vi.spyOn(gitMod, "getRecentBranchCommits").mockReturnValue(["fix: a", "fix: b"]);
    const rescueSpy = vi.spyOn(rescueMod, "rescueCommits");
    await runBranch({ rescue: true, message: "summary", dryRun: true });
    expect(rescueSpy).not.toHaveBeenCalled();
  });

  it("explicit name rescue path appends suffix when name already exists (ensures ensureUniqueName is called)", async () => {
    // Simulate interactive TTY so the rescue flow doesn't abort
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    try {
      vi.spyOn(guardMod, "detectProtectedBranchState").mockReturnValue({
        isProtected: true,
        branch: "main",
        commitsAhead: 1,
        mode: "rescue",
      });

      // First call to branchExists returns true (name taken), second returns false (suffix free)
      (gitMod.branchExists as unknown as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      // Spy on rescueCommits to capture the name used; mock to avoid git calls
      const rescueSpy = vi.spyOn(rescueMod, "rescueCommits").mockReturnValue({
        newBranch: "feat/a-thing-2",
        stashed: false,
        upstreamRef: "origin/main",
        movedFromSha: "abc1234",
      });

      // Use explicit name to keep the test simple (no AI call needed)
      await runBranch({ rescue: true, explicitName: "feat/a-thing", dryRun: false });

      // ensureUniqueName should have appended -2 because first branchExists returned true
      expect(rescueSpy).toHaveBeenCalledWith(
        expect.objectContaining({ newBranch: "feat/a-thing-2" })
      );
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
    }
  });
});

describe("runBranch --rescue local provider: uniqueness handled internally (Item D)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses name returned by generateLocalBranchName as-is (skipUniqueness=true)", async () => {
    // Item D: generateLocalBranchName already calls ensureUniqueName internally.
    // The outer finalizeBranchName skips the redundant uniqueness check.
    // The mock returns a pre-unique name "feat/local-generated" and the outer code
    // should use it directly without calling branchExists again.

    vi.spyOn(configMod, "getApiKey").mockReturnValue(null);

    // Simulate interactive TTY
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    try {
      vi.spyOn(guardMod, "detectProtectedBranchState").mockReturnValue({
        isProtected: true,
        branch: "main",
        commitsAhead: 1,
        mode: "rescue",
      });
      vi.spyOn(gitMod, "getRecentBranchCommits").mockReturnValue(["feat: local work"]);

      // The inner generateLocalBranchName returns an already-unique name.
      // With skipUniqueness=true, branchExists should NOT be called by finalizeBranchName.
      (gitMod.branchExists as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const rescueSpy = vi.spyOn(rescueMod, "rescueCommits").mockReturnValue({
        newBranch: "feat/local-generated",
        stashed: false,
        upstreamRef: "origin/main",
        movedFromSha: "abc1234",
      });

      // Clear the branchExists mock call history right before invoking runBranch,
      // so we only count calls made during this specific run.
      (gitMod.branchExists as ReturnType<typeof vi.fn>).mockClear();

      await runBranch({ rescue: true, dryRun: false });

      // The name from generateLocalBranchName is used without outer uniqueness modification.
      expect(rescueSpy).toHaveBeenCalledWith(
        expect.objectContaining({ newBranch: "feat/local-generated" })
      );

      // branchExists should not have been called by the outer finalizeBranchName
      // (skipUniqueness=true skips that check). The inner generateLocalBranchName mock
      // does not call the real branchExists since it's fully mocked.
      expect(gitMod.branchExists).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
    }
  });
});

describe("runBranch local fallback path (no API key)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes runLocalBranch when getApiKey returns null and local provider is configured", async () => {
    // Override getApiKey to simulate no SaaS credentials
    vi.spyOn(configMod, "getApiKey").mockReturnValue(null);
    // getLocalProviderConfig is already mocked to return { provider: "ollama" }

    const runLocalSpy = vi.spyOn(localMod, "runLocalBranch").mockResolvedValue(undefined);

    await runBranch({ message: "add new endpoint", noSwitch: false, dryRun: false, push: false });

    expect(runLocalSpy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Item H: --rescue path must fall back to deterministicBranchName when AI fails
// ---------------------------------------------------------------------------
describe("runBranch --rescue Item H: deterministic fallback when API throws", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Restore the branch name mock to its default behaviour
    mockGenerateBranchNameForBranch.mockImplementation(async (req: { description?: string }) => {
      if (req.description === "make oauth login") {
        return { name: "feat/oauth-login", type: "feat", slug: "oauth-login" };
      }
      return { name: "fix/some-thing", type: "fix", slug: "some-thing" };
    });
  });

  it("falls back to a valid deterministic branch name when generateBranchName throws", async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    try {
      vi.spyOn(guardMod, "detectProtectedBranchState").mockReturnValue({
        isProtected: true,
        branch: "main",
        commitsAhead: 2,
        mode: "rescue",
      });

      // Provide recent commits mentioning "fix" so the deterministic name is predictable
      vi.spyOn(gitMod, "getRecentBranchCommits").mockReturnValue([
        "fix: login broken",
        "fix: edge case",
      ]);

      // Make the API throw via the module-level mock handle
      mockGenerateBranchNameForBranch.mockRejectedValue(new Error("network error"));

      const rescueSpy = vi.spyOn(rescueMod, "rescueCommits").mockReturnValue({
        newBranch: "fix/login-broken-fix-edge",
        stashed: false,
        upstreamRef: "origin/main",
        movedFromSha: "abc1234",
      });

      // Should NOT throw — deterministic fallback fires
      await expect(
        runBranch({ rescue: true, dryRun: false })
      ).resolves.toBeUndefined();

      // rescueCommits was called with a valid fix/* branch name
      expect(rescueSpy).toHaveBeenCalledWith(
        expect.objectContaining({ newBranch: expect.stringMatching(/^fix\//) })
      );
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
    }
  });

  it("falls back to deterministic name when local provider throws", async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    try {
      vi.spyOn(guardMod, "detectProtectedBranchState").mockReturnValue({
        isProtected: true,
        branch: "main",
        commitsAhead: 1,
        mode: "rescue",
      });

      vi.spyOn(gitMod, "getRecentBranchCommits").mockReturnValue(["feat: new dashboard"]);

      // No API key → local path; local throws
      vi.spyOn(configMod, "getApiKey").mockReturnValue(null);
      vi.spyOn(localMod, "generateLocalBranchName").mockRejectedValue(
        new Error("ollama not running")
      );

      const rescueSpy = vi.spyOn(rescueMod, "rescueCommits").mockReturnValue({
        newBranch: "feat/new-dashboard",
        stashed: false,
        upstreamRef: "origin/main",
        movedFromSha: "abc1234",
      });

      await expect(
        runBranch({ rescue: true, dryRun: false })
      ).resolves.toBeUndefined();

      // rescueCommits was called with a feat/* branch from deterministic fallback
      expect(rescueSpy).toHaveBeenCalledWith(
        expect.objectContaining({ newBranch: expect.stringMatching(/^feat\//) })
      );
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
    }
  });
});
