import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync } from "child_process";
import { validateRef, stageAll, getUnstagedFiles, gitPush } from "../src/git.js";

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

describe("validateRef", () => {
  it("throws for leading single hyphen flag injection", () => {
    expect(() => validateRef("-u")).toThrow(/starts with hyphen/);
  });

  it("throws for leading double hyphen flag injection", () => {
    expect(() => validateRef("--force")).toThrow(/starts with hyphen/);
  });

  it("throws for bare hyphen", () => {
    expect(() => validateRef("-")).toThrow(/starts with hyphen/);
  });

  it("does not throw for a normal branch name", () => {
    expect(() => validateRef("main")).not.toThrow();
  });

  it("does not throw for a feature branch", () => {
    expect(() => validateRef("feat/x")).not.toThrow();
  });

  it("does not throw for a semver tag", () => {
    expect(() => validateRef("v1.0.0")).not.toThrow();
  });

  it("does not throw for SHA-like refs", () => {
    expect(() => validateRef("abc1234")).not.toThrow();
  });

  it("throws for empty string", () => {
    expect(() => validateRef("")).toThrow(/Invalid git ref/);
  });

  it("throws for refs with disallowed characters", () => {
    expect(() => validateRef("feat/bad name")).toThrow(/Invalid git ref/);
  });
});

describe("stageAll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses `git add -A` to stage all files including untracked", () => {
    (execFileSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue("");
    stageAll();
    const call = (execFileSync as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("git");
    expect(call[1]).toEqual(["add", "-A"]);
  });
});

describe("getUnstagedFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes untracked files (lines starting with ??)", () => {
    (execFileSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      " M src/a.ts\n?? src/new.ts\n M src/b.ts\n"
    );
    const result = getUnstagedFiles();
    expect(result).toHaveLength(3);
    expect(result.some((line) => line.startsWith("??"))).toBe(true);
  });

  it("returns empty array when working tree is clean", () => {
    (execFileSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue("");
    expect(getUnstagedFiles()).toEqual([]);
  });
});

describe("gitPush", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses stdio:pipe so git's verbose output is suppressed", () => {
    (execFileSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from(""));
    gitPush();
    const call = (execFileSync as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("git");
    expect(call[1]).toEqual(["push"]);
    expect(call[2]).toMatchObject({ stdio: "pipe" });
  });

  it("writes stderr to process.stderr and re-throws on failure", () => {
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const err = Object.assign(new Error("push failed"), {
      stderr: Buffer.from("fatal: could not read Username"),
    });
    (execFileSync as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw err;
    });

    expect(() => gitPush()).toThrow("push failed");
    expect(stderrWrite).toHaveBeenCalledWith("fatal: could not read Username");
    stderrWrite.mockRestore();
  });
});
