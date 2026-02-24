# Commit Messages

QuikCommit generates conventional commit messages from your staged changes.

## Usage

```bash
git add .
qc
```

Or generate only (no commit):

```bash
qc --message-only
```

## Format

Messages follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>
```

## Models

Use `--model` to select a different AI model:

```bash
qc --model qwen25-coder-32b
qc --model llama-3.3-70b
```

Pro+ plans can use premium models. See [Pricing](/pricing) for tier details.
