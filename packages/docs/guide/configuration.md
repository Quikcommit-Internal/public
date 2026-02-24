# Configuration

## Config File

Configuration is stored at `~/.config/qc/config.json`.

## Show Config

```bash
qc config
```

## Set Options

```bash
# Default model (e.g. qwen25-coder-32b, llama-3.3-70b)
qc config set model qwen25-coder-32b

# API URL (for self-hosted)
qc config set api_url https://api.example.com
```

## Reset

```bash
qc config reset
```

## Commit Rules

Commit rules (scopes, types, etc.) are read from your project's commitlint config. See [Team Standards](/features/team-standards) for org-level rules.
