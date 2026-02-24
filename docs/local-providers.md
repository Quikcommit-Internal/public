# Local Providers

Use QuikCommit without a SaaS subscription by pointing it at a local or self-hosted AI provider. No API key required.

---

## Quick Setup

### Ollama (recommended for local)

1. Install [Ollama](https://ollama.ai)
2. Pull a code-focused model:
   ```bash
   ollama pull codellama
   # or for better results:
   ollama pull qwen2.5-coder
   ```
3. Configure QuikCommit:
   ```bash
   qc --use-ollama
   ```
   This sets `provider=ollama`, `apiUrl=http://localhost:11434`, `model=codellama` in your config.

4. From now on, `qc` uses Ollama automatically (no `--use-ollama` needed):
   ```bash
   qc
   ```

---

### LM Studio

1. Install [LM Studio](https://lmstudio.ai) and start the local server
2. Configure QuikCommit:
   ```bash
   qc --use-lmstudio
   ```
   Sets `provider=lmstudio`, `apiUrl=http://localhost:1234/v1`, `model=default`.

---

### OpenRouter

1. Get an API key at [openrouter.ai](https://openrouter.ai)
2. Configure:
   ```bash
   qc --use-openrouter
   qc config set api_url https://openrouter.ai/api/v1
   # Store your OpenRouter key as the qc API key:
   # (edit ~/.config/qc/credentials directly with your openrouter key)
   ```
   Sets `provider=openrouter`, default model `google/gemini-flash-1.5-8b`.

3. Change the model:
   ```bash
   qc config set model anthropic/claude-3-haiku
   ```

---

### Cloudflare Workers AI (your own worker)

1. Deploy the `@quikcommit/ai-worker` package to your Cloudflare account:
   ```bash
   cd packages/ai-worker
   pnpm deploy
   ```
2. Configure:
   ```bash
   qc --use-cloudflare
   qc config set api_url https://YOUR-WORKER.workers.dev
   ```

---

### Custom OpenAI-compatible endpoint

Any OpenAI-compatible API (`/chat/completions` or `/completions`) works:

```bash
qc config set provider custom
qc config set api_url https://your-llm-server.example.com/v1
qc config set model your-model-name
```

Store your API key:
```bash
# Edit ~/.config/qc/credentials directly with your key
echo "your-api-key" > ~/.config/qc/credentials
chmod 600 ~/.config/qc/credentials
```

---

## Auto-Fallback

If you have no SaaS API key but a local provider is configured, `qc` will automatically use the local provider without any flags:

```bash
# No qc login, but Ollama is configured → works transparently
qc
```

---

## Switching Back to SaaS

```bash
qc config set provider saas
qc config set api_url https://api.quikcommit.dev
```

Or just log in again:
```bash
qc login
```

---

## Provider Comparison

| Provider | Cost | Privacy | Speed | Code Quality |
|----------|------|---------|-------|-------------|
| QuikCommit SaaS | Subscription | Cloud | Fast | Excellent |
| Ollama (local) | Free | Local | Medium | Good |
| LM Studio (local) | Free | Local | Medium | Good |
| OpenRouter | Pay-per-use | Cloud | Fast | Varies by model |
| Your Cloudflare Worker | Cloudflare AI pricing | Cloud | Fast | Excellent |

---

## Troubleshooting Local Providers

### Ollama: "connection refused"

Make sure Ollama is running:
```bash
ollama serve
```

### LM Studio: no response

Ensure the local server is started in LM Studio (Server tab → Start Server).

### Model not found

Check available models:
```bash
ollama list   # for Ollama
```

Then set the correct model name:
```bash
qc config set model qwen2.5-coder
```
