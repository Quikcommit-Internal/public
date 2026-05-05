import pc from "picocolors";

export type ThemeName = "vibrant" | "muted" | "mono";
export type Background = "light" | "dark" | "unknown";

type Colorizer = (text: string) => string;

export interface SpinnerColors {
  aiGenerate: Colorizer;
  /** Branch naming spinners — distinct glyphs; same hue family as aiGenerate */
  branchGen: Colorizer;
  gitOp: Colorizer;
  localProvider: Colorizer;
  smartDiff: Colorizer;
}

export interface Theme {
  step: Colorizer;
  success: Colorizer;
  error: Colorizer;
  dim: Colorizer;
  bullet: Colorizer;
  inlineCode: Colorizer;
  /** Conventional-commit scope `(auth)` styling */
  scope: Colorizer;
  /** Semantic emphasis (formerly ad-hoc `pc.bold`) */
  strong: Colorizer;
  additions: Colorizer;
  deletions: Colorizer;
  branchName: Colorizer;
  commitHash: Colorizer;
  boxBorder: Colorizer;
  boxBorderAccent: Colorizer;
  spinner: SpinnerColors;
  type: Record<string, Colorizer>;
}

const identity: Colorizer = (s) => s;

function overlayTypeColors(
  base: Record<string, Colorizer>,
  custom?: Readonly<Record<string, string>>
): Record<string, Colorizer> {
  if (!custom || Object.keys(custom).length === 0) return { ...base };
  const next: Record<string, Colorizer> = { ...base };
  const pmap = pc as unknown as Record<string, unknown>;
  for (const [key, raw] of Object.entries(custom)) {
    const name = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (!name) continue;
    const fn = pmap[name];
    if (typeof fn === "function") {
      next[key] = fn as Colorizer;
    }
  }
  return next;
}

function buildVibrant(): Theme {
  return {
    step: pc.dim,
    success: pc.greenBright,
    error: pc.redBright,
    dim: pc.dim,
    bullet: pc.greenBright,
    inlineCode: pc.magentaBright,
    scope: (s) => pc.bold(pc.yellow(s)),
    strong: pc.bold,
    additions: pc.greenBright,
    deletions: pc.redBright,
    branchName: (s) => pc.bold(pc.magenta(s)),
    commitHash: pc.dim,
    boxBorder: pc.dim,
    boxBorderAccent: pc.cyanBright,
    spinner: {
      aiGenerate: pc.cyanBright,
      branchGen: pc.cyanBright,
      gitOp: pc.blueBright,
      localProvider: pc.magentaBright,
      smartDiff: pc.dim,
    },
    type: {
      feat: (s) => pc.bold(pc.cyanBright(s)),
      fix: (s) => pc.bold(pc.redBright(s)),
      perf: (s) => pc.bold(pc.magentaBright(s)),
      refactor: (s) => pc.bold(pc.yellow(s)),
      docs: (s) => pc.bold(pc.blue(s)),
      test: (s) => pc.bold(pc.green(s)),
      chore: (s) => pc.dim(pc.bold(pc.white(s))),
      ci: (s) => pc.dim(pc.bold(pc.cyan(s))),
      style: (s) => pc.dim(pc.bold(pc.magenta(s))),
    },
  };
}

function buildMuted(): Theme {
  return {
    step: pc.dim,
    success: pc.green,
    error: pc.red,
    dim: pc.dim,
    bullet: pc.green,
    inlineCode: pc.magenta,
    scope: (s) => pc.bold(pc.yellow(s)),
    strong: pc.bold,
    additions: pc.green,
    deletions: pc.red,
    branchName: (s) => pc.bold(pc.magenta(s)),
    commitHash: pc.dim,
    boxBorder: pc.dim,
    boxBorderAccent: pc.cyan,
    spinner: {
      aiGenerate: pc.cyan,
      branchGen: pc.cyan,
      gitOp: pc.blue,
      localProvider: pc.magenta,
      smartDiff: pc.dim,
    },
    type: {
      feat: (s) => pc.bold(pc.cyan(s)),
      fix: (s) => pc.bold(pc.red(s)),
      perf: (s) => pc.bold(pc.magenta(s)),
      refactor: (s) => pc.bold(pc.yellow(s)),
      docs: (s) => pc.bold(pc.blue(s)),
      test: (s) => pc.bold(pc.green(s)),
      chore: (s) => pc.dim(pc.bold(pc.white(s))),
      ci: (s) => pc.dim(pc.bold(pc.cyan(s))),
      style: (s) => pc.dim(pc.bold(pc.magenta(s))),
    },
  };
}

function buildMono(): Theme {
  const bold = pc.bold;
  const dim = pc.dim;
  return {
    step: dim,
    success: bold,
    error: bold,
    dim: dim,
    bullet: bold,
    inlineCode: bold,
    scope: bold,
    strong: bold,
    additions: bold,
    deletions: bold,
    branchName: bold,
    commitHash: dim,
    boxBorder: dim,
    boxBorderAccent: bold,
    spinner: {
      aiGenerate: identity,
      branchGen: identity,
      gitOp: identity,
      localProvider: identity,
      smartDiff: dim,
    },
    type: {
      feat: bold,
      fix: bold,
      perf: bold,
      refactor: bold,
      docs: bold,
      test: bold,
      chore: dim,
      ci: dim,
      style: dim,
    },
  };
}

function applyAdaptive(theme: Theme, bg: Background): Theme {
  if (bg !== "light") return theme;
  return {
    ...theme,
    boxBorder: pc.dim,
    boxBorderAccent: pc.blue,
    type: {
      ...theme.type,
      feat: (s) => theme.strong(pc.cyan(s)),
      fix: (s) => theme.strong(pc.red(s)),
      perf: (s) => theme.strong(pc.magenta(s)),
    },
  };
}

export function getTheme(name: ThemeName, adaptive: boolean): Theme {
  let base: Theme;
  if (name === "muted") base = buildMuted();
  else if (name === "mono") base = buildMono();
  else base = buildVibrant();
  if (!adaptive) return base;
  return applyAdaptive(base, detectTerminalBackground());
}

/**
 * Infer light/dark from `COLORFGBG`:
 * — classic 16-color indices (8–15 used as palette “bright” backgrounds),
 * — 216-color xterm cube (approx luminance),
 * — 232–255 grayscale ramp.
 */
export function detectTerminalBackground(): Background {
  const raw = process.env.COLORFGBG;
  if (!raw) return "unknown";
  const parts = raw.split(";").map((p) => p.trim());
  if (parts.length < 2) return "unknown";
  const last = parts[parts.length - 1];
  const n = parseInt(last, 10);
  if (!Number.isFinite(n)) return "unknown";

  if (n >= 232 && n <= 255) return n >= 244 ? "light" : "dark";

  if (n >= 16 && n <= 231) {
    const i = n - 16;
    const r = Math.floor(i / 36) / 5;
    const g = Math.floor((i % 36) / 6) / 5;
    const b = (i % 6) / 5;
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    return luminance >= 0.55 ? "light" : "dark";
  }

  if (n >= 8 && n <= 15) return "light";
  if (n >= 0 && n <= 7) return "dark";
  return "unknown";
}

export interface ResolveOpts {
  name?: ThemeName;
  adaptive?: boolean;
  noColor?: boolean;
  /** Map commit type keys to picocolors export names (`cyanBright`, `red`, …) */
  typeColors?: Readonly<Record<string, string>>;
}

export function resolveTheme(opts: ResolveOpts): Theme {
  if (opts.noColor) return getTheme("mono", false);
  const baseName = opts.name ?? "vibrant";
  const adaptive = opts.adaptive ?? true;
  let theme = getTheme(baseName, adaptive);
  if (opts.typeColors && Object.keys(opts.typeColors).length > 0) {
    theme = { ...theme, type: overlayTypeColors(theme.type, opts.typeColors) };
  }
  return theme;
}
