# CLI Reference

## Commands

| Command | Description |
|---------|-------------|
| `qc` | Generate commit and commit (default) |
| `qc pr` | Generate PR description |
| `qc changelog` | Generate changelog |
| `qc init` | Install git hook |
| `qc login` | Sign in |
| `qc logout` | Clear credentials |
| `qc status` | Show auth and usage |
| `qc team` | Team management |
| `qc config` | Show/set config |
| `qc upgrade` | Open billing page |

## Options

| Option | Description |
|--------|-------------|
| `-h, --help` | Show help |
| `-m, --message-only` | Generate only, no commit |
| `-p, --push` | Push after commit |
| `--model <id>` | Use specific model |
| `--api-key <key>` | Override API key |
| `--base <branch>` | Base for `qc pr` |
| `--create` | Create PR with gh |
| `--from <ref>` | Start ref for changelog |
| `--to <ref>` | End ref for changelog |
| `--write` | Write changelog to file |
| `--version <ver>` | Changelog version label |
| `--uninstall` | Remove git hook |
