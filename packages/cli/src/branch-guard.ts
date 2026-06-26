/**
 * Branch guard: detects protected-branch state and handles user prompts before
 * the main commit flow.
 *
 * Outcomes:
 *   "continue" — caller should proceed with the commit flow as normal.
 *                This covers: not on a protected branch; user chose to commit
 *                on the protected branch; or user branched from uncommitted
 *                state and wants their staged changes committed on the new branch.
 *   "done"     — rescue mode completed (existing commits moved to new branch).
 *                Caller should return without committing.
 *   "abort"    — user aborted. Caller should exit(0).
 */

import readline from "node:readline/promises";
import { ApiClient } from "./api.js";
import {
  getStagedDiff,
  getStagedFiles,
  getWorkingTreeDiff,
  getAllChangedFiles,
  getAllChangedFilesWithStatus,
  getRecentBranchCommits,
  branchExists,
  createAndCheckoutBranch,
  getWorkingDiffStat,
} from "./git.js";
import { preprocessDiff } from "./smart-diff.js";
import {
  detectProtectedBranchState,
  shouldRunGuard,
} from "./protected-branch-guard.js";
import { rescueCommits } from "./branch-rescue.js";
import {
  finalizeBranchName,
  deterministicBranchName,
} from "./branch-name.js";
import { getUI } from "./ui.js";
import { promptYesNo } from "./commit-helpers.js";
import { createStageSpinner, buildUIContext } from "./ui-rich.js";

export type BranchGuardOutcome = "continue" | "done" | "abort";

export interface BranchGuardResult {
  action: BranchGuardOutcome;
}

export interface BranchGuardArgs {
  allowProtected?: boolean;
  autoBranch?: boolean;
  hookMode?: boolean;
  apiKey?: string;
  model?: string;
  excludes?: string[];
  branchRules?: { types?: string[] };
  noAnimate?: boolean;
}

/**
 * Runs the protected-branch guard logic that was previously inlined in runCommit.
 *
 * Returns a BranchGuardResult indicating what the caller should do next.
 * The `log` parameter must be either the real UI log or a silent log — this
 * keeps the guard testable without coupling it to a specific logger type.
 */
export async function runBranchGuard(
  args: BranchGuardArgs,
  log: {
    error: (msg: string) => void;
    success: (msg: string) => void;
    dim: (msg: string) => void;
  }
): Promise<BranchGuardResult> {
  if (
    !shouldRunGuard({
      allowProtected: !!args.allowProtected,
      hookMode: !!args.hookMode,
      isTTY: !!process.stdin.isTTY,
    })
  ) {
    return { action: "continue" };
  }

  // Load config to get protected branch settings and default action.
  const { getConfig } = await import("./config.js");
  const config = getConfig();

  const state = detectProtectedBranchState({
    protectedBranches: config.branch?.protectedBranches,
    detectDefault: config.branch?.detectDefault,
  });

  if (!state.isProtected) {
    return { action: "continue" };
  }

  log.error(
    `You're on ${state.branch} (a protected branch).` +
      (state.commitsAhead > 0
        ? ` ${state.commitsAhead} commit(s) ahead of upstream.`
        : "")
  );

  let action: "branch" | "continue" | "abort";
  let usedConfigDefault = false;

  if (args.autoBranch) {
    action = "branch";
  } else if (config.branch?.defaultAction === "branch") {
    action = "branch";
    usedConfigDefault = true;
  } else if (config.branch?.defaultAction === "continue") {
    action = "continue";
    usedConfigDefault = true;
  } else {
    action = await promptProtectedAction(state.mode);
  }

  if (action === "continue" && usedConfigDefault) {
    log.dim("(continuing on protected branch per config `branch.defaultAction`)");
  }

  if (action === "abort") {
    log.dim("aborted.");
    return { action: "abort" };
  }

  if (action === "continue") {
    return { action: "continue" };
  }

  // action === "branch"
  // For branch name generation, gather context from staged changes if any,
  // otherwise fall back to unstaged working-tree changes (the user clearly
  // has work-in-progress they want to commit, even if not staged yet).
  let stagedDiff = "";
  let plainFiles = "";       // plain file list for deterministic fallback
  let changesForAI = "";     // status-annotated file list (A/M/D markers) for AI
  let diffStat = "";
  if (state.mode === "uncommitted") {
    let rawDiff = getStagedDiff(args.excludes ?? []);
    plainFiles = getStagedFiles();
    changesForAI = plainFiles;
    const isStaged = !!rawDiff.trim();
    if (!isStaged) {
      rawDiff = getWorkingTreeDiff(args.excludes ?? []);
      plainFiles = getAllChangedFiles();
      // Status-annotated list tells the AI which files were added/deleted/modified
      changesForAI = getAllChangedFilesWithStatus();
    }
    stagedDiff = preprocessDiff(rawDiff).processedDiff;
    // Compact diff stat gives per-file change magnitude without sending
    // megabytes of raw diff content.
    diffStat = getWorkingDiffStat(isStaged);
  }
  const recentCommits =
    state.mode === "rescue" ? getRecentBranchCommits(state.commitsAhead) : undefined;

  // Use explicitly provided branchRules, or derive from config.
  const branchRules =
    args.branchRules ??
    (config.branch?.generation?.types && config.branch.generation.types.length > 0
      ? { types: [...config.branch.generation.types] }
      : undefined);

  const apiKey = args.apiKey;

  const ui = getUI();

  // Validate local provider availability before starting the spinner.
  let generateLocalBranchNameFn:
    | ((opts: {
        diff?: string;
        changes?: string;
        diffStat?: string;
        recentCommits?: string[];
        model?: string;
        rules?: { types?: string[] };
      }) => Promise<string>)
    | undefined;

  if (!apiKey) {
    const { getLocalProviderConfig, generateLocalBranchName } = await import("./local.js");
    if (!getLocalProviderConfig()) {
      log.error(
        "Cannot generate branch name: not authenticated and no local provider configured. Run `qc login` or configure a local provider."
      );
      // Item G: return abort instead of process.exit so the discriminated-union
      // contract is upheld and callers decide the exit code.
      return { action: "abort" };
    }
    generateLocalBranchNameFn = generateLocalBranchName;
  }

  const guardUiCtx = buildUIContext(ui, config, args);

  // Spinner wraps only the actual network/inference call.
  const spinner = createStageSpinner({
    stage: "branchGen",
    message: "generating branch name...",
    ...guardUiCtx,
  });
  if (process.stderr.isTTY) spinner.start();
  let rawName: string;
  let usedFallback = false;
  try {
    if (apiKey) {
      const client = new ApiClient({ apiKey });
      try {
        // For branch naming, limit the diff to 60KB client-side — the file list
        // and diff_stat carry the important context; sending MB of raw diff is
        // wasteful and causes the AI worker to blindly truncate anyway.
        const cappedDiff = stagedDiff ? stagedDiff.slice(0, 60_000) : undefined;
        const branchResult = await client.generateBranchName({
          diff: cappedDiff || undefined,
          changes: changesForAI || undefined,
          diff_stat: diffStat || undefined,
          recent_commits: recentCommits,
          model: args.model,
          rules: branchRules,
        });
        rawName = branchResult.name;
      } catch {
        // API unavailable — fall back to deterministic name generation.
        // Item C: in rescue mode, stagedChanges is empty (rescuing commits, not files).
        // Pass recentCommits as description so the name reflects the actual commits.
        const fallbackInput =
          state.mode === "rescue"
            ? { files: [], description: recentCommits?.join(" ") ?? "" }
            : { files: plainFiles ? plainFiles.split("\n").filter(Boolean) : [] };
        rawName = deterministicBranchName(fallbackInput).name;
        usedFallback = true;
      }
    } else {
      try {
        rawName = await generateLocalBranchNameFn!({
          diff: stagedDiff ? stagedDiff.slice(0, 60_000) : undefined,
          changes: changesForAI || undefined,
          diffStat: diffStat || undefined,
          recentCommits: recentCommits,
          model: args.model,
          rules: branchRules,
        });
      } catch {
        // Local provider failed — fall back to deterministic name generation.
        // Item C: same rescue-mode fix as the API path above.
        const fallbackInput =
          state.mode === "rescue"
            ? { files: [], description: recentCommits?.join(" ") ?? "" }
            : { files: plainFiles ? plainFiles.split("\n").filter(Boolean) : [] };
        rawName = deterministicBranchName(fallbackInput).name;
        usedFallback = true;
      }
    }
  } finally {
    spinner.stop();
  }

  if (usedFallback) {
    log.dim("(used local fallback name; AI generation failed)");
  }

  // Validate the result outside the spinner block so the spinner is
  // guaranteed to have stopped before logging.
  let final: string;
  try {
    final = finalizeBranchName(rawName, branchExists);
  } catch {
    // Item A: branch message on the actual source of the name.
    // Item G: return abort instead of process.exit.
    const generatorName = usedFallback
      ? "deterministic fallback"
      : (apiKey ? "API generator" : "local provider");
    log.error(`Invalid branch name from ${generatorName}: ${rawName}`);
    return { action: "abort" };
  }

  log.success(`branch name: ${final}`);

  if (state.mode === "rescue") {
    log.dim(
      `About to: 1) create ${final} at HEAD, 2) reset ${state.branch} to upstream, 3) switch to ${final}`
    );
    // Item I: use shared promptYesNo instead of private confirmRescuePrompt.
    const confirmed = await promptYesNo("Continue with rescue?");
    if (!confirmed) {
      log.dim("aborted.");
      return { action: "abort" };
    }
    // Item B: wrap rescue in try/catch so an unexpected rescueCommits failure
    // surfaces a clean error message instead of propagating raw to main().
    try {
      rescueCommits({ currentBranch: state.branch, newBranch: final });
      log.success(`moved ${state.commitsAhead} commit(s) to ${final}`);
      log.success(`${state.branch} reset to upstream`);
    } catch (err) {
      log.error(`Rescue failed: ${err instanceof Error ? err.message : String(err)}`);
      return { action: "abort" };
    }
    // Rescue moves existing commits to the new branch — no staged changes to
    // commit, so signal "done" to the caller.
    return { action: "done" };
  }

  // Uncommitted mode: create the branch and let commit flow continue.
  createAndCheckoutBranch(final);
  log.success(`switched to ${final}`);
  return { action: "continue" };
}

async function promptProtectedAction(
  mode: "uncommitted" | "rescue" | "none"
): Promise<"branch" | "continue" | "abort"> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    const continueLabel =
      mode === "rescue"
        ? "commit on this branch anyway (do not move existing commits)"
        : "commit on this branch anyway (not recommended)";
    const branchLabel =
      mode === "rescue"
        ? "create a new branch and move your existing commits to it"
        : "create a new branch first, then commit your staged changes there";

    process.stderr.write(
      `\nWhat would you like to do?\n` +
        `  (b)ranch  ${branchLabel}  ← default\n` +
        `  (c)ommit  ${continueLabel}\n` +
        `  (a)bort   cancel without committing\n`
    );

    const answer = (await rl.question("> ")).trim().toLowerCase();
    if (answer === "" || answer === "b" || answer === "branch" || answer === "y") return "branch";
    if (answer === "c" || answer === "commit") return "continue";
    if (answer === "a" || answer === "abort" || answer === "n") return "abort";
    // Unknown input — treat as abort for safety, with feedback.
    process.stderr.write(`(unrecognized response "${answer}" — aborting)\n`);
    return "abort";
  } finally {
    rl.close();
  }
}

// confirmRescuePrompt removed — replaced with shared promptYesNo (Item I).
