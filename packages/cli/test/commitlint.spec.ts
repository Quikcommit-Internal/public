import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("../src/git.js", () => ({
  getGitRoot: vi.fn(),
  isGitRepo: vi.fn(() => true),
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, execFileSync: vi.fn() };
});

import { detectCommitlintRules } from "../src/commitlint.js";
import { getGitRoot } from "../src/git.js";
import { execFileSync } from "child_process";

describe("detectCommitlintRules", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "qc-commitlint-"));
    vi.mocked(getGitRoot).mockReturnValue(tmpDir);
    // Default: all subprocess calls throw so we fall through to JSON parse
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("mock: subprocess disabled");
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns undefined when no config file exists", async () => {
    const result = await detectCommitlintRules();
    expect(result).toBeUndefined();
  });

  it("parses types and scopes from .commitlintrc.json via JSON parse", async () => {
    writeFileSync(
      join(tmpDir, ".commitlintrc.json"),
      JSON.stringify({
        rules: {
          "type-enum": [2, "always", ["feat", "fix", "docs"]],
          "scope-enum": [2, "always", ["api", "ui"]],
          "header-max-length": [2, "always", 72],
        },
      })
    );

    const result = await detectCommitlintRules();
    expect(result?.types).toEqual(["feat", "fix", "docs"]);
    expect(result?.scopes).toEqual(["api", "ui"]);
    expect(result?.headerMaxLength).toBe(72);
  });

  it("parses .commitlintrc (no extension) as JSON", async () => {
    writeFileSync(
      join(tmpDir, ".commitlintrc"),
      JSON.stringify({
        rules: { "type-enum": [2, "always", ["feat", "fix"]] },
      })
    );
    const result = await detectCommitlintRules();
    expect(result?.types).toEqual(["feat", "fix"]);
  });

  it("skips rules with severity 0", async () => {
    writeFileSync(
      join(tmpDir, ".commitlintrc.json"),
      JSON.stringify({
        rules: {
          "type-enum": [0, "always", ["feat", "fix"]],
          "scope-enum": [2, "always", ["api"]],
        },
      })
    );
    const result = await detectCommitlintRules();
    expect(result?.types).toBeUndefined();
    expect(result?.scopes).toEqual(["api"]);
  });

  it("skips type-enum and scope-enum with 'never' applicability", async () => {
    writeFileSync(
      join(tmpDir, ".commitlintrc.json"),
      JSON.stringify({
        rules: {
          "type-enum": [2, "never", ["feat"]],
          "header-max-length": [2, "always", 100],
        },
      })
    );
    const result = await detectCommitlintRules();
    expect(result?.types).toBeUndefined();
    expect(result?.headerMaxLength).toBe(100);
  });

  it("omits subject-full-stop when applicability is not never", async () => {
    writeFileSync(
      join(tmpDir, ".commitlintrc.json"),
      JSON.stringify({
        rules: {
          "subject-full-stop": [2, "always", "."],
          "header-max-length": [2, "always", 72],
        },
      })
    );
    const result = await detectCommitlintRules();
    expect(result?.subjectFullStop).toBeUndefined();
    expect(result?.headerMaxLength).toBe(72);
  });

  it("omits type-case when applicability is never", async () => {
    writeFileSync(
      join(tmpDir, ".commitlintrc.json"),
      JSON.stringify({
        rules: {
          "type-case": [2, "never", "upper-case"],
          "header-max-length": [2, "always", 72],
        },
      })
    );
    const result = await detectCommitlintRules();
    expect(result?.typeCase).toBeUndefined();
    expect(result?.headerMaxLength).toBe(72);
  });

  it("parses .commitlintrc.yml without subprocess", async () => {
    writeFileSync(
      join(tmpDir, ".commitlintrc.yml"),
      `rules:
  type-enum: [2, "always", ["feat", "fix"]]
`
    );
    const result = await detectCommitlintRules();
    expect(result?.types).toEqual(["feat", "fix"]);
  });

  it("falls through when npx returns rules that map to empty CommitRules", async () => {
    vi.mocked(execFileSync).mockImplementation((file, args) => {
      if (
        file === "npx" &&
        Array.isArray(args) &&
        args.includes("commitlint") &&
        args.includes("--print-config")
      ) {
        return JSON.stringify({ rules: {} });
      }
      throw new Error("unexpected exec");
    });
    writeFileSync(
      join(tmpDir, ".commitlintrc.json"),
      JSON.stringify({
        rules: { "type-enum": [2, "always", ["feat"]] },
      })
    );
    const result = await detectCommitlintRules();
    expect(result?.types).toEqual(["feat"]);
  });

  it("uses npx --print-config output when available (strategy 1)", async () => {
    writeFileSync(join(tmpDir, "commitlint.config.mjs"), "export default { rules: {} };");

    vi.mocked(execFileSync).mockReturnValueOnce(
      JSON.stringify({
        rules: {
          "type-enum": [2, "always", ["feat", "fix", "chore"]],
          "scope-enum": [2, "always", ["cli", "api"]],
        },
      })
    );

    const result = await detectCommitlintRules();
    expect(result?.types).toEqual(["feat", "fix", "chore"]);
    expect(result?.scopes).toEqual(["cli", "api"]);
  });

  it("uses node --experimental-strip-types for commitlint.config.ts (strategy 2b)", async () => {
    writeFileSync(
      join(tmpDir, "commitlint.config.ts"),
      "export default { rules: {} };"
    );

    // First execFileSync call: npx --print-config → empty rules (falls through)
    // Second call: node --experimental-strip-types → success
    vi.mocked(execFileSync)
      .mockReturnValueOnce(JSON.stringify({ rules: {} }))
      .mockReturnValueOnce(
        JSON.stringify({
          rules: {
            "type-enum": [2, "always", ["feat", "fix", "ts-only"]],
          },
        })
      );

    const result = await detectCommitlintRules();
    expect(result?.types).toEqual(["feat", "fix", "ts-only"]);
  });

  it("falls back to npx tsx when node --experimental-strip-types fails for .ts config", async () => {
    writeFileSync(
      join(tmpDir, "commitlint.config.ts"),
      "export default { rules: {} };"
    );

    vi.mocked(execFileSync)
      .mockImplementationOnce(() => {
        throw new Error("npx print-config fail");
      }) // strategy 1 fails
      .mockImplementationOnce(() => {
        throw new Error("strip-types not available");
      }) // node --experimental-strip-types fails
      .mockReturnValueOnce(
        JSON.stringify({
          rules: {
            "type-enum": [2, "always", ["feat", "tsx-fallback"]],
          },
        })
      ); // npx tsx succeeds

    const result = await detectCommitlintRules();
    expect(result?.types).toEqual(["feat", "tsx-fallback"]);
  });

  it("returns undefined when all strategies fail for commitlint.config.ts", async () => {
    writeFileSync(
      join(tmpDir, "commitlint.config.ts"),
      "export default { rules: {} };"
    );

    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("all fail");
    });

    const result = await detectCommitlintRules();
    expect(result).toBeUndefined();
  });

  it("falls through to JSON parse when npx and node strategies fail", async () => {
    // Both subprocess strategies throw; JSON parse strategy uses real fs
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("subprocess fail");
    });

    writeFileSync(
      join(tmpDir, ".commitlintrc.json"),
      JSON.stringify({
        rules: { "type-enum": [2, "always", ["feat", "fix"]] },
      })
    );

    const result = await detectCommitlintRules();
    expect(result?.types).toEqual(["feat", "fix"]);
  });

  it("returns undefined silently when all strategies fail", async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("all fail");
    });
    writeFileSync(join(tmpDir, ".commitlintrc.json"), "INVALID JSON {{{{");

    const result = await detectCommitlintRules();
    expect(result).toBeUndefined();
  });

  it("maps all supported commitlint rule fields", async () => {
    writeFileSync(
      join(tmpDir, ".commitlintrc.json"),
      JSON.stringify({
        rules: {
          "type-enum": [2, "always", ["feat", "fix"]],
          "scope-enum": [2, "always", ["api"]],
          "header-max-length": [2, "always", 72],
          "subject-max-length": [2, "always", 50],
          "body-max-line-length": [2, "always", 100],
          "type-case": [2, "always", "lower-case"],
          "scope-case": [2, "always", "lower-case"],
          "subject-case": [2, "always", ["sentence-case", "start-case"]],
          "subject-full-stop": [2, "never", "."],
        },
      })
    );

    const result = await detectCommitlintRules();
    expect(result?.types).toEqual(["feat", "fix"]);
    expect(result?.scopes).toEqual(["api"]);
    expect(result?.headerMaxLength).toBe(72);
    expect(result?.subjectMaxLength).toBe(50);
    expect(result?.bodyMaxLineLength).toBe(100);
    expect(result?.typeCase).toBe("lower-case");
    expect(result?.scopeCase).toBe("lower-case");
    expect(result?.subjectCase).toEqual(["sentence-case", "start-case"]);
    expect(result?.subjectFullStop).toBe(".");
  });

  it("returns undefined without throwing when getGitRoot throws", async () => {
    vi.mocked(getGitRoot).mockImplementation(() => {
      throw new Error("not a git repo");
    });
    const result = await detectCommitlintRules();
    expect(result).toBeUndefined();
  });
});
