# PR API

**POST** `/v1/pr`

Generate a PR title and markdown body from commits and a diff stat (Pro+).

## Request

Required fields: `commits` (non-empty `string[]`), `diff_stat` (non-empty string), `base_branch` (string, defaults to `main` on the server if omitted).

Optional fields:

| Field | Type | Description |
|-------|------|-------------|
| `model` | string | Model id (plan-gated); forwarded as worker model hint. |
| `rules` | object | Commitlint-style `CommitRules` for type/scope hints in the description. |
| `pr_template` | string | Repo PR template body (max **16KB**); when set, the worker uses strict template instructions. |
| `current_branch` | string | Current branch name for template checkbox context; capped at **256** characters when forwarded. |

Example:

```json
{
  "commits": ["feat: add x", "fix: resolve y"],
  "diff_stat": "3 files changed, 45 insertions(+)",
  "base_branch": "main",
  "current_branch": "feat/my-feature",
  "pr_template": "## Summary\n- \n",
  "model": "qwen25-coder-32b"
}
```

## Response

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | One-line PR title (from the model’s `TITLE:` line, or a fallback). |
| `message` | string | Markdown PR body. May be an empty string when the model returns only a title line. |

Example:

```json
{
  "title": "feat: add x and fix resolve y",
  "message": "## Summary\n\n..."
}
```

## CLI template discovery

When using `qc pr`, the CLI looks for a template in this order (first file found wins):

1. `.github/pull_request_template.md`
2. `.github/PULL_REQUEST_TEMPLATE.md`
3. `pull_request_template.md` (repository root)
4. `docs/pull_request_template.md`
5. First `*.md` file (alphabetically) under `.github/PULL_REQUEST_TEMPLATE/`

The template is truncated to 16KB before sending to the API.
