/**
 * Local mode: direct provider API (Ollama, LMStudio, OpenRouter, etc.)
 * No SaaS gateway, no auth required. Port of git-commit.sh provider logic.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getConfig, getApiKey, type LocalProvider } from "./config.js";
import { CONFIG_DIR, type CommitGenerationHints } from "@quikcommit/shared";
import {
  isGitRepo,
  getStagedDiff,
  getStagedFiles,
  hasStagedChanges,
  gitCommit,
  gitPush,
  getRecentBranchCommits,
} from "./git.js";
import { detectWorkspace, autoDetectScope } from "./monorepo.js";
import { detectCommitlintRules } from "./commitlint.js";
import { preprocessDiff } from "./smart-diff.js";
import { getUI } from "./ui.js";
import type { CommitRules } from "@quikcommit/shared";
import {
  applyCliTypeScopeToRules,
  generationHintsFromArgs,
  interactiveRefineMessage,
  confirmCommit,
  shouldSkipTTYInteraction,
  logVerboseDiagnostics,
  createSilentLog,
  displayCommitMessage,
} from "./commit-helpers.js";

/** Subset of CLI flags used by local commit (avoids circular import with `index.ts`). */
export interface LocalCommitOptions {
  messageOnly: boolean;
  push: boolean;
  model?: string;
  exclude: string[];
  noSmartDiff: boolean;
  noContext: boolean;
  type?: string;
  scope?: string;
  split: boolean;
  forceBody: boolean;
  interactive: boolean;
  confirm: boolean;
  verbose: boolean;
  quiet: boolean;
  hookMode?: boolean;
  dryRun: boolean;
}

const CONFIG_PATH = join(homedir(), CONFIG_DIR);

const PROVIDER_URLS: Record<LocalProvider, string> = {
  ollama: "http://localhost:11434",
  lmstudio: "http://localhost:1234/v1",
  openrouter: "https://openrouter.ai/api/v1",
  custom: "",
  cloudflare: "",
};

const DEFAULT_MODELS: Record<LocalProvider, string> = {
  ollama: "codellama",
  lmstudio: "default",
  openrouter: "google/gemini-flash-1.5-8b",
  custom: "",
  cloudflare: "@cf/qwen/qwen2.5-coder-32b-instruct",
};

function getLegacyProvider(): LocalProvider | null {
  try {
    const p = join(CONFIG_PATH, "provider");
    if (existsSync(p)) {
      const v = readFileSync(p, "utf-8").trim().toLowerCase();
      if (["ollama", "lmstudio", "openrouter", "custom", "cloudflare"].includes(v)) {
        return v as LocalProvider;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function getLegacyBaseUrl(provider: LocalProvider): string {
  try {
    const p = join(CONFIG_PATH, "base_url");
    if (existsSync(p)) {
      return readFileSync(p, "utf-8").trim();
    }
  } catch {
    // ignore
  }
  return PROVIDER_URLS[provider] ?? "";
}

function getLegacyModel(provider: LocalProvider): string {
  try {
    const p = join(CONFIG_PATH, "model");
    if (existsSync(p)) {
      const v = readFileSync(p, "utf-8").trim();
      if (v) return v;
    }
  } catch {
    // ignore
  }
  return DEFAULT_MODELS[provider] ?? "";
}

export function getLocalProviderConfig(): {
  provider: LocalProvider;
  baseUrl: string;
  model: string;
  apiKey: string | null;
} | null {
  const config = getConfig();
  const provider = config.provider ?? getLegacyProvider();
  if (!provider) return null;

  const baseUrl =
    config.apiUrl ?? getLegacyBaseUrl(provider) ?? PROVIDER_URLS[provider] ?? "";
  if (!baseUrl) return null;
  const model = config.model ?? getLegacyModel(provider) ?? DEFAULT_MODELS[provider];
  const apiKey = provider === "openrouter" || provider === "custom" ? getApiKey() : null;

  if (provider === "openrouter" && !apiKey) return null;

  return { provider, baseUrl, model, apiKey };
}

function buildUserPrompt(
  changes: string,
  diff: string,
  rules: Record<string, unknown> | undefined,
  recentCommits: string[] | undefined,
  hints: CommitGenerationHints | undefined
): string {
  let prompt = `Generate a commit message for these changes:

## File changes:
<file_changes>
${changes}
</file_changes>

## Diff:
<diff>
${diff}
</diff>

`;
  if (recentCommits && recentCommits.length > 0) {
    const history = recentCommits.slice(0, 10).join("\n");
    prompt += `Recent commits on this branch (match style when appropriate):\n${history}\n\n`;
  }
  if (hints?.split) {
    prompt += `MULTI-COMMIT MODE: If changes span multiple logical commits, focus the message on the primary change and mention other slices in the body.\n\n`;
  }
  if (hints?.force_body) {
    prompt += `The user requires a BODY section after the subject line, even for small changes.\n\n`;
  }
  if (rules && Object.keys(rules).length > 0) {
    prompt += `Rules: ${JSON.stringify(rules)}\n\n`;
  }
  prompt += `Important:
- Follow conventional commit format: <type>(<scope>): <subject>
- Response should be the commit message only, no explanations`;
  return prompt;
}

function buildRequest(
  provider: LocalProvider,
  baseUrl: string,
  userContent: string,
  diff: string,
  changes: string,
  model: string,
  apiKey: string | null,
  rules: Record<string, unknown>,
  recentCommits: string[] | undefined,
  hints: CommitGenerationHints | undefined
): { url: string; body: unknown; headers: Record<string, string> } {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/Quikcommit-Internal/public";
    headers["X-Title"] = "qc - AI Commit Message Generator";
  }

  let url: string;
  let body: unknown;

  switch (provider) {
    case "ollama":
      url = `${baseUrl}/api/generate`;
      body = {
        model,
        prompt: userContent,
        stream: false,
        options: {},
      };
      return { url, body, headers: { "Content-Type": "application/json" } };
    case "lmstudio":
      url = `${baseUrl}/chat/completions`;
      body = {
        model,
        stream: false,
        messages: [
          {
            role: "system",
            content:
              "You are a git commit message generator. Create conventional commit messages.",
          },
          { role: "user", content: userContent },
        ],
      };
      return { url, body, headers: { "Content-Type": "application/json" } };
    case "openrouter":
    case "custom":
      url = `${baseUrl}/chat/completions`;
      body = {
        model,
        stream: false,
        messages: [
          {
            role: "system",
            content:
              "You are a git commit message generator. Create conventional commit messages.",
          },
          { role: "user", content: userContent },
        ],
      };
      return { url, body, headers };
    case "cloudflare": {
      url = `${baseUrl.replace(/\/$/, "")}/commit`;
      const payload: Record<string, unknown> = { diff, changes, rules };
      if (recentCommits && recentCommits.length > 0) {
        payload.recent_commits = recentCommits.slice(0, 10);
      }
      if (hints && Object.keys(hints).length > 0) {
        payload.generation_hints = hints;
      }
      body = payload;
      return { url, body, headers: { "Content-Type": "application/json" } };
    }
    default:
      throw new Error(`Unknown provider: ${provider as string}`);
  }
}

function parseResponse(provider: LocalProvider, data: unknown): string {
  const r = data as Record<string, unknown>;
  switch (provider) {
    case "ollama":
      return (r.response as string) ?? "";
    case "lmstudio":
    case "openrouter":
    case "custom": {
      const choices = r.choices as Array<{ message?: { content?: string } }> | undefined;
      return choices?.[0]?.message?.content ?? "";
    }
    case "cloudflare":
      return (r.commit as { response?: string })?.response ?? "";
    default:
      return "";
  }
}

export async function runLocalCommit(args: LocalCommitOptions): Promise<void> {
  const silent = !!(args.hookMode || args.quiet);
  const log = silent ? createSilentLog() : getUI().log;

  if (!isGitRepo()) {
    throw new Error("Not a git repository.");
  }
  if (!hasStagedChanges()) {
    throw new Error("No staged changes. Stage files with `git add` first.");
  }

  const local = getLocalProviderConfig();
  if (!local) {
    throw new Error(
      "No local provider configured. Set provider in ~/.config/qc/config.json or run with SaaS (qc login)."
    );
  }

  const config = getConfig();
  const excludes = [...(config.excludes ?? []), ...args.exclude];
  let diff = getStagedDiff(excludes);
  const changes = getStagedFiles();

  if (!args.noSmartDiff) {
    const smartResult = preprocessDiff(diff);
    diff = smartResult.processedDiff;
    if (smartResult.summarized.length > 0 && !silent) {
      log.step(
        `smart-diff: ${smartResult.summarized.length} file(s) summarized (saved ~${Math.round(smartResult.tokensSaved / 1000)}K tokens)`
      );
    }
  }

  let rules: CommitRules = { ...(await detectCommitlintRules()), ...(config.rules ?? {}) };
  const workspace = detectWorkspace();
  if (workspace) {
    const stagedFiles = changes.trim().split("\n").filter(Boolean);
    const scope = autoDetectScope(stagedFiles, workspace);
    if (scope) {
      const scopes = scope.split(",").map((s) => s.trim());
      rules = { ...rules, scopes };
    }
  }

  rules = applyCliTypeScopeToRules(rules, args.type, args.scope);

  const recentCommits = args.noContext ? undefined : getRecentBranchCommits(5);
  const generationHints = generationHintsFromArgs(args.split, args.forceBody);

  const skipInteractive = silent || args.quiet || shouldSkipTTYInteraction(args.hookMode);
  const skipConfirm =
    args.dryRun ||
    args.messageOnly ||
    silent ||
    args.quiet ||
    shouldSkipTTYInteraction(args.hookMode);

  const model = args.model ?? local.model;
  const modelDisplay = model ?? local.model ?? "default";

  const userContent = buildUserPrompt(
    changes,
    diff,
    Object.keys(rules).length > 0 ? (rules as Record<string, unknown>) : undefined,
    recentCommits,
    generationHints
  );
  const { url, body, headers } = buildRequest(
    local.provider,
    local.baseUrl,
    userContent,
    diff,
    changes,
    model,
    local.apiKey,
    rules as Record<string, unknown>,
    recentCommits,
    generationHints
  );

  if (!url || url.includes("YOUR-WORKER")) {
    throw new Error(
      "Cloudflare provider requires api_url. Run: qc config set api_url https://your-worker.workers.dev"
    );
  }

  const spinner = getUI().spinner(`generating commit (${modelDisplay} via ${local.provider})...`);
  if (!silent) spinner.start();

  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } finally {
    spinner.stop();
  }
  const roundTripMs = Date.now() - t0;

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Provider error (${res.status}): ${text}`);
  }

  const data = (await res.json()) as unknown;
  let message = parseResponse(local.provider, data);

  message = message.replace(/\\n/g, "\n").replace(/\\r/g, "").trim();

  if (!message) {
    throw new Error("Failed to generate commit message.");
  }

  const diagnostics =
    local.provider === "cloudflare" && typeof data === "object" && data !== null
      ? (data as Record<string, unknown>).diagnostics
      : undefined;
  logVerboseDiagnostics((msg) => log.dim(msg), args.verbose, args.quiet, diagnostics, roundTripMs);

  if (args.interactive) {
    if (shouldSkipTTYInteraction(args.hookMode)) {
      if (!silent) log.dim("(--interactive ignored: not running in a TTY)");
    } else {
      const refineResult = await interactiveRefineMessage(message, { skip: skipInteractive });
      if (refineResult.action === "abort") {
        process.exit(0);
      }
      message = refineResult.message;
    }
  }

  if (args.messageOnly) {
    console.log(message);
    return;
  }

  if (!silent) {
    displayCommitMessage(message, log);
  }

  if (args.dryRun) {
    return;
  }

  if (args.confirm) {
    const confirmResult = await confirmCommit("Proceed with commit? [y/N]: ", { skip: skipConfirm });
    if (confirmResult.action === "abort") {
      process.exit(0);
    }
  }

  gitCommit(message);
  if (args.push) {
    gitPush();
  }
}
