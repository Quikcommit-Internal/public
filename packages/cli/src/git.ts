import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/** Safe git ref pattern — allows chars valid in branch names, tags, SHA prefixes */
const SAFE_GIT_REF = /^[a-zA-Z0-9._\-/~:^@]+$/;

export function validateRef(ref: string, name = "ref"): void {
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

export function hasStagedChanges(): boolean {
  const output = execFileSync("git", ["diff", "--cached", "--name-only"], {
    encoding: "utf-8",
  });
  return output.trim().length > 0;
}

export function getUnstagedFiles(): string[] {
  const output = execFileSync("git", ["status", "--porcelain"], {
    encoding: "utf-8",
  });
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter((line) => !line.startsWith("??")); // exclude untracked
}

export function stageAll(): void {
  execFileSync("git", ["add", "-u"], { stdio: "pipe" });
}

export function gitCommit(message: string): void {
  const tmpDir = mkdtempSync(join(tmpdir(), "qc-"));
  const tmpFile = join(tmpDir, "commit.txt");
  writeFileSync(tmpFile, message, { mode: 0o600 });
  try {
    execFileSync("git", ["commit", "-F", tmpFile], { stdio: "inherit" });
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
  execFileSync("git", ["push"], { stdio: "inherit" });
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
    const countOutput = execFileSync(
      "git",
      ["rev-list", "--count", `origin/${branch}..HEAD`],
      { encoding: "utf-8" }
    ).trim();
    const parsedCount = parseInt(countOutput, 10);
    const commits = Number.isFinite(parsedCount) ? parsedCount : 0;
    const stat = execFileSync(
      "git",
      ["diff", "--shortstat", `origin/${branch}..HEAD`],
      { encoding: "utf-8" }
    ).trim();
    return { commits, stat };
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
