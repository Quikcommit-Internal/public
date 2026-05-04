import type { CommitRules } from "@quikcommit/shared";
import { getApiKey, getConfig } from "../config.js";
import { ApiClient } from "../api.js";
import { detectCommitlintRules } from "../commitlint.js";
import {
  isGitRepo,
  getStagedDiff,
  getStagedFiles,
  hasStagedChanges,
  getUnstagedFiles,
  stageAll,
  gitCommit,
  gitPush,
  getShortStagedFiles,
  getCommitHash,
  getCurrentBranch,
  getPushStats,
  getRecentBranchCommits,
} from "../git.js";
import { detectWorkspace, autoDetectScope } from "../monorepo.js";
import { getUI } from "../ui.js";
import { preprocessDiff } from "../smart-diff.js";
import {
  applyCliTypeScopeToRules,
  generationHintsFromArgs,
  logVerboseDiagnostics,
  interactiveRefineMessage,
  confirmCommit,
  shouldSkipTTYInteraction,
  createSilentLog,
  displayCommitMessage,
} from "../commit-helpers.js";
import type { ParsedArgs } from "../index.js";

export async function runCommit(args: ParsedArgs): Promise<void> {
  const { messageOnly, push, apiKey: apiKeyFlag, hookMode, model: modelFlag, all } = args;
  const silent = !!(hookMode || args.quiet);
  const log = silent ? createSilentLog() : getUI().log;

  if (!isGitRepo()) {
    log.error("Not a git repository.");
    process.exit(1);
  }

  const config = getConfig();
  if (all || config.autoStage) {
    stageAll();
    const { files, total } = getShortStagedFiles();
    const fileList = total > 3 ? `${files.join(", ")}, +${total - 3} more` : files.join(", ");
    log.step(`staging working tree (${total} file(s))...`);
    if (fileList) log.dim(`  ${fileList}`);
  }

  if (!hasStagedChanges()) {
    const unstaged = getUnstagedFiles();
    if (unstaged.length > 0) {
      log.error("No staged changes. Use `qc -a` to stage tracked files, or `git add` manually.");
    } else {
      log.error("No changes to commit.");
    }
    process.exit(1);
  }

  const apiKey = apiKeyFlag ?? getApiKey();
  if (!apiKey) {
    log.error("Not authenticated. Run `qc login` first.");
    process.exit(1);
  }

  const model = modelFlag ?? config.model;
  const excludes = [...(config.excludes ?? []), ...args.exclude];
  const diff = getStagedDiff(excludes);
  const changes = getStagedFiles();

  let processedDiff = diff;
  if (!args.noSmartDiff) {
    const smartResult = preprocessDiff(diff);
    processedDiff = smartResult.processedDiff;
    if (smartResult.summarized.length > 0) {
      log.step(
        `smart-diff: ${smartResult.summarized.length} file(s) summarized (saved ~${Math.round(smartResult.tokensSaved / 1000)}K tokens)`
      );
    }
  }

  const commitlintRules = await detectCommitlintRules();
  let rules: CommitRules = { ...commitlintRules, ...(config.rules ?? {}) };
  const workspace = detectWorkspace();
  let monorepoScopes: string[] | undefined;
  if (workspace) {
    const stagedFiles = changes.trim().split("\n").filter(Boolean);
    const scope = autoDetectScope(stagedFiles, workspace);
    if (scope) {
      monorepoScopes = scope.split(",").map((s) => s.trim());
      rules = { ...rules, scopes: monorepoScopes };
    }
  }

  const client = new ApiClient({ apiKey });
  try {
    const teamRules = await client.getTeamRules();
    if (teamRules && Object.keys(teamRules).length > 0) {
      log.step("using team rules from org");
      rules = { ...rules, ...teamRules };
      if (monorepoScopes && teamRules.scopes && teamRules.scopes.length > 0) {
        const allowed = new Set(teamRules.scopes);
        const intersected = monorepoScopes.filter((s) => allowed.has(s));
        if (intersected.length > 0) rules = { ...rules, scopes: intersected };
      }
    }
  } catch {
    // Not in a team or API error
  }

  rules = applyCliTypeScopeToRules(rules, args.type, args.scope);

  const recentCommits = args.noContext ? undefined : getRecentBranchCommits(5);

  const generationHints = generationHintsFromArgs(args.split, args.forceBody);

  const skipInteractive = silent || args.quiet || shouldSkipTTYInteraction(args.hookMode);
  const skipConfirm =
    args.dryRun || messageOnly || silent || args.quiet || shouldSkipTTYInteraction(args.hookMode);

  const modelDisplay = model ?? "default";
  const spinner = getUI().spinner(`generating commit (${modelDisplay})...`);
  if (!silent) spinner.start();

  const t0 = Date.now();
  let generatedMessage: string;
  let diagnostics: unknown;
  try {
    ({ message: generatedMessage, diagnostics } = await client.generateCommit(
      processedDiff,
      changes,
      rules,
      model,
      recentCommits,
      generationHints
    ));
  } finally {
    spinner.stop();
  }
  const roundTripMs = Date.now() - t0;

  logVerboseDiagnostics((msg) => log.dim(msg), args.verbose, args.quiet, diagnostics, roundTripMs);

  let message = generatedMessage;
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

  if (messageOnly) {
    console.log(message);
    return;
  }

  displayCommitMessage(message, log);

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
  const hash = getCommitHash();
  const branch = getCurrentBranch();
  log.step(`[${branch} ${hash}] committed`);

  if (push) {
    log.step(`pushing to origin/${branch}...`);
    gitPush();
    const stats = getPushStats();
    if (stats) {
      log.success(`pushed ${stats.commits} commit(s) · ${stats.stat}`);
    } else {
      log.success("pushed");
    }
  }
}
