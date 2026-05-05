import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/** Safe git ref pattern — requires alphanumeric first char to prevent flag injection */
const SAFE_GIT_REF = /^[a-zA-Z0-9][a-zA-Z0-9._\-/~:^@]*$/;

export function validateRef(ref: string, name = "ref"): void {
  if (ref.startsWith("-")) {
    throw new Error(`Invalid git ref ${name}: starts with hyphen: "${ref}"`);
  }
  if (!ref || !SAFE_GIT_REF.test(ref)) {
    throw new Error(`Invalid git ref ${name}: "${ref}"`);
  }
}

export function isGitRepo(): boolean {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

export function getGitRoot(): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
    }).trim();
  } catch {
    return process.cwd();
  }
}

export function getStagedDiff(excludes: string[] = []): string {
  const args = ["diff", "--cached"];
  if (excludes.length > 0) {
    args.push("--");
    args.push(".");
    for (const pattern of excludes) {
      args.push(`:(exclude)${pattern}`);
    }
  }
  return execFileSync("git", args, {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

export function getStagedFiles(): string {
  return execFileSync("git", ["diff", "--cached", "--name-only"], {
    encoding: "utf-8",
  });
}

/**
 * Get the working-tree diff (unstaged changes vs HEAD), respecting excludes.
 * Used as a fallback for branch name generation when nothing is staged yet.
 */
export function getWorkingTreeDiff(excludes: string[] = []): string {
  const args = ["diff", "HEAD"];
  if (excludes.length > 0) {
    args.push("--");
    args.push(".");
    for (const pattern of excludes) {
      args.push(`:(exclude)${pattern}`);
    }
  }
  return execFileSync("git", args, {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

/**
 * Get all changed files (staged + unstaged + untracked) as a newline-separated list.
 * Used as a fallback for branch name generation when nothing is staged.
 */
export function getAllChangedFiles(): string {
  const output = execFileSync("git", ["status", "--porcelain"], {
    encoding: "utf-8",
  });
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3)) // strip "XY " status prefix
    .join("\n");
}

export function hasStagedChanges(): boolean {
  const output = execFileSync("git", ["diff", "--cached", "--name-only"], {
    encoding: "utf-8",
  });
  return output.trim().length > 0;
}

export function getUnstagedFiles(): string[] {
  // Includes both tracked-but-modified AND untracked files, since `qc -a` (which
  // calls stageAll → `git add -A`) will stage all of them. The error message
  // shown when nothing is staged needs to surface this so users know `-a` will
  // pick them up.
  const output = execFileSync("git", ["status", "--porcelain"], {
    encoding: "utf-8",
  });
  return output.trim().split("\n").filter(Boolean);
}

export function stageAll(): void {
  // `-A` stages everything: new files (untracked), modifications, and deletions.
  // Previously was `-u` which only staged modifications to already-tracked files,
  // missing untracked files — surprising for users running `qc -a`.
  execFileSync("git", ["add", "-A"], { stdio: "pipe" });
}

export function gitCommit(message: string): void {
  const tmpDir = mkdtempSync(join(tmpdir(), "qc-"));
  const tmpFile = join(tmpDir, "commit.txt");
  writeFileSync(tmpFile, message, { mode: 0o600 });
  try {
    execFileSync("git", ["commit", "-F", tmpFile], { stdio: "pipe" });
    // Suppress git's own output — the CLI prints its own confirmation line.
  } catch (err) {
    // On failure, surface git's stderr so the user can debug.
    const stderr = (err as { stderr?: Buffer })?.stderr?.toString() ?? "";
    if (stderr) process.stderr.write(stderr);
    throw err;
  } finally {
    try {
      unlinkSync(tmpFile);
      rmdirSync(tmpDir);
    } catch {
      // cleanup best-effort
    }
  }
}

export function gitPush(): void {
  // Auto-detect if the current branch has an upstream. If not, set it with --set-upstream.
  // This handles freshly created branches (e.g., from `qc branch` or the protected-branch guard).
  const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    encoding: "utf-8",
  }).trim();

  let hasUpstream = false;
  try {
    execFileSync("git", ["rev-parse", "--abbrev-ref", `${branch}@{upstream}`], { stdio: "pipe" });
    hasUpstream = true;
  } catch {
    // No upstream configured
  }

  const args = hasUpstream ? ["push"] : ["push", "--set-upstream", "origin", branch];
  try {
    execFileSync("git", args, { stdio: "pipe" });
  } catch (err) {
    const stderr = (err as { stderr?: Buffer })?.stderr?.toString() ?? "";
    if (stderr) process.stderr.write(stderr);
    throw err;
  }
}

export function getBranchCommits(base = "main"): string[] {
  validateRef(base, "base");
  const output = execFileSync("git", ["log", `${base}..HEAD`, "--format=%s", "--max-count=1000"], {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return output.trim().split("\n").filter(Boolean);
}

export function getDiffStat(base = "main"): string {
  validateRef(base, "base");
  return execFileSync("git", ["diff", `${base}..HEAD`, "--stat"], {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

export function getCurrentBranch(): string {
  return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    encoding: "utf-8",
  }).trim();
}

export function getLatestTag(): string | null {
  try {
    return execFileSync("git", ["describe", "--tags", "--abbrev=0"], {
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
}

export function getCommitsSince(ref: string, to = "HEAD"): Array<{ hash: string; subject: string }> {
  validateRef(ref, "from ref");
  validateRef(to, "to ref");
  const output = execFileSync(
    "git",
    ["log", `${ref}..${to}`, "--format=%H %s", "--max-count=1000"],
    { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
  );
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, ...rest] = line.split(" ");
      return { hash: hash ?? "", subject: rest.join(" ").trim() };
    });
}

/** Get list of files changed since base branch */
export function getChangedFilesSince(base = "main"): string[] {
  validateRef(base, "base");
  const output = execFileSync("git", ["diff", `${base}..HEAD`, "--name-only"], {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return output.trim().split("\n").filter(Boolean);
}

/** Get one-line commit log since base branch (for AI context) */
export function getOnlineLog(base = "main"): string {
  validateRef(base, "base");
  return execFileSync(
    "git",
    ["log", `${base}..HEAD`, "--oneline", "--max-count=200"],
    {
      encoding: "utf-8",
      maxBuffer: 5 * 1024 * 1024,
    }
  ).trim();
}

/** Get full diff since base branch */
export function getFullDiff(base = "main"): string {
  validateRef(base, "base");
  return execFileSync("git", ["diff", `${base}..HEAD`], {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

export function getStagedFileCount(): number {
  const output = execFileSync("git", ["diff", "--cached", "--name-only"], {
    encoding: "utf-8",
  });
  return output.trim().split("\n").filter(Boolean).length;
}

/** Insertion/deletion counts for the staged diff (`git diff --cached --shortstat`). */
export function getStagedDiffShortstat(): { additions: number; deletions: number } {
  try {
    const out = execFileSync("git", ["diff", "--cached", "--shortstat"], {
      encoding: "utf-8",
    }).trim();
    if (!out) return { additions: 0, deletions: 0 };
    let additions = 0;
    let deletions = 0;
    const ins = /(\d+) insertion/.exec(out);
    const del = /(\d+) deletion/.exec(out);
    if (ins?.[1]) additions = parseInt(ins[1], 10);
    if (del?.[1]) deletions = parseInt(del[1], 10);
    return { additions, deletions };
  } catch {
    return { additions: 0, deletions: 0 };
  }
}

export function getShortStagedFiles(max = 3): { files: string[]; total: number } {
  const output = execFileSync("git", ["diff", "--cached", "--name-only"], {
    encoding: "utf-8",
  });
  const all = output.trim().split("\n").filter(Boolean);
  return { files: all.slice(0, max), total: all.length };
}

export function getCommitHash(): string {
  return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    encoding: "utf-8",
  }).trim();
}

export function getPushStats(): { commits: number; stat: string } | null {
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf-8",
    }).trim();

    // Check if there's an upstream to compare against
    let upstream: string | null = null;
    try {
      upstream = execFileSync(
        "git", ["rev-parse", "--abbrev-ref", `${branch}@{upstream}`],
        { encoding: "utf-8", stdio: "pipe" }
      ).trim();
    } catch {
      // No upstream — fresh branch, never pushed
    }

    if (upstream) {
      const countOutput = execFileSync(
        "git",
        ["rev-list", "--count", `${upstream}..HEAD`],
        { encoding: "utf-8" }
      ).trim();
      const parsedCount = parseInt(countOutput, 10);
      const commits = Number.isFinite(parsedCount) ? parsedCount : 0;
      const stat = execFileSync(
        "git",
        ["diff", "--shortstat", `${upstream}..HEAD`],
        { encoding: "utf-8" }
      ).trim();
      return { commits, stat };
    }

    // No upstream: fresh branch. Get stat for the most recent commit.
    const stat = execFileSync(
      "git", ["diff", "--shortstat", "HEAD~1..HEAD"],
      { encoding: "utf-8" }
    ).trim();
    return { commits: 1, stat };
  } catch {
    return null;
  }
}

export function getRecentBranchCommits(count = 5): string[] {
  try {
    const output = execFileSync(
      "git",
      ["log", "--format=%s%n%b%n---", `--max-count=${count}`, "HEAD"],
      { encoding: "utf-8", maxBuffer: 1024 * 1024 }
    );
    return output
      .split("---\n")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, count);
  } catch {
    return [];
  }
}

/** Get the count of commits ahead of the given upstream ref. Returns 0 if upstream missing. */
export function getCommitsAheadOfUpstream(branch: string, upstream?: string): number {
  validateRef(branch, "branch");
  const target = upstream ?? `origin/${branch}`;
  validateRef(target, "upstream");
  try {
    const out = execFileSync(
      "git",
      ["rev-list", "--count", `${target}..HEAD`],
      { encoding: "utf-8" }
    ).trim();
    const n = parseInt(out, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** Returns the upstream branch ref for the given local branch, or null if none. */
export function getUpstreamRef(branch: string): string | null {
  validateRef(branch, "branch");
  try {
    return (
      execFileSync(
        "git",
        ["rev-parse", "--abbrev-ref", `${branch}@{upstream}`],
        { encoding: "utf-8" }
      ).trim() || null
    );
  } catch {
    return null;
  }
}

/** Get the default branch from the remote (origin/HEAD), or null. */
export function getDefaultBranch(): string | null {
  try {
    const out = execFileSync(
      "git",
      ["symbolic-ref", "refs/remotes/origin/HEAD"],
      { encoding: "utf-8" }
    ).trim();
    const segments = out.split("/");
    return segments[segments.length - 1] || null;
  } catch {
    return null;
  }
}

/** Returns true if a branch with this name exists locally OR on origin. */
export function branchExists(name: string): boolean {
  validateRef(name, "branch");
  try {
    execFileSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${name}`], {
      stdio: "pipe",
    });
    return true;
  } catch {
    // Not local; check remote
  }
  try {
    execFileSync("git", ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${name}`], {
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/** Stash all changes (including untracked). Returns true if a stash was actually created. */
export function stashPushIfDirty(message: string): boolean {
  const status = execFileSync("git", ["status", "--porcelain"], { encoding: "utf-8" }).trim();
  if (!status) return false;

  execFileSync("git", ["stash", "push", "--include-untracked", "--message", message], {
    stdio: "pipe",
  });
  return true;
}

/** Pop the most recent stash. Throws if conflicts arise. */
export function stashPop(): void {
  execFileSync("git", ["stash", "pop"], { stdio: "pipe" });
}

/** Hard-reset the current branch to the given ref. */
export function resetHard(ref: string): void {
  validateRef(ref, "ref");
  execFileSync("git", ["reset", "--hard", ref], { stdio: "pipe" });
}

/** Create a new branch (without checkout). */
export function createBranch(name: string, base: string = "HEAD"): void {
  validateRef(name, "name");
  validateRef(base, "base");
  execFileSync("git", ["branch", name, base], { stdio: "pipe" });
}

/** Checkout an existing branch. */
export function checkoutBranch(name: string): void {
  validateRef(name, "name");
  execFileSync("git", ["checkout", name], { stdio: "pipe" });
}

/** Create and checkout a new branch in one step (`git checkout -b`). */
export function createAndCheckoutBranch(name: string, base: string = "HEAD"): void {
  validateRef(name, "name");
  validateRef(base, "base");
  execFileSync("git", ["checkout", "-b", name, base], { stdio: "pipe" });
}

/** Get the current HEAD SHA (full). */
export function getHeadSha(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).trim();
}

/** Push current branch to origin and set upstream. */
export function gitPushSetUpstream(branch: string): void {
  validateRef(branch, "branch");
  try {
    execFileSync("git", ["push", "-u", "origin", branch], { stdio: "pipe" });
  } catch (err) {
    const stderr = (err as { stderr?: Buffer })?.stderr?.toString() ?? "";
    if (stderr) process.stderr.write(stderr);
    throw err;
  }
}

/** Delete a local branch by name (`git branch -D`). */
export function deleteBranch(name: string): void {
  validateRef(name, "name");
  execFileSync("git", ["branch", "-D", name], { stdio: "pipe" });
}
