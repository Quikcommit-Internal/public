/**
 * ui-rich.ts — rich terminal output: spinners, flash success, UIContext.
 *
 * Layout/box-rendering helpers have been extracted to ui-layout.ts.
 * This file re-exports everything from ui-layout.ts for backward compatibility
 * so existing imports of `from "./ui-rich.js"` continue to work unchanged.
 */

import { getTerminalWidth as getTermWidth } from "./ui.js";
import type { Theme } from "./ui-theme.js";
import type { UI, Spinner } from "./ui.js";
import { stripAnsi } from "./ui-layout.js";

// Re-export layout helpers for backward compatibility
export {
  stripAnsi,
  splitCommitForBox,
  renderFileTree,
  renderStatsLine,
  renderBoxedCommit,
  shouldUseRichOutput,
  boxedLine,
  wrapLine,
  MIN_BOX_WIDTH,
  PADDING,
} from "./ui-layout.js";

export type {
  ParsedHeader,
  FileTreeOpts,
  StatsInput,
  BoxStyle,
  BoxOpts,
  RichDecisionOpts,
} from "./ui-layout.js";

export { getTermWidth as getTerminalWidth };

// ---------------------------------------------------------------------------
// UIContext — shared snapshot of UI state, eliminates repeated config threading
// ---------------------------------------------------------------------------

export interface UIContext {
  theme: Theme;
  animate: "tasteful" | "full" | "none";
  isTTY: boolean;
  isColor: boolean;
  asciiFallback: boolean;
  uniform: boolean;
}

export function buildUIContext(
  ui: UI,
  config: { ui?: { animate?: "tasteful" | "full" | "none"; spinner?: string } },
  args: { noAnimate?: boolean }
): UIContext {
  return {
    theme: ui.theme,
    animate: args.noAnimate ? "none" : (config.ui?.animate ?? "tasteful"),
    isTTY: !!process.stderr.isTTY,
    isColor: ui.isColor,
    asciiFallback: !ui.isColor,
    uniform: config.ui?.spinner === "uniform",
  };
}

// ---------------------------------------------------------------------------
// Stage spinner
// ---------------------------------------------------------------------------

export type SpinnerStage =
  | "aiGenerate"
  | "gitOp"
  | "localProvider"
  | "smartDiff"
  | "branchGen";

interface StageGlyphConfig {
  frames: string[];
  intervalMs: number;
  themeKey: keyof Theme["spinner"];
}

const STAGE_CONFIG: Record<SpinnerStage, StageGlyphConfig> = {
  aiGenerate: {
    frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
    intervalMs: 80,
    themeKey: "aiGenerate",
  },
  branchGen: {
    frames: ["◰", "◳", "◲", "◱"],
    intervalMs: 85,
    themeKey: "branchGen",
  },
  localProvider: {
    frames: ["◐", "◓", "◑", "◒"],
    intervalMs: 100,
    themeKey: "localProvider",
  },
  gitOp: {
    frames: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"],
    intervalMs: 90,
    themeKey: "gitOp",
  },
  smartDiff: {
    frames: ["▏", "▎", "▍", "▌", "▋", "▊", "▉", "▊", "▋", "▌", "▍", "▎"],
    intervalMs: 70,
    themeKey: "smartDiff",
  },
};

const ASCII_FRAMES = ["|", "/", "-", "\\"];

export interface SpinnerOptions {
  stage: SpinnerStage;
  message: string;
  theme: Theme;
  animate: "tasteful" | "full" | "none";
  isTTY: boolean;
  isColor: boolean;
  asciiFallback?: boolean;
  write?: (s: string) => void;
  /** When true, every stage uses the aiGenerate glyph set (`ui.spinner: uniform`). */
  uniform?: boolean;
}

export function createStageSpinner(opts: SpinnerOptions): Spinner {
  const origCfg = STAGE_CONFIG[opts.stage];
  const cfg = opts.uniform
    ? {
        frames: STAGE_CONFIG.aiGenerate.frames,
        intervalMs: STAGE_CONFIG.aiGenerate.intervalMs,
        themeKey: origCfg.themeKey,
      }
    : origCfg;

  const intervalMs = Math.max(16, Math.round(cfg.intervalMs * (opts.animate === "full" ? 0.55 : 1)));

  const frames = !opts.isColor && opts.asciiFallback ? ASCII_FRAMES : cfg.frames;
  const colorize =
    opts.isColor && opts.animate !== "none" ? opts.theme.spinner[cfg.themeKey] : (s: string) => s;
  const dim = opts.theme.dim;
  const write = opts.write ?? ((s: string) => process.stderr.write(s));

  let frame = 0;
  let interval: ReturnType<typeof setInterval> | null = null;

  return {
    start() {
      if (interval) return;
      if (!opts.isTTY) return;
      if (opts.animate === "none") return;
      interval = setInterval(() => {
        const f = frames[frame++ % frames.length];
        write(`\r${dim("›")} ${dim(opts.message)} ${colorize(f)}`);
      }, intervalMs);
    },
    stop(finalMessage?: string) {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      if (opts.isTTY) {
        write("\r\x1b[2K");
      }
      if (finalMessage) {
        write(finalMessage + "\n");
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Flash success
// ---------------------------------------------------------------------------

export interface FlashOptions {
  message: string;
  /** If set, this string (may include ANSI) is printed after animated flash settles */
  settledMessage?: string;
  theme: Theme;
  animate: "tasteful" | "full" | "none";
  isTTY: boolean;
  flashMs?: number;
  write?: (s: string) => void;
}

export async function flashSuccess(opts: FlashOptions): Promise<void> {
  const write = opts.write ?? ((s: string) => process.stderr.write(s));
  const animate = opts.animate !== "none" && opts.isTTY;
  const rawFallback = opts.settledMessage ?? opts.theme.success(opts.message);
  // Strip ANSI from the fallback when not animating (non-TTY / piped output)
  // to prevent color codes leaking into non-terminal consumers.
  const fallbackLine = animate ? rawFallback : stripAnsi(rawFallback);

  if (!animate) {
    write(fallbackLine + "\n");
    return;
  }

  // Write flash WITHOUT a trailing newline so the cursor stays on the same line.
  // After the delay we erase the current line and write the settled message.
  // This avoids cursor-up (\x1b[1A) which corrupts output when called in sequence.
  write(opts.theme.success(opts.message));
  await new Promise((r) => setTimeout(r, opts.flashMs ?? 200));
  write("\r\x1b[2K");
  write((opts.settledMessage ?? opts.message) + "\n");
}

