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
      console.error("  Keys: model, api_url, provider");
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
  console.log(`  provider: ${cfg.provider ?? "(default)"}`);
  console.log(`  auth:     ${apiKey ? "****" : "not set"}`);
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
    const valid = ["ollama", "lmstudio", "openrouter", "custom", "cloudflare"];
    if (!valid.includes(value.toLowerCase())) {
      console.error(`Invalid provider. Must be one of: ${valid.join(", ")}`);
      process.exit(1);
    }
    updates.provider = value.toLowerCase() as LocalConfig["provider"];
  } else if (key === "api_url") {
    try {
      new URL(value);
      updates.apiUrl = value;
    } catch {
      console.error("Invalid URL:", value);
      process.exit(1);
    }
  } else {
    console.error(`Unknown key: ${key}`);
    console.error("  Keys: model, api_url, provider");
    process.exit(1);
  }

  saveConfig({ ...cfg, ...updates });
  console.log(`Set ${key} = ${value}`);
}

function resetConfig(): void {
  saveConfig({});
  console.log("Config reset to defaults.");
}
