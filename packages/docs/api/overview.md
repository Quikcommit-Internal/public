# API Overview

The QuikCommit API is RESTful and uses Bearer token authentication.

**Base URL:** `https://api.quikcommit.dev`

**Authentication:** `Authorization: Bearer <api_key>`

## Endpoints

- [POST /v1/commit](/api/commit) — Generate commit message
- [POST /v1/pr](/api/pr) — Generate PR description
- [POST /v1/changelog](/api/changelog) — Generate changelog
- [GET /v1/usage](/api/usage) — Get usage stats

## Rate Limits

Rate limits vary by plan. See [Pricing](/pricing).
