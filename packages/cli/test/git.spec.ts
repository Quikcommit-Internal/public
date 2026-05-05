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

  it("uses --set-upstream when branch has no upstream", () => {
    const mock = execFileSync as unknown as ReturnType<typeof vi.fn>;
    mock
      .mockReturnValueOnce("feat/my-branch\n") // rev-parse --abbrev-ref HEAD
      .mockImplementationOnce(() => { throw new Error("no upstream"); }) // rev-parse upstream check
      .mockReturnValueOnce(Buffer.from("")); // git push --set-upstream
    gitPush();
    const pushCall = mock.mock.calls[2];
    expect(pushCall[0]).toBe("git");
    expect(pushCall[1]).toEqual(["push", "--set-upstream", "origin", "feat/my-branch"]);
    expect(pushCall[2]).toMatchObject({ stdio: "pipe" });
  });

  it("uses plain push when branch has an upstream", () => {
    const mock = execFileSync as unknown as ReturnType<typeof vi.fn>;
    mock
      .mockReturnValueOnce("feat/my-branch\n") // rev-parse --abbrev-ref HEAD
      .mockReturnValueOnce("origin/feat/my-branch\n") // rev-parse upstream (exists)
      .mockReturnValueOnce(Buffer.from("")); // git push
    gitPush();
    const pushCall = mock.mock.calls[2];
    expect(pushCall[1]).toEqual(["push"]);
  });

  it("surfaces stderr and re-throws on push failure", () => {
    const mock = execFileSync as unknown as ReturnType<typeof vi.fn>;
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mock
      .mockReturnValueOnce("main\n") // branch name
      .mockReturnValueOnce("origin/main\n") // upstream exists
      .mockImplementationOnce(() => {
        throw Object.assign(new Error("push failed"), {
          stderr: Buffer.from("fatal: could not read Username"),
        });
      });

    expect(() => gitPush()).toThrow("push failed");
    expect(stderrWrite).toHaveBeenCalledWith("fatal: could not read Username");
    stderrWrite.mockRestore();
  });
});
