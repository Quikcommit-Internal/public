# PR API

**POST** `/v1/pr`

Generate a PR description from commits and diff stat.

## Request

```json
{
  "commits": ["feat: add x", "fix: resolve y"],
  "diff_stat": "3 files changed, 45 insertions(+)",
  "base_branch": "main",
  "model": "qwen25-coder-32b"
}
```

## Response

```json
{
  "message": "## Summary\n\n..."
}
```
