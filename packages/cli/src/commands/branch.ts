import type { BranchRequest, CommitRules } from "@quikcommit/shared";
import { ApiClient } from "../api.js";
import type { LocalConfig } from "../config.js";
import { getApiKey, getConfig } from "../config.js";
import { rescueCommits } from "../branch-rescue.js";
import { detectProtectedBranchState } from "../protected-branch-guard.js";
import {
  isGitRepo,
  getStagedDiff,
  getStagedFiles,
  hasStagedChanges,
  getRecentBranchCommits,
  branchExists,
  createBranch,
  createAndCheckoutBranch,
  gitPushSetUpstream,
} from "../git.js";
import { preprocessDiff } from "../smart-diff.js";
import { finalizeBranchName, sanitizeBranchName, deterministicBranchName } from "../branch-name.js";
import { promptYesNo } from "../commit-helpers.js";
import { getUI } from "../ui.js";
import { createStageSpinner } from "../ui-rich.js";

export interface BranchOptions {
  explicitName?: string;
  message?: string;
  fromCommits?: boolean;
  rescue?: boolean;
  dryRun?: boolean;
  noSwitch?: boolean;
  push?: boolean;
  from?: string;
  model?: string;
  apiKey?: string;
  noAnimate?: boolean;
}

function branchGenerationRules(cfg: LocalConfig): CommitRules | undefined {
  const types = cfg.branch?.generation?.types;
  if (types && types.length > 0) return { types: [...types] };
  return undefined;
}

// confirmBranchRescue removed — replaced with shared promptYesNo (Item I).

function finalizeGeneratedBranchName(raw: string): string {
  return finalizeBranchName(raw, branchExists);
}

export async function runBranch(opts: BranchOptions): Promise<void> {
  const ui = getUI();
  const log = ui.log;
  const config = getConfig();
  const animate = opts.noAnimate ? "none" : (config.ui?.animate ?? "tasteful");
  const uniformSpinner = config.ui?.spinner === "uniform";

  if (!isGitRepo()) {
    log.error("Not a git repository.");
    process.exit(1);
  }

  const baseRef = opts.from ?? "HEAD";
  const model = opts.model ?? config.model;
  const genRules = branchGenerationRules(config);

  if (opts.rescue) {
    const state = detectProtectedBranchState({
      protectedBranches: config.branch?.protectedBranches,
      detectDefault: config.branch?.detectDefault,
    });
    if (!state.isProtected) {
      throw new Error(
        "`--rescue` only applies on a protected branch (e.g. main). The current branch is not protected."
      );
    }
    if (state.commitsAhead === 0) {
      throw new Error(
        "No commits ahead of upstream to rescue. Push your branch or use `qc branch` without `--rescue`."
      );
    }

    let final: string;
    if (opts.explicitName) {
      const sanitized = sanitizeBranchName(opts.explicitName);
      if (!sanitized) {
        throw new Error(`invalid branch name: ${opts.explicitName}`);
      }
      // Item J: use finalizeBranchName for consistency with all other code paths.
      // Since sanitized is already valid, finalizeBranchName skips re-sanitization
      // and proceeds directly to ensureUniqueName — same behaviour, consistent API.
      final = finalizeBranchName(sanitized, branchExists);
    } else {
      const recent = getRecentBranchCommits(state.commitsAhead);
      const apiKey = opts.apiKey ?? getApiKey();
      if (apiKey) {
        const spinner = createStageSpinner({
          stage: "branchGen",
          message: `generating branch name (${model ?? "default"})...`,
          theme: ui.theme,
          animate,
          isTTY: !!process.stderr.isTTY,
          isColor: ui.isColor,
          asciiFallback: !ui.isColor,
          uniform: uniformSpinner,
        });
        if (process.stderr.isTTY) spinner.start();
        try {
          const client = new ApiClient({ apiKey });
          try {
            const result = await client.generateBranchName({
              recent_commits: recent,
              model: opts.model,
              description: opts.message,
              rules: genRules,
            });
            final = finalizeGeneratedBranchName(result.name);
          } catch {
            // Item H: API failed in rescue mode — fall back to deterministic name.
            // Item C: pass recentCommits as description so the name reflects the commits.
            const fallback = deterministicBranchName({
              description: recent.join(" ") || opts.message,
            });
            final = finalizeBranchName(fallback.name, branchExists);
            log.dim("(used deterministic fallback name; API generation failed)");
          }
        } finally {
          spinner.stop();
        }
      } else {
        const { getLocalProviderConfig, generateLocalBranchName } = await import("../local.js");
        if (!getLocalProviderConfig()) {
          throw new Error(
            "Not authenticated. Run `qc login` first, or configure a local provider for `--rescue`."
          );
        }
        const spinner = createStageSpinner({
          stage: "branchGen",
          message: `generating branch name (${model ?? "default"} via local)...`,
          theme: ui.theme,
          animate,
          isTTY: !!process.stderr.isTTY,
          isColor: ui.isColor,
          asciiFallback: !ui.isColor,
          uniform: uniformSpinner,
        });
        if (process.stderr.isTTY) spinner.start();
        try {
          try {
            const name = await generateLocalBranchName({
              recentCommits: recent,
              model: opts.model,
              description: opts.message,
              rules: genRules,
            });
            // Item D: generateLocalBranchName already calls ensureUniqueName internally.
            // Pass skipUniqueness to avoid a redundant git show-ref round-trip.
            final = finalizeBranchName(name, branchExists, { skipUniqueness: true });
          } catch {
            // Item H: local provider failed in rescue mode — fall back to deterministic name.
            // Item C: pass recentCommits as description so the name reflects the commits.
            const fallback = deterministicBranchName({
              description: recent.join(" ") || opts.message,
            });
            final = finalizeBranchName(fallback.name, branchExists);
            log.dim("(used deterministic fallback name; local provider failed)");
          }
        } finally {
          spinner.stop();
        }
      }
    }

    log.success(`branch name: ${final}`);

    if (opts.dryRun) {
      log.dim("(dry-run; not running rescue)");
      return;
    }

    if (!process.stdin.isTTY) {
      throw new Error("`--rescue` requires an interactive terminal to confirm (or use `qc branch <name>` after arranging commits manually).");
    }

    log.dim(
      `About to: 1) create ${final} at HEAD, 2) reset ${state.branch} to upstream, 3) switch to ${final}`
    );
    // Item I: use shared promptYesNo instead of private confirmBranchRescue.
    if (!(await promptYesNo("Continue with rescue?"))) {
      log.dim("aborted.");
      return;
    }

    rescueCommits({ currentBranch: state.branch, newBranch: final });
    log.success(`moved ${state.commitsAhead} commit(s) to ${final}`);
    log.success(`${state.branch} reset to upstream`);

    if (opts.push) {
      gitPushSetUpstream(final);
      log.success(`pushed origin/${final}`);
    }
    return;
  }

  if (opts.explicitName) {
    const sanitized = sanitizeBranchName(opts.explicitName);
    if (!sanitized) {
      throw new Error(`invalid branch name: ${opts.explicitName}`);
    }
    // Item J: use finalizeBranchName for consistency (same as rescue path above).
    const final = finalizeBranchName(sanitized, branchExists);
    if (opts.dryRun) {
      log.success(`would create branch: ${final}`);
      return;
    }
    if (opts.noSwitch) {
      createBranch(final, baseRef);
      log.success(`created branch ${final} (not switched)`);
    } else {
      createAndCheckoutBranch(final, baseRef);
      log.success(`switched to ${final}`);
    }
    if (opts.push) {
      gitPushSetUpstream(final);
      log.success(`pushed origin/${final}`);
    }
    return;
  }

  const payload: BranchRequest = { model, rules: genRules };

  if (opts.message) {
    payload.description = opts.message;
  } else if (opts.fromCommits) {
    payload.recent_commits = getRecentBranchCommits(10);
  } else {
    if (!hasStagedChanges()) {
      throw new Error(
        "No staged changes detected. Stage with `git add`, or provide -m '<description>'."
      );
    }
    const rawDiff = getStagedDiff(config.excludes ?? []);
    payload.diff = preprocessDiff(rawDiff).processedDiff;
    payload.changes = getStagedFiles();
  }

  const apiKey = opts.apiKey ?? getApiKey();
  if (!apiKey) {
    const { getLocalProviderConfig, runLocalBranch } = await import("../local.js");
    if (getLocalProviderConfig()) {
      await runLocalBranch({
        description: opts.message,
        diff: opts.message ? undefined : payload.diff,
        changes: opts.message ? undefined : payload.changes,
        recentCommits: payload.recent_commits,
        model: opts.model,
        noSwitch: opts.noSwitch,
        push: opts.push,
        baseRef,
        rules: genRules,
        noAnimate: opts.noAnimate,
      });
      return;
    }
    throw new Error("Not authenticated. Run `qc login` first, or provide --message.");
  }

  const spinner = createStageSpinner({
    stage: "branchGen",
    message: `generating branch name (${model ?? "default"})...`,
    theme: ui.theme,
    animate,
    isTTY: !!process.stderr.isTTY,
    isColor: ui.isColor,
    asciiFallback: !ui.isColor,
    uniform: uniformSpinner,
  });
  if (process.stderr.isTTY) spinner.start();
  let result: { name: string; type: string; slug: string };
  try {
    const client = new ApiClient({ apiKey });
    result = await client.generateBranchName(payload);
  } finally {
    spinner.stop();
  }

  const final = finalizeGeneratedBranchName(result.name);
  log.success(`branch name: ${final}`);

  if (opts.dryRun) {
    log.dim(`(dry-run; not creating)`);
    return;
  }

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
