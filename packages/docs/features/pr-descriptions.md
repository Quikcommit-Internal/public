# PR Descriptions

Generate pull request descriptions from your branch commits.

## Usage

```bash
qc pr
```

Uses commits on the current branch vs `main` (or `--base`).

## Create PR with gh

```bash
qc pr --create
```

Generates the description and creates the PR with `gh pr create`.

## Base Branch

```bash
qc pr --base develop
```
