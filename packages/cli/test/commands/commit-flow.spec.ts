import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock readline so interactive prompts don't block on stdin
vi.mock("node:readline/promises", () => ({
  default: {
    createInterface: () => ({
      question: vi.fn().mockResolvedValue("y"),
      close: vi.fn(),
    }),
  },
}));

const {
  mockGenerateCommit,
  mockGetTeamRules,
  mockSummarizeChunk,
  mockPreprocessDiffWithSizeBudget,
  mockSplitDiffIntoChunks,
} = vi.hoisted(() => ({
  mockGenerateCommit: vi.fn(async () => ({
    message: "feat(cli): add commit flow",
    diagnostics: { tokenUsage: { totalEstimated: 1200 } },
  })),
  mockGetTeamRules: vi.fn(async () => null),
  mockSummarizeChunk: vi.fn(async (_diff: string, files: string) => `summary for ${files}`),
  mockPreprocessDiffWithSizeBudget: vi.fn((diff: string) => ({
    processedDiff: diff,
    summarized: [],
    tokensSaved: 0,
    needsChunking: false,
  })),
  mockSplitDiffIntoChunks: vi.fn(() => []),
}));

vi.mock("../../src/config.js", () => ({
  getApiKey: () => "test-key",
  getConfig: () => ({ rules: { types: ["feat", "fix"] } }),
}));

vi.mock("../../src/api.js", () => ({
  ApiClient: class {
    constructor() {}
    getTeamRules = mockGetTeamRules;
    generateCommit = mockGenerateCommit;
    summarizeChunk = mockSummarizeChunk;
  },
}));

vi.mock("../../src/git.js", () => ({
  isGitRepo: () => true,
  getStagedDiff: () => "diff --git a/src/foo.ts b/src/foo.ts\n+export const foo = 1;",
  getStagedFiles: () => "src/foo.ts\n",
  getStagedFileCount: () => 1,
  hasStagedChanges: vi.fn().mockReturnValue(true),
  getUnstagedFiles: () => [],
  stageAll: vi.fn(),
  gitCommit: vi.fn(),
  gitPush: vi.fn(),
  getCommitHash: () => "abc1234",
  getCurrentBranch: () => "feat/commit-flow",
  getPushStats: vi.fn().mockReturnValue({ commits: 1, stat: "1 file changed, 1 insertion(+)" }),
  getRecentBranchCommits: () => ["feat: prior work"],
  getStagedDiffShortstat: () => ({ additions: 1, deletions: 0 }),
}));

vi.mock("../../src/monorepo.js", () => ({
  detectWorkspace: vi.fn(() => null),
  autoDetectScope: vi.fn(() => null),
}));

vi.mock("../../src/ui.js", async () => {
  const { resolveTheme } = await import("../../src/ui-theme.js");
  const theme = resolveTheme({ noColor: true });
  return {
    getUI: () => ({
      log: {
        error: vi.fn(),
        success: vi.fn(),
        step: vi.fn(),
        dim: vi.fn(),
      },
      spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
      isColor: false,
      theme,
    }),
  };
});

vi.mock("../../src/ui-rich.js", () => ({
  createStageSpinner: () => ({ start: vi.fn(), stop: vi.fn() }),
  flashSuccess: vi.fn().mockResolvedValue(undefined),
  buildUIContext: () => ({ animate: false, isTTY: false }),
}));

vi.mock("../../src/smart-diff.js", () => ({
  preprocessDiffWithSizeBudget: (diff: string) => mockPreprocessDiffWithSizeBudget(diff),
  splitDiffIntoChunks: (diff: string) => mockSplitDiffIntoChunks(diff),
}));

vi.mock("../../src/commit-helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/commit-helpers.js")>();
  return {
    ...actual,
    logVerboseDiagnostics: vi.fn(),
    interactiveRefineMessage: vi.fn(),
    confirmCommit: vi.fn(),
    shouldSkipTTYInteraction: () => true,
    displayCommitMessage: vi.fn(),
  };
});

vi.mock("../../src/commitlint.js", () => ({
  detectCommitlintRules: async () => ({ subjectCase: "lower" }),
}));

vi.mock("../../src/branch-guard.js", () => ({
  runBranchGuard: vi.fn().mockResolvedValue({ action: "continue" }),
}));

import { runCommit } from "../../src/commands/commit.js";
import * as gitMod from "../../src/git.js";
import * as commitHelpersMod from "../../src/commit-helpers.js";
import * as monorepoMod from "../../src/monorepo.js";
import type { ParsedArgs } from "../../src/index.js";

const baseArgs: ParsedArgs = {
  command: "commit",
  all: false,
  messageOnly: false,
  push: false,
  verbose: false,
  quiet: true,
  dryRun: false,
  interactive: false,
  split: false,
  forceBody: false,
  confirm: false,
  noContext: true,
  noSmartDiff: false,
  local: false,
  exclude: [],
  positionals: [],
};

describe("runCommit commit flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateCommit.mockResolvedValue({
      message: "feat(cli): add commit flow",
      diagnostics: { tokenUsage: { totalEstimated: 1200 } },
    });
    mockGetTeamRules.mockResolvedValue(null);
    mockPreprocessDiffWithSizeBudget.mockImplementation((diff: string) => ({
      processedDiff: diff,
      summarized: [],
      tokensSaved: 0,
      needsChunking: false,
    }));
    mockSplitDiffIntoChunks.mockReturnValue([]);
    (gitMod.hasStagedChanges as ReturnType<typeof vi.fn>).mockReturnValue(true);
  });

  it("runs basic commit flow: staged diff → API → commit message → git commit", async () => {
    await runCommit({ ...baseArgs });

    expect(mockGenerateCommit).toHaveBeenCalledOnce();
    expect(mockGenerateCommit).toHaveBeenCalledWith(
      expect.stringContaining("diff --git"),
      "src/foo.ts\n",
      expect.objectContaining({ subjectCase: "lower", types: ["feat", "fix"] }),
      undefined,
      undefined,
      undefined
    );
    expect(commitHelpersMod.displayCommitMessage).toHaveBeenCalledWith(
      "feat(cli): add commit flow",
      expect.objectContaining({
        stagedFiles: ["src/foo.ts"],
        stats: expect.objectContaining({ files: 1, additions: 1, deletions: 0, tokens: 1200 }),
      })
    );
    expect(gitMod.gitCommit).toHaveBeenCalledWith("feat(cli): add commit flow");
    expect(gitMod.gitPush).not.toHaveBeenCalled();
  });

  it("merges team rules when authenticated", async () => {
    mockGetTeamRules.mockResolvedValue({
      types: ["feat", "fix", "chore"],
      scopes: ["cli", "api"],
      maxSubjectLength: 72,
    });
    (monorepoMod.detectWorkspace as ReturnType<typeof vi.fn>).mockReturnValue({ packages: [] });
    (monorepoMod.autoDetectScope as ReturnType<typeof vi.fn>).mockReturnValue("cli,api,web");

    await runCommit({ ...baseArgs });

    expect(mockGetTeamRules).toHaveBeenCalledOnce();
    expect(mockGenerateCommit).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        subjectCase: "lower",
        types: ["feat", "fix", "chore"],
        scopes: ["cli", "api"],
        maxSubjectLength: 72,
      }),
      undefined,
      undefined,
      undefined
    );
  });

  it("dry-run generates message but does not commit", async () => {
    await runCommit({ ...baseArgs, dryRun: true });

    expect(mockGenerateCommit).toHaveBeenCalledOnce();
    expect(commitHelpersMod.displayCommitMessage).toHaveBeenCalledOnce();
    expect(gitMod.gitCommit).not.toHaveBeenCalled();
    expect(gitMod.gitPush).not.toHaveBeenCalled();
  });

  it("message-only prints message without committing", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCommit({ ...baseArgs, messageOnly: true });

    expect(mockGenerateCommit).toHaveBeenCalledOnce();
    expect(logSpy).toHaveBeenCalledWith("feat(cli): add commit flow");
    expect(commitHelpersMod.displayCommitMessage).not.toHaveBeenCalled();
    expect(gitMod.gitCommit).not.toHaveBeenCalled();

    logSpy.mockRestore();
  });

  it("push flow commits then pushes when --push", async () => {
    const callOrder: string[] = [];

    (gitMod.gitCommit as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callOrder.push("gitCommit");
    });
    (gitMod.getPushStats as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callOrder.push("getPushStats");
      return { commits: 1, stat: "1 file changed, 1 insertion(+)" };
    });
    (gitMod.gitPush as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callOrder.push("gitPush");
    });

    await runCommit({ ...baseArgs, push: true });

    expect(gitMod.gitCommit).toHaveBeenCalledWith("feat(cli): add commit flow");
    expect(gitMod.gitPush).toHaveBeenCalledOnce();
    expect(callOrder.indexOf("gitCommit")).toBeLessThan(callOrder.indexOf("getPushStats"));
    expect(callOrder.indexOf("getPushStats")).toBeLessThan(callOrder.indexOf("gitPush"));
  });
});

describe("runCommit error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (gitMod.hasStagedChanges as ReturnType<typeof vi.fn>).mockReturnValue(true);
    mockGenerateCommit.mockResolvedValue({
      message: "feat(cli): add commit flow",
      diagnostics: {},
    });
  });

  it("exits when there are no staged changes", async () => {
    (gitMod.hasStagedChanges as ReturnType<typeof vi.fn>).mockReturnValue(false);

    await expect(runCommit({ ...baseArgs })).rejects.toThrow();

    expect(mockGenerateCommit).not.toHaveBeenCalled();
    expect(gitMod.gitCommit).not.toHaveBeenCalled();
  });

  it("propagates API failure from generateCommit", async () => {
    mockGenerateCommit.mockRejectedValue(new Error("HTTP 503"));

    await expect(runCommit({ ...baseArgs })).rejects.toThrow("HTTP 503");

    expect(gitMod.gitCommit).not.toHaveBeenCalled();
  });
});

describe("runCommit chunked diff flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (gitMod.hasStagedChanges as ReturnType<typeof vi.fn>).mockReturnValue(true);
    mockGenerateCommit.mockResolvedValue({
      message: "feat: large refactor",
      diagnostics: {},
    });
    mockPreprocessDiffWithSizeBudget.mockReturnValue({
      processedDiff: "large processed diff",
      summarized: ["big-file.ts"],
      tokensSaved: 5000,
      needsChunking: true,
    });
    mockSplitDiffIntoChunks.mockReturnValue([
      { diff: "chunk-one", files: ["src/a.ts"] },
      { diff: "chunk-two", files: ["src/b.ts"] },
    ]);
    mockSummarizeChunk
      .mockResolvedValueOnce("summary for src/a.ts")
      .mockRejectedValueOnce(new Error("chunk 2 failed"));
  });

  it("uses Promise.allSettled for chunks and commits from partial summaries", async () => {
    await runCommit({ ...baseArgs });

    expect(mockSummarizeChunk).toHaveBeenCalledTimes(2);
    expect(mockSummarizeChunk).toHaveBeenNthCalledWith(1, "chunk-one", "src/a.ts", undefined);
    expect(mockSummarizeChunk).toHaveBeenNthCalledWith(2, "chunk-two", "src/b.ts", undefined);

    expect(mockGenerateCommit).toHaveBeenCalledOnce();
    expect(mockGenerateCommit).toHaveBeenCalledWith(
      "summary for src/a.ts",
      "src/foo.ts\n",
      expect.any(Object),
      undefined,
      undefined,
      undefined
    );
    expect(gitMod.gitCommit).toHaveBeenCalledWith("feat: large refactor");
  });

  it("exits when all chunk summaries fail", async () => {
    mockSummarizeChunk.mockReset();
    mockSummarizeChunk
      .mockRejectedValueOnce(new Error("chunk 1 failed"))
      .mockRejectedValueOnce(new Error("chunk 2 failed"));

    await expect(runCommit({ ...baseArgs })).rejects.toThrow();

    expect(mockGenerateCommit).not.toHaveBeenCalled();
    expect(gitMod.gitCommit).not.toHaveBeenCalled();
  });
});
