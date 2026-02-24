# Commit API

**POST** `/v1/commit`

Generate a conventional commit message from a git diff.

## Request

```json
{
  "diff": "diff --git a/file.ts b/file.ts...",
  "changes": "M file.ts",
  "rules": { "scopes": ["api"], "types": ["feat", "fix"] },
  "model": "qwen25-coder-32b"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| diff | string | ✓ | Git diff output |
| changes | string | ✓ | `git diff --name-status` output |
| rules | object | | Commitlint rules |
| model | string | | Model ID (default: tier-based) |

## Response

```json
{
  "message": "feat(api): add new endpoint",
  "diagnostics": { "model": "@cf/qwen/...", "tokens_used": 150 }
}
```
