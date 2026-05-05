# Configuration

## Config File

Configuration is stored at `~/.config/qc/config.json`.

## Show Config

```bash
qc config
```

## Set Options

```bash
# Default model (e.g. qwen25-coder-32b, llama-3.3-70b)
qc config set model qwen25-coder-32b

# API URL (for self-hosted)
qc config set api_url https://api.example.com
```

## Reset

```bash
qc config reset
```

## Commit Rules

Commit rules (scopes, types, etc.) are read from your project's commitlint config. See [Team Standards](/features/team-standards) for org-level rules.

## CLI appearance (`ui`)

Optional `ui` block in `~/.config/qc/config.json` controls colors, boxed commit previews, and motion:

| Field | Purpose |
| --- | --- |
| `theme` | `vibrant` \| `muted` \| `mono` |
| `adaptive` | When true (default), light terminal backgrounds soften a few accents via `COLORFGBG`. |
| `animate` | `tasteful` \| `full` (faster spinners/flashes) \| `none`. |
| `spinner` | `per-stage` \| `uniform` — uniform uses one braille spinner style for every stage while keeping colors. |
| `type_colors` | Map commit-type keys (e.g. `"feat"`) to picocolors export names (`"cyanBright"`, `"blue"`, …). |
| `box` | `style`, `auto_emphasis`, `width` — see boxed commit output in interactive runs. |

**Programmatic use:** Helpers such as `displayCommitMessage()` only show the bordered “rich” layout when callers pass a full options object (`isTTY`, `style: "rich"`, `isColor`, etc.). Passing only a log object `{ step, success, error, dim }` is normalized to `{ log, isTTY: false }`, so scripts do not implicitly switch to boxed output just because stderr is a TTY; opt in explicitly.

The Vitest suite for `@quikcommit/cli` turns on `FORCE_COLOR` in `test/setup-env.ts` so snapshot-style assertions see ANSI; that does not affect other packages in the monorepo.
