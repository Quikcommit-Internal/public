# Monorepo Support

QuikCommit auto-detects monorepo structure (pnpm/yarn/npm workspaces) and suggests scopes from the packages you changed.

## Auto-Scope

When you change files in `packages/api` and `packages/cli`, QuikCommit detects the scopes and includes them in the commit message:

```
feat(api,cli): add new endpoint
```

## Workspace Detection

Looks for `pnpm-workspace.yaml`, `package.json` workspaces, or `lerna.json`.
