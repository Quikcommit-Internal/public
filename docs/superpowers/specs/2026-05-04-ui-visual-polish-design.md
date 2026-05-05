# UI Visual Polish — Design

**Date:** 2026-05-04
**Status:** Approved
**Scope:** Comprehensive visual polish for the Quikcommit CLI: themed colors, per-stage spinners, box variants, type-aware coloring, file-extension highlighting, success flash animation, and adaptive light/dark detection.

---

## Vision

Make the Quikcommit CLI look as polished as the marketing demo on every commit. Today's output is functional but generic — same color for everything, single-purpose spinner, plain box. The user shouldn't have to think about config to get a delightful experience: defaults are vibrant and animated, with one-flag escape hatches for minimalists, CI environments, and accessibility.

## Architecture

```
Existing:
  ui.ts ─→ ui-rich.ts ─→ commit-helpers.ts (displayCommitMessage)
                            ↓
                    commands/commit.ts, local.ts, branch-guard.ts

Added:
  ui-theme.ts (NEW) ─→ ui.ts (extended) ─→ ui-rich.ts (variants) ─→ ...
```

**One new module:** `packages/cli/src/ui-theme.ts` holds the theme system: palettes, type→color mapping, adaptive light/dark detection.

**Extended modules:**
- `ui.ts` — color tokens expand from 4 to ~20; new `theme()` accessor
- `ui-rich.ts` — box style variants (rounded/gradient/double); per-stage spinner factory; success flash; type-aware coloring
- `commit-helpers.ts` — `displayCommitMessage` reads theme + box style from config

**Configuration extensions** in `.quikcommit.yml` and `~/.config/qc/config.json`:

```yaml
ui:
  theme: vibrant
  adaptive: true
  box:
    style: gradient
    auto_emphasis: true
    width: auto
  animate: tasteful
  spinner: per-stage
  type_colors: { feat: cyan, fix: red, ... }
```

---

## Theme System

### Three themes (each defines colors for the same semantic tokens)

#### `vibrant` (default)

| Token | Color |
|-------|-------|
| `step` (›) | dim cyan |
| `success` (✓) | bright green |
| `error` (✗) | bright red |
| `dim` | dim grey |
| `branchName` | bold magenta |
| `commitHash` | dim cyan |
| `boxBorder` | dim cyan |
| `boxBorderAccent` (gradient corners) | bright cyan |
| `bullet` (•) | bright green |
| `inlineCode` (`` ` ``) | bright magenta |
| `additions` (+N) | bright green |
| `deletions` (−N) | bright red |
| `tokens` count | dim |

**Type colors (vibrant):**

| Type | Color |
|------|-------|
| `feat` | bright cyan |
| `fix` | bright red |
| `perf` | bright magenta |
| `refactor` | yellow |
| `docs` | blue |
| `test` | green |
| `chore` | dim white |
| `ci` | dim cyan |
| `style` | dim magenta |

#### `muted`

Same token structure. All `bright` variants demoted to normal weight; `dim`s unchanged. Picocolors equivalents: `pc.cyan` instead of `pc.cyanBright`, etc. Suited for light terminal backgrounds or users preferring softer output.

#### `mono`

All colors collapse to `bold` / normal / `dim` white only. Used as automatic fallback for `NO_COLOR`, or chosen explicitly for accessibility / strict terminal environments.

### Adaptive light/dark detection

Read `COLORFGBG` env var (set by Terminal.app, iTerm2, GNOME Terminal, Konsole, etc.). Format: `<fg>;<bg>` or `<fg>;default;<bg>`.

- Background `0`/`1`/`8` (or low ANSI 256 codes) → **dark**
- Background `7`/`15` (or high ANSI 256 codes) → **light**
- Unset / unparseable → **unknown** (defaults to dark assumption)

When `ui.adaptive: true` AND background is **light**:
- `dim` token → dark grey instead of light grey
- `bright` colors → normal weight (bright magenta/cyan look harsh on white)
- Box border color → dim blue instead of dim cyan (better contrast)

### Theme module shape

```typescript
// packages/cli/src/ui-theme.ts
export type ThemeName = "vibrant" | "muted" | "mono";
export type Background = "light" | "dark" | "unknown";

type Colorizer = (text: string) => string;

export interface SpinnerColors {
  aiGenerate: Colorizer;
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
  additions: Colorizer;
  deletions: Colorizer;
  branchName: Colorizer;
  commitHash: Colorizer;
  boxBorder: Colorizer;
  boxBorderAccent: Colorizer;
  spinner: SpinnerColors;
  type: Record<string, Colorizer>;
}

export function getTheme(name: ThemeName, adaptive: boolean): Theme;
export function detectTerminalBackground(): Background;
export function resolveTheme(opts: {
  name?: ThemeName;
  adaptive?: boolean;
  noColor?: boolean;
}): Theme;
```

---

## Per-Stage Spinners

### Glyph + color per stage

| Stage | Glyph | Color (vibrant) | Frame interval |
|-------|-------|-----------------|----------------|
| AI commit generation | `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` (braille) | bright cyan | 80ms |
| Branch name generation (AI) | `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` (braille) | bright cyan | 80ms |
| Local provider (Ollama, etc.) | `◐◓◑◒` (orbit) | bright magenta | 100ms |
| Pushing to remote | `←↖↑↗→↘↓↙` (arrows) | bright blue | 90ms |
| Smart-diff analyzing | `▏▎▍▌▋▊▉▊▋▌▍▎` (bar pulse) | dim white | 70ms |

Color **cycles within the family** every 5 frames (e.g., AI spinner cycles cyan → bright cyan → light cyan → cyan). Subtle "alive" feel without changing identity.

### Spinner factory

```typescript
// in ui-rich.ts
export type SpinnerStage =
  | "aiGenerate"
  | "gitOp"
  | "localProvider"
  | "smartDiff"
  | "branchGen";

export interface SpinnerOptions {
  stage: SpinnerStage;
  message: string;
  theme: Theme;
  animate: "tasteful" | "full" | "none";
  isTTY: boolean;
  isColor: boolean;
}

export function createStageSpinner(opts: SpinnerOptions): Spinner;
```

Replaces the current generic `ui.spinner(message)`. Backward-compat shim keeps existing call sites working — `ui.spinner(msg)` defaults to `aiGenerate` stage with the active theme.

### Success flash animation

When `✓` prints on a successful commit / push / branch creation:
- Frame 1: bright green at full intensity
- After 200ms: cursor up + clear line + reprint at normal green
- Total animation: 200ms

Only fires when `ui.animate: tasteful` (default) or `full`. With `none`, prints once at normal green.

### Spinner stop transitions

| Outcome | Behavior |
|---------|----------|
| Success | Clear spinner line, print success line WITH flash |
| Error | Clear spinner line, print error line in red (no flash — errors shouldn't celebrate) |
| Cancellation (Ctrl+C) | Clear spinner line, no follow-up print |

### Disabled conditions

| Condition | Behavior |
|-----------|----------|
| `NO_COLOR` env | Theme forced to `mono`, spinner uses ASCII frames `[/-\\|]` |
| Non-TTY (piped output) | Spinner doesn't render; static "generating commit..." line only |
| `ui.animate: none` | Spinner runs without color cycling, no success flash |
| `--quiet` / `-q` | No spinner; only the final success line |
| Hook mode | Completely silent (existing behavior preserved) |

---

## Box System

### Variants

Selected via `ui.box.style` config. All variants render at the same width with the same content — only border characters and emphasis differ.

| Variant | Top corners | Sides | Use case |
|---------|-------------|-------|----------|
| `rounded` | `╭─╮ ╰─╯` | `│` | Standard, clean |
| `gradient` (default) | `╭─╮` with bright accent corners, dim sides | `│` (dim) | Adds focal points without overwhelming |
| `double` | `╔═╗ ╚═╝` | `║` | Reserved for "important" commits (auto-detected) |
| `none` | (no border) | (no sides) | Minimal mode; just indented content |

### Auto-promotion to `double`

Even when `ui.box.style` is `rounded` or `gradient`, the renderer auto-promotes to `double` when:

- Subject contains `BREAKING CHANGE`
- Type has `!` after it (e.g., `feat!: redesign API`)

Auto-promotion can be disabled via `ui.box.auto_emphasis: false`.

### Type-aware coloring inside the box

The header line uses `theme.type[<type>]` for the type token, `theme.boxBorderAccent` for the scope, and normal weight for the subject. Bullets in body use `theme.bullet`. Inline code (`` `text` ``) uses `theme.inlineCode`.

Example for `feat(insurance): replace text with dynamic logo images`:
```
╭──────────────────────────────────────────────────────────────────────────────╮
│  feat(insurance): replace text with dynamic logo images                      │
│  ↑↑↑↑ ↑↑↑↑↑↑↑↑↑                                                              │
│  cyan  yellow                                                                │
│                                                                              │
│  • Introduced `.env.example` for storing `PUBLIC_LOGO_API_KEY`               │
│   ↑                          ↑          ↑                ↑                   │
│   green                      magenta    magenta          magenta             │
╰──────────────────────────────────────────────────────────────────────────────╯
    2 files · +36 −3 · 2180 tokens
            ↑       ↑   ↑
            green  red   dim
```

For `fix(auth): handle expired session`:
```
│  fix(auth): handle expired session
│  ↑↑↑ ↑↑↑↑
│  red  yellow
```

For breaking change `feat(api)!: redesign user endpoints` (auto-promoted to double):
```
╔══════════════════════════════════════════════════════════════════════════════╗
║  feat(api)!: redesign user endpoints                                         ║
║  ↑↑↑↑ ↑↑↑   ↑                                                                ║
║  cyan  yellow  bright red exclamation                                        ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

## File Tree Coloring (Extension-Based)

In the file tree under the `staging working tree` step, the **last segment** of each path is colored by file extension. Path prefix stays dim.

| Extension | Color (vibrant) |
|-----------|----------------|
| `.ts`, `.mts` | cyan |
| `.tsx` | bright cyan |
| `.js`, `.mjs`, `.cjs` | yellow |
| `.jsx` | bright yellow |
| `.py` | blue |
| `.rs` | red |
| `.go` | bright cyan |
| `.css`, `.scss`, `.sass` | magenta |
| `.html` | bright red |
| `.md` | green |
| `.json`, `.yaml`, `.yml`, `.toml` | dim cyan |
| `.lock` | dim grey |
| Everything else | normal weight |

Example:
```
    ├─ src/components/ChatwootWidget.tsx     ← path dim, "ChatwootWidget.tsx" bright cyan
    ├─ src/hooks/useLogoPreferences.ts       ← path dim, "useLogoPreferences.ts" cyan
    └─ +6 more files                          ← all dim
```

---

## Stats Line Styling

```
    2 files · +36 −3 · 2180 tokens
   ↑       ↑  ↑   ↑   ↑           ↑
   dim    dim green red  dim     dim
```

Numbers in `+36` and `−3` colored (green/red); the rest stays dim. Consistent with `git diff --stat` colorization conventions.

---

## Configuration

### Full schema (`.quikcommit.yml` and `~/.config/qc/config.json`)

```yaml
ui:
  # Theme palette
  theme: vibrant            # vibrant (default) | muted | mono
  adaptive: true            # detect light/dark terminal background

  # Box appearance
  box:
    style: gradient         # rounded | gradient | double | none
    auto_emphasis: true     # auto-promote to double for breaking changes
    width: auto             # auto (terminal width capped at 80) | fixed number

  # Animations
  animate: tasteful         # tasteful (default) | full | none
  spinner: per-stage        # per-stage (default) | uniform

  # Type colors override (any subset; merged with theme defaults)
  type_colors:
    feat: cyan
    fix: red
```

### CLI flags (per-run overrides)

| Flag | Purpose |
|------|---------|
| `--no-color` | Force `theme: mono` for this run (existing) |
| `--no-animate` | Force `animate: none` for this run |
| `--style <name>` | Force `box.style` for this run |

Existing `--quiet` / `-q` / `--verbose` / `-v` continue to work.

### Resolution order (highest priority first)

1. CLI flags (`--no-color`, `--no-animate`, `--style`)
2. Environment variables (`NO_COLOR`, `FORCE_COLOR`, `COLORFGBG`)
3. Repo config (`.quikcommit.yml` → `ui.*`)
4. User config (`~/.config/qc/config.json` → `ui.*`)
5. Built-in defaults (`vibrant` / `gradient` / `tasteful` / `per-stage`)

---

## Integration

### Migration of existing call sites

Most colors come "for free" by routing through the new `theme` accessor:

| Current code | New code |
|--------------|----------|
| `pc.cyan(text)` | `theme.spinner.aiGenerate(text)` |
| `pc.green("✓")` | `theme.success("✓")` |
| Hardcoded box border color | `theme.boxBorder()` / `theme.boxBorderAccent()` |
| Hardcoded type color | `theme.type[parsedType]?.(text) ?? text` |
| `pc.bold(pc.cyan(type))` in `renderBoxedCommit` | `theme.type[type](text)` |

### Files modified

- `packages/cli/src/ui.ts` — extended with `theme` accessor
- `packages/cli/src/ui-rich.ts` — box variants, per-stage spinner factory, success flash, file-tree extension coloring
- `packages/cli/src/commit-helpers.ts` — `displayCommitMessage` reads theme/box config
- `packages/cli/src/commands/commit.ts` — uses stage-specific spinners
- `packages/cli/src/commands/branch.ts` — uses stage-specific spinners
- `packages/cli/src/branch-guard.ts` — uses stage-specific spinners
- `packages/cli/src/local.ts` — uses stage-specific spinners
- `packages/cli/src/config.ts` — `LocalConfig.ui` typed config surface
- `packages/shared/src/types.ts` — `UIConfig` interface

### Backward compatibility

- `ui.theme: mono` is functionally equivalent to `NO_COLOR=1` for the new tokens
- Existing `getUI()` and `ui.spinner(message)` continue to work (defaults to `aiGenerate` stage, vibrant theme)
- Existing tests pass without modification (theme is opt-in via config; defaults preserve current visual contract for assertions on output structure)

---

## Performance Budget

Total added latency from animations vs. current static output:

| Source | Cost |
|--------|------|
| Spinner color cycling | 0 (already running an interval) |
| Success flash | ~200ms one-time per ✓ |
| Type-aware coloring | ~0ms (string replacement at print time) |
| Box rendering with variants | ~1-2ms (border generation, can be cached per box) |
| Theme detection | ~1ms one-time at module load |

**Total per-commit overhead: ~200ms** (success flash). Well within tolerance.

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| `NO_COLOR=1` env | Theme forced to `mono`; ASCII spinner frames |
| `FORCE_COLOR=1` env | Theme forced ON regardless of TTY detection |
| `COLORFGBG` unset | Adaptive defaults to "dark" assumption |
| Terminal width < 60 | `box.style` falls back to `none` (compact mode) |
| Commit type not in `type_colors` map | Falls back to normal weight (no color) |
| User overrides invalid color name | Validation warns at config load; falls back to default |
| Non-TTY pipe (`qc -m \| pbcopy`) | Animations stripped; raw output to stdout |
| Hook mode (`--hook-mode`) | All visual chrome silent (existing behavior) |
| `ui.box.style: none` AND `--quiet` | Single line: just the success ✓ |

---

## Testing Strategy

| Test file | Coverage |
|-----------|----------|
| `test/ui-theme.spec.ts` (NEW) | Theme resolution from name + adaptive flag; type→color mapping for each theme; `detectTerminalBackground()` parsing of `COLORFGBG`; `mono` fallback; `type_colors` config override |
| `test/ui-rich.spec.ts` (extend) | Box variants render correctly (`rounded`/`gradient`/`double`/`none`); double auto-promotion for breaking changes (`!` after type, `BREAKING CHANGE` in body); file tree extension coloring; stats line additions/deletions colors |
| `test/spinner.spec.ts` (NEW) | Per-stage glyph selection; color cycling within frame intervals; `animate: none` disables cycling; non-TTY skips render; ASCII fallback for `NO_COLOR` |
| `test/commit-helpers.spec.ts` (extend) | `displayCommitMessage` reads theme + box config from passed options; type-aware colors applied; flash on success |
| Existing tests | Updated where they assert specific color codes — switch to theme tokens; structure assertions unchanged |

### Manual verification checklist

1. `qc` on a `feat` commit → cyan type, gradient box, success flash
2. `qc` on a `fix!:` (breaking change) → red type with bright red `!`, double-line box auto-applied
3. `qc -ap` on multiple files → tree shows extension colors, stats show green/red numbers
4. `qc --no-color` → all colors stripped, ASCII spinner frames
5. `qc --no-animate` → no spinner cycling, no success flash
6. `qc --style none` → no box, just indented content
7. Set `ui.theme: muted` in config → softer palette throughout
8. Run on light terminal (set `COLORFGBG=0;15`) → adaptive shifts colors
9. `qc -q` → minimal output, no spinner
10. `NO_COLOR=1 qc` → mono fallback applied automatically

---

## Implementation Priority

| # | Component | Effort |
|---|-----------|--------|
| 1 | `ui-theme.ts` module + 3 themes + adaptive detection | M |
| 2 | `ui.ts` extension to expose `theme` accessor | S |
| 3 | Per-stage spinner factory + color cycling | M |
| 4 | Success flash animation | S |
| 5 | Box variants (`gradient`, `double`, `none`) | M |
| 6 | Auto-promotion to `double` for breaking changes | S |
| 7 | File tree extension coloring | S |
| 8 | Stats line additions/deletions coloring | S |
| 9 | Config schema extension (`UIConfig`) | S |
| 10 | CLI flags (`--no-animate`, `--style`) | S |
| 11 | Migration of all call sites to theme accessor | M |
| 12 | Comprehensive tests (per matrix above) | M |

Recommended order: 1 → 2 → 9 → 11 (foundation) → 3 → 4 → 5 → 6 (visuals) → 7 → 8 (polish) → 10 → 12 (integration).

---

## Out of Scope

These are explicitly **not** part of this design (deferrable to future work):

- Type-in / fade-in / count-up animations (`ui.animate: full` reserves the slot but no implementation in this round)
- Custom theme files (e.g., `ui.theme: ./my-theme.json`) — reserved for future
- Per-file emoji icons in tree (project convention is no emoji)
- Sound feedback
- Streaming token-by-token AI output rendering
- Markdown link rendering in body text (only inline code is colorized)

These can be designed later as additive layers on top of this architecture.
