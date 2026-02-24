# Changelogs

Generate changelog entries from commits since the last tag.

## Usage

```bash
qc changelog
```

Uses commits between the latest tag and HEAD.

## Custom Range

```bash
qc changelog --from v1.0.0 --to HEAD
```

## Write to File

```bash
qc changelog --write
```

Prepends the changelog entry to `CHANGELOG.md` in your git root.

## Version Label

```bash
qc changelog --version 1.2.0
```
