import { describe, it, expect } from "vitest";
import pc from "picocolors";
import { stripAnsi, splitCommitForBox, wrapLine } from "../src/ui-layout.js";

describe("stripAnsi", () => {
  it("removes simple SGR color codes", () => {
    const colored = `\x1b[32mgreen\x1b[0m text`;
    expect(stripAnsi(colored)).toBe("green text");
  });

  it("removes bold and dim sequences", () => {
    const colored = `\x1b[1m\x1b[2mbold dim\x1b[0m`;
    expect(stripAnsi(colored)).toBe("bold dim");
  });

  it("leaves plain text unchanged", () => {
    expect(stripAnsi("no escapes here")).toBe("no escapes here");
  });
});

describe("splitCommitForBox", () => {
  it("parses type, scope, and subject", () => {
    expect(splitCommitForBox("feat(auth): add oauth flow")).toEqual({
      type: "feat",
      scope: "auth",
      subject: "add oauth flow",
      breaking: false,
    });
  });

  it("parses breaking change marker before colon", () => {
    expect(splitCommitForBox("feat!: drop legacy api")).toEqual({
      type: "feat",
      scope: null,
      subject: "drop legacy api",
      breaking: true,
    });
  });

  it("parses scoped breaking change", () => {
    expect(splitCommitForBox("fix(api)!: remove endpoint")).toEqual({
      type: "fix",
      scope: "api",
      subject: "remove endpoint",
      breaking: true,
    });
  });

  it("returns raw first line when header does not match conventional format", () => {
    expect(splitCommitForBox("just a freeform message")).toEqual({
      type: null,
      scope: null,
      subject: "just a freeform message",
      breaking: false,
    });
  });

  it("uses only the first line of a multi-line message", () => {
    expect(splitCommitForBox("docs: update readme\n\nBody paragraph")).toEqual({
      type: "docs",
      scope: null,
      subject: "update readme",
      breaking: false,
    });
  });
});

describe("wrapLine", () => {
  it("returns a single line when visible length is within width", () => {
    expect(wrapLine("short line", 40)).toEqual(["short line"]);
  });

  it("returns a single line when visible length equals width exactly", () => {
    const text = "x".repeat(20);
    expect(wrapLine(text, 20)).toEqual([text]);
  });

  it("wraps plain text at word boundaries", () => {
    const text = "alpha beta gamma delta epsilon zeta eta theta";
    const lines = wrapLine(text, 20);

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(stripAnsi(line).length).toBeLessThanOrEqual(20);
    }
    expect(lines.join(" ")).toContain("alpha");
    expect(lines.join(" ")).toContain("theta");
  });

  it("wraps using visible width when ANSI codes are present", () => {
    const colored = pc.green("bright green words that should wrap visually not by bytes");
    const lines = wrapLine(colored, 24);

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(stripAnsi(line).length).toBeLessThanOrEqual(24);
    }
    expect(stripAnsi(lines.join(""))).toContain("bright green words");
  });

  it("preserves ANSI styling across wrapped segments", () => {
    const colored = `${pc.cyan("type")}(${pc.yellow("scope")}): ${"subject ".repeat(8)}`;
    const lines = wrapLine(colored, 30);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toContain("\u001b[");
  });
});
