import { getConfig, saveConfig, getApiKey } from "../config.js";
import { DEFAULT_API_URL } from "@quikcommit/shared";
import type { LocalConfig } from "../config.js";

export function config(args: string[]): void {
  if (args.length === 0) {
    showConfig();
    return;
  }

  const sub = args[0];
  if (sub === "set") {
    const key = args[1];
    const value = args[2];
    if (!key || !value) {
      console.error("Usage: qc config set <key> <value>");
      console.error("  Keys: model, api_url, provider, auto_stage");
      process.exit(1);
    }
    setConfig(key, value);
    return;
  }

  if (sub === "reset") {
    resetConfig();
    return;
  }

  console.error(`Unknown subcommand: ${sub}`);
  console.error("Usage: qc config [set <key> <value> | reset]");
  process.exit(1);
}

function showConfig(): void {
  const cfg = getConfig();
  const apiKey = getApiKey();
  console.log("Current configuration:");
  console.log(`  model:    ${cfg.model ?? "(default for plan)"}`);
  console.log(`  api_url:  ${cfg.apiUrl ?? DEFAULT_API_URL}`);
  console.log(`  provider:   ${cfg.provider ?? "(default)"}`);
  console.log(`  auto_stage: ${cfg.autoStage ? "true" : "false"}`);
  console.log(`  auth:       ${apiKey ? "****" : "not set"}`);
  if (cfg.excludes?.length) {
    console.log(`  excludes: ${cfg.excludes.join(", ")}`);
  }
}

function setConfig(key: string, value: string): void {
  const cfg = getConfig();
  const updates: Partial<LocalConfig> = {};

  if (key === "model") {
    updates.model = value;
  } else if (key === "provider") {
    const v = value.toLowerCase();
    // "cloud" clears local provider config → uses Cloudflare SaaS
    if (v === "cloud" || v === "cloudflare-saas") {
      const { provider: _, apiUrl: __, model: ___, ...rest } = cfg;
      saveConfig(rest);
      console.log("Switched to Cloudflare SaaS (default).");
      return;
    }
    // Local providers — set URL + model defaults automatically
    const providers: Record<string, { provider: LocalConfig["provider"]; apiUrl: string; model: string }> = {
      ollama:     { provider: "ollama",     apiUrl: "http://localhost:11434",       model: "codellama" },
      lmstudio:   { provider: "lmstudio",   apiUrl: "http://localhost:1234/v1",     model: "default" },
      openrouter: { provider: "openrouter", apiUrl: "https://openrouter.ai/api/v1", model: "google/gemini-flash-1.5-8b" },
      custom:     { provider: "custom",     apiUrl: cfg.apiUrl ?? "",               model: cfg.model ?? "" },
      cloudflare: { provider: "cloudflare", apiUrl: cfg.apiUrl ?? "",               model: "@cf/qwen/qwen2.5-coder-32b-instruct" },
    };
    const preset = providers[v];
    if (!preset) {
      console.error(`Unknown provider: ${v}`);
      console.error("  Options: cloud, ollama, lmstudio, openrouter, custom, cloudflare");
      process.exit(1);
    }
    saveConfig({ ...cfg, ...preset });
    console.log(`Provider set to ${preset.provider} (${preset.apiUrl || "set api_url next"}).`);
    if (v === "cloudflare" && !cfg.apiUrl) {
      console.log("  Next: qc config set api_url https://your-worker.workers.dev");
    }
    return;
  } else if (key === "api_url") {
    try {
      new URL(value);
      updates.apiUrl = value;
    } catch {
      console.error("Invalid URL:", value);
      process.exit(1);
    }
  } else if (key === "auto_stage") {
    updates.autoStage = value === "true" || value === "1";
  } else {
    console.error(`Unknown key: ${key}`);
    console.error("  Keys: model, api_url, provider, auto_stage");
    process.exit(1);
  }

  saveConfig({ ...cfg, ...updates });
  console.log(`Set ${key} = ${value}`);
}

function resetConfig(): void {
  saveConfig({});
  console.log("Config reset to defaults.");
}
