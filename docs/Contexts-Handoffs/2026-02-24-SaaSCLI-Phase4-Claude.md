# Context Handoff — Quikcommit SaaS CLI Phase 4
**Date:** 2026-02-24
**Agent:** Claude (Sonnet 4.6)
**Branch at handoff:** `main`
**Last commit:** `adcb0e0` — `fix: sync docs to public repo, push release tags after publish, clean up README`

---

## 1. Project Overview

Quikcommit (`qc`) is an AI-powered CLI that generates [Conventional Commits](https://www.conventionalcommits.org/) from staged git diffs. It ships as:

- **`@quikcommit/cli`** — the public npm package / standalone binary (`qc`)
- **`@quikcommit/shared`** — shared types, constants, model catalog (npm public)
- **`@quikcommit/api-gateway`** — Cloudflare Worker: auth, rate limiting, billing, routing (private)
- **`@quikcommit/ai-worker`** — Cloudflare Worker: AI inference via Cloudflare Workers AI (private)
- **`@quikcommit/dashboard`** — Web app at `app.quikcommit.dev` (private)
- **`@quikcommit/docs`** — VitePress documentation site (private)

---

## 2. Monorepo Split Architecture

### Two-Repo Setup (implemented this session)

| Repo | Visibility | URL | Contains |
|------|-----------|-----|---------|
| `Quikcommit-Internal/quikcommit` | **Private** | (SSH: `git@github.com-qki:Quikcommit-Internal/quikcommit.git`) | Full monorepo — all packages |
| `Quikcommit-Internal/public` | **Public** | `https://github.com/Quikcommit-Internal/public` | CLI + shared + docs only |

The public repo is **not manually maintained** — it is automatically synced from the private repo via a GitHub Actions workflow (`sync-public.yml`) on every push to `main` and on every `@quikcommit/cli@*` tag.

### Sync Workflow (`sync-public.yml`)

**Trigger:** `push` to `main` OR `push` of `@quikcommit/cli@*` tags on the private repo.

**What it syncs to `Quikcommit-Internal/public`:**
- `packages/cli/` → `packages/cli/`
- `packages/shared/` → `packages/shared/`
- `packages/docs/` → `packages/docs/`
- `docs/` → `docs/` (excluding `GITHUB-RELEASE-SETUP.md`, `PROMPTS.md`, `plans/`, `context-window-overflow-fix.md`, `test-coverage-review.md`)
- `README.md`, `install.sh`
- **Generated/overridden** in public repo:
  - `pnpm-workspace.yaml` (only cli/shared/docs packages)
  - `package.json` (no ai-worker vitest override)
  - `.changeset/config.json` (repo: `Quikcommit-Internal/public`)
  - `.github/workflows/*.yml` ← copied from `.github/public-workflows/` in private repo

**On CLI tag push only:** Also pushes the `@quikcommit/cli@X.Y.Z` tag to the public repo, triggering the public binary release workflow.

**Secret required:** `PUBLIC_REPO_TOKEN` — fine-grained PAT (or classic with `public_repo` scope) on the account that owns `Quikcommit-Internal`, scoped to `Quikcommit-Internal/public`, with Contents read+write.

### Public Repo Workflows (maintained in private repo at `.github/public-workflows/`)

| File | Purpose |
|------|---------|
| `.github/public-workflows/ci.yml` | PR CI for public repo (lint, typecheck, test, build) — no Cloudflare secrets |
| `.github/public-workflows/release.yml` | CLI-only release: builds 4 platform binaries, creates GitHub Release on public repo |

---

## 3. Release Pipeline (End-to-End)

```
1. Developer: pnpm changeset → commit → push to main
   ↓
2. version.yml → sees changeset file → changesets/action creates "Version Packages" PR
   (bumps package.json versions, writes CHANGELOG, deletes changeset files)
   ↓
3. Developer merges Version Packages PR
   ↓
4. version.yml runs again → no changesets → "Publish (no changesets)" step:
   - pnpm run release  (changeset publish → publishes to npm, creates local git tags)
   - git push --follow-tags  ← CRITICAL: pushes tags to trigger downstream workflows
   ↓
5. Tags pushed trigger release.yml in PRIVATE repo:
   - @quikcommit/cli@*       → builds binaries (4 platforms) + creates GitHub Release
   - @quikcommit/api-gateway@* → deploys to Cloudflare Workers
   - @quikcommit/ai-worker@*   → deploys to Cloudflare Workers
   - @quikcommit/dashboard@*   → builds + deploys to Cloudflare Pages
   ↓
6. @quikcommit/cli@* tag also triggers sync-public.yml:
   - Syncs files to Quikcommit-Internal/public
   - Pushes @quikcommit/cli@X.Y.Z tag to public repo
   ↓
7. Public repo's release.yml triggers on the tag:
   - Builds 4 platform binaries
   - Creates GitHub Release on Quikcommit-Internal/public (public-facing release)
```

### Critical: `version.yml` "Publish (no changesets)" path

This is the step that runs `changeset publish` and pushes tags. It was missing `git push --follow-tags` until `adcb0e0` — that fix is now on main.

```yaml
- name: Publish (no changesets)
  if: steps.check.outputs.has_changesets == 'false'
  run: |
    git config user.name "github-actions[bot]"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
    pnpm run release
    git push --follow-tags   # ← was missing before adcb0e0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## 4. Required Secrets

### `Quikcommit-Internal/quikcommit` (private repo)

| Secret | Used by | Notes |
|--------|---------|-------|
| `NPM_TOKEN` | `version.yml` — `changeset publish` | Automation-type token from npmjs.com |
| `CLOUDFLARE_API_TOKEN` | `release.yml` (Workers/Pages deploy), `ci.yml` (tests) | Edit Cloudflare Workers template |
| `CLOUDFLARE_ACCOUNT_ID` | Same as above | Cloudflare dashboard sidebar |
| `PUBLIC_REPO_TOKEN` | `sync-public.yml` | Fine-grained PAT, see §2 above |

### `Quikcommit-Internal/public` (public repo)

No secrets needed. `GITHUB_TOKEN` is automatic and sufficient for creating releases.

---

## 5. GitHub Org Settings Required

Both of the following must be enabled at **`Quikcommit-Internal` org level** (Settings → Actions → General):

1. **Actions permissions**: "Allow Quikcommit-Internal, and select non-Quikcommit-Internal, actions and reusable workflows"
   - Allow list must include:
     ```
     pnpm/action-setup@*
     changesets/action@*
     oven-sh/setup-bun@*
     softprops/action-gh-release@*
     ```

2. **Workflow permissions**: "Allow GitHub Actions to create and approve pull requests" ✓

Also enable at **repo level** for `Quikcommit-Internal/quikcommit`:
- Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests" ✓

---

## 6. Current Package Versions

| Package | Version | npm public? |
|---------|---------|------------|
| `@quikcommit/cli` | `2.0.0` | ✓ published |
| `@quikcommit/shared` | `2.0.0` | ✗ private |
| `@quikcommit/api-gateway` | `2.0.0` | ✗ private |
| `@quikcommit/ai-worker` | `2.0.0` | ✗ private |
| `@quikcommit/dashboard` | `1.0.1` | ✗ private |
| `@quikcommit/docs` | `0.1.0` | ✗ ignored by changeset |

### Git Tags Present

```
@quikcommit/ai-worker@2.0.0
@quikcommit/api-gateway@2.0.0
@quikcommit/cli@1.0.0
@quikcommit/cli@2.0.0
@quikcommit/dashboard@1.0.1
@quikcommit/shared@2.0.0
@quikcommit/docs@0.1.0   ← created by last version.yml run (untagged project detection)
```

---

## 7. Outstanding Issues / Next Steps

### 7.1 GitHub Release for `@quikcommit/cli@2.0.0` Missing Binaries

**Problem:** Tags for 2.0.0 were pushed manually BEFORE the `git push --follow-tags` fix was in place. The `release.yml` may have run but either failed or ran before `sync-public.yml` had the `docs/` sync fix. Need to verify:

- Go to `Quikcommit-Internal/quikcommit` → Actions → filter "Release" workflow
- Check if the `@quikcommit/cli@2.0.0` tag triggered a run
- If the run failed or is missing, re-trigger by deleting and re-pushing the tag:
  ```bash
  git push origin :refs/tags/@quikcommit/cli@2.0.0
  git push origin @quikcommit/cli@2.0.0
  ```

### 7.2 `@quikcommit/shared` Privacy Flag

`packages/shared/package.json` has `"private": true` but `@quikcommit/shared` should probably be published to npm (the CLI depends on it). Verify whether this is intentional or a bug. If it needs to be public, change `"private"` to `false` and add `"access": "public"` to `publishConfig`.

### 7.3 `docs/` Not in Public Repo Yet

The `sync-public.yml` fix to include `docs/` was committed in `adcb0e0`. The next push to main (or manual trigger of `sync-public.yml`) will populate `docs/` in the public repo and fix the broken README links. This should happen automatically on the next commit to main.

**To force it now:**
- GitHub → `Quikcommit-Internal/quikcommit` → Actions → "Sync Public Repo" → Run workflow (on main)

### 7.4 `qc changeset` Feature — P3 Test Gaps

From the code review of this feature, these were deferred to the backlog:
- `api-gateway/test/changeset.spec.ts` — missing tests for MAX_PACKAGES (>50), AI worker timeout (504), 5xx from worker
- `ai-worker/test/` — `buildChangesetUserContent` has no direct unit tests
- `cli/test/changeset.spec.ts` — multi-pattern workspace not tested

### 7.5 Homebrew Formula SHA256

After the first publish of `@quikcommit/cli`, the Homebrew formula SHA256 needs updating:
```bash
curl -sL "https://registry.npmjs.org/@quikcommit/cli/-/cli-2.0.0.tgz" | shasum -a 256
```
Update the formula in the relevant location.

### 7.6 `@quikcommit/docs@0.1.0` Tag Trigger

The `@quikcommit/docs@0.1.0` tag was just created by `changeset publish`. This does NOT match any pattern in `release.yml` (`@quikcommit/docs@*` is not listed), so it won't trigger any deployment. This is fine — docs deploy is handled separately (if at all). No action needed.

---

## 8. Key Files Reference

### Private Repo (`Quikcommit-Internal/quikcommit`)

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | PR CI (lint, typecheck, test, build) — requires CLOUDFLARE_* for tests |
| `.github/workflows/version.yml` | Manages changesets → Version PR → npm publish → tag push |
| `.github/workflows/release.yml` | Tag-triggered: CLI binaries, Workers deploy, Dashboard deploy |
| `.github/workflows/sync-public.yml` | Syncs public files to `Quikcommit-Internal/public` |
| `.github/public-workflows/ci.yml` | CI for public repo (no Cloudflare) — copied by sync |
| `.github/public-workflows/release.yml` | Binary release for public repo — copied by sync |
| `.changeset/config.json` | Changelog points to `Quikcommit-Internal/quikcommit`, ignores `@quikcommit/docs` |
| `packages/cli/src/commands/changeset.ts` | `qc changeset` command implementation |
| `packages/api-gateway/src/routes/changeset.ts` | API route for changeset AI endpoint |
| `docs/GITHUB-RELEASE-SETUP.md` | Manual GitHub setup steps (secrets, branch protection) — NOT synced to public |

### Public Repo (`Quikcommit-Internal/public`)

Entirely managed by `sync-public.yml`. Do not edit files there directly — changes will be overwritten on next sync.

---

## 9. `qc changeset` Feature Summary

New command added this phase: `qc changeset [--base <branch>]`

**Flow:**
1. Collects git diff vs base branch
2. Maps changed files to workspace packages (`mapFilesToPackages`)
3. Calls api-gateway `/changeset` route → ai-worker classifies semver bumps
4. Interactive prompt: user confirms or overrides each package's bump type
5. Writes `.changeset/<slug>.md` with YAML frontmatter

**Key fixes applied this session (P1/P2 from code review):**
- `ChangesetWorkerResponse.packages[].bump` validated — clamps to `"patch"` if AI returns invalid value
- Retry loop now re-throws non-transient errors immediately (was silently swallowing first error)
- `mapFilesToPackages` path construction fixed for non-glob pnpm workspace entries
- API gateway status cast broadened to include 413
- `--base` flag help text updated to mention `qc changeset`

---

## 10. SSH / Git Remote Setup

The private repo uses an SSH config alias:

```
Host github.com-qki
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_qki
```

Remote URL: `git@github.com-qki:Quikcommit-Internal/quikcommit.git`

The SSH key `id_ed25519_qki` must be added to the GitHub account that owns `Quikcommit-Internal`.

---

## 11. What Was Done This Session (Chronological)

1. **Code reviewed `qc changeset`** — identified P1/P2/P3 issues; user confirmed all P1/P2 fixes were applied (314 tests passing)
2. **Updated all repo URLs** from `whrit/quikcommit` to new org:
   - Private monorepo references → `Quikcommit-Internal/quikcommit`
   - Public release/download URLs → `Quikcommit-Internal/public`
3. **SSH setup guidance** — `id_ed25519_qki` key for `Quikcommit-Internal` org access
4. **Full monorepo pushed** to `Quikcommit-Internal/quikcommit` (all branches + tags)
5. **Designed and implemented sync workflow** instead of manual repo split:
   - `.github/workflows/sync-public.yml`
   - `.github/public-workflows/ci.yml`
   - `.github/public-workflows/release.yml`
6. **Fixed GitHub Actions org/repo settings** — PR creation permissions, Actions allow list
7. **Fixed `version.yml`** — added `git push --follow-tags` to "Publish (no changesets)" path
8. **Fixed `sync-public.yml`** — added `docs/` rsync (was missing, caused 404 on README links)
9. **Fixed `README.md`** — removed private backend packages from Repository Structure section
10. **Manually pushed 2.0.0 tags** to trigger release pipeline (workaround for initial tag-push gap)
11. **Identified** that `@quikcommit/cli@2.0.0` GitHub Release with binaries may still be missing — needs verification and possible tag re-push
