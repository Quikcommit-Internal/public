# Changelog API

**POST** `/v1/changelog`

Generate a changelog entry from commits grouped by type.

## Request

```json
{
  "commits_by_type": {
    "feat": ["feat(api): add endpoint"],
    "fix": ["fix: resolve bug"]
  },
  "from_tag": "v1.0.0",
  "to_ref": "HEAD"
}
```

## Response

```json
{
  "message": "### Features\n- add endpoint\n\n### Bug Fixes\n- resolve bug"
}
```
