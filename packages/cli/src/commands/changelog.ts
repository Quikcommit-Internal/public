import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { getApiKey } from "../config.js";
import { ApiClient } from "../api.js";
import { getLatestTag, getCommitsSince, getGitRoot } from "../git.js";

const CONVENTIONAL_TYPE_RE = /^(feat|fix|docs|style|refactor|perf|test|chore)(\([^)]+\))?!?:\s+/i;

function parseCommitType(subject: string): string {
  const match = subject.match(CONVENTIONAL_TYPE_RE);
  return match ? match[1].toLowerCase() : "chore";
}

function groupCommitsByType(
  commits: Array<{ hash: string; subject: string }>
): Record<string, string[]> {
  const byType: Record<string, string[]> = {};
  for (const { subject } of commits) {
    const type = parseCommitType(subject);
    if (!byType[type]) byType[type] = [];
    byType[type].push(subject);
  }
  return byType;
}

export async function changelog(options: {
  from?: string;
  to?: string;
  write?: boolean;
  version?: string;
  model?: string;
}): Promise<void> {
  const fromRef = options.from ?? getLatestTag();
  const toRef = options.to ?? "HEAD";

  if (!fromRef) {
    console.error("Error: No git tag found. Use --from <ref> to specify a starting point.");
    process.exit(1);
  }

  const commits = getCommitsSince(fromRef, toRef);
  if (commits.length === 0) {
    console.error(`No commits found between ${fromRef} and ${toRef}`);
    process.exit(1);
  }

  const commitsByType = groupCommitsByType(commits);

  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("Error: Not authenticated. Run `qc login` first.");
    process.exit(1);
  }

  const client = new ApiClient({ apiKey });
  const result = await client.generateChangelog(
    {
      commits_by_type: commitsByType,
      from_tag: fromRef,
      to_ref: toRef,
    },
    options.model
  );

  // H-3: derive version from --version flag, or toRef if it looks like a tag, or fromRef-next
  const version =
    options.version ??
    (/^v?\d/.test(toRef) && toRef !== "HEAD" ? toRef.replace(/^v/, "") : null) ??
    `${fromRef.replace(/^v/, "")}-next`;

  const date = new Date().toISOString().slice(0, 10);
  const header = `## [${version}] - ${date}\n\n`;
  const changelogEntry = header + result.message;

  if (options.write) {
    // M-3: write relative to git root, not CWD
    const path = join(getGitRoot(), "CHANGELOG.md");
    const existing = existsSync(path) ? readFileSync(path, "utf-8") : "";
    const newContent = changelogEntry + (existing ? "\n\n" + existing : "");
    writeFileSync(path, newContent);
    console.error(`Wrote to ${path}`);
  } else {
    console.log(changelogEntry);
  }
}
