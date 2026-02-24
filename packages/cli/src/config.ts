import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  type CommitRules,
  CONFIG_DIR,
  CREDENTIALS_FILE,
  CONFIG_FILE,
} from "@quikcommit/shared";

const CONFIG_PATH = join(homedir(), CONFIG_DIR);
const CREDENTIALS_PATH = join(CONFIG_PATH, CREDENTIALS_FILE);
const CONFIG_JSON_PATH = join(CONFIG_PATH, CONFIG_FILE);

export function getApiKey(): string | null {
  const envKey = process.env.QC_API_KEY;
  if (envKey?.trim()) return envKey.trim();

  try {
    if (existsSync(CREDENTIALS_PATH)) {
      return readFileSync(CREDENTIALS_PATH, "utf-8").trim() || null;
    }
  } catch {
    // Ignore read errors
  }
  return null;
}

export function saveApiKey(key: string): void {
  mkdirSync(CONFIG_PATH, { recursive: true, mode: 0o700 });
  writeFileSync(CREDENTIALS_PATH, key.trim(), { mode: 0o600 });
}

export function clearApiKey(): void {
  try {
    if (existsSync(CREDENTIALS_PATH)) {
      unlinkSync(CREDENTIALS_PATH);
    }
  } catch {
    // Ignore
  }
}

export type LocalProvider =
  | "ollama"
  | "lmstudio"
  | "openrouter"
  | "custom"
  | "cloudflare";

export interface LocalConfig {
  apiUrl?: string;
  excludes?: string[];
  model?: string;
  provider?: LocalProvider;
  rules?: CommitRules;
}

export function getConfig(): LocalConfig {
  try {
    if (existsSync(CONFIG_JSON_PATH)) {
      const raw = readFileSync(CONFIG_JSON_PATH, "utf-8");
      return JSON.parse(raw) as LocalConfig;
    }
  } catch {
    // Ignore
  }
  return {};
}

export function saveConfig(config: LocalConfig): void {
  mkdirSync(CONFIG_PATH, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_JSON_PATH, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}
