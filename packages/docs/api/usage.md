# Usage API

**GET** `/v1/usage`

Get current usage and plan limits.

## Response

```json
{
  "plan": "pro",
  "period": "2025-02",
  "commit_count": 42,
  "pr_count": 5,
  "changelog_count": 2,
  "limit": 500,
  "remaining": 451
}
```
