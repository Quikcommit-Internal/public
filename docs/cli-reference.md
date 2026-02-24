# CLI Reference

Complete reference for all `qc` commands and flags.

---

## Synopsis

```
qc [command] [options]
```

Running `qc` with no arguments generates a commit message from staged changes and commits.

---

## Global Options

| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show help |
| `--message-only` | `-m` | Generate message, print to stdout, do not commit |
| `--push` | `-p` | Commit then push to origin |
| `--api-key <key>` | | Use this API key for this invocation (overrides stored credentials) |
| `--model <id>` | | Use a specific AI model for this invocation |
| `--local` | | Use locally configured provider instead of SaaS API |

---

## Commands

### `qc` (default — generate commit)

Reads staged changes, generates a Conventional Commits message, and runs `git commit`.

```bash
git add src/
qc
```

**Flags:**

| Flag | Description |
|------|-------------|
| `-m`, `--message-only` | Print generated message only, do not commit |
| `-p`, `--push` | Commit and push to origin after committing |
| `--model <id>` | Override model for this commit |
| `--api-key <key>` | Override API key |

**Examples:**

```bash
qc                          # generate + commit
qc --message-only           # preview only
qc --push                   # commit + push
qc --model llama-3.3-70b    # use a specific model
```

---

### `qc login`

Authenticate via browser using device code flow.

```bash
qc login
```

Opens `https://app.quikcommit.dev` in your browser. Sign in with GitHub or Google. Your API key is saved automatically to `~/.config/qc/credentials`.

---

### `qc logout`

Remove stored credentials.

```bash
qc logout
```

Deletes `~/.config/qc/credentials`. You will need to run `qc login` again before generating commits.

---

### `qc status`

Show authentication status, plan, and usage.

```bash
qc status
```

**Output includes:**
- Login state and masked API key
- Current plan tier (free / pro / team / scale)
- Commit count and monthly limit
- Remaining quota

---

### `qc pr`

Generate a PR description from commits on the current branch.

```bash
qc pr
qc pr --base develop
qc pr --create
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--base <branch>` | `main` | Base branch to compare against |
| `--create` | | Create the PR using `gh` CLI after generating the description |
| `--model <id>` | config | AI model to use |

**Requirements:** Pro plan or higher.

**How it works:**
1. Gets all commits on current branch since it diverged from `--base`
2. Gets the diff stat summary
3. Calls the AI to write a structured PR description
4. Prints the description (and optionally runs `gh pr create`)

**Example:**

```bash
git checkout -b feat/new-login
# ... make changes, commit ...
qc pr --base main --create
```

---

### `qc changelog`

Generate a changelog from commits since the last git tag (or a specified range).

```bash
qc changelog
qc changelog --from v1.0.0 --to v1.1.0
qc changelog --write --version 1.1.0
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--from <ref>` | latest git tag | Start of commit range |
| `--to <ref>` | `HEAD` | End of commit range |
| `--write` | | Prepend generated changelog to `CHANGELOG.md` |
| `--version <ver>` | derived from `--to` | Version label for the changelog header |
| `--model <id>` | config | AI model to use |

**Requirements:** Pro plan or higher.

**Example:**

```bash
qc changelog --from v1.0.0 --to HEAD --write --version 1.1.0
```

This generates a changelog entry grouped by commit type (Features, Bug Fixes, etc.) and prepends it to `CHANGELOG.md`.

---

### `qc init`

Install (or uninstall) a `prepare-commit-msg` git hook that auto-generates commit messages.

```bash
qc init             # install hook
qc init --uninstall # remove hook
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--uninstall` | Remove the Quikcommit hook |

**How it works:**

After running `qc init`, every `git commit` invocation will:
1. Detect staged changes
2. Call `qc --message-only --hook-mode` to generate a message
3. Pre-fill the commit editor with the generated message
4. Let you edit or accept before saving

The hook will not overwrite an existing hook that wasn't installed by Quikcommit.

---

### `qc team`

Manage your team. **Team plan or higher required.**

#### `qc team info`

Show your team name, plan, and member list.

```bash
qc team info
```

#### `qc team rules`

Show the team's shared commit rules, or push your local commitlint config to the team.

```bash
qc team rules          # show team rules
qc team rules --push   # push local commitlint config to team
```

Quikcommit reads your local commitlint config automatically from any of:
- `.commitlintrc.json` / `.commitlintrc.js` / `.commitlintrc.cjs`
- `.commitlintrc.yaml` / `.commitlintrc.yml`
- `commitlint.config.js`
- `package.json` → `commitlint` key

#### `qc team invite <email>`

Invite a teammate by email.

```bash
qc team invite alice@example.com
```

---

### `qc config`

View or update local configuration.

#### `qc config` (show)

```bash
qc config
```

Displays current model, API URL, provider, auth status, and any excludes.

#### `qc config set <key> <value>`

```bash
qc config set model qwen25-coder-32b
qc config set api_url https://api.quikcommit.dev
qc config set provider saas
```

Valid keys: `model`, `api_url`, `provider`

#### `qc config reset`

```bash
qc config reset
```

Clears all config back to defaults.

---

### `qc upgrade`

Open the billing page in your browser.

```bash
qc upgrade
```

Opens `https://app.quikcommit.dev/billing`.

---

## Local / Self-Hosted Providers

Use a local AI provider without a subscription:

```bash
qc --local                # use whatever provider is in config
qc --use-ollama           # Ollama on localhost:11434
qc --use-lmstudio         # LM Studio on localhost:1234
qc --use-openrouter       # OpenRouter (requires API key in config)
qc --use-cloudflare       # Your own Cloudflare Worker
```

See [Local Providers](./local-providers.md) for detailed setup.

---

## Available Models

| Model ID | Description | Min Plan |
|----------|-------------|----------|
| `qwen3-30b` | Fast, good quality | Free (default) |
| `qwen25-coder-32b` | Best code understanding | Pro |
| `deepseek-r1-32b` | Reasoning model | Pro |
| `llama-3.3-70b` | Large model, strong understanding | Pro |

```bash
qc --model qwen25-coder-32b
# or set permanently:
qc config set model qwen25-coder-32b
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `QC_API_KEY` | API key (overrides stored credentials) |

```bash
QC_API_KEY=qck_... qc --message-only
```
