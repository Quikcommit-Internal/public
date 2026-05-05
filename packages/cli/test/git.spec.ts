import { describe, it, expect } from "vitest";
import { validateRef } from "../src/git.js";

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
