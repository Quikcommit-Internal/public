# Configuration

Quikcommit stores all configuration in `~/.config/qc/`.

---

## Config Files

| File | Purpose |
|------|---------|
| `~/.config/qc/credentials` | API key (mode 600) |
| `~/.config/qc/config.json` | Model, API URL, provider, excludes, rules |

The `~/.config/qc/` directory is created with mode 700 on first use.

---

## config.json Fields

```jsonc
{
  "model": "qwen25-coder-32b",      // AI model to use
  "apiUrl": "https://api.quikcommit.dev",  // API endpoint
  "provider": "saas",               // "saas" | "ollama" | "lmstudio" | "openrouter" | "cloudflare" | "custom"
  "excludes": ["*.lock", "dist/"],  // glob patterns to strip from diff
  "rules": {                        // local commitlint-style rules
    "scopes": ["api", "cli", "ui"],
    "types": ["feat", "fix", "docs"],
    "maxHeaderLength": 72
  }
}
```

---

## Managing Config

### View current config

```bash
qc config
```

### Set individual values

```bash
qc config set model qwen25-coder-32b
qc config set api_url https://api.quikcommit.dev
qc config set provider saas
```

### Reset to defaults

```bash
qc config reset
```

---

## Models

| Model ID | Cloudflare Model | Description | Plan |
|----------|-----------------|-------------|------|
| `qwen3-30b` | `@cf/qwen/qwen3-30b` | Fast, good quality | Free |
| `qwen25-coder-32b` | `@cf/qwen/qwen2.5-coder-32b-instruct` | Best for code | Pro+ |
| `deepseek-r1-32b` | `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` | Reasoning model | Pro+ |
| `llama-3.3-70b` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Large + capable | Pro+ |

Set permanently:

```bash
qc config set model llama-3.3-70b
```

Override for a single run:

```bash
qc --model deepseek-r1-32b
```

---

## Excluding Files from Diffs

You can prevent certain files from being included in the diff sent to the AI. This is useful for large lock files, generated code, or sensitive files.

### Project-level: `.qcignore`

Create a `.qcignore` file in your repository root (same syntax as `.gitignore`):

```
# .qcignore
pnpm-lock.yaml
yarn.lock
package-lock.json
*.min.js
dist/
.env*
```

### User-level: config excludes

```bash
# Stored in ~/.config/qc/config.json
qc config set excludes "*.lock,dist/"
```

### Built-in excludes (always applied)

Quikcommit automatically strips these from diffs regardless of config:
- Lock files: `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `bun.lockb`, `Cargo.lock`
- Build output: `dist/`, `build/`, `.next/`, `out/`
- Minified assets: `*.min.js`, `*.min.css`

---

## Local Commit Rules

You can define commit rules locally that are applied to every AI generation. These follow the same shape as commitlint:

```jsonc
// ~/.config/qc/config.json
{
  "rules": {
    "scopes": ["api", "cli", "ui", "auth"],
    "types": ["feat", "fix", "docs", "chore", "refactor", "test"],
    "maxHeaderLength": 72,
    "maxSubjectLength": 50,
    "subjectCase": "lower-case"
  }
}
```

If you're in a **Team plan**, team rules fetched from the server take precedence. In a monorepo, the detected package scope is intersected with the allowed scopes.

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `QC_API_KEY` | Override stored API key for this invocation | `qck_live_abc123` |

```bash
# Use in CI without storing credentials
QC_API_KEY=${{ secrets.QC_API_KEY }} qc --message-only
```

---

## Monorepo / Workspace Detection

Quikcommit automatically detects monorepo workspaces and sets the commit scope based on which packages have staged changes.

Supported workspace formats:
- `pnpm-workspace.yaml`
- `package.json` → `workspaces` field
- Yarn/npm workspaces

**Example:** If you stage changes in `packages/api/` within a pnpm workspace, the generated scope will be `api` (or the package name).

You can view the detected workspace info via `qc config`.
