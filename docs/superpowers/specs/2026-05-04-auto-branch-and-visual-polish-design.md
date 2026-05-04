# Auto-Branch + Visual Polish Design

**Date:** 2026-05-04
**Status:** Approved
**Scope:** Two related features bundled because they ship together:
1. **Auto-branch** — `qc branch` subcommand + auto-detection guard in commit flow that catches "I'm on main" and creates a properly-named branch
2. **Visual polish** — richer styling, file tree, boxed commit output, inline timing/stats

---

## Vision

Most developers occasionally start coding on `main`/`master` before realizing they should be on a feature branch. Quikcommit detects this and offers to create a properly-named branch (AI-generated from the diff), optionally moving any commits already made. The visual experience around commits is upgraded to feel polished and professional — file trees, boxed messages, semantic colors, inline stats.

## Architecture

```
Existing:
  qc → api-gateway/v1/commit → ai-worker /commit → message

New:
  qc branch → api-gateway/v1/branch → ai-worker /branch → branch name
  qc commit → [protected branch guard] → branch flow if needed → commit flow
```

New files:
- `packages/cli/src/commands/branch.ts` — the new subcommand
- `packages/cli/src/branch-detect.ts` — protected branch detection + glob matching
- `packages/cli/src/branch-rescue.ts` — git rescue sequence (move commits off main)
- `packages/cli/src/ui-rich.ts` — boxed output, file tree, semantic coloring
- `packages/ai-worker/src/branch-handler.ts` — `/branch` route handler
- `packages/api-gateway/src/routes/branch.ts` — gateway route

Modified files:
- `packages/cli/src/commands/commit.ts` — add protected branch guard
- `packages/cli/src/ui.ts` — add color tokens (cyan, magenta, green) and box-drawing helpers
- `packages/cli/src/api.ts` — add `generateBranchName()` method
- `packages/shared/src/types.ts` — add `BranchRequest`, `BranchResponse` types
- `packages/cli/src/index.ts` — wire `qc branch` subcommand and `--allow-protected` flag

---

## Feature 1: Auto-Branch

### User flows

#### Flow A — Uncommitted changes on main
```
$ qc -p
⚠ You're on main (a protected branch).
  4 staged file(s) ready to commit.

? What would you like to do? [B/c/a]
  (b)ranch — create a new branch from here  ← default
  (c)ommit anyway — commit to main
  (a)bort

[Enter]

› analyzing 4 staged file(s)...
› generating branch name (kimi-k2.6)... ⠸
✓ branch name: feat/oauth-device-flow

? Use this name? [Y/r/e/a]
  (y)es  (r)egenerate  (e)dit  (a)bort

[Enter]

› git checkout -b feat/oauth-device-flow
✓ switched to feat/oauth-device-flow

[continues normal commit flow]
```

#### Flow B — Commits already made on main
```
$ qc
⚠ You're on main with 2 commit(s) ahead of origin/main.
  Plus 1 staged file(s).

? Move those commits to a new branch? [B/c/a]
  (b)ranch — create branch at HEAD, reset main to origin/main
            ⚠  This will reset your local main; commits will live on the new branch.
  (c)ommit on main — generate the new commit on main (not recommended)
  (a)bort

[Enter]

› analyzing 2 commit(s) + staged changes...
› generating branch name... ⠸
✓ branch name: fix/session-refresh-race

About to:
  1. Create branch fix/session-refresh-race at a1b2c3d
  2. Reset main to origin/main (currently at e7f8g9h, 2 commits behind)
  3. Switch to fix/session-refresh-race
  4. Restore your 1 staged file

Commits being moved:
  a1b2c3d fix: handle session expiry race
  d4e5f6g fix: clarify polling interval comment

? Continue? [Y/n]

✓ moved 2 commits to fix/session-refresh-race
✓ main reset to origin/main

[continues normal commit flow]
```

#### Flow C — Explicit `qc branch`
```bash
qc branch                        # name from staged/unstaged diff
qc branch --from-commits         # name from recent commits
qc branch -m "add oauth flow"    # name from a description (no diff yet)
qc branch feat/my-name           # explicit name, just create it
qc branch --rescue               # explicit Flow B
qc branch --dry-run              # show name without creating
qc branch --no-switch            # create but don't checkout
qc branch -p                     # create + push (sets upstream)
```

### `qc branch` flags

| Flag | Short | Purpose |
|------|-------|---------|
| `--from-commits` | | Generate from commit log (when on a feature branch) |
| `--message <text>` | `-m` | Generate from a description string |
| `--rescue` | | Move commits off current branch back to upstream |
| `--dry-run` | `-n` | Show generated name without acting |
| `--no-switch` | | Create but don't checkout |
| `--from <ref>` | | Base from a different ref (default: HEAD) |
| `--push` | `-p` | Push immediately (sets upstream) |

### `qc commit` additions

| Flag | Purpose |
|------|---------|
| `--allow-protected` | Bypass the guard for this run |
| `--auto-branch` | Non-interactive: auto-create branch with generated name, no prompt |

### Branch name generation API

**New endpoint:** `POST /v1/branch`

**Request:**
```typescript
interface BranchRequest {
  diff?: string;
  changes?: string;
  recent_commits?: string[];
  description?: string;
  rules?: CommitRules;
  scope_hint?: string;
  model?: string;
}
```

**Response:**
```typescript
interface BranchResponse {
  name: string;        // "feat/oauth-device-flow"
  type: string;        // "feat"
  slug: string;        // "oauth-device-flow"
  reasoning?: string;
}
```

**Server-side validation:**
- `name` must match `^(feat|fix|refactor|perf|docs|test|chore|ci)\/[a-z0-9][a-z0-9-]{1,55}$`
- Reject any name containing `main`, `master`, `develop`, `release/*`
- On invalid response: server falls back to deterministic generation (type from heuristic + slug from first changed filename)

**Local provider parity:** `local.ts` adds `runLocalBranch()` mirroring `runLocalCommit()`.

**Tier gating:** Counts as 1 against monthly quota for SaaS free tier (same pool as commits). Unlimited for local providers.

### Protected branch detection

**Resolution order:**
1. `.quikcommit.yml` → `branch.protected_branches` if defined
2. Git default branch (from `git symbolic-ref refs/remotes/origin/HEAD`)
3. Hardcoded fallback: `main`, `master`, `develop`, `trunk`

**Glob support:** Patterns like `release/*` are matched via simple glob (existing `matchGlobPattern` from `monorepo.ts`).

**Bypass conditions:**
- `--allow-protected` flag
- `branch.allow_protected: true` in config
- `branch.protected_branches: []` (empty list)
- Hook mode (`--hook-mode`) — silent skip
- Non-TTY (CI) — silent skip

### Rescue logic (moving commits off protected branch)

**Sequence:**
1. Verify upstream exists (`git rev-parse --verify origin/<branch>`); abort if not
2. Stash uncommitted changes (`git stash push --include-untracked --message "qc-rescue-stash"`)
3. Create new branch at HEAD (`git branch <name> HEAD`)
4. Reset protected branch to upstream (`git reset --hard origin/<branch>`)
5. Checkout new branch (`git checkout <name>`)
6. Pop stash if created (`git stash pop`)

**Safety:**
- Pre-execution preview shows exact commits to be moved + planned operations
- Confirmation prompt required (`Y/n`)
- Try/catch wraps steps 4-6; on failure, `git reset --hard <original-HEAD>` restores protected branch
- If `git stash pop` has conflicts, abort + restore + surface conflicts
- Branch name uniqueness: append `-2`, `-3` if name exists locally OR remotely

---

## Feature 2: Visual Polish

### Output transformation

**Before:**
```
› staging working tree (9 file(s))...
  src/.../discovery-pipeline.metrics.ts, src/.../intelligence-pipeline.metrics.ts, src/.../intelligenceWorkerClient.ts, +6 more
✓ fix(metrics,workers): Convert metric durations to seconds and improve migration logging
  - Converted all metric durations from milliseconds to seconds for consistency.
  - Added detailed logging for skipped fields during Typesense schema migration.
```

**After:**
```
  ◆ staging 9 files
    ├─ src/company-intelligence/metrics/discovery-pipeline.metrics.ts
    ├─ src/company-intelligence/metrics/intelligence-pipeline.metrics.ts
    ├─ src/company-intelligence/services/intelligenceWorkerClient.ts
    └─ +6 more files

  ◆ generating commit ⠸  kimi-k2.6 · 1.2s

  ╭──────────────────────────────────────────────────────────────╮
  │  fix(metrics,workers):                                       │
  │    Convert metric durations to seconds and                   │
  │    improve migration logging                                 │
  │                                                              │
  │  • Converted all metric durations from ms to seconds         │
  │  • Added detailed logging for skipped fields during          │
  │    Typesense schema migration                                │
  │  • Included checks for special fields like `id`              │
  │  • Provided warnings for fields with type mismatches         │
  ╰──────────────────────────────────────────────────────────────╯
    9 files · +218 −34 · 847 tokens

  ✓ committed   fix/testUpdates-05042026 · a1b2c3d
  ✓ pushed      origin/fix/testUpdates-05042026
```

### Color/style tokens (additions to `ui.ts`)

| Element | Style |
|---------|-------|
| `◆` step marker | dim cyan |
| Spinner frame | bright cyan, animated |
| `├─ └─` tree connectors | dim gray |
| File paths | dim, last-segment normal weight |
| Commit type (`fix`) | bold cyan |
| Commit scope (`metrics,workers`) | bold yellow |
| Subject text | bright white |
| Body bullets `•` | green |
| Inline code `` `id` `` | bright magenta |
| Stats line | dim with normal-weight numbers |
| `✓` success | bright green |
| Branch name | bold yellow |
| Commit hash | dim |
| Box borders `╭─╮` | dim cyan |

### Enhancements

| Enhancement | Behavior |
|-------------|----------|
| File tree | Show 3 files with tree connectors, "+N more" if more |
| Boxed commit | Wraps subject + body in rounded box for visual focus |
| Inline timing | Spinner shows elapsed `1.2s` next to model name |
| Inline stats | After box: `N files · +X −Y · Z tokens` |
| Two-line success | `✓ committed` and `✓ pushed` separately, with refs aligned |
| Markdown code in body | `` `id` `` rendered in magenta |
| Long subjects | Auto-wrap at terminal width, indent continuation 4 spaces |
| Narrow terminals | Detect width < 80, fall back to compact format |

### Configuration

```yaml
# .quikcommit.yml
ui:
  style: rich        # rich (default) | compact | minimal
  box: rounded       # rounded | square | double | none
  show_stats: true
  show_timing: true
  show_tokens: true  # only with --verbose
```

### Disable conditions

- Not a TTY → compact (no box, no tree, single-color)
- `NO_COLOR` env → all styling stripped, ASCII-only `+`/`-`/`|` for tree
- `--quiet` → just the `✓ committed` line
- Hook mode → completely silent (existing behavior)
- Terminal width < 80 → compact fallback

---

## Configuration Reference

### `.quikcommit.yml` additions

```yaml
branch:
  protected_branches:
    - main
    - master
    - develop
    - "release/*"
  detect_default: true       # also use git's resolved default branch
  allow_protected: false     # if true, never prompt
  default_action: branch     # branch | continue | prompt

  generation:
    types: [feat, fix, refactor, perf, docs, test, chore, ci]
    max_length: 60
    slug_words: 5
    include_scope: true      # prefix scope as feat/auth/oauth-flow when monorepo

ui:
  style: rich
  box: rounded
  show_stats: true
  show_timing: true
  show_tokens: true
```

### User config (`~/.config/qc/config.json`) additions

```json
{
  "branch": {
    "allowProtected": false,
    "lastUsedNames": ["feat/oauth-device-flow", "fix/session-race"]
  },
  "ui": {
    "style": "rich"
  }
}
```

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No staged or unstaged changes, no commits ahead | `qc branch` prompts: "No changes detected. Use `-m '<description>'`." |
| Detached HEAD | Treated as not-on-protected-branch; `qc branch` works (creates branch at HEAD) |
| Branch name already exists locally or remotely | Append `-2`, `-3`, etc., until unique |
| AI returns invalid name | Server-side validation catches; deterministic fallback (type from heuristic + slug from first changed filename) |
| User on a non-protected branch | `qc branch` works (creates sub-branch from current); auto-detection guard does nothing |
| Repo has no remote / no upstream | `qc branch` works normally; rescue mode errors clearly |
| Network failure during AI call | Falls back to local provider if configured, else deterministic name; prompts user |
| User aborts mid-rescue | Rollback restores protected branch to original HEAD |
| `git stash` fails (existing conflicts) | Abort rescue; tell user to commit/stash manually |
| Long diff > 32K context | Existing diff truncation (smart-diff) applies |
| Terminal width < 60 | Skip box rendering; use linear output |

---

## Testing Strategy

### CLI unit tests

| File | Coverage |
|------|----------|
| `test/branch-detect.spec.ts` | `isProtectedBranch()` with hardcoded list, glob patterns, config override, git default detection |
| `test/branch-name.spec.ts` | Name validation regex, sanitization, protected name rejection, uniqueness suffix logic |
| `test/branch-rescue.spec.ts` | Mock `execFileSync`; verify exact git sequence and rollback path on failure |
| `test/commands/branch.spec.ts` | `runBranch()` with all flag combinations |
| `test/commands/commit.spec.ts` | Add `handleProtectedBranchPrompt` integration with mocked stdin |
| `test/ui-rich.spec.ts` | Box rendering at various widths, file tree truncation, color application |

### AI worker tests

| Test | Coverage |
|------|----------|
| `buildBranchUserContent` | Diff-only, commits-only, description-only, all combined |
| `/branch` handler | Validates request shape; returns 400 on missing inputs; sanitizes AI output; rejects protected names |
| Server-side name validation | Regex enforcement, length cap, protected-name rejection |

### API gateway tests

| Test | Coverage |
|------|----------|
| `POST /v1/branch` | Auth required; counts against quota; per-string size caps on inputs |
| Plan gating | Free tier allowed (counts against monthly pool) |

### Integration test (manual checklist)

1. On a feature branch with staged changes: `qc branch` creates new branch, switches.
2. On main with staged changes: `qc -p` triggers prompt, branches, commits, pushes.
3. On main with 2 commits ahead: `qc` triggers rescue prompt, moves commits, leaves main clean.
4. `qc branch -m "add login flow"` with no diff generates `feat/add-login-flow`.
5. `qc branch existing-name` when name exists → uses `existing-name-2`.
6. Network failure during AI call → falls back to deterministic name.
7. Rescue mid-failure → main is restored to original HEAD.
8. Visual polish: rich output renders box correctly, NO_COLOR strips styling, narrow terminal falls back to compact.

---

## Implementation Priority

| # | Component | Effort |
|---|-----------|--------|
| 1 | Branch name generation API + AI worker handler | M |
| 2 | `branch-detect.ts` + protected branch config resolution | S |
| 3 | `branch-rescue.ts` + safety/rollback logic | M |
| 4 | `commands/branch.ts` subcommand | M |
| 5 | Auto-detection guard in `commands/commit.ts` | S |
| 6 | Local provider parity (`runLocalBranch`) | S |
| 7 | Visual polish (`ui-rich.ts` + integration) | M |
| 8 | Tests (per the matrix above) | M |

Recommended order: 1 → 2 → 4 → 5 → 6 → 3 → 7 → 8

(Build name generation first so subcommand can be tested independently. Rescue is most dangerous; build last in the branch slice. Visual polish layered after functionality is solid.)

---

## New API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /v1/branch` | Generate branch name from diff/commits/description |

## New CLI Dependencies

None. Uses existing `picocolors` for new color tokens. Box-drawing characters are Unicode (no library needed).
