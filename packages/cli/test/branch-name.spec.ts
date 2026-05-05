import { describe, it, expect, vi } from "vitest";
import { sanitizeBranchName, ensureUniqueName, validateBranchName, deterministicBranchName, finalizeBranchName } from "../src/branch-name.js";

describe("validateBranchName", () => {
  it("accepts feat/oauth-flow", () => {
    expect(validateBranchName("feat/oauth-flow")).toBe(true);
  });

  it("rejects names without slash", () => {
    expect(validateBranchName("oauth-flow")).toBe(false);
  });

  it("rejects names with uppercase", () => {
    expect(validateBranchName("feat/OAuth")).toBe(false);
  });

  it("rejects names with main in slug", () => {
    expect(validateBranchName("feat/main-update")).toBe(false);
  });

  it("rejects names exceeding 60 chars", () => {
    expect(validateBranchName("feat/" + "a".repeat(60))).toBe(false);
  });

  it("accepts single-character slugs (feat/x)", () => {
    expect(validateBranchName("feat/x")).toBe(true);
  });

  it("accepts single-digit slugs (feat/0)", () => {
    expect(validateBranchName("feat/0")).toBe(true);
  });

  it("accepts name of exactly 60 chars", () => {
    // "refactor/" = 9 chars, + 51-char slug = 60 total
    expect(validateBranchName("refactor/" + "a".repeat(51))).toBe(true);
  });

  it("rejects refactor/ + 52 'a's (61 chars, exceeds max length)", () => {
    // refactor/(9) + 52 = 61 chars; fails the length > 60 guard
    expect(validateBranchName("refactor/" + "a".repeat(52))).toBe(false);
  });

  it("rejects feat/ + 56 'a's (61 chars) at regex level", () => {
    // feat/(5) + 56 = 61 chars; {0,51} limits feat slug to 52 chars max so this also fails regex
    expect(validateBranchName("feat/" + "a".repeat(56))).toBe(false);
  });
});

describe("sanitizeBranchName", () => {
  it("returns valid name unchanged", () => {
    expect(sanitizeBranchName("feat/oauth-flow")).toBe("feat/oauth-flow");
  });

  it("converts uppercase to lowercase", () => {
    expect(sanitizeBranchName("Feat/OAuth-Flow")).toBe("feat/oauth-flow");
  });

  it("replaces spaces with hyphens", () => {
    expect(sanitizeBranchName("feat/my new feature")).toBe("feat/my-new-feature");
  });

  it("strips disallowed special chars", () => {
    expect(sanitizeBranchName("feat/my@feature!")).toBe("feat/myfeature");
  });

  it("truncates to 60 chars", () => {
    const sanitized = sanitizeBranchName("feat/" + "a".repeat(100));
    expect(sanitized!.length).toBeLessThanOrEqual(60);
  });

  it("returns null for unsalvageable input", () => {
    expect(sanitizeBranchName("")).toBeNull();
    expect(sanitizeBranchName("///")).toBeNull();
  });
});

describe("deterministicBranchName", () => {
  it("derives a valid name from a file path", () => {
    const result = deterministicBranchName({ files: ["src/auth.ts"] });
    expect(validateBranchName(result.name)).toBe(true);
    expect(result.name).toMatch(/^[a-z]+\//);
  });

  it("returns feat/add-login for description 'add login'", () => {
    const result = deterministicBranchName({ description: "add login" });
    expect(result.type).toBe("feat");
    expect(result.name).toBe("feat/add-login");
    expect(validateBranchName(result.name)).toBe(true);
  });

  it("returns a valid fallback when files is empty and no description", () => {
    const result = deterministicBranchName({ files: [] });
    expect(validateBranchName(result.name)).toBe(true);
    expect(result.name).toMatch(/^chore\//);
  });

  it("always returns a result that passes validateBranchName", () => {
    const cases: Array<{ files?: string[]; description?: string }> = [
      { files: ["src/auth.ts"] },
      { description: "add login" },
      { files: [] },
      { description: "fix: broken tests" },
      { files: ["test/unit.spec.ts"] },
      { files: ["docs/readme.md"] },
      {},
    ];
    for (const opts of cases) {
      const result = deterministicBranchName(opts);
      expect(validateBranchName(result.name)).toBe(true);
    }
  });

  it("detects test type from spec file", () => {
    const result = deterministicBranchName({ files: ["src/auth.spec.ts"] });
    expect(result.type).toBe("test");
  });

  it("detects docs type from markdown file", () => {
    const result = deterministicBranchName({ files: ["docs/guide.md"] });
    expect(result.type).toBe("docs");
  });

  it("detects fix type from description", () => {
    const result = deterministicBranchName({ description: "fix broken login" });
    expect(result.type).toBe("fix");
  });

  it("result has name, type, and slug fields", () => {
    const result = deterministicBranchName({ description: "add oauth" });
    expect(result).toHaveProperty("name");
    expect(result).toHaveProperty("type");
    expect(result).toHaveProperty("slug");
  });

  // Specific input → specific type mappings (strong assertions)
  it("*.spec.ts files map to type 'test'", () => {
    const result = deterministicBranchName({ files: ["src/auth.spec.ts", "src/util.spec.ts"] });
    expect(result.type).toBe("test");
  });

  it("*.md files map to type 'docs'", () => {
    const result = deterministicBranchName({ files: ["README.md", "docs/guide.md"] });
    expect(result.type).toBe("docs");
  });

  it("description 'fix the bug' maps to type 'fix'", () => {
    const result = deterministicBranchName({ description: "fix the bug" });
    expect(result.type).toBe("fix");
  });

  it("description 'add new endpoint' maps to type 'feat'", () => {
    const result = deterministicBranchName({ description: "add new endpoint" });
    expect(result.type).toBe("feat");
  });
});

describe("ensureUniqueName", () => {
  it("returns the name when not taken", () => {
    const exists = vi.fn().mockReturnValue(false);
    expect(ensureUniqueName("feat/x", exists)).toBe("feat/x");
    expect(exists).toHaveBeenCalledWith("feat/x");
  });

  it("appends -2 when name taken", () => {
    const exists = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect(ensureUniqueName("feat/x", exists)).toBe("feat/x-2");
  });

  it("increments suffix until unique", () => {
    const exists = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    expect(ensureUniqueName("feat/x", exists)).toBe("feat/x-4");
  });

  it("gives up after 100 attempts", () => {
    const exists = vi.fn().mockReturnValue(true);
    expect(() => ensureUniqueName("feat/x", exists)).toThrow(/unique/);
  });
});

describe("finalizeBranchName", () => {
  it("returns the name unchanged when already valid and not taken", () => {
    const exists = vi.fn().mockReturnValue(false);
    expect(finalizeBranchName("feat/oauth-flow", exists)).toBe("feat/oauth-flow");
  });

  // Item D: skipUniqueness option
  it("skips ensureUniqueName when skipUniqueness=true", () => {
    // Even though exists returns true (name is taken), skipUniqueness skips the check.
    const exists = vi.fn().mockReturnValue(true);
    const result = finalizeBranchName("feat/oauth-flow", exists, { skipUniqueness: true });
    expect(result).toBe("feat/oauth-flow");
    // branchExists should NOT have been called
    expect(exists).not.toHaveBeenCalled();
  });

  it("still runs ensureUniqueName when skipUniqueness is false (default)", () => {
    const exists = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    const result = finalizeBranchName("feat/oauth-flow", exists);
    // ensureUniqueName was called and appended -2
    expect(result).toBe("feat/oauth-flow-2");
  });

  it("sanitizes an invalid name before uniqueness check", () => {
    const exists = vi.fn().mockReturnValue(false);
    // Upper-case + spaces → should be sanitized to "feat/oauth-flow"
    const result = finalizeBranchName("Feat/OAuth Flow", exists);
    expect(result).toBe("feat/oauth-flow");
    expect(validateBranchName(result)).toBe(true);
  });

  it("appends suffix when sanitized name is already taken", () => {
    const exists = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    const result = finalizeBranchName("feat/oauth-flow", exists);
    expect(result).toBe("feat/oauth-flow-2");
  });

  it("throws when the name cannot be salvaged", () => {
    const exists = vi.fn().mockReturnValue(false);
    // No slash, all special chars → sanitizeBranchName returns null
    expect(() => finalizeBranchName("///", exists)).toThrow(/could not sanitize/i);
  });
});
