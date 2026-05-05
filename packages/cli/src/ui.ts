import { getConfig } from "./config.js";
import { resolveTheme, type Theme, type ThemeName } from "./ui-theme.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface UIOptions {
  isTTY: boolean;
  noColor: boolean;
  themeName?: ThemeName;
  adaptive?: boolean;
  /** Keys are commit types (e.g. `feat`), values picocolors names like `cyanBright` */
  typeColors?: Readonly<Record<string, string>>;
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
  accent(msg: string): string;
}

export interface UI {
  isColor: boolean;
  /** @deprecated — use theme tokens or log.* instead. @internal */
  format: UIFormat;
  /** @deprecated — use createStageSpinner from ui-rich.ts instead. */
  spinner(message: string, write?: (s: string) => void): Spinner;
  log: {
    step(msg: string): void;
    success(msg: string): void;
    error(msg: string): void;
    dim(msg: string): void;
  };
  theme: Theme;
}

export function hasCliNoColor(): boolean {
  try {
    return process.argv.slice(2).includes("--no-color");
  } catch {
    return false;
  }
}

/** Best-effort terminal width (columns) for layout. */
export function getTerminalWidth(): number {
  return process.stderr.columns ?? process.stdout.columns ?? 80;
}

export function createUI(options: UIOptions): UI {
  const isColor = options.isTTY && !options.noColor;
  const theme = resolveTheme({
    name: options.themeName,
    adaptive: options.adaptive,
    noColor: !isColor,
    typeColors: options.typeColors,
  });

  const format: UIFormat = {
    step: (msg) => (isColor ? `${theme.step("›")} ${theme.dim(msg)}` : `› ${msg}`),
    success: (msg) => (isColor ? `${theme.success("✓")} ${msg}` : `✓ ${msg}`),
    error: (msg) => (isColor ? `${theme.error("✗")} ${msg}` : `✗ ${msg}`),
    dim: (msg) => (isColor ? theme.dim(msg) : msg),
    bold: (msg) => (isColor ? theme.strong(msg) : msg),
    commitType: (t) =>
      isColor ? (theme.type[t] ?? theme.type.feat ?? ((s: string) => s))(t) : t,
    commitScope: (scope) => (isColor ? theme.scope(scope) : scope),
    accent: (msg) => (isColor ? theme.inlineCode(msg) : msg),
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
          write(`\r${format.step(message)} ${isColor ? theme.spinner.aiGenerate(f) : f}`);
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

  return { isColor, format, spinner: createSpinner, log, theme };
}

let _defaultUI: UI | undefined;

export function getUI(): UI {
  if (!_defaultUI) {
    const cfg = getConfig();
    _defaultUI = createUI({
      isTTY: !!process.stderr.isTTY,
      noColor: !!process.env.NO_COLOR || hasCliNoColor(),
      themeName: cfg.ui?.theme,
      adaptive: cfg.ui?.adaptive !== false,
      typeColors: cfg.ui?.type_colors,
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
