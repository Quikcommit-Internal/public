# Teams

Quikcommit Teams let your entire organization share commit conventions, ensuring consistent commit messages across every developer's machine.

**Requires:** Team plan or higher.

---

## Overview

When you're on a Team plan:
- Shared **commit rules** (scopes, types, length limits) are fetched from the server on every `qc` run
- All team members automatically get the same AI-enforced conventions
- No per-developer configuration needed beyond `qc login`

---

## Team Commands

### View team info

```bash
qc team info
```

Shows your team name, plan tier, and member list.

### View team commit rules

```bash
qc team rules
```

Displays the rules currently enforced for your team, e.g.:

```
Team: acme-corp (Team plan)
Commit rules:
  Types: feat, fix, docs, chore, refactor, test, ci
  Scopes: api, ui, auth, infra
  Max header length: 72
  Subject case: lower-case
```

### Push your local commitlint config to the team

```bash
qc team rules --push
```

Quikcommit reads your local commitlint configuration automatically from any of these files (in order):

1. `.commitlintrc.json`
2. `.commitlintrc.js` / `.commitlintrc.cjs`
3. `.commitlintrc.yaml` / `.commitlintrc.yml`
4. `commitlint.config.js`
5. `package.json` → `"commitlint"` key

Example `.commitlintrc.json` that will be picked up:

```json
{
  "rules": {
    "type-enum": [2, "always", ["feat", "fix", "docs", "chore"]],
    "scope-enum": [2, "always", ["api", "ui", "auth"]],
    "header-max-length": [2, "always", 72],
    "subject-case": [2, "always", "lower-case"]
  }
}
```

### Invite a teammate

```bash
qc team invite alice@example.com
```

Sends an invitation to the provided email address.

---

## How Rules Are Applied

When `qc` runs on a commit:

1. Fetches team rules from the server (fast, cached per session)
2. If the repo is a monorepo, detects the scope from staged file paths
3. Intersects detected monorepo scopes with team's allowed scopes
4. Passes the final rules to the AI as strict constraints

**Priority order:**
```
Team rules > Local rules > No rules (Conventional Commits defaults)
```

---

## Monorepo + Team Rules

In a monorepo, Quikcommit combines workspace scope detection with team rules:

- Staged files in `packages/api/` → detected scope: `api`
- Team rules allow scopes: `["api", "ui", "auth", "infra"]`
- Result: scope `api` is used (intersection)

If the detected scope is not in the team's allowed list, no scope is enforced (the AI picks the best fit from allowed scopes).

---

## Setting Up Team Rules (Admin)

1. Add a commitlint config to your repo root (`.commitlintrc.json` is simplest)
2. One team member pushes it:
   ```bash
   qc team rules --push
   ```
3. All teammates get the rules automatically on next `qc` run

---

## Supported CommitRules Fields

| Field | Type | Description |
|-------|------|-------------|
| `scopes` | `string[]` | Allowed commit scopes |
| `types` | `string[]` | Allowed commit types |
| `maxHeaderLength` | `number` | Max first-line length (default: 100) |
| `maxSubjectLength` | `number` | Max subject length |
| `minSubjectLength` | `number` | Min subject length |
| `subjectCase` | `string` | e.g. `"lower-case"`, `"sentence-case"` |
| `maxBodyLineLength` | `number` | Max body line length |

All fields are optional. The AI applies whichever rules are present.
