import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/git.js", () => ({
  getCurrentBranch: vi.fn(),
  getCommitsAheadOfUpstream: vi.fn(),
  getDefaultBranch: vi.fn().mockReturnValue("main"),
}));

vi.mock("../src/config.js", () => ({
  getConfig: () => ({}),
}));

import { shouldRunGuard, detectProtectedBranchState } from "../src/protected-branch-guard.js";
import * as git from "../src/git.js";

describe("shouldRunGuard", () => {
  it("skips when allowProtected is true", () => {
    expect(shouldRunGuard({ allowProtected: true, hookMode: false, isTTY: true })).toBe(false);
  });

  it("skips in hook mode", () => {
    expect(shouldRunGuard({ allowProtected: false, hookMode: true, isTTY: true })).toBe(false);
  });

  it("skips when not a TTY (stdin; prompts cannot be answered)", () => {
    expect(shouldRunGuard({ allowProtected: false, hookMode: false, isTTY: false })).toBe(false);
  });

  it("runs when interactive and not allowed", () => {
    expect(shouldRunGuard({ allowProtected: false, hookMode: false, isTTY: true })).toBe(true);
  });
});

describe("detectProtectedBranchState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns not-protected when current branch is feature branch", () => {
    (git.getCurrentBranch as unknown as ReturnType<typeof vi.fn>).mockReturnValue("feat/x");
    const state = detectProtectedBranchState({});
    expect(state.isProtected).toBe(false);
  });

  it("returns protected with 0 commits ahead when on main with only staged changes", () => {
    (git.getCurrentBranch as unknown as ReturnType<typeof vi.fn>).mockReturnValue("main");
    (git.getCommitsAheadOfUpstream as unknown as ReturnType<typeof vi.fn>).mockReturnValue(0);
    const state = detectProtectedBranchState({});
    expect(state.isProtected).toBe(true);
    expect(state.commitsAhead).toBe(0);
    expect(state.mode).toBe("uncommitted");
  });

  it("returns rescue mode when commits are ahead", () => {
    (git.getCurrentBranch as unknown as ReturnType<typeof vi.fn>).mockReturnValue("main");
    (git.getCommitsAheadOfUpstream as unknown as ReturnType<typeof vi.fn>).mockReturnValue(2);
    const state = detectProtectedBranchState({});
    expect(state.isProtected).toBe(true);
    expect(state.commitsAhead).toBe(2);
    expect(state.mode).toBe("rescue");
  });

  it("respects custom protected list from config", () => {
    (git.getCurrentBranch as unknown as ReturnType<typeof vi.fn>).mockReturnValue("custom-trunk");
    const state = detectProtectedBranchState({
      protectedBranches: ["custom-trunk"],
      detectDefault: false,
    });
    expect(state.isProtected).toBe(true);
  });

  it("matches glob patterns from config", () => {
    (git.getCurrentBranch as unknown as ReturnType<typeof vi.fn>).mockReturnValue("release/v1.0");
    const state = detectProtectedBranchState({
      protectedBranches: ["release/*"],
      detectDefault: false,
    });
    expect(state.isProtected).toBe(true);
  });
});
