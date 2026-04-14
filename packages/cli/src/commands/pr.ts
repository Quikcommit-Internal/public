import { execFileSync } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { MAX_PR_CURRENT_BRANCH_CHARS } from "@quikcommit/shared";
import { getApiKey } from "../config.js";
import { ApiClient } from "../api.js";
import { detectCommitlintRules } from "../commitlint.js";
import { getBranchCommits, getCurrentBranch, getDiffStat, getGitRoot } from "../git.js";

/** Supported PR template locations (first match wins). See docs: packages/docs/api/pr.md */
function findPullRequestTemplate(gitRoot: string): { path: string; content: string } | undefined {
  const fileCandidates = [
    join(gitRoot, ".github", "pull_request_template.md"),
    join(gitRoot, ".github", "PULL_REQUEST_TEMPLATE.md"),
    join(gitRoot, "pull_request_template.md"),
    join(gitRoot, "docs", "pull_request_template.md"),
  ];
  for (const p of fileCandidates) {
    try {
      if (existsSync(p) && statSync(p).isFile()) {
        return { path: p, content: readFileSync(p, "utf-8") };
      }
    } catch {
      // ignore unreadable paths
    }
  }
  const multiDir = join(gitRoot, ".github", "PULL_REQUEST_TEMPLATE");
  try {
    if (existsSync(multiDir) && statSync(multiDir).isDirectory()) {
      const names = readdirSync(multiDir)
        .filter((f) => f.endsWith(".md"))
        .sort();
      if (names.length > 0) {
        const p = join(multiDir, names[0]);
        if (statSync(p).isFile()) {
          return { path: p, content: readFileSync(p, "utf-8") };
        }
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

export async function pr(options: {
  base?: string;
  create?: boolean;
  model?: string;
}): Promise<void> {
  const base = options.base ?? "main";
  const commits = getBranchCommits(base);
  const diffStat = getDiffStat(base);

  const gitRoot = getGitRoot();
  const templateHit = findPullRequestTemplate(gitRoot);
  let prTemplate: string | undefined;
  if (templateHit) {
    prTemplate = templateHit.content.substring(0, 16 * 1024);
    console.error(`[qc] Using PR template from ${relative(gitRoot, templateHit.path)}`);
  }

  const currentBranch = getCurrentBranch().slice(0, MAX_PR_CURRENT_BRANCH_CHARS);

  if (commits.length === 0) {
    console.error(`No commits found on this branch vs ${base}`);
    process.exit(1);
  }

  const commitlintRules = await detectCommitlintRules();
  // Note: unlike runCommit(), qc pr does not merge config.rules here —
  // PR descriptions are about summarizing what changed, not enforcing commit conventions.
  // commitlintRules still apply for type/scope awareness in the description.

  console.error(`Generating PR description from ${commits.length} commits...`);

  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("Error: Not authenticated. Run `qc login` first.");
    process.exit(1);
  }

  const client = new ApiClient({ apiKey });
  const result = await client.generatePR(
    {
      commits,
      diff_stat: diffStat,
      base_branch: base,
      current_branch: currentBranch,
      pr_template: prTemplate,
      rules: commitlintRules,
    },
    options.model
  );

  const trimmedTitle = result.title.trim();
  if (trimmedTitle) {
    console.log(`\nTitle: ${trimmedTitle}\n`);
  }
  console.log(result.message + "\n");

  if (options.create) {
    try {
      const prTitle =
        trimmedTitle ||
        result.message.split("\n").find((l) => l.trim()) ||
        result.message.substring(0, 72).trim();
      execFileSync("gh", ["pr", "create", "--title", prTitle, "--body", result.message], {
        stdio: "inherit",
      });
    } catch {
      console.error("Error: `gh` CLI not found or failed. Install from https://cli.github.com/");
      process.exit(1);
    }
  }
}
