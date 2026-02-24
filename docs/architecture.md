# Architecture

Technical overview of how QuikCommit is built and how its components interact.

---

## System Overview

```
┌─────────────────────────────────────────────────────┐
│  Developer Machine                                   │
│                                                      │
│  git add . && qc                                     │
│         │                                            │
│  ┌──────▼──────────────────────┐                    │
│  │  @quikcommit/cli  (qc)      │                    │
│  │  - Reads staged git diff    │                    │
│  │  - Detects workspace scope  │                    │
│  │  - Calls API Gateway        │                    │
│  │  - Runs git commit          │                    │
│  └──────────────┬──────────────┘                    │
└─────────────────┼───────────────────────────────────┘
                  │ HTTPS
                  ▼
┌─────────────────────────────────────────────────────┐
│  Cloudflare Edge                                     │
│                                                      │
│  ┌───────────────────────────────────────────────┐  │
│  │  @quikcommit/api-gateway  (qc-api-gateway)    │  │
│  │                                               │  │
│  │  - Auth (Better Auth, device code flow)       │  │
│  │  - Rate limiting (per plan)                   │  │
│  │  - Usage tracking (D1 database)               │  │
│  │  - Plan enforcement                           │  │
│  │  - Routes: /v1/commit, /v1/pr, /v1/changelog  │  │
│  │                                               │  │
│  │  ┌─────────────┐  service   ┌──────────────┐  │  │
│  │  │   D1 (SQLite)│  binding  │  AI Worker   │  │  │
│  │  │   KV Store  │──────────►│  (cf-ai-     │  │  │
│  │  │   Stripe    │           │   worker)    │  │  │
│  │  └─────────────┘           └──────┬───────┘  │  │
│  └────────────────────────────────────┼──────────┘  │
│                                        │             │
│                                   ┌───▼────────┐    │
│                                   │ Cloudflare │    │
│                                   │   AI       │    │
│                                   │ (Qwen2.5,  │    │
│                                   │  LLaMA, …) │    │
│                                   └────────────┘    │
└─────────────────────────────────────────────────────┘
```

---

## Packages

### `@quikcommit/cli`

The user-facing binary installed as `qc`. Written in TypeScript, compiled to a standalone executable via Bun.

**Key responsibilities:**
- Parse command-line arguments
- Read `~/.config/qc/` for credentials and config
- Collect staged git diff (respecting excludes and `.qcignore`)
- Detect monorepo workspace and auto-set commit scope
- Call the API Gateway (or local provider)
- Run `git commit` with the generated message

**Entry point:** `packages/cli/src/index.ts`

**Commands:** login, logout, status, commit (default), pr, changelog, init, team, config, upgrade

**Local provider support:** Can bypass the SaaS API entirely and call Ollama, LM Studio, OpenRouter, or any OpenAI-compatible endpoint directly.

---

### `@quikcommit/api-gateway`

A Cloudflare Worker running at `api.quikcommit.dev`. It is the single entry point for all CLI API calls.

**Key responsibilities:**
- Authentication via Better Auth (GitHub/Google OAuth + device code flow for CLI)
- Per-plan rate limiting
- Usage counting (commits, PRs, changelogs)
- Plan enforcement (e.g., `pr` and `changelog` require Pro+)
- Model resolution (maps friendly model IDs to Cloudflare model names, validates plan access)
- Forwards generation requests to the AI Worker via Cloudflare service binding
- Billing integration via Stripe

**Routes:**

| Route | Description |
|-------|-------------|
| `GET /health` | Health check |
| `POST /v1/auth/device/start` | Begin device auth flow |
| `POST /v1/auth/device/poll` | Poll for completion |
| `POST /v1/commit` | Generate commit message |
| `POST /v1/pr` | Generate PR description (Pro+) |
| `POST /v1/changelog` | Generate changelog (Pro+) |
| `GET /v1` | Usage/plan info |
| `/v1/billing/*` | Billing management |
| `/v1/team/*` | Team management |
| `/api/auth/*` | Better Auth OAuth callbacks |
| `/webhooks` | Stripe webhooks |

**Infrastructure:**
- D1 SQLite database: users, teams, usage records
- KV: session cache, rate limit counters
- Service binding: `AI_WORKER` → `cf-ai-worker`

---

### `@quikcommit/ai-worker`

A Cloudflare Worker that interfaces with Cloudflare Workers AI to generate text. It is only callable internally via service binding from the API Gateway — it is never exposed publicly.

**Key responsibilities:**
- Build AI prompts for commit messages, PR descriptions, and changelogs
- Apply CommitRules as strict prompt constraints
- Intelligent diff truncation (fits diffs into the model's 32,768 token context window)
- Token estimation and usage diagnostics
- Extract clean commit messages from AI output (handles reasoning artifacts)

**Endpoints (internal only):**

| Endpoint | Description |
|----------|-------------|
| `POST /commit` | Generate commit message |
| `POST /pr` | Generate PR description |
| `POST /changelog` | Generate changelog |

**Default model:** `@cf/qwen/qwen2.5-coder-32b-instruct`

**Token management:**
- Context window: 32,768 tokens
- Available for diff: ~27,000 tokens (budget for system prompt, rules, overhead)
- Truncation strategy: summarizes large files first, then truncates remaining content

---

### `@quikcommit/shared`

A private TypeScript package shared between all other packages. Contains no runtime code — types, constants, and pure utility functions only.

**Exports:**
- `CommitRules`, `CommitRequest`, `PRRequest`, `ChangelogRequest` — API contract types
- `GenerationResponse`, `UsageResponse`, `ErrorResponse` — response types
- `PlanTier`, plan limits, rate limits — plan constants
- Model catalog: `MODEL_CATALOG`, `planMeetsModelTier()`, `resolveModel()`
- `DEFAULT_API_URL`, `CONFIG_DIR`, `CREDENTIALS_FILE` — path constants
- `sanitizeRules()` — input sanitization / injection prevention

---

## Authentication Flow

The CLI uses RFC 8628 device authorization grant:

```
qc login
   │
   ├─► POST /v1/auth/device/start
   │    └─ returns: { device_code, user_code, verification_uri }
   │
   ├─► Opens browser: https://app.quikcommit.dev?code=USER_CODE
   │    └─ User signs in (GitHub or Google)
   │
   └─► Polls POST /v1/auth/device/poll every 3s
        └─ Returns API key when complete
        └─ Saved to ~/.config/qc/credentials (mode 600)
```

All API calls use bearer token authentication:
```
Authorization: Bearer qck_live_...
```

---

## Plan-Based Access Control

| Feature | Free | Pro | Team | Scale |
|---------|------|-----|------|-------|
| Commit generation | ✓ (50/mo) | ✓ (500/mo) | ✓ (2000/mo) | ✓ (unlimited) |
| PR description | — | ✓ | ✓ | ✓ |
| Changelog generation | — | ✓ | ✓ | ✓ |
| Team rules | — | — | ✓ | ✓ |
| Pro models | — | ✓ | ✓ | ✓ |

Rate limits (per minute):

| Plan | Requests | Burst |
|------|----------|-------|
| Free | 10 | 15 |
| Pro | 30 | 50 |
| Team | 60 | 100 |
| Scale | 120 | 200 |

---

## Security

- Diffs are never stored; they are processed in memory and discarded
- API keys are stored with mode 600 (user-only readable)
- The AI Worker is not publicly routable — only accessible via service binding
- All CommitRules input is sanitized (`sanitizeRules()`) before being included in prompts to prevent prompt injection
- Request bodies are capped (1 MB for commits/PRs, 256 KB for changelogs)
- HSTS, X-Frame-Options, and X-Content-Type-Options headers on all responses
