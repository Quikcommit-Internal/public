import { describe, it, expect } from "vitest";
import { isProtectedBranch, resolveProtectedBranches } from "../src/branch-detect.js";

describe("isProtectedBranch", () => {
  it("matches main against default list", () => {
    expect(isProtectedBranch("main", ["main", "master"])).toBe(true);
  });

  it("matches master", () => {
    expect(isProtectedBranch("master", ["main", "master"])).toBe(true);
  });

  it("does not match feature branches", () => {
    expect(isProtectedBranch("feat/oauth", ["main", "master"])).toBe(false);
  });

  it("matches glob pattern release/*", () => {
    expect(isProtectedBranch("release/v1.0", ["main", "release/*"])).toBe(true);
  });

  it("does not match unrelated path under release", () => {
    expect(isProtectedBranch("feat/release-notes", ["main", "release/*"])).toBe(false);
  });

  it("matches case-insensitively (Main vs main)", () => {
    expect(isProtectedBranch("Main", ["main"])).toBe(true);
  });

  it("matches MAIN (all-caps) against main", () => {
    expect(isProtectedBranch("MAIN", ["main"])).toBe(true);
  });

  it("matches Release/v1 against release/* (mixed case)", () => {
    expect(isProtectedBranch("Release/v1", ["release/*"])).toBe(true);
  });

  it("does not match FEAT/x against unrelated patterns", () => {
    expect(isProtectedBranch("FEAT/x", ["main"])).toBe(false);
  });

  it("returns false on empty list", () => {
    expect(isProtectedBranch("main", [])).toBe(false);
  });

  it("matches release/v1/x against release/** (double-star crosses slash)", () => {
    expect(isProtectedBranch("release/v1/x", ["release/**"])).toBe(true);
  });

  it("matches release/v1 against release/** (double-star works with single segment too)", () => {
    expect(isProtectedBranch("release/v1", ["release/**"])).toBe(true);
  });

  it("does NOT match release/v1/x against release/* (single * stops at slash)", () => {
    expect(isProtectedBranch("release/v1/x", ["release/*"])).toBe(false);
  });

  it("matches release/v1 against release/* (single segment, no slash)", () => {
    expect(isProtectedBranch("release/v1", ["release/*"])).toBe(true);
  });
});

describe("resolveProtectedBranches", () => {
  it("returns config list when provided", () => {
    const result = resolveProtectedBranches({
      configList: ["custom-main"],
      detectDefault: false,
      defaultBranch: null,
    });
    expect(result).toEqual(["custom-main"]);
  });

  it("returns hardcoded fallback when no config and no default", () => {
    const result = resolveProtectedBranches({
      configList: undefined,
      detectDefault: true,
      defaultBranch: null,
    });
    expect(result).toContain("main");
    expect(result).toContain("master");
    expect(result).toContain("develop");
    expect(result).toContain("trunk");
  });

  it("includes detected default branch when detectDefault is true", () => {
    const result = resolveProtectedBranches({
      configList: undefined,
      detectDefault: true,
      defaultBranch: "production",
    });
    expect(result).toContain("production");
  });

  it("does not include detected default when detectDefault is false", () => {
    const result = resolveProtectedBranches({
      configList: ["main"],
      detectDefault: false,
      defaultBranch: "production",
    });
    expect(result).not.toContain("production");
  });

  it("dedupes duplicates", () => {
    const result = resolveProtectedBranches({
      configList: ["main", "main"],
      detectDefault: true,
      defaultBranch: "main",
    });
    expect(result.filter((b) => b === "main").length).toBe(1);
  });
});
