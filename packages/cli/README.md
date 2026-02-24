# @quikcommit/cli

AI-powered conventional commit messages. Stage your changes, run `qc`, get a perfect commit.

```bash
git add .
qc
# → feat(auth): add OAuth2 login with GitHub and Google providers
```

[![npm version](https://img.shields.io/npm/v/@quikcommit/cli)](https://www.npmjs.com/package/@quikcommit/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Install

```bash
npm install -g @quikcommit/cli
# or
bun add -g @quikcommit/cli
```

**Pre-built binaries** (no Node/Bun required) — download from [GitHub Releases](https://github.com/whrit/quikcommit/releases/latest):

| Platform | File |
|----------|------|
| macOS Apple Silicon | `qc-darwin-arm64` |
| macOS Intel | `qc-darwin-x64` |
| Linux x64 | `qc-linux-x64` |
| Linux ARM64 | `qc-linux-arm64` |

```bash
# Example: macOS Apple Silicon
curl -fsSL https://github.com/whrit/quikcommit/releases/latest/download/qc-darwin-arm64 \
  -o /usr/local/bin/qc && chmod +x /usr/local/bin/qc
```

---

## Quick Start

```bash
# 1. Sign in (opens browser — GitHub or Google)
qc login

# 2. Stage your changes
git add .

# 3. Generate + commit
qc

# That's it.
```

---

## Usage

```
qc [command] [options]
```

### Generate a commit (default)

```bash
qc                      # generate + commit
qc --message-only       # preview message, don't commit
qc --push               # generate, commit, and push
qc --model llama-3.3-70b  # use a specific model
```

### Auth & status

```bash
qc login                # sign in via browser
qc logout               # clear credentials
qc status               # show plan, usage, auth
```

### PR descriptions *(Pro+)*

```bash
qc pr                   # generate PR description from branch commits
qc pr --base develop    # compare against a different base branch
qc pr --create          # generate + open PR with gh CLI
```

### Changelog *(Pro+)*

```bash
qc changelog                            # generate since last tag
qc changelog --from v1.0.0 --to HEAD    # specific range
qc changelog --write --version 1.1.0   # write to CHANGELOG.md
```

### Git hook

```bash
qc init                 # install prepare-commit-msg hook
qc init --uninstall     # remove hook
```

After `qc init`, every `git commit` auto-generates a message for you to review before saving.

### Team *(Team+ plan)*

```bash
qc team info                   # show team and members
qc team rules                  # view team commit rules
qc team rules --push           # push local commitlint config to team
qc team invite alice@corp.com  # invite a teammate
```

### Configuration

```bash
qc config                      # show current config
qc config set model qwen25-coder-32b
qc config set api_url https://api.quikcommit.dev
qc config reset                # reset to defaults
```

---

## Plans

| Plan | Commits/mo | PR descriptions | Changelog | Team rules |
|------|-----------|----------------|-----------|------------|
| **Free** | 50 | — | — | — |
| **Pro** | 500 | ✓ | ✓ | — |
| **Team** | 2,000 | ✓ | ✓ | ✓ |
| **Scale** | Unlimited | ✓ | ✓ | ✓ |

```bash
qc upgrade   # open billing page
```

---

## Models

| Model ID | Description | Min Plan |
|----------|-------------|----------|
| `qwen3-30b` | Fast, good quality | Free |
| `qwen25-coder-32b` | Best code understanding | Pro |
| `deepseek-r1-32b` | Reasoning model | Pro |
| `llama-3.3-70b` | Large, strong understanding | Pro |

```bash
qc --model qwen25-coder-32b          # one-time override
qc config set model qwen25-coder-32b  # set permanently
```

---

## Local / Self-Hosted (no subscription needed)

```bash
qc --use-ollama      # Ollama on localhost:11434 (codellama by default)
qc --use-lmstudio    # LM Studio on localhost:1234
qc --use-openrouter  # OpenRouter (set api_url + credentials)
qc --use-cloudflare  # Your own Cloudflare Worker
```

If no API key is stored but a local provider is configured, `qc` auto-falls back to it silently.

---

## Monorepo Support

In a pnpm / npm / yarn workspace, `qc` detects which packages have staged changes and sets the commit scope automatically:

```
packages/api/src/auth.ts staged → scope: api
packages/ui/src/button.tsx staged → scope: ui
```

---

## Excluding Files

Create a `.qcignore` in your repo root (same syntax as `.gitignore`) to prevent certain files from being included in the diff sent to the AI:

```
# .qcignore
pnpm-lock.yaml
dist/
*.min.js
```

Lock files and build output are excluded by default.

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `QC_API_KEY` | Override stored API key (useful in CI) |

```bash
QC_API_KEY=$QC_API_KEY qc --message-only
```

---

## Configuration File

Stored at `~/.config/qc/config.json`:

```jsonc
{
  "model": "qwen25-coder-32b",
  "apiUrl": "https://api.quikcommit.dev",
  "provider": "saas",
  "excludes": ["*.lock"],
  "rules": {
    "scopes": ["api", "ui", "auth"],
    "types": ["feat", "fix", "docs", "chore"],
    "maxHeaderLength": 72
  }
}
```

Credentials are stored separately at `~/.config/qc/credentials` (mode 600).

---

## Links

- [GitHub](https://github.com/whrit/quikcommit)
- [Full Documentation](https://github.com/whrit/quikcommit/tree/main/docs)
- [Getting Started](https://github.com/whrit/quikcommit/blob/main/docs/getting-started.md)
- [CLI Reference](https://github.com/whrit/quikcommit/blob/main/docs/cli-reference.md)
- [Local Providers](https://github.com/whrit/quikcommit/blob/main/docs/local-providers.md)

---

## License

MIT
