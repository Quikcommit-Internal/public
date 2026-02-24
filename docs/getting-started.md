# Getting Started with QuikCommit

QuikCommit (`qc`) is an AI-powered CLI that generates [Conventional Commits](https://www.conventionalcommits.org/) from your staged git diff. It takes seconds to set up and works in any git repository.

---

## 1. Install

### Option A — npm / bun (recommended)

```bash
npm install -g @quikcommit/cli
# or
bun add -g @quikcommit/cli
```

### Option B — install script

```bash
curl -fsSL https://quikcommit.dev/install | sh
```

### Option C — pre-built binary (no Node/Bun required)

Download from [GitHub Releases](https://github.com/Quikcommit-Internal/public/releases/latest):

| Platform     | File               |
|--------------|--------------------|
| macOS ARM64  | `qc-darwin-arm64`  |
| macOS x64    | `qc-darwin-x64`    |
| Linux x64    | `qc-linux-x64`     |
| Linux ARM64  | `qc-linux-arm64`   |

```bash
# Example: macOS Apple Silicon
curl -fsSL https://github.com/Quikcommit-Internal/public/releases/latest/download/qc-darwin-arm64 \
  -o /usr/local/bin/qc
chmod +x /usr/local/bin/qc
```

Verify installation:

```bash
qc --help
```

---

## 2. Authenticate

QuikCommit uses a browser-based device code flow — no copy-pasting tokens:

```bash
qc login
```

This will:
1. Open your browser to `https://app.quikcommit.dev`
2. Prompt you to sign in (GitHub or Google)
3. Automatically save your API key to `~/.config/qc/credentials`

Check that it worked:

```bash
qc status
# → Logged in as you@example.com (free plan, 47/50 commits remaining)
```

---

## 3. Generate your first commit

```bash
git add .          # stage your changes as normal
qc                 # AI generates and commits
```

That's it. QuikCommit reads your staged diff, calls the AI, and runs `git commit` with the generated message.

### Preview before committing

```bash
qc --message-only   # prints the message, does NOT commit
```

### Commit and push in one step

```bash
qc --push
```

---

## 4. Optional: git hook (auto-generate on every commit)

```bash
qc init
```

This installs a `prepare-commit-msg` hook. From now on, running a plain `git commit` will automatically pre-fill the commit message with an AI-generated suggestion that you can edit before saving.

To remove the hook:

```bash
qc init --uninstall
```

---

## Plans

| Plan  | Commits/mo | PR descriptions | Changelog | Team rules |
|-------|-----------|----------------|-----------|------------|
| Free  | 50        | —              | —         | —          |
| Pro   | 500       | ✓              | ✓         | —          |
| Team  | 2,000     | ✓              | ✓         | ✓          |
| Scale | Unlimited | ✓              | ✓         | ✓          |

```bash
qc upgrade   # opens billing page in browser
```

---

## Next Steps

- [CLI Reference](./cli-reference.md) — all commands and flags
- [Configuration](./configuration.md) — models, API URL, excludes
- [Local Providers](./local-providers.md) — use Ollama, LMStudio, or OpenRouter without a subscription
- [Teams](./teams.md) — shared commit rules for your org
