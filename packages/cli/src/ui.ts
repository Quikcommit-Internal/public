import pc from "picocolors";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface UIOptions {
  isTTY: boolean;
  noColor: boolean;
}

export interface Spinner {
  start(): void;
  stop(finalMessage?: string): void;
}

interface UIFormat {
  step(msg: string): string;
  success(msg: string): string;
  error(msg: string): string;
  dim(msg: string): string;
  bold(msg: string): string;
  commitType(type: string): string;
  commitScope(scope: string): string;
}

export interface UI {
  isColor: boolean;
  format: UIFormat;
  spinner(message: string, write?: (s: string) => void): Spinner;
  log: {
    step(msg: string): void;
    success(msg: string): void;
    error(msg: string): void;
    dim(msg: string): void;
  };
}

export function hasCliNoColor(): boolean {
  try {
    return process.argv.slice(2).includes("--no-color");
  } catch {
    return false;
  }
}

export function createUI(options: UIOptions): UI {
  const isColor = options.isTTY && !options.noColor;

  const wrap = (fn: (s: string) => string) => (s: string) => (isColor ? fn(s) : s);

  const format: UIFormat = {
    step: (msg) => `${isColor ? pc.dim("›") : "›"} ${isColor ? pc.dim(msg) : msg}`,
    success: (msg) => `${isColor ? pc.green("✓") : "✓"} ${msg}`,
    error: (msg) => `${isColor ? pc.red("✗") : "✗"} ${msg}`,
    dim: wrap(pc.dim),
    bold: wrap(pc.bold),
    commitType: wrap(pc.cyan),
    commitScope: wrap(pc.yellow),
  };

  function createSpinner(
    message: string,
    write: (s: string) => void = (s) => process.stderr.write(s)
  ): Spinner {
    let frame = 0;
    let interval: ReturnType<typeof setInterval> | null = null;

    return {
      start() {
        if (interval) return;
        if (!options.isTTY) return;
        interval = setInterval(() => {
          const f = SPINNER_FRAMES[frame++ % SPINNER_FRAMES.length];
          write(`\r${format.step(message)} ${isColor ? pc.cyan(f) : f}`);
        }, 80);
      },
      stop(finalMessage?: string) {
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
        if (options.isTTY) {
          write("\r\x1b[2K");
        }
        if (finalMessage) {
          write(finalMessage + "\n");
        }
      },
    };
  }

  const log = {
    step: (msg: string) => process.stderr.write(format.step(msg) + "\n"),
    success: (msg: string) => process.stderr.write(format.success(msg) + "\n"),
    error: (msg: string) => process.stderr.write(format.error(msg) + "\n"),
    dim: (msg: string) => process.stderr.write(format.dim(msg) + "\n"),
  };

  return { isColor, format, spinner: createSpinner, log };
}

let _defaultUI: UI | undefined;

export function getUI(): UI {
  if (!_defaultUI) {
    _defaultUI = createUI({
      isTTY: !!process.stderr.isTTY,
      noColor: !!process.env.NO_COLOR || hasCliNoColor(),
    });
  }
  return _defaultUI;
}

/** Reset the cached default UI instance. Useful in tests to pick up env changes. */
export function resetUI(): void {
  _defaultUI = undefined;
}

/** @deprecated Use getUI() instead. Kept for backward compatibility. */
export const ui: UI = new Proxy({} as UI, {
  get(_target, prop) {
    return (getUI() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
