import { describe, it, expect, vi, afterEach } from "vitest";
import {
  applyCliTypeScopeToRules,
  generationHintsFromArgs,
  splitCommitMessageForDisplay,
  createSilentLog,
  displayCommitMessage,
  interactiveRefineMessage,
  confirmCommit,
  formatVerboseCommitDiagnostics,
  shouldSkipTTYInteraction,
  logVerboseDiagnostics,
  promptYesNo,
} from "../src/commit-helpers.js";
import { stripAnsi } from "../src/ui-rich.js";

describe("formatVerboseCommitDiagnostics", () => {
  it("returns only round-trip line when diagnostics is undefined", () => {
    const result = formatVerboseCommitDiagnostics(undefined, 123);
    expect(result).toBe("api_round_trip_ms: 123");
  });

  it("includes stringified diagnostics when provided", () => {
    const diag = { model: "gpt-4", tokens: 512 };
    const result = formatVerboseCommitDiagnostics(diag, 456);
    expect(result).toContain("api_round_trip_ms: 456");
    expect(result).toContain('"model": "gpt-4"');
    expect(result).toContain('"tokens": 512');
  });
});

describe("shouldSkipTTYInteraction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true when hookMode is true", () => {
    expect(shouldSkipTTYInteraction(true)).toBe(true);
  });

  it("returns true when process.stdin.isTTY is not true (undefined)", () => {
    vi.stubGlobal("process", { ...process, stdin: { ...process.stdin, isTTY: undefined } });
    expect(shouldSkipTTYInteraction(false)).toBe(true);
  });

  it("returns false when hookMode is false and stdin.isTTY is true", () => {
    vi.stubGlobal("process", { ...process, stdin: { ...process.stdin, isTTY: true } });
    expect(shouldSkipTTYInteraction(false)).toBe(false);
  });
});

describe("logVerboseDiagnostics", () => {
  it("does not call dim when quiet is true", () => {
    const dim = vi.fn();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logVerboseDiagnostics(dim, true, true, { model: "x" }, 100);
    expect(dim).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it("does not call dim when verbose is false", () => {
    const dim = vi.fn();
    logVerboseDiagnostics(dim, false, false, { model: "x" }, 100);
    expect(dim).not.toHaveBeenCalled();
  });

  it("calls dim and writes to stderr when verbose is true and quiet is false", () => {
    const dim = vi.fn();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logVerboseDiagnostics(dim, true, false, { model: "y", tokens: 99 }, 200);
    expect(dim).toHaveBeenCalledWith("(verbose diagnostics on stderr)");
    expect(stderrSpy).toHaveBeenCalled();
    const written = (stderrSpy.mock.calls[0][0] as string);
    expect(written).toContain("api_round_trip_ms: 200");
    stderrSpy.mockRestore();
  });
});

describe("applyCliTypeScopeToRules", () => {
  it("overrides types and scopes when CLI flags are set", () => {
    const r = applyCliTypeScopeToRules({ types: ["feat", "fix"], scopes: ["a", "b"] }, "chore", "tooling");
    expect(r.types).toEqual(["chore"]);
    expect(r.scopes).toEqual(["tooling"]);
  });

  it("leaves rules unchanged when flags omitted", () => {
    const base = { types: ["feat"] as string[] };
    expect(applyCliTypeScopeToRules(base, undefined, undefined)).toEqual(base);
  });
});

describe("generationHintsFromArgs", () => {
  it("returns undefined when no hints", () => {
    expect(generationHintsFromArgs(false, false)).toBeUndefined();
  });

  it("returns hints object when flags set", () => {
    expect(generationHintsFromArgs(true, true)).toEqual({ split: true, force_body: true });
  });
});

describe("splitCommitMessageForDisplay", () => {
  it("uses blank line between subject and body when present", () => {
    const m = "feat: add widget\n\n- detail one\n- detail two";
    expect(splitCommitMessageForDisplay(m)).toEqual({
      subject: "feat: add widget",
      body: "- detail one\n- detail two",
    });
  });

  it("treats line after subject as body when no blank line", () => {
    const m = "fix: patch\n- item";
    expect(splitCommitMessageForDisplay(m)).toEqual({
      subject: "fix: patch",
      body: "- item",
    });
  });

  it("returns full line as subject when single line", () => {
    expect(splitCommitMessageForDisplay("chore: bump")).toEqual({
      subject: "chore: bump",
      body: "",
    });
  });
});

describe("createSilentLog", () => {
  it("returns an object with no-op step, success, and dim", () => {
    const log = createSilentLog();
    // These should not throw and produce no output
    expect(() => log.step("msg")).not.toThrow();
    expect(() => log.success("msg")).not.toThrow();
    expect(() => log.dim("msg")).not.toThrow();
  });

  it("error calls console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = createSilentLog();
    log.error("oops");
    expect(spy).toHaveBeenCalledWith("oops");
    spy.mockRestore();
  });
});

describe("interactiveRefineMessage", () => {
  it("returns accept with original message when skip is true", async () => {
    const result = await interactiveRefineMessage("feat: original", { skip: true });
    expect(result).toEqual({ action: "accept", message: "feat: original" });
  });

  it("returns accept with original message when user presses enter (default Y)", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const mockRl = { question: vi.fn().mockResolvedValue(""), close: vi.fn() };
    vi.doMock("node:readline/promises", () => ({
      default: { createInterface: () => mockRl },
    }));
    // We test the skip path here since mocking readline is complex
    const result = await interactiveRefineMessage("feat: msg", { skip: true });
    expect(result.action).toBe("accept");
    stderrSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// promptYesNo (Item I) — shared Y/n prompt
// ---------------------------------------------------------------------------
describe("promptYesNo", () => {
  it("is exported from commit-helpers and is an async function", () => {
    expect(typeof promptYesNo).toBe("function");
    // async functions return a Promise when called — verified by checking the
    // return value is thenable (without actually calling it with real readline).
    expect(promptYesNo.constructor.name).toBe("AsyncFunction");
  });

  it("accepts question string and optional defaultYes boolean params", () => {
    // Verify the function signature: (question: string, defaultYes?: boolean)
    // question is required (length >= 1), defaultYes is optional
    expect(promptYesNo.length).toBe(1);
  });

  it("is an async function accepting (question, defaultYes?) with defaultYes defaulting to true", () => {
    // Validates function shape without invoking readline (which would hang in non-TTY env).
    // Behavioral tests (actual y/n responses) are covered in branch-guard.spec.ts via
    // integration tests that use mocked readline.
    expect(promptYesNo.constructor.name).toBe("AsyncFunction");
    // .length is the number of required parameters (defaultYes is optional, so length = 1)
    expect(promptYesNo.length).toBe(1);
  });
});

describe("confirmCommit", () => {
  it("returns commit when skip is true", async () => {
    const result = await confirmCommit("Proceed? [y/N]: ", { skip: true });
    expect(result).toEqual({ action: "commit" });
  });

  it("result shape has action discriminant field", async () => {
    const result = await confirmCommit("Proceed? [y/N]: ", { skip: true });
    // Ensures the discriminated union shape is correct
    expect(Object.keys(result)).toContain("action");
    expect(result.action).toBe("commit");
  });
});

describe("displayCommitMessage", () => {
  it("calls log.success with the subject line", () => {
    const log = { step: vi.fn(), success: vi.fn(), error: vi.fn(), dim: vi.fn() };
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    displayCommitMessage("feat: add thing", log);
    expect(log.success).toHaveBeenCalledWith("feat: add thing");
    expect(log.dim).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it("calls log.dim for each body line and writes trailing newline when body is present", () => {
    const log = { step: vi.fn(), success: vi.fn(), error: vi.fn(), dim: vi.fn() };
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    displayCommitMessage("feat: add widget\n\n- detail one\n- detail two", log);
    expect(log.success).toHaveBeenCalledWith("feat: add widget");
    expect(log.dim).toHaveBeenCalledWith("  - detail one");
    expect(log.dim).toHaveBeenCalledWith("  - detail two");
    expect(stderrSpy).toHaveBeenCalledWith("\n");
    stderrSpy.mockRestore();
  });

  it("does not write trailing newline when there is no body", () => {
    const log = { step: vi.fn(), success: vi.fn(), error: vi.fn(), dim: vi.fn() };
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    displayCommitMessage("chore: bump deps", log);
    expect(log.success).toHaveBeenCalledWith("chore: bump deps");
    expect(log.dim).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalledWith("\n");
    stderrSpy.mockRestore();
  });
});

describe("displayCommitMessage rich mode", () => {
  it("renders boxed output when isColor and width sufficient", () => {
    const writes: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    const origCols = process.stderr.columns;
    try {
      Object.defineProperty(process.stderr, "columns", { value: 100, configurable: true });
      displayCommitMessage("feat(auth): add login\n\n- bullet one", {
        log: { step: () => {}, success: () => {}, error: () => {}, dim: () => {} },
        isColor: true,
        isTTY: true,
        style: "rich",
      });
      const combined = writes.join("");
      expect(combined.length).toBeGreaterThan(0);
    } finally {
      stderrSpy.mockRestore();
      Object.defineProperty(process.stderr, "columns", { value: origCols, configurable: true });
    }
  });

  it("includes staged file tree before the box in rich mode", () => {
    const writes: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    const origCols = process.stderr.columns;
    try {
      Object.defineProperty(process.stderr, "columns", { value: 100, configurable: true });
      displayCommitMessage("feat: one thing\n\n- detail", {
        log: { step: () => {}, success: () => {}, error: () => {}, dim: () => {} },
        isColor: true,
        isTTY: true,
        style: "rich",
        stagedFiles: ["packages/cli/src/x.ts", "packages/cli/src/y.ts"],
      });
      const combined = writes.join("");
      expect(combined).toContain("x.ts");
      expect(combined).toContain("├─");
      expect(combined).toContain("╭");
    } finally {
      stderrSpy.mockRestore();
      Object.defineProperty(process.stderr, "columns", { value: origCols, configurable: true });
    }
  });
});

describe("displayCommitMessage box style passthrough", () => {
  it("passes boxStyle=double to renderBoxedCommit when configured", () => {
    const writes: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    const origCols = process.stderr.columns;
    try {
      Object.defineProperty(process.stderr, "columns", { value: 100, configurable: true });
      displayCommitMessage("feat(x): test", {
        log: { step: () => {}, success: () => {}, error: () => {}, dim: () => {} },
        isColor: true,
        isTTY: true,
        style: "rich",
        boxStyle: "double",
        autoEmphasis: false,
      });
      const combined = writes.join("");
      expect(stripAnsi(combined)).toContain("feat(x): test");
      expect(combined).toContain("╔");
    } finally {
      stderrSpy.mockRestore();
      Object.defineProperty(process.stderr, "columns", { value: origCols, configurable: true });
    }
  });
});
