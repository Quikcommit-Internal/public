# Quikgit (`qg`) — Design Specification

Hard fork of LazyGit with a modern bubbletea/lipgloss TUI and integrated Quikcommit AI-powered git workflows.

## Decisions

- **Name**: Quikgit, binary `qg` (Quikgraph alias to be reassigned)
- **Approach**: Incremental rewrite — keep LazyGit's `pkg/commands/` git layer, replace `pkg/gui/` with bubbletea
- **TUI framework**: bubbletea + lipgloss + bubbles (replacing gocui/tcell)
- **Visual aesthetic**: Catppuccin Mocha (pastel dark) default, with Latte and Midnight built-in
- **Quikcommit integration**: Full suite — commit, PR, changelog, changeset
- **Backend communication**: Hybrid — read shared `~/.config/qc/` credentials, call Quikcommit API directly over HTTP from Go. Local providers (Ollama/LM Studio/OpenRouter) added in Phase 3
- **Scope model**: Core workflow MVP first, architect for full LazyGit feature parity
- **Platforms**: darwin/amd64, darwin/arm64, linux/amd64, linux/arm64, linux/arm, linux/386, windows/amd64, windows/386, freebsd/amd64
- **Distribution**: GitHub Releases
- **Relationship to upstream**: Hard fork, independent evolution

---

## Architecture

### Layer Diagram

```
┌─────────────────────────────────────────────────────┐
│                    qg (binary)                       │
├─────────────────────────────────────────────────────┤
│  pkg/tui/          ← NEW: bubbletea UI layer        │
│  ├── app.go        (root Model, Update, View)       │
│  ├── theme/        (catppuccin lipgloss styles)     │
│  ├── components/   (reusable bubbles: list, diff,   │
│  │                  input, modal, spinner, tabs)     │
│  ├── panels/       (files, branches, commits,       │
│  │                  stash, status, diff, staging)    │
│  ├── views/        (quikcommit: commit, pr,         │
│  │                  changelog, changeset)            │
│  └── layout/       (responsive panel arrangement)   │
├─────────────────────────────────────────────────────┤
│  pkg/quikcommit/   ← NEW: Quikcommit HTTP client    │
│  ├── client.go     (API calls: commit, pr, etc.)    │
│  ├── config.go     (read ~/.config/qc/*)            │
│  └── local.go      (Ollama/LM Studio/OpenRouter)    │
├─────────────────────────────────────────────────────┤
│  pkg/commands/     ← KEPT: LazyGit git operations    │
│  ├── git_commands/ (commit, branch, stash, etc.)    │
│  └── models/       (Commit, Branch, File, etc.)     │
├─────────────────────────────────────────────────────┤
│  pkg/config/       ← KEPT+EXTENDED: user config      │
│  pkg/i18n/         ← KEPT: translations              │
│  pkg/common/       ← KEPT: shared utilities          │
└─────────────────────────────────────────────────────┘
```

### What Gets Deleted

The entire `pkg/gui/` directory — controllers, helpers, contexts, views, editors, presentation, gocui integration, and boxlayout. Replaced by `pkg/tui/`.

The vendored gocui fork and `gookit/color` dependency are removed. Replaced by:
- `github.com/charmbracelet/bubbletea` — TUI framework (Elm architecture)
- `github.com/charmbracelet/lipgloss` — styling
- `github.com/charmbracelet/bubbles` — pre-built components

### What Gets Kept

- **`pkg/commands/`** — all git operations (pure functions, shell out to `git`, return model structs)
- **`pkg/commands/models/`** — `Commit`, `Branch`, `File`, `StashEntry`, `Remote`, `Tag`, `Worktree`, etc.
- **`pkg/config/`** — `UserConfig` struct, YAML parsing, defaults (extended with Quikgit-specific fields)
- **`pkg/i18n/`** — user-facing strings (extended for Quikcommit UI text)
- **`pkg/common/`** — `Common` struct (logger, i18n, config), utility functions
- **Build system** — goreleaser, Makefile, CI (all adapted for new project identity)

### Bubbletea Model Hierarchy

```
App (root model)
├── Layout (computes panel positions from terminal size)
├── StatusPanel
├── FilesPanel (staging, unstaging, file tree)
├── BranchesPanel (local, remote, tags — tabbed)
├── CommitsPanel (log, reflog — tabbed)
├── StashPanel
├── DiffViewport (main content area — scrollable)
├── QuikcommitModal (AI commit/PR/changelog flows)
└── CommandPalette (menus, confirmations, prompts)
```

### Repo Structure

```
quikgit/
├── main.go
├── pkg/
│   ├── app/           (simplified bootstrap)
│   ├── tui/           (NEW — all bubbletea UI)
│   │   ├── app.go
│   │   ├── theme/
│   │   ├── components/
│   │   ├── panels/
│   │   ├── views/
│   │   └── layout/
│   ├── quikcommit/    (NEW — API client)
│   ├── commands/      (KEPT — git operations)
│   ├── config/        (KEPT+EXTENDED)
│   ├── i18n/          (KEPT+EXTENDED)
│   └── common/        (KEPT)
├── .goreleaser.yml
├── Makefile
├── go.mod
└── README.md
```

---

## Theme System

### Semantic Color Tokens

The theme defines named semantic colors, not raw hex values. Swapping palettes means remapping the tokens.

```go
type Theme struct {
    // Surfaces
    Base     lipgloss.Color // background (#1e1e2e)
    Surface0 lipgloss.Color // panel backgrounds (#313244)
    Surface1 lipgloss.Color // elevated surfaces (#45475a)
    Surface2 lipgloss.Color // borders, dividers (#585b70)

    // Text
    Text    lipgloss.Color // primary (#cdd6f4)
    Subtext lipgloss.Color // secondary/muted (#a6adc8)
    Overlay lipgloss.Color // modal backdrop (#6c7086)

    // Accent colors (Catppuccin Mocha defaults)
    Green    lipgloss.Color // success, staged (#a6e3a1)
    Red      lipgloss.Color // errors, unstaged/deleted (#f38ba8)
    Yellow   lipgloss.Color // warnings, modified (#f9e2af)
    Blue     lipgloss.Color // info, selected (#89b4fa)
    Mauve    lipgloss.Color // active border, focus (#cba6f7)
    Peach    lipgloss.Color // commit hashes (#fab387)
    Teal     lipgloss.Color // branch names (#94e2d5)
    Pink     lipgloss.Color // Quikcommit AI accent (#f5c2e7)
    Lavender lipgloss.Color // tags (#b4befe)
    Flamingo lipgloss.Color // PR/changelog accent (#f2cdcd)
}
```

### Visual Differences from LazyGit

| Element | LazyGit | Quikgit |
|---------|---------|---------|
| Borders | Box-drawing chars (rounded/single/double) | Lipgloss rounded borders with padding |
| Panel focus | Green bold border | Mauve glow border |
| Selected line | Solid blue background | Subtle Surface1 bg + left accent bar |
| Diff rendering | Raw ANSI from git | Lipgloss-styled, Catppuccin syntax palette |
| Status bar | Plain text at bottom | Styled sections: branch, sync, QC usage, hints |
| Commit hash | Colored by push status | Peach monospace with NF icon |
| AI content | N/A | Pink border + sparkle (✦) indicator |
| Empty states | Blank panel | Centered muted placeholder text |

### Built-in Themes

1. **Catppuccin Mocha** — default, dark pastel
2. **Catppuccin Latte** — light mode
3. **Quikgit Midnight** — darker, higher contrast (Macchiato base)

### Configuration

```yaml
# ~/.config/qg/config.yml
gui:
  theme: "catppuccin-mocha"
  customTheme:
    base: "#1e1e2e"
    accent: "#cba6f7"
    # full override map
  border: "rounded"
  nerdFontsVersion: "3"
  sidePanelWidth: 0.35
```

Config at `~/.config/qg/` — separate from LazyGit (`~/.config/lazygit/`) and Quikcommit (`~/.config/qc/`). Quikcommit credentials read from `~/.config/qc/` directly.

---

## Quikcommit Integration

### `pkg/quikcommit/` Package

**Config reader** (`config.go`):
- API key from `~/.config/qc/credentials`
- Local config from `~/.config/qc/config.json` (`provider`, `apiUrl`, `model`)
- Mode detection: API key → SaaS; provider configured → local; neither → prompt to `qc login`

**API client** (`client.go`):
- `GenerateCommit(diff, changes string, rules *CommitRules, model string) → (string, Diagnostics, error)`
- `GeneratePR(commits []string, diffStat, baseBranch, currentBranch, prTemplate string, rules *CommitRules, model string) → (title, body string, error)`
- `GenerateChangelog(commitsByType map[string][]string, fromTag, toRef, model string) → (string, error)`
- `GenerateChangeset(diff string, packages, commits []string, model string) → ([]PackageBump, string, error)`
- `GetUsage() → (Usage, error)`
- Auth: `Authorization: Bearer <apiKey>` header, JSON request/response

**Local providers** (`local.go`):
- Ollama: `POST localhost:11434/api/generate`
- LM Studio: `POST localhost:1234/v1/chat/completions` (OpenAI format)
- OpenRouter: `POST openrouter.ai/api/v1/chat/completions`
- Custom: `POST {apiUrl}/chat/completions`
- Simplified commit prompt matching CLI's `buildUserPrompt()`

### AI Commit Flow

User presses `c` with staged changes:

1. Gather diff (`git diff --cached`) and file list (`git diff --cached --name-only`)
2. Optionally read `.commitlintrc` for rules
3. Show loading modal with spinner, model name, plan usage
4. API returns → transition to editor modal:

```
┌─ ✦ Quikcommit ─────────────────────────────┐
│                                              │
│  feat(cli): add interactive staging mode     │
│                                              │
│  - Implement file tree navigation            │
│  - Add keyboard shortcuts for stage/unstage  │
│  - Support bulk operations on directories    │
│                                              │
│  ─────────────────────────────────────────── │
│  [Enter] commit  [e] edit  [r] regenerate    │
│  [m] model  [Tab] edit description  [Esc]    │
└──────────────────────────────────────────────┘
```

Actions:
- **Enter** — commit as-is (`git commit -m summary -m body`)
- **e** — edit message in text input before committing
- **r** — regenerate (call API again)
- **m** — pick different model from plan-available models
- **Tab** — switch focus between summary and body
- **Esc** — cancel, return to files panel

Manual commit (`C` / shift-c) preserves LazyGit's traditional blank-input flow.

### PR Flow

Keybinding `P` from branches panel or Quikcommit submenu:

1. Gather: `git log main..HEAD --oneline`, `git diff --stat main..HEAD`, `.github/PULL_REQUEST_TEMPLATE.md`, current branch
2. Show modal with generated title + body
3. Actions: **Enter** copy to clipboard, **g** open `gh pr create` with pre-filled content, **e** edit, **r** regenerate

### Changelog Flow

From Quikcommit menu (`q` → submenu):

1. Select tag range (tag picker or manual input)
2. Gather commits grouped by conventional commit type
3. Show generated changelog in viewport
4. Actions: **Enter** copy, **e** edit, **r** regenerate, **s** save to CHANGELOG.md

### Changeset Flow

From Quikcommit menu:

1. Read staged diff + workspace package list
2. Show per-package bump recommendations
3. User confirms/adjusts each package
4. Writes changeset file to `.changeset/`

### Error States

- **No auth**: "Run `qc login` to authenticate, or configure a local provider"
- **Rate limited**: "Rate limit reached. Resets in Xm Ys."
- **Plan limit**: "Monthly limit reached. Upgrade at app.quikcommit.dev"
- **Network error**: "Could not reach Quikcommit API." with retry
- **Local provider down**: "Ollama not reachable at localhost:11434."

---

## Panel Layout

### Normal Mode (width > 100)

```
┌──────────┬──────────────────────────────────┐
│ Status   │                                  │
├──────────┤         Diff / Main              │
│ Files    │         Viewport                 │
├──────────┤                                  │
│ Branches │                                  │
├──────────┤                                  │
│ Commits  │                                  │
├──────────┤                                  │
│ Stash    │                                  │
├──────────┴──────────────────────────────────┤
│ ● main ↑2  ·  qc: pro (487 left)  · ?help  │
└─────────────────────────────────────────────┘
```

### Portrait Mode (width <= 100 or height > 2*width)

```
┌──────────┬──────────┬──────────┬────────────┐
│ Files    │ Branches │ Commits  │ Stash      │
├──────────┴──────────┴──────────┴────────────┤
│                                              │
│              Diff / Main Viewport            │
│                                              │
├──────────────────────────────────────────────┤
│ ● main ↑2  ·  qc: pro (487 left)  · ?help  │
└──────────────────────────────────────────────┘
```

### Side Panels

- **Status**: repo name, branch + sync indicator, working tree state
- **Files**: tree view with collapse/expand (`▶`/`▼`), status indicators (`M`/`A`/`?`), NF file icons, mauve left-accent selection
- **Branches** (tabbed — Local | Remote | Tags): teal names, `●` current, divergence indicators, recency
- **Commits** (tabbed — Log | Reflog): graph gutter, peach hash, truncated message, author initials, relative date
- **Stash**: index, message, muted date

### Main Viewport

Bubbles `viewport` with content-type rendering:
- **Diff**: Catppuccin syntax — green tint additions, red tint deletions, muted line numbers, bold file headers
- **Commit detail**: hash, author, date, full message, diff below
- **Staging**: interactive line/hunk selection
- **Merge conflict**: ours/theirs markers

### Status Bar

Single row, lipgloss-styled sections:
- Left: branch + sync (teal)
- Center: working tree summary
- Center-right: Quikcommit plan/usage (pink or grey)
- Right: context-sensitive keybinding hints (subtext)

### Modal System

Centered overlay with backdrop contrast reduction. Used for: Quikcommit AI flows, confirmations, menus, text input, error alerts. Quikcommit modals get pink border + `✦` indicator.

---

## Phasing

### Phase 1 — Foundation (MVP)

Build:
- `pkg/tui/` scaffold: root App model, layout engine, Catppuccin Mocha theme
- Side panels: files, branches, commits, stash, status (read-only list views wired to `pkg/commands/`)
- Components: diff viewport, text input, modal, spinner, tabs
- Quikcommit commit modal (the `c` → AI generate → edit → commit flow)
- `pkg/quikcommit/`: API client, config reader (SaaS mode)
- Basic keybindings: navigate, scroll, stage/unstage, commit (AI + manual), push
- Status bar with branch info + Quikcommit usage
- Goreleaser build producing `qg`

LazyGit code changes:
- `main.go` — rewrite entry to boot bubbletea
- `pkg/gui/` — deleted entirely
- `pkg/app/` — simplified bootstrap
- `pkg/config/` — extended
- `pkg/commands/` — untouched
- `go.mod` — add charm deps, remove gocui/gookit

Deferred: interactive rebase, patch building, merge conflicts, cherry-pick, bisect, worktrees, submodules, custom commands, local AI providers.

### Phase 2 — Interactive Git

- Interactive staging (line-by-line, hunk-by-hunk)
- Merge conflict resolution
- Interactive rebase (reorder, squash, fixup, drop, edit)
- Cherry-pick
- Branch management (create, delete, rename, checkout, merge, rebase onto)
- Stash operations (pop, apply, drop, create with message)
- Remote operations (fetch, pull, push with force/upstream)
- Search/filter mode

### Phase 3 — Quikcommit Suite

- PR generation modal + `gh` integration
- Changelog generation with tag picker
- Changeset generation for monorepos
- Local provider support (Ollama, LM Studio, OpenRouter)
- Model picker with plan-aware filtering
- Commitlint rule detection and injection

### Phase 4 — Advanced Git & Polish

- Worktrees, submodules
- Bisect
- Patch building
- Custom commands (ported from LazyGit config)
- Additional themes (Latte, Midnight) + custom theme support
- Command palette / fuzzy finder
- Config hot-reload

---

## Technical Risks

| Risk | Mitigation |
|------|------------|
| `pkg/commands/` implicit coupling to `pkg/gui/` types | Audit interface boundary early; adapter types in `pkg/tui/` if needed |
| LazyGit's `Common` struct threading | Keep it — bubbletea models receive `Common` via constructor |
| Interactive staging needs gocui `TextArea` replacement | Bubbles `textarea` + custom hunk parser; Phase 2 |
| Diff rendering performance with large diffs | Viewport with lazy rendering; style only visible lines |
| Goreleaser references LazyGit branding | Update project name, binary name, repo URL |

---

## Key Dependencies

| Package | Role |
|---------|------|
| `github.com/charmbracelet/bubbletea` | TUI framework (Elm architecture) |
| `github.com/charmbracelet/lipgloss` | Styling (colors, borders, padding, layout) |
| `github.com/charmbracelet/bubbles` | Pre-built components (viewport, textinput, list, spinner, table, progress) |
| `pkg/commands/` (kept from LazyGit) | All git operations via subprocess |
| `pkg/commands/models/` (kept) | Commit, Branch, File, StashEntry, Remote, Tag, Worktree |
| `net/http` (stdlib) | Quikcommit API client |

## Quikcommit API Surface Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/commit` | POST | Generate commit message from diff |
| `/v1/pr` | POST | Generate PR title + body |
| `/v1/changelog` | POST | Generate changelog entry |
| `/v1/changeset` | POST | Generate monorepo changeset |
| `/v1/usage` | GET | Plan info + remaining usage |
| `/v1/team/rules` | GET | Team commitlint rules |

Auth: `Authorization: Bearer <key>` from `~/.config/qc/credentials`.
