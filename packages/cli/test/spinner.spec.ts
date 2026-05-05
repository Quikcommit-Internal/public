import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStageSpinner } from "../src/ui-rich.js";
import { getTheme } from "../src/ui-theme.js";

describe("createStageSpinner", () => {
  let writes: string[];
  let write: (s: string) => void;

  beforeEach(() => {
    writes = [];
    write = (s: string) => writes.push(s);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses quadrant glyphs for branchGen stage", () => {
    const theme = getTheme("vibrant", false);
    const sp = createStageSpinner({
      stage: "branchGen",
      message: "test",
      theme,
      animate: "tasteful",
      isTTY: true,
      isColor: false,
      write,
    });
    sp.start();
    vi.advanceTimersByTime(90);
    sp.stop();
    const combined = writes.join("");
    expect(combined).toMatch(/[◰◳◲◱]/);
    expect(combined).not.toMatch(/[⠋⠙]/);
  });

  it("uniform mode uses braille frames for non-ai stages", () => {
    const theme = getTheme("vibrant", false);
    const sp = createStageSpinner({
      stage: "localProvider",
      message: "test",
      theme,
      animate: "tasteful",
      isTTY: true,
      isColor: false,
      uniform: true,
      write,
    });
    sp.start();
    vi.advanceTimersByTime(85);
    sp.stop();
    const combined = writes.join("");
    expect(combined).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
    expect(combined).not.toMatch(/[◐◓]/);
  });

  it("animate full uses shorter interval than tasteful", () => {
    const theme = getTheme("vibrant", false);
    const spT = createStageSpinner({
      stage: "aiGenerate",
      message: "t",
      theme,
      animate: "tasteful",
      isTTY: true,
      isColor: false,
      write,
    });
    const spF = createStageSpinner({
      stage: "aiGenerate",
      message: "t",
      theme,
      animate: "full",
      isTTY: true,
      isColor: false,
      write,
    });
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    spT.start();
    spT.stop();
    const slow = setIntervalSpy.mock.calls[0][1] as number;
    setIntervalSpy.mockClear();
    spF.start();
    spF.stop();
    const fast = setIntervalSpy.mock.calls[0][1] as number;
    expect(fast).toBeLessThan(slow);
    setIntervalSpy.mockRestore();
  });

  it("uses braille glyphs for aiGenerate stage", () => {
    const theme = getTheme("vibrant", false);
    const sp = createStageSpinner({
      stage: "aiGenerate",
      message: "test",
      theme,
      animate: "tasteful",
      isTTY: true,
      isColor: false,
      write,
    });
    sp.start();
    vi.advanceTimersByTime(85);
    sp.stop();
    const combined = writes.join("");
    expect(combined).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
  });

  it("uses orbit glyphs for localProvider stage", () => {
    const theme = getTheme("vibrant", false);
    const sp = createStageSpinner({
      stage: "localProvider",
      message: "test",
      theme,
      animate: "tasteful",
      isTTY: true,
      isColor: false,
      write,
    });
    sp.start();
    vi.advanceTimersByTime(105);
    sp.stop();
    const combined = writes.join("");
    expect(combined).toMatch(/[◐◓◑◒]/);
  });

  it("uses arrow glyphs for gitOp stage", () => {
    const theme = getTheme("vibrant", false);
    const sp = createStageSpinner({
      stage: "gitOp",
      message: "test",
      theme,
      animate: "tasteful",
      isTTY: true,
      isColor: false,
      write,
    });
    sp.start();
    vi.advanceTimersByTime(95);
    sp.stop();
    const combined = writes.join("");
    expect(combined).toMatch(/[←↖↑↗→↘↓↙]/);
  });

  it("uses bar glyphs for smartDiff stage", () => {
    const theme = getTheme("vibrant", false);
    const sp = createStageSpinner({
      stage: "smartDiff",
      message: "test",
      theme,
      animate: "tasteful",
      isTTY: true,
      isColor: false,
      write,
    });
    sp.start();
    vi.advanceTimersByTime(75);
    sp.stop();
    const combined = writes.join("");
    expect(combined).toMatch(/[▏▎▍▌▋▊▉]/);
  });

  it("does not start when isTTY is false", () => {
    const theme = getTheme("vibrant", false);
    const sp = createStageSpinner({
      stage: "aiGenerate",
      message: "test",
      theme,
      animate: "tasteful",
      isTTY: false,
      isColor: true,
      write,
    });
    sp.start();
    vi.advanceTimersByTime(500);
    sp.stop();
    expect(writes.join("")).toBe("");
  });

  it("uses ASCII frames when isColor is false (NO_COLOR fallback)", () => {
    const theme = getTheme("mono", false);
    const sp = createStageSpinner({
      stage: "aiGenerate",
      message: "test",
      theme,
      animate: "tasteful",
      isTTY: true,
      isColor: false,
      asciiFallback: true,
      write,
    });
    sp.start();
    vi.advanceTimersByTime(85);
    sp.stop();
    const combined = writes.join("");
    expect(combined).toMatch(/[/\\\-|]/);
    expect(combined).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
  });

  it("idempotent start (calling twice creates only one interval)", () => {
    const theme = getTheme("vibrant", false);
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    const sp = createStageSpinner({
      stage: "aiGenerate",
      message: "test",
      theme,
      animate: "tasteful",
      isTTY: true,
      isColor: false,
      write,
    });
    sp.start();
    sp.start();
    sp.stop();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    setIntervalSpy.mockRestore();
  });

  it("stops cleanly without prior start", () => {
    const theme = getTheme("vibrant", false);
    const sp = createStageSpinner({
      stage: "aiGenerate",
      message: "test",
      theme,
      animate: "tasteful",
      isTTY: true,
      isColor: false,
      write,
    });
    expect(() => sp.stop()).not.toThrow();
  });
});
