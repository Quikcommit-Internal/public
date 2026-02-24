# Git Hooks

Automatically generate commit messages when you run `git commit`.

## Install Hook

```bash
qc init
```

This installs a `prepare-commit-msg` hook that runs QuikCommit before each commit. You'll see the generated message in your editor and can edit it before saving.

## Uninstall

```bash
qc init --uninstall
```

Removes the hook from your repository.
