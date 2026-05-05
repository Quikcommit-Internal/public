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

// Mock all external dependencies before importing runCommit
vi.mock("../../src/config.js", () => ({
  getApiKey: () => "test-key",
  getConfig: () => ({}),
}));

vi.mock("../../src/api.js", () => ({
  ApiClient: class {
    constructor() {}
    async generateBranchName() {
      return { name: "feat/rescue-branch", type: "feat", slug: "rescue-branch" };
    }
    async getTeamRules() {
      return null;
    }
    async generateCommit() {
      return { message: "feat: something", diagnostics: {} };
    }
  },
}));

vi.mock("../../src/git.js", () => ({
  isGitRepo: () => true,
  getStagedDiff: () => "diff --git a/x b/x\n+x",
  getStagedFiles: () => "x\n",
  hasStagedChanges: vi.fn().mockReturnValue(false),
  getUnstagedFiles: () => [],
  stageAll: vi.fn(),
  gitCommit: vi.fn(),
  gitPush: vi.fn(),
  getShortStagedFiles: () => ({ files: [], total: 0 }),
  getCommitHash: () => "abc1234",
  getCurrentBranch: () => "main",
  getPushStats: () => null,
  getRecentBranchCommits: () => [],
  branchExists: vi.fn().mockReturnValue(false),
  createAndCheckoutBranch: vi.fn(),
  getStagedDiffShortstat: () => ({ additions: 1, deletions: 0 }),
}));

vi.mock("../../src/monorepo.js", () => ({
  detectWorkspace: () => null,
  autoDetectScope: () => null,
}));

vi.mock("../../src/ui.js", () => ({
  getUI: () => ({
    log: {
      error: vi.fn(),
      success: vi.fn(),
      step: vi.fn(),
      dim: vi.fn(),
    },
    spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
    isColor: false,
  }),
}));

vi.mock("../../src/smart-diff.js", () => ({
  preprocessDiff: (d: string) => ({ processedDiff: d, summarized: [], tokensSaved: 0 }),
}));

vi.mock("../../src/commit-helpers.js", () => ({
  applyCliTypeScopeToRules: (_r: unknown) => _r,
  generationHintsFromArgs: () => ({}),
  logVerboseDiagnostics: vi.fn(),
  interactiveRefineMessage: vi.fn(),
  confirmCommit: vi.fn(),
  shouldSkipTTYInteraction: () => true,
  createSilentLog: () => ({
    error: vi.fn(),
    success: vi.fn(),
    step: vi.fn(),
    dim: vi.fn(),
  }),
  displayCommitMessage: vi.fn(),
}));

vi.mock("../../src/commitlint.js", () => ({
  detectCommitlintRules: async () => ({}),
}));

// Mock the branch-guard module so we control the guard outcome
vi.mock("../../src/branch-guard.js", () => ({
  runBranchGuard: vi.fn().mockResolvedValue({ action: "continue" }),
}));

import { runCommit } from "../../src/commands/commit.js";
import * as gitMod from "../../src/git.js";
import * as branchGuardMod from "../../src/branch-guard.js";
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

describe("runCommit rescue mode guard (via runBranchGuard)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns early after rescue (action=done) without calling hasStagedChanges or gitCommit", async () => {
    (branchGuardMod.runBranchGuard as ReturnType<typeof vi.fn>).mockResolvedValue({
      action: "done",
    });

    await runCommit({ ...baseArgs, autoBranch: true });

    // hasStagedChanges must NOT have been called — rescue returns early
    expect(gitMod.hasStagedChanges).not.toHaveBeenCalled();

    // gitCommit must NOT have been called — no new commit after rescue
    expect(gitMod.gitCommit).not.toHaveBeenCalled();
  });

  it("returns cleanly (no process.exit) when guard returns abort", async () => {
    (branchGuardMod.runBranchGuard as ReturnType<typeof vi.fn>).mockResolvedValue({
      action: "abort",
    });

    // runCommit should resolve without throwing — abort is a clean return now.
    await expect(runCommit({ ...baseArgs })).resolves.toBeUndefined();

    // gitCommit and hasStagedChanges must NOT have been called
    expect(gitMod.gitCommit).not.toHaveBeenCalled();
    expect(gitMod.hasStagedChanges).not.toHaveBeenCalled();
  });

  it("does NOT return early for continue action — falls through to commit flow", async () => {
    (branchGuardMod.runBranchGuard as ReturnType<typeof vi.fn>).mockResolvedValue({
      action: "continue",
    });

    // hasStagedChanges returns false (no staged changes) → commit flow exits with error
    (gitMod.hasStagedChanges as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);

    // Expect process.exit(1) because there are no staged changes after branching
    await expect(runCommit({ ...baseArgs, autoBranch: true })).rejects.toThrow();

    // hasStagedChanges IS called in the normal branch path
    expect(gitMod.hasStagedChanges).toHaveBeenCalled();

    // gitCommit was not invoked (no staged changes)
    expect(gitMod.gitCommit).not.toHaveBeenCalled();
  });
});
