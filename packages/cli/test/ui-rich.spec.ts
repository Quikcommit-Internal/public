import { describe, it, expect } from "vitest";
import pc from "picocolors";
import {
  renderFileTree,
  renderBoxedCommit,
  renderStatsLine,
  splitCommitForBox,
  shouldUseRichOutput,
  stripAnsi,
} from "../src/ui-rich.js";

describe("renderFileTree", () => {
  it("renders 1 file with bottom connector only", () => {
    const out = renderFileTree(["src/x.ts"], 3);
    expect(out).toContain("└─ src/x.ts");
    expect(out).not.toContain("├─");
  });

  it("renders 3 files with proper connectors", () => {
    const out = renderFileTree(["a.ts", "b.ts", "c.ts"], 3);
    expect(out).toContain("├─ a.ts");
    expect(out).toContain("├─ b.ts");
    expect(out).toContain("└─ c.ts");
  });

  it("truncates to maxFiles and shows '+N more'", () => {
    const out = renderFileTree(["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"], 3);
    expect(out).toContain("├─ a.ts");
    expect(out).toContain("├─ b.ts");
    expect(out).toContain("├─ c.ts");
    expect(out).toContain("└─ +2 more files");
  });

  it("returns empty string for empty list", () => {
    expect(renderFileTree([], 3)).toBe("");
  });
});

describe("splitCommitForBox", () => {
  it("splits a header into type/scope/subject", () => {
    const result = splitCommitForBox("feat(auth): add oauth flow");
    expect(result.type).toBe("feat");
    expect(result.scope).toBe("auth");
    expect(result.subject).toBe("add oauth flow");
    expect(result.breaking).toBe(false);
  });

  it("handles missing scope", () => {
    const result = splitCommitForBox("docs: update readme");
    expect(result.type).toBe("docs");
    expect(result.scope).toBeNull();
    expect(result.subject).toBe("update readme");
    expect(result.breaking).toBe(false);
  });

  it("handles multi-scope", () => {
    const result = splitCommitForBox("fix(metrics,workers): convert durations");
    expect(result.scope).toBe("metrics,workers");
    expect(result.breaking).toBe(false);
  });

  it("returns subject only for non-conventional", () => {
    const result = splitCommitForBox("just some commit message");
    expect(result.type).toBeNull();
    expect(result.subject).toBe("just some commit message");
    expect(result.breaking).toBe(false);
  });

  it("detects breaking change without scope", () => {
    const result = splitCommitForBox("feat!: drop legacy api");
    expect(result.type).toBe("feat");
    expect(result.scope).toBeNull();
    expect(result.breaking).toBe(true);
    expect(result.subject).toBe("drop legacy api");
  });

  it("detects breaking change with scope", () => {
    const result = splitCommitForBox("feat(api)!: break clients");
    expect(result.type).toBe("feat");
    expect(result.scope).toBe("api");
    expect(result.breaking).toBe(true);
    expect(result.subject).toBe("break clients");
  });

  it("parses revert", () => {
    const result = splitCommitForBox("revert: undo thing");
    expect(result.type).toBe("revert");
    expect(result.subject).toBe("undo thing");
  });
});

describe("renderBoxedCommit", () => {
  it("wraps message in rounded box with default width 60", () => {
    const out = renderBoxedCommit("feat(x): test", "", { width: 60, isColor: false });
    expect(out).toContain("╭");
    expect(out).toContain("╮");
    expect(out).toContain("╰");
    expect(out).toContain("╯");
    expect(out).toContain("│");
  });

  it("includes body bullets when body present", () => {
    const out = renderBoxedCommit(
      "feat(x): test",
      "- first thing\n- second thing",
      { width: 60, isColor: false }
    );
    expect(out).toContain("first thing");
    expect(out).toContain("second thing");
  });

  it("falls back to plain output for narrow terminal", () => {
    const out = renderBoxedCommit("feat(x): test", "", { width: 30, isColor: false });
    expect(out).not.toContain("╭");
    expect(out).toContain("feat(x): test");
  });

  it("all inner lines have the same visible length as the top border", () => {
    const width = 80;
    const out = renderBoxedCommit(
      "feat(auth): add oauth login flow with provider support",
      "- Update config schema\n- Add redirect handler\n- Write integration tests",
      { width, isColor: false }
    );
    const boxLines = out.split("\n");
    const topLine = boxLines[0] ?? "";
    const topLen = stripAnsi(topLine).length;

    for (const line of boxLines) {
      const visLen = stripAnsi(line).length;
      expect(visLen).toBe(topLen);
    }
  });

  it("all inner lines have the same visible length as top border when isColor=true", () => {
    const width = 80;
    const out = renderBoxedCommit(
      "feat(auth): add oauth login",
      "- First bullet point",
      { width, isColor: true }
    );
    const boxLines = out.split("\n");
    const topLen = stripAnsi(boxLines[0] ?? "").length;

    for (const line of boxLines) {
      expect(stripAnsi(line).length).toBe(topLen);
    }
  });
});

describe("stripAnsi", () => {
  it("strips bold escape sequences from picocolors output", () => {
    const colored = pc.bold("hello");
    const stripped = stripAnsi(colored);
    expect(stripped).toBe("hello");
    expect(stripped.length).toBe(5);
  });

  it("strips cyan color from picocolors output", () => {
    const colored = pc.cyan("feat");
    const stripped = stripAnsi(colored);
    expect(stripped).toBe("feat");
    expect(stripped.length).toBe(4);
  });

  it("strips combined bold+cyan as produced in commit box header", () => {
    const colored = pc.bold(pc.cyan("feat")) + "(" + pc.bold(pc.yellow("auth")) + "): subject";
    const stripped = stripAnsi(colored);
    expect(stripped).toBe("feat(auth): subject");
    // "feat(auth): subject" has 19 visible characters
    expect(stripped.length).toBe(19);
  });

  it("leaves plain strings unchanged", () => {
    expect(stripAnsi("no colors here")).toBe("no colors here");
  });
});

describe("renderStatsLine", () => {
  it("formats counts with bullets", () => {
    const out = renderStatsLine({ files: 9, additions: 218, deletions: 34, tokens: 847 }, false);
    expect(out).toContain("9 files");
    expect(out).toContain("+218");
    expect(out).toContain("34");
    expect(out).toContain("847 tokens");
  });

  it("omits tokens when not provided", () => {
    const out = renderStatsLine({ files: 1, additions: 10, deletions: 0 }, false);
    expect(out).not.toContain("tokens");
  });
});

describe("shouldUseRichOutput", () => {
  it("returns false when not a TTY", () => {
    expect(
      shouldUseRichOutput({ isTTY: false, noColor: false, width: 100, style: "rich" })
    ).toBe(false);
  });

  it("returns false when style is compact", () => {
    expect(
      shouldUseRichOutput({ isTTY: true, noColor: false, width: 100, style: "compact" })
    ).toBe(false);
  });

  it("returns false when terminal too narrow", () => {
    expect(shouldUseRichOutput({ isTTY: true, noColor: false, width: 50, style: "rich" })).toBe(
      false
    );
  });

  it("returns true when conditions met", () => {
    expect(shouldUseRichOutput({ isTTY: true, noColor: false, width: 100, style: "rich" })).toBe(
      true
    );
  });
});
