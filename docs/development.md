# Development Guide

How to set up the Quikcommit monorepo locally, run tests, and contribute.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| [Node.js](https://nodejs.org) | 22+ | CLI build |
| [pnpm](https://pnpm.io) | 10+ | Package manager |
| [Bun](https://bun.sh) | Latest | CLI binary compilation |
| [Wrangler](https://developers.cloudflare.com/workers/wrangler/) | 4+ | Cloudflare Workers dev/deploy |

Install pnpm if needed:
```bash
npm install -g pnpm@10
```

---

## Monorepo Structure

```
quikcommit/
├── packages/
│   ├── cli/           # @quikcommit/cli  — the qc binary
│   ├── api-gateway/   # @quikcommit/api-gateway  — Cloudflare Worker (auth, routing, billing)
│   ├── ai-worker/     # @quikcommit/ai-worker  — Cloudflare Worker (AI inference)
│   ├── shared/        # @quikcommit/shared  — shared types, constants, rules
│   ├── dashboard/     # @quikcommit/dashboard  — web app (app.quikcommit.dev)
│   └── docs/          # documentation site
├── .changeset/        # changesets for versioning
├── .github/workflows/ # CI, version, release pipelines
└── docs/              # this documentation
```

---

## Setup

```bash
git clone https://github.com/Quikcommit-Internal/quikcommit.git
cd quikcommit
pnpm install
```

Build the shared package (required before working on CLI, api-gateway, or ai-worker):

```bash
pnpm --filter @quikcommit/shared build
```

---

## Running Each Package

### CLI

```bash
# Build
pnpm --filter @quikcommit/cli build

# Run locally (from monorepo root)
node packages/cli/dist/index.js --help

# Or link globally for testing
cd packages/cli && npm link

# Watch mode (during development)
cd packages/cli && node build.mjs --watch
```

### AI Worker

```bash
cd packages/ai-worker

# Start local dev server
pnpm dev      # wrangler dev on http://localhost:8787

# Run tests
pnpm test

# Deploy to Cloudflare
pnpm deploy
```

### API Gateway

```bash
cd packages/api-gateway

# Start local dev server
pnpm dev      # wrangler dev on http://localhost:8788

# Deploy to Cloudflare
pnpm deploy
```

### Dashboard

```bash
cd packages/dashboard
pnpm dev      # local dev server
pnpm build    # production build
```

---

## Testing

Run all tests:
```bash
pnpm test
```

Run tests for a specific package:
```bash
pnpm --filter @quikcommit/cli test
pnpm --filter @quikcommit/ai-worker test
pnpm --filter @quikcommit/api-gateway test
```

### AI Worker tests

The AI worker tests use `@cloudflare/vitest-pool-workers`, which starts a remote proxy session against Cloudflare. You need real credentials:

```bash
export CLOUDFLARE_ACCOUNT_ID=your-account-id
export CLOUDFLARE_API_TOKEN=your-api-token
pnpm --filter @quikcommit/ai-worker test
```

---

## Typechecking

```bash
# All packages
pnpm typecheck

# Single package
pnpm --filter @quikcommit/cli typecheck
```

---

## Linting

```bash
pnpm lint
```

---

## Building for Release

```bash
# Build everything
pnpm build

# Build CLI binary for local platform (requires Bun)
cd packages/cli
bun build src/index.ts --compile --target=bun-darwin-arm64 --outfile=qc-darwin-arm64
```

---

## Versioning & Releases

This repo uses [Changesets](https://github.com/changesets/changesets).

### Creating a changeset

After making changes, describe them:

```bash
pnpm changeset
```

Follow the interactive prompts to select changed packages and bump type (patch/minor/major).

### Version bump (maintainers)

Changesets are collected in `.changeset/`. When the version PR is merged to `main`, the CI automatically:
1. Bumps package versions
2. Updates `CHANGELOG.md` files
3. Publishes to npm
4. Pushes git tags (e.g. `@quikcommit/cli@1.1.0`)
5. Triggers the release workflow to build binaries

### Manual release trigger

If you need to re-trigger a release after a failed run:

```bash
# Delete and re-push the tag
git tag -d "@quikcommit/cli@1.0.0"
git push origin ":refs/tags/@quikcommit/cli@1.0.0"
git tag -a "@quikcommit/cli@1.0.0" <commit-sha> -m "@quikcommit/cli@1.0.0"
git push origin "@quikcommit/cli@1.0.0"
```

---

## CI/CD

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `ci.yml` | PR to `main` | Lint, typecheck, test, build |
| `version.yml` | Push to `main` | Creates version PR via changesets; publishes on merge |
| `release.yml` | Tag push (`@quikcommit/*@*`) | Builds binaries, creates GitHub Release, deploys Workers |

### Required GitHub Secrets

| Secret | Used for |
|--------|---------|
| `NPM_TOKEN` | Publishing to npm |
| `CLOUDFLARE_API_TOKEN` | Deploying Workers, ai-worker tests |
| `CLOUDFLARE_ACCOUNT_ID` | Deploying Workers, ai-worker tests |

See [GITHUB-RELEASE-SETUP.md](./GITHUB-RELEASE-SETUP.md) for full setup instructions.

---

## Architecture

See [architecture.md](./architecture.md) for a full technical overview of how the components interact.

---

## Contributing

1. Fork the repo and create a feature branch
2. Make changes; ensure `pnpm typecheck` and `pnpm test` pass
3. Run `pnpm changeset` to document your change
4. Open a PR against `main`

Please follow Conventional Commits for your commit messages (or just use `qc`).
