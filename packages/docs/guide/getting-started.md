# Getting Started

Get from zero to your first AI-generated commit in under 30 seconds.

## 1. Install

```bash
npm install -g @quikcommit/cli
```

Or use [Homebrew](/guide/installation#homebrew) or [download a binary](/guide/installation#binary).

## 2. Login

```bash
qc login
```

This opens your browser to sign in with GitHub or Google. Your API key is stored locally.

## 3. Commit

```bash
git add .
qc
```

Quikcommit analyzes your staged changes and generates a conventional commit message, then commits for you.

## Next Steps

- [Installation options](/guide/installation)
- [Configure commit rules](/guide/configuration)
- [Set up git hooks](/guide/git-hooks)
