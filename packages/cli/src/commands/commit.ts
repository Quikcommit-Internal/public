import type { CommitRules } from "@quikcommit/shared";
import { getApiKey, getConfig } from "../config.js";
import { ApiClient } from "../api.js";
import { detectCommitlintRules } from "../commitlint.js";
import {
  isGitRepo,
  getStagedDiff,
  getStagedFiles,
  getStagedFileCount,
  hasStagedChanges,
  getUnstagedFiles,
  stageAll,
  gitCommit,
  gitPush,
  getCommitHash,
  getCurrentBranch,
  getPushStats,
  getRecentBranchCommits,
  getStagedDiffShortstat,
} from "../git.js";
import { detectWorkspace, autoDetectScope } from "../monorepo.js";
import { getUI } from "../ui.js";
import { preprocessDiffWithSizeBudget, splitDiffIntoChunks } from "../smart-diff.js";
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
import { runBranchGuard } from "../branch-guard.js";
import { createStageSpinner, flashSuccess, buildUIContext } from "../ui-rich.js";

export async function runCommit(args: ParsedArgs): Promise<void> {
  const { messageOnly, push, apiKey: apiKeyFlag, hookMode, model: modelFlag, all } = args;
  const silent = !!(hookMode || args.quiet);
  const ui = getUI();
  const log = silent ? createSilentLog() : ui.log;

  // Precondition exits: these fire before any async/spinner work.
  // Kept as process.exit(1) (not throws) to preserve ✗-formatted error output.
  if (!isGitRepo()) {
    log.error("Not a git repository.");
    process.exit(1);
  }

  const config = getConfig();
  const excludes = [...(config.excludes ?? []), ...args.exclude];

  const guardResult = await runBranchGuard(
    {
      allowProtected: !!(args.allowProtected || config.branch?.allowProtected),
      autoBranch: !!args.autoBranch,
      hookMode: !!args.hookMode,
      apiKey: apiKeyFlag ?? getApiKey() ?? undefined,
      model: args.model,
      excludes,
      noAnimate: args.noAnimate,
    },
    log
  );

  if (guardResult.action === "abort") {
    // User aborted — clean exit, nothing to commit.
    return;
  }
  if (guardResult.action === "done") {
    // Rescue completed — existing commits moved to new branch, nothing to commit.
    return;
  }
  // Item E: exhaustiveness assertion — if a fourth BranchGuardOutcome is ever
  // added, TypeScript will error here instead of silently falling through.
  const _exhaustive: "continue" = guardResult.action;
  void _exhaustive;
  // guardResult.action === "continue" — fall through to normal commit flow.

  if (all || config.autoStage) {
    stageAll();
    const total = getStagedFileCount();
    log.step(`staging working tree (${total} file(s))...`);
  }

  if (!hasStagedChanges()) {
    const unstaged = getUnstagedFiles();
    if (unstaged.length > 0) {
      log.error("No staged changes. Use `qc -a` to stage all files (modified + untracked), or `git add` manually.");
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
  const diff = getStagedDiff(excludes);
  const changes = getStagedFiles();

  let processedDiff = diff;
  let needsChunking = false;
  if (!args.noSmartDiff) {
    const smartResult = preprocessDiffWithSizeBudget(diff);
    processedDiff = smartResult.processedDiff;
    needsChunking = smartResult.needsChunking;
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
  } catch (err) {
    // Not in a team — expected for solo users; no noise needed.
    // But log a dim hint so team users can spot API issues.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg && !/not found|404|403/i.test(msg)) {
      log.dim('⚠ could not fetch team rules: ' + msg.slice(0, 80));
    }
  }

  rules = applyCliTypeScopeToRules(rules, args.type, args.scope);

  const recentCommits = args.noContext ? undefined : getRecentBranchCommits(5);

  const generationHints = generationHintsFromArgs(args.split, args.forceBody);

  const skipInteractive = silent || args.quiet || shouldSkipTTYInteraction(args.hookMode);
  const skipConfirm =
    args.dryRun || messageOnly || silent || args.quiet || shouldSkipTTYInteraction(args.hookMode);

  const modelDisplay = model ?? "default";
  const uiCtx = buildUIContext(ui, config, args);
  const boxStyle = args.boxStyleOverride ?? config.ui?.box?.style ?? "gradient";
  const spinner = createStageSpinner({
    stage: "aiGenerate",
    message: needsChunking
      ? `analyzing ${changes.trim().split("\n").length} files in chunks (${modelDisplay})...`
      : `generating commit (${modelDisplay})...`,
    ...uiCtx,
  });
  if (!silent) spinner.start();

  const t0 = Date.now();
  let generatedMessage: string;
  let diagnostics: unknown;
  try {
    if (needsChunking) {
      const chunks = splitDiffIntoChunks(processedDiff);
      if (chunks.length === 0) {
        spinner.stop();
        log.error("No parseable diff content to analyze.");
        process.exit(1);
      }
      spinner.stop();
      if (!silent) log.step(`large diff — analyzing ${chunks.length} chunk(s) in parallel...`);

      // Fix #5: Use allSettled so a single chunk failure doesn't abort everything
      const results = await Promise.allSettled(
        chunks.map((chunk) =>
          client.summarizeChunk(chunk.diff, chunk.files.filter(Boolean).join("\n") || "unknown", model)
        )
      );
      const summaries: string[] = [];
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) {
          summaries.push(r.value);
        }
      }
      if (summaries.length === 0) {
        log.error("All chunk summaries failed. Check your connection and try again.");
        process.exit(1);
      }
      if (results.some((r) => r.status === "rejected") && !silent) {
        const failed = results.filter((r) => r.status === "rejected").length;
        log.step(`${failed}/${results.length} chunk(s) failed — continuing with partial summaries`);
      }
      const combinedSummary = summaries.join("\n\n");

      const finalSpinner = createStageSpinner({
        stage: "aiGenerate",
        message: `generating commit from ${chunks.length} summaries (${modelDisplay})...`,
        ...uiCtx,
      });
      if (!silent) finalSpinner.start();
      try {
        ({ message: generatedMessage, diagnostics } = await client.generateCommit(
          combinedSummary,
          changes,
          rules,
          model,
          recentCommits,
          generationHints
        ));
      } finally {
        finalSpinner.stop();
      }
    } else {
      ({ message: generatedMessage, diagnostics } = await client.generateCommit(
        processedDiff,
        changes,
        rules,
        model,
        recentCommits,
        generationHints
      ));
    }
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
        return;
      }
      message = refineResult.message;
    }
  }

  if (messageOnly) {
    console.log(message);
    return;
  }

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
  const hash = getCommitHash();
  const branch = getCurrentBranch();
  if (!silent) {
    await flashSuccess({
      message: `✓ committed   ${branch} · ${hash}`,
      settledMessage: `${ui.theme.success("✓ committed")}${ui.theme.dim(`   ${branch} · ${hash}`)}`,
      theme: ui.theme,
      animate: uiCtx.animate,
      isTTY: !!process.stderr.isTTY,
    });
  }

  if (push) {
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
          isTTY: !!process.stderr.isTTY,
        });
      } else {
        await flashSuccess({
          message: "✓ pushed",
          theme: ui.theme,
          animate: uiCtx.animate,
          isTTY: !!process.stderr.isTTY,
        });
      }
    }
  }
}

