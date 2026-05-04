# Quikcommit Evolution: Git Workflow Intelligence Platform

**Date:** 2026-05-03
**Status:** Approved
**Scope:** 10 features across acquisition, retention, and differentiation

---

## Vision

Quikcommit evolves from a commit message generator into a full git workflow intelligence platform. Every interaction with git (stage, commit, push, PR, review, release) has an AI-powered enhancement. Competitors stop at commit messages — Quikcommit owns the lifecycle.

## Architecture

```
Existing:
  qc (CLI) → api-gateway → ai-worker → commit/PR/changelog/changeset

New surfaces:
  qc (CLI, enhanced)  ─┐
  VS Code extension    ─┼→ api-gateway → ai-worker (expanded capabilities)
  GitHub Action/Bot    ─┘         ↕
                              D1 (preferences, history, team analytics)
```

## Feature Tiers

| Tier | Current | Added |
|------|---------|-------|
| Free (local) | commit messages | + PR/changelog/changeset via local provider, smart diff |
| Free (SaaS) | 50 commits/mo | + commit history context, interactive mode, branch summary |
| Pro | PR, changelog, changeset | + learning from edits, multi-commit split, `qc release`, scope creep, PR readiness |
| Team | shared rules, team dashboard | + GitHub bot, branch rewrite, team analytics, cross-repo consistency |
| Scale | metered | + custom model selection, release automation hooks |

## Design Principles

1. **CLI-first, surface-agnostic** — every feature works in the terminal first. Extensions/bots are thin clients calling the same API.
2. **Local-capable, cloud-enhanced** — core features work offline. Cloud adds learning, team sync, and analytics.
3. **Progressive disclosure** — `qc` with no flags does the right thing. Power features are opt-in.
4. **Zero-config smart defaults** — auto-detect monorepos, commitlint, PR templates, lock files. Never require configuration that can be inferred.

---

## Feature 1: CLI Visual Experience

### Current State

- Zero styling dependencies. No colors, no spinners, no progress.
- During commit generation: terminal hangs silently for 1-3 seconds.
- All output is plain monochrome text.

### Proposed Output

```
$ qc -p
› staging working tree (4 files)...
  src/auth/device.ts, src/routes/auth.ts, +2
› generating commit (kimi-k2.6)... ⠸
✓ feat(auth): add OAuth2 device flow with 5-min polling window

  Implements RFC 8628 device authorization grant for the CLI
  sign-in experience with cryptographic code generation.

› [main 7c3f82e] committed
› pushing to origin/main...
✓ pushed 1 commit · 4 files, +218 −12
```

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Color library | `picocolors` | No deps, 1KB, 2x faster than chalk, bundles cleanly with esbuild |
| Spinner | Hand-rolled (extend login.ts pattern) | Avoid ora's deps; reuse proven pattern |
| Output routing | All visual chrome → stderr; data → stdout | Preserves `qc --message-only | pbcopy` piping |
| Disable when | `NO_COLOR` env, `--no-color` flag, non-TTY | Follows no-color.org standard |
| Hook mode | Completely silent | Git hooks must not pollute terminal |

### Output Stages

| Stage | Output | Trigger |
|-------|--------|---------|
| Stage | `› staging working tree (N files)...` + file list | `--all` / `-a` flag |
| Detect | `› using team rules` / `› commitlint: conventional` | Rules detected |
| Generate | `› generating commit (model)... ⠸` (spinner) | API call starts |
| Result | `✓ type(scope): subject` (green check, colored type/scope) | API returns |
| Body | Indented body lines (dim) | If body present |
| Commit | `› [branch hash] committed` | git commit succeeds |
| Push | `› pushing to origin/branch...` | `--push` flag |
| Done | `✓ pushed N commit(s) · N files, +X −Y` | Push succeeds |

### Error States

```
✗ Not authenticated. Run `qc login` first.
✗ No staged changes. Use `qc -a` to stage tracked files.
✗ Generation failed: context window exceeded. Try `qc --exclude "*.lock"`
```

### Verbosity Levels

- Default: as shown above (concise progress + result)
- `--verbose` / `-v`: adds token usage, model info, latency
- `--quiet` / `-q`: only the commit message line (no chrome)
- `--json`: machine-readable output (for scripts/extensions)

---

## Feature 2: Flag Shortcuts

Every frequently-used flag gets a single-letter shortcut. Compose them freely.

### Flag Map

| Short | Long | Purpose |
|-------|------|---------|
| `-p` | `--push` | Push after commit |
| `-a` | `--all` | Stage all tracked files before commit |
| `-m` | `--message-only` | Print message to stdout, don't commit |
| `-e` | `--exclude <pattern>` | Exclude files from diff (repeatable) |
| `-v` | `--verbose` | Show token usage, model, latency |
| `-q` | `--quiet` | Minimal output |
| `-i` | `--interactive` | Refinement mode |
| `-s` | `--split` | Multi-commit split mode |
| `-n` | `--dry-run` | Show what would happen without doing it |
| `-b` | `--body` | Force include body |
| `-l` | `--local` | Use local provider |
| `-t` | `--type <type>` | Force commit type |
| `-S` | `--scope <scope>` | Force scope |
| `-c` | `--confirm` | Ask Y/n before committing |

### Composable Examples

```bash
qc -p           # generate + commit + push
qc -ap          # stage all + generate + commit + push
qc -apv         # stage + commit + push + verbose
qc -m | pbcopy  # copy generated message to clipboard
qc -n           # dry-run
qc -i           # interactive refinement
qc -t fix -S auth -p  # force type=fix, scope=auth, push
```

### Conflict Detection

```
✗ Cannot combine --message-only (-m) with --push (-p). Pick one.
```

---

## Feature 3: Commit History Context + Smart Diff Preprocessing

### 3a: Commit History Context

Automatically include recent branch commits as context so the AI maintains consistent style and narrative.

| Aspect | Design |
|--------|--------|
| Default context | Last 5 commits on current branch (subject + body) |
| Token budget | Max 500 tokens (~1,250 chars) |
| Truncation | If 5 exceeds budget → 3 → subjects-only |
| Prompt placement | After diff, before rules |
| AI instruction | "Maintain consistent scope, style, and narrative" |
| Disable | `--no-context` flag |

**Prompt addition:**
```
RECENT COMMITS ON THIS BRANCH:
- feat(auth): add device code generation endpoint
- feat(auth): implement polling with exponential backoff
- feat(auth): add browser-open flow for CLI login

Maintain consistent scope and style with the above commits.
```

### 3b: Smart Diff Preprocessing

Auto-detect and summarize low-signal files before they hit the AI.

| Pattern | Action |
|---------|--------|
| Lock files (`*.lock`, `package-lock.json`, etc.) | Replace with `[lock file updated: name (+X −Y)]` |
| Generated code (`*.generated.*`, `.prisma/client/*`, etc.) | Replace with `[generated: path (+X −Y)]` |
| Minified files (single line > 500 chars) | Replace with `[minified asset: name (X KB)]` |
| Vendored dirs (`vendor/`, `third_party/`) | Replace with `[vendored: path updated]` |
| Source maps (`*.map`) | Omit entirely |

**User feedback:** `› smart-diff: 3 files summarized (saved ~12K tokens)`

**Overrides:**
- `.qcignore` — manual full exclusion
- `qc config set smart_diff false` — disable globally
- `--no-smart-diff` — disable for single run
- `--include <pattern>` — force a file through even if matched

**Runs CLI-side** before sending to API — reduces payload size and latency.

---

## Feature 4: Configuration & Customization System

### Configuration Hierarchy

```
Priority (highest → lowest):
  1. CLI flags (--scope, --type, --no-body)
  2. Repo-level config (.quikcommit.yml)
  3. Team rules (synced from org via API)
  4. User-level config (~/.config/qc/config.json)
  5. Auto-detected conventions (commitlint, .czrc)
  6. Smart defaults
```

### `.quikcommit.yml` Schema

```yaml
conventions:
  format: conventional  # conventional | gitmoji | custom
  types: [feat, fix, refactor, perf, test, docs, chore, ci, build]
  scopes: [auth, cli, api, dashboard]
  scope_from: auto  # auto | list | disabled

  subject:
    max_length: 72
    case: lower        # lower | sentence | upper
    full_stop: false
  body:
    wrap: 80
    when: auto         # auto | always | never
  header:
    max_length: 100

ai:
  tone: concise       # concise | descriptive | technical
  language: en        # ISO 639-1
  model: auto
  temperature: 0.2
  include_why: true

diff:
  smart_diff: true
  exclude: ["*.lock", "docs/generated/**"]
  include_always: ["migrations/**"]
  max_files: 50

workflow:
  auto_stage: false
  auto_push: false
  confirm: true
  interactive: false

aliases:
  wip: "--type chore --subject 'work in progress' --no-body"
  hotfix: "--type fix --push"
  ship: "--all --push --verbose"
```

### Gitmoji Support

```yaml
conventions:
  format: gitmoji
  gitmoji:
    style: code  # code (:sparkles:) | emoji (✨)
```

### Custom Format

```yaml
conventions:
  format: custom
  custom:
    pattern: "[{ticket}] {type}: {subject}"
    ticket_from: branch
    ticket_pattern: "[A-Z]+-\\d+"
```

Output: `[AUTH-123] feat: add OAuth2 login flow`

### `qc init --config`

Interactive generator that writes `.quikcommit.yml` with guided prompts.

### Team Rules Enforcement

| Enforcement | Behavior |
|-------------|----------|
| `advisory` | User can override locally |
| `strict` | CLI respects team rules regardless of local config |

---

## Feature 5: Interactive Refinement Mode

### Flow

```
$ qc -i
› generating commit...
✓ feat(auth): implement device authorization grant flow

? Accept, or refine: (Y / n / e)
  [s]horter  [l]onger  [scope]  [type]  [body]  [split]  [regen]
> shorter

✓ feat(auth): add device code login flow

? Accept: (Y / n / e)
> y
› [main 7c3f82e] committed
```

### Refinement Commands

| Command | Action |
|---------|--------|
| `y` / Enter | Accept and commit |
| `n` | Abort |
| `e` | Open in `$EDITOR` |
| `shorter` / `s` | Regenerate concise |
| `longer` / `l` | Regenerate descriptive |
| `scope <x>` | Change scope |
| `type <x>` | Change type |
| `body` | Add/regenerate body |
| `no-body` | Remove body |
| `split` | Suggest splitting into multiple commits |
| `regen` / `r` | Full regeneration |
| `why` | Add reasoning to body |

### Implementation Details

- Each refinement = single API call with original diff + previous message + instruction
- Max 10 refinements per commit
- History of attempts shown dimmed for reference

### Confirmation Mode

If `workflow.confirm: true`, a basic `Y/n/e` prompt appears on every commit (lightweight). Full refinement palette only activates with `-i` or `workflow.interactive: true`.

---

## Feature 6: Multi-Commit Splitting

### Flow

```
$ qc -s
› analyzing staged changes (8 files)...
› detected 3 logical groups:

  Group 1 (3 files):
    src/auth/device.ts, src/auth/types.ts, test/auth.spec.ts
    → feat(auth): add device code generation

  Group 2 (3 files):
    src/routes/login.ts, src/routes/callback.ts, src/middleware/session.ts
    → feat(auth): implement login route with session middleware

  Group 3 (2 files):
    package.json, pnpm-lock.yaml
    → chore(deps): add better-auth and kysely packages

? Commit all 3 in sequence? (Y / n / edit)
> y

✓ [main a1b2c3d] feat(auth): add device code generation
✓ [main d4e5f6g] feat(auth): implement login route
✓ [main h7i8j9k] chore(deps): add better-auth and kysely

› 3 commits created
```

### Mechanics

1. Full diff sent to AI with instruction to group by logical concern
2. AI returns JSON: `[{ files: [...], message: "..." }, ...]`
3. CLI validates all staged files appear in exactly one group
4. On confirm: `git reset HEAD -- <all>`, then per group: `git add <files> && git commit -m <msg>`

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| AI suggests 1 group | Normal single-commit flow |
| Hunks in same file span groups | Not supported v1 — file is atomic unit, note shown |
| User disagrees | `edit` opens interactive reassignment |
| Combined with `--push` | All commits created, then single push |

### API

New endpoint: `POST /v1/split`

```json
{
  "diff": "...",
  "files": ["src/auth/device.ts", ...],
  "rules": { ... },
  "recent_commits": [...]
}
```

Response: `{ "groups": [{ "files": [...], "message": "..." }], "reasoning": "..." }`

---

## Feature 7: `qc release` — Unified Release Workflow

### Flow

```
$ qc release
› analyzing commits since v5.2.0...
  14 commits: 6 feat, 4 fix, 2 refactor, 1 perf, 1 chore
› determining version bump...
  ✓ minor → v5.3.0
› generating changelog + PR description...

? Preview release: (Y / editor / abort)
> y

› creating branch release/v5.3.0...
› writing CHANGELOG.md...
› writing .changeset/release-v5.3.0.md...
› committing: chore(release): prepare v5.3.0
› pushing + opening PR...

✓ PR #47 created: https://github.com/org/repo/pull/47
```

### Subcommands

| Command | Purpose |
|---------|---------|
| `qc release` | Full flow |
| `qc release --preview` | Dry-run |
| `qc release --minor/--major/--patch` | Force bump |
| `qc release --from <ref>` | Override since reference |
| `qc release --no-pr` | Skip PR creation |
| `qc release --channel beta` | Prerelease |

### Version Bump Logic

| Condition | Bump |
|-----------|------|
| `BREAKING CHANGE:` or `!` after type | major |
| Any `feat` | minor |
| Only fix/perf/refactor/etc. | patch |
| Explicit flag | overrides |

### Monorepo Mode

Generates per-package changesets using existing changeset logic. Integrates with Changesets tooling — writes `.changeset/*.md` files for `version.yml` to pick up.

### Tier Gating

- Free: `--preview` only
- Pro: full single-repo
- Team: full monorepo + team changelog template
- Scale: custom hooks

---

## Feature 8: GitHub Action / PR Bot

### Usage

```yaml
- uses: quikcommit/action@v1
  with:
    mode: pr-describe  # pr-describe | commit-lint | changelog-draft | all
    api-key: ${{ secrets.QC_API_KEY }}
```

### Modes

| Mode | Action |
|------|--------|
| `pr-describe` | Generate/update PR description from commits |
| `commit-lint` | Check commits against team rules, post violations |
| `changelog-draft` | Post changelog entry as PR comment |
| `all` | All three |

### Behaviors

**pr-describe:**
- On open: generates full description
- On synchronize: updates (preserves `<!-- qc:keep -->` sections)
- Respects PR template
- Footer: `🤖 Generated by Quikcommit`

**commit-lint:**
- Posts single review with inline annotations per violating commit
- Non-blocking by default (`fail-on-violations: false`)

**changelog-draft:**
- Posts collapsible comment with grouped changelog entry

### Configuration (in `.quikcommit.yml`)

```yaml
github:
  pr_describe: true
  commit_lint: true
  changelog_draft: false
  fail_on_violations: false
  ignore_bots: true
  preserve_sections: ["## Testing", "## Screenshots"]
```

### Auth

Team API key (created in dashboard), counts against team quota.

### Tier Gating

- Free: not available
- Pro: `pr-describe` only, 50 PRs/month
- Team: all modes, 500 PRs/month
- Scale: all modes, unlimited

---

## Feature 9: Learning from Edits

### Signals Captured

| Signal | Teaches |
|--------|---------|
| Subject shortened | Prefers concise |
| Subject lengthened | Prefers descriptive |
| Type changed | Categorizes differently |
| Scope changed | Has scope preferences |
| Body removed | Prefers no body |
| Body added | Wants bodies |
| Verb patterns | Preferred imperatives |
| `--regen` used | Initial attempt quality |

### Storage

**Local (free):**
- `~/.config/qc/preferences.json`
- Last 50 edit pairs (generated → accepted)
- Heuristic rules extracted

**Cloud (Pro+):**
- Edit pairs synced (anonymized, no code)
- Server-side preference model per user
- Injected as `STYLE PREFERENCES:` prompt section

### Prompt Injection

```
STYLE PREFERENCES (learned from your edit history):
- Subject length: 5-8 words (concise)
- Preferred verbs: add, fix, update, remove
- Scope style: abbreviated (auth not authentication)
- Body: only for 3+ file changes
- Never use: semicolons in subject, "various"
```

### User Control

| Command | Purpose |
|---------|---------|
| `qc config preferences` | Show learned preferences |
| `qc config preferences --reset` | Clear all |
| `qc config preferences --export` | Export JSON |
| `qc config preferences --import <file>` | Import |
| `qc config set learning false` | Disable |

### Team Baseline

```yaml
ai:
  team_style:
    subject_length: 5-10
    preferred_verbs: [add, fix, update, remove, refactor]
    banned_words: [misc, stuff, various, things]
    body_threshold: 3
```

Individual preferences layer on top.

---

## Feature 10: Branch Intelligence

### 10a: Branch Summary (`qc branch`)

```
$ qc branch
› analyzing feat/auth-device-flow (12 commits, 3 days)...

## Branch Summary
Adding OAuth2 device authorization flow for CLI sign-in.

## Stats
  12 commits · 8 files · +487 −23
  Types: 8 feat, 2 fix, 1 test, 1 chore
  Scopes: auth (10), cli (1), deps (1)

## Health
  ✓ Consistent scope
  ✓ Atomic commits (avg 40 lines/commit)
  ⚠ No test commits in 3 days
  ⚠ Commit d4e5f6g doesn't follow conventions
```

### 10b: Scope Creep Detection

When committing, if the new commit diverges from branch scope:

```
⚠ This commit seems unrelated to this branch (feat/auth-device-flow).
  Branch scope: auth implementation
  This commit: dependency upgrade

? Commit anyway / Move to new branch / Stash for later
```

### 10c: PR Readiness (`qc branch --ready`)

```
$ qc branch --ready
  ✓ 12 commits, all follow conventions
  ✓ No merge conflicts with main
  ✓ Tests present
  ⚠ 2 commits could be squashed
  ⚠ 14 commits behind main

  Readiness: 7/10
```

### 10d: Commit Rewrite Suggestions (`qc branch --rewrite`)

```
$ qc branch --rewrite
  Suggested rewrites:
  1. Squash a1b2c3d + d4e5f6g → "fix(auth): handle expired device codes"
  2. Reword h7i8j9k: "fix stuff" → "fix(auth): correct polling interval"
  3. Reorder: move chore(deps) to end

? Apply suggestion 1 / 2 / 3 / all / none
```

Generates rebase commands — does not auto-execute.

### Tier Gating

- Free: `qc branch` (summary only)
- Pro: scope creep, `--ready`
- Team: `--rewrite`

---

## Implementation Priority

| # | Feature | Effort | Impact | Tier unlocked |
|---|---------|--------|--------|---------------|
| 1 | CLI Visual Experience | S | High (first impression) | All |
| 2 | Flag Shortcuts | XS | Medium (DX) | All |
| 3 | Smart Diff Preprocessing | S | High (quality jump) | All |
| 4 | Commit History Context | S | High (quality jump) | All |
| 5 | Configuration System (`.quikcommit.yml`) | M | High (customization) | All |
| 6 | Interactive Refinement | M | High (differentiator) | Free+ |
| 7 | Multi-Commit Splitting | M | Medium (power users) | Pro+ |
| 8 | `qc release` | L | High (workflow ownership) | Pro+ |
| 9 | GitHub Action / PR Bot | L | High (team adoption) | Team+ |
| 10 | Learning from Edits | L | High (long-term moat) | Pro+ |
| 11 | Branch Intelligence | M | Medium (differentiation) | Free-Team |

Recommended implementation order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11

---

## New API Endpoints Required

| Endpoint | Purpose | Feature |
|----------|---------|---------|
| `POST /v1/split` | Multi-commit file grouping | #7 |
| `POST /v1/branch/summary` | Branch narrative summary | #11 |
| `POST /v1/branch/scope-check` | Scope creep detection | #11 |
| `POST /v1/commit/refine` | Interactive refinement | #6 |
| `POST /v1/release` | Release changelog + PR generation | #8 |
| `PUT /v1/preferences` | Sync learned preferences | #10 |
| `GET /v1/preferences` | Retrieve preferences | #10 |

## New CLI Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `picocolors` | Terminal colors | 1KB |

No other runtime dependencies added. Spinner, readline, config parsing all use Node built-ins.
