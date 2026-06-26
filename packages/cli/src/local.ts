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
  getStagedDiffShortstat,
  branchExists,
  createBranch,
  createAndCheckoutBranch,
  gitPushSetUpstream,
  getPushStats,
  getCurrentBranch,
  getCommitHash,
} from "./git.js";
import { detectWorkspace, autoDetectScope } from "./monorepo.js";
import { detectCommitlintRules } from "./commitlint.js";
import { preprocessDiffWithSizeBudget } from "./smart-diff.js";
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
import { ensureUniqueName, sanitizeBranchName, deterministicBranchName } from "./branch-name.js";
import { createStageSpinner, flashSuccess, buildUIContext } from "./ui-rich.js";

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
  /** From ParsedArgs — disables spinner animation / success flash */
  noAnimate?: boolean;
  boxStyleOverride?: "rounded" | "gradient" | "double" | "none";
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
  const ui = getUI();
  const log = silent ? createSilentLog() : ui.log;

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
  const uiCtx = buildUIContext(ui, config, args);
  const boxStyle = args.boxStyleOverride ?? config.ui?.box?.style ?? "gradient";
  let diff = getStagedDiff(excludes);
  const changes = getStagedFiles();

  if (!args.noSmartDiff) {
    const smartResult = preprocessDiffWithSizeBudget(diff);
    diff = smartResult.processedDiff;
    if (smartResult.summarized.length > 0 && !silent) {
      log.step(
        `smart-diff: ${smartResult.summarized.length} file(s) summarized (saved ~${Math.round(smartResult.tokensSaved / 1000)}K tokens)`
      );
    }
    if (smartResult.needsChunking && !silent) {
      log.step("large diff detected — local providers receive context-stripped diff");
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

  const spinner = createStageSpinner({
    stage: "localProvider",
    message: `generating commit (${modelDisplay} via ${local.provider})...`,
    ...uiCtx,
  });
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
        return;
      }
      message = refineResult.message;
    }
  }

  if (args.messageOnly) {
    console.log(message);
    return;
  }

  if (!silent) {
    const stagedPaths = changes.trim().split("\n").filter(Boolean);
    const short = getStagedDiffShortstat();
    const tokenEst =
      diagnostics && typeof diagnostics === "object" && diagnostics !== null && "tokenUsage" in diagnostics
        ? (diagnostics as { tokenUsage?: { totalEstimated?: number } }).tokenUsage?.totalEstimated
        : undefined;

    displayCommitMessage(message, {
      log,
      isColor: ui.isColor,
      isTTY: !!process.stderr.isTTY,
      style: "rich",
      stagedFiles: stagedPaths,
      boxStyle,
      autoEmphasis: config.ui?.box?.auto_emphasis ?? true,
      theme: ui.theme,
      boxWidth: typeof config.ui?.box?.width === "number" ? config.ui.box.width : undefined,
      stats: {
        files: stagedPaths.length,
        additions: short.additions,
        deletions: short.deletions,
        ...(tokenEst !== undefined ? { tokens: tokenEst } : {}),
      },
    });
  }

  if (args.dryRun) {
    return;
  }

  if (args.confirm) {
    const confirmResult = await confirmCommit("Proceed with commit? [y/N]: ", { skip: skipConfirm });
    if (confirmResult.action === "abort") {
      return;
    }
  }

  gitCommit(message);
  const branch = getCurrentBranch();
  const hash = getCommitHash();
  if (!silent) {
    await flashSuccess({
      message: `✓ committed   ${branch} · ${hash}`,
      settledMessage: `${ui.theme.success("✓ committed")}${ui.theme.dim(`   ${branch} · ${hash}`)}`,
      theme: ui.theme,
      animate: uiCtx.animate,
      isTTY: uiCtx.isTTY,
    });
  }

  if (args.push) {
    // Capture stats BEFORE push — after push, origin is caught up and the range is empty.
    const pushStats = getPushStats();
    log.step(`pushing to origin/${branch}...`);
    gitPush();
    if (!silent) {
      if (pushStats) {
        await flashSuccess({
          message: `✓ pushed ${pushStats.commits} commit(s) · ${pushStats.stat}`,
          settledMessage: `${ui.theme.success("✓ pushed")}${ui.theme.dim(
            ` ${pushStats.commits} commit(s) · ${pushStats.stat}`
          )}`,
          theme: ui.theme,
          animate: uiCtx.animate,
          isTTY: uiCtx.isTTY,
        });
      } else {
        await flashSuccess({
          message: "✓ pushed",
          theme: ui.theme,
          animate: uiCtx.animate,
          isTTY: uiCtx.isTTY,
        });
      }
    }
  }
}

export interface LocalBranchOpts {
  description?: string;
  diff?: string;
  changes?: string;
  diffStat?: string;
  recentCommits?: string[];
  model?: string;
  noSwitch?: boolean;
  push?: boolean;
  baseRef?: string;
  /** When set, forwarded to Cloudflare Workers `/branch` as `rules` (e.g. constrained types). */
  rules?: CommitRules;
  noAnimate?: boolean;
}

export type LocalBranchGenerateOpts = Pick<
  LocalBranchOpts,
  "description" | "diff" | "changes" | "diffStat" | "recentCommits" | "model" | "rules"
>;

/**
 * Resolve a unique branch name via the configured local provider (no git branch created).
 */
export async function generateLocalBranchName(opts: LocalBranchGenerateOpts): Promise<string> {
  const local = getLocalProviderConfig();
  if (!local) {
    throw new Error("No local provider configured. Set provider with `qc --use-ollama` etc.");
  }

  const sections: string[] = [];
  sections.push("Generate a git branch name in the format <type>/<kebab-case-slug>.");
  sections.push("Type must be one of: feat, fix, refactor, perf, docs, test, chore, ci.");
  sections.push("Slug: 2-5 words, lowercase, hyphen-separated, max 55 chars.");
  sections.push("For LARGE changesets: identify the dominant THEME (migration, refactor, feature). Name for the theme, not a single file.");
  sections.push("Look for DELETED + ADDED files as signals of migration.");
  sections.push("Output ONLY the branch name on a single line. No explanation.");
  sections.push("");
  if (opts.description) {
    sections.push("DESCRIPTION:");
    sections.push(opts.description);
  } else if (opts.recentCommits && opts.recentCommits.length > 0) {
    sections.push("RECENT COMMITS:");
    for (const c of opts.recentCommits) sections.push(`- ${c}`);
  } else {
    // Provide ALL available context — file list first (most compact, most comprehensive)
    if (opts.changes) {
      sections.push("FILES CHANGED (PRIMARY signal — complete list):");
      sections.push(opts.changes.slice(0, 8000));
      sections.push("");
    }
    if (opts.diffStat) {
      sections.push("CHANGE MAGNITUDE:");
      sections.push(opts.diffStat.slice(0, 6000));
      sections.push("");
    }
    if (opts.diff) {
      const budget = opts.diffStat ? 8_000 : 30_000;
      sections.push("DIFF (supplementary, may be truncated):");
      sections.push(opts.diff.slice(0, budget));
    }
  }
  const userContent = sections.join("\n");

  const model = opts.model ?? local.model;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (local.apiKey) headers.Authorization = `Bearer ${local.apiKey}`;
  if (local.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/Quikcommit-Internal/public";
    headers["X-Title"] = "qc - AI Commit Message Generator";
  }

  let url: string;
  let body: unknown;

  switch (local.provider) {
    case "ollama":
      url = `${local.baseUrl}/api/generate`;
      body = { model, prompt: userContent, stream: false, options: {} };
      break;
    case "lmstudio":
    case "openrouter":
    case "custom":
      url = `${local.baseUrl}/chat/completions`;
      body = {
        model,
        stream: false,
        messages: [
          {
            role: "system",
            content: "You suggest concise git branch names. Reply with the branch name only.",
          },
          { role: "user", content: userContent },
        ],
      };
      break;
    case "cloudflare":
      url = `${local.baseUrl.replace(/\/$/, "")}/branch`;
      body = {
        diff: opts.diff,
        changes: opts.changes,
        diff_stat: opts.diffStat,
        recent_commits: opts.recentCommits,
        description: opts.description,
        model,
        cf_model: model,
        ...(opts.rules ? { rules: opts.rules } : {}),
      };
      break;
  }

  if (!url || url.includes("YOUR-WORKER")) {
    throw new Error(
      "Cloudflare provider requires api_url. Run: qc config set api_url https://your-worker.workers.dev"
    );
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    // Network failure — fall back to deterministic name generation.
    const fallback = deterministicBranchName({ files: opts.changes?.split("\n").filter(Boolean), description: opts.description });
    return ensureUniqueName(fallback.name, branchExists);
  }

  if (!res.ok) {
    // Provider error — fall back to deterministic name generation.
    const fallback = deterministicBranchName({ files: opts.changes?.split("\n").filter(Boolean), description: opts.description });
    return ensureUniqueName(fallback.name, branchExists);
  }

  const data = (await res.json()) as unknown;
  let raw: string;
  if (local.provider === "cloudflare") {
    const r = data as Record<string, unknown>;
    const br = r.branch as { name?: string } | undefined;
    raw = typeof br?.name === "string" ? br.name : "";
  } else if (local.provider === "ollama") {
    raw = ((data as Record<string, unknown>).response as string) ?? "";
  } else {
    const choices = (data as Record<string, unknown>).choices as
      | Array<{ message?: { content?: string } }>
      | undefined;
    raw = choices?.[0]?.message?.content ?? "";
  }

  raw = raw.replace(/[\r\n].*$/s, "").trim();

  const sanitized = sanitizeBranchName(raw);
  if (!sanitized) {
    // AI returned unparseable name — fall back to deterministic.
    const fallback = deterministicBranchName({ files: opts.changes?.split("\n").filter(Boolean), description: opts.description });
    return ensureUniqueName(fallback.name, branchExists);
  }

  return ensureUniqueName(sanitized, branchExists);
}

/**
 * Generate a branch name via the configured local provider (no SaaS auth).
 */
export async function runLocalBranch(opts: LocalBranchOpts): Promise<void> {
  const local = getLocalProviderConfig();
  if (!local) {
    throw new Error("No local provider configured. Set provider with `qc --use-ollama` etc.");
  }

  const ui = getUI();
  const log = ui.log;
  const config = getConfig();
  const branchUiCtx = buildUIContext(ui, config, { noAnimate: opts.noAnimate });

  const spinner = createStageSpinner({
    stage: "branchGen",
    message: `generating branch name (${opts.model ?? local.model} via ${local.provider})...`,
    ...branchUiCtx,
  });
  if (process.stderr.isTTY) spinner.start();
  let final: string;
  try {
    final = await generateLocalBranchName({
      description: opts.description,
      diff: opts.diff,
      changes: opts.changes,
      diffStat: opts.diffStat,
      recentCommits: opts.recentCommits,
      model: opts.model,
      rules: opts.rules,
    });
  } catch {
    // Provider failed entirely — use deterministic fallback.
    const filesArr = opts.changes?.split("\n").filter(Boolean) ?? [];
    const fallback = deterministicBranchName({ files: filesArr, description: opts.description });
    final = ensureUniqueName(fallback.name, branchExists);
    log.dim("(used local fallback name; AI generation failed)");
  } finally {
    spinner.stop();
  }

  log.success(`branch name: ${final}`);

  const baseRef = opts.baseRef ?? "HEAD";

  if (opts.noSwitch) {
    createBranch(final, baseRef);
    log.success(`created ${final} (not switched)`);
  } else {
    createAndCheckoutBranch(final, baseRef);
    log.success(`switched to ${final}`);
  }

  if (opts.push) {
    gitPushSetUpstream(final);
    log.success(`pushed origin/${final}`);
  }
}
