# Authentication

QuikCommit uses the SaaS API for AI generation. Sign in once and your credentials are stored locally.

## Login

```bash
qc login
```

Opens your browser to sign in with GitHub or Google. Your API key is stored at `~/.config/qc/credentials`.

## Logout

```bash
qc logout
```

Clears stored credentials.

## Status

```bash
qc status
```

Shows your auth state, plan, and usage for the current period.

## API Key

You can also set the API key via environment variable:

```bash
export QC_API_KEY=qc_...
qc
```

Or pass it directly:

```bash
qc --api-key qc_...
```
