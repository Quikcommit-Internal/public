import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/git.js", () => ({
  getHeadSha: vi.fn().mockReturnValue("abc1234"),
  getUpstreamRef: vi.fn().mockReturnValue("origin/main"),
  stashPushIfDirty: vi.fn().mockReturnValue(false),
  stashPop: vi.fn(),
  createBranch: vi.fn(),
  checkoutBranch: vi.fn(),
  resetHard: vi.fn(),
  deleteBranch: vi.fn(),
}));

import { rescueCommits } from "../src/branch-rescue.js";
import * as git from "../src/git.js";

describe("rescueCommits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (git.getHeadSha as unknown as ReturnType<typeof vi.fn>).mockReturnValue("abc1234");
    (git.getUpstreamRef as unknown as ReturnType<typeof vi.fn>).mockReturnValue("origin/main");
    (git.stashPushIfDirty as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it("performs the full rescue sequence (no stash needed)", () => {
    rescueCommits({ currentBranch: "main", newBranch: "feat/rescue" });
    expect(git.createBranch).toHaveBeenCalledWith("feat/rescue", "abc1234");
    expect(git.resetHard).toHaveBeenCalledWith("origin/main");
    expect(git.checkoutBranch).toHaveBeenCalledWith("feat/rescue");
    expect(git.stashPop).not.toHaveBeenCalled();
  });

  it("stashes and pops when working tree is dirty", () => {
    (git.stashPushIfDirty as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    rescueCommits({ currentBranch: "main", newBranch: "feat/rescue" });
    expect(git.stashPushIfDirty).toHaveBeenCalled();
    expect(git.createBranch).toHaveBeenCalledWith("feat/rescue", "abc1234");
    expect(git.resetHard).toHaveBeenCalledWith("origin/main");
    expect(git.checkoutBranch).toHaveBeenCalledWith("feat/rescue");
    expect(git.stashPop).toHaveBeenCalled();
  });

  it("aborts and rolls back if reset fails — message says Rescue aborted", () => {
    (git.resetHard as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("reset failed");
    });
    expect(() => rescueCommits({ currentBranch: "main", newBranch: "feat/rescue" })).toThrow(
      /Rescue aborted/
    );
  });

  it("deletes the new branch when resetHard throws", () => {
    (git.resetHard as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("reset failed");
    });
    try {
      rescueCommits({ currentBranch: "main", newBranch: "feat/rescue" });
    } catch {
      /* expected */
    }
    expect(git.deleteBranch).toHaveBeenCalledWith("feat/rescue");
  });

  it("pops stash when resetHard throws and a stash was created", () => {
    (git.stashPushIfDirty as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (git.resetHard as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("reset failed");
    });
    try {
      rescueCommits({ currentBranch: "main", newBranch: "feat/rescue" });
    } catch {
      /* expected */
    }
    expect(git.stashPop).toHaveBeenCalled();
  });

  it("does not call stashPop on resetHard failure when no stash was created", () => {
    (git.stashPushIfDirty as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (git.resetHard as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("reset failed");
    });
    try {
      rescueCommits({ currentBranch: "main", newBranch: "feat/rescue" });
    } catch {
      /* expected */
    }
    expect(git.stashPop).not.toHaveBeenCalled();
  });

  it("error message includes original error when resetHard throws", () => {
    (git.resetHard as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("network timeout");
    });
    let thrown: Error | null = null;
    try {
      rescueCommits({ currentBranch: "main", newBranch: "feat/rescue" });
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.message).toMatch(/Original error: network timeout/);
  });

  it("throws descriptive stash-conflict message when stashPop fails on success path", () => {
    (git.stashPushIfDirty as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (git.stashPop as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("conflict on pop");
    });
    expect(() => rescueCommits({ currentBranch: "main", newBranch: "feat/rescue" })).toThrow(
      /Stash conflict during recovery/
    );
  });

  it("recovery message includes manual resolution instructions", () => {
    (git.stashPushIfDirty as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (git.stashPop as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("conflict on pop");
    });
    let thrown: Error | null = null;
    try {
      rescueCommits({ currentBranch: "main", newBranch: "feat/rescue" });
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.message).toMatch(/git stash pop/);
    expect(thrown!.message).toMatch(/git stash drop/);
    expect(thrown!.message).toMatch(/changes are preserved in the stash/);
  });

  it("throws when no upstream is configured", () => {
    (git.getUpstreamRef as unknown as ReturnType<typeof vi.fn>).mockReturnValue(null);
    expect(() => rescueCommits({ currentBranch: "main", newBranch: "feat/rescue" })).toThrow(
      /upstream/i
    );
  });

  it("rolls back to original headSha when checkoutBranch throws after resetHard succeeds", () => {
    // checkoutBranch throws AFTER resetHard has already succeeded
    (git.checkoutBranch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("checkout failed");
    });

    expect(() =>
      rescueCommits({ currentBranch: "main", newBranch: "feat/rescue" })
    ).toThrow("checkout failed");

    // resetHard should be called twice:
    // 1st call: reset main to upstream ("origin/main")
    // 2nd call: rollback to original headSha ("abc1234")
    expect(git.resetHard).toHaveBeenCalledTimes(2);
    const calls = (git.resetHard as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]?.[0]).toBe("origin/main");
    expect(calls[1]?.[0]).toBe("abc1234");
  });
});
