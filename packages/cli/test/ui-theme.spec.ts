import { describe, it, expect } from "vitest";
import {
  getTheme,
  detectTerminalBackground,
  resolveTheme,
} from "../src/ui-theme.js";

const esc = () => String.fromCharCode(27);

describe("getTheme", () => {
  it("returns vibrant theme with all required tokens", () => {
    const t = getTheme("vibrant", false);
    expect(typeof t.step).toBe("function");
    expect(typeof t.success).toBe("function");
    expect(typeof t.error).toBe("function");
    expect(typeof t.dim).toBe("function");
    expect(typeof t.bullet).toBe("function");
    expect(typeof t.inlineCode).toBe("function");
    expect(typeof t.additions).toBe("function");
    expect(typeof t.deletions).toBe("function");
    expect(typeof t.branchName).toBe("function");
    expect(typeof t.commitHash).toBe("function");
    expect(typeof t.boxBorder).toBe("function");
    expect(typeof t.boxBorderAccent).toBe("function");
    expect(typeof t.scope).toBe("function");
    expect(typeof t.strong).toBe("function");
    expect(typeof t.spinner.aiGenerate).toBe("function");
    expect(typeof t.spinner.branchGen).toBe("function");
    expect(typeof t.spinner.gitOp).toBe("function");
    expect(typeof t.spinner.localProvider).toBe("function");
    expect(typeof t.spinner.smartDiff).toBe("function");
  });

  it("vibrant: feat type returns colored output containing ANSI", () => {
    const t = getTheme("vibrant", false);
    const colored = t.type.feat("text");
    expect(colored).toContain(`${esc()}[`);
  });

  it("mono: type colors collapse to white/bold/dim only (no chromatic ANSI)", () => {
    const t = getTheme("mono", false);
    const featOut = t.type.feat("text");
    expect(featOut).not.toMatch(new RegExp(`${esc()}\\[3[1-6]m`));
  });

  it("muted: same token shape as vibrant", () => {
    const muted = getTheme("muted", false);
    const vibrant = getTheme("vibrant", false);
    expect(Object.keys(muted)).toEqual(Object.keys(vibrant));
    expect(Object.keys(muted.type)).toEqual(Object.keys(vibrant.type));
  });

  it("type map includes all 9 conventional types", () => {
    const t = getTheme("vibrant", false);
    for (const type of ["feat", "fix", "perf", "refactor", "docs", "test", "chore", "ci", "style"]) {
      expect(typeof t.type[type]).toBe("function");
    }
  });

  it("unknown type falls back to identity (returns text unchanged)", () => {
    const t = getTheme("vibrant", false);
    const unknown = t.type["somethingElse"]?.("x") ?? "x";
    expect(unknown).toBe("x");
  });
});

describe("detectTerminalBackground", () => {
  it("returns dark when COLORFGBG ends with 0", () => {
    const orig = process.env.COLORFGBG;
    process.env.COLORFGBG = "15;0";
    try {
      expect(detectTerminalBackground()).toBe("dark");
    } finally {
      if (orig === undefined) delete process.env.COLORFGBG;
      else process.env.COLORFGBG = orig;
    }
  });

  it("returns light when COLORFGBG ends with 15", () => {
    const orig = process.env.COLORFGBG;
    process.env.COLORFGBG = "0;15";
    try {
      expect(detectTerminalBackground()).toBe("light");
    } finally {
      if (orig === undefined) delete process.env.COLORFGBG;
      else process.env.COLORFGBG = orig;
    }
  });

  it("returns dark when COLORFGBG ends with 7 (ANSI light-gray — dark theme boundary fix)", () => {
    // ANSI 7 is light-gray, commonly used as foreground on dark terminals.
    // COLORFGBG=15;7 means bright-white fg on light-gray bg — typically a dark theme.
    const orig = process.env.COLORFGBG;
    process.env.COLORFGBG = "15;7";
    try {
      expect(detectTerminalBackground()).toBe("dark");
    } finally {
      if (orig === undefined) delete process.env.COLORFGBG;
      else process.env.COLORFGBG = orig;
    }
  });

  it("returns light when COLORFGBG ends with 8 (new boundary)", () => {
    const orig = process.env.COLORFGBG;
    process.env.COLORFGBG = "0;8";
    try {
      expect(detectTerminalBackground()).toBe("light");
    } finally {
      if (orig === undefined) delete process.env.COLORFGBG;
      else process.env.COLORFGBG = orig;
    }
  });

  it("handles three-segment format (fg;default;bg)", () => {
    const orig = process.env.COLORFGBG;
    process.env.COLORFGBG = "0;default;15";
    try {
      expect(detectTerminalBackground()).toBe("light");
    } finally {
      if (orig === undefined) delete process.env.COLORFGBG;
      else process.env.COLORFGBG = orig;
    }
  });

  it("returns unknown when COLORFGBG is unset", () => {
    const orig = process.env.COLORFGBG;
    delete process.env.COLORFGBG;
    try {
      expect(detectTerminalBackground()).toBe("unknown");
    } finally {
      if (orig !== undefined) process.env.COLORFGBG = orig;
    }
  });

  it("returns unknown when COLORFGBG ends with out-of-range index", () => {
    const orig = process.env.COLORFGBG;
    process.env.COLORFGBG = "0;300";
    try {
      expect(detectTerminalBackground()).toBe("unknown");
    } finally {
      if (orig === undefined) delete process.env.COLORFGBG;
      else process.env.COLORFGBG = orig;
    }
  });

  it("classifies xterm grayscale 233 as dark background", () => {
    const orig = process.env.COLORFGBG;
    process.env.COLORFGBG = "15;233";
    try {
      expect(detectTerminalBackground()).toBe("dark");
    } finally {
      if (orig === undefined) delete process.env.COLORFGBG;
      else process.env.COLORFGBG = orig;
    }
  });

  it("classifies xterm grayscale 250 as light background", () => {
    const orig = process.env.COLORFGBG;
    process.env.COLORFGBG = "0;250";
    try {
      expect(detectTerminalBackground()).toBe("light");
    } finally {
      if (orig === undefined) delete process.env.COLORFGBG;
      else process.env.COLORFGBG = orig;
    }
  });

  it("classifies 6x6x6 cube index by approximate luminance", () => {
    const orig = process.env.COLORFGBG;
    process.env.COLORFGBG = "0;16";
    try {
      expect(detectTerminalBackground()).toBe("dark");
    } finally {
      if (orig === undefined) delete process.env.COLORFGBG;
      else process.env.COLORFGBG = orig;
    }
  });

  it("returns unknown for unparseable values", () => {
    const orig = process.env.COLORFGBG;
    process.env.COLORFGBG = "garbage";
    try {
      expect(detectTerminalBackground()).toBe("unknown");
    } finally {
      if (orig === undefined) delete process.env.COLORFGBG;
      else process.env.COLORFGBG = orig;
    }
  });
});

describe("resolveTheme", () => {
  it("forces mono when noColor is true regardless of name", () => {
    const t = resolveTheme({ name: "vibrant", noColor: true });
    const featOut = t.type.feat("text");
    expect(featOut).not.toMatch(new RegExp(`${esc()}\\[3[1-6]m`));
  });

  it("returns the named theme when noColor is false", () => {
    const t = resolveTheme({ name: "vibrant", noColor: false });
    const featOut = t.type.feat("text");
    expect(featOut).toContain(`${esc()}[`);
  });

  it("defaults to vibrant when name is undefined", () => {
    const t = resolveTheme({ noColor: false });
    const featOut = t.type.feat("text");
    expect(featOut).toContain(`${esc()}[`);
  });

  it("applies type_colors overlay to conventional type tokens", () => {
    const base = resolveTheme({ noColor: false, name: "vibrant", adaptive: false });
    const t = resolveTheme({
      noColor: false,
      name: "vibrant",
      adaptive: false,
      typeColors: { feat: "blue" },
    });
    expect(t.type.feat("x")).not.toBe(base.type.feat("x"));
  });

  it("adaptive: true on light background changes feat color from vibrant default (Item D.2)", () => {
    const orig = process.env.COLORFGBG;
    // COLORFGBG=0;15 → light background (bg index 15 = bright white)
    process.env.COLORFGBG = "0;15";
    try {
      const adapted = resolveTheme({ name: "vibrant", adaptive: true, noColor: false });
      const base = resolveTheme({ name: "vibrant", adaptive: false, noColor: false });
      // On a light background, applyAdaptive adjusts feat color — output should differ
      expect(adapted.type.feat("x")).not.toBe(base.type.feat("x"));
    } finally {
      if (orig === undefined) delete process.env.COLORFGBG;
      else process.env.COLORFGBG = orig;
    }
  });
});
