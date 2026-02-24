# QuikCommit

AI-powered conventional commit messages for every developer on your team.

```bash
git add .
qc
# → feat(auth): add OAuth2 login with GitHub and Google providers
```

---

## What It Does

`qc` reads your staged git diff and generates a [Conventional Commits](https://www.conventionalcommits.org/)-formatted message in seconds. It works as a SaaS CLI (sign in once, works everywhere) or entirely locally with Ollama / LM Studio / OpenRouter.

### Features

- **AI commit messages** — generates scoped, typed commit messages from your actual diff
- **PR descriptions** — summarize a branch's commits into a ready-to-use PR description
- **Changelog generation** — produce structured changelogs from commit history
- **Git hook** — install once with `qc init`, auto-generates on every `git commit`
- **Monorepo-aware** — detects workspace packages and sets the commit scope automatically
- **Team rules** — share commitlint-style rules across your whole org; every developer gets the same AI constraints
- **Local providers** — use Ollama, LM Studio, OpenRouter, or any OpenAI-compatible endpoint with no subscription

---

## Install

```bash
npm install -g @quikcommit/cli
```

Or with a pre-built binary (no Node required):

```bash
# macOS Apple Silicon
curl -fsSL https://github.com/whrit/quikcommit/releases/latest/download/qc-darwin-arm64 \
  -o /usr/local/bin/qc && chmod +x /usr/local/bin/qc

# macOS Intel
curl -fsSL https://github.com/whrit/quikcommit/releases/latest/download/qc-darwin-x64 \
  -o /usr/local/bin/qc && chmod +x /usr/local/bin/qc

# Linux x64
curl -fsSL https://github.com/whrit/quikcommit/releases/latest/download/qc-linux-x64 \
  -o /usr/local/bin/qc && chmod +x /usr/local/bin/qc
```

---

## Quick Start

```bash
qc login           # sign in via browser (GitHub or Google)
git add .
qc                 # generate + commit
qc --push          # generate, commit, and push
qc --message-only  # preview message without committing
```

---

## Commands

| Command | Description |
|---------|-------------|
| `qc` | Generate commit message from staged changes and commit |
| `qc login` | Sign in via browser (device code flow, no copy-paste) |
| `qc logout` | Clear stored credentials |
| `qc status` | Show plan, usage, and auth status |
| `qc pr` | Generate PR description from branch commits |
| `qc pr --create` | Generate PR description and open it with `gh` CLI |
| `qc changelog` | Generate changelog from commits since last tag |
| `qc changelog --write` | Generate and prepend to `CHANGELOG.md` |
| `qc init` | Install `prepare-commit-msg` git hook |
| `qc team info` | Show team info and members |
| `qc team rules` | View or push team commit rules |
| `qc team invite <email>` | Invite a teammate |
| `qc config` | View current configuration |
| `qc config set <key> <value>` | Update model, api_url, or provider |
| `qc upgrade` | Open billing page |

Full reference: [docs/cli-reference.md](./docs/cli-reference.md)

---

## Plans

| Plan | Commits/mo | PR descriptions | Changelog | Team rules |
|------|-----------|----------------|-----------|------------|
| **Free** | 50 | — | — | — |
| **Pro** | 500 | ✓ | ✓ | — |
| **Team** | 2,000 | ✓ | ✓ | ✓ |
| **Scale** | Unlimited | ✓ | ✓ | ✓ |

---

## Local / Self-Hosted

No subscription needed — point `qc` at a local model:

```bash
qc --use-ollama      # Ollama on localhost:11434
qc --use-lmstudio    # LM Studio on localhost:1234
qc --use-openrouter  # OpenRouter (bring your own key)
```

See [docs/local-providers.md](./docs/local-providers.md) for full setup.

---

## Models

| ID | Description | Plan |
|----|-------------|------|
| `qwen3-30b` | Fast, good quality | Free |
| `qwen25-coder-32b` | Best code understanding | Pro+ |
| `deepseek-r1-32b` | Reasoning model | Pro+ |
| `llama-3.3-70b` | Large, strong understanding | Pro+ |

```bash
qc --model qwen25-coder-32b
qc config set model llama-3.3-70b   # set permanently
```

---

## Team Commit Rules

On a Team plan, everyone gets the same AI constraints automatically. Push your commitlint config once:

```bash
qc team rules --push   # reads .commitlintrc.json / package.json / etc.
```

Every teammate gets it on their next `qc` run — no per-developer setup.

---

## Documentation

| Doc | Contents |
|-----|---------|
| [Getting Started](./docs/getting-started.md) | Install, login, first commit, git hook |
| [CLI Reference](./docs/cli-reference.md) | All commands and flags |
| [Configuration](./docs/configuration.md) | Config file, models, excludes, env vars |
| [Local Providers](./docs/local-providers.md) | Ollama, LM Studio, OpenRouter, custom |
| [Teams](./docs/teams.md) | Shared rules, commitlint, monorepo |
| [Architecture](./docs/architecture.md) | System design for contributors |
| [Development](./docs/development.md) | Monorepo setup, testing, releasing |

---

## Repository Structure

```
quikcommit/
├── packages/
│   ├── cli/           # @quikcommit/cli  — the qc binary (TypeScript + Bun)
│   ├── api-gateway/   # Cloudflare Worker — auth, rate limiting, billing
│   ├── ai-worker/     # Cloudflare Worker — AI inference (Cloudflare AI)
│   ├── shared/        # Shared types, constants, model catalog
│   └── dashboard/     # Web app (app.quikcommit.dev)
├── docs/              # Documentation
└── .changeset/        # Changesets for versioning
```

---

## Contributing

1. Fork and clone the repo
2. `pnpm install` (requires pnpm 10+, Node 22+)
3. `pnpm --filter @quikcommit/shared build`
4. Work in the relevant package — see [Development Guide](./docs/development.md)
5. `pnpm changeset` to describe your change
6. Open a PR

---

## License

MIT
